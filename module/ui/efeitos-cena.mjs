/* global PIXI */
/**
 * Efeitos ao entrar numa cena (a tela "Home"): tremor lento, desfoque que pulsa e
 * rastro de movimento (FX Bus), mais vagalumes subindo, até a pessoa sair da cena.
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

/* -- vagalumes --------------------------------------------------------------- */

/**
 * Fagulhas nas cores das Crias da Floresta (1: ciano e azul, um toque rosa; 2: água
 * e verde-limão) e da Ellén Trechend (verde-água). Ficam em `canvas.stage`, o mesmo
 * container que o blur e o rastro do FX Bus filtram, por isso desfocam junto.
 * [cor, peso]
 */
export const CORES_VAGALUMES = Object.freeze([
  [0x5fe3f7, 4], [0x6fbdf2, 3], [0x7b9ef0, 1], [0xf08cf5, 1],
  [0x6ff0de, 4], [0x76f2c2, 3], [0xd2fb84, 1],
  [0x7aeedb, 4], [0x8cf0f2, 2],
]);
const QUANTOS = 55;

/** Escolhe uma cor pelo peso, com `r` em [0, 1). */
export function corDoVagalume(r) {
  const total = CORES_VAGALUMES.reduce((t, [, p]) => t + p, 0);
  let alvo = r * total;
  for (const [cor, peso] of CORES_VAGALUMES) {
    if ((alvo -= peso) < 0) return cor;
  }
  return CORES_VAGALUMES.at(-1)[0];
}

/** Brilho que pisca devagar, como vagalume: picos curtos, vales longos (0 a 1). */
export function piscar(t, freq, fase) {
  const onda = 0.5 + 0.5 * Math.sin(t * freq * Math.PI * 2 + fase);
  return 0.25 + 0.75 * onda ** 3;
}

let enxame = null;

function texturaDoBrilho() {
  const lado = 64;
  const tela = document.createElement("canvas");
  tela.width = tela.height = lado;
  const ctx = tela.getContext("2d");
  const g = ctx.createRadialGradient(lado / 2, lado / 2, 0, lado / 2, lado / 2, lado / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,255,255,0.9)");
  g.addColorStop(0.3, "rgba(255,255,255,0.32)");
  g.addColorStop(0.6, "rgba(255,255,255,0.08)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, lado, lado);
  return PIXI.Texture.from(tela);
}

/** O retângulo do mundo que está na tela agora. */
function areaVisivel() {
  const tela = canvas.app.renderer.screen;
  const a = canvas.stage.toLocal({ x: 0, y: 0 });
  const b = canvas.stage.toLocal({ x: tela.width, y: tela.height });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, escala: canvas.stage.scale.x || 1 };
}

function nascer(v, area, emQualquerAltura) {
  v.x0 = area.x + Math.random() * area.w;
  v.y = emQualquerAltura ? area.y + Math.random() * area.h : area.y + area.h + 20 / area.escala;
  v.subida = 9 + Math.random() * 20; // px de tela por segundo
  v.raio = 2 + Math.random() * 3.5; // px de tela
  v.amplitude = 6 + Math.random() * 18;
  v.balanco = 0.08 + Math.random() * 0.25;
  v.freq = 0.15 + Math.random() * 0.45;
  v.fase = Math.random() * Math.PI * 2;
  v.idade = 0;
  v.sprite.tint = corDoVagalume(Math.random());
}

function iniciarVagalumes() {
  if (enxame || !canvas?.stage || !canvas.app?.ticker) return;
  const container = new PIXI.Container();
  container.eventMode = "none";
  container.name = "op2-vagalumes";
  const textura = texturaDoBrilho();
  const area = areaVisivel();
  const lista = Array.from({ length: QUANTOS }, () => {
    const sprite = new PIXI.Sprite(textura);
    sprite.anchor.set(0.5);
    sprite.blendMode = PIXI.BLEND_MODES.ADD;
    container.addChild(sprite);
    const v = { sprite };
    nascer(v, area, true);
    return v;
  });
  canvas.stage.addChild(container);
  let t = 0;
  const passo = () => {
    const dt = Math.min(0.1, canvas.app.ticker.deltaMS / 1000);
    t += dt;
    const area = areaVisivel();
    for (const v of lista) {
      v.idade += dt;
      v.y -= (v.subida * dt) / area.escala;
      if (v.y < area.y - 30 / area.escala || v.x0 < area.x - 60 || v.x0 > area.x + area.w + 60) nascer(v, area, false);
      const s = v.sprite;
      s.x = v.x0 + (Math.sin(t * v.balanco * Math.PI * 2 + v.fase) * v.amplitude) / area.escala;
      s.y = v.y;
      s.scale.set((v.raio * 4) / 64 / area.escala);
      const entrada = Math.min(1, v.idade / 2);
      const topo = Math.min(1, Math.max(0, (v.y - area.y) / (area.h * 0.18)));
      s.alpha = piscar(t, v.freq, v.fase) * entrada * topo;
    }
  };
  canvas.app.ticker.add(passo);
  enxame = { container, passo, textura };
}

function pararVagalumes() {
  if (!enxame) return;
  canvas?.app?.ticker?.remove(enxame.passo);
  enxame.container.destroy({ children: true });
  enxame.textura.destroy(true);
  enxame = null;
}

/* -- ligar e desligar ---------------------------------------------------------- */

let ligados = false;

function atualizar() {
  const naCena = cenaTemEfeitos(canvas?.scene, configurada());
  if (naCena) iniciarVagalumes();
  else pararVagalumes();
  if (!game.modules.get("fxbus")?.active) return;
  const deve = naCena && !bloqueado();
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
  Hooks.on("canvasTearDown", () => { ligados = false; pararVagalumes(); });
  Hooks.on("canvasReady", quandoPronto);
}
