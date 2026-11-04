/**
 * Dado de pavor.
 *
 * Enquanto o personagem tem um dado de pavor, ele rola junto em TODO teste; os dados
 * do teste que tirarem MENOS que o dado de pavor são consumidos (não contam). O
 * card do teste mostra o dado de pavor e os consumidos com animação
 * (`OP2Roll.aplicarPavor`). O mestre aplica e remove por uma janela própria; o
 * trauma "Pânico" aplica sozinho.
 */
import { SYSTEM_ID, ESCADA } from "../config.mjs";
import { definirCondicao } from "./ferimentos.mjs";

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
