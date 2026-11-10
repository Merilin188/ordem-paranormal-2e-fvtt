/* global PIXI */
/**
 * Efeitos ao entrar numa cena, por preset:
 * - "Home": tremor lento, desfoque que pulsa e rastro de movimento (FX Bus), mais
 *   vagalumes subindo.
 * - A mata que observa ("Profundezas da Mata", "Rio das Brumas", "Encosta Escura"):
 *   os mesmos vagalumes, tremor e rastro mais leves (sem desfoque) e olhos que abrem,
 *   piscam e somem entre as árvores. Durante a furtividade, a mata fica mais atenta
 *   (mais olhos, olhos que procuram) e um batimento pulsa nas bordas.
 * - Perseguição ("Caminho para Bellynyr"): sem olhos; tremor mais forte e rápido,
 *   pisadas de tempos em tempos, névoa densa e as chamas da Ellén Trechend
 *   (`efeitos-perseguicao.mjs`, calibrável pelo mestre).
 *
 * Roda direto no cliente de cada um (jogadores e mestre), pelos handlers do runtime do FX Bus
 * (`globalThis.fxbus.handlers`). O `emit()` do FX Bus não serve aqui: jogador comum
 * não aplica o próprio pacote, e o mestre não precisaria estar na cena. Ao trocar de
 * cena, o próprio FX Bus reseta tudo no `canvasTearDown`.
 */
import { SYSTEM_ID } from "../config.mjs";
import {
  lerConfig as lerConfigPerseguicao, acoesDoFxBus, iniciarPerseguicaoVisual, pararPerseguicaoVisual,
  registrarEfeitosDePerseguicao,
} from "./efeitos-perseguicao.mjs";

/** Os valores do painel do mestre (Screen Shake, Blur, Smear), "Run until stopped". */
export const EFEITOS_DA_ENTRADA = Object.freeze([
  { action: "fx.screenShake.start", intensityPx: 15, freqHz: 0.15, durationMs: 0 },
  { action: "fx.screenBlur.start", strength: 1, quality: 1, freqHz: 0.1, minStrength: 1, maxStrength: 3, ease: "inOut", durationMs: 0 },
  {
    action: "fx.screenSmear.start", strength: 1, persistence: 0.85, cameraWeighted: true, jitterPx: 0, maxStepPx: 40,
    ease: "inOut", freqHz: 0.1, minStrength: 0, maxStrength: 0.25, durationMs: 0,
  },
]);

/** Profundezas da Mata: tremor e rastro com metade da força da Home, sem desfoque. */
export const EFEITOS_PROFUNDEZAS = Object.freeze([
  { action: "fx.screenShake.start", intensityPx: 7, freqHz: 0.1, durationMs: 0 },
  {
    action: "fx.screenSmear.start", strength: 1, persistence: 0.78, cameraWeighted: true, jitterPx: 0, maxStepPx: 22,
    ease: "inOut", freqHz: 0.07, minStrength: 0, maxStrength: 0.12, durationMs: 0,
  },
]);

export const PRESETS = Object.freeze({
  home: { fx: EFEITOS_DA_ENTRADA, vagalumes: true, assombracao: false },
  profundezas: { fx: EFEITOS_PROFUNDEZAS, vagalumes: true, assombracao: true },
  // O FX Bus da perseguição sai da calibração (lido na hora de ligar).
  perseguicao: { fx: null, vagalumes: false, assombracao: false, perseguicao: true },
});

/** Cenas padrão da perseguição. */
export const CENAS_DA_PERSEGUICAO = "Caminho para Bellynyr";
const PARADAS = ["fx.screenShake.stop", "fx.screenBlur.stop", "fx.screenSmear.stop"];

/** Cenas padrão da mata que observa. */
export const CENAS_DA_MATA = "Profundezas da Mata; Rio das Brumas; Encosta Escura";

/**
 * A cena está na configuração? Aceita várias, separadas por ";" ou ",", cada uma por
 * nome ou id, sem diferenciar maiúsculas; vazio desliga.
 */
export function cenaTemEfeitos(cena, configurada) {
  if (!cena) return false;
  const nome = String(cena.name ?? "").trim().toLowerCase();
  const id = String(cena.id ?? "").toLowerCase();
  return String(configurada ?? "").split(/[;,]/)
    .map((alvo) => alvo.trim().toLowerCase())
    .some((alvo) => alvo && (alvo === nome || alvo === id));
}

/** Qual preset vale na cena: "home", "profundezas", "perseguicao" ou null. */
export function presetDaCena(cena, { home = "", profundezas = "", perseguicao = "" } = {}) {
  if (cenaTemEfeitos(cena, home)) return "home";
  if (cenaTemEfeitos(cena, profundezas)) return "profundezas";
  if (cenaTemEfeitos(cena, perseguicao)) return "perseguicao";
  return null;
}

const ler = (chave) => {
  try { return game.settings.get(SYSTEM_ID, chave); } catch { return ""; }
};
const configuradas = () => ({
  home: ler("cenaEfeitosEntrada"), profundezas: ler("cenaEfeitosProfundezas"), perseguicao: ler("cenaEfeitosPerseguicao"),
});

/** As mesmas travas do FX Bus: desligado no cliente, modo fotossensível, movimento reduzido. */
function bloqueado() {
  const lerDe = (modulo, chave) => {
    try { return game.settings.get(modulo, chave) === true; } catch { return false; }
  };
  if (lerDe("fxbus", "disableLocalFx")) return true;
  if (canvas?.photosensitiveMode === true || lerDe("core", "photosensitiveMode")) return true;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true && lerDe("fxbus", "respectReducedMotion")) return true;
  return false;
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

/* -- textura e área visível ------------------------------------------------------ */

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
export function corPorPeso(r, tabela) {
  const total = tabela.reduce((t, [, p]) => t + p, 0);
  let alvo = r * total;
  for (const [cor, peso] of tabela) {
    if ((alvo -= peso) < 0) return cor;
  }
  return tabela.at(-1)[0];
}
export const corDoVagalume = (r) => corPorPeso(r, CORES_VAGALUMES);

/** Brilho que pisca devagar, como vagalume: picos curtos, vales longos (0 a 1). */
export function piscar(t, freq, fase) {
  const onda = 0.5 + 0.5 * Math.sin(t * freq * Math.PI * 2 + fase);
  return 0.25 + 0.75 * onda ** 3;
}

let enxame = null;

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

/* -- a mata que observa: olhos ------------------------------------------------- */

/** Olhos: vermelhos, brancos-pálidos e um âmbar raro. [cor, peso] */
export const CORES_OLHOS = Object.freeze([[0xff2a1f, 3], [0xfff1d2, 4], [0xffc23a, 1]]);

/**
 * Envelope de uma aparição (0 a 1): sobe em `entrada` s, fica `fica` s, some em
 * `saida` s. Depois do fim, 0.
 */
export function envelope(idade, { entrada, fica, saida }) {
  if (idade <= 0) return 0;
  if (idade < entrada) return idade / entrada;
  if (idade < entrada + fica) return 1;
  const r = 1 - (idade - entrada - fica) / saida;
  return Math.max(0, r);
}

/** Ritmo da mata: com que frequência nascem olhos (multiplicador) e quantos cabem. */
export function ritmoDaMata(furtividade) {
  if (!furtividade?.ativa) return { olhos: 1, maxOlhos: 6, procuram: false };
  if (furtividade.fase === "criaturas") return { olhos: 3, maxOlhos: 12, procuram: true };
  return { olhos: 2, maxOlhos: 9, procuram: false };
}

let mata = null;

/** Um ponto livre na parte de baixo da tela, longe dos tokens. */
function pontoNaMata(area, folgaTela = 50) {
  const folga = folgaTela / area.escala;
  const tokens = canvas.tokens?.placeables ?? [];
  for (let i = 0; i < 10; i++) {
    const x = area.x + area.w * (0.04 + Math.random() * 0.92);
    const y = area.y + area.h * (0.25 + Math.random() * 0.6);
    const ocupado = tokens.some((t) => {
      const b = t.bounds;
      return b && x > b.x - folga && x < b.x + b.width + folga && y > b.y - folga && y < b.y + b.height + folga;
    });
    if (!ocupado) return { x, y };
  }
  return null;
}

function parDeOlhos(textura, cor, raio, distancia) {
  const par = new PIXI.Container();
  for (const lado of [-1, 1]) {
    const s = new PIXI.Sprite(textura);
    s.anchor.set(0.5);
    s.blendMode = PIXI.BLEND_MODES.ADD;
    s.tint = cor;
    s.scale.set((raio * 4) / 64);
    s.x = (lado * distancia) / 2;
    par.addChild(s);
  }
  return par;
}

function criarOlhos(area, ritmo) {
  const ponto = pontoNaMata(area);
  if (!ponto) return null;
  const cor = corPorPeso(Math.random(), CORES_OLHOS);
  const par = parDeOlhos(mata.textura, cor, 1.5 + Math.random() * 1.2, 8 + Math.random() * 8);
  par.position.set(ponto.x, ponto.y);
  par.scale.set(1 / area.escala);
  par.alpha = 0;
  mata.container.addChild(par);
  return {
    obj: par, idade: 0, x: ponto.x, y: ponto.y,
    tempos: { entrada: 1 + Math.random(), fica: 2 + Math.random() * 4.5, saida: 1.2 + Math.random() },
    piscaEm: 1.5 + Math.random() * 2.5, piscando: 0,
    // Na fase das criaturas, os olhos varrem a mata devagar, de um lado para o outro.
    vx: ritmo.procuram ? (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 8) : 0,
  };
}

function lerFurtividade() {
  try {
    const e = game.settings.get(SYSTEM_ID, "furtividade") ?? {};
    return { ativa: Boolean(e.ativa), fase: e.fase ?? "personagens" };
  } catch { return { ativa: false, fase: "personagens" }; }
}

function iniciarAssombracao() {
  if (mata || !canvas?.stage || !canvas.app?.ticker) return;
  const container = new PIXI.Container();
  container.eventMode = "none";
  container.name = "op2-mata";
  mata = { container, textura: texturaDoBrilho(), aparicoes: [], proximoOlho: 1.5, relogio: 0, furtividade: lerFurtividade() };
  // Atrás dos vagalumes: eles brilham por cima da mata.
  const indice = enxame ? canvas.stage.getChildIndex(enxame.container) : canvas.stage.children.length;
  canvas.stage.addChildAt(container, indice);
  let t = 0;
  mata.passo = () => {
    const dt = Math.min(0.1, canvas.app.ticker.deltaMS / 1000);
    t += dt;
    const area = areaVisivel();
    mata.relogio += dt;
    if (mata.relogio > 1) {
      mata.relogio = 0;
      mata.furtividade = lerFurtividade();
      atualizarBatimento(mata.furtividade);
    }
    const ritmo = ritmoDaMata(mata.furtividade);
    const olhosVivos = mata.aparicoes.length;
    mata.proximoOlho -= dt * ritmo.olhos;
    if (mata.proximoOlho <= 0) {
      mata.proximoOlho = 2 + Math.random() * 4;
      if (olhosVivos < ritmo.maxOlhos) {
        const novo = criarOlhos(area, ritmo);
        if (novo) mata.aparicoes.push(novo);
      }
    }
    for (const a of [...mata.aparicoes]) {
      a.idade += dt;
      const luz = envelope(a.idade, a.tempos);
      if (a.idade > a.tempos.entrada + a.tempos.fica + a.tempos.saida) {
        a.obj.destroy({ children: true });
        mata.aparicoes.splice(mata.aparicoes.indexOf(a), 1);
        continue;
      }
      a.obj.scale.set(1 / area.escala);
      a.x += (a.vx * dt) / area.escala;
      a.obj.position.set(a.x, a.y + (Math.sin(t * 0.7 + a.idade) * 1.5) / area.escala);
      // Piscar: some por um instante de tempos em tempos.
      a.piscaEm -= dt;
      if (a.piscaEm <= 0) { a.piscando = 0.14; a.piscaEm = 2 + Math.random() * 3; }
      if (a.piscando > 0) a.piscando -= dt;
      a.obj.alpha = luz * (a.piscando > 0 ? 0.05 : 0.95);
    }
  };
  canvas.app.ticker.add(mata.passo);
}

function pararAssombracao() {
  atualizarBatimento({ ativa: false });
  if (!mata) return;
  canvas?.app?.ticker?.remove(mata.passo);
  mata.container.destroy({ children: true });
  mata.textura.destroy(true);
  mata = null;
}

/**
 * Furtividade nas Profundezas: um batimento escuro-avermelhado pulsa nas bordas da
 * tela (mais rápido na fase das criaturas). Fica entre o mapa e a interface.
 */
function atualizarBatimento(furtividade) {
  let el = document.getElementById("op2-batimento");
  const ligar = Boolean(furtividade?.ativa) && !bloqueado();
  if (!ligar) return void el?.classList.remove("ativa", "rapido");
  if (!el) {
    el = document.createElement("div");
    el.id = "op2-batimento";
    el.className = "op2-batimento";
    const board = document.getElementById("board");
    if (board) board.after(el);
    else document.body.prepend(el);
  }
  el.classList.add("ativa");
  el.classList.toggle("rapido", furtividade.fase === "criaturas");
}

/* -- ligar e desligar ---------------------------------------------------------- */

let ligados = false;

function atualizar() {
  const nome = presetDaCena(canvas?.scene, configuradas());
  const preset = nome ? PRESETS[nome] : null;
  if (preset?.vagalumes) iniciarVagalumes();
  else pararVagalumes();
  if (preset?.assombracao) iniciarAssombracao();
  else pararAssombracao();
  if (preset?.perseguicao) iniciarPerseguicaoVisual(bloqueado);
  else pararPerseguicaoVisual();
  if (!game.modules.get("fxbus")?.active) return;
  const fx = preset?.perseguicao ? acoesDoFxBus(lerConfigPerseguicao()) : preset?.fx;
  const deve = Boolean(preset) && Boolean(fx?.length) && !bloqueado();
  if (ligados) despachar(PARADAS.map((action) => ({ action })));
  if (deve) despachar(fx);
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
  game.settings.register(SYSTEM_ID, "cenaEfeitosProfundezas", {
    name: "OP2.EfeitosCena.NomeProfundezas", hint: "OP2.EfeitosCena.DicaProfundezas",
    scope: "world", config: true, type: String, default: CENAS_DA_MATA,
    onChange: () => { ligados = true; quandoPronto(); },
  });
  game.settings.register(SYSTEM_ID, "cenaEfeitosPerseguicao", {
    name: "OP2.EfeitosCena.NomePerseguicao", hint: "OP2.EfeitosCena.DicaPerseguicao",
    scope: "world", config: true, type: String, default: CENAS_DA_PERSEGUICAO,
    onChange: () => { ligados = true; quandoPronto(); },
  });
  // Calibração salva: quem está na cena vê a mudança na hora.
  registrarEfeitosDePerseguicao(() => { ligados = true; quandoPronto(); });
  Hooks.on("canvasTearDown", () => { ligados = false; pararVagalumes(); pararAssombracao(); pararPerseguicaoVisual(); });
  Hooks.on("canvasReady", quandoPronto);
  // Mundo que gravou a cena única de antes: passa a valer a lista das três.
  Hooks.once("ready", () => {
    if (game.user.isGM && ler("cenaEfeitosProfundezas") === "Profundezas da Mata") {
      void game.settings.set(SYSTEM_ID, "cenaEfeitosProfundezas", CENAS_DA_MATA);
    }
  });
}
