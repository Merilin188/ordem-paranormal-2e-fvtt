/**
 * Resumo das regras de investigação (playtest Beta), numa janela ao lado das Ações de
 * investigação: os três passos do Investigar, cada um com a sua cor, e as outras
 * ações. O texto é resumo do sistema, não o do livro (que não entra no pacote).
 * Abre junto com as Ações (o jogador pode desligar) e pelo botão "Regras" de lá.
 */
import { SYSTEM_ID, DT_RECAPITULAR, DT_COMPARTILHAR, CUSTO_PD_EXAMINAR } from "../config.mjs";
import { lerConfig } from "../settings/register.mjs";
import { rotuloDePericia } from "../dice/teste.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const CHAVE_ABRIR = "op2.regrasInvestigacao.abrir";
const LARGURA = 360;

export function abrirJuntoLigado() {
  try { return window.localStorage.getItem(CHAVE_ABRIR) !== "0"; } catch { return true; }
}
function gravarAbrirJunto(ligado) {
  try { window.localStorage.setItem(CHAVE_ABRIR, ligado ? "1" : "0"); } catch { /* sem storage: vale só nesta tela */ }
}

class RegrasInvestigacaoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-regras-investigacao",
    classes: ["op2", "op2-regras-inv"],
    window: { title: "OP2.RegrasInvestigacao.Titulo", icon: "fa-solid fa-book-open", resizable: true },
    position: { width: LARGURA, height: "auto" },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/cena/regras-investigacao.hbs` } };

  /** Aberta sozinha com as Ações: fecha junto com elas. */
  automatica = false;

  async _prepareContext() {
    return {
      dtRecapitular: DT_RECAPITULAR,
      dtCompartilhar: DT_COMPARTILHAR,
      custo: CUSTO_PD_EXAMINAR,
      periciaCompartilhar: rotuloDePericia(lerConfig("compartilharPericia") ?? "pesquisar"),
      abrirJunto: abrirJuntoLigado(),
    };
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    this.element.querySelector("[data-abrir-junto]")?.addEventListener("change", (e) => gravarAbrirJunto(e.target.checked));
  }
}

let janela = null;

/** Abre (ou traz para a frente) ao lado da janela de Ações: à esquerda, se couber. */
export function abrirRegras(junto = null, { automatica = false } = {}) {
  janela ??= new RegrasInvestigacaoApp();
  if (janela.rendered) return void janela.bringToFront?.();
  janela.automatica = automatica;
  const p = junto?.position;
  const posicao = {};
  if (p && Number.isFinite(p.left)) {
    posicao.top = p.top;
    posicao.left = p.left - LARGURA - 8 >= 8
      ? p.left - LARGURA - 8
      : Math.min(p.left + (p.width ?? 640) + 8, window.innerWidth - LARGURA - 8);
  }
  void janela.render({ force: true, position: posicao });
}

/** Chamado quando as Ações abrem: abre o resumo se o jogador não desligou. */
export function abrirComAsAcoes(acoes) {
  if (abrirJuntoLigado()) abrirRegras(acoes, { automatica: true });
}

/** As Ações fecharam: o resumo que abriu sozinho com elas fecha também. */
export function fecharComAsAcoes() {
  if (janela?.rendered && janela.automatica) void janela.close();
}
