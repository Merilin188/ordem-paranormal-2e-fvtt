/**
 * Ficha do Ponto de Interesse — ferramenta do mestre (spec §6.2).
 *
 * O quadro de informações, a descrição contextual e o setor de ferramentas são
 * só do mestre: o jogador nunca vê DT, reação de ferramenta nem a explicação
 * do POI. A revelação acontece pelas ações de investigação, não pela ficha.
 */
import { PERICIAS, APTIDOES_PADRAO, FERRAMENTAS_POI } from "../config.mjs";
import { OP2ItemSheet } from "./item-sheet.mjs";
import { rotuloDePericia } from "../dice/teste.mjs";
import { cicloVisibilidadeInfo, limparRevelacao, descontarDoGrupo } from "../cena/acoes-investigacao.mjs";
import { vincularDesafioAoPonto, removerDesafioDoPonto, todasInvestigacoes, alternarOculto } from "../cena/investigacao-ativa.mjs";
import { chaveInfo } from "../cena/investigacao.mjs";
import { textoPuroDaLinha } from "../cena/texto-linha.mjs";
import { desafioResolvido } from "../cena/desafios.mjs";
import { pontoTrancado, liberarAcesso, trancarDeNovo, criarDesafioDoPonto } from "../cena/acesso-poi.mjs";
import { excluirDesafio, excluirPontoDeInteresse } from "../cena/excluir-desafio.mjs";
import { itensDaLinha, podeSerItemDePista } from "../cena/itens-pista.mjs";
import {
  novaTransicao, marcarPadrao, nomeDaTransicao, mostrarTransicao, escolherEMostrar, transicaoValida,
} from "../cena/transicoes.mjs";

export class PontoInteresseSheet extends OP2ItemSheet {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-ficha--poi"],
    position: { width: 560, height: "auto" },
    actions: {
      adicionarInformacao: PontoInteresseSheet.#adicionarInformacao,
      removerInformacao: PontoInteresseSheet.#removerInformacao,
      cicloVisibilidadeInfo: PontoInteresseSheet.#cicloVisibilidadeInfo,
      removerFerramenta: PontoInteresseSheet.#removerFerramenta,
      adicionarConjuntoRadio: PontoInteresseSheet.#adicionarConjuntoRadio,
      removerConjuntoRadio: PontoInteresseSheet.#removerConjuntoRadio,
      abrirDesafioVinculado: PontoInteresseSheet.#abrirDesafioVinculado,
      removerDesafioVinculado: PontoInteresseSheet.#removerDesafioVinculado,
      alternarOcultoNaInvestigacao: PontoInteresseSheet.#alternarOcultoNaInvestigacao,
      limparRevelacao: PontoInteresseSheet.#limparRevelacao,
      descontarDoGrupo: PontoInteresseSheet.#descontarDoGrupo,
      criarDesafioAcesso: PontoInteresseSheet.#criarDesafioAcesso,
      liberarAcesso: PontoInteresseSheet.#liberarAcesso,
      trancarDeNovo: PontoInteresseSheet.#trancarDeNovo,
      alternarForaDaTranca: PontoInteresseSheet.#alternarForaDaTranca,
      excluirDesafioVinculado: PontoInteresseSheet.#excluirDesafioVinculado,
      excluirPonto: PontoInteresseSheet.#excluirPonto,
      adicionarAlternativa: PontoInteresseSheet.#adicionarAlternativa,
      removerItemDaPista: PontoInteresseSheet.#removerItemDaPista,
      abrirItemDaPista: PontoInteresseSheet.#abrirItemDaPista,
      adicionarTransicao: PontoInteresseSheet.#adicionarTransicao,
      removerTransicao: PontoInteresseSheet.#removerTransicao,
      marcarTransicaoPadrao: PontoInteresseSheet.#marcarTransicaoPadrao,
      mostrarTransicao: PontoInteresseSheet.#mostrarTransicao,
      levarAMesa: PontoInteresseSheet.#levarAMesa,
      removerAlternativa: PontoInteresseSheet.#removerAlternativa,
    },
  };

  /**
   * Soltar um Desafio de acesso na ficha liga os dois. `dragDrop` em DEFAULT_OPTIONS é
   * do AppV1 e o V2 ignora: a instância é criada aqui e religada a cada render.
   */
  get _dragDrop() {
    return this.#dragDrop ??= new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".op2-poi__desafios, .op2-poi__info",
      permissions: { drop: () => game.user.isGM && this.isEditable },
      callbacks: { drop: this._onDrop.bind(this) },
    });
  }

  #dragDrop = null;

  async _onDrop(evento) {
    let dados;
    try {
      dados = JSON.parse(evento.dataTransfer.getData("text/plain"));
    } catch { return; }
    if (dados?.type !== "Item") return;
    const item = await fromUuid(dados.uuid);
    // Solto numa linha do quadro: o item passa a ser guardado por aquela pista.
    const linha = evento.target.closest?.(".op2-poi__info");
    if (linha) {
      if (!podeSerItemDePista(item)) return void ui.notifications.warn(game.i18n.localize("OP2.ItensPista.SoItens"));
      const informacoes = this.item.system.toObject().informacoes.map((i) => (i.id === linha.dataset.infoId
        ? { ...i, itens: [...new Set([...(i.itens ?? []), item.uuid])] } : i));
      await this.item.update({ "system.informacoes": informacoes });
      return;
    }
    if (item?.type === "desafio-acesso") await vincularDesafioAoPonto(this.item, item.uuid);
  }

  static async #removerItemDaPista(_evento, alvo) {
    const informacoes = this.item.system.toObject().informacoes.map((i) => (i.id === alvo.dataset.infoId
      ? { ...i, itens: (i.itens ?? []).filter((u) => u !== alvo.dataset.uuid) } : i));
    await this.item.update({ "system.informacoes": informacoes });
  }

  static async #abrirItemDaPista(_evento, alvo) {
    (await fromUuid(alvo.dataset.uuid))?.sheet?.render(true);
  }

  static async #alternarOcultoNaInvestigacao(_evento, alvo) {
    const investigacao = await fromUuid(alvo.dataset.investigacao);
    if (!investigacao) return;
    await alternarOculto(investigacao, "pois", this.item.uuid);
    await this.render();
  }

  static async #limparRevelacao(_evento, alvo) {
    await limparRevelacao(this.item.uuid, alvo.dataset.infoId);
    await this.render();
  }

  /** Tira a linha contada do painel de todos; quem achou continua sabendo. */
  static async #descontarDoGrupo(_evento, alvo) {
    if (await descontarDoGrupo(this.item.uuid, alvo.dataset.infoId)) {
      ui.notifications.info(game.i18n.localize("OP2.Investigacao.Descontada"));
    }
    await this.render();
  }

  static async #criarDesafioAcesso() {
    await criarDesafioDoPonto(this.item);
  }

  static async #excluirDesafioVinculado(_evento, alvo) {
    if (await excluirDesafio(alvo.dataset.uuid)) this.render();
  }

  /** "ou outra perícia": a mesma linha achada por mais de uma perícia. */
  static async #adicionarAlternativa(_evento, alvo) {
    const opcoes = PontoInteresseSheet.#chavesDePericia();
    const informacoes = this.item.system.toObject().informacoes.map((i) => {
      if (i.id !== alvo.dataset.infoId) return i;
      const usadas = new Set([i.pericia, ...(i.periciasAlternativas ?? [])]);
      const livre = opcoes.find((c) => !usadas.has(c));
      return livre ? { ...i, periciasAlternativas: [...(i.periciasAlternativas ?? []), livre] } : i;
    });
    await this.item.update({ "system.informacoes": informacoes });
  }

  static async #removerAlternativa(_evento, alvo) {
    const indice = Number(alvo.dataset.indice);
    const informacoes = this.item.system.toObject().informacoes.map((i) => (i.id === alvo.dataset.infoId
      ? { ...i, periciasAlternativas: (i.periciasAlternativas ?? []).filter((_c, j) => j !== indice) } : i));
    await this.item.update({ "system.informacoes": informacoes });
  }

  static #chavesDePericia() {
    return [
      ...Object.keys(PERICIAS).filter((c) => !PERICIAS[c].especializada),
      ...APTIDOES_PADRAO.map((sub) => `aptidao.${sub}`),
    ];
  }

  /**
   * O envio do formulário manda só o que tem campo (perícia, DT, texto…), e o
   * Foundry troca o quadro INTEIRO pelo que chegou: o resto da linha voltava ao
   * padrão (rascunho/aberta, contada ao grupo, alternativas). Cada linha enviada é
   * mesclada sobre a linha guardada, pelo id.
   */
  _processFormData(evento, form, formData) {
    const dados = super._processFormData(evento, form, formData);
    const enviadas = dados?.system?.informacoes;
    if (enviadas && typeof enviadas === "object") {
      const guardadas = new Map(this.item.system.toObject().informacoes.map((i) => [i.id, i]));
      const lista = Array.isArray(enviadas) ? enviadas
        : Object.keys(enviadas).sort((a, b) => Number(a) - Number(b)).map((k) => enviadas[k]);
      dados.system.informacoes = lista.filter(Boolean).map((nova) => {
        const linha = { ...(guardadas.get(nova.id) ?? {}), ...nova };
        const alt = nova.periciasAlternativas;
        if (alt && !Array.isArray(alt)) {
          linha.periciasAlternativas = Object.keys(alt).sort((a, b) => Number(a) - Number(b)).map((k) => alt[k]);
        }
        return linha;
      });
    }
    return dados;
  }

  static async #adicionarTransicao() {
    const transicoes = this.item.system.toObject().transicoes;
    transicoes.push(novaTransicao({ padrao: transicoes.length === 0 }));
    await this.item.update({ "system.transicoes": transicoes });
  }

  static async #removerTransicao(_evento, alvo) {
    let transicoes = this.item.system.toObject().transicoes.filter((t) => t.id !== alvo.dataset.id);
    // Tirou a padrão: a primeira que sobrou assume.
    if (transicoes.length && !transicoes.some((t) => t.padrao)) transicoes = marcarPadrao(transicoes, transicoes[0].id);
    await this.item.update({ "system.transicoes": transicoes });
  }

  static async #marcarTransicaoPadrao(_evento, alvo) {
    await this.item.update({ "system.transicoes": marcarPadrao(this.item.system.toObject().transicoes, alvo.dataset.id) });
  }

  static async #mostrarTransicao(_evento, alvo) {
    // Salva o que está digitado antes (imagem recém-escolhida, modo trocado).
    await this.submit();
    await mostrarTransicao(this.item, alvo.dataset.id);
  }

  static async #levarAMesa() {
    await escolherEMostrar(this.item);
  }

  static async #excluirPonto() {
    await excluirPontoDeInteresse(this.item.uuid);
  }

  static async #liberarAcesso() {
    await liberarAcesso(this.item);
  }

  static async #trancarDeNovo() {
    await trancarDeNovo(this.item);
  }

  /** A linha pode ser achada com o ponto trancado (lê-se o baú, não o que há dentro). */
  static async #alternarForaDaTranca(_evento, alvo) {
    const informacoes = this.item.system.informacoes
      .map((i) => (i.id === alvo.dataset.infoId ? { ...i, foraDaTranca: !i.foraDaTranca } : { ...i }));
    await this.item.update({ "system.informacoes": informacoes });
  }

  static async #abrirDesafioVinculado(_evento, alvo) {
    (await fromUuid(alvo.dataset.uuid))?.sheet?.render(true);
  }

  static async #removerDesafioVinculado(_evento, alvo) {
    await removerDesafioDoPonto(this.item, alvo.dataset.uuid);
  }

  static TABS = {
    principal: {
      tabs: [{ id: "investigacao" }, { id: "mestre" }],
      initial: "investigacao",
      labelPrefix: "OP2.POI.Aba",
    },
  };

  /**
   * Ferramentas recém-adicionadas ainda sem texto. O core limpa "" e " " para vazio,
   * então a linha nova vive aqui até o mestre escrever a reação — nada suja os dados.
   */
  #ferramentasNovas = new Set();

  // A ficha reflete a investigação e as revelações: quando um ator (investigação ou
  // personagem) muda, refaz — o painel faz o mesmo por outro caminho.
  #ganchoAtor = null;

  _onFirstRender(contexto, opcoes) {
    super._onFirstRender?.(contexto, opcoes);
    this.#ganchoAtor = Hooks.on("updateActor", (ator) => {
      if (["investigacao", "personagem"].includes(ator.type) && this.rendered) this.render();
    });
  }

  _onClose(opcoes) {
    super._onClose?.(opcoes);
    if (this.#ganchoAtor) { Hooks.off("updateActor", this.#ganchoAtor); this.#ganchoAtor = null; }
  }

  async _prepareContext(opcoes) {
    const contexto = await super._prepareContext(opcoes);
    const ehGM = game.user.isGM;
    const editor = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
    const enriquecer = (html) => editor.enrichHTML(html ?? "", { relativeTo: this.item, secrets: this.item.isOwner });

    const ferramentas = this.item.system.ferramentas;
    const rotuloFerramenta = (chave) => game.i18n.localize(`OP2.POI.Ferramenta.${chave}`);
    // O texto salvou: não é mais "nova".
    for (const chave of [...this.#ferramentasNovas]) {
      if (ferramentas[chave]) this.#ferramentasNovas.delete(chave);
    }

    // O mestre chega aqui pelo marcador no mapa: os controles do card do painel
    // (oculto na investigação, quem já viu, limpar revelação) ficam aqui também,
    // sem precisar abrir o painel (pedido em uso real).
    const uuid = this.item.uuid;
    const investigacoes = ehGM ? todasInvestigacoes()
      .filter((inv) => inv.system.pois.includes(uuid))
      .map((inv) => ({ uuid: inv.uuid, nome: inv.name, oculto: inv.system.poisOcultos.includes(uuid) })) : [];
    const personagens = ehGM ? game.actors.filter((a) => a.type === "personagem") : [];
    const nomes = (ids) => ids.map((id) => game.actors.get(id)?.name ?? "?").join(", ");

    return {
      ...contexto,
      ehGM,
      investigacoes,
      // A aba do mestre some para jogadores — nem o rótulo pode vazar.
      tabs: ehGM ? contexto.tabs : contexto.tabs.filter((t) => t.id !== "mestre"),
      informacoes: this.item.system.informacoes.map((info, indice) => ({
        ...info,
        indice,
        // Linha antiga em HTML: mostra (e, ao salvar, grava) texto puro.
        texto: textoPuroDaLinha(info.texto),
        alternativas: (info.periciasAlternativas ?? []).map((chave, j) => ({ chave, j })),
        itensDaPista: itensDaLinha(info),
        // Três estados por linha, um botão só (o mesmo do painel).
        estado: info.oculta ? "rascunho" : (info.aberta ? "aberta" : "descobrivel"),
        reveladoPor: ehGM ? personagens.filter((a) => a.system.estado?.infosReveladas?.has(chaveInfo(uuid, info.id))).map((a) => a.name).join(", ") : "",
        contadaPor: ehGM && info.contadaPor?.length ? nomes(info.contadaPor) : "",
      })).map((info) => ({ ...info, temRevelacao: Boolean(info.reveladoPor || info.contadaPor) })),
      descricaoBasicaEnriquecida: await enriquecer(this.item.system.descricaoBasica),
      descricaoContextualEnriquecida: await enriquecer(this.item.system.descricaoContextual),
      // Bloqueio por desafio de acesso: o que o mestre vê do estado da tranca.
      acesso: {
        ...this.item.system.acesso,
        trancado: pontoTrancado(this.item),
        aoLiberarEnriquecido: await enriquecer(this.item.system.acesso.aoLiberar),
      },
      // Perícias válidas no quadro: as 19 comuns + cada campo de Aptidão.
      opcoesPericia: [
        ...Object.keys(PERICIAS).filter((c) => !PERICIAS[c].especializada),
        ...APTIDOES_PADRAO.map((sub) => `aptidao.${sub}`),
      ].map((c) => ({ chave: c, rotulo: rotuloDePericia(c) })),
      // Só as ferramentas com reação (ou recém-adicionadas) aparecem; as demais
      // ficam no seletor. Vazio (null ou "") = leitura normal (spec §9.3). Rádio
      // Modificado tem editor próprio (conjuntos), não texto livre (docs/LACUNAS.md).
      ferramentasConfiguradas: FERRAMENTAS_POI
        .filter((chave) => ferramentas[chave] || this.#ferramentasNovas.has(chave))
        .map((chave) => ({
          chave,
          rotulo: rotuloFerramenta(chave),
          ehRadio: chave === "radio",
          valor: chave === "radio" ? "" : (ferramentas[chave] || ""),
          conjuntos: chave === "radio"
            ? (ferramentas.radio?.conjuntos ?? []).map((conjunto, indice) => ({ ...conjunto, indice }))
            : [],
          radioTexto: chave === "radio" ? (ferramentas.radio?.texto ?? "") : "",
        })),
      ferramentasDisponiveis: FERRAMENTAS_POI
        .filter((chave) => !ferramentas[chave] && !this.#ferramentasNovas.has(chave))
        .map((chave) => ({ chave, rotulo: rotuloFerramenta(chave) })),
      transicoes: this.item.system.transicoes.map((t, indice) => {
        const cena = t.cenaUuid ? fromUuidSync(t.cenaUuid) : null;
        return {
          ...t, indice,
          nomeSugerido: nomeDaTransicao({ ...t, nome: "" }, this.item),
          ehExistente: t.modo === "existente",
          // A miniatura: a imagem, ou a da cena escolhida.
          miniatura: t.modo === "existente" ? (cena?.thumb ?? "") : t.imagem,
          cenaCriada: t.modo === "cena" && Boolean(cena),
        };
      }),
      // As cenas do mundo para "levar para cena existente" (as de transição por último).
      cenasDoMundo: game.scenes.contents
        .map((c) => ({ uuid: c.uuid, nome: c.name, transicao: Boolean(c.getFlag("ordem-paranormal-2e", "transicao")) }))
        .sort((a, b) => (a.transicao - b.transicao) || a.nome.localeCompare(b.nome)),
      temTransicoes: this.item.system.transicoes.some(transicaoValida),
      // Os desafios deste ponto: a porta trancada do Depósito A é do Depósito A.
      desafiosVinculados: this.item.system.desafios.map((uuid) => fromUuidSync(uuid))
        .filter((d) => d?.type === "desafio-acesso")
        .map((d) => ({ uuid: d.uuid, nome: d.name, img: d.img, resolvido: desafioResolvido(d.system) })),
    };
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    if (!game.user.isGM || !this.isEditable) return;
    this._dragDrop.bind(this.element);
    // Adicionar uma ferramenta abre a linha vazia; o texto salva sozinho na edição.
    const seletor = this.element.querySelector("[data-seletor-ferramenta]");
    seletor?.addEventListener("change", async () => {
      if (!seletor.value) return;
      // Rádio Modificado não tem texto pra digitar — sem isto, a linha "nova"
      // nunca vira "configurada" (o filtro olha `ferramentas.radio` truthy).
      if (seletor.value === "radio") {
        await this.item.update({ "system.ferramentas.radio": { conjuntos: [] } });
        return;
      }
      this.#ferramentasNovas.add(seletor.value);
      this.render();
    });
  }

  static async #adicionarInformacao() {
    const informacoes = this.item.system.informacoes.map((i) => ({ ...i }));
    informacoes.push({ id: foundry.utils.randomID(), pericia: "percepcao", dt: 7, texto: "" });
    await this.item.update({ "system.informacoes": informacoes });
  }

  static async #removerInformacao(_evento, alvo) {
    const informacoes = this.item.system.informacoes
      .filter((info) => info.id !== alvo.dataset.infoId)
      .map((i) => ({ ...i }));
    await this.item.update({ "system.informacoes": informacoes });
  }

  /** Rascunho → descobrível → aberta → rascunho. Mesma regra do painel. */
  static async #cicloVisibilidadeInfo(_evento, alvo) {
    await cicloVisibilidadeInfo(this.item.uuid, alvo.dataset.infoId);
  }

  static async #removerFerramenta(_evento, alvo) {
    this.#ferramentasNovas.delete(alvo.dataset.ferramenta);
    await this.item.update({ [`system.ferramentas.${alvo.dataset.ferramenta}`]: null });
  }

  static async #adicionarConjuntoRadio() {
    const conjuntos = [...(this.item.system.ferramentas.radio?.conjuntos ?? []), { verdadeiro: true, frase: "" }];
    await this.item.update({ "system.ferramentas.radio.conjuntos": conjuntos });
  }

  static async #removerConjuntoRadio(_evento, alvo) {
    const conjuntos = (this.item.system.ferramentas.radio?.conjuntos ?? [])
      .filter((_conjunto, indice) => indice !== Number(alvo.dataset.indice));
    await this.item.update({ "system.ferramentas.radio.conjuntos": conjuntos });
  }
}
