/**
 * Ficha do personagem.
 *
 * Segue a diagramação da ficha oficial do playtest: cada perícia mostra o *par* de
 * dados que será rolado — o dado da perícia e o do atributo pareado — em vez de um
 * seletor de texto. É a leitura que o livro usa e a que torna a ficha escaneável.
 */
import { resetarUsos } from "../cena/efeitos-mundo.mjs";
import { usarItem, temUso, itemGasto } from "../cena/usar-item.mjs";
import { posicionarMenuDeDado } from "./menu-dado.mjs";
import { ESCADA, ATRIBUTOS, PERICIAS, PERFIS, APTIDOES_PADRAO } from "../config.mjs";
import { periciaVisivel, aptidaoVisivel } from "../settings/pericias.mjs";
import { stepDie } from "../dice/escada.mjs";
import { rolarTeste } from "../dice/teste.mjs";
import { iconeDado } from "../ui/dice-icons.mjs";
import { lerConfig } from "../settings/register.mjs";
import { encerrarCena } from "../cena/encerrar-investigacao.mjs";
import { enriquecerHtml as enriquecer } from "../ui/enriquecer.mjs";
import { ligarRodaDoMouse } from "../ui/controle-dado.mjs";
import { abrirAcoesInvestigacao } from "../cena/acoes-app.mjs";
import { abrirAcoesCombate } from "../cena/acoes-combate-app.mjs";
import { renderDoPerfil } from "../ui/perfil.mjs";
import { descreverMarca } from "../cena/tabelas-dados.mjs";
import { usarPoder, USAVEIS } from "../cena/poderes.mjs";
import { consultarTabela } from "../cena/tabelas.mjs";
import { removerPavor } from "../cena/pavor.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class PersonagemSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-ficha", "op2-ficha--personagem"],
    position: { width: 880, height: 860 },
    window: { resizable: true, icon: "fa-solid fa-user-secret" },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rolar: PersonagemSheet.#rolar,
      abrirAcoesInvestigacao: PersonagemSheet.#abrirAcoesInvestigacao,
      abrirAcoesCombate: PersonagemSheet.#abrirAcoesCombate,
      abrirDialogoTeste: PersonagemSheet.#abrirDialogoTeste,
      definirRecurso: PersonagemSheet.#definirRecurso,
      passoDado: PersonagemSheet.#passoDado,
      escolherDado: PersonagemSheet.#escolherDado,
      abrirSeletor: PersonagemSheet.#abrirSeletor,
      criarItem: PersonagemSheet.#criarItem,
      alternarEquipado: PersonagemSheet.#alternarEquipado,
      usarItem: PersonagemSheet.#usarItem,
      usarLinha: PersonagemSheet.#usarLinha,
      ajustarCarga: PersonagemSheet.#ajustarCarga,
      editarItem: PersonagemSheet.#editarItem,
      apagarItem: PersonagemSheet.#apagarItem,
      adicionarAptidao: PersonagemSheet.#adicionarAptidao,
      removerAptidao: PersonagemSheet.#removerAptidao,
      encerrarCena: PersonagemSheet.#encerrarCena,
      definirImpeto: PersonagemSheet.#definirImpeto,
      gastarImpetoAtributo: PersonagemSheet.#gastarImpetoAtributo,
      adicionarRelacao: PersonagemSheet.#adicionarRelacao,
      removerRelacao: PersonagemSheet.#removerRelacao,
      definirGrau: PersonagemSheet.#definirGrau,
      alternarInvocada: PersonagemSheet.#alternarInvocada,
      removerMarca: PersonagemSheet.#removerMarca,
      consultarTabela: PersonagemSheet.#consultarTabela,
      removerPavor: PersonagemSheet.#removerPavor,
      alternarCondicao: PersonagemSheet.#alternarCondicao,
      resetarUsos: PersonagemSheet.#resetarUsos,
      usarPoder: PersonagemSheet.#usarPoder,
      ajustarMarcadores: PersonagemSheet.#ajustarMarcadores,
      acaoExtraImpeto: PersonagemSheet.#acaoExtraImpeto,
      removerEfeito: PersonagemSheet.#removerEfeito,
      alternarEfeito: PersonagemSheet.#alternarEfeito,
    },
  };

  static PARTS = {
    cabecalho: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-cabecalho.hbs" },
    abas: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-abas.hbs" },
    habilidades: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-habilidades.hbs" },
    inventario: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-inventario.hbs" },
    notas: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-notas.hbs" },
    relacoes: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-relacoes.hbs" },
    marcas: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-marcas.hbs" },
    efeitos: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-efeitos.hbs" },
    pericias: { template: "systems/ordem-paranormal-2e/templates/actor/personagem-pericias.hbs" },
  };

  static TABS = {
    principal: {
      tabs: [{ id: "habilidades" }, { id: "inventario" }, { id: "relacoes" }, { id: "efeitos" }, { id: "marcas" }, { id: "notas" }],
      initial: "habilidades",
      labelPrefix: "OP2.Aba",
    },
  };

  async _prepareContext(opcoes) {
    const contexto = await super._prepareContext(opcoes);
    const sistema = this.actor.system;

    return {
      ...contexto,
      actor: this.actor,
      sistema,
      // `fields` alimenta o {{formInput}}; sem ele o editor de texto rico não sobe.
      fields: this.actor.system.schema.fields,
      editavel: this.isEditable,
      ehGM: game.user.isGM,
      atributos: this.#atributos(sistema),
      pericias: this.#pericias(sistema),
      aptidoes: this.#aptidoes(sistema),
      recursos: {
        pv: this.#recurso(sistema.recursos.pv, "pv"),
        pd: this.#recurso(sistema.recursos.pd, "pd"),
      },
      perfis: PERFIS.map((chave) => ({ chave, rotulo: game.i18n.localize(`OP2.Perfil.${chave}`) })),
      // Opções do seletor de dado, com o ícone já renderizado.
      escada: ESCADA.map((dado) => ({ dado, icone: iconeDado(dado) })),
      // A barra de Ímpeto é a própria habilidade: o estado vem do item, e some com ele.
      habilidades: await Promise.all(this.actor.items
        .filter((i) => i.type === "habilidade")
        .map(async (item) => ({
        item,
        // A descrição é a regra da habilidade: sem ela na ficha, o jogador precisa
        // abrir o item para lembrar o que ela faz (achado em uso real).
        descricao: await enriquecer(item.system.descricao, item),
        barra: item.system.temBarraImpeto ? {
          espacos: Array.from({ length: item.system.impeto.espacos }, (_, i) => ({
            n: i + 1, cheio: i < item.system.impeto.preenchidos,
          })),
          // Gastar 3 espaços (passo de atributo / ação extra); barras de 3 = barra cheia.
          cheia: item.system.impeto.preenchidos >= Math.min(3, item.system.impeto.espacos),
          acaoExtra: item.system.impeto.espacos >= 5,
        } : null,
        usavel: USAVEIS.includes(item.system.automacao),
        dicaUsar: game.i18n.localize(USAVEIS.includes(item.system.automacao) ? "OP2.Poder.UsarDica" : "OP2.Item.UsarDica"),
        marcadores: item.system.automacao === "analise"
          ? Array.from({ length: 4 }, (_, i) => ({ n: i + 1, cheio: i < item.system.marcadores })) : null,
        estadoPoder: item.system.automacao === "lobo" && item.system.machucadoNaCena ? game.i18n.localize("OP2.Poder.LoboFerido")
          : item.system.automacao === "arsenal" ? ["tonico", "balsamo", "vespa"].filter((p) => !item.system.arsenal[p]).map((p) => game.i18n.localize(`OP2.Poder.Arsenal.${p}`)).join(" · ") || game.i18n.localize("OP2.Poder.ArsenalVazio")
            : "",
      }))),
      // Inventário e ferramentas na mesma linha das habilidades: clicar no nome usa,
      // a descrição fica embaixo, lápis edita e lixeira apaga.
      equipamentos: await Promise.all(this.actor.items.filter((i) => i.type === "equipamento").map(async (item) => {
        const gasto = itemGasto(item.system);
        return {
          item,
          descricao: await enriquecer(item.system.descricao, item),
          meta: [
            item.system.quantidade !== 1 ? `×${item.system.quantidade}` : "",
            item.system.arma ? game.i18n.localize("OP2.Equipamento.Arma") : "",
          ].filter(Boolean).join(" · "),
          equipado: item.system.equipado,
          cargas: item.system.cargas.usa ? item.system.cargas : null,
          simbolo: Boolean(item.system.passiva?.simbolo),
          gasto,
          dicaUsar: gasto && temUso(item)
            ? (item.system.mensagemGasto?.trim() || game.i18n.localize("OP2.Uso.JaGastoCurto"))
            : game.i18n.localize(temUso(item) ? "OP2.Uso.UsarDica" : "OP2.Item.UsarDica"),
          dicaSimbolo: gasto ? (item.system.mensagemGasto?.trim() || game.i18n.localize("OP2.Uso.PassivaApagada"))
            : game.i18n.localize("OP2.Uso.PassivaAtiva"),
        };
      })),
      ferramentas: await Promise.all(this.actor.items.filter((i) => i.type === "ferramenta").map(async (item) => ({
        item,
        descricao: await enriquecer(item.system.descricao, item),
        meta: game.i18n.localize(`OP2.Ferramenta.Subtipo.${item.system.subtipo}`),
        cargas: item.system.cargas?.usa ? item.system.cargas : null,
        dicaUsar: game.i18n.localize("OP2.Item.UsarDica"),
      }))),
      temReducao: Object.values(sistema.estado.reducoesTemporarias).some((n) => n > 0),
      // O aumento precisa aparecer na ficha: sem isso o jogador gasta os três espaços
      // do Ímpeto e não tem onde conferir que o dado subiu (achado em uso real).
      aumentos: Object.entries(sistema.estado.aumentosTemporarios)
        .filter(([, passos]) => passos > 0)
        .map(([chave, passos]) => ({
          chave, passos,
          rotulo: game.i18n.localize(`OP2.Atributo.${chave}`),
          dado: sistema.atributos[chave].dadoEfetivo,
          base: sistema.atributos[chave].die,
        })),
      // Barra de ímpeto: mesma leitura dos traços de recurso — um espaço por
      // clique, preenchidos primeiro.
      biografia: await enriquecer(sistema.biografia, this.actor),
      relacoes: sistema.relacoes.map((r, indice) => ({
        ...r, indice,
        circulos: [1, 2, 3].map((n) => ({ n, cheio: n <= r.grau })),
      })),
      lesoes: sistema.lesoes.map((m, indice) => ({ indice, ...descreverMarca(m.chave) })),
      traumas: sistema.traumas.map((m, indice) => ({ indice, ...descreverMarca(m.chave) })),
      pavor: sistema.estado.pavor,
      condicoes: CONFIG.statusEffects.map((c) => ({
        id: c.id, img: c.img, nome: game.i18n.localize(c.name), ativa: this.actor.statuses.has(c.id),
      })),
      // Efeitos que não são uma condição simples do sistema (de itens, módulos ou do core).
      outrosEfeitos: [...this.actor.allApplicableEffects?.() ?? this.actor.effects]
        .filter((e) => !(e.statuses?.size === 1 && CONFIG.statusEffects.some((c) => e.statuses.has(c.id))))
        .map((e) => ({ id: e.id, nome: e.name, img: e.img, desativado: e.disabled, proprio: e.parent === this.actor })),
      modificadoresTexto: Object.entries(sistema.modificadores?.pericia ?? {})
        .map(([k, v]) => `${game.i18n.localize(`OP2.Pericia.${k}`)} ${v > 0 ? "+" : ""}${v}`)
        .concat(Object.entries(sistema.modificadores?.atributo ?? {})
          .map(([k, v]) => `${game.i18n.localize(`OP2.Atributo.${k}`)} ${v > 0 ? "+" : ""}${v}`))
        .join(" · "),
    };
  }

  /* ---- Relações ---- */

  static async #adicionarRelacao() {
    if (!this.isEditable) return;
    await this.actor.update({ "system.relacoes": [...this.actor.system.relacoes, { nome: "", grau: 0, rotulo: "", descricao: "" }] });
  }

  static async #removerRelacao(_evento, alvo) {
    if (!this.isEditable) return;
    const lista = this.actor.system.relacoes.filter((_, i) => i !== Number(alvo.dataset.indice));
    await this.actor.update({ "system.relacoes": lista });
  }

  static async #definirGrau(_evento, alvo) {
    if (!this.isEditable) return;
    const i = Number(alvo.dataset.indice);
    const n = Number(alvo.dataset.grau);
    const lista = foundry.utils.deepClone(this.actor.system.relacoes);
    lista[i].grau = lista[i].grau === n ? n - 1 : n;
    await this.actor.update({ "system.relacoes": lista });
  }

  static async #alternarInvocada(evento, alvo) {
    evento.stopPropagation();
    if (!this.isEditable) return;
    const lista = foundry.utils.deepClone(this.actor.system.relacoes);
    const i = Number(alvo.dataset.indice);
    if (!lista[i]) return;
    lista[i].invocada = !lista[i].invocada;
    await this.actor.update({ "system.relacoes": lista });
  }

  /** Campos de texto das relações: gravam a lista inteira (ArrayField não aceita caminho por índice). */
  #ligarRelacoes() {
    for (const campo of this.element.querySelectorAll("[data-relacao-campo]")) {
      campo.addEventListener("change", async (evento) => {
        evento.stopPropagation();
        const lista = foundry.utils.deepClone(this.actor.system.relacoes);
        const i = Number(campo.dataset.indice);
        if (!lista[i]) return;
        lista[i][campo.dataset.relacaoCampo] = campo.value;
        await this.actor.update({ "system.relacoes": lista });
      });
    }
  }

  /* ---- Lesões, traumas, pavor ---- */

  static async #removerMarca(_evento, alvo) {
    if (!game.user.isGM) return;
    const campo = alvo.dataset.campo;
    const lista = this.actor.system[campo].filter((_, i) => i !== Number(alvo.dataset.indice));
    await this.actor.update({ [`system.${campo}`]: lista });
  }

  static #consultarTabela(_evento, alvo) {
    consultarTabela(alvo.dataset.tabela, this.actor.id);
  }

  static async #usarPoder(_evento, alvo) {
    const item = this.actor.items.get(alvo.closest("[data-item-id]")?.dataset.itemId);
    if (item) await usarPoder(this.actor, item);
  }

  static async #ajustarMarcadores(_evento, alvo) {
    if (!this.isEditable) return;
    const item = this.actor.items.get(alvo.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    const n = Number(alvo.dataset.n);
    await item.update({ "system.marcadores": item.system.marcadores === n ? n - 1 : n });
  }

  /** Ímpeto: 3 espaços = uma ação extra em cena de conflito. */
  static async #acaoExtraImpeto(_evento, alvo) {
    const item = this.actor.items.get(alvo.dataset.itemId);
    if (!item || item.system.impeto.preenchidos < 3) return;
    await item.update({ "system.impeto.preenchidos": item.system.impeto.preenchidos - 3 });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="op2 op2-card"><header class="op2-card__topo"><span class="op2-tag op2-tag--pequena">${item.name}</span></header>
        <p class="op2-card__texto">${game.i18n.format("OP2.Impeto.AcaoExtraUsada", { nome: this.actor.name })}</p></div>`,
    });
  }

  static async #resetarUsos() {
    await resetarUsos(this.actor);
  }

  static async #alternarCondicao(_evento, alvo) {
    if (!this.isEditable) return;
    const id = alvo.dataset.condicao;
    const ativa = !this.actor.statuses.has(id);
    await this.actor.toggleStatusEffect(id, { active: ativa });
    if (id === "moribundo") await this.actor.update({ "system.estado.moribundoDesde": ativa ? 1 : null });
    if (id === "apavorado" && !ativa && this.actor.system.estado.pavor) await this.actor.update({ "system.estado.pavor": "" });
  }

  static async #removerEfeito(_evento, alvo) {
    if (!this.isEditable) return;
    await this.actor.effects.get(alvo.dataset.efeito)?.delete();
  }

  static async #alternarEfeito(_evento, alvo) {
    if (!this.isEditable) return;
    const efeito = this.actor.effects.get(alvo.dataset.efeito);
    await efeito?.update({ disabled: !efeito.disabled });
  }

  static async #removerPavor() {
    if (!game.user.isGM) return;
    await removerPavor(this.actor);
  }

  #atributos(sistema) {
    return Object.keys(ATRIBUTOS).map((chave) => {
      const atributo = sistema.atributos[chave];
      return {
        chave,
        rotulo: game.i18n.localize(`OP2.Atributo.${chave}`),
        die: atributo.die,
        dadoEfetivo: atributo.dadoEfetivo,
        reduzido: atributo.reduzido,
        icone: iconeDado(atributo.dadoEfetivo, { titulo: `${game.i18n.localize(`OP2.Atributo.${chave}`)}: ${atributo.dadoEfetivo}` }),
        // O dado base vai para o tooltip; um segundo ícone na linha comeria a largura
        // do nome do atributo, que em inglês já é apertada.
        dica: atributo.reduzido
          ? `${game.i18n.localize("OP2.Atributo.Reduzido")} — ${atributo.die} → ${atributo.dadoEfetivo}`
          : null,
        caminho: `system.atributos.${chave}.die`,
      };
    });
  }

  #pericias(sistema) {
    return Object.keys(PERICIAS)
      .filter((chave) => !PERICIAS[chave].especializada && periciaVisivel(chave))
      .map((chave) => this.#linhaDePericia(sistema, chave))
      .map((linha) => ({ ...linha, longo: linha.rotulo.length > 11 }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  }

  /** Uma linha da ficha: nome, dado da perícia, dado do atributo pareado. */
  #linhaDePericia(sistema, chave, { chaveAptidao } = {}) {
    const pericia = chaveAptidao ? sistema.aptidoes[chaveAptidao] : sistema.pericias[chave];
    const chaveAtributo = sistema.pericias[chave].atributo;
    const atributo = sistema.atributos[chaveAtributo];
    const chaveTeste = chaveAptidao ? `aptidao.${chaveAptidao}` : chave;

    return {
      chave: chaveTeste,
      rotulo: chaveAptidao
        ? (sistema.aptidoes[chaveAptidao].rotulo || game.i18n.localize(`OP2.Aptidao.${chaveAptidao}`))
        : game.i18n.localize(`OP2.Pericia.${chave}`),
      campoLivre: !chaveAptidao && PERICIAS[chave]?.campoLivre
        ? { valor: pericia.campo ?? "", caminho: `system.pericias.${chave}.campo` } : null,
      die: pericia.die,
      dadoEfetivo: pericia.dadoEfetivo ?? pericia.die,
      valor: pericia.valor,
      caminho: chaveAptidao ? `system.aptidoes.${chaveAptidao}.die` : `system.pericias.${chave}.die`,
      icone: iconeDado(pericia.dadoEfetivo ?? pericia.die),
      atributo: {
        chave: chaveAtributo,
        rotulo: game.i18n.localize(`OP2.Atributo.${chaveAtributo}`),
        icone: iconeDado(atributo.dadoEfetivo),
      },
    };
  }

  #aptidoes(sistema) {
    const chaves = Object.keys(sistema.aptidoes ?? {}).filter((sub) => aptidaoVisivel(sub));
    const chaveAtributo = sistema.pericias.aptidao.atributo;
    return {
      rotulo: game.i18n.localize("OP2.Pericia.aptidao"),
      atributo: {
        chave: chaveAtributo,
        rotulo: game.i18n.localize(`OP2.Atributo.${chaveAtributo}`),
        icone: iconeDado(sistema.atributos[chaveAtributo].dadoEfetivo),
      },
      campos: chaves
        .map((sub) => this.#linhaDePericia(sistema, "aptidao", { chaveAptidao: sub }))
        .map((linha, i) => ({ ...linha, sub: chaves[i], padrao: APTIDOES_PADRAO.includes(chaves[i]) })),
    };
  }

  /** PV/PD como barra proporcional — a ficha oficial usa pips, mas em valores altos
   *  (16, 20+) uma trilha de quadradinhos vira ilegível. A barra escala sem esse
   *  problema, e o número ao lado continua sendo a fonte exata do valor. */
  #recurso(recurso, chave) {
    const max = Math.max(recurso.max, recurso.value, 0);
    // Abaixo de 30% do máximo os traços pulsam em vermelho — o mesmo aviso visual
    // que barra de vida baixa usa em qualquer jogo, só que com o traço do livro.
    const critico = recurso.max > 0 && recurso.value / recurso.max <= 0.3;
    return {
      chave,
      value: recurso.value,
      max: recurso.max,
      critico,
      // Sem teto: os personagens do Ato II chegam a 32-34 de PV/PD, e um limite
      // baixo faria só esse recurso cair pra número puro enquanto o outro mantém
      // os traços — mais inconsistente do que o problema que o teto tentava evitar.
      // O traço quebra em várias linhas sozinho; não fica ilegível, só mais alto.
      tracos: max > 0
        ? Array.from({ length: max }, (_, i) => ({ n: i + 1, cheio: i < recurso.value }))
        : null,
    };
  }

  /* ---------------------------------------------------------------- ações -- */

  /**
   * Ações de investigação deste personagem. Ficam na ficha, não no painel: aqui
   * quem age é este personagem, sem ambiguidade — no painel, um jogador com mais
   * de um personagem não teria como escolher (achado em uso real).
   */
  static #abrirAcoesInvestigacao() {
    abrirAcoesInvestigacao(this.actor);
  }

  static #abrirAcoesCombate() {
    abrirAcoesCombate(this.actor);
  }

  static async #rolar(evento, alvo) {
    const chave = alvo.dataset.chave;
    const abrirDialogo = evento.shiftKey !== lerConfig("cliqueAbreDialogo");
    await rolarTeste(this.actor, { chavePericia: chave, rapido: !abrirDialogo });
  }

  /**
   * Gatilho explícito do diálogo completo — sem depender de Shift, que não existe em
   * toque. É o caminho de quem está no celular ou no tablet.
   */
  static async #abrirDialogoTeste(_evento, alvo) {
    await rolarTeste(this.actor, { chavePericia: alvo.dataset.chave, rapido: false });
  }

  /** Roda do mouse e teclas de seta andam na escada sem abrir nada. */
  static async #passoDado(_evento, alvo) {
    const { caminho, delta } = alvo.dataset;
    const atual = foundry.utils.getProperty(this.actor, caminho);
    await this.actor.update({ [caminho]: stepDie(atual, Number(delta)) });
  }

  static async #abrirSeletor(_evento, alvo) {
    const controle = alvo.closest(".op2-controle-dado");
    controle.classList.toggle("aberto");
    posicionarMenuDeDado(controle);
    // Alguns navegadores (Safari) não focam botão em clique por padrão; forçamos aqui
    // porque a roda do mouse só ajusta o dado quando o controle está focado.
    alvo.focus();
    if (controle.classList.contains("aberto")) {
      const fechar = (e) => {
        if (controle.contains(e.target)) return;
        controle.classList.remove("aberto");
        document.removeEventListener("click", fechar, true);
      };
      document.addEventListener("click", fechar, true);
    }
  }

  static async #escolherDado(_evento, alvo) {
    const { caminho, dado } = alvo.dataset;
    alvo.closest(".op2-controle-dado")?.classList.remove("aberto");
    await this.actor.update({ [caminho]: dado });
  }

  static async #criarItem(_evento, alvo) {
    const type = alvo.dataset.tipo;
    await this.actor.createEmbeddedDocuments("Item", [{
      name: game.i18n.format("OP2.Item.Novo", { tipo: game.i18n.localize(`TYPES.Item.${type}`) }),
      type,
    }]);
  }

  static async #editarItem(_evento, alvo) {
    this.#itemDe(alvo)?.sheet.render({ force: true });
  }

  static async #apagarItem(_evento, alvo) {
    const item = this.#itemDe(alvo);
    if (!item) return;
    const confirmado = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("OP2.Item.Apagar") },
      content: `<p>${game.i18n.format("OP2.Item.ApagarConfirma", { nome: item.name })}</p>`,
      render: renderDoPerfil(this.actor),
    });
    if (confirmado) await item.delete();
  }

  /** O clique no nome da linha: usa a habilidade ou o item (automação, efeito ou card). */
  static async #usarLinha(_evento, alvo) {
    const item = this.#itemDe(alvo);
    if (!item) return;
    const { usarRecurso } = await import("../cena/acoes-recurso.mjs");
    await usarRecurso(this.actor, item);
  }

  /** Usa o item (cura, dano, dado de esconderijo…), escolhendo o efeito se for "um OU outro". */
  static async #usarItem(_evento, alvo) {
    const item = this.#itemDe(alvo);
    if (item) await usarItem(this.actor, item);
  }

  static async #alternarEquipado(_evento, alvo) {
    const item = this.#itemDe(alvo);
    if (item) await item.update({ "system.equipado": !item.system.equipado });
  }

  static async #ajustarCarga(_evento, alvo) {
    const item = this.#itemDe(alvo);
    if (!item) return;
    const { value, max } = item.system.cargas;
    const novo = Math.min(max, Math.max(0, value + Number(alvo.dataset.delta)));
    await item.update({ "system.cargas.value": novo });
  }

  #itemDe(alvo) {
    return this.actor.items.get(alvo.closest("[data-item-id]")?.dataset.itemId);
  }

  /** Aptidão é coleção aberta: o texto fala em "um campo específico" (spec §2.3). */
  static async #adicionarAptidao() {
    const rotulo = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("OP2.Aptidao.Adicionar") },
      content: `<input type="text" name="rotulo" autofocus placeholder="${game.i18n.localize("OP2.Aptidao.Exemplo")}">`,
      ok: { callback: (_e, botao) => botao.form.elements.rotulo.value.trim() },
      render: renderDoPerfil(this.actor),
    });
    if (!rotulo) return;

    const chave = rotulo.slugify({ strict: true });
    if (this.actor.system.aptidoes[chave]) {
      return void ui.notifications.warn(game.i18n.format("OP2.Aviso.AptidaoDuplicada", { rotulo }));
    }
    await this.actor.update({ [`system.aptidoes.${chave}`]: { rotulo, die: "d4" } });
  }

  /** Clicar no traço N define o recurso em N; clicar no atual zera de N para N-1. */
  /**
   * Ocupação arrastada para a ficha: preenche o campo de texto e traz a habilidade
   * que ela concede (spec §2.1), em vez de virar um Item solto no inventário — o
   * personagem não "carrega" a própria profissão.
   */
  async _onDropItem(evento, item) {
    if (item.type !== "ocupacao") return super._onDropItem(evento, item);
    if (!this.actor.isOwner) return null;

    await this.actor.update({ "system.ocupacao": item.name });
    ui.notifications.info(game.i18n.format("OP2.Ocupacao.Aplicada", {
      ator: this.actor.name, ocupacao: item.name,
    }));

    const nome = item.system.habilidade?.trim();
    if (!nome) return null;
    if (this.actor.items.getName(nome)) {
      ui.notifications.info(game.i18n.format("OP2.Ocupacao.JaTinha", {
        ator: this.actor.name, habilidade: nome,
      }));
      return null;
    }

    // A habilidade vem do compêndio quando a ocupação diz de onde; senão fica só o
    // nome, e a mesa preenche o efeito à mão.
    const modelo = item.system.habilidadeUuid ? await fromUuid(item.system.habilidadeUuid) : null;
    const dados = modelo?.toObject() ?? { name: nome, type: "habilidade", system: { origem: "ocupacao" } };
    await this.actor.createEmbeddedDocuments("Item", [dados]);
    ui.notifications.info(game.i18n.format("OP2.Ocupacao.HabilidadeAdicionada", { habilidade: nome }));
    return null;
  }

  /**
   * Barra de Ímpeto: clicar num espaço preenche até ali; clicar no último preenchido
   * apaga. Mesma interação dos traços de PV/PD, que a mesa já conhece. O estado é do
   * item — apagar a habilidade leva a barra junto.
   */
  static async #definirImpeto(_evento, alvo) {
    const item = this.actor.items.get(alvo.dataset.itemId);
    if (!item) return;
    const atual = item.system.impeto.preenchidos;
    const valor = Number(alvo.dataset.valor);
    const novo = valor === atual ? valor - 1 : valor;
    await item.update({ "system.impeto.preenchidos": Math.max(0, novo) });
  }

  /**
   * Apagar a barra cheia sobe um atributo em um passo até o fim da cena. O aumento vai
   * para `estado.aumentosTemporarios`, que o dado efetivo soma e o encerramento de
   * cena zera.
   */
  static async #gastarImpetoAtributo(_evento, alvo) {
    const item = this.actor.items.get(alvo.dataset.itemId);
    if (!item || item.system.impeto.preenchidos < Math.min(3, item.system.impeto.espacos)) return;

    const opcoes = Object.keys(ATRIBUTOS)
      .map((chave) => `<option value="${chave}">${game.i18n.localize(`OP2.Atributo.${chave}`)}</option>`)
      .join("");
    const escolhido = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("OP2.Impeto.Passo") },
      content: `
        <div class="form-group">
          <label>${game.i18n.localize("OP2.Impeto.QualAtributo")}</label>
          <select name="atributo">${opcoes}</select>
        </div>`,
      ok: { callback: (_evento, botao) => botao.form.elements.atributo.value },
      rejectClose: false,
      render: renderDoPerfil(this.actor),
    });
    if (!escolhido) return;

    const atual = this.actor.system.estado.aumentosTemporarios[escolhido] ?? 0;
    await item.update({ "system.impeto.preenchidos": Math.max(0, item.system.impeto.preenchidos - 3) });
    await this.actor.update({ [`system.estado.aumentosTemporarios.${escolhido}`]: atual + 1 });
    ui.notifications.info(game.i18n.format("OP2.Impeto.PassoAplicado", {
      atributo: game.i18n.localize(`OP2.Atributo.${escolhido}`),
    }));
  }

  static async #definirRecurso(_evento, alvo) {
    const { recurso, valor } = alvo.dataset;
    const atual = this.actor.system.recursos[recurso].value;
    const novo = Number(valor) === atual ? Number(valor) - 1 : Number(valor);
    await this.actor.update({ [`system.recursos.${recurso}.value`]: Math.max(0, novo) });
  }

  static async #removerAptidao(_evento, alvo) {
    await this.actor.update({ [`system.aptidoes.-=${alvo.dataset.sub}`]: null });
  }

  static async #encerrarCena() {
    await encerrarCena({ atores: [this.actor] });
  }

  /** Filtro da coluna de perícias. Sobrevive ao re-render que o form dispara. */
  #busca = "";

  /** A coluna de perícias tem alça de arrastar; a largura fica salva neste navegador. */
  #ligarLarguraPericias() {
    const dock = this.element.querySelector(".op2-dock-pericias");
    if (!dock) return;
    const CHAVE = "op2.larguraPericias";
    try {
      const salva = Number(localStorage.getItem(CHAVE));
      if (salva > 0) dock.style.width = `${salva}px`;
    } catch { /* sem armazenamento: fica o padrão */ }
    this._observadorPericias?.disconnect();
    this._observadorPericias = new ResizeObserver(() => {
      if (!dock.style.width) return;
      try { localStorage.setItem(CHAVE, String(Math.round(dock.getBoundingClientRect().width))); } catch { /* ignora */ }
    });
    this._observadorPericias.observe(dock);
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    // O acento da ficha vem do perfil (as cores do livro): o CSS lê daqui.
    this.element.dataset.perfil = this.actor.system.perfil ?? "";
    this.#ligarRelacoes();
    this.#ligarLarguraPericias();

    const campo = this.element.querySelector(".op2-busca__campo");
    if (campo) {
      campo.value = this.#busca;
      campo.addEventListener("input", (evento) => {
        this.#busca = evento.target.value;
        this.#filtrarPericias();
      });
      if (this.#busca) this.#filtrarPericias();
    }

    if (!this.isEditable) return;

    ligarRodaDoMouse(this.element, (caminho, passos) => {
      const atual = foundry.utils.getProperty(this.actor, caminho);
      this.actor.update({ [caminho]: stepDie(atual, passos) });
    });
  }

  /**
   * Esconde as linhas que não casam com a busca. A Aptidão abre sozinha quando um
   * subcampo casa — senão o resultado ficaria escondido dentro do `<details>` fechado.
   */
  #filtrarPericias() {
    const termo = this.#busca.trim().toLowerCase();
    const semAcento = (texto) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const alvo = semAcento(termo);

    for (const linha of this.element.querySelectorAll(".op2-pericia")) {
      const nome = semAcento(linha.querySelector(".op2-pericia__nome")?.textContent ?? "").toLowerCase();
      linha.hidden = Boolean(alvo) && !nome.includes(alvo);
    }

    const aptidao = this.element.querySelector(".op2-aptidao");
    if (!aptidao) return;
    const algumVisivel = [...aptidao.querySelectorAll(".op2-pericia")].some((l) => !l.hidden);
    aptidao.hidden = Boolean(alvo) && !algumVisivel;
    if (alvo && algumVisivel) aptidao.open = true;
  }
}


