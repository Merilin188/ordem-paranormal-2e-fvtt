/**
 * Dados 3D padronizados (Dice So Nice): todo mundo com o mesmo acabamento, cada um
 * na cor do próprio usuário (a bolinha da lista de jogadores).
 *
 * Acabamento: material "Impecável" (pristine) no lugar de "Plástico". O plástico usa
 * um mapa de rugosidade fosco e sai chapado; o impecável tem verniz (clearcoat) que
 * reflete a luz do ambiente — brilho de dado de resina de verdade, sem mudar a cor.
 * O contorno dos números é a cor do dado escurecida, o que deixa o algarismo mais
 * nítido, e a etiqueta é escura ou clara conforme o dado.
 *
 * Cada cliente grava a aparência no PRÓPRIO usuário (flags do Dice So Nice), ao
 * entrar e quando a cor muda. A qualidade de imagem só vale depois de recarregar.
 */
import { SYSTEM_ID } from "../config.mjs";

const DSN = "dice-so-nice";

/** Configurações de imagem que todos usam (o resto — som, tamanho — fica de cada um). */
export const QUALIDADE_DADOS = Object.freeze({
  imageQuality: "high", shadowQuality: "high", bumpMapping: true, useHighDPI: true,
  antialiasing: "msaa", glow: true, advancedGlass: true, ambiance: "foyer_1k",
});

const hexValido = (hex) => /^#?[0-9a-f]{6}$/i.test(String(hex ?? "").trim());
const canais = (hex) => {
  const h = String(hex).trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const paraHex = (rgb) => `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;

/** Luminância relativa (WCAG), de 0 a 1. */
export function luminancia(hex) {
  const [r, g, b] = canais(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const escurecer = (hex, fator) => paraHex(canais(hex).map((c) => c * (1 - fator)));

/** A aparência global do Dice So Nice para um usuário desta cor. */
export function aparenciaDosDados(cor) {
  const dado = hexValido(cor) ? `#${String(cor).trim().replace("#", "").toLowerCase()}` : "#f5f5f5";
  const claro = luminancia(dado) > 0.15;
  return {
    labelColor: claro ? "#0b0b0b" : "#f4f1ea",
    diceColor: dado,
    outlineColor: claro ? escurecer(dado, 0.55) : escurecer(dado, 0.7),
    edgeColor: dado,
    texture: "none",
    material: "pristine",
    font: "Signika",
    colorset: "custom",
    system: "standard",
  };
}

const ligado = () => {
  try { return game.settings.get(SYSTEM_ID, "dados3dPadrao"); } catch { return false; }
};

function corDoUsuario(usuario) {
  try { return foundry.utils.Color.from(usuario.color).css; } catch { return String(usuario.color ?? ""); }
}

async function padronizar() {
  if (!ligado() || !game.modules.get(DSN)?.active) return;
  const usuario = game.user;
  const aparencia = usuario.getFlag(DSN, "appearance") ?? {};
  const config = usuario.getFlag(DSN, "settings") ?? {};
  const global = aparenciaDosDados(corDoUsuario(usuario));
  const mudou = (atual, alvo) => Object.entries(alvo).some(([k, v]) => atual?.[k] !== v);
  const mudarAparencia = mudou(aparencia.global, global);
  const mudarQualidade = mudou(config, QUALIDADE_DADOS);
  if (!mudarAparencia && !mudarQualidade) return;
  const flags = {};
  if (mudarAparencia) flags.appearance = { ...aparencia, global };
  if (mudarQualidade) flags.settings = { ...config, ...QUALIDADE_DADOS };
  flags.saved = { ...(usuario.getFlag(DSN, "saved") ?? {}), appearance: true };
  await usuario.update({ flags: { [DSN]: flags } });
  ui.notifications.info(game.i18n.localize("OP2.Dados3D.Recarregue"));
}

export function registrarDados3D() {
  game.settings.register(SYSTEM_ID, "dados3dPadrao", {
    name: "OP2.Dados3D.Nome", hint: "OP2.Dados3D.Dica",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => void padronizar(),
  });
  Hooks.once("ready", () => void padronizar());
  Hooks.on("updateUser", (usuario, mudancas) => {
    if (usuario.id === game.user.id && "color" in mudancas) void padronizar();
  });
}
