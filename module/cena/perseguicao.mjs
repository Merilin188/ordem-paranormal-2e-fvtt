/**
 * Cena de perseguição (Contos da Vigília, p. 73): painel compartilhado com os
 * pontos de avanço (PA), dados de fôlego, ações de perseguição, a vala oculta,
 * o ataque das cabeças no início da rodada e os cortes das rodadas 3, 4 e 5.
 *
 * Mesmo desenho da furtividade: estado num setting de mundo que só o mestre
 * grava; o jogador rola no próprio cliente e pede a gravação por `comoMestre()`.
 */
import { SYSTEM_ID } from "../config.mjs";
import { comoMestre, registrarAcaoDeMestre, paraTodos } from "../ui/socket.mjs";
import { iconeDado } from "../ui/dice-icons.mjs";
import {
  RODADAS, DT_AVANCO, DT_VALA, PA_DA_VALA, MAX_BONUS, folegoInicial, formulaDoEsforco,
  pontosDoAvanco, quemEAlcancado, proximoCorte,
} from "./perseguicao-regras.mjs";
import { animarSorteio, mostrarEncontrado, ligarVinheta } from "./furtividade.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const CHAVE = "perseguicao";
const L = (k, d) => (d ? game.i18n.format(`OP2.Perseguicao.${k}`, d) : game.i18n.localize(`OP2.Perseguicao.${k}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const ANONIMO = "icons/svg/mystery-man.svg";
const ator = (uuid) => fromUuidSync(uuid);
const nomeDe = (uuid) => ator(uuid)?.name ?? "?";

/* -- estado ----------------------------------------------------------------- */

const VAZIO = () => ({ ativa: false, cenaId: "", rodada: 1, participantes: [], criaturas: [], avisoVala: false, cabecas: false, fim: false, evento: null });

export function estadoPerseguicao() {
  let salvo = {};
  try { salvo = game.settings.get(SYSTEM_ID, CHAVE) ?? {}; } catch { /* antes do init */ }
  return { ...VAZIO(), ...foundry.utils.deepClone(salvo) };
}

const novoParticipante = (uuid) => ({
  uuid, pa: 0, folego: folegoInicial(ator(uuid)?.system?.pericias?.vigor?.dadoEfetivo ?? "d6"),
  esforcos: 0, periciasUsadas: [], vala: null, agiu: false, sacrificou: false, morto: false,
});

const vivos = (e) => e.participantes.filter((p) => !p.morto);

async function card(html) {
  await ChatMessage.create({
    content: `<div class="op2 op2-card op2-furt-card op2-pers-card">${html}</div>`,
    speaker: { alias: L("Titulo") },
    flags: { [SYSTEM_ID]: { tipo: "perseguicao" } },
  });
}

/* -- operações do mestre ------------------------------------------------------ */

const OPS = {
  iniciar(e) {
    Object.assign(e, { ativa: true, cenaId: foundry.utils.randomID(), rodada: 1, avisoVala: false, cabecas: false, fim: false, evento: null });
    e.participantes = e.participantes.map((p) => novoParticipante(p.uuid));
  },
  encerrar(e) { e.ativa = false; e.evento = null; },
  adicionar(e, { uuid, papel }) {
    if (e.participantes.some((p) => p.uuid === uuid) || e.criaturas.some((c) => c.uuid === uuid)) return;
    if (papel === "criatura") e.criaturas.push({ uuid });
    else e.participantes.push(novoParticipante(uuid));
  },
  remover(e, { uuid }) {
    e.participantes = e.participantes.filter((p) => p.uuid !== uuid);
    e.criaturas = e.criaturas.filter((c) => c.uuid !== uuid);
  },
  agiu(e, { uuid }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p) p.agiu = !p.agiu;
  },
  ajustarPA(e, { uuid, pa }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p) p.pa = Math.max(0, Number(pa) || 0);
  },
  avanco(e, { uuid, pontos, chave, folegoUsado = 0, esforco = false, vala = null }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (!p) return;
    p.pa += Math.max(0, pontos);
    p.folego = Math.max(0, p.folego - folegoUsado);
    if (esforco) p.esforcos += 1;
    if (chave !== "atletismo" && !p.periciasUsadas.includes(chave)) p.periciasUsadas.push(chave);
    if (vala) p.vala = vala;
    p.agiu = true;
  },
  folego(e, { uuid }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p) Object.assign(p, { folego: p.folego + 2, agiu: true });
  },
  sacrificio(e, { uuid }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p) Object.assign(p, { sacrificou: true, agiu: true });
  },
  outra(e, { uuid }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p) p.agiu = true;
  },
  vala(e, { uuid, vala }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p) p.vala = vala;
  },
  aviso(e) { e.avisoVala = true; },
};

let fila = Promise.resolve();
function executar({ op, ...dados }) {
  const resultado = fila.then(async () => {
    if (op === "proxima") return proximaRodada();
    if (op === "cabecas") return ataqueDasCabecas();
    const e = estadoPerseguicao();
    OPS[op]?.(e, dados);
    await game.settings.set(SYSTEM_ID, CHAVE, e);
    if (op === "aviso") await card(`<p><i class="fa-solid fa-bullhorn"></i> ${esc(L("AvisouVala", { nome: nomeDe(dados.uuid) }))}</p>`);
    if (op === "sacrificio") await card(`<p><i class="fa-solid fa-hand-fist"></i> ${esc(L("Sacrificou", { nome: nomeDe(dados.uuid) }))}</p>`);
    if (op === "folego") await card(`<p><i class="fa-solid fa-lungs"></i> ${esc(L("RecuperouFolego", { nome: nomeDe(dados.uuid) }))}</p>`);
    return true;
  });
  fila = resultado.catch((erro) => console.error(`${SYSTEM_ID} | perseguição`, erro));
  return resultado.catch(() => false);
}

const pedir = (op, dados = {}) => comoMestre("op2Perseguicao", { op, ...dados });

async function rolar(formula) {
  const roll = await new Roll(formula).evaluate();
  const { mostrarDados3D } = await import("../dice/teste.mjs");
  await mostrarDados3D(roll);
  return roll;
}

/** Sorteio na tela de todos (o mesmo da furtividade). */
async function sortear(candidatos, titulo) {
  const itens = candidatos.map((p) => ({ nome: nomeDe(p.uuid), img: ator(p.uuid)?.img ?? ANONIMO }));
  const final = Math.floor(Math.random() * itens.length);
  const passos = itens.length * Math.max(3, Math.ceil(12 / itens.length)) + final + 1;
  const sorteio = { itens, final, passos, titulo };
  paraTodos("op2FurtSorteio", sorteio);
  await animarSorteio(sorteio);
  return candidatos[final];
}

/** Início da rodada: dois personagens sorteados; o 1º sofre 1d6 PV, o 2º 1d6 PD. */
async function ataqueDasCabecas() {
  const e = estadoPerseguicao();
  if (e.cabecas) return false;
  const restantes = [...vivos(e)];
  if (!restantes.length) return false;
  const { aplicarDano } = await import("../dice/falha-critica.mjs");
  for (const [recurso, titulo] of [["pv", L("CabecaMordida")], ["pd", L("CabecaOlhos")]]) {
    if (!restantes.length) break;
    const alvo = await sortear(restantes, titulo);
    restantes.splice(restantes.indexOf(alvo), 1);
    const doc = ator(alvo.uuid);
    const roll = await rolar("1d6");
    if (doc) await aplicarDano(doc, roll.total, recurso);
    await card(`<h3>${esc(titulo)}</h3><p>${esc(L(recurso === "pv" ? "CabecaDanoPV" : "CabecaDanoPD", { nome: doc?.name ?? "?", n: roll.total }))}</p>`);
  }
  e.cabecas = true;
  await game.settings.set(SYSTEM_ID, CHAVE, estadoComCabecas());
  return true;
}
const estadoComCabecas = () => ({ ...estadoPerseguicao(), cabecas: true });

/** Fim da rodada: corte (3, 4, 5), depois a próxima rodada ou o fim da perseguição. */
async function proximaRodada() {
  const e = estadoPerseguicao();
  const { corte, alvo, empate } = quemEAlcancado(e.participantes, e.rodada);
  let morto = alvo;
  if (!morto && empate.length) {
    // Empate na menor pontuação: teste oposto entre eles (Atletismo por padrão); o mestre marca quem perdeu.
    await card(`<p>${esc(L("Empate", { nomes: empate.map(nomeDe).join(", "), corte }))}</p>`);
    morto = await DialogV2.prompt({
      window: { title: L("EmpateTitulo") },
      content: `<p>${esc(L("EmpateAjuda"))}</p><select name="alvo">${empate.map((u) => `<option value="${u}">${esc(nomeDe(u))}</option>`).join("")}</select>`,
      ok: { label: L("Alcancado"), callback: (_e, b) => b.form.elements.alvo.value },
      rejectClose: false,
    });
    if (!morto) return false;
  }
  const eventoId = foundry.utils.randomID();
  if (morto) {
    const p = e.participantes.find((x) => x.uuid === morto);
    if (p) p.morto = true;
    e.evento = { id: eventoId, mortos: [morto] };
    await card(`<p class="op2-furt-card__encontrado"><i class="fa-solid fa-skull"></i> ${esc(L("FoiAlcancado", { nome: nomeDe(morto), corte }))}</p>`);
  } else if (corte) {
    await card(`<p>${esc(L("NinguemAlcancado", { corte }))}</p>`);
  }
  if (e.rodada >= RODADAS) {
    e.fim = true;
    const salvos = vivos(e).filter((p) => p.pa >= 30).map((p) => nomeDe(p.uuid));
    await card(`<h3>${esc(L("FimTitulo"))}</h3><p>${esc(salvos.length ? L("Salvos", { nomes: salvos.join(", ") }) : L("NinguemSalvo"))}</p>`);
  } else {
    e.rodada += 1;
    e.cabecas = false;
    e.participantes = e.participantes.map((p) => ({ ...p, agiu: false, sacrificou: false }));
  }
  await game.settings.set(SYSTEM_ID, CHAVE, e);
  return true;
}

/* -- ações do jogador --------------------------------------------------------- */

async function avancar(doc, e, p) {
  const sistema = doc.system;
  const opcoes = Object.keys(sistema.pericias ?? {})
    .filter((k) => k !== "aptidao" && (k === "atletismo" || !p.periciasUsadas.includes(k)))
    .map((k) => ({ k, r: game.i18n.localize(`OP2.Pericia.${k}`) }))
    .sort((a, b) => (a.k === "atletismo" ? -1 : b.k === "atletismo" ? 1 : a.r.localeCompare(b.r)));
  const sacrificios = e.participantes.filter((x) => x.sacrificou && x.uuid !== p.uuid && !x.morto).length;
  const maxFolego = Math.min(p.folego, Math.max(0, MAX_BONUS - sacrificios));
  const escolha = await DialogV2.prompt({
    window: { title: L("Avancar"), icon: "fa-solid fa-person-running" },
    classes: ["op2", "op2-pers-dialogo"],
    content: `<div class="op2-furt-procurar">
      <label>${esc(L("Pericia"))}<select name="chave">${opcoes.map((o) => `<option value="${o.k}">${esc(o.r)}</option>`).join("")}</select></label>
      <p class="op2-dica">${esc(L("PericiaAjuda"))}</p>
      <label>${esc(L("UsarFolego", { n: p.folego }))}<input type="number" name="folego" min="0" max="${maxFolego}" value="0"></label>
      ${sacrificios ? `<p class="op2-dica"><i class="fa-solid fa-hand-fist"></i> ${esc(L("BonusSacrificio", { n: Math.min(sacrificios, MAX_BONUS) }))}</p>` : ""}
      <label class="op2-pers-check"><input type="checkbox" name="esforco"> ${esc(L("EsforcoExtra", { formula: formulaDoEsforco(p.esforcos) }))}</label>
    </div>`,
    ok: {
      label: L("Avancar"),
      callback: (_ev, b) => ({
        chave: b.form.elements.chave.value,
        folego: Math.clamp(Number(b.form.elements.folego.value) || 0, 0, maxFolego),
        esforco: b.form.elements.esforco.checked,
      }),
    },
    rejectClose: false,
  });
  if (!escolha) return;
  const { rolarTeste } = await import("../dice/teste.mjs");

  // A vala oculta: a primeira ação de avanço com 15+ PA testa Percepção ou Sobrevivência.
  let vala = null;
  if (p.pa >= PA_DA_VALA && !p.vala) {
    const chaveVala = await DialogV2.wait({
      window: { title: L("ValaTitulo") },
      content: `<p>${esc(L("ValaAjuda"))}</p>${e.avisoVala ? `<p class="op2-dica">${esc(L("ValaAvisado"))}</p>` : ""}`,
      buttons: [
        { action: "percepcao", label: game.i18n.localize("OP2.Pericia.percepcao"), default: true },
        { action: "sobrevivencia", label: game.i18n.localize("OP2.Pericia.sobrevivencia") },
      ],
      rejectClose: false,
    });
    if (!chaveVala) return;
    const teste = await rolarTeste(doc, {
      chavePericia: chaveVala, dt: DT_VALA, contexto: L("ValaTitulo"), passos: e.avisoVala ? { pericia: 1 } : null,
    });
    if (!teste) return;
    vala = teste.resultado?.sucesso ? "passou" : "falhou";
    await card(`<p>${esc(L(vala === "passou" ? "ValaPassou" : "ValaFalhou", { nome: doc.name }))}</p>`);
  }

  const d6 = (rotulo, n) => Array.from({ length: n }, (_, i) => ({ chave: `${rotulo}.${i}`, rotulo: L(rotulo), tipo: "extra", dado: "d6" }));
  const extras = [...d6("Folego", escolha.folego), ...d6("Sacrificio", Math.min(sacrificios, MAX_BONUS))];
  const passos = (escolha.esforco ? 1 : 0) + (vala === "falhou" ? -2 : 0);
  const roll = await rolarTeste(doc, {
    chavePericia: escolha.chave, dt: DT_AVANCO, contexto: L("TesteAvanco"), dadosExtras: extras,
    passos: passos ? { pericia: passos } : null,
  });
  if (!roll) {
    if (vala) await pedir("vala", { uuid: doc.uuid, vala });
    return;
  }
  if (escolha.esforco) {
    const perda = await rolar(formulaDoEsforco(p.esforcos));
    const { aplicarDano } = await import("../dice/falha-critica.mjs");
    await aplicarDano(doc, perda.total, "pv");
    await card(`<p>${esc(L("EsforcoPerdeu", { nome: doc.name, n: perda.total }))}</p>`);
  }
  const pontos = pontosDoAvanco(roll.resultado ?? {});
  await card(`<p><i class="fa-solid fa-person-running"></i> ${esc(L("Avancou", { nome: doc.name, n: pontos }))}</p>`);
  await pedir("avanco", { uuid: doc.uuid, pontos, chave: escolha.chave, folegoUsado: escolha.folego, esforco: escolha.esforco, vala });
}

const ACOES = {
  avancar,
  folego: (doc) => pedir("folego", { uuid: doc.uuid }),
  sacrificio: (doc) => pedir("sacrificio", { uuid: doc.uuid }),
  outra: (doc) => pedir("outra", { uuid: doc.uuid }),
  aviso: (doc) => pedir("aviso", { uuid: doc.uuid }),
};

/* -- painel ------------------------------------------------------------------- */

export class PerseguicaoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-perseguicao",
    classes: ["op2", "op2-furtividade", "op2-perseguicao"],
    window: { title: "OP2.Perseguicao.Titulo", icon: "fa-solid fa-person-running", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      iniciar: () => pedir("iniciar"),
      encerrar: PerseguicaoApp.#encerrar,
      proxima: () => pedir("proxima"),
      cabecas: () => pedir("cabecas"),
      remover: (_e, alvo) => pedir("remover", { uuid: alvo.dataset.uuid }),
      agiu: (_e, alvo) => pedir("agiu", { uuid: alvo.dataset.uuid }),
      ficha: (_e, alvo) => ator(alvo.dataset.uuid)?.sheet?.render(true),
      jogador: PerseguicaoApp.#jogador,
    },
  };

  static PARTS = { corpo: { template: "systems/ordem-paranormal-2e/templates/cena/perseguicao.hbs" } };

  async _prepareContext() {
    const e = estadoPerseguicao();
    const gm = game.user.isGM;
    const corte = proximoCorte(e.rodada);
    return {
      gm, ativa: e.ativa, rodada: e.rodada, total: RODADAS, fim: e.fim, cabecas: e.cabecas,
      corte, avisoVala: e.avisoVala,
      criaturas: e.criaturas.map((c) => ({ uuid: c.uuid, nome: nomeDe(c.uuid), img: ator(c.uuid)?.img ?? ANONIMO })),
      participantes: e.participantes.map((p) => {
        const doc = ator(p.uuid);
        const dono = !!doc?.isOwner && !gm;
        return {
          ...p, nome: doc?.name ?? "?", img: doc?.img ?? ANONIMO,
          dono, podeMarcar: gm || !!doc?.isOwner,
          largura: Math.min(100, Math.round((p.pa / 35) * 100)),
          abaixo: corte ? p.pa < corte.pa : false,
          folegoIcones: iconeDado("d6", { texto: p.folego }),
          podeAvisar: dono && p.vala === "passou" && !e.avisoVala,
          podeAgir: dono && e.ativa && !e.fim && !p.agiu && !p.morto,
        };
      }),
    };
  }

  get _dragDrop() {
    return this._op2DragDrop ??= new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".op2-furt",
      permissions: { drop: () => game.user.isGM },
      callbacks: { drop: this.#aoSoltar.bind(this) },
    });
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    this._dragDrop.bind(this.element);
    // PA editável pelo mestre (correções e regras da casa).
    for (const campo of this.element.querySelectorAll("[data-pa]")) {
      campo.addEventListener("change", () => pedir("ajustarPA", { uuid: campo.dataset.pa, pa: campo.value }));
    }
  }

  async #aoSoltar(evento) {
    let dados;
    try { dados = JSON.parse(evento.dataTransfer.getData("text/plain")); } catch { return; }
    if (dados?.type !== "Actor") return;
    const doc = await fromUuid(dados.uuid);
    if (!doc) return;
    const papel = evento.target.closest("[data-zona]")?.dataset.zona ?? (doc.type === "personagem" ? "personagem" : "criatura");
    await pedir("adicionar", { uuid: doc.uuid, papel });
  }

  static async #encerrar() {
    const ok = await DialogV2.confirm({ window: { title: L("Encerrar") }, content: `<p>${esc(L("EncerrarPergunta"))}</p>`, rejectClose: false });
    if (ok) await pedir("encerrar");
  }

  static async #jogador(_e, alvo) {
    const { uuid, acao } = alvo.dataset;
    const doc = await fromUuid(uuid);
    const e = estadoPerseguicao();
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (!doc?.isOwner || !p) return;
    await ACOES[acao]?.(doc, e, p);
  }
}

let painel = null;
export function abrirPerseguicao() {
  painel ??= new PerseguicaoApp();
  painel.render({ force: true });
  return painel;
}

/* -- registro ----------------------------------------------------------------- */

let estavaAtiva = false;
let ultimoEvento = null;

function aoMudar(valor) {
  const e = { ...VAZIO(), ...(valor ?? {}) };
  ligarVinheta("perseguicao", e.ativa);
  if (e.ativa && !estavaAtiva) abrirPerseguicao();
  estavaAtiva = e.ativa;
  atualizarBotao(e.ativa);
  if (painel?.rendered) painel.render();
  if (e.evento?.id && e.evento.id !== ultimoEvento) {
    ultimoEvento = e.evento.id;
    (e.evento.mortos ?? []).forEach((uuid, i) => setTimeout(() => mostrarEncontrado(uuid, L("Alcancado")), 600 + i * 4700));
  }
}

function posicionarBotao() {
  const botao = document.getElementById("op2-botao-perseguicao");
  if (botao) botao.style.right = `${(document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0) + 12}px`;
}

function atualizarBotao(ativa) {
  const botao = document.getElementById("op2-botao-perseguicao");
  if (botao) botao.style.display = game.user.isGM || ativa ? "" : "none";
}

function criarBotao() {
  if (document.getElementById("op2-botao-perseguicao")) return;
  const botao = document.createElement("button");
  botao.id = "op2-botao-perseguicao";
  botao.type = "button";
  botao.className = "op2 op2-botao-flutuante op2-botao-flutuante--perseguicao";
  botao.dataset.tooltip = L("Titulo");
  botao.dataset.tooltipDirection = "LEFT";
  botao.innerHTML = `<i class="fa-solid fa-person-running" aria-hidden="true"></i>`;
  botao.addEventListener("click", () => (painel?.rendered ? painel.close() : abrirPerseguicao()));
  document.body.appendChild(botao);
  posicionarBotao();
  document.getElementById("sidebar")?.addEventListener("transitionend", posicionarBotao);
}

export function registrarPerseguicao() {
  game.settings.register(SYSTEM_ID, CHAVE, { scope: "world", config: false, type: Object, default: {}, onChange: aoMudar });
  registrarAcaoDeMestre("op2Perseguicao", executar);
  Hooks.once("ready", () => {
    const e = estadoPerseguicao();
    estavaAtiva = e.ativa;
    ultimoEvento = e.evento?.id ?? null;
    criarBotao();
    atualizarBotao(e.ativa);
    ligarVinheta("perseguicao", e.ativa);
  });
  Hooks.on("collapseSidebar", () => setTimeout(posicionarBotao, 400));
  Hooks.on("updateActor", () => { if (painel?.rendered) painel.render(); });
}
