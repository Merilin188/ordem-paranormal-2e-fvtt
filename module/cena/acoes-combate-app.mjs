/**
 * Ações de combate na ficha: o jogador lê cada ação (o mesmo texto do guia de
 * combate) e executa. Executar declara no chat o que o personagem faz e dispara o
 * que depende da ação: Agredir abre o ataque; Defender-se dá o marcador da Leitura
 * de Combate; Fintar e as manobras rolam o teste oposto; cair e levantar mexem na
 * condição Caído.
 */
import { SYSTEM_ID } from "../config.mjs";
import { GUIA } from "../ui/guia-combate.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";

const { ApplicationV2 } = foundry.applications.api;
const L = (chave, dados) => (dados ? game.i18n.format(`OP2.AcoesCombate.${chave}`, dados) : game.i18n.localize(`OP2.AcoesCombate.${chave}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

/** Seções do guia que viram ações, e o que cada título faz (sem entrada = só declarar). */
const SECOES = ["Ações gerais", "Ataques", "Manobras (substituem um ataque corpo a corpo)"];
const SO_LEITURA = new Set(["Teste de ataque", "Atirando em corpo a corpo", "Ataques opostos", "Dano", "Como funciona"]);
const MANOBRAS = new Set(["Agarrar", "Derrubar", "Desarmar", "Empurrar", "Quebrar"]);

/**
 * Ações com teste oposto: a perícia de quem age e as que o alvo pode usar para
 * resistir (spec §8.1: manobra é ataque oposto à Acrobacia ou Luta do alvo).
 */
export const OPOSTAS = {
  Fintar: { pericia: "enganacao", defesas: ["intuicao"] },
  // "Uma perícia coerente": quem atrapalha escolhe.
  Atrapalhar: { pericia: null, defesas: ["percepcao"] },
  ...Object.fromEntries([...MANOBRAS].map((m) => [m, { pericia: "luta", defesas: ["acrobacia", "luta"] }])),
};
/** Ações que pedem alvo (as opostas e Mirar). */
export const COM_ALVO = new Set(["Mirar", ...Object.keys(OPOSTAS)]);

/**
 * Desfecho do teste oposto da ação: quem age precisa vencer (empate não gera efeito);
 * vencer por 5 ou mais libera o efeito maior das manobras.
 */
export function desfechoOposto(totalAcao, totalDefesa) {
  const margem = totalAcao - totalDefesa;
  return { venceu: margem > 0, empate: margem === 0, margem, forte: margem >= 5 };
}

/** Lista das ações executáveis e de referência, por seção (pura, para teste). */
export function acoesDeCombate(guia = GUIA) {
  return guia.filter((s) => SECOES.includes(s.secao)).map((s) => ({
    secao: s.secao,
    itens: s.itens.map(([titulo, texto]) => ({ titulo, texto, executavel: !SO_LEITURA.has(titulo) })),
  }));
}

const forte = (t) => `<strong>${esc(t)}</strong>`;

async function declarar(ator, titulo, texto, alvo = null, nota = "") {
  const frase = alvo
    ? L(titulo === "Mirar" ? "DeclaraMirar" : "DeclaraAlvo", { nome: forte(ator.name), acao: forte(titulo), alvo: forte(alvo.name) })
    : L("Declara", { nome: forte(ator.name), acao: forte(titulo) });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-acao-combate-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena"><i class="fa-solid fa-swords"></i> ${esc(L("Rotulo"))}</span></header>
      <p class="op2-card__texto">${frase}</p>
      ${nota ? `<p class="op2-prontidao-nota">${esc(nota)}</p>` : ""}
      <p class="op2-acao-combate-card__regra">${esc(texto)}</p></div>`,
    flags: { [SYSTEM_ID]: { tipo: "acao-combate", atorId: ator.id, acao: titulo, alvoId: alvo?.id ?? null } },
  });
}

/**
 * Ação oposta: quem age rola, e o card espera o alvo resistir — um botão por perícia
 * de defesa, para o dono do alvo (o mestre, no caso de NPC e criatura).
 */
async function acaoOposta(ator, titulo, texto, alvo) {
  const { defesas } = OPOSTAS[titulo];
  let { pericia } = OPOSTAS[titulo];
  const { rolarTeste, rotuloDePericia } = await import("../dice/teste.mjs");
  if (!pericia) {
    const { escolherPericiaSimples } = await import("../ui/ferramentas-testes.mjs");
    pericia = await escolherPericiaSimples(ator, L("QualPericia", { acao: titulo }));
    if (!pericia) return null;
  }
  const roll = await rolarTeste(ator, {
    chavePericia: pericia, oposto: true, contexto: L("ContraAlvo", { acao: titulo, alvo: alvo.name }),
  });
  if (!roll) return null;
  const nomes = defesas.map((d) => rotuloDePericia(d));
  const botoes = defesas.map((d, i) => `<button type="button" class="op2-botao op2-botao--pequeno" data-op2-acao="resistir-acao"
      data-ator-id="${alvo.id}" data-ator-uuid="${alvo.uuid}" data-agente-id="${ator.id}" data-acao="${esc(titulo)}" data-pericia="${d}"
      data-total="${roll.total}" data-ra="${roll.ra}" data-rb="${roll.rb}">${esc(L("Resistir", { pericia: nomes[i] }))}</button>`).join("");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-acao-combate-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena"><i class="fa-solid fa-swords"></i> ${esc(titulo)}</span>
        <span class="op2-card__dt">${roll.total}</span></header>
      <p class="op2-card__texto">${L("Oposto", {
        nome: forte(ator.name), acao: forte(titulo), alvo: forte(alvo.name),
        pericia: esc(rotuloDePericia(pericia)), total: roll.total, defesas: esc(nomes.join(L("Ou"))),
      })}</p>
      <p class="op2-acao-combate-card__regra">${esc(texto)}</p>
      <div class="op2-card__acoes">${botoes}</div></div>`,
    flags: { [SYSTEM_ID]: { tipo: "acao-oposta", atorId: ator.id, acao: titulo, alvoId: alvo.id } },
  });
  return roll;
}

/** Texto do efeito de cada ação quando quem age vence (e o extra por 5 ou mais). */
function efeitoDaAcao(titulo, { nome, alvo, rb, forte: porCinco }) {
  const base = L(`Efeito.${titulo}`, { nome, alvo });
  const chaveForte = `OP2.AcoesCombate.EfeitoForte.${titulo}`;
  const extra = porCinco && game.i18n.has(chaveForte) ? ` ${game.i18n.format(chaveForte, { nome, alvo, rb })}` : "";
  return base + extra;
}

/** O alvo resiste: rola a perícia escolhida, compara e publica o desfecho. */
async function resistirAcao(defensor, dataset) {
  if (!game.user.isGM && !defensor.isOwner) return void ui.notifications.warn(game.i18n.localize("OP2.Aviso.SemPermissao"));
  const mensagem = game.messages.get(dataset.mensagemId);
  if (mensagem?.getFlag(SYSTEM_ID, "respondido")) return void ui.notifications.warn(L("JaRespondido"));
  const agente = game.actors.get(dataset.agenteId);
  if (!agente) return null;
  const titulo = dataset.acao;
  const { rolarTeste } = await import("../dice/teste.mjs");
  const roll = await rolarTeste(defensor, {
    chavePericia: dataset.pericia, oposto: true, contexto: L("ResisteA", { acao: titulo, nome: agente.name }),
  });
  if (!roll) return null;
  const { marcarAtaqueRespondido } = await import("./guardia.mjs");
  await marcarAtaqueRespondido(dataset.mensagemId);

  const totalAcao = Number(dataset.total);
  const rb = Number(dataset.rb) || 0;
  const d = desfechoOposto(totalAcao, roll.total);
  const placar = `${totalAcao} × ${roll.total}`;
  const texto = d.empate
    ? L("Empatou", { acao: titulo, placar })
    : d.venceu
      ? L("Venceu", { nome: agente.name, acao: titulo, alvo: defensor.name, placar })
      : L("Resistiu", { nome: agente.name, acao: titulo, alvo: defensor.name, placar });
  const efeito = d.venceu ? efeitoDaAcao(titulo, { nome: agente.name, alvo: defensor.name, rb, forte: d.forte }) : "";
  // Atrapalhar vencido: a redução já entra nos testes do alvo até o fim da rodada.
  if (d.venceu && titulo === "Atrapalhar") {
    const { reduzirNaRodada } = await import("./reducoes.mjs");
    await reduzirNaRodada(defensor, { motivo: L("MotivoAtrapalhar", { nome: agente.name }) });
  }
  // Derrubar vencido: Caído num clique; por 5+, junto com o dano de impacto (RB).
  const danoDerrubar = d.forte ? rb : 0;
  const dano = d.venceu && titulo === "Derrubar"
    ? `<div class="op2-card__acoes"><button type="button" class="op2-botao op2-botao--pequeno op2-botao--perigo" data-op2-acao="derrubar-aplicar"
        data-ator-id="${defensor.id}" data-ator-uuid="${defensor.uuid}" data-quantidade="${danoDerrubar}">${esc(danoDerrubar
          ? L("AplicarDanoCaido", { dano: danoDerrubar, alvo: defensor.name })
          : L("AplicarCaido", { alvo: defensor.name }))}</button></div>`
    : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: defensor }),
    content: `<div class="op2 op2-card op2-acao-combate-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena"><i class="fa-solid fa-swords"></i> ${esc(L("Resultado", { acao: titulo }))}</span></header>
      <p class="op2-card__texto">${esc(texto)}</p>
      ${efeito ? `<p class="op2-prontidao-nota">${esc(efeito)}</p>` : ""}${dano}</div>`,
    flags: { [SYSTEM_ID]: { tipo: "acao-oposta-resultado", atorId: defensor.id } },
  });
  return { roll, ...d };
}

/** Derrubar: o alvo fica Caído (e sofre o dano de impacto, se venceu por 5 ou mais). */
async function derrubarAplicar(ator, dataset) {
  const quantidade = Number(dataset.quantidade) || 0;
  if (!game.user.isGM && !ator.isOwner) return void ui.notifications.warn(game.i18n.localize("OP2.Aviso.SemPermissao"));
  if (quantidade > 0) {
    const { aplicarDano } = await import("../dice/falha-critica.mjs");
    await aplicarDano(ator, quantidade, "pv");
  }
  const { definirCondicao } = await import("./ferimentos.mjs");
  await definirCondicao(ator, "caido", true);
  ui.notifications.info(L("CaidoAplicado", { alvo: ator.name }));
}

/** Erguer-se: ação padrão (não age mais no turno) ou livre (−1 passo nos testes da rodada). */
async function comoSeErgue(ator) {
  return foundry.applications.api.DialogV2.wait({
    window: { title: `${L("ErguerTitulo")} — ${ator.name}`, icon: "fa-solid fa-person-arrow-up-from-line" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: `<p>${esc(L("ErguerPergunta"))}</p>`,
    buttons: [
      { action: "padrao", label: L("ErguerPadrao"), icon: "fa-solid fa-hourglass-end", default: true },
      { action: "livre", label: L("ErguerLivre"), icon: "fa-solid fa-bolt" },
    ],
    rejectClose: false,
  });
}

export function registrarAcoesCombate() {
  registrarAcaoDeChat("resistir-acao", resistirAcao);
  registrarAcaoDeChat("derrubar-aplicar", derrubarAplicar);
}

/** Executa a ação: declara e roda a automação dela. */
export async function executarAcaoDeCombate(ator, titulo, texto) {
  if (titulo === "Agredir") {
    const { atacar } = await import("./acoes-combate.mjs");
    return atacar(ator);
  }
  if (COM_ALVO.has(titulo)) {
    const { escolherAlvo } = await import("./acoes-combate.mjs");
    const alvo = await escolherAlvo(ator, titulo);
    if (!alvo) return null;
    if (OPOSTAS[titulo]) return acaoOposta(ator, titulo, texto, alvo);
    return declarar(ator, titulo, texto, alvo);
  }
  if (titulo === "Erguer-se") {
    const modo = await comoSeErgue(ator);
    if (!modo) return null;
    await declarar(ator, titulo, texto, null, L(modo === "livre" ? "ErguerNotaLivre" : "ErguerNotaPadrao", { nome: ator.name }));
    if (modo === "livre") {
      const { reduzirNaRodada } = await import("./reducoes.mjs");
      await reduzirNaRodada(ator, { motivo: L("MotivoErguer") });
    }
    return ator.toggleStatusEffect("caido", { active: false });
  }
  await declarar(ator, titulo, texto);
  if (titulo === "Defender-se") {
    // Vale para um ataque desta rodada: o Esquivar do card consome a declaração.
    // Fica Defendendo-se até usar num ataque (a janela pergunta antes da rolagem) ou
    // até a próxima rodada.
    const { leituraDeCombate } = await import("./poderes.mjs");
    await ator.toggleStatusEffect("defendendo", { active: true });
    return leituraDeCombate(ator);
  }
  if (titulo === "Jogar-se no chão (livre)") return ator.toggleStatusEffect("caido", { active: true });
  return null;
}

class AcoesCombateApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-guia", "op2-acoes-combate"],
    window: { icon: "fa-solid fa-swords", resizable: true },
    position: { width: 520, height: 640 },
  };

  constructor(ator, opcoes = {}) {
    super({ id: `op2-acoes-combate-${ator.id}`, ...opcoes });
    this.ator = ator;
  }

  get title() {
    return `${L("Titulo")}: ${this.ator.name}`;
  }

  async _renderHTML() {
    const secoes = acoesDeCombate().map((s) => `<section class="op2-guia__secao"><h3>${esc(s.secao)}</h3>${s.itens.map((a) => `
      <details class="op2-guia__item op2-acoes-combate__item">
        <summary><span>${esc(a.titulo)}</span>${a.executavel
          ? `<button type="button" class="op2-botao op2-botao--pequeno" data-executar="${esc(a.titulo)}"><i class="fa-solid fa-play"></i> ${esc(L("Executar"))}</button>`
          : ""}</summary>
        <p>${esc(a.texto)}</p>
      </details>`).join("")}</section>`).join("");
    const div = document.createElement("div");
    div.className = "op2-guia__corpo";
    div.innerHTML = `<p class="op2-ajuda">${esc(L("Ajuda"))}</p>${secoes}`;
    return div;
  }

  _replaceHTML(resultado, conteudo) {
    conteudo.replaceChildren(resultado);
    const textos = new Map(acoesDeCombate().flatMap((s) => s.itens.map((a) => [a.titulo, a.texto])));
    for (const botao of conteudo.querySelectorAll("[data-executar]")) {
      botao.addEventListener("click", async (evento) => {
        evento.preventDefault();
        evento.stopPropagation();
        const titulo = botao.dataset.executar;
        botao.disabled = true;
        try {
          await executarAcaoDeCombate(this.ator, titulo, textos.get(titulo));
        } finally {
          botao.disabled = false;
        }
      });
    }
  }
}

export function abrirAcoesCombate(ator) {
  if (!ator) return;
  const existente = foundry.applications.instances.get(`op2-acoes-combate-${ator.id}`);
  if (existente) return void existente.bringToFront();
  new AcoesCombateApp(ator).render({ force: true });
}
