/**
 * Ações de investigação de UM personagem (spec §6.3–§6.5, §7, §9).
 *
 * Mora na ficha, não no painel: aqui o personagem que age é este, sem ambiguidade.
 * No painel um jogador com mais de um personagem não teria como escolher por qual
 * deles o botão agiria, e o painel do jogador virou só leitura do que o mestre
 * revelou (achado em uso real).
 *
 * Nada de novo em regra: cada botão chama a mesma função que o painel do mestre já
 * chamava — só o dono da ação mudou de lugar.
 */
import { excluirDesafio } from "./excluir-desafio.mjs";
import { FERRAMENTAS_POI } from "../config.mjs";
import {
  investigacaoAtiva, investigacoesVisiveis, definirInvestigacaoAtiva, pontoDoDesafio,
} from "./investigacao-ativa.mjs";
import { temFerramenta } from "./ferramentas.mjs";
import { alvosDaCenaAtiva, alvosMarcados } from "./encerrar-investigacao.mjs";
import {
  examinar, interagir, recapitular, compartilhar,
} from "./acoes-investigacao.mjs";
import {
  arrombar, alcancar, sustentar, pararDeSustentar, hackTecnico, hackSocial, desafioGenerico,
} from "./acoes-desafio.mjs";
import { usarFerramenta, usarLaser, usarRadio } from "./acoes-ferramenta.mjs";
import { ajudar } from "./acoes-ajuda.mjs";
import { atacar } from "./acoes-combate.mjs";
import { usarHabilidadeOuItem } from "./acoes-recurso.mjs";
import { abrirDestrancar } from "./destrancar-app.mjs";
import { guardarRolagem, restaurarRolagem, esquecerRolagem } from "../ui/rolagem.mjs";
import { semPrefixoDoPonto, desafioResolvido } from "./desafios.mjs";
import { chaveInfo, periciasDaLinha } from "./investigacao.mjs";
import { pontoTrancado, desafiosAVista } from "./acesso-poi.mjs";
import { marcadoresDoPonto } from "./marcadores.mjs";
import { filtrosVazios, filtrando } from "./filtros-painel.mjs";
import {
  chavesDasAbordagens, contextoBarra, ligarBarra, alternarChip, aplicarBarra, limparBarra,
} from "./barra-filtros.mjs";
import { abrirLaboratorio } from "./laboratorio-app.mjs";
import { abrirRadio } from "./radio-app.mjs";
import { renderDoPerfil } from "../ui/perfil.mjs";
import { janelasDeInvestigacao } from "./painel-comum.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Só as abordagens que o mestre ligou naquele objeto: porta emperrada não se
 * hackeia, painel eletrônico não se arromba no braço (achado em uso real — os
 * quatro botões apareciam em todo desafio).
 */
function contextoDoDesafio(desafio, investigacao, indice, ator = null) {
  const { abordagens } = desafio.system;
  const ponto = pontoDoDesafio(investigacao, desafio.uuid);
  return {
    uuid: desafio.uuid,
    nome: desafio.name,
    img: desafio.img,
    // O que a barra de filtros lê no card (`data-*`).
    indice,
    progresso: desafioResolvido(desafio.system) ? "resolvido" : "pendente",
    abordagensChaves: chavesDasAbordagens(abordagens),
    marcado: marcadoresDoPonto(canvas?.scene, desafio.uuid).length > 0,
    // O ponto a que pertence vem como rótulo acima do nome, e o nome perde o prefixo
    // repetido — a mesma leitura do painel.
    poiNome: ponto?.name ?? "",
    nomeCurto: semPrefixoDoPonto(desafio.name, ponto?.name),
    quebrado: desafio.system.quebrado,
    destrancado: desafio.system.destrancado,
    hackTecnicoResolvido: desafio.system.hackTecnico.resolvido,
    hackSocialResolvido: desafio.system.hackSocial.resolvido,
    genericoResolvido: desafio.system.generico.resolvido,
    equilibrarResolvido: desafio.system.equilibrar.resolvido,
    alcancarResolvido: desafio.system.alcancar?.resolvido ?? false,
    // Quem segura este obstáculo agora, e quanto o próximo teste vai descer.
    sustentadores: game.actors.filter((a) => a.type === "personagem" && a.system.estado?.sustentando?.ativo
      && a.system.estado.sustentando.desafioUuid === desafio.uuid)
      .map((a) => ({
        nome: a.name,
        passos: (a.system.estado.sustentando.fadiga ?? 0) + 1,
        ehEste: a.id === ator?.id,
      })),
    alcancarDt: desafio.system.alcancar?.dt ?? 7,
    equilibrarSucessos: desafio.system.equilibrar.ocultarSucessos && !game.user.isGM ? "?" : desafio.system.equilibrar.sucessos,
    sustentarDt: desafio.system.sustentar.dt,
    genericoRotulo: desafio.system.generico.rotulo?.trim() || game.i18n.localize("OP2.Desafio.Generico"),
    abordagens,
    dtObjeto: desafio.system.dtObjeto,
    ehEquilibrio: desafio.system.categoria === "equilibrio",
    ehAlcancar: desafio.system.categoria === "alcancar",
    temAlgumaAbordagem: Object.values(abordagens).some(Boolean) || ["equilibrio", "alcancar"].includes(desafio.system.categoria),
  };
}

const CHAVE_ABA = "op2.acoes.aba";

/** Abordagem do desafio → ação desta janela e ícone (o "Resolver desafio de acesso"). */
const ABORDAGENS_DE_ACESSO = [
  ["arrombar", "arrombar", "fa-hammer"], ["destrancar", "destrancar", "fa-key"],
  ["hackTecnico", "hackTecnico", "fa-laptop-code"], ["hackSocial", "hackSocial", "fa-comments"],
  ["equilibrar", "equilibrarDesafio", "fa-person-falling"], ["alcancar", "alcancarDesafio", "fa-person-walking"],
  ["sustentar", "sustentarDesafio", "fa-weight-hanging"], ["generico", "desafioGenerico", "fa-circle-question"],
];
const ROTULO_ABORDAGEM = {
  arrombar: "OP2.Desafio.Arrombar", destrancar: "OP2.Desafio.Destrancar", hackTecnico: "OP2.Desafio.HackTecnico",
  hackSocial: "OP2.Desafio.HackSocial", equilibrar: "OP2.Desafio.Equilibrar", alcancar: "OP2.Desafio.Alcancar",
  sustentar: "OP2.Desafio.Sustentar",
};

/** A última aba escolhida; sem registro, os pontos de interesse. */
function abaInicial() {
  try {
    const aba = window.localStorage.getItem(CHAVE_ABA);
    return ["livres", "pontos", "desafios"].includes(aba) ? aba : "pontos";
  } catch {
    return "pontos";
  }
}

/** O corpo da janela de ações rola dentro do `.window-content`, fora da parte. */
/**
 * Depois de a ação rolar, a janela fecha — o jogador escolheu, rolou, acabou (pedido em
 * uso real). Ação cancelada (diálogo fechado, sem alvo: as funções devolvem `null`)
 * deixa a janela onde estava. Navegação e "parar de sustentar" não passam por aqui.
 */
export function fechaDepois(acao) {
  return async function (evento, alvo) {
    const resultado = await acao.call(this, evento, alvo);
    if (resultado !== null && resultado !== false) await this.close();
  };
}

export class AcoesInvestigacaoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-acoes"],
    window: { title: "OP2.Acoes.Titulo", icon: "fa-solid fa-magnifying-glass", resizable: true },
    // Larga: é a mesa de ações do personagem, e vai receber mais grupos além dos
    // de investigação.
    position: { width: 640, height: 700 },
    actions: {
      ajudar: fechaDepois(AcoesInvestigacaoApp.#ajudar),
      atacar: fechaDepois(AcoesInvestigacaoApp.#atacar),
      usarRecurso: fechaDepois(AcoesInvestigacaoApp.#usarRecurso),
      recapitular: fechaDepois(AcoesInvestigacaoApp.#recapitular),
      compartilhar: fechaDepois(AcoesInvestigacaoApp.#compartilhar),
      alcancar: fechaDepois(AcoesInvestigacaoApp.#alcancar),
      atravessar: fechaDepois(AcoesInvestigacaoApp.#atravessar),
      equilibrarDesafio: fechaDepois(AcoesInvestigacaoApp.#equilibrarDesafio),
      resolverAcesso: AcoesInvestigacaoApp.#resolverAcesso,
      alcancarDesafio: fechaDepois(AcoesInvestigacaoApp.#alcancarDesafio),
      sustentar: fechaDepois(AcoesInvestigacaoApp.#sustentar),
      sustentarDesafio: fechaDepois(AcoesInvestigacaoApp.#sustentarDesafio),
      excluirDesafio: AcoesInvestigacaoApp.#excluirDesafio,
      pararDeSustentar: AcoesInvestigacaoApp.#pararDeSustentar,
      usarLaser: fechaDepois(AcoesInvestigacaoApp.#usarLaser),
      examinar: fechaDepois(AcoesInvestigacaoApp.#examinar),
      interagir: fechaDepois(AcoesInvestigacaoApp.#interagir),
      irParaDesafios: AcoesInvestigacaoApp.#irParaDesafios,
      regras: AcoesInvestigacaoApp.#regras,
      alternarChip: AcoesInvestigacaoApp.#alternarChip,
      limparFiltros: AcoesInvestigacaoApp.#limparFiltrosAcao,
      usarFerramenta: fechaDepois(AcoesInvestigacaoApp.#usarFerramenta),
      usarLaboratorio: fechaDepois(AcoesInvestigacaoApp.#usarLaboratorio),
      usarRadio: fechaDepois(AcoesInvestigacaoApp.#usarRadio),
      arrombar: fechaDepois(AcoesInvestigacaoApp.#arrombar),
      destrancar: fechaDepois(AcoesInvestigacaoApp.#destrancar),
      hackTecnico: fechaDepois(AcoesInvestigacaoApp.#hackTecnico),
      hackSocial: fechaDepois(AcoesInvestigacaoApp.#hackSocial),
      desafioGenerico: fechaDepois(AcoesInvestigacaoApp.#desafioGenerico),
    },
  };

  static PARTS = {
    corpo: { template: "systems/ordem-paranormal-2e/templates/actor/acoes-investigacao.hbs" },
  };

  /**
   * Três abas: o que o personagem pode fazer agora (livres), os pontos e os desafios.
   * Tudo numa lista só virava uma rolagem sem fim conforme a mesa revela coisas, com
   * desafio misturado no meio dos pontos (achado em uso real).
   */
  static TABS = {
    principal: {
      tabs: [{ id: "livres" }, { id: "pontos" }, { id: "desafios" }],
      initial: "pontos",
      labelPrefix: "OP2.Acoes.Aba",
    },
  };

  /** Os filtros de cada aba, como os do painel: vivem na instância. */
  #filtros = { pontos: filtrosVazios(), desafios: filtrosVazios() };

  /** @override — a aba escolhida é preferência de tela. */
  changeTab(aba, grupo, opcoes) {
    super.changeTab(aba, grupo, opcoes);
    if (grupo !== "principal") return;
    try {
      window.localStorage.setItem(CHAVE_ABA, aba);
    } catch {
      // Sem storage: dura só esta tela.
    }
  }

  /** Hook de `updateActor`, para soltar no fechamento. */
  #hookAtor = null;

  /** @param {Actor} ator */
  constructor(ator, opcoes = {}) {
    super({ id: `op2-acoes-${ator.id}`, ...opcoes });
    this.tabGroups.principal = abaInicial();
    this.ator = ator;

    // Investigar grava `estado.poisInvestigados` no personagem, e é isso que
    // libera Examinar/Interagir naquele ponto. Sem reagir ao update do ator os
    // botões ficavam travados até fechar e reabrir a janela (achado em uso real).
    this.#hookAtor = Hooks.on("updateActor", (documento) => {
      if (documento.id === this.ator.id) this.render();
    });
    // E o que o mestre libera no painel — ponto ou desafio que deixa de ser oculto,
    // linha aberta, participante novo — chega aqui pelo mesmo conjunto de janelas
    // que o painel usa; antes o jogador fechava e abria de novo (achado em uso real).
    janelasDeInvestigacao.add(this);
  }

  /** O resumo das regras abre ao lado, na primeira vez que a janela aparece. */
  async _onFirstRender(contexto, opcoes) {
    await super._onFirstRender?.(contexto, opcoes);
    const { abrirComAsAcoes } = await import("./regras-investigacao.mjs");
    abrirComAsAcoes(this);
  }

  static async #regras() {
    const { abrirRegras } = await import("./regras-investigacao.mjs");
    abrirRegras(this);
  }

  _onClose(opcoes) {
    super._onClose(opcoes);
    void import("./regras-investigacao.mjs").then((m) => m.fecharComAsAcoes());
    esquecerRolagem(this);
    if (this.#hookAtor) Hooks.off("updateActor", this.#hookAtor);
    this.#hookAtor = null;
    janelasDeInvestigacao.delete(this);
  }

  get title() {
    return `${game.i18n.localize("OP2.Acoes.Titulo")} — ${this.ator.name}`;
  }

  /** Agir rerrenderiza a janela — sem isto a lista de pontos voltava ao topo. */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    guardarRolagem(this, priorElement, state, [""]);
  }

  _syncPartState(partId, newElement, priorElement, state) {
    super._syncPartState(partId, newElement, priorElement, state);
    restaurarRolagem(this);
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    // A janela é a tela daquele personagem: veste a cor do perfil dele, como a ficha.
    this.element.dataset.perfil = this.ator.system.perfil ?? "";
    restaurarRolagem(this);

    // A barra de filtros de cada aba (a mesma do painel): só mexe no DOM, sem
    // rerrenderizar, e o estado fica na instância.
    ligarBarra(this.element, this.#filtros, (aba) => this.#aplicarFiltros(aba));
    for (const aba of ["pontos", "desafios"]) this.#aplicarFiltros(aba);
    // `data-action` num <select> reage ao próprio clique de abrir e fecha o menu
    // nativo no meio (achado em uso real, no painel) — listener manual, como todo
    // outro <select> do sistema.
    const seletor = this.element.querySelector("[data-seletor-investigacao]");
    seletor?.addEventListener("change", async () => {
      await definirInvestigacaoAtiva(seletor.value);
      this.render();
    });
  }

  #secaoDaAba(aba) {
    return this.element?.querySelector(`.op2-acoes__aba[data-tab="${aba}"]`) ?? null;
  }

  #aplicarFiltros(aba) {
    aplicarBarra(this.#secaoDaAba(aba), this.#filtros[aba], {
      lista: ".op2-acoes__lista", card: "[data-acao-card]", classeAchado: "op2-acoes__linha--achado",
    });
  }

  #limparFiltros(aba) {
    this.#filtros[aba] = limparBarra(this.#secaoDaAba(aba), this.#filtros[aba]);
    this.#aplicarFiltros(aba);
  }

  static #alternarChip(_evento, alvo) {
    alternarChip(this.#filtros[alvo.dataset.aba], alvo);
    this.#aplicarFiltros(alvo.dataset.aba);
  }

  static #limparFiltrosAcao(_evento, alvo) {
    this.#limparFiltros(alvo.dataset.aba);
  }

  /**
   * Leva até o card de um ponto (ou desafio): troca de aba, tira o filtro e destaca.
   * O marcador do mapa chama isto quando quem clica é jogador.
   */
  async focarCard(uuid, aba) {
    // Só renderiza quando a janela ainda não está na tela (é o caso do marcador do
    // mapa): rerrenderizar a cada atalho perdia a posição da rolagem e o card em foco.
    if (!this.rendered) await this.render({ force: true });
    if (aba && this.tabGroups.principal !== aba) this.changeTab(aba, "principal");
    // Um filtro ligado esconderia o card procurado: a busca cede a vez ao atalho.
    const abaDoCard = aba ?? this.tabGroups.principal;
    if (this.#filtros[abaDoCard] && filtrando(this.#filtros[abaDoCard])) this.#limparFiltros(abaDoCard);
    const card = this.element.querySelector(`[data-acao-card][data-uuid="${uuid}"]`);
    if (!card) return;
    card.hidden = false;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.remove("op2-acoes__linha--foco");
    void card.offsetWidth; // reinicia a animação se o card já estava em foco
    card.classList.add("op2-acoes__linha--foco");
    setTimeout(() => card.classList.remove("op2-acoes__linha--foco"), 2500);
  }

  /** Do ponto para os desafios dele: troca de aba e busca pelo nome do ponto. */
  static #irParaDesafios(_evento, alvo) {
    this.#filtros.desafios = { ...limparBarra(this.#secaoDaAba("desafios"), this.#filtros.desafios), termo: alvo.dataset.nome ?? "" };
    this.changeTab("desafios", "principal");
    const campo = this.#secaoDaAba("desafios")?.querySelector("[data-filtro-termo]");
    if (campo) campo.value = this.#filtros.desafios.termo;
    this.#aplicarFiltros("desafios");
  }

  async _prepareContext() {
    const investigacao = investigacaoAtiva();
    const ator = this.ator;

    // POI e desafio que o mestre escondeu não existem para quem age: a lista de
    // alvos aqui é a mesma que o painel mostra para o jogador.
    const ocultosPoi = investigacao?.system.poisOcultos ?? [];

    const desafios = (investigacao ? desafiosAVista(investigacao, false) : [])
      .map((uuid) => fromUuidSync(uuid))
      .filter((desafio) => desafio?.type === "desafio-acesso")
      .map((d, indice) => contextoDoDesafio(d, investigacao, indice, ator));
    const desafioPorUuid = new Map(desafios.map((d) => [d.uuid, d]));

    const pois = (investigacao?.system.pois ?? [])
      .filter((uuid) => !ocultosPoi.includes(uuid))
      .map((uuid) => fromUuidSync(uuid))
      .filter((poi) => poi?.type === "ponto-interesse")
      .map((poi, indice) => ({
        uuid: poi.uuid,
        nome: poi.name,
        img: poi.img,
        // O que a barra de filtros lê no card (`data-*`), pelo que ESTE personagem
        // já vê: progresso sem "esgotado" e só as perícias das linhas que chegaram
        // a ele — as outras entregariam que há algo ali.
        indice,
        ...resumoDoQuadro(poi, ator),
        marcado: marcadoresDoPonto(canvas?.scene, poi.uuid).length > 0,
        // Bloqueado por desafio de acesso: o jogador vê o cadeado antes de gastar ação.
        // Interagir fica impedido; Examinar só se ainda há algo achável do lado de
        // fora da tranca (a construção do baú) que este personagem não tenha.
        ...acessoDoPonto(poi),
        // Quantos desafios deste ponto estão à vista: um atalho leva à aba Desafios já
        // filtrada por ele. Com os botões do desafio dentro do ponto, as duas coisas se
        // embaralhavam (achado em uso real).
        totalDesafios: (poi.system.desafios ?? []).filter((d) => desafioPorUuid.has(d)).length,
        // Só as ferramentas que ESTE personagem carrega — a reação do POI segue
        // escondida até o uso (spec §9.3).
        ferramentas: FERRAMENTAS_POI
          .filter((chave) => temFerramenta(ator.items, chave))
          .map((chave) => ({ chave, rotulo: game.i18n.localize(`OP2.Ferramenta.Subtipo.${chave}`) })),
      }));


    return {
      atorNome: ator.name,
      ehGM: game.user.isGM,
      temInvestigacao: Boolean(investigacao),
      nomeInvestigacao: investigacao?.name ?? "",
      // O grupo pode estar em mais de uma investigação ao mesmo tempo — dá pra
      // trocar aqui sem voltar pro painel.
      investigacoes: investigacoesVisiveis().map((i) => ({ uuid: i.uuid, nome: i.name })),
      investigacaoAtualUuid: investigacao?.uuid ?? "",
      desafios,
      sustentando: ator.system.estado.sustentando?.ativo ?? false,
      // Ação sem alvo possível não é oferecida: avisar só depois do clique deixa o
      // jogador procurando o que não existe (achado em uso real).
      temAliados: alvosMarcados({ exceto: ator, tipos: ["personagem"] }).length > 0
        || alvosDaCenaAtiva({ exceto: ator }).length > 0,
      temAlvosDeAtaque: alvosMarcados({ exceto: ator }).length > 0
        || alvosDaCenaAtiva({ exceto: ator, comNpcs: true }).length > 0,
      temRecursos: ator.items.some((i) => ["habilidade", "equipamento", "ferramenta"].includes(i.type)),
      temLaser: temFerramenta(ator.items, "laser"),
      recapitularUsado: investigacao?.system.recapitularUsado ?? null,
      compartilharUsado: investigacao?.system.compartilharUsado ?? null,
      pois,
      tabs: this._prepareTabs("principal"),
      contagens: { pontos: pois.length, desafios: desafios.length },
      termos: { pontos: this.#filtros.pontos.termo, desafios: this.#filtros.desafios.termo },
      filtros: {
        pontos: contextoBarra("pontos", this.#filtros.pontos, { ehGM: false, pericias: pois.flatMap((p) => p.pericias.split(" ")) }),
        desafios: contextoBarra("desafios", this.#filtros.desafios, { ehGM: false }),
      },
    };
  }

  /* -- ações ---------------------------------------------------------------- */

  static async #ajudar() { return ajudar(this.ator); }
  static async #atacar() { return atacar(this.ator); }
  static async #usarRecurso() { return usarHabilidadeOuItem(this.ator); }
  static async #recapitular() { return recapitular(this.ator); }
  static async #compartilhar() { return compartilhar(this.ator); }
  static async #alcancar(_evento, alvo) {
    const dt = alvo.dataset.dt ? Number(alvo.dataset.dt) : undefined;
    return alcancar(this.ator, { modo: alvo.dataset.modo, dt });
  }

  static async #atravessar() {
    const { iniciarEquilibrio } = await import("./equilibrio.mjs");
    await iniciarEquilibrio(this.ator);
  }
  /**
   * "Resolver desafio de acesso" no ponto trancado: as abordagens dos desafios dele
   * ainda não vencidos. Uma só vai direto (abre a caixa do Destrancar, rola o
   * Arrombar…); várias abrem a escolha.
   */
  static async #resolverAcesso(evento, alvo) {
    const poi = fromUuidSync(alvo.dataset.poiUuid);
    const opcoes = [];
    for (const desafio of (poi?.system.desafios ?? []).map((u) => fromUuidSync(u))) {
      if (desafio?.type !== "desafio-acesso" || desafioResolvido(desafio.system)) continue;
      const { abordagens } = desafio.system;
      for (const [chave, acao, icone] of ABORDAGENS_DE_ACESSO) {
        if (!abordagens?.[chave]) continue;
        if (["arrombar", "destrancar"].includes(chave) && (desafio.system.quebrado || desafio.system.destrancado)) continue;
        const rotulo = chave === "generico"
          ? (desafio.system.generico.rotulo?.trim() || game.i18n.localize("OP2.Desafio.Generico"))
          : game.i18n.localize(ROTULO_ABORDAGEM[chave]);
        opcoes.push({ acao, icone, uuid: desafio.uuid, rotulo: (poi.system.desafios.length > 1 ? `${desafio.name}: ` : "") + rotulo });
      }
    }
    if (!opcoes.length) return void ui.notifications.warn(game.i18n.localize("OP2.Acesso.SemAbordagem"));
    let escolhida = opcoes[0];
    if (opcoes.length > 1) {
      const indice = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.format("OP2.Acesso.ResolverTitulo", { ponto: poi.name }), icon: "fa-solid fa-lock-open" },
        classes: ["op2", "op2-dlg", "op2-defesa-janela"],
        content: `<p class="op2-ajuda">${game.i18n.localize("OP2.Acesso.ResolverAjuda")}</p>`,
        buttons: opcoes.map((o, i) => ({ action: String(i), label: o.rotulo, icon: `fa-solid ${o.icone}`, default: i === 0 })),
        rejectClose: false,
      });
      if (indice === null || indice === undefined) return;
      escolhida = opcoes[Number(indice)];
    }
    const executar = this.options.actions[escolhida.acao];
    const handler = typeof executar === "function" ? executar : executar?.handler;
    await handler?.call(this, evento, { dataset: { desafioUuid: escolhida.uuid } });
  }

  /** Alcançar um obstáculo: o jogador escolhe seguro ou arriscado. */
  static async #alcancarDesafio(_evento, alvo) {
    const { alcancarDesafio } = await import("./acoes-desafio.mjs");
    return alcancarDesafio(this.ator, alvo.dataset.desafioUuid);
  }

  /** Equilibrar-se num desafio: a travessia conta os sucessos dele. */
  static async #equilibrarDesafio(_evento, alvo) {
    const { iniciarEquilibrio } = await import("./equilibrio.mjs");
    await iniciarEquilibrio(this.ator, { desafioUuid: alvo.dataset.desafioUuid });
  }
  static async #sustentar() { const r = await sustentar(this.ator); this.render(); return r; }

  /** Sustentar um obstáculo da cena: a DT é a dele (a estante-porta do Ato I). */
  static async #excluirDesafio(_evento, alvo) {
    if (await excluirDesafio(alvo.dataset.desafioUuid)) this.render();
  }

  static async #sustentarDesafio(_evento, alvo) {
    const r = await sustentar(this.ator, { desafioUuid: alvo.dataset.desafioUuid });
    this.render();
    return r;
  }
  static async #pararDeSustentar() { await pararDeSustentar(this.ator); this.render(); }
  static async #usarLaser() { return usarLaser(this.ator); }

  /**
   * Investigar (playtest Beta): abre o card do passo 1 no chat, com as perícias do
   * ponto. Daí em diante o card conduz: o mestre manda o passivo, o jogador escolhe
   * Observar ou Examinar (`investigar.mjs`). Com `data-pericia` (atalho antigo de
   * macro), segue o Examinar direto do Alpha.
   */
  static async #examinar(_evento, alvo) {
    if (alvo.dataset.pericia) return examinar(this.ator, alvo.dataset.poiUuid, alvo.dataset.pericia);
    const { iniciarInvestigacao } = await import("./investigar.mjs");
    return iniciarInvestigacao(this.ator, alvo.dataset.poiUuid);
  }
  static async #interagir(_evento, alvo) { return interagir(this.ator, alvo.dataset.poiUuid); }

  static async #usarFerramenta(_evento, alvo) {
    return usarFerramenta(this.ator, alvo.dataset.poiUuid, alvo.dataset.ferramenta);
  }

  /**
   * Laboratório Portátil é minigame: pede quantos dados o POI exige (spec §9.1). O
   * padrão vem do próprio ponto (`laboratorioDados`, a "sequência mínima" do livro);
   * o mestre ainda pode mudar na hora.
   */
  static async #usarLaboratorio(_evento, alvo) {
    const poi = alvo.dataset.poiUuid ? fromUuidSync(alvo.dataset.poiUuid) : null;
    const padrao = poi?.system?.laboratorioDados ?? 4;
    const qtdDados = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("OP2.Ferramenta.Subtipo.laboratorio") },
      content: `
        <div class="form-group">
          <label>${game.i18n.localize("OP2.Ferramenta.QtdDados")}</label>
          <input type="number" name="qtd" value="${padrao}" min="4" max="6">
        </div>`,
      ok: { callback: (_ev, botao) => Number(botao.form.elements.qtd.value) },
      rejectClose: false,
      render: renderDoPerfil(this.ator),
    });
    if (!qtdDados) return null;
    await abrirLaboratorio(this.ator, qtdDados, alvo.dataset.poiUuid);
    return true;
  }

  static async #usarRadio(_evento, alvo) {
    const resultado = await usarRadio(this.ator, alvo.dataset.poiUuid);
    if (!resultado) return null;
    abrirRadio(resultado);
    return resultado;
  }

  static async #arrombar(_evento, alvo) { const r = await arrombar(this.ator, alvo.dataset.desafioUuid); this.render(); return r; }
  static async #destrancar(_evento, alvo) { abrirDestrancar(alvo.dataset.desafioUuid); return true; }
  static async #hackTecnico(_evento, alvo) { const r = await hackTecnico(this.ator, alvo.dataset.desafioUuid); this.render(); return r; }
  static async #hackSocial(_evento, alvo) { const r = await hackSocial(this.ator, alvo.dataset.desafioUuid); this.render(); return r; }
  static async #desafioGenerico(_evento, alvo) { const r = await desafioGenerico(this.ator, alvo.dataset.desafioUuid); this.render(); return r; }
}

export function abrirAcoesInvestigacao(ator) {
  const app = new AcoesInvestigacaoApp(ator);
  app.render({ force: true });
  return app;
}

/**
 * O atalho de teclado (Shift+I): a janela do personagem aberta fecha, fechada abre.
 * O personagem é o do token selecionado (um jogador com dois personagens), senão o
 * do usuário.
 */
export function alternarAcoesInvestigacao(ator = personagemDoUsuario()) {
  if (!ator) {
    ui.notifications.warn(game.i18n.localize("OP2.Atalhos.SemPersonagem"));
    return null;
  }
  const aberta = foundry.applications.instances.get(`op2-acoes-${ator.id}`);
  if (aberta?.rendered) {
    aberta.close();
    return null;
  }
  return abrirAcoesInvestigacao(ator);
}

function personagemDoUsuario() {
  const controlado = canvas?.tokens?.controlled?.[0]?.actor;
  if (controlado?.type === "personagem") return controlado;
  return game.user.character ?? null;
}

/**
 * O que o personagem já vê do quadro de um ponto: a mesma leitura do painel do
 * jogador (linha aberta, contada ao grupo ou descoberta por ele).
 */
/**
 * Ponto trancado: Interagir fica impedido; Examinar continua (alcança só o lado de
 * fora). O botão nunca diz se ainda há algo lá fora — isso o jogador arrisca.
 */
function acessoDoPonto(poi) {
  return { trancado: pontoTrancado(poi), examinarBloqueado: false };
}

function resumoDoQuadro(poi, ator) {
  const visiveis = poi.system.informacoes.filter((info) => info.aberta
    || (info.contadaPor?.length ?? 0) > 0
    || ator.system.estado.infosReveladas.has(chaveInfo(poi.uuid, info.id)));
  return {
    progresso: visiveis.length > 0 ? "andamento" : "intocado",
    pericias: [...new Set(visiveis.flatMap(periciasDaLinha))].join(" "),
  };
}
