/**
 * Ficha do desafio de acesso — o objeto que Arrombar, Destrancar ou Hackear
 * tentam vencer (spec §7.1/§7.2/§7.3).
 */
import { PERICIAS } from "../config.mjs";
import { rotuloDePericia } from "../dice/teste.mjs";
import { OP2ItemSheet } from "./item-sheet.mjs";
import { gerarSenhaDestrancar, posicoesDoPalpite } from "../cena/acoes-desafio.mjs";
import { facesDasPosicoes } from "../cena/desafios.mjs";
import { CATEGORIAS_DESAFIO, rotuloCategoria } from "../cena/categorias-desafio.mjs";
import { iniciarHackTecnico } from "../cena/timer-hack.mjs";
import { podeSerItemDePista } from "../cena/itens-pista.mjs";

export class DesafioAcessoSheet extends OP2ItemSheet {
  static DEFAULT_OPTIONS = {
    // `height: "auto"` (o padrão da ficha de item) cresce sem teto: com as
    // abordagens ligadas a janela passava da tela e o fim do formulário ficava
    // inalcançável, sem barra de rolagem (achado em uso real — o mesmo problema
    // que o painel já teve). Altura numérica dá ao core o que clampar.
    position: { width: 560, height: 720 },
    classes: ["op2", "op2-ficha--desafio"],
    actions: {
      ajustarPontuacao: DesafioAcessoSheet.#ajustarPontuacao,
      ajustarTentativas: DesafioAcessoSheet.#ajustarTentativas,
      adicionarPerguntaHack: DesafioAcessoSheet.#adicionarPerguntaHack,
      removerPerguntaHack: DesafioAcessoSheet.#removerPerguntaHack,
      iniciarHackFaixa: DesafioAcessoSheet.#iniciarHackFaixa,
      adicionarLinhaHack: DesafioAcessoSheet.#adicionarLinhaHack,
      gerarSenha: DesafioAcessoSheet.#gerarSenha,
      limparSenha: DesafioAcessoSheet.#limparSenha,
      salvarSenhaManual: DesafioAcessoSheet.#salvarSenhaManual,
      salvarDados: DesafioAcessoSheet.#salvarDados,
      removerItemGuardado: DesafioAcessoSheet.#removerItemGuardado,
      abrirItemGuardado: DesafioAcessoSheet.#abrirItemGuardado,
      reanunciarItens: DesafioAcessoSheet.#reanunciarItens,
    },
  };

  /** Soltar um item na área "Itens guardados" guarda o item atrás deste obstáculo. */
  get _dragDrop() {
    return this.#dragDrop ??= new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".op2-desafio-itens",
      permissions: { drop: () => game.user.isGM && this.isEditable },
      callbacks: { drop: this.#soltarItem.bind(this) },
    });
  }

  #dragDrop = null;

  async #soltarItem(evento) {
    let dados;
    try { dados = JSON.parse(evento.dataTransfer.getData("text/plain")); } catch { return; }
    if (dados?.type !== "Item") return;
    const item = await fromUuid(dados.uuid);
    if (!podeSerItemDePista(item)) return void ui.notifications.warn(game.i18n.localize("OP2.ItensPista.SoItens"));
    await this.item.update({ "system.itens": [...new Set([...(this.item.system.itens ?? []), item.uuid])] });
  }

  _onRender(contexto, opcoes) {
    super._onRender?.(contexto, opcoes);
    if (game.user.isGM && this.isEditable) this._dragDrop.bind(this.element);
  }

  static async #removerItemGuardado(_evento, alvo) {
    await this.item.update({ "system.itens": (this.item.system.itens ?? []).filter((u) => u !== alvo.dataset.uuid) });
  }

  static async #abrirItemGuardado(_evento, alvo) {
    (await fromUuid(alvo.dataset.uuid))?.sheet?.render(true);
  }

  /** Mandar o card dos itens agora, escolhendo para quem (menu flutuante). */
  static async #reanunciarItens(_evento, alvo) {
    const { anunciarItensDoDesafio, quemVenceu } = await import("../cena/itens-pista.mjs");
    const vencedor = quemVenceu(this.item);
    const L = (k, d) => (d ? game.i18n.format(`OP2.ItensPista.${k}`, d) : game.i18n.localize(`OP2.ItensPista.${k}`));
    const para = await escolherNoMenu(alvo, [
      { valor: "todos", icone: "fa-users", rotulo: L("ParaTodos") },
      { valor: "mestre", icone: "fa-user-secret", rotulo: L("ParaMestre") },
      { valor: "descobridor", icone: "fa-user-check", rotulo: vencedor ? L("ParaDescobridor", { ator: vencedor.name }) : L("ParaDescobridorNinguem"), desligado: !vencedor },
    ]);
    if (para) await anunciarItensDoDesafio(this.item, { para, forcar: true });
  }

  /** Sorteia a senha com o tamanho e as faces do cadastro; zera o histórico. */
  static async #gerarSenha() {
    if (!this.isEditable) return;
    await gerarSenhaDestrancar(this.item.uuid);
  }

  static async #limparSenha() {
    if (!this.isEditable) return;
    await this.item.update({
      "system.senha": [], "system.historicoDestrancar": [], "system.destrancarTentativas": 0, "system.destrancado": false,
    });
  }

  /** Lê os dados por posição e os valores digitados na seção de senha manual. */
  #lerPosicoes() {
    const faces = [...this.element.querySelectorAll("[data-faces-pos]")].map((el) => Number(el.value));
    const valores = [...this.element.querySelectorAll("[data-valor-pos]")].map((el) => Number(el.value) || null);
    return { faces, valores };
  }

  /** Só os dados de cada posição (a senha sai no sorteio). */
  static async #salvarDados() {
    if (!this.isEditable) return;
    const { faces } = this.#lerPosicoes();
    await this.item.update({ "system.facesPorPosicao": faces });
  }

  /** Senha digitada pelo mestre: cada valor dentro do dado da posição. Zera o histórico. */
  static async #salvarSenhaManual() {
    if (!this.isEditable) return;
    const { faces, valores } = this.#lerPosicoes();
    if (valores.some((v, i) => !v || v < 1 || v > faces[i])) {
      ui.notifications.warn(game.i18n.localize("OP2.Desafio.SenhaManualInvalida"));
      return;
    }
    await this.item.update({
      "system.facesPorPosicao": faces,
      "system.senha": valores,
      "system.historicoDestrancar": [],
      "system.destrancarTentativas": 0,
      "system.destrancado": false,
      "system.quebrado": false,
    });
    ui.notifications.info(game.i18n.localize("OP2.Desafio.SenhaManualSalva"));
  }

  async _prepareContext(opcoes) {
    const contexto = await super._prepareContext(opcoes);
    const { pontuacaoAtual, pontuacaoAlvo } = this.item.system;

    const { senha, historicoDestrancar } = this.item.system;

    return {
      ...contexto,
      ehGM: game.user.isGM,
      itensGuardados: (this.item.system.itens ?? []).map((uuid) => fromUuidSync(uuid)).filter(podeSerItemDePista)
        .map((i) => ({ uuid: i.uuid, nome: i.name, img: i.img })),
      percentualProgresso: Math.min(100, Math.round((pontuacaoAtual / pontuacaoAlvo) * 100)),
      // A senha do Destrancar e o histórico de palpites são do mestre: moram aqui, no
      // cadastro do desafio, não na tela de ações do jogador (achado em uso real).
      senha,
      temSenha: senha.length > 0,
      opcoesFaces: [2, 3, 4, 6, 8, 10, 12, 20],
      categorias: Object.keys(CATEGORIAS_DESAFIO).map((chave) => ({
        chave, rotulo: rotuloCategoria(chave), selecionada: chave === this.item.system.categoria,
      })),
      categoriaAjuda: this.item.system.categoria === "acesso" ? "" : game.i18n.localize(`OP2.Desafio.CategoriaAjuda.${this.item.system.categoria}`),
      posicoesSenha: facesDasPosicoes(this.item.system).map((faces, indice) => ({
        indice, numero: indice + 1, faces, valor: senha[indice] ?? "",
      })),
      historicoDestrancar: historicoDestrancar.map((linha, indice) => ({
        numero: indice + 1,
        posicoes: posicoesDoPalpite(linha.palpite, linha.resultado),
        quem: game.actors.get(linha.atorId)?.name ?? "",
      })),
      perguntasHack: this.item.system.hackSocial.perguntas.map((pergunta, indice) => ({ ...pergunta, indice })),
      // Sem nenhuma abordagem marcada a ficha não tem o que configurar — o aviso
      // substitui os blocos em vez de mostrar campos que não valem para nada.
      temAlgumaAbordagem: Object.values(this.item.system.abordagens).some(Boolean),
      // Qualquer perícia serve para a abordagem genérica — é justamente o ponto.
      opcoesPericia: Object.keys(PERICIAS)
        .filter((chave) => !PERICIAS[chave].especializada)
        .map((chave) => ({ chave, rotulo: rotuloDePericia(chave) })),
    };
  }

  /**
   * Stepper do progresso — bookkeeping manual do mestre sem rolar Arrombar
   * (alguém forçou fora do sistema, correção de valor). Mesma trava em
   * [0, pontuacaoAlvo] da action `ajustarPontuacaoDesafio` do painel.
   */
  static async #ajustarPontuacao(_evento, alvo) {
    const { pontuacaoAtual, pontuacaoAlvo } = this.item.system;
    const novo = Math.max(0, Math.min(pontuacaoAlvo, pontuacaoAtual + Number(alvo.dataset.delta)));
    await this.item.update({ "system.pontuacaoAtual": novo });
  }

  /** Stepper das tentativas — trava em 0; `maxTentativas` 0 = sem limite (spec §7.2). */
  static async #ajustarTentativas(_evento, alvo) {
    const { tentativasUsadas, maxTentativas } = this.item.system;
    const teto = maxTentativas > 0 ? maxTentativas : Number.POSITIVE_INFINITY;
    const novo = Math.max(0, Math.min(teto, tentativasUsadas + Number(alvo.dataset.delta)));
    await this.item.update({ "system.tentativasUsadas": novo });
  }

  /** Banco de perguntas do hack social — mestre cadastra pergunta + gabarito. */
  /** Uma faixa a mais na tabela do painel ("10+ → 16 x 5 = 80"). */
  static async #adicionarLinhaHack() {
    const tabela = [...this.item.system.hackTecnico.tabela, { rolagem: "", desafio: "" }];
    await this.item.update({ "system.hackTecnico.tabela": tabela });
  }

  static async #adicionarPerguntaHack() {
    const perguntas = [...this.item.system.hackSocial.perguntas, { pergunta: "", resposta: "" }];
    await this.item.update({ "system.hackSocial.perguntas": perguntas });
  }

  static async #removerPerguntaHack(_evento, alvo) {
    const perguntas = this.item.system.hackSocial.perguntas
      .filter((_pergunta, indice) => indice !== Number(alvo.dataset.indice));
    await this.item.update({ "system.hackSocial.perguntas": perguntas });
  }

  /**
   * Revela o problema e inicia o contador na tela de todo mundo (`timer-hack.mjs`):
   * por faixa da tabela, ou um timer avulso com os segundos do campo, para o mestre
   * ditar a conta em voz alta.
   */
  static async #iniciarHackFaixa(_evento, alvo) {
    const indice = Number(alvo.dataset.indice);
    const segundos = Number(this.element.querySelector("[data-timer-segundos]")?.value) || undefined;
    await iniciarHackTecnico(this.item.uuid, null, indice >= 0 ? indice : -1, { segundos: indice >= 0 ? undefined : segundos });
  }
}

/**
 * Menu flutuante preso ao botão: as opções em lista, fecha ao escolher, ao clicar
 * fora ou com Esc. Devolve o valor escolhido (ou null).
 */
function escolherNoMenu(ancora, opcoes) {
  return new Promise((resolver) => {
    document.querySelector(".op2-menu-flutuante")?.remove();
    const menu = document.createElement("div");
    menu.className = "op2 op2-menu-flutuante";
    menu.setAttribute("role", "menu");
    for (const o of opcoes) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.disabled = Boolean(o.desligado);
      b.innerHTML = `<i class="fa-solid ${o.icone}" aria-hidden="true"></i> `;
      b.append(document.createTextNode(o.rotulo));
      b.addEventListener("click", () => fechar(o.valor));
      menu.append(b);
    }
    document.body.append(menu);
    const r = ancora.getBoundingClientRect();
    const alto = menu.offsetHeight;
    const cabeEmbaixo = r.bottom + alto + 8 < window.innerHeight;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${cabeEmbaixo ? r.bottom + 4 : r.top - alto - 4}px`;
    const fora = (ev) => { if (!menu.contains(ev.target)) fechar(null); };
    const tecla = (ev) => { if (ev.key === "Escape") fechar(null); };
    setTimeout(() => { document.addEventListener("pointerdown", fora, true); document.addEventListener("keydown", tecla, true); });
    menu.querySelector("button:not([disabled])")?.focus();
    function fechar(valor) {
      document.removeEventListener("pointerdown", fora, true);
      document.removeEventListener("keydown", tecla, true);
      menu.remove();
      resolver(valor);
    }
  });
}
