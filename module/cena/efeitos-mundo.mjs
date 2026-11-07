/**
 * Efeitos do mundo: o mestre esconde/renomeia as condições do sistema e cria as
 * próprias, com automação.
 *
 * Automações de um efeito criado:
 * - passos: aumento/redução num atributo, numa perícia ou em todos os testes;
 * - dano por rodada: PV ou PD, fórmula ("2" ou "1d4"), no fim de cada rodada;
 * - duração: some sozinho depois de N rodadas, ou no fim da cena;
 * - teste para encerrar: no fim da rodada, card com botão de teste (perícia + DT);
 * - código próprio: JavaScript do mestre, rodado no cliente do mestre em
 *   "aplicar", "fimDeRodada" e "remover".
 *
 * Igual às perícias do mundo, a configuração entra no `init` (CONFIG.statusEffects)
 * e mudar pede recarga.
 */
import { SYSTEM_ID, ATRIBUTOS, PERICIAS } from "../config.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";

const CHAVE = "efeitosMundo";
const VAZIA = { ocultos: [], nomes: {}, novos: {} };
const PREFIXO = "op2x-";
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const L = (c, d) => (d ? game.i18n.format(`OP2.EfeitosMundo.${c}`, d) : game.i18n.localize(`OP2.EfeitosMundo.${c}`));

function lerBruta() {
  try {
    if (game.ready) return { ...VAZIA, ...game.settings.get(SYSTEM_ID, CHAVE) };
  } catch { /* cai no bruto */ }
  const reg = game.data?.settings?.find?.((s) => s.key === `${SYSTEM_ID}.${CHAVE}`);
  if (!reg) return { ...VAZIA };
  try {
    const v = typeof reg.value === "string" ? JSON.parse(reg.value) : reg.value;
    return { ...VAZIA, ...(v ?? {}) };
  } catch { return { ...VAZIA }; }
}

let atual = { ...VAZIA };
/** Condições do sistema como vieram (antes de esconder/renomear). */
let ORIGINAIS = [];

const slug = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Definição normalizada de um efeito criado. */
function normalizar(d = {}) {
  return {
    nome: String(d.nome ?? "").trim(),
    icone: d.icone || "icons/svg/aura.svg",
    passos: { alvo: d.passos?.alvo ?? "", valor: Number(d.passos?.valor) || 0 },
    dano: { recurso: d.dano?.recurso === "pd" ? "pd" : "pv", formula: String(d.dano?.formula ?? "").trim() },
    duracao: { tipo: ["rodadas", "cena"].includes(d.duracao?.tipo) ? d.duracao.tipo : "", rodadas: Math.max(1, Number(d.duracao?.rodadas) || 1) },
    teste: { chave: d.teste?.chave ?? "", dt: Number(d.teste?.dt) || 7 },
    codigo: String(d.codigo ?? ""),
  };
}

export const definicaoDoEfeito = (id) => definicao(id);
const definicao = (id) => (id?.startsWith(PREFIXO) ? (atual.novos?.[id] ? normalizar(atual.novos[id]) : null) : null);

/* ================== registro (init) ================== */

/** Chamado no `init`, DEPOIS de `registrarCondicoes()` (que monta CONFIG.statusEffects). */
export function registrarEfeitosDoMundo() {
  game.settings.register(SYSTEM_ID, CHAVE, { scope: "world", config: false, type: Object, default: VAZIA });
  game.settings.registerMenu(SYSTEM_ID, "efeitosMenu", {
    name: "OP2.EfeitosMundo.MenuNome", label: "OP2.EfeitosMundo.MenuBotao", hint: "OP2.EfeitosMundo.MenuAjuda",
    icon: "fa-solid fa-wand-magic-sparkles", type: EfeitosMundoApp, restricted: true,
  });
  atual = lerBruta();
  ORIGINAIS = CONFIG.statusEffects.map((c) => ({ ...c }));
  const lista = CONFIG.statusEffects
    .filter((c) => !(atual.ocultos ?? []).includes(c.id))
    .map((c) => (atual.nomes?.[c.id]?.trim() ? { ...c, name: atual.nomes[c.id].trim() } : c));
  for (const [id, bruto] of Object.entries(atual.novos ?? {})) {
    const d = normalizar(bruto);
    if (!d.nome || (atual.ocultos ?? []).includes(id)) continue;
    lista.push({ id, name: d.nome, img: d.icone, _id: id.replace(/[^a-zA-Z0-9]/g, "").padEnd(16, "0").slice(0, 16) });
  }
  CONFIG.statusEffects = lista;

  Hooks.on("createActiveEffect", (efeito) => void aoMudar(efeito, "aplicar"));
  Hooks.on("deleteActiveEffect", (efeito) => void aoMudar(efeito, "remover"));
  Hooks.on("updateCombat", (_c, mudancas) => { if ("round" in mudancas) void fimDeRodada(); });
  Hooks.on("updateActor", (ator, mudancas) => {
    if (ator.type === "investigacao" && foundry.utils.hasProperty(mudancas, "system.rodada")) void fimDeRodada();
  });
  registrarAcaoDeChat("efeito-teste", testarParaEncerrar);
}

const souMestreAtivo = () => game.users.activeGM?.id === game.user.id;

/* ================== passos (lido em prepareDerivedData) ================== */

/** Passos que os efeitos ativos dão: `{ todos, atributo: {fisico: -1}, pericia: {luta: 1} }`. */
export function passosDosEfeitos(statuses) {
  const r = { todos: 0, atributo: {}, pericia: {} };
  if (!statuses?.size) return r;
  for (const id of statuses) {
    const d = definicao(id);
    if (!d?.passos.valor || !d.passos.alvo) continue;
    const { alvo, valor } = d.passos;
    if (alvo === "todos") r.todos += valor;
    else if (ATRIBUTOS[alvo]) r.atributo[alvo] = (r.atributo[alvo] ?? 0) + valor;
    else r.pericia[alvo] = (r.pericia[alvo] ?? 0) + valor;
  }
  return r;
}

/* ================== eventos ================== */

const chaveFlag = (id) => `efeitos.${id}`;

async function aoMudar(efeito, evento) {
  if (!souMestreAtivo()) return;
  const ator = efeito.parent;
  if (!(ator instanceof Actor)) return;
  for (const id of efeito.statuses ?? []) {
    const d = definicao(id);
    if (!d) continue;
    if (evento === "aplicar" && d.duracao.tipo === "rodadas") await ator.setFlag(SYSTEM_ID, chaveFlag(id), { restantes: d.duracao.rodadas });
    if (evento === "remover") await ator.unsetFlag(SYSTEM_ID, chaveFlag(id)).catch(() => null);
    await rodarCodigo(d, ator, id, evento);
  }
}

/** Atores com efeito: os do mundo e os tokens não vinculados da cena. */
function atoresComEfeitos() {
  const set = new Set(game.actors.filter((a) => a.statuses?.size));
  for (const t of canvas?.tokens?.placeables ?? []) if (t.actor?.statuses?.size) set.add(t.actor);
  return [...set];
}

async function fimDeRodada() {
  if (!souMestreAtivo()) return;
  for (const ator of atoresComEfeitos()) {
    for (const id of [...ator.statuses]) {
      const d = definicao(id);
      if (!d) continue;
      // Dano por rodada
      if (d.dano.formula) {
        const roll = await new Roll(d.dano.formula).evaluate().catch(() => null);
        if (roll && roll.total > 0) {
          const { aplicarDano } = await import("../dice/falha-critica.mjs");
          await aplicarDano(ator, roll.total, d.dano.recurso);
          await card(ator, d.nome, L("DanoAplicado", { ator: esc(ator.name), n: roll.total, recurso: d.dano.recurso.toUpperCase(), formula: esc(d.dano.formula) }));
        }
      }
      await rodarCodigo(d, ator, id, "fimDeRodada");
      // Teste para encerrar
      if (d.teste.chave) {
        const rotulo = game.i18n.localize(`OP2.Pericia.${d.teste.chave}`);
        await card(ator, d.nome, L("TesteConvite", { ator: esc(ator.name), pericia: esc(rotulo), dt: d.teste.dt }),
          `<div class="op2-card__acoes"><button type="button" class="op2-botao op2-botao--pequeno" data-op2-acao="efeito-teste"
            data-ator-uuid="${ator.uuid}" data-efeito="${id}">${L("TestarBotao", { pericia: esc(rotulo), dt: d.teste.dt })}</button></div>`);
      }
      // Duração em rodadas
      if (d.duracao.tipo === "rodadas") {
        const restantes = (ator.getFlag(SYSTEM_ID, chaveFlag(id))?.restantes ?? d.duracao.rodadas) - 1;
        if (restantes <= 0) {
          await ator.toggleStatusEffect(id, { active: false });
          await card(ator, d.nome, L("Terminou", { ator: esc(ator.name), nome: esc(d.nome) }));
        } else await ator.setFlag(SYSTEM_ID, chaveFlag(id), { restantes });
      }
    }
  }
}

/** Fim de cena: efeitos com duração "cena" saem. Chamado por `encerrarCena`. */
export async function encerrarCenaDosEfeitos(atores) {
  for (const ator of atores ?? []) {
    for (const id of [...(ator.statuses ?? [])]) {
      if (definicao(id)?.duracao.tipo === "cena") await ator.toggleStatusEffect(id, { active: false });
    }
  }
}

async function testarParaEncerrar(_autor, dataset) {
  const ator = await fromUuid(dataset.atorUuid);
  const d = definicao(dataset.efeito);
  if (!ator || !d || !ator.isOwner) return;
  if (!ator.statuses.has(dataset.efeito)) return void ui.notifications.info(L("JaAcabou"));
  const { rolarTeste } = await import("../dice/teste.mjs");
  const roll = await rolarTeste(ator, { chavePericia: d.teste.chave, dt: d.teste.dt, contexto: d.nome });
  if (roll?.sucesso) {
    await ator.toggleStatusEffect(dataset.efeito, { active: false });
    await card(ator, d.nome, L("Terminou", { ator: esc(ator.name), nome: esc(d.nome) }));
  }
}

async function rodarCodigo(d, ator, id, evento) {
  if (!d.codigo.trim()) return;
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction("ator", "efeito", "evento", "definicao", d.codigo)(ator, id, evento, d);
  } catch (erro) {
    console.error(`${SYSTEM_ID} | código do efeito ${d.nome}`, erro);
    ui.notifications.error(L("CodigoErro", { nome: d.nome, erro: erro.message }));
  }
}

function card(ator, titulo, texto, extra = "") {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card"><header class="op2-card__topo"><span class="op2-tag op2-tag--pequena">${esc(titulo)}</span></header>
      <p class="op2-card__texto">${texto}</p>${extra}</div>`,
  });
}

/* ================== reset de usos (ficha, só mestre) ================== */

/** Zera os usos das habilidades limitadas, com duas confirmações. */
export async function resetarUsos(ator) {
  if (!game.user.isGM) return void ui.notifications.warn(L("ResetSoMestre"));
  const { DialogV2 } = foundry.applications.api;
  const primeiro = await DialogV2.confirm({
    window: { title: L("ResetTitulo"), icon: "fa-solid fa-rotate" },
    content: `<p>${L("ResetPergunta", { nome: esc(ator.name) })}</p>`, rejectClose: false,
  });
  if (!primeiro) return;
  const segundo = await DialogV2.confirm({
    window: { title: L("ResetTitulo"), icon: "fa-solid fa-triangle-exclamation" },
    content: `<p class="op2-aviso-forte"><strong>${L("ResetAviso")}</strong></p><p>${L("ResetConfirma")}</p>`,
    yes: { label: L("ResetSim") }, rejectClose: false,
  });
  if (!segundo) return;
  const updates = ator.items.filter((i) => i.type === "habilidade").map((i) => ({
    _id: i.id,
    "system.usadoNaRodada": "",
    "system.alvosNaCena": [],
    "system.machucadoNaCena": false,
    "system.arsenal.tonico": false, "system.arsenal.balsamo": false, "system.arsenal.vespa": false,
  }));
  if (updates.length) await ator.updateEmbeddedDocuments("Item", updates);
  await ator.update({ "system.estado.acoesUsadasNaCena": [] });
  await card(ator, L("ResetTitulo"), L("ResetFeito", { nome: esc(ator.name) }));
}

/* ================== janela do mestre ================== */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EfeitosMundoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-efeitos-mundo",
    classes: ["op2", "op2-pericias-mundo", "op2-efeitos-mundo"],
    tag: "form",
    window: { title: "OP2.EfeitosMundo.Titulo", icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
    position: { width: 720, height: 760 },
    form: { handler: EfeitosMundoApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionar: EfeitosMundoApp.#adicionar,
      remover: EfeitosMundoApp.#remover,
      escolherIcone: EfeitosMundoApp.#escolherIcone,
      restaurar: EfeitosMundoApp.#restaurar,
    },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/ui/efeitos-mundo.hbs`, scrollable: [""] } };

  constructor(opcoes) {
    super(opcoes);
    this.rascunho = foundry.utils.deepClone(lerBruta());
  }

  async _prepareContext() {
    const r = this.rascunho;
    const alvos = [
      { v: "", r: L("SemPassos") }, { v: "todos", r: L("TodosTestes") },
      ...Object.keys(ATRIBUTOS).map((c) => ({ v: c, r: game.i18n.localize(`OP2.Atributo.${c}`) })),
      ...Object.keys(PERICIAS).filter((c) => c !== "aptidao").map((c) => ({ v: c, r: game.i18n.localize(`OP2.Pericia.${c}`) }))
        .sort((a, b) => a.r.localeCompare(b.r, "pt-BR")),
    ];
    const pericias = [{ v: "", r: L("SemTeste") }, ...alvos.slice(2 + Object.keys(ATRIBUTOS).length)];
    const duracoes = [{ v: "", r: L("Duracao.nenhuma") }, { v: "rodadas", r: L("Duracao.rodadas") }, { v: "cena", r: L("Duracao.cena") }];
    const marcar = (lista, valor) => lista.map((o) => ({ ...o, sel: o.v === valor }));
    return {
      sistema: ORIGINAIS.map((c) => ({
        id: c.id, img: c.img, original: game.i18n.localize(c.name),
        nome: r.nomes?.[c.id] ?? "", visivel: !r.ocultos?.includes(c.id),
      })),
      novos: Object.entries(r.novos ?? {}).map(([id, bruto]) => {
        const d = normalizar(bruto);
        return {
          id, ...d, visivel: !r.ocultos?.includes(id),
          alvos: marcar(alvos, d.passos.alvo), pericias: marcar(pericias, d.teste.chave),
          duracoes: marcar(duracoes, d.duracao.tipo),
          pv: d.dano.recurso === "pv",
        };
      }),
    };
  }

  #lerFormulario() {
    const f = this.element;
    if (!f) return;
    const r = this.rascunho;
    r.ocultos = [...f.querySelectorAll("input[data-visivel]")].filter((i) => !i.checked).map((i) => i.dataset.visivel);
    r.nomes = {};
    for (const i of f.querySelectorAll("input[data-nome]")) if (i.value.trim()) r.nomes[i.dataset.nome] = i.value.trim();
    for (const bloco of f.querySelectorAll("[data-novo]")) {
      const v = (n) => bloco.querySelector(`[name="${n}"]`)?.value ?? "";
      r.novos[bloco.dataset.novo] = normalizar({
        nome: v("nome") || r.novos[bloco.dataset.novo]?.nome, icone: v("icone"),
        passos: { alvo: v("passosAlvo"), valor: v("passosValor") },
        dano: { recurso: v("danoRecurso"), formula: v("danoFormula") },
        duracao: { tipo: v("duracaoTipo"), rodadas: v("duracaoRodadas") },
        teste: { chave: v("testeChave"), dt: v("testeDt") },
        codigo: v("codigo"),
      });
    }
  }

  static #adicionar() {
    this.#lerFormulario();
    const nome = this.element.querySelector("[name=novoNome]").value.trim();
    const s = slug(nome);
    if (!s) return ui.notifications.warn(L("SemNome"));
    const id = `${PREFIXO}${s}`;
    if (this.rascunho.novos[id] || ORIGINAIS.some((c) => c.id === s)) return ui.notifications.warn(L("JaExiste", { nome }));
    this.rascunho.novos[id] = normalizar({ nome });
    this.render();
  }

  static #remover(_ev, alvo) {
    this.#lerFormulario();
    delete this.rascunho.novos[alvo.dataset.id];
    this.render();
  }

  static #escolherIcone(_ev, alvo) {
    const campo = alvo.closest("[data-novo]")?.querySelector("[name=icone]");
    const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new Picker({ type: "image", current: campo?.value, callback: (caminho) => { if (campo) campo.value = caminho; } }).render(true);
  }

  static #restaurar() {
    this.rascunho = foundry.utils.deepClone(VAZIA);
    this.render();
  }

  static async #salvar() {
    this.#lerFormulario();
    await game.settings.set(SYSTEM_ID, CHAVE, this.rascunho);
    const Config = foundry.applications?.settings?.SettingsConfig ?? globalThis.SettingsConfig;
    if (Config?.reloadConfirm) await Config.reloadConfirm({ world: true });
    else ui.notifications.info(L("Recarregar"));
  }
}
