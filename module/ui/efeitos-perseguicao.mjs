/* global PIXI */
/**
 * Efeitos da cena de perseguição ("Caminho para Bellynyr"): a Ellén Trechend vem
 * atrás do grupo.
 *
 * - Câmera de quem corre: o balanço do passo, a oscilação de um lado para o outro e
 *   uma leve inclinação, irregulares (nunca o mesmo ciclo) — não um loop rodando.
 * - Pisadas: de 40 a 70 s, um tranco forte na tela inteira, como a criatura pisando
 *   perto. O mestre sorteia o momento e todos sentem juntos.
 * - Névoa em duas camadas que correm, sem fechar a vista da cena.
 * - Reflexo: a luz verde-água das chamas da Ellén batendo na cena por trás de quem
 *   foge, tremeluzindo e mudando de lado como se ela viesse no encalço.
 * - Opcionais (desligados no padrão): o tremor do FX Bus e chamas soltas subindo.
 *
 * Tudo calibrável pelo mestre em Configurações → "Calibrar efeitos da perseguição".
 * Sem som (respiração e batimento já vêm da perseguição). Respeita as travas de
 * fotossensibilidade/movimento reduzido: sem tremor, sem pisada e sem cintilar.
 */
import { SYSTEM_ID } from "../config.mjs";
import { paraTodos, registrarAcaoDeTodos } from "./socket.mjs";
import { mesclarComLimites, criarJanelaDeCalibracao } from "./calibracao-efeitos.mjs";

const CHAVE = "efeitosPerseguicaoConfig";

/* -- configuração ---------------------------------------------------------------- */

/** Os valores de partida. Cada número tem limite (ver LIMITES) para não enjoar ninguém. */
export const configPadrao = () => ({
  corrida: { ligado: true, intensidadePx: 5, passosHz: 1.4, rotacao: 0.35, irregularidade: 0.6 },
  reflexo: { ligado: true, forca: 0.55, movimento: 0.5, cintilar: 0.5, cor: "#4fd1c5" },
  pisadas: { ligado: true, intervaloMin: 40, intervaloMax: 70, intensidadePx: 24, duracaoMs: 1100, freqHz: 9 },
  nevoa: { ligado: true, opacidade: 0.3, velocidade: 1, cor: "#a9bcc0" },
  rastro: { ligado: true, forca: 0.02 },
  tremor: { ligado: false, intensidadePx: 6, freqHz: 0.3 },
  chamas: { ligado: false, quantidade: 20, tamanho: 1, intensidade: 0.7, velocidade: 1 },
});

/** [mín, máx] de cada número: o teto do tremor e da pisada é o que evita enjoo. */
export const LIMITES = Object.freeze({
  "corrida.intensidadePx": [0, 14], "corrida.passosHz": [0.5, 2.5], "corrida.rotacao": [0, 1.5], "corrida.irregularidade": [0, 1],
  "reflexo.forca": [0, 1], "reflexo.movimento": [0, 1], "reflexo.cintilar": [0, 1],
  "tremor.intensidadePx": [0, 18], "tremor.freqHz": [0.05, 1.6],
  "rastro.forca": [0, 0.3],
  "pisadas.intervaloMin": [10, 600], "pisadas.intervaloMax": [10, 900],
  "pisadas.intensidadePx": [0, 40], "pisadas.duracaoMs": [200, 2500], "pisadas.freqHz": [2, 14],
  "nevoa.opacidade": [0, 0.85], "nevoa.velocidade": [0.1, 4],
  "chamas.quantidade": [0, 80], "chamas.tamanho": [0.3, 3], "chamas.intensidade": [0, 1.5],
  "chamas.velocidade": [0.2, 3],
});

/** O salvo por cima do padrão, com os números dentro dos limites. Pura. */
export function mesclarConfig(salvo = {}) {
  // Calibração da primeira versão (sem a câmera de corrida): só as pisadas ficam — o
  // resto (loop do tremor, chamas soltas, névoa e rastro fortes) foi refeito.
  if (salvo && Object.keys(salvo).length && !salvo.corrida) salvo = { pisadas: salvo.pisadas };
  const c = mesclarComLimites(salvo, configPadrao(), LIMITES);
  if (c.reflexo.cor === "#ffffff" && salvo?.reflexo?.cor !== "#ffffff") c.reflexo.cor = configPadrao().reflexo.cor;
  if (c.pisadas.intervaloMax < c.pisadas.intervaloMin) c.pisadas.intervaloMax = c.pisadas.intervaloMin;
  if (c.nevoa.cor === "#ffffff" && salvo?.nevoa?.cor !== "#ffffff") c.nevoa.cor = configPadrao().nevoa.cor;
  return c;
}

export function lerConfig() {
  try { return mesclarConfig(game.settings.get(SYSTEM_ID, CHAVE)); } catch { return configPadrao(); }
}

/** Segundos até a próxima pisada, sorteados entre o mínimo e o máximo (`r` em [0,1)). Pura. */
export function proximaPisada(min, max, r = Math.random()) {
  return min + (max - min) * r;
}

/**
 * Deslocamento da tela na pisada, `t` em ms: um tranco que vai morrendo. Pura.
 * @returns {{x: number, y: number}}
 */
export function deslocamentoDaPisada(t, { intensidadePx, duracaoMs, freqHz }, fase = 0) {
  if (t < 0 || t > duracaoMs) return { x: 0, y: 0 };
  const queda = Math.exp((-4 * t) / duracaoMs);
  const ang = (2 * Math.PI * freqHz * t) / 1000;
  // Mais vertical que horizontal: é o chão que treme.
  return { x: intensidadePx * 0.45 * queda * Math.sin(ang * 1.3 + fase), y: intensidadePx * queda * Math.sin(ang) };
}

/**
 * Câmera de quem corre, `t` em segundos: o passo (sobe e desce), a passada de um lado
 * para o outro (metade do ritmo) e uma leve inclinação — com ondas de ritmos que não
 * se repetem juntos e uma amplitude que respira, para nunca virar um loop. Pura.
 * @returns {{x: number, y: number, rot: number}} px, px, graus
 */
export function cameraDaCorrida(t, { intensidadePx, passosHz, rotacao, irregularidade }, fase = 0) {
  const tau = 2 * Math.PI;
  const irr = irregularidade;
  // O ritmo do passo varia um pouco (ninguém corre num metrônomo).
  const ritmo = passosHz * (1 + 0.08 * irr * Math.sin(t * 0.23 + fase));
  const passo = tau * ritmo * t;
  // A amplitude respira devagar (cansaço, terreno), em vez de ficar constante.
  const folego = 1 + 0.3 * irr * Math.sin(t * 0.17 + fase * 1.7) + 0.15 * irr * Math.sin(t * 0.41 + fase * 0.5);
  const ruido = (a, b, c) => Math.sin(t * a + fase * b) * 0.6 + Math.sin(t * c + fase) * 0.4;
  const y = intensidadePx * folego * (Math.abs(Math.sin(passo / 2)) - 0.64) * 1.6 + intensidadePx * 0.35 * irr * ruido(1.31, 2.3, 2.17);
  const x = intensidadePx * 0.7 * folego * Math.sin(passo / 2 + 0.4) + intensidadePx * 0.4 * irr * ruido(0.73, 1.1, 1.91);
  const rot = rotacao * folego * Math.sin(passo / 2 + 1.1) + rotacao * 0.5 * irr * ruido(0.57, 0.9, 1.43);
  return { x, y, rot };
}

/** O quanto aumentar a cena para a câmera não mostrar a borda ao balançar/inclinar. Pura. */
export function escalaDaCorrida({ intensidadePx, rotacao }, largura = 1920, altura = 1080) {
  const folga = intensidadePx * 2.2 + Math.sin((rotacao * Math.PI) / 180) * Math.max(largura, altura) * 0.6;
  return 1 + (2 * folga) / Math.min(largura, altura);
}

/** As ações do FX Bus para o tremor e o rastro desta configuração. */
export function acoesDoFxBus(c) {
  const acoes = [];
  if (c.tremor.ligado && c.tremor.intensidadePx > 0) {
    acoes.push({ action: "fx.screenShake.start", intensityPx: c.tremor.intensidadePx, freqHz: c.tremor.freqHz, durationMs: 0 });
  }
  if (c.rastro.ligado && c.rastro.forca > 0) {
    acoes.push({
      action: "fx.screenSmear.start", strength: 1, persistence: 0.78, cameraWeighted: true, jitterPx: 0, maxStepPx: 22,
      ease: "inOut", freqHz: 0.08, minStrength: 0, maxStrength: c.rastro.forca, durationMs: 0,
    });
  }
  return acoes;
}

/* -- chamas (PIXI, no mundo) ------------------------------------------------------ */

/** Cores do token da Ellén Trechend: verde-água, claro esverdeado, fundo e o aro. [cor, peso] */
export const CORES_CHAMAS = Object.freeze([[0x4fd1c5, 5], [0xa8f5ea, 3], [0x2f8f8a, 3], [0x6fe0d3, 3], [0xb3261e, 1]]);

function corPorPeso(r, tabela) {
  const total = tabela.reduce((t, [, p]) => t + p, 0);
  let alvo = r * total;
  for (const [cor, peso] of tabela) if ((alvo -= peso) < 0) return cor;
  return tabela.at(-1)[0];
}

function texturaDaChama() {
  const tela = document.createElement("canvas");
  tela.width = 48;
  tela.height = 96;
  const ctx = tela.getContext("2d");
  ctx.translate(24, 64);
  ctx.scale(1, 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.75)");
  g.addColorStop(0.6, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();
  return PIXI.Texture.from(tela);
}

function areaVisivel() {
  const tela = canvas.app.renderer.screen;
  const a = canvas.stage.toLocal({ x: 0, y: 0 });
  const b = canvas.stage.toLocal({ x: tela.width, y: tela.height });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, escala: canvas.stage.scale.x || 1 };
}

/** Cintilar de chama: soma de senos com fases próprias (0 a 1). Pura. */
export function tremeluzir(t, fase, rapido = 1) {
  const v = 0.55 + 0.25 * Math.sin(t * 7.3 * rapido + fase) + 0.15 * Math.sin(t * 13.1 * rapido + fase * 2.1)
    + 0.1 * Math.sin(t * 23.7 * rapido + fase * 0.7);
  return Math.min(1, Math.max(0, v));
}

let fogo = null;

function nascerChama(c, area, cfg, qualquerAltura) {
  // Mais nas bordas e embaixo: a mata em chamas atrás de quem foge.
  const borda = Math.random() < 0.6;
  const lado = Math.random() < 0.5 ? 0.06 : 0.94;
  c.x0 = area.x + area.w * (borda ? lado + (Math.random() - 0.5) * 0.12 : Math.random());
  c.y = qualquerAltura ? area.y + area.h * (0.3 + Math.random() * 0.7) : area.y + area.h + 30 / area.escala;
  c.subida = (35 + Math.random() * 45) * cfg.velocidade;
  c.tam = (0.6 + Math.random() * 0.9) * cfg.tamanho;
  c.balanco = 0.4 + Math.random() * 0.8;
  c.fase = Math.random() * Math.PI * 2;
  c.vida = 2.2 + Math.random() * 2.8;
  c.idade = 0;
  c.sprite.tint = corPorPeso(Math.random(), CORES_CHAMAS);
}

function iniciarChamas(cfg, semCintilar) {
  pararChamas();
  if (!cfg.ligado || cfg.quantidade <= 0 || !canvas?.stage || !canvas.app?.ticker) return;
  const container = new PIXI.Container();
  container.eventMode = "none";
  container.name = "op2-chamas-perseguicao";
  const textura = texturaDaChama();
  const area = areaVisivel();
  const lista = Array.from({ length: Math.round(cfg.quantidade) }, () => {
    const sprite = new PIXI.Sprite(textura);
    sprite.anchor.set(0.5, 0.67);
    sprite.blendMode = PIXI.BLEND_MODES.ADD;
    container.addChild(sprite);
    const c = { sprite };
    nascerChama(c, area, cfg, true);
    c.idade = Math.random() * c.vida;
    return c;
  });
  canvas.stage.addChild(container);
  let t = 0;
  const passo = () => {
    const dt = Math.min(0.1, canvas.app.ticker.deltaMS / 1000);
    t += dt;
    const area = areaVisivel();
    for (const c of lista) {
      c.idade += dt;
      c.y -= (c.subida * dt) / area.escala;
      if (c.idade > c.vida || c.y < area.y - 40 / area.escala) nascerChama(c, area, cfg, false);
      const s = c.sprite;
      const vida = c.idade / c.vida;
      s.x = c.x0 + (Math.sin(t * c.balanco * Math.PI * 2 + c.fase) * 10) / area.escala;
      s.y = c.y;
      // Cresce no começo, afina e some no fim, como língua de fogo.
      const forma = Math.sin(Math.min(1, vida) * Math.PI);
      s.scale.set((0.5 + forma * 0.7) * c.tam / area.escala, (0.7 + forma) * c.tam / area.escala);
      const brilho = semCintilar ? 0.7 : tremeluzir(t, c.fase, cfg.velocidade);
      s.alpha = Math.min(1, forma * brilho * cfg.intensidade);
    }
  };
  canvas.app.ticker.add(passo);
  fogo = { container, passo, textura };
}

function pararChamas() {
  if (!fogo) return;
  canvas?.app?.ticker?.remove(fogo.passo);
  fogo.container.destroy({ children: true });
  fogo.textura.destroy(true);
  fogo = null;
}

/* -- névoa e brilho das bordas (DOM, entre o mapa e a interface) ------------------ */

const texturasNevoa = new Map();

/** "#a9bcc0" → "169,188,192". Pura. */
export function rgbDe(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Nuvens suaves, na cor da névoa, num quadrado que emenda nas bordas (repete sem costura). */
function urlDaNevoa(cor) {
  if (texturasNevoa.has(cor)) return texturasNevoa.get(cor);
  const rgb = rgbDe(cor);
  const lado = 512;
  const tela = document.createElement("canvas");
  tela.width = tela.height = lado;
  const ctx = tela.getContext("2d");
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * lado;
    const y = Math.random() * lado;
    const r = 40 + Math.random() * 110;
    const a = 0.05 + Math.random() * 0.12;
    for (const dx of [-lado, 0, lado]) {
      for (const dy of [-lado, 0, lado]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, `rgba(${rgb},${a})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  const url = tela.toDataURL("image/png");
  texturasNevoa.set(cor, url);
  return url;
}

/** Camada entre o mapa e a interface; `depoisDe` empilha uma sobre a outra (brilho sobre a névoa). */
function camada(id, depoisDe = null) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    const ancora = (depoisDe && document.getElementById(depoisDe)) || document.getElementById("board");
    if (ancora) ancora.after(el);
    else document.body.prepend(el);
  }
  return el;
}

function ligarNevoa(cfg) {
  const el = camada("op2-nevoa-perseguicao");
  if (!cfg.ligado || cfg.opacidade <= 0) return void el.remove();
  el.className = "op2-nevoa-perseguicao";
  el.style.setProperty("--op2-nevoa-img", `url(${urlDaNevoa(cfg.cor)})`);
  el.style.setProperty("--op2-nevoa-opacidade", String(cfg.opacidade));
  el.style.setProperty("--op2-nevoa-cor", cfg.cor);
  el.style.setProperty("--op2-nevoa-dur-a", `${(70 / cfg.velocidade).toFixed(1)}s`);
  el.style.setProperty("--op2-nevoa-dur-b", `${(48 / cfg.velocidade).toFixed(1)}s`);
  if (!el.children.length) el.innerHTML = `<div class="op2-nevoa-perseguicao__a"></div><div class="op2-nevoa-perseguicao__b"></div>`;
}

/** O reflexo da luz da Ellén: a camada (o movimento e o cintilar vêm do laço da câmera). */
function ligarReflexo(cfg) {
  const el = camada("op2-reflexo-perseguicao", "op2-nevoa-perseguicao");
  if (!cfg.ligado || cfg.forca <= 0) return void el.remove();
  el.className = "op2-reflexo-perseguicao";
  el.style.setProperty("--op2-reflexo-cor", `rgb(${rgbDe(cfg.cor)})`);
  el.style.setProperty("--op2-reflexo-forca", String(cfg.forca));
}

/* -- o laço da câmera e do reflexo -------------------------------------------------- */

let laco = null;

/** Um só requestAnimationFrame: a câmera de quem corre e a luz que vem atrás. */
function iniciarLaco(cfg, semMovimento) {
  pararLaco();
  const board = document.getElementById("board");
  const reflexo = document.getElementById("op2-reflexo-perseguicao");
  const correr = cfg.corrida.ligado && !semMovimento && cfg.corrida.intensidadePx + cfg.corrida.rotacao > 0;
  if (!board || (!correr && !reflexo)) return;
  const fase = Math.random() * 10;
  const inicio = performance.now();
  if (correr) {
    const tela = board.getBoundingClientRect();
    board.style.transformOrigin = "50% 50%";
    board.dataset.op2Escala = String(escalaDaCorrida(cfg.corrida, tela.width, tela.height));
  }
  const quadro = (agora) => {
    const t = (agora - inicio) / 1000;
    if (correr) {
      const { x, y, rot } = cameraDaCorrida(t, cfg.corrida, fase);
      board.style.transform = `scale(${board.dataset.op2Escala}) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rot.toFixed(3)}deg)`;
    }
    if (reflexo) {
      // A fonte da luz vem atrás e muda de lado devagar (a criatura no encalço).
      const m = cfg.reflexo.movimento;
      const lado = 50 + 32 * m * Math.sin(t * 0.21 + fase) + 10 * m * Math.sin(t * 0.53 + fase * 2);
      const perto = 0.85 + 0.15 * Math.sin(t * 0.33 + fase);
      const brilho = semMovimento ? 1 : 1 - cfg.reflexo.cintilar * 0.45 * (1 - tremeluzir(t * 0.55, fase));
      reflexo.style.setProperty("--op2-reflexo-x", `${lado.toFixed(1)}%`);
      reflexo.style.opacity = String((cfg.reflexo.forca * perto * brilho).toFixed(3));
    }
    laco = requestAnimationFrame(quadro);
  };
  laco = requestAnimationFrame(quadro);
}

function pararLaco() {
  if (laco) cancelAnimationFrame(laco);
  laco = null;
  const board = document.getElementById("board");
  if (board) {
    board.style.transform = "";
    board.style.transformOrigin = "";
    delete board.dataset.op2Escala;
  }
}

function pararDom() {
  document.getElementById("op2-nevoa-perseguicao")?.remove();
  document.getElementById("op2-reflexo-perseguicao")?.remove();
}

/* -- pisadas ----------------------------------------------------------------------- */

let relogioPisada = null;
let pisando = null;

/** O tranco na tela deste cliente. */
export function pisada(cfg = lerConfig().pisadas, { ignorarTravas = false } = {}) {
  if (!ignorarTravas && bloqueadoAgora?.()) return;
  const board = document.getElementById("board");
  if (!board || !cfg.intensidadePx) return;
  if (pisando) cancelAnimationFrame(pisando);
  const inicio = performance.now();
  const fase = Math.random() * Math.PI;
  const quadro = (agora) => {
    const t = agora - inicio;
    if (t > cfg.duracaoMs) {
      board.style.translate = "";
      pisando = null;
      return;
    }
    const { x, y } = deslocamentoDaPisada(t, cfg, fase);
    board.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    pisando = requestAnimationFrame(quadro);
  };
  pisando = requestAnimationFrame(quadro);
  // A névoa se agita e as chamas sobem com o tranco.
  const nevoa = document.getElementById("op2-nevoa-perseguicao");
  if (nevoa) {
    nevoa.classList.remove("op2-nevoa-perseguicao--tranco");
    void nevoa.offsetWidth;
    nevoa.classList.add("op2-nevoa-perseguicao--tranco");
  }
}

/** Só o mestre ativo sorteia: todos sentem a mesma pisada ao mesmo tempo. */
function agendarPisadas(cfg) {
  clearTimeout(relogioPisada);
  relogioPisada = null;
  if (!cfg.ligado || game.users.activeGM?.id !== game.user.id) return;
  const proxima = () => {
    relogioPisada = setTimeout(() => {
      paraTodos("op2PisadaPerseguicao", {});
      pisada(lerConfig().pisadas);
      proxima();
    }, proximaPisada(cfg.intervaloMin, cfg.intervaloMax) * 1000);
  };
  proxima();
}

/* -- ligar e desligar (chamado por efeitos-cena.mjs) -------------------------------- */

let bloqueadoAgora = null;

/** Liga tudo da perseguição neste cliente. `bloqueado()` vem do efeitos-cena (travas). */
export function iniciarPerseguicaoVisual(bloqueado) {
  bloqueadoAgora = bloqueado;
  const cfg = lerConfig();
  const semMovimento = bloqueado();
  ligarNevoa(cfg.nevoa);
  ligarReflexo(cfg.reflexo);
  iniciarChamas(cfg.chamas, semMovimento);
  iniciarLaco(cfg, semMovimento);
  agendarPisadas(semMovimento ? { ...cfg.pisadas, ligado: false } : cfg.pisadas);
}

export function pararPerseguicaoVisual() {
  clearTimeout(relogioPisada);
  relogioPisada = null;
  if (pisando) cancelAnimationFrame(pisando);
  pisando = null;
  const board = document.getElementById("board");
  if (board) board.style.translate = "";
  pararLaco();
  pararChamas();
  pararDom();
}

/* -- janela de calibração ----------------------------------------------------------- */

/** Chamado no init. `aoMudar` reaplica os efeitos se a cena atual for de perseguição. */
export function registrarEfeitosDePerseguicao(aoMudar) {
  game.settings.register(SYSTEM_ID, CHAVE, {
    scope: "world", config: false, type: Object, default: configPadrao(), onChange: () => aoMudar(),
  });
  game.settings.registerMenu(SYSTEM_ID, "calibrarPerseguicaoMenu", {
    name: "OP2.EfeitosPerseguicao.MenuNome",
    label: "OP2.EfeitosPerseguicao.MenuBotao",
    hint: "OP2.EfeitosPerseguicao.MenuAjuda",
    icon: "fa-solid fa-sliders",
    type: criarJanelaDeCalibracao({
      id: "op2-calibrar-perseguicao",
      i18n: "OP2.EfeitosPerseguicao",
      chave: CHAVE,
      chaveCenas: "cenaEfeitosPerseguicao",
      padrao: configPadrao,
      mesclar: mesclarConfig,
      limites: LIMITES,
      grupos: [
        { id: "corrida", campos: [{ chave: "intensidadePx", passo: 0.5 }, { chave: "passosHz", passo: 0.1 },
          { chave: "rotacao", passo: 0.05 }, { chave: "irregularidade", passo: 0.05 }] },
        { id: "reflexo", campos: [{ chave: "forca", passo: 0.05 }, { chave: "movimento", passo: 0.05 },
          { chave: "cintilar", passo: 0.05 }, { chave: "cor", tipo: "cor" }] },
        { id: "pisadas", acao: { id: "testarPisada", icone: "fa-shoe-prints" }, campos: [
          { chave: "intervaloMin" }, { chave: "intervaloMax" }, { chave: "intensidadePx" },
          { chave: "duracaoMs", passo: 50 }, { chave: "freqHz", passo: 0.5 }] },
        { id: "nevoa", campos: [{ chave: "opacidade", passo: 0.05 }, { chave: "velocidade", passo: 0.1 }, { chave: "cor", tipo: "cor" }] },
        { id: "rastro", campos: [{ chave: "forca", passo: 0.01 }] },
        { id: "tremor", campos: [{ chave: "intensidadePx" }, { chave: "freqHz", passo: 0.05 }] },
        { id: "chamas", campos: [{ chave: "quantidade" }, { chave: "tamanho", passo: 0.1 }, { chave: "intensidade", passo: 0.05 },
          { chave: "velocidade", passo: 0.1 }] },
      ],
      // Sente a pisada com os valores do formulário, antes de salvar (só nesta tela).
      acoes: { testarPisada: (c) => pisada(c.pisadas, { ignorarTravas: true }) },
    }),
    restricted: true,
  });
  registrarAcaoDeTodos("op2PisadaPerseguicao", () => {
    if (document.getElementById("op2-nevoa-perseguicao") || fogo) pisada(lerConfig().pisadas);
  });
}
