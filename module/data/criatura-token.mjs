/**
 * Token de criatura: nome e barra de PV só para o dono (o mestre). O modo OWNER
 * mostra sempre a quem é dono e nunca aos outros, nem passando o mouse.
 */
import { SYSTEM_ID } from "../config.mjs";

const PADRAO = () => ({
  displayName: CONST.TOKEN_DISPLAY_MODES.OWNER,
  displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER,
});

/** Uma vez por mundo: criaturas e tokens de criatura que já existem. */
async function migrar() {
  if (game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get(SYSTEM_ID, "tokensCriaturaOcultos")) return;
  const modo = PADRAO();
  for (const ator of game.actors.filter((a) => a.type === "criatura")) {
    await ator.update({ "prototypeToken.displayName": modo.displayName, "prototypeToken.displayBars": modo.displayBars });
  }
  for (const cena of game.scenes) {
    const mudancas = cena.tokens.filter((t) => t.actor?.type === "criatura").map((t) => ({ _id: t.id, ...modo }));
    if (mudancas.length) await cena.updateEmbeddedDocuments("Token", mudancas);
  }
  await game.settings.set(SYSTEM_ID, "tokensCriaturaOcultos", true);
}

export function registrarTokenDeCriatura() {
  game.settings.register(SYSTEM_ID, "tokensCriaturaOcultos", { scope: "world", config: false, type: Boolean, default: false });

  // Criatura nova: hostil, barra de PV, nome e barra só para o mestre.
  Hooks.on("preCreateActor", (ator) => {
    if (ator.type !== "criatura") return;
    const modo = PADRAO();
    ator.updateSource({
      "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.HOSTILE,
      "prototypeToken.bar1.attribute": "recursos.pv",
      "prototypeToken.displayName": modo.displayName,
      "prototypeToken.displayBars": modo.displayBars,
    });
  });
  // Token posto no mapa: garante o mesmo, mesmo que o protótipo tenha sido mudado.
  Hooks.on("preCreateToken", (token) => {
    if (token.actor?.type === "criatura") token.updateSource(PADRAO());
  });
  Hooks.once("ready", () => void migrar());
}
