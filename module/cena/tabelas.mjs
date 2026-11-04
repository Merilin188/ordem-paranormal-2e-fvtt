/**
 * Tabelas compartilhadas (Lesões, Traumas, Falha crítica).
 *
 * Quem clica no card abre a tabela para TODOS (socket). Só quem controla o
 * personagem (ou o mestre) pode rolar; a rolagem aparece para todos (Dice So Nice
 * sincronizado) e a linha sorteada acende em todas as telas. O efeito é aplicado
 * automaticamente e um card resume o resultado no chat.
 */
import { SYSTEM_ID } from "../config.mjs";
import { TABELAS, linhaDaTabela, rotuloDaFaixa, marcaRepetida, descreverMarca } from "./tabelas-dados.mjs";
import { paraTodos, registrarAcaoDeTodos } from "../ui/socket.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";
import { definirCondicao } from "./ferimentos.mjs";
import { mostrarDados3D } from "../dice/teste.mjs";
import { cartaoFalhaCritica } from "../dice/falha-critica.mjs";
import { receberPavor } from "./pavor.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

class TabelaApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-tabela-app"],
    window: { icon: "fa-solid fa-table-list", resizable: true },
    position: { width: 560, height: "auto" },
    actions: { rolar: TabelaApp.#rolar },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/cena/tabela.hbs`, scrollable: [".op2-tabela__linhas"] } };

  constructor({ tabela, atorId }) {
    super({ id: `op2-tabela-${tabela}-${atorId}` });
    this.tabela = tabela;
    this.atorId = atorId;
    this.resultado = null;
    this.repetida = false;
    this.rolando = false;
  }

  get title() {
    return game.i18n.format("OP2.Tabela.Titulo", { tabela: TABELAS[this.tabela]?.titulo ?? "" });
  }

  get ator() {
    return game.actors.get(this.atorId);
  }

  podeRolar() {
    return Boolean(this.ator?.isOwner);
  }

  async _prepareContext() {
    const def = TABELAS[this.tabela];
    const ator = this.ator;
    const linhaSorteada = this.resultado !== null ? linhaDaTabela(this.tabela, this.resultado) : null;
    return {
      ator: ator ? { nome: ator.name, img: ator.img } : null,
      formula: def.formula,
      resultado: this.resultado,
      repetida: this.repetida,
      rolando: this.rolando,
      podeRolar: this.podeRolar() && !this.rolando && (this.resultado === null || this.repetida),
      aguardando: !this.podeRolar() && this.resultado === null,
      linhas: def.linhas.map((l) => ({
        faixa: rotuloDaFaixa(l), nome: l.nome, texto: l.texto, sorteada: l === linhaSorteada,
      })),
    };
  }

  /** O resultado chegou (desta tela ou de outra): acende a linha. */
  mostrarResultado(resultado, repetida) {
    this.resultado = resultado;
    this.repetida = repetida;
    this.rolando = false;
    this.render({ force: true });
  }

  static async #rolar() {
    if (!this.podeRolar() || this.rolando) return;
    this.rolando = true;
    this.render();
    paraTodos("op2TabelaRolando", { tabela: this.tabela, atorId: this.atorId });
    // O dado gira em 3D para todos; só quando ele para a linha acende (em todas as telas).
    const roll = await new Roll(TABELAS[this.tabela].formula).evaluate();
    await mostrarDados3D(roll);
    const resultado = roll.total;
    const linha = linhaDaTabela(this.tabela, resultado);
    const ator = this.ator;
    const marcas = this.tabela === "lesoes" ? ator.system.lesoes : ator.system.traumas;
    const repetida = TABELAS[this.tabela].rerrolaRepetida && marcaRepetida(this.tabela, linha, marcas);

    paraTodos("op2TabelaResultado", { tabela: this.tabela, atorId: this.atorId, resultado, repetida });
    this.mostrarResultado(resultado, repetida);
    await publicarResultado(ator, this.tabela, resultado, linha, repetida);
    if (!repetida) await aplicarLinha(ator, this.tabela, linha, resultado);
  }
}

/* -------- efeitos -------- */

async function somarRecurso(ator, recurso, n) {
  const r = ator.system.recursos[recurso];
  await ator.update({ [`system.recursos.${recurso}.value`]: Math.max(0, Math.min(r.max, r.value + n)) });
}

async function aplicarLinha(ator, tabela, linha, resultado) {
  if (tabela === "falhaCritica") {
    await cartaoFalhaCritica(ator, resultado);
    return;
  }
  switch (linha.efeito) {
    case "morte":
      await definirCondicao(ator, "morto", true);
      break;
    case "morteLenta":
      await somarRecurso(ator, "pv", 1);
      await definirCondicao(ator, "inconsciente", false);
      break;
    case "marca": {
      const campo = tabela === "lesoes" ? "lesoes" : "traumas";
      await ator.update({ [`system.${campo}`]: [...ator.system[campo], { chave: linha.chave }] });
      break;
    }
    case "reducao": {
      const caminho = `system.estado.reducoesTemporarias.${linha.alvo}`;
      await ator.update({ [caminho]: (foundry.utils.getProperty(ator, caminho) ?? 0) + 1 });
      break;
    }
    case "pv":
    case "pd":
      await somarRecurso(ator, linha.efeito, linha.quantidade ?? 1);
      break;
    case "pavor":
      await receberPavor(ator);
      break;
    case "narrativo":
      if (linha.chave === "estupor") await definirCondicao(ator, "atordoado", true);
      break;
    default:
      break;
  }
  // Rolou na tabela de lesão e sobreviveu: sai de Moribundo.
  if (tabela === "lesoes" && linha.efeito !== "morte" && ator.statuses?.has("moribundo")) {
    await definirCondicao(ator, "moribundo", false);
  }
}

async function publicarResultado(ator, tabela, resultado, linha, repetida) {
  if (tabela === "falhaCritica") return; // o card da falha crítica é o de sempre
  const texto = repetida
    ? game.i18n.localize("OP2.Tabela.Repetida")
    : esc(linha.texto);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-card--falha op2-tabela-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena">${esc(TABELAS[tabela].titulo)}</span>
      <span class="op2-card__dt">${TABELAS[tabela].formula}: <strong>${resultado}</strong></span></header>
      <p class="op2-tabela-card__nome">${esc(linha.nome)}</p>
      <p class="op2-card__texto">${texto}</p>
    </div>`,
    flags: { [SYSTEM_ID]: { tipo: "tabela", atorId: ator.id } },
  });
}

/* -------- abrir para todos -------- */

const abertas = new Map();

function abrirLocal({ tabela, atorId }) {
  const chave = `${tabela}.${atorId}`;
  let app = abertas.get(chave);
  if (!app) {
    app = new TabelaApp({ tabela, atorId });
    abertas.set(chave, app);
  }
  app.resultado = null;
  app.repetida = false;
  app.rolando = false;
  app.render({ force: true });
  return app;
}

/** Abre a tabela em todas as telas. */
export function abrirTabelaParaTodos(tabela, atorId) {
  if (!TABELAS[tabela]) return;
  paraTodos("op2TabelaAbrir", { tabela, atorId });
  abrirLocal({ tabela, atorId });
}

/** Mesma janela só para consulta, sem abrir para os outros. */
export function consultarTabela(tabela, atorId) {
  return abrirLocal({ tabela, atorId });
}

export function registrarTabelas() {
  registrarAcaoDeTodos("op2TabelaAbrir", abrirLocal);
  registrarAcaoDeTodos("op2TabelaRolando", ({ tabela, atorId }) => {
    const app = abertas.get(`${tabela}.${atorId}`) ?? abrirLocal({ tabela, atorId });
    app.rolando = true;
    app.render({ force: true });
  });
  registrarAcaoDeTodos("op2TabelaResultado", ({ tabela, atorId, resultado, repetida }) => {
    const app = abertas.get(`${tabela}.${atorId}`) ?? abrirLocal({ tabela, atorId });
    app.mostrarResultado(resultado, repetida);
  });
  registrarAcaoDeChat("abrir-tabela", (ator, dataset) => {
    if (!ator.isOwner && !game.user.isGM) return void ui.notifications.warn(game.i18n.localize("OP2.Ferramentas.SemPermissao"));
    abrirTabelaParaTodos(dataset.tabela, ator.id);
  });
  // "Rolar efeito (1d8)" da falha crítica abre a tabela para todos.
  registrarAcaoDeChat("rolar-falha-critica", (ator) => {
    if (!ator.isOwner && !game.user.isGM) return void ui.notifications.warn(game.i18n.localize("OP2.Ferramentas.SemPermissao"));
    abrirTabelaParaTodos("falhaCritica", ator.id);
  });
}

export { descreverMarca };
