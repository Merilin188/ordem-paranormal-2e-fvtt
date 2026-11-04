/**
 * Dado de pavor (Outras Regras do playtest).
 *
 * Começa em d6 e sobe um passo se o efeito vier de novo. Rola junto em todo teste,
 * não soma e anula os resultados menores que ele (anulou todos: falha crítica).
 * Tirou 1: o pavor termina. Antes do teste: 1 PD reduz um passo (controlar) ou
 * 5 PD o convertem em dado bônus (abraçar).
 *
 * O card do teste mostra o dado de pavor e os anulados com animação
 * (`OP2Roll.aplicarPavor`). O mestre aplica e remove por uma janela própria; o
 * trauma "Pânico" aplica sozinho.
 */
import { SYSTEM_ID, ESCADA } from "../config.mjs";
import { definirCondicao } from "./ferimentos.mjs";
import { stepDie } from "../dice/escada.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
export const DADO_PAVOR_PADRAO = "d6";
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

async function cardPavor(ator, texto, dado) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-pavor-card${dado ? "" : " op2-pavor-card--fim"}">
      <div class="op2-pavor-card__icone"><i class="fa-solid ${dado ? "fa-ghost" : "fa-sun"}"></i>${dado ? `<span>${esc(dado)}</span>` : ""}</div>
      <div><strong>${esc(game.i18n.localize("OP2.Pavor.Titulo"))}</strong><p>${texto}</p></div>
    </div>`,
    flags: { [SYSTEM_ID]: { tipo: "pavor", atorId: ator.id } },
  });
}

export async function aplicarPavor(ator, dado = DADO_PAVOR_PADRAO) {
  if (!ator || ator.type !== "personagem") return;
  await ator.update({ "system.estado.pavor": dado });
  await definirCondicao(ator, "apavorado", true);
  await cardPavor(ator, game.i18n.format("OP2.Pavor.Aplicado", { nome: esc(ator.name), dado }), dado);
}

/**
 * Recebe o efeito de pavor: começa em d6; se já tinha, o dado aumenta um passo.
 */
export async function receberPavor(ator) {
  const atual = ator?.system?.estado?.pavor;
  await aplicarPavor(ator, atual ? stepDie(atual, 1) : DADO_PAVOR_PADRAO);
}

/** Colorset do Dice So Nice para o dado de pavor (registrado no diceSoNiceReady). */
export const COLORSET_PAVOR = "op2-pavor";

export function registrarAparenciaDoPavor() {
  Hooks.once("diceSoNiceReady", (dice3d) => {
    dice3d.addColorset({
      name: COLORSET_PAVOR,
      description: "Ordem Paranormal — Dado de pavor",
      category: "Ordem Paranormal",
      // Meio-termo: o clima escuro da primeira versão (fogo, metal), com o número
      // em rosa-claro e contorno escuro para continuar legível sem gritar.
      foreground: "#ffc2d1",
      background: ["#12000a", "#1f0010", "#2a0012"],
      outline: "#3d0018",
      edge: "#3d0018",
      texture: "fire",
      material: "metal",
      font: "Georgia",
      fontScale: { d4: 0.9, d6: 0.8, d8: 0.8, d10: 0.75, d12: 0.75, d20: 0.7 },
      visibility: "visible",
    }, "default");
  });
}

/** Faz o dado sair com a aparência sombria no Dice So Nice. */
export function vestirDadoDePavor(roll) {
  for (const termo of roll.dice) {
    termo.options.colorset = COLORSET_PAVOR;
    termo.options.appearance = {
      colorset: COLORSET_PAVOR, foreground: "#ffc2d1", background: "#1f0010", outline: "#3d0018",
      edge: "#3d0018", material: "metal", texture: "fire", font: "Georgia",
      fontScale: { d4: 0.9, d6: 0.8, d8: 0.8, d10: 0.75, d12: 0.75, d20: 0.7 },
    };
  }
  return roll;
}

/**
 * Depois de ver os próprios dados, o jogador precisa rolar o dado de pavor (não dá
 * para pular: fechar a janela também rola).
 */
export async function pedirDadoDePavor(roll, ator, dado) {
  const dados = roll.dados.map((d) => `<span class="op2-pavor-previa__dado">${d.resultado}</span>`).join("");
  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("OP2.Pavor.Titulo"), icon: "fa-solid fa-ghost" },
    classes: ["op2", "op2-pavor-previa"],
    content: `<p>${game.i18n.format("OP2.Pavor.AgoraRole", { nome: esc(ator.name), dado })}</p>
      <div class="op2-pavor-previa__dados">${dados}</div>
      <p class="op2-ajuda">${game.i18n.localize("OP2.Pavor.Lembrete")}</p>`,
    buttons: [{ action: "rolar", label: game.i18n.format("OP2.Pavor.RolarPavor", { dado }), icon: "fa-solid fa-ghost", default: true }],
    rejectClose: false,
  });
}

/** Pergunta, antes do teste, se quer controlar ou abraçar o pavor. null = cancelou. */
export async function escolherUsoDoPavor(ator, dado) {
  const pd = ator.system.recursos?.pd?.value ?? 0;
  const podeControlar = pd >= 1 && dado !== "d4";
  const podeAbracar = pd >= 5;
  const opcao = (acao, icone, titulo, texto, pode, motivo) => `
    <button type="button" class="op2-pavor-opcao" data-escolha="${acao}" ${pode ? "" : "disabled"}>
      <i class="fa-solid ${icone}"></i><strong>${titulo}</strong><span>${pode ? texto : motivo}</span>
    </button>`;
  // Obrigatória: aparece antes de TODO teste de quem tem pavor. Fechar = rolar com o pavor.
  const escolha = await new Promise((resolver) => {
    const dialogo = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("OP2.Pavor.Titulo"), icon: "fa-solid fa-ghost" },
      classes: ["op2", "op2-pavor-escolha"],
      position: { width: 460 },
      content: `<p>${game.i18n.format("OP2.Pavor.Pergunta", { nome: esc(ator.name), dado, pd })}</p>
        <div class="op2-pavor-opcoes">
          ${opcao("normal", "fa-ghost", game.i18n.localize("OP2.Pavor.RolarNormal"), game.i18n.format("OP2.Pavor.RolarNormalTexto", { dado }), true, "")}
          ${opcao("controlar", "fa-hand", game.i18n.localize("OP2.Pavor.ControlarTitulo"), game.i18n.format("OP2.Pavor.ControlarTexto", { dado: stepDie(dado, -1) }), podeControlar, game.i18n.localize(dado === "d4" ? "OP2.Pavor.JaMinimo" : "OP2.Pavor.SemPD1"))}
          ${opcao("abracar", "fa-fire", game.i18n.localize("OP2.Pavor.AbracarTitulo"), game.i18n.localize("OP2.Pavor.AbracarTexto"), podeAbracar, game.i18n.localize("OP2.Pavor.SemPD5"))}
        </div>`,
      buttons: [{ action: "fechar", label: game.i18n.localize("OP2.Pavor.RolarNormal"), default: true }],
      submit: () => resolver("normal"),
    });
    dialogo.addEventListener("close", () => resolver("normal"), { once: true });
    dialogo.render({ force: true }).then(() => {
      for (const b of dialogo.element.querySelectorAll("[data-escolha]")) {
        b.addEventListener("click", () => { resolver(b.dataset.escolha); void dialogo.close(); });
      }
      dialogo.element.querySelector(".form-footer")?.classList.add("op2-oculto");
    });
  });
  return escolha;
}

/** Controlando o pavor: 1 PD, o dado de pavor reduz um passo (mínimo d4). */
export async function controlarPavor(ator) {
  const novo = stepDie(ator.system.estado.pavor, -1);
  await ator.update({
    "system.estado.pavor": novo,
    "system.recursos.pd.value": Math.max(0, ator.system.recursos.pd.value - 1),
  });
  await cardPavor(ator, game.i18n.format("OP2.Pavor.Controlou", { nome: esc(ator.name), dado: novo }), novo);
  return novo;
}

/** Abraçando o pavor: 5 PD, o dado de pavor vira dado bônus deste teste e o pavor acaba. */
export async function abracarPavor(ator) {
  const dado = ator.system.estado.pavor;
  await ator.update({
    "system.estado.pavor": "",
    "system.recursos.pd.value": Math.max(0, ator.system.recursos.pd.value - 5),
  });
  await definirCondicao(ator, "apavorado", false);
  await cardPavor(ator, game.i18n.format("OP2.Pavor.Abracou", { nome: esc(ator.name), dado }), null);
}

/** Vencendo o pavor: o dado de pavor tirou 1. */
export async function vencerPavor(ator) {
  if (!ator?.system?.estado?.pavor) return;
  await ator.update({ "system.estado.pavor": "" });
  await definirCondicao(ator, "apavorado", false);
  await cardPavor(ator, game.i18n.format("OP2.Pavor.Venceu", { nome: esc(ator.name) }), null);
}

export async function removerPavor(ator) {
  if (!ator?.system?.estado?.pavor) return;
  await ator.update({ "system.estado.pavor": "" });
  await definirCondicao(ator, "apavorado", false);
  await cardPavor(ator, game.i18n.format("OP2.Pavor.Removido", { nome: esc(ator.name) }), null);
}

class PavorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-pavor",
    classes: ["op2", "op2-pavor-app"],
    window: { title: "OP2.Pavor.Janela", icon: "fa-solid fa-ghost", resizable: true },
    position: { width: 420, height: "auto" },
    actions: { aplicar: PavorApp.#aplicar, remover: PavorApp.#remover },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/cena/pavor.hbs` } };

  async _prepareContext() {
    return {
      dados: ESCADA,
      personagens: game.actors.filter((a) => a.type === "personagem").map((a) => ({
        id: a.id, nome: a.name, img: a.img, pavor: a.system.estado.pavor,
      })),
    };
  }

  static async #aplicar(_evento, alvo) {
    const id = alvo.dataset.atorId;
    const dado = this.element.querySelector(`select[data-dado-de="${id}"]`)?.value ?? DADO_PAVOR_PADRAO;
    await aplicarPavor(game.actors.get(id), dado);
    this.render();
  }

  static async #remover(_evento, alvo) {
    await removerPavor(game.actors.get(alvo.dataset.atorId));
    this.render();
  }
}

let app = null;
export function abrirPavor() {
  if (!game.user.isGM) return;
  app ??= new PavorApp();
  app.render({ force: true });
}

Hooks.on("updateActor", (ator) => {
  if (ator.type === "personagem" && app?.rendered) app.render();
});
