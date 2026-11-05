/**
 * Vinheta de loucura: com os PD abaixo da metade, a borda da tela escurece em
 * violeta, rachaduras aparecem e a imagem "falha" de leve. Quanto menos PD, mais
 * forte. Mostra o personagem do jogador (ou o token que ele controla).
 *
 * Também vincula os tokens de personagem à ficha (actorLink). Token desvinculado
 * guarda PV/PD próprios: mexer na barra do token não mudava a ficha, e módulos que
 * escutam a ficha (aeris-damage-vignette) não reagiam.
 */
import { SYSTEM_ID } from "../config.mjs";

/** 0 com metade dos PD ou mais; 1 com zero. */
export function nivelDeLoucura(pd) {
  if (!pd?.max) return 0;
  const razao = Math.max(0, pd.value) / pd.max;
  return razao >= 0.5 ? 0 : Math.min(1, (0.5 - razao) / 0.5);
}

function atorAlvo() {
  const controlado = canvas?.tokens?.controlled?.find((t) => t.actor?.type === "personagem" && t.actor.isOwner)?.actor;
  if (controlado) return controlado;
  const meu = game.user.character;
  return !game.user.isGM && meu?.type === "personagem" ? meu : null;
}

const RACHADURAS = `<svg class="op2-loucura__rachas" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="0.25" stroke-linecap="round">
    <path class="r1" d="M0 8 L9 12 L13 7 L21 15 L27 13 M9 12 L7 21 L14 27 M13 7 L16 0"/>
    <path class="r2" d="M100 14 L92 17 L88 11 L80 19 L74 16 M92 17 L95 26 L89 31 M88 11 L85 0"/>
    <path class="r3" d="M0 88 L8 84 L12 91 L20 83 L27 86 M8 84 L6 76 L13 70 M12 91 L15 100"/>
    <path class="r4" d="M100 91 L91 86 L87 93 L79 84 L71 88 M91 86 L94 77 L88 71 M87 93 L84 100"/>
  </g></svg>`;

function elemento() {
  let el = document.getElementById("op2-vinheta-loucura");
  if (el) return el;
  el = document.createElement("div");
  el.id = "op2-vinheta-loucura";
  el.className = "op2-loucura";
  el.innerHTML = `<span class="op2-loucura__borda"></span><span class="op2-loucura__fantasma"></span>${RACHADURAS}`;
  const board = document.getElementById("board");
  if (board) board.after(el);
  else document.body.prepend(el);
  return el;
}

function atualizar() {
  let nivel = 0;
  try {
    if (game.settings.get(SYSTEM_ID, "vinhetaLoucura")) nivel = nivelDeLoucura(atorAlvo()?.system?.recursos?.pd);
  } catch { /* antes do ready */ }
  const el = nivel > 0 ? elemento() : document.getElementById("op2-vinheta-loucura");
  if (!el) return;
  el.style.setProperty("--op2-loucura", nivel.toFixed(3));
  el.classList.toggle("ativa", nivel > 0);
  el.classList.toggle("op2-loucura--forte", nivel >= 0.6);
}

/** Uma vez por mundo: liga ficha e token dos personagens. */
async function vincularTokens() {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get(SYSTEM_ID, "tokensVinculados")) return;
  let n = 0;
  for (const ator of game.actors.filter((a) => a.type === "personagem" && !a.prototypeToken.actorLink)) {
    await ator.update({ "prototypeToken.actorLink": true });
    n++;
  }
  for (const cena of game.scenes) {
    const mudancas = cena.tokens
      .filter((t) => !t.actorLink && game.actors.get(t.actorId)?.type === "personagem")
      .map((t) => ({ _id: t.id, actorLink: true }));
    if (mudancas.length) await cena.updateEmbeddedDocuments("Token", mudancas);
    n += mudancas.length;
  }
  await game.settings.set(SYSTEM_ID, "tokensVinculados", true);
  if (n) ui.notifications.info(game.i18n.format("OP2.Loucura.Vinculados", { n }));
}

export function registrarVinhetaLoucura() {
  game.settings.register(SYSTEM_ID, "vinhetaLoucura", {
    name: "OP2.Loucura.Nome", hint: "OP2.Loucura.Dica",
    scope: "client", config: true, type: Boolean, default: true, onChange: atualizar,
  });
  game.settings.register(SYSTEM_ID, "tokensVinculados", { scope: "world", config: false, type: Boolean, default: false });

  // Personagem novo já nasce com o token ligado à ficha.
  Hooks.on("preCreateActor", (ator, dados) => {
    if (ator.type === "personagem" && dados.prototypeToken?.actorLink === undefined) {
      ator.updateSource({ "prototypeToken.actorLink": true });
    }
  });

  Hooks.once("ready", () => {
    atualizar();
    void vincularTokens();
  });
  Hooks.on("controlToken", () => setTimeout(atualizar, 0));
  Hooks.on("updateActor", (ator, mudancas) => {
    if (foundry.utils.hasProperty(mudancas, "system.recursos.pd") && ator.id === atorAlvo()?.id) atualizar();
  });
  Hooks.on("updateUser", (usuario) => { if (usuario.id === game.user.id) atualizar(); });
}
