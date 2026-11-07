/**
 * Roll de Ordem Paranormal 2.
 *
 * Um teste é a soma de N dados de tamanhos diferentes (spec §4.1), mas o total é só
 * parte do resultado: várias mecânicas leem a Rolagem Alta e a Rolagem Baixa, o maior
 * e o menor *valor individual* (spec §4.2). A leitura em si vive em `analise.mjs`,
 * que é testável sem Foundry; esta classe só faz a ponte com o Roll do core.
 */
import { MAX_DADOS_CONTADOS } from "../config.mjs";
import * as analise from "./analise.mjs";

/**
 * @typedef {object} ComponenteTeste
 * @property {string} chave       ex.: "pericia.percepcao"
 * @property {string} rotulo      texto já localizado
 * @property {"atributo"|"pericia"|"extra"} tipo
 * @property {string} dado        "d8"
 */

export class OP2Roll extends Roll {
  static CHAT_TEMPLATE = "systems/ordem-paranormal-2e/templates/chat/teste.hbs";
  static TOOLTIP_TEMPLATE = "systems/ordem-paranormal-2e/templates/chat/teste-tooltip.hbs";

  /**
   * @param {ComponenteTeste[]} componentes um dado por componente, na ordem exibida
   * @param {{dt?: number|null, escopoCritico?: "todos"|"contados", rotulo?: string, atorId?: string}} [opcoes]
   */
  static paraComponentes(componentes, opcoes = {}) {
    const formula = componentes.map((c) => `1${c.dado}`).join(" + ");
    return new this(formula, {}, {
      dt: null,
      escopoCritico: "todos",
      // Identifica o teste: o card de ataque se atualiza quando o dado do crítico rola.
      id: globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2),
      ...opcoes,
      componentes: componentes.map((c) => ({ ...c })),
    });
  }

  /** Depois de rolar: aplica o dado de pavor e acerta o total (modificador incluso). */
  async evaluate(opcoes = {}) {
    await super.evaluate(opcoes);
    this.aplicarPavor();
    this._total = this.resultado.total;
    return this;
  }

  /** @returns {ComponenteTeste[]} */
  get componentes() {
    return this.options.componentes ?? [];
  }

  /** @returns {number|null} null num teste oposto */
  get dt() {
    return this.options.dt ?? null;
  }

  get escopoCritico() {
    return this.options.escopoCritico ?? "todos";
  }

  /**
   * Um registro por dado rolado, na ordem da fórmula, casado com seu componente.
   * @returns {Array<analise.DadoRolado & {componente: ComponenteTeste}>}
   */
  get dados() {
    if (!this._evaluated) return [];
    const consumidos = new Set(this.options.consumidos ?? []);
    const lista = this.dice.map((termo, i) => {
      const componente = this.componentes[i] ?? { rotulo: `d${termo.faces}`, tipo: "extra" };
      const consumido = consumidos.has(i);
      return {
        indice: i,
        dado: `d${termo.faces}`,
        resultado: termo.results[0].result,
        contado: termo.results[0].active !== false && !consumido,
        pavor: false,
        consumido,
        componente,
      };
    });
    // O dado de pavor rola à parte (depois dos dados do jogador) e entra só na leitura.
    const p = this.options.pavor;
    if (p) {
      lista.push({
        indice: lista.length, dado: p.dado, resultado: p.resultado, contado: false, pavor: true, consumido: false,
        componente: { chave: "pavor", rotulo: game.i18n?.localize?.("OP2.Pavor.Dado") ?? "Pavor", tipo: "pavor" },
      });
    }
    return lista;
  }

  /** Os dados que valem para o teste: sem o dado de pavor e sem os que ele consumiu. */
  get dadosDoTeste() {
    return this.dados.filter((d) => !d.pavor && !d.consumido);
  }

  get contados() {
    return this.dadosDoTeste.filter((d) => d.contado);
  }

  /** Rolou mais dados do que pode somar? Então o jogador precisa escolher (spec §4.5). */
  get precisaSelecao() {
    const dados = this.dadosDoTeste;
    return dados.length > MAX_DADOS_CONTADOS && this.contados.length === dados.length;
  }

  /**
   * Total do teste COM o dado extra do crítico ("soma mais uma rolagem à pontuação").
   * Quem compara totais (teste oposto, ataque) lê daqui e já pega o valor final.
   */
  get total() {
    const base = this._total;
    if (base === undefined || base === null) return base;
    return base + (this.options?.bonusCritico?.valor ?? 0);
  }

  /** Serializa o total SEM o extra: ao recarregar, o getter soma de novo. */
  toJSON() {
    const dados = super.toJSON();
    dados.total = this._total;
    return dados;
  }

  /** Modificador fixo (lesões/traumas). */
  get modificador() {
    return this.options.modificador ?? 0;
  }

  /** @returns {ReturnType<typeof analise.analisar>} */
  get resultado() {
    const r = analise.analisar(this.dadosDoTeste, { dt: this.dt, escopoCritico: this.escopoCritico, minimoCritico: this.options.criticoMinimo });
    // O dado de pavor anulou todos os dados: o valor do teste é 0, falha crítica.
    if (this._evaluated && this.options.pavor && this.dadosDoTeste.length === 0) {
      Object.assign(r, { total: 0, ra: 0, rb: 0, critico: false, valorCritico: null, falhaCritica: true, sucesso: false, desfecho: "falha-critica" });
    }
    const mod = this.modificador;
    if (mod) {
      r.total += mod;
      r.modificador = mod;
      if (!r.critico && !r.falhaCritica && r.dt !== null) {
        r.sucesso = r.total >= r.dt;
        r.desfecho = r.sucesso ? "sucesso" : "falha";
      }
    }
    r.pavor = this.dados.find((d) => d.pavor) ?? null;
    r.consumidos = this.dados.filter((d) => d.consumido).length;
    return r;
  }

  /**
   * Dado de pavor: os dados do teste que tiraram MENOS que ele são consumidos.
   * Chamar logo depois do `evaluate`.
   */
  aplicarPavor() {
    const p = this.options.pavor;
    if (!p) return this;
    const consumidos = [];
    this.dice.forEach((termo, i) => {
      if (termo.results[0].result < p.resultado) {
        consumidos.push(i);
        for (const r of termo.results) { r.active = false; r.discarded = true; }
      }
    });
    this.options.consumidos = consumidos;
    this._total = this.resultado.total;
    return this;
  }

  /** Registra o dado de pavor rolado à parte e anula os dados menores. */
  definirPavor(dado, resultado) {
    this.options.pavor = { dado, resultado };
    return this.aplicarPavor();
  }


  get ra() { return this.resultado.ra; }
  get rb() { return this.resultado.rb; }
  get critico() { return this.resultado.critico; }
  get falhaCritica() { return this.resultado.falhaCritica; }
  get sucesso() { return this.resultado.sucesso; }
  get desfecho() { return this.resultado.desfecho; }

  /**
   * Aplica a escolha do jogador sobre quais dados contam. Os descartados continuam
   * visíveis e riscados: ainda alimentam a detecção de crítico no escopo "todos".
   * @param {number[]} indices
   */
  aplicarSelecao(indices) {
    const validos = new Set(this.dadosDoTeste.map((d) => d.indice));
    const escolhidos = new Set(indices.filter((i) => validos.has(i)).slice(0, MAX_DADOS_CONTADOS));
    this.dice.forEach((termo, i) => {
      if (!validos.has(i)) return;
      const ativo = escolhidos.has(i);
      for (const r of termo.results) {
        r.active = ativo;
        r.discarded = !ativo;
      }
    });
    this._total = this.resultado.total;
    return this;
  }

  selecaoSugerida() {
    return analise.selecaoSugerida(this.dadosDoTeste);
  }
}
