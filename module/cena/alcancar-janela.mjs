/**
 * Alcançar seguro em duas ações (livro: "duas ações em sequência"): a 1ª passou, o
 * personagem fica marcado (`flags.alcancar`) e a 2ª vem na PRÓXIMA ação dele — o
 * próximo turno no combate, a próxima rodada na investigação. Uma janela flutuante,
 * para o jogador e para o mestre, aparece logo depois da 1ª e volta quando chega a
 * vez dele: a mensagem do chat já teria subido muito para alguém achar o botão.
 */
import { SYSTEM_ID } from "../config.mjs";
import { etapaDoAlcancarSeguro } from "./desafios.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const FLAG = "alcancar";
const L = (k, d) => (d ? game.i18n.format(`OP2.Desafio.AlcancarJanela.${k}`, d) : game.i18n.localize(`OP2.Desafio.AlcancarJanela.${k}`));

export const pendenteDe = (ator) => ator?.getFlag?.(SYSTEM_ID, FLAG) ?? null;

async function etapaAgora(ator) {
  const { chaveDaRodada } = await import("./poderes.mjs");
  return etapaDoAlcancarSeguro(pendenteDe(ator), chaveDaRodada());
}

class AlcancarApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-alcancar-janela"],
    window: { title: "OP2.Desafio.AlcancarJanela.Titulo", icon: "fa-solid fa-person-walking", resizable: false },
    position: { width: 360, height: "auto", top: 140, left: 120 },
    actions: { segunda: AlcancarApp.#segunda, desistir: AlcancarApp.#desistir },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/cena/alcancar.hbs` } };

  constructor(atorId) {
    super({ id: `op2-alcancar-${atorId}` });
    this.atorId = atorId;
  }

  get ator() { return game.actors.get(this.atorId); }

  get title() { return `${game.i18n.localize("OP2.Desafio.AlcancarJanela.Titulo")} — ${this.ator?.name ?? ""}`; }

  async _prepareContext() {
    const ator = this.ator;
    const p = pendenteDe(ator);
    const etapa = await etapaAgora(ator);
    return {
      img: ator?.img, nome: ator?.name ?? "?",
      desafio: p?.desafioNome ?? "",
      dt: p?.dt ?? 7,
      primeira: p?.primeira ?? null,
      aguardando: etapa === "aguardando",
      podeAgir: Boolean(ator?.isOwner),
      ehGM: game.user.isGM,
    };
  }

  static async #segunda() {
    const ator = this.ator;
    if (!ator?.isOwner) return;
    // Mesmo turno: só o mestre adianta (julgamento de mesa).
    if ((await etapaAgora(ator)) === "aguardando" && !game.user.isGM) return void ui.notifications.warn(L("Aguarde"));
    const { segundaAcaoDoAlcancar } = await import("./acoes-desafio.mjs");
    await segundaAcaoDoAlcancar(ator);
  }

  static async #desistir() {
    const ator = this.ator;
    if (!ator?.isOwner) return;
    const ok = await DialogV2.confirm({ window: { title: L("Desistir") }, content: `<p>${L("DesistirPergunta")}</p>`, rejectClose: false });
    if (!ok) return;
    await ator.unsetFlag(SYSTEM_ID, FLAG);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: ator }),
      content: `<div class="op2 op2-card"><p class="op2-card__texto">${foundry.utils.escapeHTML(L("Desistiu", { nome: ator.name }))}</p></div>`,
    });
  }
}

const janelas = new Map();

/** Abre (ou atualiza) a janela no cliente de quem controla o personagem — o mestre incluso. */
export function abrirJanelaAlcancar(ator) {
  if (!ator?.isOwner || !pendenteDe(ator)) return;
  let app = janelas.get(ator.id);
  if (!app) {
    app = new AlcancarApp(ator.id);
    janelas.set(ator.id, app);
  }
  void app.render({ force: true });
}

function fecharJanelaAlcancar(atorId) {
  const app = janelas.get(atorId);
  if (app?.rendered) void app.close();
}

/** A vez dele chegou (turno do combate, rodada nova): a janela volta, já liberando a 2ª. */
function chegouAVez(atores) {
  for (const ator of atores) if (pendenteDe(ator)) abrirJanelaAlcancar(ator);
}

export function registrarJanelaAlcancar() {
  Hooks.on("updateActor", (ator, mudancas) => {
    // A marca acabou (2ª ação feita, desistiu): a janela fecha. Apareceu: abre.
    if (!pendenteDe(ator)) fecharJanelaAlcancar(ator.id);
    else if (foundry.utils.hasProperty(mudancas, `flags.${SYSTEM_ID}.${FLAG}`)) abrirJanelaAlcancar(ator);
    // Rodada nova da investigação: todo mundo com a 1ª ação feita pode fazer a 2ª.
    if (ator.type === "investigacao" && foundry.utils.hasProperty(mudancas, "system.rodada")) {
      chegouAVez(game.actors.filter((a) => a.type === "personagem"));
    }
  });
  // Combate: a vez de quem está marcado.
  Hooks.on("updateCombat", (combate, mudancas) => {
    if (!("turn" in mudancas || "round" in mudancas)) return;
    const ator = combate.combatant?.actor;
    if (ator) chegouAVez([ator]);
  });
  Hooks.once("ready", () => chegouAVez(game.actors.filter((a) => a.type === "personagem")));
}
