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

// Veias escuras que crescem da borda: isolinhas de um ruído fractal (orgânico,
// nada de traço desenhado). A máscara radial encolhe conforme os PD caem.
const VEIAS = `<svg class="op2-loucura__veias" width="100%" height="100%" aria-hidden="true">
  <defs>
    <filter id="op2-veias-filtro" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="5" seed="13" result="ruido"/>
      <feColorMatrix in="ruido" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="nivel"/>
      <feComponentTransfer in="nivel" result="linhas">
        <feFuncA type="discrete" tableValues="0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0"/>
      </feComponentTransfer>
      <feGaussianBlur in="linhas" stdDeviation="0.7" result="suave"/>
      <feFlood flood-color="#0c0216"/>
      <feComposite in2="suave" operator="in"/>
    </filter>
    <radialGradient id="op2-veias-gradiente" cx="50%" cy="50%" r="72%">
      <stop class="op2-veias-inicio" offset="70%" stop-color="#000"/>
      <stop offset="100%" stop-color="#fff"/>
    </radialGradient>
    <mask id="op2-veias-mascara"><rect width="100%" height="100%" fill="url(#op2-veias-gradiente)"/></mask>
  </defs>
  <rect width="100%" height="100%" filter="url(#op2-veias-filtro)" mask="url(#op2-veias-mascara)"/>
</svg>`;

function elemento() {
  let el = document.getElementById("op2-vinheta-loucura");
  if (el) return el;
  el = document.createElement("div");
  el.id = "op2-vinheta-loucura";
  el.className = "op2-loucura";
  el.innerHTML = `<span class="op2-loucura__borda"></span><span class="op2-loucura__fantasma"></span>${VEIAS}`;
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
  // As veias avançam da borda para o centro conforme a loucura cresce.
  el.querySelector(".op2-veias-inicio")?.setAttribute("offset", `${Math.round(78 - 40 * nivel)}%`);
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
