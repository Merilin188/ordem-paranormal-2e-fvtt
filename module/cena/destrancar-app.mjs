/**
 * Destrancar — Mastermind numérico (spec §7.1).
 *
 * O jogador monta um palpite (um valor por posição, sem rolar) e recebe a resposta
 * posição a posição: exato, alto ou baixo. Nunca a contagem agregada.
 *
 * Duas visões na mesma janela:
 * - **Jogador** (participante): escolhe os números, tenta, vê a resposta de cada
 *   posição e o teto de tentativas por rodada (dado de Crime).
 * - **Mestre** (monitoramento): vê o gabarito, o histórico, avança a rodada do
 *   desafio e cancela. Pode alternar para a visão do jogador para testar sozinho.
 *
 * O mestre INICIA o desafio pelas ferramentas do mestre (`iniciarDestrancar`): grava
 * a sessão no Item (`flags.<sistema>.sessao`: participante + rodada), abre a janela
 * de quem controla o participante e manda um card ao chat para reabrir.
 */
import { SYSTEM_ID } from "../config.mjs";
import {
  gerarSenhaDestrancar, tentarDestrancar, carregarDesafio, posicoesDoPalpite, rodadaDoDesafio,
} from "./acoes-desafio.mjs";
import { tentativasPorRodadaDeDestrancar, tentativasDeDestrancarNaRodada, facesDasPosicoes } from "./desafios.mjs";
import { vestirPerfil } from "../ui/perfil.mjs";
import { paraTodos, registrarAcaoDeTodos } from "../ui/socket.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = (chave) => game.i18n.localize(`OP2.Ferramentas.Destrancar.${chave}`);

export class DestrancarApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["op2", "op2-destrancar"],
    window: { title: "OP2.Desafio.Destrancar", icon: "fa-solid fa-key", resizable: true },
    position: { width: 400, height: "auto" },
    actions: {
      incrementar: DestrancarApp.#incrementar,
      decrementar: DestrancarApp.#decrementar,
      tentar: DestrancarApp.#tentar,
      avancarRodada: DestrancarApp.#avancarRodada,
      cancelar: DestrancarApp.#cancelar,
      alternarVisao: DestrancarApp.#alternarVisao,
      novaSenha: DestrancarApp.#novaSenha,
    },
  };

  static PARTS = {
    corpo: { template: "systems/ordem-paranormal-2e/templates/cena/destrancar.hbs" },
  };

  /** @param {string} desafioUuid */
  constructor(desafioUuid, opcoes = {}) {
    super({ id: `op2-destrancar-${desafioUuid.replace(/\W/g, "-")}`, ...opcoes });
    this.desafioUuid = desafioUuid;
    this.palpite = null;
    this.verComoJogador = false;
  }

  /** Geração em andamento — não pedir duas vezes enquanto o socket não volta. */
  #gerando = false;

  get title() {
    const modo = game.user.isGM && !this.verComoJogador ? L("TituloMestre") : L("TituloJogador");
    return `${modo}${this.nomeDesafio ? `: ${this.nomeDesafio}` : ""}`;
  }

  /** Quem tenta: o participante da sessão, senão o personagem do usuário. */
  atorDaVez(sessao) {
    const daSessao = sessao?.ativa ? game.actors.get(sessao.atorId) : null;
    return daSessao ?? game.user.character ?? null;
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    vestirPerfil(this.element, contexto.atorDoc ?? game.user.character);
  }

  async _prepareContext() {
    const desafio = await carregarDesafio(this.desafioUuid);
    if (!desafio) return { existe: false };
    this.nomeDesafio = desafio.name;

    const sistema = desafio.system;
    const sessao = desafio.getFlag(SYSTEM_ID, "sessao") ?? null;
    const temSenha = sistema.senha.length > 0;
    const encerrado = sistema.quebrado || sistema.destrancado;
    if (!this.palpite || this.palpite.length !== sistema.tamanhoSenha) {
      this.palpite = Array(sistema.tamanhoSenha).fill(null);
    }

    if (!temSenha && !encerrado && !this.#gerando) {
      this.#gerando = true;
      gerarSenhaDestrancar(this.desafioUuid).finally(() => { this.#gerando = false; });
    }

    const ator = this.atorDaVez(sessao);
    const rodada = rodadaDoDesafio(desafio);
    const dadoCrime = ator?.system?.pericias?.crime?.dadoEfetivo ?? "d4";
    const tetoRodada = tentativasPorRodadaDeDestrancar(dadoCrime);
    const naRodada = tentativasDeDestrancarNaRodada(sistema.historicoDestrancar, ator?.id, rodada);
    const esgotouRodada = naRodada >= tetoRodada;
    const historico = sistema.historicoDestrancar;
    const meus = historico.filter((h) => h.atorId === ator?.id);
    const ultimo = meus.at(-1) ?? historico.at(-1) ?? null;
    const rodadasUsadas = new Set(historico.map((h) => h.rodada)).size;

    const modoMestre = game.user.isGM && !this.verComoJogador;
    const podeAgir = Boolean(ator?.isOwner);
    const completo = this.palpite.every((v) => v !== null);

    const facesPos = facesDasPosicoes(sistema);
    // Ao destrancar, a janela do jogador mostra a senha certa nas caixas.
    const caixas = (destrancadoAgora) => this.palpite.map((valor, indice) => {
      const mostrar = destrancadoAgora ? sistema.senha[indice] : valor;
      const resposta = destrancadoAgora ? "exato"
        : (ultimo && ultimo.palpite[indice] === valor ? ultimo.resultado[indice] : null);
      return {
        indice,
        faces: facesPos[indice],
        valor: mostrar ?? "—",
        vazio: mostrar === null || mostrar === undefined,
        resposta,
        rotulo: resposta ? game.i18n.localize(`OP2.Ferramentas.Destrancar.Resposta.${resposta}`) : "",
      };
    });

    return {
      existe: true,
      modoMestre,
      ehGM: game.user.isGM,
      verComoJogador: this.verComoJogador,
      ator: ator ? { nome: ator.name, img: ator.img } : null,
      atorDoc: ator,
      podeAgir,
      gerando: !temSenha && !encerrado,
      temSenha,
      senha: sistema.senha,
      sessaoAtiva: Boolean(sessao?.ativa),
      rodada, proximaRodada: rodada + 1,
      naRodada, tetoRodada, dadoCrime, esgotouRodada,
      tentativas: sistema.destrancarTentativas,
      maxTentativas: sistema.maxTentativas || "∞",
      quebrado: sistema.quebrado,
      destrancado: sistema.destrancado,
      encerrado,
      facesSenha: sistema.facesSenha,
      facesPos,
      ocultarTentativas: sistema.ocultarTentativas && !modoMestre,
      caixas: caixas(sistema.destrancado),
      travado: encerrado || esgotouRodada || !podeAgir,
      podeTentar: podeAgir && temSenha && !encerrado && !esgotouRodada && completo,
      rodadasUsadas,
      historico: historico.map((linha, indice) => ({
        numero: indice + 1,
        rodada: linha.rodada,
        quem: game.actors.get(linha.atorId)?.name ?? "",
        posicoes: posicoesDoPalpite(linha.palpite, linha.resultado),
      })).reverse(),
    };
  }

  static #incrementar(_evento, alvo) {
    const i = Number(alvo.dataset.indice);
    const faces = Number(alvo.dataset.faces);
    const atual = this.palpite[i];
    this.palpite[i] = atual === null ? 1 : Math.min(faces, atual + 1);
    this.render();
  }

  static #decrementar(_evento, alvo) {
    const i = Number(alvo.dataset.indice);
    const faces = Number(alvo.dataset.faces);
    const atual = this.palpite[i];
    this.palpite[i] = atual === null ? faces : Math.max(1, atual - 1);
    this.render();
  }

  static async #tentar() {
    const desafio = await carregarDesafio(this.desafioUuid);
    const ator = this.atorDaVez(desafio?.getFlag(SYSTEM_ID, "sessao"));
    if (!ator) return void ui.notifications.warn(game.i18n.localize("OP2.Painel.SemPersonagem"));
    if (!ator.isOwner) return void ui.notifications.warn(game.i18n.localize("OP2.Ferramentas.SemPermissao"));
    if (this.palpite.some((v) => v === null)) return;
    await tentarDestrancar(ator, this.desafioUuid, [...this.palpite]);
    this.render();
  }

  static async #avancarRodada() {
    await avancarRodadaDestrancar(this.desafioUuid);
  }

  static async #cancelar() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("Cancelar") }, content: `<p>${L("CancelarConfirma")}</p>`,
    });
    if (ok) await cancelarDestrancar(this.desafioUuid);
  }

  static #alternarVisao() {
    this.verComoJogador = !this.verComoJogador;
    this.render();
  }

  static async #novaSenha() {
    await gerarSenhaDestrancar(this.desafioUuid);
    this.palpite = null;
    this.render();
  }
}

/* -- registro: reabre a mesma instância por desafio, e atualiza sozinha -- */

const instancias = new Map();

export function abrirDestrancar(desafioUuid) {
  let app = instancias.get(desafioUuid);
  if (!app) {
    app = new DestrancarApp(desafioUuid);
    instancias.set(desafioUuid, app);
  }
  app.render({ force: true });
  return app;
}

function fecharDestrancar(desafioUuid) {
  const app = instancias.get(desafioUuid);
  if (app?.rendered) void app.close();
}

/* -- sessão iniciada pelo mestre -- */

/**
 * Mestre inicia o Destrancar para um participante: fechadura nova se a anterior
 * acabou (ou já tinha tentativas fora de sessão), rodada 1, janela do jogador
 * aberta e card no chat.
 */
export async function iniciarDestrancar(desafioUuid, atorId) {
  if (!game.user.isGM) return;
  const desafio = await carregarDesafio(desafioUuid);
  const ator = game.actors.get(atorId);
  if (!desafio || !ator) return void ui.notifications.warn(game.i18n.localize("OP2.Ferramentas.EscolhaPersonagem"));

  const sessao = desafio.getFlag(SYSTEM_ID, "sessao");
  const s = desafio.system;
  const emCurso = sessao?.ativa && sessao.atorId === atorId && !s.quebrado && !s.destrancado;
  if (!emCurso) {
    if (s.quebrado || s.destrancado || !s.senha.length || s.historicoDestrancar.length) {
      await gerarSenhaDestrancar(desafioUuid);
    }
    await desafio.setFlag(SYSTEM_ID, "sessao", { ativa: true, atorId, rodada: 1 });

    const dono = game.users.find((u) => !u.isGM && u.active && ator.testUserPermission(u, "OWNER"));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize("OP2.Ferramentas.Mestre") }),
      content: `<div class="op2-card op2-ferr-card">
        <header><i class="fa-solid fa-key"></i> ${L("CardTitulo")}</header>
        <p class="op2-ferr-sub"><strong>${foundry.utils.escapeHTML(desafio.name)}</strong></p>
        <p>${game.i18n.format("OP2.Ferramentas.Destrancar.CardTexto", { nome: foundry.utils.escapeHTML(ator.name) })}</p>
        <button type="button" data-op2-acao="ferr-abrir-destrancar" data-ator-id="${ator.id}" data-desafio-uuid="${desafioUuid}">
          <i class="fa-solid fa-lock"></i> ${L("Abrir")}</button>
      </div>`,
      flags: { [SYSTEM_ID]: { tipo: "destrancar-sessao" } },
    });
    if (!dono) ui.notifications.info(L("SemJogadorOnline"));
  }

  paraTodos("ferrAbrirDestrancar", { uuid: desafioUuid, atorId });
  abrirDestrancar(desafioUuid);
}

/** Rodada do desafio +1: libera de novo as tentativas por rodada. */
export async function avancarRodadaDestrancar(desafioUuid) {
  if (!game.user.isGM) return;
  const desafio = await fromUuid(desafioUuid);
  const sessao = desafio?.getFlag(SYSTEM_ID, "sessao");
  if (!sessao?.ativa) return;
  await desafio.setFlag(SYSTEM_ID, "sessao", { ...sessao, rodada: (sessao.rodada ?? 1) + 1 });
}

export async function cancelarDestrancar(desafioUuid) {
  if (!game.user.isGM) return;
  const desafio = await fromUuid(desafioUuid);
  const sessao = desafio?.getFlag(SYSTEM_ID, "sessao");
  if (sessao) await desafio.setFlag(SYSTEM_ID, "sessao", { ...sessao, ativa: false });
  paraTodos("ferrFecharDestrancar", { uuid: desafioUuid });
  fecharDestrancar(desafioUuid);
}

/** Abre a janela no cliente de quem controla o participante (não no do mestre). */
function abrirParaParticipante({ uuid, atorId }) {
  if (game.user.isGM) return;
  const ator = game.actors.get(atorId);
  if (ator?.isOwner) abrirDestrancar(uuid);
}

registrarAcaoDeTodos("ferrAbrirDestrancar", abrirParaParticipante);
registrarAcaoDeTodos("ferrFecharDestrancar", ({ uuid }) => fecharDestrancar(uuid));

Hooks.on("updateItem", (item) => {
  const app = instancias.get(item.uuid);
  if (app?.rendered) app.render();
});

// A rodada da investigação avançou: as sessões de Destrancar avançam junto (só o
// mestre designado grava, para não contar duas vezes).
Hooks.on("updateActor", (ator, mudancas) => {
  if (ator.type !== "investigacao" || !foundry.utils.hasProperty(mudancas, "system.rodada")) return;
  // Sem sessão do mestre, a rodada do Destrancar É a da investigação: a janela aberta
  // redesenha agora, e a tentativa da rodada nova libera sem fechar e reabrir (achado
  // em uso real). Com sessão, o flag gravado abaixo redesenha de novo — inofensivo.
  for (const app of instancias.values()) if (app.rendered) app.render();
  if (game.users.activeGM?.id !== game.user.id) return;
  for (const item of game.items) {
    if (item.type === "desafio-acesso" && item.getFlag(SYSTEM_ID, "sessao")?.ativa) {
      void avancarRodadaDestrancar(item.uuid);
    }
  }
});
