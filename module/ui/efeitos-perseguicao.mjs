/* global PIXI */
/**
 * Efeitos da cena de perseguição ("Caminho para Bellynyr"): a Ellén Trechend vem
 * atrás do grupo.
 *
 * - Tremor contínuo mais forte e mais rápido que o das matas (FX Bus).
 * - Pisadas: de 40 a 70 s, um tranco forte na tela inteira, como a criatura pisando
 *   perto. O mestre sorteia o momento e todos sentem juntos.
 * - Névoa densa em duas camadas que correm, sem fechar a vista da cena.
 * - Chamas espectrais nas cores do token da Ellén (verde-água, um branco-esverdeado e
 *   um toque de vermelho do aro) subindo e tremeluzindo, e um brilho nas bordas.
 *
 * Tudo calibrável pelo mestre em Configurações → "Calibrar efeitos da perseguição".
 * Sem som (respiração e batimento já vêm da perseguição). Respeita as travas de
 * fotossensibilidade/movimento reduzido: sem tremor, sem pisada e sem cintilar.
 */
import { SYSTEM_ID } from "../config.mjs";
import { paraTodos, registrarAcaoDeTodos } from "./socket.mjs";

const CHAVE = "efeitosPerseguicaoConfig";
const L = (k, d) => (d ? game.i18n.format(`OP2.EfeitosPerseguicao.${k}`, d) : game.i18n.localize(`OP2.EfeitosPerseguicao.${k}`));

/* -- configuração ---------------------------------------------------------------- */

/** Os valores de partida. Cada número tem limite (ver LIMITES) para não enjoar ninguém. */
export const configPadrao = () => ({
  tremor: { ligado: true, intensidadePx: 9, freqHz: 0.8 },
  rastro: { ligado: true, forca: 0.1 },
  pisadas: { ligado: true, intervaloMin: 40, intervaloMax: 70, intensidadePx: 24, duracaoMs: 1100, freqHz: 9 },
  nevoa: { ligado: true, opacidade: 0.5, velocidade: 1, cor: "#a9bcc0" },
  chamas: { ligado: true, quantidade: 28, tamanho: 1, intensidade: 0.85, velocidade: 1, bordas: 0.55 },
});

/** [mín, máx] de cada número: o teto do tremor e da pisada é o que evita enjoo. */
export const LIMITES = Object.freeze({
  "tremor.intensidadePx": [0, 18], "tremor.freqHz": [0.05, 1.6],
  "rastro.forca": [0, 0.3],
  "pisadas.intervaloMin": [10, 600], "pisadas.intervaloMax": [10, 900],
  "pisadas.intensidadePx": [0, 40], "pisadas.duracaoMs": [200, 2500], "pisadas.freqHz": [2, 14],
  "nevoa.opacidade": [0, 0.85], "nevoa.velocidade": [0.1, 4],
  "chamas.quantidade": [0, 80], "chamas.tamanho": [0.3, 3], "chamas.intensidade": [0, 1.5],
  "chamas.velocidade": [0.2, 3], "chamas.bordas": [0, 1],
});

/** O salvo por cima do padrão, com os números dentro dos limites. Pura. */
export function mesclarConfig(salvo = {}) {
  // Só as chaves que o padrão conhece (nada de lixo de versão antiga), sem foundry.utils.
  const padrao = configPadrao();
  const c = configPadrao();
  for (const [grupo, campos] of Object.entries(c)) {
    for (const chave of Object.keys(campos)) {
      const v = salvo?.[grupo]?.[chave];
      if (v !== undefined && v !== null) campos[chave] = typeof padrao[grupo][chave] === "boolean" ? Boolean(v) : v;
    }
  }
  for (const [caminho, [min, max]] of Object.entries(LIMITES)) {
    const [grupo, chave] = caminho.split(".");
    const v = Number(c[grupo][chave]);
    c[grupo][chave] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao[grupo][chave];
  }
  if (c.pisadas.intervaloMax < c.pisadas.intervaloMin) c.pisadas.intervaloMax = c.pisadas.intervaloMin;
  if (!/^#[0-9a-f]{6}$/i.test(c.nevoa.cor)) c.nevoa.cor = configPadrao().nevoa.cor;
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

function ligarBordas(cfg, semCintilar) {
  const el = camada("op2-chamas-borda", "op2-nevoa-perseguicao");
  if (!cfg.ligado || cfg.bordas <= 0) return void el.remove();
  el.className = `op2-chamas-borda${semCintilar ? "" : " op2-chamas-borda--viva"}`;
  el.style.setProperty("--op2-chamas-forca", String(cfg.bordas));
}

function pararDom() {
  document.getElementById("op2-nevoa-perseguicao")?.remove();
  document.getElementById("op2-chamas-borda")?.remove();
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
  ligarBordas(cfg.chamas, semMovimento);
  iniciarChamas(cfg.chamas, semMovimento);
  agendarPisadas(semMovimento ? { ...cfg.pisadas, ligado: false } : cfg.pisadas);
}

export function pararPerseguicaoVisual() {
  clearTimeout(relogioPisada);
  relogioPisada = null;
  if (pisando) cancelAnimationFrame(pisando);
  pisando = null;
  const board = document.getElementById("board");
  if (board) board.style.translate = "";
  pararChamas();
  pararDom();
}

/* -- janela de calibração ----------------------------------------------------------- */

/** A janela é criada só no init (o módulo carrega fora do Foundry nos testes). */
function classeCalibrar() {
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

return class CalibrarPerseguicaoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-calibrar-perseguicao",
    classes: ["op2", "op2-calibrar"],
    tag: "form",
    window: { title: "OP2.EfeitosPerseguicao.Titulo", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 520, height: "auto" },
    form: { handler: CalibrarPerseguicaoApp.#salvar, submitOnChange: false, closeOnSubmit: false },
    actions: {
      restaurar: CalibrarPerseguicaoApp.#restaurar,
      testarPisada: CalibrarPerseguicaoApp.#testarPisada,
    },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/ui/calibrar-perseguicao.hbs` } };

  async _prepareContext() {
    const c = lerConfig();
    const campo = (grupo, chave, passo = 1) => {
      const [min, max] = LIMITES[`${grupo}.${chave}`];
      return { nome: `${grupo}.${chave}`, valor: c[grupo][chave], min, max, passo, rotulo: L(`Campo.${grupo}.${chave}`) };
    };
    return {
      grupos: [
        { id: "tremor", titulo: L("Grupo.tremor"), ajuda: L("Ajuda.tremor"), ligado: c.tremor.ligado,
          campos: [campo("tremor", "intensidadePx"), campo("tremor", "freqHz", 0.05)] },
        { id: "rastro", titulo: L("Grupo.rastro"), ajuda: L("Ajuda.rastro"), ligado: c.rastro.ligado,
          campos: [campo("rastro", "forca", 0.01)] },
        { id: "pisadas", titulo: L("Grupo.pisadas"), ajuda: L("Ajuda.pisadas"), ligado: c.pisadas.ligado, testar: true,
          campos: [campo("pisadas", "intervaloMin"), campo("pisadas", "intervaloMax"), campo("pisadas", "intensidadePx"),
            campo("pisadas", "duracaoMs", 50), campo("pisadas", "freqHz", 0.5)] },
        { id: "nevoa", titulo: L("Grupo.nevoa"), ajuda: L("Ajuda.nevoa"), ligado: c.nevoa.ligado, cor: c.nevoa.cor,
          campos: [campo("nevoa", "opacidade", 0.05), campo("nevoa", "velocidade", 0.1)] },
        { id: "chamas", titulo: L("Grupo.chamas"), ajuda: L("Ajuda.chamas"), ligado: c.chamas.ligado,
          campos: [campo("chamas", "quantidade"), campo("chamas", "tamanho", 0.1), campo("chamas", "intensidade", 0.05),
            campo("chamas", "velocidade", 0.1), campo("chamas", "bordas", 0.05)] },
      ],
    };
  }

  /** Lê o formulário para a configuração (sem salvar). */
  #ler() {
    const dados = new foundry.applications.ux.FormDataExtended(this.element).object;
    const c = configPadrao();
    for (const grupo of Object.keys(c)) {
      c[grupo].ligado = Boolean(dados[`${grupo}.ligado`]);
      for (const chave of Object.keys(c[grupo])) {
        if (chave === "ligado") continue;
        const v = dados[`${grupo}.${chave}`];
        if (v !== undefined && v !== null && v !== "") c[grupo][chave] = chave === "cor" ? String(v) : Number(v);
      }
    }
    return mesclarConfig(c);
  }

  static async #salvar() {
    await game.settings.set(SYSTEM_ID, CHAVE, this.#ler());
    ui.notifications.info(L("Salvo"));
  }

  static async #restaurar() {
    await game.settings.set(SYSTEM_ID, CHAVE, configPadrao());
    this.render();
  }

  /** Sente a pisada com os valores do formulário, antes de salvar (só neste cliente). */
  static #testarPisada() {
    pisada(this.#ler().pisadas, { ignorarTravas: true });
  }
};
}

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
    type: classeCalibrar(),
    restricted: true,
  });
  registrarAcaoDeTodos("op2PisadaPerseguicao", () => {
    if (document.getElementById("op2-nevoa-perseguicao") || fogo) pisada(lerConfig().pisadas);
  });
}
