/**
 * Ações de combate na ficha: o jogador lê cada ação (o mesmo texto do guia de
 * combate) e executa. Executar declara no chat o que o personagem faz e dispara o
 * que depende da ação: Agredir abre o ataque; Defender-se dá o marcador da Leitura
 * de Combate; Fintar e as manobras rolam o teste oposto; cair e levantar mexem na
 * condição Caído.
 */
import { SYSTEM_ID } from "../config.mjs";
import { GUIA } from "../ui/guia-combate.mjs";

const { ApplicationV2 } = foundry.applications.api;
const L = (chave, dados) => (dados ? game.i18n.format(`OP2.AcoesCombate.${chave}`, dados) : game.i18n.localize(`OP2.AcoesCombate.${chave}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

/** Seções do guia que viram ações, e o que cada título faz (sem entrada = só declarar). */
const SECOES = ["Ações gerais", "Ataques", "Manobras (substituem um ataque corpo a corpo)"];
const SO_LEITURA = new Set(["Teste de ataque", "Atirando em corpo a corpo", "Ataques opostos", "Dano", "Como funciona"]);
const MANOBRAS = new Set(["Agarrar", "Derrubar", "Desarmar", "Empurrar", "Quebrar"]);

/** Lista das ações executáveis e de referência, por seção (pura, para teste). */
export function acoesDeCombate(guia = GUIA) {
  return guia.filter((s) => SECOES.includes(s.secao)).map((s) => ({
    secao: s.secao,
    itens: s.itens.map(([titulo, texto]) => ({ titulo, texto, executavel: !SO_LEITURA.has(titulo) })),
  }));
}

async function declarar(ator, titulo, texto) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-acao-combate-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena"><i class="fa-solid fa-swords"></i> ${esc(L("Rotulo"))}</span></header>
      <p class="op2-card__texto">${L("Declara", { nome: `<strong>${esc(ator.name)}</strong>`, acao: `<strong>${esc(titulo)}</strong>` })}</p>
      <p class="op2-acao-combate-card__regra">${esc(texto)}</p></div>`,
    flags: { [SYSTEM_ID]: { tipo: "acao-combate", atorId: ator.id, acao: titulo } },
  });
}

async function teste(ator, chavePericia, titulo) {
  const { rolarTeste } = await import("../dice/teste.mjs");
  return rolarTeste(ator, { chavePericia, oposto: true, contexto: titulo });
}

/** Executa a ação: declara e roda a automação dela. */
export async function executarAcaoDeCombate(ator, titulo, texto) {
  if (titulo === "Agredir") {
    const { atacar } = await import("./acoes-combate.mjs");
    return atacar(ator);
  }
  await declarar(ator, titulo, texto);
  if (titulo === "Defender-se") {
    // Vale para um ataque desta rodada: o Esquivar do card consome a declaração.
    const { leituraDeCombate, chaveDaRodada } = await import("./poderes.mjs");
    await ator.setFlag(SYSTEM_ID, "defesaRodada", chaveDaRodada());
    return leituraDeCombate(ator);
  }
  if (titulo === "Fintar") return teste(ator, "enganacao", titulo);
  if (MANOBRAS.has(titulo)) return teste(ator, "luta", L("Manobra", { nome: titulo }));
  if (titulo === "Erguer-se") return ator.toggleStatusEffect("caido", { active: false });
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
