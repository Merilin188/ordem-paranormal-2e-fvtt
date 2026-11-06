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

/**
 * Sangue escorrendo, em pixels da tela (o filtro não deforma): cortina irregular
 * no topo e gotas com a ponta inchada, cada uma descendo no seu tempo. O filtro
 * deforma a borda com ruído, escurece em manchas e acende um brilho úmido.
 */
function svgDoSangue(id) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const r = Math.random;
  let cortina = `M0 0 H${w} V${h * 0.06}`;
  for (let x = w; x >= 0; x -= w / 48) cortina += ` L${x.toFixed(1)} ${(h * (0.035 + r() * 0.07)).toFixed(1)}`;
  cortina += " Z";
  const gotas = Array.from({ length: Math.round(w / 55) }, () => {
    const x = r() * w;
    const larg = 5 + r() * 16;
    const y0 = h * 0.05;
    const comp = h * (0.12 + r() * r() * 0.85);
    const fim = y0 + comp;
    return `<g class="op2-alc-gota" style="--dur:${(1.8 + r() * 3).toFixed(2)}s;--atraso:${(r() * 1.4).toFixed(2)}s">
      <path d="M${x - larg / 2} ${y0} C${x - larg / 2} ${y0 + comp * 0.55} ${x - larg * 0.25} ${fim} ${x} ${fim} C${x + larg * 0.25} ${fim} ${x + larg / 2} ${y0 + comp * 0.55} ${x + larg / 2} ${y0} Z"/>
      <ellipse cx="${x}" cy="${fim - larg * 0.15}" rx="${larg * 0.62}" ry="${larg * 0.8}"/></g>`;
  }).join("");
  return `<svg class="op2-alcancado__sangue" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs>
      <filter id="${id}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.011 0.028" numOctaves="3" seed="${Math.floor(r() * 99)}" result="ruido"/>
        <feDisplacementMap in="SourceGraphic" in2="ruido" scale="22" xChannelSelector="R" yChannelSelector="G" result="forma"/>
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="${Math.floor(r() * 99)}" result="manchas"/>
        <feColorMatrix in="manchas" type="matrix" values="0 0 0 0 0.09  0 0 0 0 0  0 0 0 0 0.01  1.4 0 0 0 -0.55" result="escuro"/>
        <feComposite in="escuro" in2="forma" operator="in" result="manchado"/>
        <feGaussianBlur in="forma" stdDeviation="5" result="relevo"/>
        <feSpecularLighting in="relevo" surfaceScale="6" specularConstant="0.85" specularExponent="30" lighting-color="#ff8f8f" result="luz">
          <feDistantLight azimuth="235" elevation="52"/>
        </feSpecularLighting>
        <feComposite in="luz" in2="forma" operator="in" result="brilho"/>
        <feMerge><feMergeNode in="forma"/><feMergeNode in="manchado"/><feMergeNode in="brilho"/></feMerge>
      </filter>
    </defs>
    <g filter="url(#${id})" fill="#560008"><path class="op2-alc-cortina" d="${cortina}"/>${gotas}</g>
  </svg>`;
}

/**
 * Três rasgos de garra sobre o retrato: borda rasgada (ruído), fundo quase preto,
 * carne viva vermelha nas bordas com brilho úmido, e um fio escorrendo de cada um.
 */
function svgDasGarras(id) {
  const rasgo = (x0, y0, x1, y1, larg) => {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const nx = -(y1 - y0);
    const ny = x1 - x0;
    const n = Math.hypot(nx, ny);
    const ax = (nx / n) * larg;
    const ay = (ny / n) * larg;
    const curva = 3;
    return `M${x0} ${y0} Q${mx + ax + curva} ${my + ay} ${x1} ${y1} Q${mx - ax * 0.7 + curva} ${my - ay * 0.7} ${x0} ${y0} Z`;
  };
  const rasgos = [0, 1, 2].map((i) => {
    const x0 = 34 + i * 15;
    const x1 = 12 + i * 15;
    const larg = 4.2 - i * 0.6;
    return `<g class="op2-alc-rasgo" style="--atraso:${(1.25 + i * 0.1).toFixed(2)}s">
      <path d="${rasgo(x0, 4, x1, 96, larg + 1.3)}" fill="#6e0610"/>
      <path d="${rasgo(x0, 6, x1, 94, larg)}" fill="#0b0002"/>
      <path d="M${(x0 + x1) / 2 - 1} 55 q -0.6 9 0.4 18" stroke="#5a0008" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    </g>`;
  }).join("");
  return `<svg class="op2-alcancado__garras" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="5" result="ruido"/>
        <feDisplacementMap in="SourceGraphic" in2="ruido" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="borda"/>
        <feGaussianBlur in="borda" stdDeviation="0.7" result="relevo"/>
        <feSpecularLighting in="relevo" surfaceScale="2.5" specularConstant="0.7" specularExponent="20" lighting-color="#ff7070" result="luz">
          <feDistantLight azimuth="225" elevation="42"/>
        </feSpecularLighting>
        <feComposite in="luz" in2="borda" operator="in" result="brilho"/>
        <feDropShadow in="borda" dx="0" dy="0" stdDeviation="1.2" flood-color="#000" flood-opacity="0.9" result="sombra"/>
        <feMerge><feMergeNode in="sombra"/><feMergeNode in="borda"/><feMergeNode in="brilho"/></feMerge>
      </filter>
    </defs>
    <g filter="url(#${id})">${rasgos}</g>
  </svg>`;
}

/** Sangue tomando a tela, garras rasgando o retrato ao meio e o rugido. Dura ~5,5 s. */
export function mostrarAlcancado(uuid, rotulo) {
  const doc = fromUuidSync(uuid);
  if (!doc) return;
  const img = esc(doc.img);
  const sufixo = foundry.utils.randomID(6);
  const el = document.createElement("div");
  el.className = "op2 op2-alcancado";
  el.innerHTML = `
    ${svgDoSangue(`op2-sangue-${sufixo}`)}
    <div class="op2-alcancado__cobertura"></div>
    <div class="op2-alcancado__retrato">
      <div class="op2-alcancado__metade op2-alcancado__metade--esq" style="background-image:url('${img}')"></div>
      <div class="op2-alcancado__metade op2-alcancado__metade--dir" style="background-image:url('${img}')"></div>
      ${svgDasGarras(`op2-garras-${sufixo}`)}
    </div>
    <div class="op2-alcancado__texto"><small>${esc(rotulo)}</small><strong>${esc(doc.name)}</strong></div>`;
  document.body.append(el);
  setTimeout(tocarRugido, 900);
  setTimeout(() => el.remove(), 6200);
}
