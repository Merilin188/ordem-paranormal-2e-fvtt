/**
 * Combate simplificado (spec §8.1) — orquestração.
 *
 * Guia de combate de Contos da Vigília: o ataque é contra a DT 7. Só vira teste
 * oposto quando o alvo se defende — está Defendendo-se (declarou Defender-se) ou tem
 * Esquiva — e isso é perguntado a ele ANTES de o atacante rolar. O dano, como todo
 * efeito no sistema, precisa de um clique.
 *
 * O playtest marca este módulo como temporário (§8): o combate completo vem depois.
 */
import { SYSTEM_ID } from "../config.mjs";
import { rolarTeste, renderizar, rotuloDePericia } from "../dice/teste.mjs";
import { vencedorDoOposto, resolverAtaque, opcoesDeDefesa, acertaContraDT } from "./combate.mjs";
import { comoMestre, perguntarA, registrarAcaoDeMestre, registrarPergunta, responsavelPor } from "../ui/socket.mjs";
import { alvosDisponiveis, alvosMarcados } from "./encerrar-investigacao.mjs";

/**
 * Agredir: escolhe o alvo, pergunta a ELE se vai se defender (antes de rolar), rola e
 * publica o card. Sem defesa, o ataque é contra a DT 7; com defesa, o card espera o
 * teste oposto do alvo.
 */
export async function atacar(ator, opcoes = {}) {
  try {
    return await atacarSemLimpar(ator, opcoes);
  } finally {
    limparAlvos();
  }
}

/** Depois da ação (executada ou cancelada), o alvo marcado sai da mira. */
export function limparAlvos() {
  for (const t of [...(game.user?.targets ?? [])]) {
    try { t.setTarget(false, { releaseOthers: false, groupSelection: true }); } catch { /* token já saiu da cena */ }
  }
}

async function atacarSemLimpar(ator, { alvoUuid, armado, rapido = false } = {}) {
  const alvo = alvoUuid ? await fromUuid(alvoUuid) : await escolherAlvo(ator);
  if (!alvo) return null;

  // Com qual arma (ou desarmado) e qual perícia: à distância sugere Pontaria.
  const escolha = armado === false ? { arma: null, pericia: "luta" } : await escolherArma(ator);
  if (!escolha) return null;
  const { arma, pericia } = escolha;
  const distancia = pericia === "pontaria";
  const nome = arma?.name ?? game.i18n.localize("OP2.Combate.Desarmado");

  // Fintar vencido (+2 passos) e Mirar (+1d6 à distância) contra este alvo.
  const { vantagensContra, consumirVantagem } = await import("./reducoes.mjs");
  const vantagens = await vantagensContra(ator, alvo);
  const notas = [];
  const dadosExtras = [];
  let passos = null;
  if (vantagens.finta) {
    passos = { pericia: 2 };
    notas.push(game.i18n.format("OP2.Motivo.Finta", { alvo: alvo.name }));
  }
  if (vantagens.mira && distancia) {
    dadosExtras.push({ chave: "mira", rotulo: game.i18n.localize("OP2.Motivo.MirarRotulo"), tipo: "extra", dado: "d6" });
    notas.push(game.i18n.format("OP2.Motivo.Mira", { alvo: alvo.name }));
  }

  const defesa = await perguntarDefesa(ator, alvo, { distancia, nome });
  const roll = await rolarTeste(ator, {
    chavePericia: pericia,
    ...(defesa ? { oposto: true } : { dt: 7 }),
    rapido,
    arma,
    passos,
    dadosExtras,
    notas,
    contexto: game.i18n.format("OP2.Combate.AtaqueContexto", { alvo: alvo.name }),
  });
  if (!roll) return null;
  if (vantagens.finta) await consumirVantagem(ator, vantagens.finta.id);
  await publicarAtaque(ator, alvo, roll, {
    armado: Boolean(arma), defesa, distancia, nome,
    dano: arma ? { base: "ra", bonus: arma.system.danoBonus ?? 0 } : { base: "rb", bonus: 0 },
  });
  return roll;
}

/**
 * Ataque de criatura (botão de punho da ficha): mesmo fluxo do Agredir, com os dados
 * do bloco e o dano da fórmula dela ("RA+1", "RB+2"). À distância, o alvo que se
 * defende só tem Acrobacia.
 * `rolar({ dt })` rola e publica o teste; devolve o roll.
 */
export async function atacarComCriatura(ator, { rolar, dano = null, distancia = false, nome = "" }) {
  try {
    const alvo = await escolherAlvo(ator);
    if (!alvo) return null;
    const defesa = await perguntarDefesa(ator, alvo, { distancia, nome });
    const roll = await rolar({ dt: defesa ? null : 7 });
    if (!roll) return null;
    await publicarAtaque(ator, alvo, roll, { armado: true, dano, distancia, nome, defesa });
    return roll;
  } finally {
    limparAlvos();
  }
}

/* ---------------- defesa perguntada antes da rolagem ---------------- */

const PD = (chave, dados) => (dados ? game.i18n.format(`OP2.Defesa.${chave}`, dados) : game.i18n.localize(`OP2.Defesa.${chave}`));

function rotuloDaDefesa({ modo, pericia }, itemEsquiva = null) {
  const per = rotuloDePericia(pericia);
  return modo === "habilidade"
    ? PD("OpcaoEsquiva", { pericia: per, habilidade: itemEsquiva?.name ?? "Esquiva" })
    : PD("OpcaoDefendendo", { pericia: per });
}

async function opcoesDoAlvo(alvo, distancia) {
  const { poderDe, chaveDaRodada } = await import("./poderes.mjs");
  return opcoesDeDefesa({
    defendendo: Boolean(alvo.statuses?.has("defendendo")),
    temEsquiva: Boolean(poderDe(alvo, "esquiva")),
    esquivaUsada: alvo.getFlag(SYSTEM_ID, "esquivaRodada") === chaveDaRodada(),
    distancia,
  });
}

/**
 * Antes de o atacante rolar: o alvo que está Defendendo-se (ou tem Esquiva) escolhe
 * se gasta a defesa. A janela abre para quem joga com o alvo; sem resposta, segue
 * sem defesa. Devolve `{ modo, pericia }` ou null.
 */
async function perguntarDefesa(atacante, alvo, { distancia, nome }) {
  const opcoes = await opcoesDoAlvo(alvo, distancia);
  if (!opcoes.length) return null;
  const usuario = responsavelPor(alvo);
  if (usuario && usuario.id !== game.user.id) ui.notifications.info(PD("Aguardando", { nome: alvo.name }));
  const escolha = await perguntarA(usuario, "op2PerguntarDefesa", {
    atacanteId: atacante.id, alvoUuid: alvo.uuid, distancia, nome,
  });
  return escolha?.modo ? escolha : null;
}

/** No cliente de quem joga com o alvo: a janela "vai se defender?". Gasta o que usar. */
async function responderDefesa({ atacanteId, alvoUuid, distancia, nome }) {
  const alvo = await fromUuid(alvoUuid);
  const atacante = game.actors.get(atacanteId);
  if (!alvo) return null;
  const opcoes = await opcoesDoAlvo(alvo, distancia);
  if (!opcoes.length) return null;
  const { poderDe, chaveDaRodada } = await import("./poderes.mjs");
  const esquiva = poderDe(alvo, "esquiva");
  const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
  const escolha = await foundry.applications.api.DialogV2.wait({
    window: { title: `${PD("Titulo")} — ${alvo.name}`, icon: "fa-solid fa-shield" },
    classes: ["op2", "op2-ferr-dialogo", "op2-defesa-janela"],
    position: { width: 420 },
    content: `<p>${PD("Pergunta", {
      atacante: `<strong>${esc(atacante?.name ?? "?")}</strong>`, alvo: `<strong>${esc(alvo.name)}</strong>`,
      ataque: esc(nome || game.i18n.localize("OP2.Combate.Atacar")),
      alcance: esc(PD(distancia ? "Distancia" : "Corpo")),
    })}</p><p class="op2-ajuda">${esc(PD("Ajuda"))}</p>`,
    buttons: [
      ...opcoes.map((o, i) => ({ action: String(i), label: rotuloDaDefesa(o, esquiva), icon: "fa-solid fa-shield", default: i === 0 })),
      { action: "nao", label: PD("Nao"), icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  });
  const opcao = opcoes[Number(escolha)];
  if (!opcao || escolha === "nao") return null;
  // A defesa se gasta na escolha: Defendendo-se sai; a Esquiva fica usada na rodada.
  if (opcao.modo === "declarada") await alvo.toggleStatusEffect("defendendo", { active: false });
  else await alvo.setFlag(SYSTEM_ID, "esquivaRodada", chaveDaRodada());
  return opcao;
}

/* ---------------- card do ataque ---------------- */

async function publicarAtaque(ator, alvo, roll, { armado, dano = null, distancia = false, nome = "", defesa = null }) {
  const acertou = defesa ? null : acertaContraDT(roll);
  const esquiva = defesa ? (await import("./poderes.mjs")).poderDe(alvo, "esquiva") : null;
  // Os dados do card ficam na flag: a Guardiã e o dado do crítico re-renderizam o card.
  const dados = {
    titulo: nome || game.i18n.localize("OP2.Combate.Atacar"),
    atacanteId: ator.id,
    atacanteNome: ator.name,
    rollId: roll.options?.id ?? null,
    critico: Boolean(roll.critico),
    alvoId: alvo.id,
    alvoNome: alvo.name,
    total: roll.total,
    ra: roll.ra,
    rb: roll.rb,
    armado,
    danoBase: dano?.base ?? "",
    danoBonus: dano?.bonus ?? 0,
    distancia,
    defesa: defesa ? { ...defesa, rotulo: rotuloDaDefesa(defesa, esquiva) } : null,
    acertou,
    alvoUuid: alvo.uuid,
  };
  Object.assign(dados, await calcularDanoDoAtaque(dados, roll));
  const conteudo = await renderizar(`systems/${SYSTEM_ID}/templates/chat/ataque.hbs`, dados);

  await ChatMessage.create({
    content: conteudo,
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    flags: { [SYSTEM_ID]: { tipo: "ataque", atorId: ator.id, ataque: dados } },
  });
}

/**
 * Texto, total e dano do card a partir do teste. No crítico, o dano usa as duas
 * rolagens mais altas (com o dado extra) e o card diz isso; sem o dado extra rolado
 * ainda, avisa que o dano se atualiza quando ele rolar.
 */
async function calcularDanoDoAtaque(d, roll) {
  const { danoBaseDoRoll, duasMaiores } = await import("../dice/teste.mjs");
  const extra = roll.options?.bonusCritico?.valor ?? 0;
  const total = roll.total + extra;
  const base = d.danoBase ? danoBaseDoRoll(roll, d.danoBase) : 0;
  const dano = d.acertou && d.danoBase ? Math.max(0, base + (d.danoBonus ?? 0)) : 0;
  let notaDano = "";
  if (d.critico && d.acertou) {
    notaDano = extra
      ? game.i18n.format("OP2.Combate.DanoCritico", { dados: duasMaiores(roll).join(" + "), bonus: d.danoBonus ?? 0, dano })
      : game.i18n.localize("OP2.Combate.CriticoPendente");
  }
  const texto = d.defesa
    ? game.i18n.format("OP2.Combate.AtaqueDefendido", { atacante: d.atacanteNome, alvo: d.alvoNome, total, defesa: d.defesa.rotulo })
    : game.i18n.format(d.acertou ? "OP2.Combate.Acertou" : "OP2.Combate.Errou", { atacante: d.atacanteNome, alvo: d.alvoNome, total });
  return { total, dano, notaDano, texto };
}

/** O dado do crítico rolou no card do teste: os cards de ataque daquele teste se refazem. */
export async function atualizarAtaquesDoTeste(roll) {
  const id = roll.options?.id;
  if (!id) return;
  for (const m of game.messages.filter((x) => x.flags?.[SYSTEM_ID]?.ataque?.rollId === id)) {
    const atual = m.flags[SYSTEM_ID].ataque;
    const ataque = { ...atual, ...(await calcularDanoDoAtaque(atual, roll)) };
    if (m.flags[SYSTEM_ID].guardia) ataque.texto = atual.texto;
    const content = await renderizar(`systems/${SYSTEM_ID}/templates/chat/ataque.hbs`, ataque);
    await comoMestre("op2AtaqueAtualizar", { id: m.id, content, ataque });
  }
}

/**
 * Teste oposto do alvo que escolheu se defender: Acrobacia (ou Luta) com +d6 — a
 * única exceção aditiva do playtest (spec §8.1). Vencendo, não sofre nem causa dano.
 */
export async function defender(defensor, { atacanteId, totalAtaque, raAtaque, rbAtaque, pericia = "acrobacia", danoAtacante = null, rapido = false }) {
  const atacante = game.actors.get(atacanteId);
  if (!atacante) return null;

  const roll = await rolarTeste(defensor, {
    chavePericia: pericia,
    oposto: true,
    rapido,
    dadosExtras: [{ chave: "defesa", rotulo: game.i18n.localize("OP2.Defesa.Titulo"), tipo: "extra", dado: "d6" }],
    contexto: game.i18n.format("OP2.Combate.DefesaContexto", { atacante: atacante.name }),
  });
  if (!roll) return null;

  const danoInfo = danoAtacante ?? { base: "ra", bonus: 0 };
  const vencedor = vencedorDoOposto(totalAtaque, roll.total);
  const { dano, alvo } = resolverAtaque({
    vencedor,
    esquiva: true,
    leituraAtacante: { ra: danoInfo.base === "rb" ? rbAtaque : raAtaque, rb: rbAtaque },
    leituraDefensor: { ra: roll.ra, rb: roll.rb },
    armadoAtacante: true,
    armadoDefensor: false,
    bonusAtacante: danoInfo.bonus ?? 0,
  });

  // Escudo: o defensor perdeu, mas somou 7+ → o dano cai em RB do defensor.
  let danoFinal = dano;
  const escudo = defensor.items?.find((i) => i.type === "equipamento" && i.system.equipado && i.system.escudo);
  if (escudo && alvo === "defensor" && roll.total >= 7) danoFinal = Math.max(0, dano - roll.rb);

  const quemSofre = alvo === "defensor" ? defensor : null;
  const conteudo = await renderizar(`systems/${SYSTEM_ID}/templates/chat/ataque-resultado.hbs`, {
    titulo: game.i18n.localize("OP2.Combate.Resultado"),
    totalAtaque,
    totalDefesa: roll.total,
    esquiva: true,
    texto: textoDoDesfecho({ vencedor, atacante, defensor, dano: danoFinal }),
    danosMutuos: [],
    temDano: danoFinal > 0 && Boolean(quemSofre),
    dano: danoFinal,
    quemSofreId: quemSofre?.id ?? "",
    quemSofreUuid: quemSofre?.uuid ?? "",
    quemSofreNome: quemSofre?.name ?? "",
  });

  await ChatMessage.create({
    content: conteudo,
    speaker: ChatMessage.getSpeaker({ actor: defensor }),
    flags: { [SYSTEM_ID]: { tipo: "ataque-resultado", atorId: defensor.id } },
  });

  return { roll, vencedor, dano: danoFinal, alvo };
}

/** Card com defesa: o teste do alvo abre sozinho para quem joga com ele. */
const emAndamento = new Set();

export async function rolarDefesaDoCard(defensor, dataset) {
  const id = dataset.mensagemId;
  const mensagem = game.messages.get(id);
  if (mensagem?.getFlag(SYSTEM_ID, "respondido")) return void ui.notifications.warn(PD("JaRolou"));
  if (emAndamento.has(id)) return;
  emAndamento.add(id);
  try {
    const r = await defender(defensor, {
      atacanteId: dataset.atacanteId,
      totalAtaque: Number(dataset.total),
      raAtaque: Number(dataset.ra),
      rbAtaque: Number(dataset.rb),
      pericia: dataset.pericia || "acrobacia",
      danoAtacante: dataset.danoBase ? { base: dataset.danoBase, bonus: Number(dataset.danoBonus) || 0 } : null,
    });
    if (r) {
      const { marcarAtaqueRespondido } = await import("./guardia.mjs");
      await marcarAtaqueRespondido(id);
    }
  } finally {
    emAndamento.delete(id);
  }
}

function abrirDefesaAoNascer(mensagem) {
  const f = mensagem.flags?.[SYSTEM_ID];
  if (f?.tipo !== "ataque" || !f.ataque?.defesa || f.respondido) return;
  const defensor = (f.ataque.alvoUuid && fromUuidSync(f.ataque.alvoUuid)) || game.actors.get(f.ataque.alvoId);
  if (!defensor || responsavelPor(defensor)?.id !== game.user.id) return;
  const a = f.ataque;
  void rolarDefesaDoCard(defensor, {
    mensagemId: mensagem.id, atacanteId: a.atacanteId, total: a.total, ra: a.ra, rb: a.rb,
    pericia: a.defesa.pericia, danoBase: a.danoBase, danoBonus: a.danoBonus,
  });
}

export function registrarDefesa() {
  registrarPergunta("op2PerguntarDefesa", responderDefesa);
  registrarAcaoDeMestre("op2AtaqueAtualizar", async ({ id, content, ataque }) => {
    await game.messages.get(id)?.update({ content, [`flags.${SYSTEM_ID}.ataque`]: ataque });
  });
  Hooks.on("createChatMessage", abrirDefesaAoNascer);
}

function textoDoDesfecho({ vencedor, atacante, defensor, dano }) {
  if (vencedor === "atacante") return game.i18n.format("OP2.Combate.Venceu", { vencedor: atacante.name, perdedor: defensor.name, dano });
  return game.i18n.format("OP2.Combate.DefendeuTexto", { defensor: defensor.name });
}

/** Armas que o ator carrega: o item é arma; à distância pelo campo ou pelo nome. */
const NOME_DISTANCIA = /\b(arco|besta|pistola|rev[oó]lver|rifle|espingarda|fuzil|carabina|funda|estilingue|zarabatana|dardos?)\b/i;
export function armaADistancia(item) {
  return Boolean(item?.system?.distancia) || NOME_DISTANCIA.test(item?.name ?? "");
}

/**
 * Agredir: escolhe a arma (ou desarmado) e a perícia. Corpo a corpo sugere Luta; à
 * distância, Pontaria — o jogador pode trocar. Devolve `{ arma, pericia }` ou null.
 */
async function escolherArma(ator) {
  const armas = (ator.items?.filter((i) => i.type === "equipamento" && i.system.arma) ?? [])
    .sort((a, b) => Number(b.system.equipado) - Number(a.system.equipado));
  const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
  const padrao = armas.find((a) => a.system.equipado) ?? armas[0] ?? null;
  const opcoes = [
    ...armas.map((a) => `<option value="${a.id}" data-distancia="${armaADistancia(a)}" ${a === padrao ? "selected" : ""}>${esc(a.name)}${
      a.system.danoBonus ? ` (RA+${a.system.danoBonus})` : " (RA)"}${a.system.equipado ? "" : ` — ${esc(game.i18n.localize("OP2.Equipamento.NaoEquipado"))}`}</option>`),
    `<option value="" data-distancia="false" ${padrao ? "" : "selected"}>${esc(game.i18n.localize("OP2.Combate.Desarmado"))}</option>`,
  ].join("");
  const periciaPadrao = armaADistancia(padrao) ? "pontaria" : "luta";
  const pericias = ["luta", "pontaria"].map((p) => `<option value="${p}" ${p === periciaPadrao ? "selected" : ""}>${esc(rotuloDePericia(p))}</option>`).join("");
  const resposta = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("OP2.Combate.Atacar"), icon: "fa-solid fa-hand-fist" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: `<div class="form-group"><label>${esc(game.i18n.localize("OP2.Combate.Arma"))}</label><select name="arma">${opcoes}</select></div>
      <div class="form-group"><label>${esc(game.i18n.localize("OP2.Combate.PericiaAtaque"))}</label><select name="pericia">${pericias}</select></div>
      <p class="op2-ajuda">${esc(game.i18n.localize("OP2.Combate.ArmaAjuda"))}</p>`,
    render: (_evento, dialogo) => {
      const raiz = dialogo.element ?? dialogo;
      const arma = raiz.querySelector?.("select[name=arma]");
      const pericia = raiz.querySelector?.("select[name=pericia]");
      arma?.addEventListener("change", () => {
        pericia.value = arma.selectedOptions[0]?.dataset.distancia === "true" ? "pontaria" : "luta";
      });
    },
    ok: { callback: (_e, botao) => ({ armaId: botao.form.elements.arma.value, pericia: botao.form.elements.pericia.value }) },
    rejectClose: false,
  });
  if (!resposta) return null;
  return { arma: resposta.armaId ? ator.items.get(resposta.armaId) : null, pericia: resposta.pericia };
}

/**
 * O jogador clica no token do alvo ("Clique contra quem quer realizar sua ação").
 * Vale qualquer token visível — inclusive um aliado, em conflito entre jogadores.
 * Esc ou o botão direito cancelam. Sem mapa, cai na lista.
 */
function alvoPorClique(ator) {
  const vista = globalThis.canvas;
  const elemento = vista?.ready ? vista.app?.view : null;
  if (!elemento || typeof vista.canvasCoordinatesFromClient !== "function") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const aviso = ui.notifications.info(game.i18n.localize("OP2.Combate.CliqueAlvo"), { permanent: true });
    const fim = (valor) => {
      elemento.removeEventListener("pointerdown", clique, true);
      document.removeEventListener("keydown", tecla, true);
      clearTimeout(timer);
      try { ui.notifications.remove(aviso); } catch { aviso?.remove?.(); }
      resolve(valor);
    };
    const tecla = (e) => { if (e.key === "Escape") { e.preventDefault(); fim(null); } };
    const clique = (e) => {
      if (e.button === 2) return fim(null);
      if (e.button !== 0) return;
      const p = vista.canvasCoordinatesFromClient({ x: e.clientX, y: e.clientY });
      const tokens = (vista.tokens?.placeables ?? []).filter((t) => t.visible !== false && t.actor && t.bounds?.contains(p.x, p.y));
      const token = tokens.at(-1);
      if (!token) return;
      if (token.actor.uuid === ator.uuid) return void ui.notifications.warn(game.i18n.localize("OP2.Combate.CliqueProprio"));
      token.setTarget?.(true, { releaseOthers: true, groupSelection: false });
      fim(token.actor);
    };
    const timer = setTimeout(() => fim(null), 120000);
    elemento.addEventListener("pointerdown", clique, true);
    document.addEventListener("keydown", tecla, true);
  });
}

/**
 * Quem apanha. A mira do Foundry manda: marcou um token, é nele. Sem marcação, o
 * jogador clica no token do alvo; sem mapa, escolhe da lista de quem está no combate,
 * na cena ou na investigação.
 */
export async function escolherAlvo(ator, titulo = game.i18n.localize("OP2.Combate.Atacar")) {
  const marcados = alvosMarcados({ exceto: ator });
  if (marcados.length === 1) return marcados[0];
  if (!marcados.length) {
    const clicado = await alvoPorClique(ator);
    if (clicado !== undefined) return clicado;
  }

  const candidatos = marcados.length > 1 ? marcados : alvosDisponiveis({ exceto: ator });
  if (!candidatos.length) {
    ui.notifications.warn(game.i18n.localize("OP2.Combate.SemAlvos"));
    return null;
  }
  const opcoes = candidatos
    .map((a) => `<option value="${a.uuid}">${foundry.utils.escapeHTML(a.name)}</option>`).join("");
  const uuid = await foundry.applications.api.DialogV2.prompt({
    window: { title: titulo },
    content: `
      <div class="form-group">
        <label>${game.i18n.localize("OP2.Combate.Alvo")}</label>
        <select name="alvo">${opcoes}</select>
      </div>`,
    ok: { callback: (_evento, botao) => botao.form.elements.alvo.value },
    rejectClose: false,
  });
  return uuid ? fromUuid(uuid) : null;
}
