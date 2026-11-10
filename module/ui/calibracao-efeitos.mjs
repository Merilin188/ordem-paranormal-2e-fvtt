/**
 * Calibração de efeitos de cena — a mesma janela para cada preset (perseguição, mata
 * que observa…): as cenas onde vale, cada grupo com liga/desliga e seus números
 * (com limites), cor e opções. Salvar grava no mundo e reaplica na hora.
 *
 * O preset descreve a janela (`spec`); quem lê a configuração é o próprio efeito.
 */
import { SYSTEM_ID } from "../config.mjs";

/**
 * O salvo por cima do padrão: só as chaves que o padrão conhece, números dentro dos
 * limites, booleanos como booleanos, cor só em "#rrggbb". Pura.
 * @param {object} salvo
 * @param {object} padrao `{grupo: {chave: valor}}`
 * @param {Record<string, [number, number]>} limites `"grupo.chave": [min, max]`
 */
export function mesclarComLimites(salvo, padrao, limites) {
  const c = JSON.parse(JSON.stringify(padrao));
  for (const [grupo, campos] of Object.entries(c)) {
    for (const chave of Object.keys(campos)) {
      const v = salvo?.[grupo]?.[chave];
      if (v === undefined || v === null) continue;
      const tipo = typeof padrao[grupo][chave];
      if (tipo === "boolean") campos[chave] = Boolean(v);
      else if (tipo === "number") campos[chave] = Number(v);
      else campos[chave] = String(v);
    }
  }
  for (const [caminho, [min, max]] of Object.entries(limites)) {
    const [grupo, chave] = caminho.split(".");
    const v = Number(c[grupo]?.[chave]);
    if (c[grupo]) c[grupo][chave] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao[grupo][chave];
  }
  for (const campos of Object.values(c)) {
    for (const [chave, v] of Object.entries(campos)) {
      if (chave.startsWith("cor") && typeof v === "string" && !/^#[0-9a-f]{6}$/i.test(v)) campos[chave] = "#ffffff";
    }
  }
  return c;
}

/**
 * Cria a classe da janela de um preset.
 * @param {object} spec
 * @param {string} spec.id           id da janela
 * @param {string} spec.i18n         prefixo das chaves ("OP2.EfeitosPerseguicao")
 * @param {string} spec.chave        setting com a configuração
 * @param {string} spec.chaveCenas   setting com a lista de cenas
 * @param {() => object} spec.padrao
 * @param {(salvo: object) => object} spec.mesclar
 * @param {Record<string, [number, number]>} spec.limites
 * @param {Array<{id: string, campos: Array<{chave: string, passo?: number, tipo?: "bool"|"cor"}>, acao?: {id: string, icone: string}}>} spec.grupos
 * @param {Record<string, (config: object) => void>} [spec.acoes]  botões extras dos grupos ("testarPisada")
 */
export function criarJanelaDeCalibracao(spec) {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  const L = (k) => game.i18n.localize(`${spec.i18n}.${k}`);

  return class JanelaDeCalibracao extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: spec.id,
      classes: ["op2", "op2-calibrar"],
      tag: "form",
      window: { title: `${spec.i18n}.Titulo`, icon: "fa-solid fa-sliders", resizable: true },
      position: { width: 540, height: "auto" },
      form: { handler: JanelaDeCalibracao.#salvar, submitOnChange: false, closeOnSubmit: false },
      actions: {
        restaurar: JanelaDeCalibracao.#restaurar,
        acaoDoGrupo: JanelaDeCalibracao.#acaoDoGrupo,
      },
    };

    static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/ui/calibrar-efeitos.hbs` } };

    async _prepareContext() {
      const c = spec.mesclar(game.settings.get(SYSTEM_ID, spec.chave));
      return {
        intro: L("Intro"),
        idLista: `${spec.id}-cenas`,
        dicaCena: game.i18n.localize("OP2.Calibrar.AcrescentarCena"),
        cenas: game.settings.get(SYSTEM_ID, spec.chaveCenas) ?? "",
        cenasRotulo: game.i18n.localize("OP2.Calibrar.Cenas"),
        cenasAjuda: game.i18n.localize("OP2.Calibrar.CenasAjuda"),
        cenasDoMundo: game.scenes?.contents?.map((s) => s.name).sort((a, b) => a.localeCompare(b)) ?? [],
        grupos: spec.grupos.map((g) => ({
          id: g.id,
          titulo: L(`Grupo.${g.id}`),
          ajuda: L(`Ajuda.${g.id}`),
          temLigado: "ligado" in c[g.id],
          ligado: c[g.id].ligado,
          acao: g.acao ? { id: g.acao.id, icone: g.acao.icone, rotulo: L(`Acao.${g.acao.id}`) } : null,
          campos: g.campos.map((campo) => {
            const [min, max] = spec.limites[`${g.id}.${campo.chave}`] ?? [null, null];
            return {
              nome: `${g.id}.${campo.chave}`,
              valor: c[g.id][campo.chave],
              rotulo: L(`Campo.${g.id}.${campo.chave}`),
              ehBool: campo.tipo === "bool",
              ehCor: campo.tipo === "cor",
              min, max, passo: campo.passo ?? 1,
            };
          }),
        })),
      };
    }

    /** Clicar numa cena do mundo acrescenta o nome ao campo (sem repetir). */
    _onRender(contexto, opcoes) {
      super._onRender?.(contexto, opcoes);
      const campo = this.element.querySelector("[name=cenas]");
      for (const botao of this.element.querySelectorAll("[data-cena]")) {
        botao.addEventListener("click", () => {
          const lista = campo.value.split(/[;,]/).map((n) => n.trim()).filter(Boolean);
          if (!lista.some((n) => n.toLowerCase() === botao.dataset.cena.toLowerCase())) lista.push(botao.dataset.cena);
          campo.value = lista.join("; ");
        });
      }
    }

    /** O formulário como configuração (sem salvar). */
    ler() {
      const dados = new foundry.applications.ux.FormDataExtended(this.element).object;
      const c = spec.padrao();
      for (const [grupo, campos] of Object.entries(c)) {
        for (const chave of Object.keys(campos)) {
          const nome = `${grupo}.${chave}`;
          if (typeof campos[chave] === "boolean") campos[chave] = Boolean(dados[nome]);
          else if (dados[nome] !== undefined && dados[nome] !== null && dados[nome] !== "") campos[chave] = dados[nome];
        }
      }
      return { config: spec.mesclar(c), cenas: String(dados.cenas ?? "").trim() };
    }

    static async #salvar() {
      const { config, cenas } = this.ler();
      await game.settings.set(SYSTEM_ID, spec.chave, config);
      await game.settings.set(SYSTEM_ID, spec.chaveCenas, cenas);
      ui.notifications.info(game.i18n.localize("OP2.Calibrar.Salvo"));
    }

    static async #restaurar() {
      await game.settings.set(SYSTEM_ID, spec.chave, spec.padrao());
      this.render();
    }

    /** Botão extra de um grupo (ex.: testar a pisada), com os valores do formulário. */
    static #acaoDoGrupo(_evento, alvo) {
      spec.acoes?.[alvo.dataset.acao]?.(this.ler().config);
    }
  };
}
