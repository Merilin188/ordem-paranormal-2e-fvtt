/**
 * Teste de equilíbrio (travessia de tronco, viga, parapeito…).
 *
 * A cada rodada o personagem rola 2d10 e compara: iguais ou com 1 de diferença,
 * equilibra; senão, começa a cair. Começa a travessia com dados de equilíbrio (d4)
 * iguais à metade da Acrobacia; caindo, pode rolar um deles e somar a um dos d10 à
 * escolha, quantas vezes quiser — os gastos não voltam até o fim da travessia.
 *
 * O estado vive numa flag do ator (o dono escreve sem socket); a janela do mestre e
 * a do jogador mostram o mesmo estado.
 */
import { SYSTEM_ID } from "../config.mjs";
import { equilibrado, dadosDeEquilibrio } from "./tabelas-dados.mjs";
import { paraTodos, registrarAcaoDeTodos } from "../ui/socket.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";
import { mostrarDados3D } from "../dice/teste.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const FLAG = "equilibrio";
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

const estadoDe = (ator) => ator?.getFlag(SYSTEM_ID, FLAG) ?? null;

async function card(ator, texto, classe = "") {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-equilibrio-card ${classe}">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena">${game.i18n.localize("OP2.Equilibrio.Titulo")}</span></header>
      <p class="op2-card__texto">${texto}</p></div>`,
    flags: { [SYSTEM_ID]: { tipo: "equilibrio", atorId: ator.id } },
  });
}

class EquilibrioApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-equilibrio"],
    window: { title: "OP2.Equilibrio.Titulo", icon: "fa-solid fa-person-falling", resizable: true },
    position: { width: 400, height: "auto" },
    actions: {
      rolar: EquilibrioApp.#rolar,
      usarDado: EquilibrioApp.#usarDado,
      somar: EquilibrioApp.#somar,
      encerrar: EquilibrioApp.#encerrar,
    },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/cena/equilibrio.hbs` } };

  constructor(atorId) {
    super({ id: `op2-equilibrio-${atorId}` });
    this.atorId = atorId;
  }

  get ator() { return game.actors.get(this.atorId); }

  async _prepareContext() {
    const ator = this.ator;
    const e = estadoDe(ator);
    const [a, b] = e?.dados ?? [];
    const temDados = e?.dados?.length === 2;
    const ok = temDados && equilibrado(a, b);
    return {
      ator: ator ? { nome: ator.name, img: ator.img } : null,
      ativo: Boolean(e?.ativo),
      podeAgir: Boolean(ator?.isOwner),
      rodada: e?.rodada ?? 0,
      restantes: e?.restantes ?? 0,
      icones: Array.from({ length: e?.restantes ?? 0 }),
      dados: e?.dados ?? [],
      temDados,
      equilibrado: ok,
      caindo: temDados && !ok,
      d4Pendente: e?.d4Pendente ?? null,
      podeUsarDado: temDados && !ok && (e?.restantes ?? 0) > 0 && !e?.d4Pendente,
      historico: [...(e?.historico ?? [])].reverse(),
    };
  }

  static async #rolar() {
    const ator = this.ator;
    const e = estadoDe(ator);
    if (!ator?.isOwner || !e?.ativo) return;
    const roll = await new Roll("2d10").evaluate();
    await mostrarDados3D(roll);
    const dados = roll.dice[0].results.map((r) => r.result);
    const rodada = (e.rodada ?? 0) + 1;
    const ok = equilibrado(...dados);
    const linha = `${game.i18n.localize("OP2.Equilibrio.Rodada")} ${rodada}: ${dados.join(" e ")} — ${game.i18n.localize(ok ? "OP2.Equilibrio.Equilibrou" : "OP2.Equilibrio.Caindo")}`;
    await ator.setFlag(SYSTEM_ID, FLAG, { ...e, rodada, dados, d4Pendente: null, historico: [...(e.historico ?? []), linha] });
    await card(ator, `<strong>${esc(ator.name)}</strong> — ${esc(linha)}`, ok ? "op2-equilibrio-card--ok" : "op2-equilibrio-card--caindo");
  }

  static async #usarDado() {
    const ator = this.ator;
    const e = estadoDe(ator);
    if (!ator?.isOwner || !e?.ativo || e.restantes <= 0 || e.d4Pendente) return;
    const roll = await new Roll("1d4").evaluate();
    await mostrarDados3D(roll);
    await ator.setFlag(SYSTEM_ID, FLAG, { ...e, restantes: e.restantes - 1, d4Pendente: roll.total });
  }

  static async #somar(_evento, alvo) {
    const ator = this.ator;
    const e = estadoDe(ator);
    if (!ator?.isOwner || !e?.d4Pendente) return;
    const i = Number(alvo.dataset.indice);
    const dados = [...e.dados];
    dados[i] += e.d4Pendente;
    const ok = equilibrado(...dados);
    const linha = `+${e.d4Pendente} → ${dados.join(" e ")} — ${game.i18n.localize(ok ? "OP2.Equilibrio.Equilibrou" : "OP2.Equilibrio.Caindo")}`;
    await ator.setFlag(SYSTEM_ID, FLAG, { ...e, dados, d4Pendente: null, historico: [...(e.historico ?? []), linha] });
    await card(ator, `<strong>${esc(ator.name)}</strong> ${game.i18n.localize("OP2.Equilibrio.UsouDado")} ${esc(linha)}`, ok ? "op2-equilibrio-card--ok" : "op2-equilibrio-card--caindo");
  }

  static async #encerrar() {
    const ator = this.ator;
    if (!ator?.isOwner) return;
    await ator.unsetFlag(SYSTEM_ID, FLAG);
    paraTodos("op2EquilibrioFechar", { atorId: ator.id });
    void this.close();
  }
}

const janelas = new Map();
function abrirLocal({ atorId }) {
  let app = janelas.get(atorId);
  if (!app) { app = new EquilibrioApp(atorId); janelas.set(atorId, app); }
  app.render({ force: true });
}

/** Mestre começa a travessia de um personagem: abre a janela para ele e para o mestre. */
export async function iniciarEquilibrio(ator) {
  if (!ator?.isOwner) return;
  const acrobacia = ator.system?.pericias?.acrobacia?.dadoEfetivo ?? "d4";
  const restantes = dadosDeEquilibrio(acrobacia);
  await ator.setFlag(SYSTEM_ID, FLAG, { ativo: true, rodada: 0, restantes, dados: [], d4Pendente: null, historico: [] });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize("OP2.Ferramentas.Mestre") }),
    content: `<div class="op2 op2-card op2-equilibrio-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena">${game.i18n.localize("OP2.Equilibrio.Titulo")}</span></header>
      <p class="op2-card__texto">${game.i18n.format("OP2.Equilibrio.Inicio", { nome: esc(ator.name), n: restantes, dado: acrobacia })}</p>
      <button type="button" data-op2-acao="abrir-equilibrio" data-ator-id="${ator.id}"><i class="fa-solid fa-person-falling"></i> ${game.i18n.localize("OP2.Equilibrio.Abrir")}</button>
    </div>`,
    flags: { [SYSTEM_ID]: { tipo: "equilibrio-inicio", atorId: ator.id } },
  });
  paraTodos("op2EquilibrioAbrir", { atorId: ator.id });
  abrirLocal({ atorId: ator.id });
}

export function registrarEquilibrio() {
  registrarAcaoDeTodos("op2EquilibrioAbrir", ({ atorId }) => {
    if (game.actors.get(atorId)?.isOwner) abrirLocal({ atorId });
  });
  registrarAcaoDeTodos("op2EquilibrioFechar", ({ atorId }) => { void janelas.get(atorId)?.close(); });
  registrarAcaoDeChat("abrir-equilibrio", (ator) => abrirLocal({ atorId: ator.id }));
  Hooks.on("updateActor", (ator) => {
    const app = janelas.get(ator.id);
    if (app?.rendered) app.render();
  });
}
