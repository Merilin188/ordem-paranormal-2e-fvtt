/**
 * INVESTIGAR no playtest Beta (Ações de Investigação) — três passos, um card só.
 *
 * 1. O jogador escolhe o ponto: o card lista as perícias do quadro (sem DT, sem
 *    contagem) com o dado dele em cada uma.
 * 2. Ele escolhe UMA. Ninguém rola: abre a janela do mestre com as linhas daquela
 *    perícia, já marcado o que o dado alcança. O mestre desmarca, inclui (até linha
 *    oculta), muda o estado das linhas e envia — e o card do jogador mostra.
 * 3. Observar (outra perícia, de novo pela janela do mestre, sem rolar e sem custo)
 *    OU Examinar (rola a perícia do passo 2; linhas com DT até o resultado; nada novo
 *    = perde 1 PD). Escolher um tira os dois botões, e a ação acaba.
 *
 * O estado vive na flag `investigar` da mensagem. Quem escreve é o mestre
 * (`comoMestre`): o card pode ter sido criado por ele ou pelo jogador.
 */
import { SYSTEM_ID, CUSTO_PD_EXAMINAR } from "../config.mjs";
import {
  periciasParaInvestigar, linhasParaOMestre, novasParaOPersonagem, escolherAprofundamento,
  periciasParaObservar, resolverExaminarBeta, infosAlcancaveis,
} from "./investigacao.mjs";
import {
  carregarPoi, gravarRevelacoes, sussurroPara, editorDeTexto, recuperarPdAoDescobrir, idsRevelados,
} from "./acoes-investigacao.mjs";
import { pontoTrancado } from "./acesso-poi.mjs";
import { itensDaLinha } from "./itens-pista.mjs";
import { rolarTeste, rotuloDePericia, renderizar } from "../dice/teste.mjs";
import { aplicarDano } from "../dice/falha-critica.mjs";
import { comoMestre, registrarAcaoDeMestre } from "../ui/socket.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const FLAG = "investigar";
const RAIZ = "systems/ordem-paranormal-2e/templates";
const L = (chave, dados) => (dados ? game.i18n.format(`OP2.Investigar.${chave}`, dados) : game.i18n.localize(`OP2.Investigar.${chave}`));

const estadoDe = (mensagem) => mensagem?.getFlag(SYSTEM_ID, FLAG) ?? null;

/** "Percepção" e o tamanho do dado do personagem nela (o que ele "fala" ao mestre). */
function periciaComDado(ator, chave) {
  return { chave, rotulo: rotuloDePericia(chave), dado: ator.system.resolverChave?.(chave)?.valor ?? 0 };
}

/* ------------------------------------------------------------------ */
/* Card                                                                  */
/* ------------------------------------------------------------------ */

async function conteudo(estado) {
  const poi = await fromUuid(estado.poiUuid);
  const ator = game.actors.get(estado.atorId);
  const porId = new Map((poi?.system.informacoes ?? []).map((info) => [info.id, info]));
  const linhas = (ids, chave) => (ids ?? []).map((id) => porId.get(id)).filter(Boolean).map((info) => {
    const itens = itensDaLinha(info);
    return { ...info, rotuloPericia: rotuloDePericia(chave), itens, itensUuids: itens.map((i) => i.uuid).join(",") };
  });
  const bloco = (b) => (b ? { ...b, infos: linhas(b.infos, b.pericia) } : null);
  const etapa = estado.etapa;
  return renderizar(`${RAIZ}/chat/investigar.hbs`, {
    ...estado,
    poiNome: poi?.name ?? "?",
    atorNome: ator?.name ?? "?",
    descricaoBasica: estado.primeiraVez && poi?.system.descricaoBasica?.trim()
      ? await editorDeTexto().enrichHTML(poi.system.descricaoBasica, { relativeTo: poi }) : "",
    trancado: poi ? pontoTrancado(poi) : false,
    passivo: bloco(estado.passivo),
    observar: bloco(estado.observar),
    examinar: estado.examinar ? { ...estado.examinar, infos: linhas(estado.examinar.infos, estado.passivo?.pericia) } : null,
    periciasObservar: periciasParaObservar(estado),
    podeObservar: periciasParaObservar(estado).length > 0,
    ehPericia: etapa === "pericia",
    ehAprofundar: etapa === "aprofundar",
    ehObservar: etapa === "observar",
    ehExaminando: etapa === "examinando",
    ehFim: etapa === "fim" && !estado.semPericias,
    aguardandoMestre: etapa === "mestre" || etapa === "mestreObservar",
    rotuloCusto: game.i18n.format("OP2.Investigacao.PerderPD", { custo: CUSTO_PD_EXAMINAR }),
  });
}

/** Grava o estado e redesenha o card. Só no mestre. */
async function salvar(mensagem, estado) {
  await mensagem.update({ content: await conteudo(estado), [`flags.${SYSTEM_ID}.${FLAG}`]: estado });
}

/**
 * Passo 1: o card com as perícias do ponto. É o botão "Investigar" do ponto na
 * janela de ações. Sussurrado ao dono e ao mestre: o que chegar ali é de quem achou.
 */
export async function iniciarInvestigacao(ator, poiUuid) {
  const poi = await carregarPoi(poiUuid);
  if (!poi) return null;
  const pericias = periciasParaInvestigar(poi.system.informacoes, pontoTrancado(poi)).map((c) => periciaComDado(ator, c));
  const primeiraVez = !ator.system.estado.poisInvestigados.has(poiUuid);
  if (primeiraVez) await gravarRevelacoes(ator, poiUuid, [], { investigado: true });
  const estado = {
    atorId: ator.id, poiUuid, primeiraVez, pericias,
    semPericias: pericias.length === 0,
    etapa: pericias.length ? "pericia" : "fim",
    passivo: null, observar: null, examinar: null,
  };
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: await conteudo(estado),
    whisper: sussurroPara(ator),
    flags: { [SYSTEM_ID]: { tipo: "investigacao", atorId: ator.id, [FLAG]: estado } },
  });
}

/* ------------------------------------------------------------------ */
/* Mestre                                                                */
/* ------------------------------------------------------------------ */

/** O jogador escolheu a perícia (passo 2 ou Observar): registra e abre a janela do mestre. */
async function escolherPericia({ mensagemId, pericia }) {
  const mensagem = game.messages.get(mensagemId);
  const estado = estadoDe(mensagem);
  const ator = game.actors.get(estado?.atorId);
  if (!estado || !ator) return;
  const modo = estado.etapa === "pericia" ? "passivo" : estado.etapa === "observar" ? "observar" : null;
  if (!modo) return;
  const validas = modo === "passivo" ? estado.pericias : periciasParaObservar(estado);
  const escolhida = validas.find((p) => p.chave === pericia);
  if (!escolhida) return;
  const novo = {
    ...estado,
    [modo]: { ...periciaComDado(ator, escolhida.chave), infos: [], enviado: false },
    etapa: modo === "passivo" ? "mestre" : "mestreObservar",
  };
  await salvar(mensagem, novo);
  abrirJanelaDoMestre(mensagemId);
}

/** Observar ou Examinar (exclusivos); "desfazer" volta a escolha se o teste foi cancelado. */
async function escolherAprofundar({ mensagemId, escolha }) {
  const mensagem = game.messages.get(mensagemId);
  const estado = estadoDe(mensagem);
  if (!estado) return;
  if (escolha === "desfazer") {
    if (estado.etapa === "examinando" && !estado.examinar) await salvar(mensagem, { ...estado, etapa: "aprofundar", escolha: null });
    return;
  }
  const novo = escolherAprofundamento(estado, escolha);
  if (novo) await salvar(mensagem, novo);
}

/** O resultado do Examinar, rolado no cliente do jogador. */
async function registrarExaminar({ mensagemId, examinar }) {
  const mensagem = game.messages.get(mensagemId);
  const estado = estadoDe(mensagem);
  const ator = game.actors.get(estado?.atorId);
  if (!estado || !ator || estado.etapa !== "examinando") return;
  const novas = novasParaOPersonagem(examinar.infos, idsRevelados(ator, estado.poiUuid));
  await gravarRevelacoes(ator, estado.poiUuid, novas);
  const pd = novas.length ? await recuperarPdAoDescobrir(ator) : null;
  await salvar(mensagem, { ...estado, examinar: { ...examinar, pdRecuperado: pd?.pd ? pd.texto : "" }, etapa: "fim" });
}

async function marcarPdPago({ mensagemId }) {
  const mensagem = game.messages.get(mensagemId);
  const estado = estadoDe(mensagem);
  if (!estado?.examinar || estado.examinar.pdPago) return;
  await salvar(mensagem, { ...estado, examinar: { ...estado.examinar, pdPago: true } });
}

const janelas = new Map();

export function abrirJanelaDoMestre(mensagemId) {
  if (!game.user.isGM) return;
  let janela = janelas.get(mensagemId);
  if (!janela) {
    janela = new JanelaDoMestre(mensagemId);
    janelas.set(mensagemId, janela);
  }
  void janela.render({ force: true });
}

/**
 * A janela do mestre no passo 2 e no Observar: as linhas da perícia escolhida. Vem
 * marcado o que o livro manda narrar (DT até o dado, visível, fora da tranca); o
 * mestre ajusta, inclusive enviando linha oculta, e muda o estado de cada uma.
 */
class JanelaDoMestre extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-invm-janela"],
    window: { title: "OP2.Investigar.Mestre.Titulo", icon: "fa-solid fa-user-secret", resizable: true },
    position: { width: 560, height: "auto" },
    actions: { alternarOculta: JanelaDoMestre.#alternarOculta, enviar: JanelaDoMestre.#enviar },
  };

  static PARTS = { corpo: { template: `${RAIZ}/cena/investigar-mestre.hbs` } };

  /** O que vai ser enviado. Nasce do padrão e sobrevive aos redesenhos. */
  #marcadas = null;

  constructor(mensagemId) {
    super({ id: `op2-investigar-mestre-${mensagemId}` });
    this.mensagemId = mensagemId;
  }

  get mensagem() { return game.messages.get(this.mensagemId); }

  /** "passivo" ou "observar", pela etapa do card. */
  get modo() {
    const etapa = estadoDe(this.mensagem)?.etapa;
    if (etapa === "mestreObservar" || etapa === "observar" || estadoDe(this.mensagem)?.observar) return "observar";
    return "passivo";
  }

  async _prepareContext() {
    const estado = estadoDe(this.mensagem);
    const ator = game.actors.get(estado?.atorId);
    const poi = estado ? await fromUuid(estado.poiUuid) : null;
    const bloco = estado?.[this.modo];
    if (!estado || !ator || !poi || !bloco) return { temLinhas: false, grupos: [], enviado: true, cabecalho: "" };
    const linhas = linhasParaOMestre(poi.system.informacoes, bloco.pericia, bloco.dado, idsRevelados(ator, poi.uuid), pontoTrancado(poi));
    this.#marcadas ??= new Set(linhas.filter((l) => l.marcada).map((l) => l.id));
    const editor = editorDeTexto();
    const comTexto = await Promise.all(linhas.map(async (l) => ({
      ...l, texto: await editor.enrichHTML(l.texto ?? "", { relativeTo: poi }), marcada: this.#marcadas.has(l.id),
    })));
    return {
      atorImg: ator.img,
      modoRotulo: L(this.modo === "passivo" ? "Mestre.ModoPassivo" : "Mestre.ModoObservar"),
      cabecalho: L("Mestre.Cabecalho", { ator: ator.name, poi: poi.name, pericia: bloco.rotulo, dado: bloco.dado }),
      descricaoContextual: poi.system.descricaoContextual?.trim()
        ? await editor.enrichHTML(poi.system.descricaoContextual, { relativeTo: poi }) : "",
      temLinhas: linhas.length > 0,
      grupos: [
        { titulo: L("Mestre.Alcanca", { dado: bloco.dado }), linhas: comTexto.filter((l) => l.alcanca) },
        { titulo: L("Mestre.Acima", { dado: bloco.dado }), linhas: comTexto.filter((l) => !l.alcanca) },
      ],
      enviado: bloco.enviado,
      contagem: L("Mestre.Marcadas", { n: this.#marcadas.size }),
      rotuloEnviar: L(this.#marcadas.size ? "Mestre.Enviar" : "Mestre.EnviarNada", { ator: ator.name }),
    };
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    for (const caixa of this.element.querySelectorAll("[data-enviar]")) {
      caixa.addEventListener("change", () => {
        if (caixa.checked) this.#marcadas.add(caixa.dataset.enviar);
        else this.#marcadas.delete(caixa.dataset.enviar);
        caixa.closest(".op2-invm__linha")?.classList.toggle("marcada", caixa.checked);
        this.render();
      });
    }
  }

  _onClose(opcoes) {
    super._onClose(opcoes);
    janelas.delete(this.mensagemId);
  }

  /** Oculta ↔ descobrível, direto no ponto. Revelar já marca para enviar. */
  static async #alternarOculta(_evento, alvo) {
    const estado = estadoDe(this.mensagem);
    const poi = await fromUuid(estado?.poiUuid);
    if (!poi) return;
    const id = alvo.dataset.id;
    let agoraOculta = false;
    const informacoes = poi.system.informacoes.map((info) => {
      if (info.id !== id) return info;
      agoraOculta = !info.oculta;
      return { ...info, oculta: agoraOculta, aberta: agoraOculta ? false : info.aberta };
    });
    await poi.update({ "system.informacoes": informacoes });
    if (agoraOculta) this.#marcadas?.delete(id);
    else this.#marcadas?.add(id);
    this.render();
  }

  static async #enviar() {
    const mensagem = this.mensagem;
    const estado = estadoDe(mensagem);
    const ator = game.actors.get(estado?.atorId);
    const bloco = estado?.[this.modo];
    if (!ator || !bloco || bloco.enviado) return;
    const poi = await fromUuid(estado.poiUuid);
    // Na ordem do quadro (DT crescente), como a janela mostra.
    const ordem = linhasParaOMestre(poi?.system.informacoes ?? [], bloco.pericia, bloco.dado).map((l) => l.id);
    const enviadas = ordem.filter((id) => this.#marcadas.has(id));
    const novas = novasParaOPersonagem(enviadas, idsRevelados(ator, estado.poiUuid));
    await gravarRevelacoes(ator, estado.poiUuid, novas, { investigado: true });
    const pd = novas.length ? await recuperarPdAoDescobrir(ator) : null;
    await salvar(mensagem, {
      ...estado,
      [this.modo]: { ...bloco, infos: enviadas, enviado: true, pdRecuperado: pd?.pd ? pd.texto : "" },
      etapa: this.modo === "passivo" ? "aprofundar" : "fim",
    });
    await this.close();
  }
}

/* ------------------------------------------------------------------ */
/* Botões do card                                                        */
/* ------------------------------------------------------------------ */

function podeAgir(ator) {
  if (game.user.isGM || ator.isOwner) return true;
  ui.notifications.warn(game.i18n.localize("OP2.Aviso.SemPermissao"));
  return false;
}

/** Examinar: rola aqui, no cliente de quem investiga, e o mestre registra. */
async function examinarDoCard(ator, mensagemId) {
  const mensagem = game.messages.get(mensagemId);
  const estado = estadoDe(mensagem);
  if (estado?.etapa !== "aprofundar" || !estado.passivo) return;
  await comoMestre("op2InvestigarAprofundar", { mensagemId, escolha: "examinar" });
  const chave = estado.passivo.pericia;
  const roll = await rolarTeste(ator, {
    chavePericia: chave, semDT: true, semCard: true,
    contexto: `${game.i18n.localize("OP2.Investigacao.Examinar")} — ${rotuloDePericia(chave)}`,
  });
  if (!roll) return void comoMestre("op2InvestigarAprofundar", { mensagemId, escolha: "desfazer" });
  const poi = await fromUuid(estado.poiUuid);
  const quadro = infosAlcancaveis(poi?.system.informacoes ?? [], poi ? pontoTrancado(poi) : false);
  const { revelaveis } = resolverExaminarBeta(quadro, chave, roll.total, idsRevelados(ator, estado.poiUuid), { ignorarDT: roll.critico });
  await comoMestre("op2InvestigarExaminado", {
    mensagemId,
    examinar: {
      componentes: JSON.parse(JSON.stringify(roll.dados)), total: roll.total,
      critico: roll.critico, falhaCritica: roll.falhaCritica, infos: revelaveis, pdPago: false,
    },
  });
}

export function registrarInvestigar() {
  registrarAcaoDeMestre("op2InvestigarPericia", escolherPericia);
  registrarAcaoDeMestre("op2InvestigarAprofundar", escolherAprofundar);
  registrarAcaoDeMestre("op2InvestigarExaminado", registrarExaminar);
  registrarAcaoDeMestre("op2InvestigarPdPago", marcarPdPago);

  registrarAcaoDeChat("investigar-pericia", async (ator, dataset) => {
    if (!podeAgir(ator)) return;
    await comoMestre("op2InvestigarPericia", { mensagemId: dataset.mensagemId, pericia: dataset.pericia });
  });
  registrarAcaoDeChat("investigar-observar", async (ator, dataset) => {
    if (!podeAgir(ator)) return;
    await comoMestre("op2InvestigarAprofundar", { mensagemId: dataset.mensagemId, escolha: "observar" });
  });
  registrarAcaoDeChat("investigar-examinar", async (ator, dataset) => {
    if (!podeAgir(ator)) return;
    await examinarDoCard(ator, dataset.mensagemId);
  });
  registrarAcaoDeChat("investigar-abrir-mestre", async (_ator, dataset) => abrirJanelaDoMestre(dataset.mensagemId));
  // Nada novo no Examinar: perde 1 PD. Um clique só — o botão some depois de pago.
  registrarAcaoDeChat("investigar-pagar-pd", async (ator, dataset) => {
    if (!podeAgir(ator)) return;
    const estado = estadoDe(game.messages.get(dataset.mensagemId));
    if (!estado?.examinar || estado.examinar.pdPago) return;
    await aplicarDano(ator, CUSTO_PD_EXAMINAR, "pd");
    await comoMestre("op2InvestigarPdPago", { mensagemId: dataset.mensagemId });
    ui.notifications.info(game.i18n.format("OP2.Investigacao.PDPago", { ator: ator.name, custo: CUSTO_PD_EXAMINAR }));
  });
}
