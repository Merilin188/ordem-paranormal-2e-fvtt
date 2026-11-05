/**
 * Cenas pré-configuradas de perseguição e de furtividade ("Preparação").
 *
 * O mestre cria quantas quiser, cada uma com nome e parâmetros próprios; o painel
 * escolhe uma e, ao iniciar, guarda uma cópia dela no estado da cena (mudar a
 * configuração depois não mexe na cena em andamento).
 */
import { SYSTEM_ID, PERICIAS } from "../config.mjs";
import { TABELA_CRIATURAS } from "./furtividade-regras.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const L = (k, d) => (d ? game.i18n.format(`OP2.CenaConfig.${k}`, d) : game.i18n.localize(`OP2.CenaConfig.${k}`));
const CHAVES = { perseguicao: "perseguicoesConfig", furtividade: "furtividadesConfig" };

/* -- padrões ------------------------------------------------------------------ */

export const PERSEGUICAO_PADRAO = () => ({
  id: "ellen-trechend",
  nome: "Fuga do Ellén Trechend",
  perseguidor: "Ellén Trechend",
  rodadas: 5,
  meta: 30,
  dtAvanco: 10,
  periciaPadrao: "atletismo",
  outrasUmaVez: true,
  folego: true,
  marcos: [{ rodada: 3, pa: 15 }, { rodada: 4, pa: 20 }, { rodada: 5, pa: 30 }],
  eventos: [{
    id: "vala",
    nome: "A vala oculta",
    gatilhoPA: 15,
    descricao: "{nome} estava correndo à frente e identificou que há um buraco escondido pela vegetação rasteira, no caminho entre o grupo e a vila.",
    pericias: ["percepcao", "sobrevivencia"],
    dt: 10,
    passosFalha: -2,
    avisavel: true,
    passosAviso: 1,
    textoPassou: "{nome} percebe a vala e salta por cima dela.",
    textoFalhou: "{nome} tropeça e se desequilibra: duas reduções de passo no teste de avanço.",
  }],
  inicioRodada: {
    nome: "Ataque das cabeças",
    ataques: [
      { nome: "Uma cabeça morde", dano: "1d6", recurso: "pv", texto: "{nome} sofre {n} pontos de dano físico (mordida ou veneno)." },
      { nome: "A cabeça de muitos olhos encara", dano: "1d6", recurso: "pd", texto: "{nome} sofre {n} pontos de dano emocional." },
    ],
  },
});

const PERSEGUICAO_NOVA = (nome) => ({
  ...PERSEGUICAO_PADRAO(), id: foundry.utils.randomID(), nome, perseguidor: "",
  eventos: [], inicioRodada: { nome: L("InicioRodadaPadrao"), ataques: [] },
});

export const FURTIVIDADE_PADRAO = () => ({
  id: "esconder-padrao",
  nome: "Cena de esconder",
  dtBase: 7,
  dtPasso: 3,
  danoEncontrado: "1d6",
  tabela: Object.fromEntries(Object.entries(TABELA_CRIATURAS).map(([n, l]) => [n, {
    tipo: l.tipo, formula: l.formula ?? (l.formulas ?? []).join(", "), texto: "",
  }])),
});

const PADROES = { perseguicao: PERSEGUICAO_PADRAO, furtividade: FURTIVIDADE_PADRAO };

/* -- leitura e gravação ------------------------------------------------------- */

export function listarCenas(tipo) {
  let salvo = null;
  try { salvo = game.settings.get(SYSTEM_ID, CHAVES[tipo])?.lista; } catch { /* antes do init */ }
  return Array.isArray(salvo) && salvo.length ? foundry.utils.deepClone(salvo) : [PADROES[tipo]()];
}

export function obterCena(tipo, id) {
  const lista = listarCenas(tipo);
  return lista.find((c) => c.id === id) ?? lista[0];
}

async function gravarLista(tipo, lista) {
  await game.settings.set(SYSTEM_ID, CHAVES[tipo], { lista });
}

export async function salvarCena(tipo, cena) {
  const lista = listarCenas(tipo);
  const i = lista.findIndex((c) => c.id === cena.id);
  if (i >= 0) lista[i] = cena;
  else lista.push(cena);
  await gravarLista(tipo, lista);
}

/** "+ Nova": pede o nome, cria e abre a configuração. Devolve o id. */
export async function novaCena(tipo) {
  const nome = await DialogV2.prompt({
    window: { title: L(tipo === "perseguicao" ? "NovaPerseguicao" : "NovaFurtividade") },
    content: `<div class="form-group"><label>${L("Nome")}</label><input type="text" name="nome" autofocus></div>`,
    ok: { label: L("Criar"), callback: (_e, b) => b.form.elements.nome.value.trim() },
    rejectClose: false,
  });
  if (!nome) return null;
  const cena = tipo === "perseguicao" ? PERSEGUICAO_NOVA(nome) : { ...FURTIVIDADE_PADRAO(), id: foundry.utils.randomID(), nome };
  await salvarCena(tipo, cena);
  new ConfigCenaApp(tipo, cena.id).render({ force: true });
  return cena.id;
}

/* -- linha da tabela das criaturas a partir da configuração --------------------- */

export function linhaDaTabela(config, valor) {
  const linha = config?.tabela?.[valor] ?? TABELA_CRIATURAS[valor];
  if (!linha) return null;
  const formulas = String(linha.formula ?? (linha.formulas ?? []).join(",")).split(",").map((f) => f.trim()).filter(Boolean);
  return { tipo: linha.tipo, formula: formulas[0] ?? "1d10", formulas: [formulas[0] ?? "1d12", formulas[1] ?? formulas[0] ?? "2d10", formulas[2] ?? formulas[0] ?? "3d8"], texto: linha.texto ?? "" };
}

/* -- janela de configuração --------------------------------------------------- */

const TIPOS_LINHA = ["numeros", "sopro", "todos", "um", "nada"];

export class ConfigCenaApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(tipo, id, opcoes = {}) {
    super({ id: `op2-config-${tipo}`, ...opcoes });
    this.tipo = tipo;
    this.cena = obterCena(tipo, id);
  }

  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-cena-config"],
    tag: "form",
    window: { icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 640, height: 720 },
    form: { handler: ConfigCenaApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionar: ConfigCenaApp.#adicionar,
      remover: ConfigCenaApp.#remover,
      excluirCena: ConfigCenaApp.#excluirCena,
    },
  };

  static PARTS = {
    perseguicao: { template: "systems/ordem-paranormal-2e/templates/cena/config-perseguicao.hbs" },
    furtividade: { template: "systems/ordem-paranormal-2e/templates/cena/config-furtividade.hbs" },
  };

  get title() {
    return `${L(this.tipo === "perseguicao" ? "TituloPerseguicao" : "TituloFurtividade")}: ${this.cena.nome}`;
  }

  _configureRenderOptions(opcoes) {
    super._configureRenderOptions(opcoes);
    opcoes.parts = [this.tipo];
  }

  async _prepareContext() {
    const c = this.cena;
    const pericias = Object.keys(PERICIAS).filter((k) => k !== "aptidao")
      .map((k) => ({ k, r: game.i18n.localize(`OP2.Pericia.${k}`) }))
      .sort((a, b) => a.r.localeCompare(b.r));
    if (this.tipo === "perseguicao") {
      return {
        c, pericias: pericias.map((p) => ({ ...p, sel: p.k === c.periciaPadrao })),
        eventos: c.eventos.map((ev, i) => ({
          ...ev, i, periciasEv: pericias.map((p) => ({ ...p, sel: ev.pericias.includes(p.k) })),
        })),
        marcos: c.marcos.map((m, i) => ({ ...m, i })),
        ataques: c.inicioRodada.ataques.map((a, i) => ({ ...a, i, pv: a.recurso !== "pd" })),
        podeExcluir: listarCenas(this.tipo).length > 1,
      };
    }
    return {
      c,
      linhas: Object.entries(c.tabela).map(([n, l]) => ({
        n, ...l, padrao: game.i18n.localize(`OP2.Furtividade.Tabela.${n}`),
        tipos: TIPOS_LINHA.map((t) => ({ t, r: L(`TipoLinha.${t}`), sel: t === l.tipo })),
      })),
      podeExcluir: listarCenas(this.tipo).length > 1,
    };
  }

  /** Lê o formulário de volta para `this.cena` (antes de adicionar/remover e ao salvar). */
  #ler() {
    const f = this.element;
    const v = (nome, el = f) => el.querySelector(`[name="${nome}"]`)?.value ?? "";
    const n = (nome, el = f) => Number(v(nome, el)) || 0;
    const c = this.cena;
    c.nome = v("nome").trim() || c.nome;
    if (this.tipo === "furtividade") {
      Object.assign(c, { dtBase: n("dtBase"), dtPasso: n("dtPasso"), danoEncontrado: v("danoEncontrado").trim() || "1d6" });
      for (const el of f.querySelectorAll("[data-linha]")) {
        c.tabela[el.dataset.linha] = { tipo: v("tipo", el), formula: v("formula", el).trim(), texto: v("texto", el).trim() };
      }
      return;
    }
    Object.assign(c, {
      perseguidor: v("perseguidor").trim(), rodadas: Math.max(1, n("rodadas")), meta: n("meta"),
      dtAvanco: n("dtAvanco"), periciaPadrao: v("periciaPadrao"),
      outrasUmaVez: !!f.querySelector("[name=outrasUmaVez]")?.checked, folego: !!f.querySelector("[name=folego]")?.checked,
    });
    c.marcos = [...f.querySelectorAll("[data-marco]")].map((el) => ({ rodada: n("rodada", el), pa: n("pa", el) }));
    c.eventos = [...f.querySelectorAll("[data-evento]")].map((el, i) => ({
      id: c.eventos[i]?.id ?? foundry.utils.randomID(),
      nome: v("nome", el).trim(), gatilhoPA: n("gatilhoPA", el), descricao: v("descricao", el).trim(),
      pericias: [...el.querySelectorAll("[name=pericias] option:checked")].map((o) => o.value),
      dt: n("dt", el), passosFalha: n("passosFalha", el),
      avisavel: !!el.querySelector("[name=avisavel]")?.checked, passosAviso: n("passosAviso", el),
      textoPassou: v("textoPassou", el).trim(), textoFalhou: v("textoFalhou", el).trim(),
    }));
    c.inicioRodada = {
      nome: v("inicioNome").trim(),
      ataques: [...f.querySelectorAll("[data-ataque]")].map((el) => ({
        nome: v("nome", el).trim(), dano: v("dano", el).trim(), recurso: v("recurso", el), texto: v("texto", el).trim(),
      })),
    };
  }

  static async #adicionar(_e, alvo) {
    this.#ler();
    const c = this.cena;
    const o = alvo.dataset.lista;
    if (o === "marcos") c.marcos.push({ rodada: c.rodadas, pa: c.meta });
    if (o === "eventos") {
      c.eventos.push({
        id: foundry.utils.randomID(), nome: L("NovoEvento"), gatilhoPA: 0, descricao: "", pericias: ["percepcao"], dt: 10,
        passosFalha: -1, avisavel: false, passosAviso: 1, textoPassou: "", textoFalhou: "",
      });
    }
    if (o === "ataques") c.inicioRodada.ataques.push({ nome: L("NovoAtaque"), dano: "1d6", recurso: "pv", texto: "{nome} sofre {n} de dano." });
    this.render();
  }

  static async #remover(_e, alvo) {
    this.#ler();
    const lista = alvo.dataset.lista === "ataques" ? this.cena.inicioRodada.ataques : this.cena[alvo.dataset.lista];
    lista.splice(Number(alvo.dataset.i), 1);
    this.render();
  }

  static async #excluirCena() {
    const ok = await DialogV2.confirm({ window: { title: L("Excluir") }, content: `<p>${L("ExcluirPergunta", { nome: this.cena.nome })}</p>`, rejectClose: false });
    if (!ok) return;
    await gravarLista(this.tipo, listarCenas(this.tipo).filter((c) => c.id !== this.cena.id));
    this.close();
  }

  static async #salvar() {
    this.#ler();
    await salvarCena(this.tipo, this.cena);
    ui.notifications.info(L("Salva", { nome: this.cena.nome }));
  }
}

export function registrarCenasConfig() {
  for (const chave of Object.values(CHAVES)) {
    game.settings.register(SYSTEM_ID, chave, {
      scope: "world", config: false, type: Object, default: { lista: [] },
      onChange: () => Hooks.callAll("op2CenasConfig"),
    });
  }
}
