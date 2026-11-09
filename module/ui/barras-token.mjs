/**
 * Barras dos tokens (PV e companhia):
 * - Criatura: a barra é informação só do mestre. Jogador não vê de jeito nenhum —
 *   nem passando o mouse.
 * - Personagem: a barra mostra os números ("12 / 20") para o dono e para os aliados.
 *
 * O módulo Bar Brawl substitui as barras do core e guarda visibilidade e estilo do
 * texto por barra (`flags.barbrawl.resourceBars`); o padrão dele mostrava a barra das
 * criaturas a quem passasse o mouse e deixava o número a critério de cada cliente
 * (o do jogador vinha sem número). Aqui as duas coisas viram dado do token, e um
 * guarda no cliente do jogador esconde a barra da criatura mesmo sem o módulo.
 */
import { SYSTEM_ID } from "../config.mjs";

/** Visibilidades do Bar Brawl (`BAR_VISIBILITY`). */
const NENHUMA = 0;

const temBarBrawl = () => Boolean(game.modules.get("barbrawl")?.active);

/** As barras de partida para o tipo: as do token, senão o padrão do Bar Brawl para o tipo. */
function barrasBase(tipo, atuais) {
  if (atuais && Object.keys(atuais).length) return foundry.utils.deepClone(atuais);
  let padroes = {};
  try { padroes = game.settings.get("barbrawl", "defaultTypeResources") ?? {}; } catch { /* sem o módulo */ }
  if (typeof padroes === "string") {
    try { padroes = JSON.parse(padroes); } catch { padroes = {}; }
  }
  const base = padroes[tipo] ?? padroes["barbrawl-default"];
  return base && Object.keys(base).length ? foundry.utils.deepClone(base) : null;
}

/**
 * As barras ajustadas para o tipo de ator. Pura sobre os dados: criatura some para
 * quem não é dono (o mestre continua vendo); personagem mostra a fração.
 */
export function ajustarBarras(tipo, barras) {
  if (!barras) return null;
  for (const barra of Object.values(barras)) {
    if (!barra || typeof barra !== "object") continue;
    if (tipo === "criatura") {
      barra.otherVisibility = NENHUMA;
    } else if (tipo === "personagem") {
      barra.style = "fraction";
    }
  }
  return barras;
}

function barrasPara(tipo, atuais) {
  if (!["criatura", "personagem"].includes(tipo)) return null;
  return ajustarBarras(tipo, barrasBase(tipo, atuais));
}

/** Uma vez por mundo: protótipos e tokens que já estão nas cenas. */
async function migrar() {
  if (!temBarBrawl() || game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get(SYSTEM_ID, "barrasTokenV1")) return;
  for (const ator of game.actors) {
    const barras = barrasPara(ator.type, ator.prototypeToken?.flags?.barbrawl?.resourceBars);
    if (barras) await ator.update({ "prototypeToken.flags.barbrawl.resourceBars": barras });
  }
  for (const cena of game.scenes) {
    const mudancas = cena.tokens.map((t) => {
      const barras = barrasPara(t.actor?.type, t.flags?.barbrawl?.resourceBars);
      return barras ? { _id: t.id, "flags.barbrawl.resourceBars": barras } : null;
    }).filter(Boolean);
    if (mudancas.length) await cena.updateEmbeddedDocuments("Token", mudancas);
  }
  await game.settings.set(SYSTEM_ID, "barrasTokenV1", true);
}

/** No cliente do jogador, a barra da criatura não aparece, haja o que houver. */
function esconderDaCriatura(token) {
  if (game.user.isGM || token?.actor?.type !== "criatura" || !token.bars) return;
  token.bars.visible = false;
}

export function registrarBarrasDeToken() {
  game.settings.register(SYSTEM_ID, "barrasTokenV1", { scope: "world", config: false, type: Boolean, default: false });

  Hooks.on("preCreateToken", (token) => {
    if (!temBarBrawl()) return;
    const barras = barrasPara(token.actor?.type, token.flags?.barbrawl?.resourceBars);
    if (barras) token.updateSource({ "flags.barbrawl.resourceBars": barras });
  });
  // Registrados no init, rodam depois dos do Bar Brawl (que entram ao carregar o
  // módulo): a última palavra sobre a barra da criatura é esta.
  for (const gancho of ["drawToken", "refreshToken", "hoverToken", "controlToken"]) {
    Hooks.on(gancho, (token) => esconderDaCriatura(token));
  }
  Hooks.once("ready", () => void migrar());
}
