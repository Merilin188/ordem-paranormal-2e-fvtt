/**
 * Efeitos do FX Bus ao entrar numa cena (a tela "Home"): tremor lento, desfoque
 * que pulsa e rastro de movimento, rodando até o jogador sair da cena.
 *
 * Roda direto no cliente de cada um (jogadores e mestre), pelos handlers do runtime do FX Bus
 * (`globalThis.fxbus.handlers`). O `emit()` do FX Bus não serve aqui: jogador comum
 * não aplica o próprio pacote, e o mestre não precisaria estar na cena. Ao trocar de
 * cena, o próprio FX Bus reseta tudo no `canvasTearDown`.
 */
import { SYSTEM_ID } from "../config.mjs";

/** Os valores do painel do mestre (Screen Shake, Blur, Smear), "Run until stopped". */
export const EFEITOS_DA_ENTRADA = Object.freeze([
  { action: "fx.screenShake.start", intensityPx: 15, freqHz: 0.15, durationMs: 0 },
  { action: "fx.screenBlur.start", strength: 1, quality: 1, freqHz: 0.1, minStrength: 1, maxStrength: 3, ease: "inOut", durationMs: 0 },
  {
    action: "fx.screenSmear.start", strength: 1, persistence: 0.85, cameraWeighted: true, jitterPx: 0, maxStepPx: 40,
    ease: "inOut", freqHz: 0.1, minStrength: 0, maxStrength: 0.25, durationMs: 0,
  },
]);
const PARADAS = ["fx.screenShake.stop", "fx.screenBlur.stop", "fx.screenSmear.stop"];

/** A cena configurada (nome ou id, sem diferenciar maiúsculas); vazio desliga. */
export function cenaTemEfeitos(cena, configurada) {
  const alvo = String(configurada ?? "").trim().toLowerCase();
  if (!alvo || !cena) return false;
  return String(cena.name ?? "").trim().toLowerCase() === alvo || String(cena.id ?? "").toLowerCase() === alvo;
}

const configurada = () => {
  try { return game.settings.get(SYSTEM_ID, "cenaEfeitosEntrada"); } catch { return ""; }
};

/** As mesmas travas do FX Bus: desligado no cliente, modo fotossensível, movimento reduzido. */
function bloqueado() {
  const ler = (modulo, chave) => {
    try { return game.settings.get(modulo, chave) === true; } catch { return false; }
  };
  if (ler("fxbus", "disableLocalFx")) return true;
  if (canvas?.photosensitiveMode === true || ler("core", "photosensitiveMode")) return true;
  return ler("fxbus", "respectReducedMotion") && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function despachar(acoes) {
  const handlers = globalThis.fxbus?.handlers;
  if (!handlers) return;
  for (const payload of acoes) {
    const handler = handlers.get(payload.action);
    if (typeof handler !== "function") continue;
    try {
      handler({ ...payload, __fxbus: { senderId: game.user.id, senderName: game.user.name } });
    } catch (erro) {
      console.warn(`${SYSTEM_ID} | FX Bus: ${payload.action} falhou`, erro);
    }
  }
}

let ligados = false;

function atualizar() {
  if (!game.modules.get("fxbus")?.active) return;
  const deve = cenaTemEfeitos(canvas?.scene, configurada()) && !bloqueado();
  if (deve) despachar(EFEITOS_DA_ENTRADA);
  else if (ligados) despachar(PARADAS.map((action) => ({ action })));
  ligados = deve;
}

/** O FX Bus registra os handlers no `ready`; o primeiro canvasReady vem antes. */
function quandoPronto() {
  if (game.ready) setTimeout(atualizar, 0);
  else Hooks.once("ready", () => setTimeout(atualizar, 0));
}

export function registrarEfeitosDeCena() {
  game.settings.register(SYSTEM_ID, "cenaEfeitosEntrada", {
    name: "OP2.EfeitosCena.Nome", hint: "OP2.EfeitosCena.Dica",
    scope: "world", config: true, type: String, default: "Home",
    onChange: () => { ligados = true; quandoPronto(); },
  });
  Hooks.on("canvasTearDown", () => { ligados = false; });
  Hooks.on("canvasReady", quandoPronto);
}
