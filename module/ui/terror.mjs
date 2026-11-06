/**
 * Sons gerados na hora (sem arquivo) e a tela de "alcançado" da perseguição.
 * Tudo segue o volume de interface do Foundry.
 */
import { SYSTEM_ID } from "../config.mjs";

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

function volumeDeInterface() {
  try { return game.settings.get("core", "globalInterfaceVolume") ?? 0.5; } catch { return 0.5; }
}

function novoContexto() {
  const Contexto = window.AudioContext ?? window.webkitAudioContext;
  return Contexto ? new Contexto() : null;
}

function bufferDeRuido(ctx, segundos = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * segundos, ctx.sampleRate);
  const dados = buffer.getChannelData(0);
  for (let i = 0; i < dados.length; i++) dados[i] = Math.random() * 2 - 1;
  return buffer;
}

/* -- ambiente da perseguição: coração acelerado e respiração ofegante ---------- */

let ambiente = null;

/** Liga o fundo (baixo, mas perceptível) até `pararAmbientePerseguicao()`. */
export function iniciarAmbientePerseguicao() {
  if (ambiente) return;
  const volume = volumeDeInterface();
  if (volume <= 0) return;
  const ctx = novoContexto();
  if (!ctx) return;
  const mestre = ctx.createGain();
  mestre.gain.setValueAtTime(0.0001, ctx.currentTime);
  mestre.gain.exponentialRampToValueAtTime(0.22 * volume, ctx.currentTime + 2.5);
  mestre.connect(ctx.destination);

  const grave = ctx.createBiquadFilter();
  grave.type = "lowpass";
  grave.frequency.value = 150;
  grave.connect(mestre);

  const batida = (t, freq, forca) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(forca, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(grave);
    o.start(t);
    o.stop(t + 0.3);
  };

  // Respiração: gravação real (respirações espaçadas, com silêncio entre elas),
  // em loop e mais baixa que o coração para não tomar a cena.
  const respiracao = ctx.createGain();
  respiracao.gain.value = 0.42;
  respiracao.connect(mestre);
  fetch(`systems/${SYSTEM_ID}/assets/sons/perseguicao-respiracao.wav`)
    .then((r) => r.arrayBuffer())
    .then((dados) => ctx.decodeAudioData(dados))
    .then((buffer) => {
      if (ambiente?.ctx !== ctx) return;
      const fonte = ctx.createBufferSource();
      fonte.buffer = buffer;
      fonte.loop = true;
      fonte.connect(respiracao);
      fonte.start(ctx.currentTime + 0.5);
    })
    .catch((erro) => console.warn(`${SYSTEM_ID} | respiração da perseguição`, erro));

  let proximaBatida = ctx.currentTime + 0.2;
  const agendar = () => {
    const limite = ctx.currentTime + 0.3;
    while (proximaBatida < limite) {
      batida(proximaBatida, 56, 0.9);
      batida(proximaBatida + 0.2, 47, 0.55);
      proximaBatida += 0.5 + (Math.random() - 0.5) * 0.03; // ~120 bpm
    }
  };
  agendar();
  ambiente = { ctx, mestre, relogio: setInterval(agendar, 100) };
}

export function pararAmbientePerseguicao() {
  if (!ambiente) return;
  const { ctx, mestre, relogio } = ambiente;
  ambiente = null;
  clearInterval(relogio);
  try {
    mestre.gain.cancelScheduledValues(ctx.currentTime);
    mestre.gain.setValueAtTime(mestre.gain.value, ctx.currentTime);
    mestre.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
  } catch { /* contexto já fechado */ }
  setTimeout(() => ctx.close(), 1700);
}

/* -- rugido da criatura (mais alto, para assustar) ---------------------------- */

/** Rugido gravado (dois efeitos do Mixkit misturados); sem o arquivo, o sintético. */
export function tocarRugido() {
  const volume = volumeDeInterface();
  if (volume <= 0) return;
  const ctx = novoContexto();
  if (!ctx) return;
  fetch(`systems/${SYSTEM_ID}/assets/sons/perseguicao-alcancado.wav`)
    .then((r) => r.arrayBuffer())
    .then((dados) => ctx.decodeAudioData(dados))
    .then((buffer) => {
      const ganho = ctx.createGain();
      ganho.gain.value = 0.75 * volume;
      const fonte = ctx.createBufferSource();
      fonte.buffer = buffer;
      fonte.connect(ganho).connect(ctx.destination);
      fonte.onended = () => ctx.close();
      fonte.start();
    })
    .catch(() => {
      ctx.close();
      rugidoSintetico();
    });
}

function rugidoSintetico() {
  try {
    const volume = volumeDeInterface();
    if (volume <= 0) return;
    const ctx = novoContexto();
    if (!ctx) return;
    const t = ctx.currentTime;
    const mestre = ctx.createGain();
    mestre.gain.setValueAtTime(0.0001, t);
    mestre.gain.exponentialRampToValueAtTime(0.55 * volume, t + 0.12);
    mestre.gain.setValueAtTime(0.55 * volume, t + 1.4);
    mestre.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    mestre.connect(ctx.destination);

    // Distorção: a garganta rasgada.
    const distorcao = ctx.createWaveShaper();
    const curva = new Float32Array(1024);
    for (let i = 0; i < curva.length; i++) {
      const x = (i / curva.length) * 2 - 1;
      curva[i] = Math.tanh(x * 6);
    }
    distorcao.curve = curva;
    const corte = ctx.createBiquadFilter();
    corte.type = "lowpass";
    corte.frequency.setValueAtTime(1400, t);
    corte.frequency.exponentialRampToValueAtTime(500, t + 2.4);
    distorcao.connect(corte).connect(mestre);

    // Grunhido: duas serras graves com vibrato rápido.
    for (const [freq, detune] of [[82, 0], [61, 14]]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(freq * 1.3, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.5);
      o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 2.5);
      o.detune.value = detune;
      const lfo = ctx.createOscillator();
      const prof = ctx.createGain();
      lfo.frequency.value = 28;
      prof.gain.value = 9;
      lfo.connect(prof).connect(o.frequency);
      o.connect(distorcao);
      o.start(t);
      lfo.start(t);
      o.stop(t + 2.6);
      lfo.stop(t + 2.6);
    }
    // Ar raspando por cima.
    const fonte = ctx.createBufferSource();
    fonte.buffer = bufferDeRuido(ctx, 3);
    const banda = ctx.createBiquadFilter();
    banda.type = "bandpass";
    banda.frequency.value = 650;
    banda.Q.value = 0.8;
    const gRuido = ctx.createGain();
    gRuido.gain.value = 0.6;
    fonte.connect(banda).connect(gRuido).connect(distorcao);
    fonte.start(t);
    fonte.stop(t + 2.6);
    setTimeout(() => ctx.close(), 3200);
  } catch (erro) {
    console.warn(`${SYSTEM_ID} | rugido`, erro);
  }
}

/* -- tela de alcançado -------------------------------------------------------- */

export const EFEITOS = `systems/${SYSTEM_ID}/assets/efeitos`;

/**
 * Sangue tomando a tela, garras rasgando o retrato ao meio e o rugido. Dura ~5,5 s.
 * Respingos e garras são imagens pré-renderizadas: o navegador só mexe em
 * opacidade, escala e recorte, sem filtro calculado a cada quadro.
 */
export function mostrarAlcancado(uuid, rotulo) {
  const doc = fromUuidSync(uuid);
  if (!doc) return;
  const img = esc(doc.img);
  const el = document.createElement("div");
  el.className = "op2 op2-alcancado";
  el.innerHTML = `
    <div class="op2-alcancado__cobertura"></div>
    <img class="op2-alcancado__respingo r1" src="${EFEITOS}/respingos-1.webp" alt="">
    <img class="op2-alcancado__respingo r2" src="${EFEITOS}/respingos-2.webp" alt="">
    <img class="op2-alcancado__respingo r3" src="${EFEITOS}/respingos-3.webp" alt="">
    <div class="op2-alcancado__retrato">
      <div class="op2-alcancado__metade op2-alcancado__metade--esq" style="background-image:url('${img}')"></div>
      <div class="op2-alcancado__metade op2-alcancado__metade--dir" style="background-image:url('${img}')"></div>
      <img class="op2-alcancado__garras" src="${EFEITOS}/garras.webp" alt="">
    </div>
    <div class="op2-alcancado__texto"><small>${esc(rotulo)}</small><strong>${esc(doc.name)}</strong></div>`;
  document.body.append(el);
  setTimeout(tocarRugido, 900);
  setTimeout(() => el.remove(), 6200);
}

/** Baixa as imagens antes, para a primeira morte não piscar. */
export function precarregarEfeitos() {
  for (const f of ["respingos-1.webp", "respingos-2.webp", "respingos-3.webp", "garras.webp"]) {
    const imagem = new Image();
    imagem.src = `${EFEITOS}/${f}`;
  }
}
