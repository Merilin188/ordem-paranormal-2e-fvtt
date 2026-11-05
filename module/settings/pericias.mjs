/**
 * Perícias do mundo: o mestre esconde, renomeia e cria perícias.
 *
 * Serve às duas ambientações: campanha medieval (Ocultismo → "Bruxaria", Máquinas
 * escondida) e atual (tudo como vem). A configuração mexe em `PERICIAS` no `init`,
 * ANTES de o schema do personagem ser montado — por isso perícia nova vira campo de
 * verdade em `system.pericias` e entra em teste, ficha e listas sem caso especial.
 * Mudou a configuração? Todo mundo recarrega.
 */
import { SYSTEM_ID, PERICIAS, ATRIBUTOS, ESCADA, APTIDOES_PADRAO } from "../config.mjs";

const CHAVE = "periciasMundo";
const VAZIA = { ocultas: [], nomes: {}, novas: {}, aptOcultas: [], aptNomes: {}, aptNovas: {} };
const ORIGINAIS = new Set(Object.keys(PERICIAS));
const APT_ORIGINAIS = new Set(APTIDOES_PADRAO);

/** Lê a configuração direto dos dados do mundo: no `init` o setting ainda não responde. */
function lerBruta() {
  try {
    if (game.settings?.settings?.has?.(`${SYSTEM_ID}.${CHAVE}`) && game.ready) {
      return { ...VAZIA, ...game.settings.get(SYSTEM_ID, CHAVE) };
    }
  } catch { /* cai no bruto */ }
  const reg = game.data?.settings?.find?.((s) => s.key === `${SYSTEM_ID}.${CHAVE}`);
  if (!reg) return { ...VAZIA };
  try {
    const v = typeof reg.value === "string" ? JSON.parse(reg.value) : reg.value;
    return { ...VAZIA, ...(v ?? {}) };
  } catch { return { ...VAZIA }; }
}

let atual = { ...VAZIA };

/** "Grão-Mestre de Armas" → "grao-mestre-de-armas". */
export function slugDePericia(nome) {
  return String(nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Chamado no `init`, depois de registrar os settings e antes de qualquer documento existir. */
export function registrarPericiasDoMundo() {
  game.settings.register(SYSTEM_ID, CHAVE, {
    scope: "world", config: false, type: Object, default: VAZIA,
  });
  game.settings.registerMenu(SYSTEM_ID, "periciasMenu", {
    name: "OP2.PericiasMundo.MenuNome",
    label: "OP2.PericiasMundo.MenuBotao",
    hint: "OP2.PericiasMundo.MenuAjuda",
    icon: "fa-solid fa-list-check",
    type: PericiasMundoApp,
    restricted: true,
  });
  atual = lerBruta();
  for (const [chave, def] of Object.entries(atual.novas ?? {})) {
    if (ORIGINAIS.has(chave) || !def?.rotulo) continue;
    PERICIAS[chave] = {
      atributo: ATRIBUTOS[def.atributo] ? def.atributo : "mente",
      die: ESCADA.includes(def.die) ? def.die : "d4",
      personalizada: true,
    };
  }
  // Campos de Aptidão criados pelo mestre: viram campos padrão (fichas novas nascem
  // com eles; as antigas recebem em `prepareDerivedData`, ver `aptidoesDoMundo`).
  for (const [sub, def] of Object.entries(atual.aptNovas ?? {})) {
    if (!APT_ORIGINAIS.has(sub) && def?.rotulo && !APTIDOES_PADRAO.includes(sub)) APTIDOES_PADRAO.push(sub);
  }
  // Os nomes entram nas traduções assim que elas carregam.
  Hooks.once("i18nInit", aplicarNomes);
}

/** Nome que vem do idioma, antes de o mestre renomear (a janela mostra os dois). */
const ROTULOS_ORIGINAIS = {};

function aplicarNomes() {
  const tr = game.i18n.translations;
  tr.OP2 ??= {}; tr.OP2.Pericia ??= {};
  for (const c of ORIGINAIS) ROTULOS_ORIGINAIS[c] = tr.OP2.Pericia[c] ?? c;
  for (const [chave, def] of Object.entries(atual.novas ?? {})) {
    if (PERICIAS[chave]?.personalizada) tr.OP2.Pericia[chave] = def.rotulo;
  }
  for (const [chave, nome] of Object.entries(atual.nomes ?? {})) {
    if (nome?.trim() && PERICIAS[chave]) tr.OP2.Pericia[chave] = nome.trim();
  }
  tr.OP2.Aptidao ??= {};
  for (const c of APT_ORIGINAIS) APT_ROTULOS_ORIGINAIS[c] = tr.OP2.Aptidao[c] ?? c;
  for (const [sub, def] of Object.entries(atual.aptNovas ?? {})) if (def?.rotulo) tr.OP2.Aptidao[sub] = def.rotulo;
  for (const [sub, nome] of Object.entries(atual.aptNomes ?? {})) {
    if (nome?.trim() && APT_ORIGINAIS.has(sub)) tr.OP2.Aptidao[sub] = nome.trim();
  }
}

const APT_ROTULOS_ORIGINAIS = {};

/** O campo de Aptidão aparece na ficha e nas listas de teste? */
export function aptidaoVisivel(sub) {
  return !(atual.aptOcultas ?? []).includes(sub);
}

/** Campos criados pelo mestre, com o dado inicial: `{ sub: "d6" }`. */
export function aptidoesDoMundo() {
  return Object.fromEntries(Object.entries(atual.aptNovas ?? {})
    .filter(([, d]) => d?.rotulo).map(([sub, d]) => [sub, ESCADA.includes(d.die) ? d.die : "d4"]));
}

/** A perícia aparece na ficha e nas listas de teste? */
export function periciaVisivel(chave) {
  return !(atual.ocultas ?? []).includes(chave);
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PericiasMundoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-pericias-mundo",
    classes: ["op2", "op2-pericias-mundo"],
    tag: "form",
    window: { title: "OP2.PericiasMundo.Titulo", icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 620, height: "auto" },
    form: { handler: PericiasMundoApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionar: PericiasMundoApp.#adicionar,
      remover: PericiasMundoApp.#remover,
      adicionarApt: PericiasMundoApp.#adicionarApt,
      removerApt: PericiasMundoApp.#removerApt,
      restaurar: PericiasMundoApp.#restaurar,
    },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/ui/pericias-mundo.hbs` } };

  constructor(opcoes) {
    super(opcoes);
    this.rascunho = foundry.utils.deepClone(lerBruta());
  }

  async _prepareContext() {
    const r = this.rascunho;
    const atributos = Object.keys(ATRIBUTOS).map((c) => ({ c, rotulo: game.i18n.localize(`OP2.Atributo.${c}`) }));
    const dados = ESCADA.map((d) => ({ d, rotulo: `${d} — ${game.i18n.localize(`OP2.PericiasMundo.Treino.${d}`)}` }));
    const original = (c) => ROTULOS_ORIGINAIS[c] ?? game.i18n.localize(`OP2.Pericia.${c}`);
    const linhas = [...ORIGINAIS].filter((c) => c !== "aptidao").map((c) => ({
      chave: c,
      original: original(c),
      nome: r.nomes?.[c] ?? "",
      visivel: !r.ocultas?.includes(c),
      atributo: game.i18n.localize(`OP2.Atributo.${PERICIAS[c].atributo}`),
    })).sort((a, b) => a.original.localeCompare(b.original, "pt-BR"));
    const novas = Object.entries(r.novas ?? {}).map(([c, d]) => ({
      chave: c, rotulo: d.rotulo, visivel: !r.ocultas?.includes(c),
      atributos: atributos.map((a) => ({ ...a, sel: a.c === d.atributo })),
      dados: dados.map((x) => ({ ...x, sel: x.d === d.die })),
    }));
    const aptOriginal = (c) => APT_ROTULOS_ORIGINAIS[c] ?? game.i18n.localize(`OP2.Aptidao.${c}`);
    const aptLinhas = [...APT_ORIGINAIS].map((c) => ({
      chave: c, original: aptOriginal(c), nome: r.aptNomes?.[c] ?? "", visivel: !r.aptOcultas?.includes(c),
    }));
    const aptNovas = Object.entries(r.aptNovas ?? {}).map(([c, d]) => ({
      chave: c, rotulo: d.rotulo, visivel: !r.aptOcultas?.includes(c),
      dados: dados.map((x) => ({ ...x, sel: x.d === d.die })),
    }));
    return { linhas, novas, atributos, dados, aptLinhas, aptNovas };
  }

  /** Copia o que está digitado na janela para o rascunho (antes de redesenhar). */
  #lerFormulario() {
    const f = this.element;
    if (!f) return;
    const r = this.rascunho;
    r.ocultas = [...f.querySelectorAll("input[data-visivel]")].filter((i) => !i.checked).map((i) => i.dataset.visivel);
    r.nomes = {};
    for (const i of f.querySelectorAll("input[data-nome]")) if (i.value.trim()) r.nomes[i.dataset.nome] = i.value.trim();
    for (const linha of f.querySelectorAll("[data-nova]")) {
      const d = r.novas[linha.dataset.nova];
      if (!d) continue;
      d.rotulo = linha.querySelector("[name=rotulo]").value.trim() || d.rotulo;
      d.atributo = linha.querySelector("[name=atributo]").value;
      d.die = linha.querySelector("[name=die]").value;
    }
    r.aptOcultas = [...f.querySelectorAll("input[data-apt-visivel]")].filter((i) => !i.checked).map((i) => i.dataset.aptVisivel);
    r.aptNomes = {};
    for (const i of f.querySelectorAll("input[data-apt-nome]")) if (i.value.trim()) r.aptNomes[i.dataset.aptNome] = i.value.trim();
    r.aptNovas ??= {};
    for (const linha of f.querySelectorAll("[data-apt-nova]")) {
      const d = r.aptNovas[linha.dataset.aptNova];
      if (!d) continue;
      d.rotulo = linha.querySelector("[name=rotulo]").value.trim() || d.rotulo;
      d.die = linha.querySelector("[name=die]").value;
    }
  }

  static #adicionarApt() {
    this.#lerFormulario();
    const f = this.element;
    const nome = f.querySelector("[name=novoAptNome]").value.trim();
    const sub = slugDePericia(nome);
    if (!sub) return ui.notifications.warn(game.i18n.localize("OP2.PericiasMundo.SemNome"));
    const existe = APT_ORIGINAIS.has(sub) || this.rascunho.aptNovas?.[sub]
      || Object.values(APT_ROTULOS_ORIGINAIS).some((r) => slugDePericia(r) === sub);
    if (existe) return ui.notifications.warn(game.i18n.format("OP2.PericiasMundo.JaExiste", { nome }));
    this.rascunho.aptNovas ??= {};
    this.rascunho.aptNovas[sub] = { rotulo: nome, die: f.querySelector("[name=novoAptDado]").value };
    this.render();
  }

  static #removerApt(_ev, alvo) {
    this.#lerFormulario();
    delete this.rascunho.aptNovas[alvo.dataset.chave];
    this.render();
  }

  static #adicionar() {
    this.#lerFormulario();
    const f = this.element;
    const nome = f.querySelector("[name=novoNome]").value.trim();
    const chave = slugDePericia(nome);
    if (!chave) return ui.notifications.warn(game.i18n.localize("OP2.PericiasMundo.SemNome"));
    if (ORIGINAIS.has(chave) || this.rascunho.novas[chave]) {
      return ui.notifications.warn(game.i18n.format("OP2.PericiasMundo.JaExiste", { nome }));
    }
    this.rascunho.novas[chave] = {
      rotulo: nome, atributo: f.querySelector("[name=novoAtributo]").value, die: f.querySelector("[name=novoDado]").value,
    };
    this.render();
  }

  static #remover(_ev, alvo) {
    this.#lerFormulario();
    delete this.rascunho.novas[alvo.dataset.chave];
    this.render();
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
    else ui.notifications.info(game.i18n.localize("OP2.PericiasMundo.Recarregar"));
  }
}

export function abrirPericiasMundo() {
  if (!game.user.isGM) return;
  new PericiasMundoApp().render({ force: true });
}
