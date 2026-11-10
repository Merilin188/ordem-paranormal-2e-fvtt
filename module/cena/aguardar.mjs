/**
 * Prontidão — "Aguardar pra agir" no combate.
 *
 * Na declaração de fase, quem tem Prontidão ganha a opção "Aguardar pra agir" acima
 * das fases. Quem aguarda vai para o fim da fila (iniciativa 0, abaixo do Corpo a
 * corpo) e ganha uma janela flutuante verde (a cor do Vigilante) com a descrição da
 * habilidade e o botão "Agir agora". A cada combatente novo que vai agir, a janela
 * pisca e pergunta: Sim encaixa quem aguardava logo antes desse combatente; Não deixa
 * o turno seguir e a pergunta volta no próximo. Se ninguém disser sim, quem aguardava
 * age no fim da rodada.
 *
 * Quem decide a fila é o mestre (`op2AgirAgora`): só ele escreve no Combat.
 */
import { SYSTEM_ID } from "../config.mjs";
import { INICIATIVA_AGUARDANDO, encaixarAntes } from "./poderes-regras.mjs";
import { comoMestre, registrarAcaoDeMestre } from "../ui/socket.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = (chave, dados) => (dados ? game.i18n.format(`OP2.Aguardar.${chave}`, dados) : game.i18n.localize(`OP2.Aguardar.${chave}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const poderDe = (ator) => ator?.items?.find((i) => i.type === "habilidade" && i.system.automacao === "prontidao") ?? null;

/** O combatente declarou "Aguardar pra agir" nesta rodada e ainda não agiu. */
export function estaAguardando(c) {
  const combate = c?.parent;
  return Boolean(combate) && combate.round > 0 && c.initiative === INICIATIVA_AGUARDANDO
    && c.getFlag(SYSTEM_ID, "aguardar") === combate.round;
}

/** Quem tem a janela: o jogador dono; o mestre só quando nenhum dono está online. */
function souResponsavel(c) {
  if (!c.isOwner) return false;
  if (!game.user.isGM) return true;
  return !game.users.some((u) => u.active && !u.isGM && c.actor?.testUserPermission(u, "OWNER"));
}

/** Os combatentes deste usuário que estão aguardando (menos o que já está agindo). */
function meusAguardando(combate) {
  if (!combate?.started) return [];
  return combate.combatants.filter((c) => estaAguardando(c) && souResponsavel(c) && c.id !== combate.combatant?.id);
}

/** A declaração da rodada já fechou e a fila está andando. */
const filaAndando = (combate) => Boolean(combate?.started) && combate.turn !== null && combate.turn !== undefined
  && !combate.getFlag(SYSTEM_ID, "declaracao")?.ativo;

/* ---------------- janela ---------------- */

class AguardarApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-aguardar",
    classes: ["op2", "op2-aguardar"],
    window: { title: "OP2.Aguardar.Titulo", icon: "fa-solid fa-hourglass-half", resizable: false, minimizable: false },
    position: { width: 380, height: "auto", top: 90, left: 110 },
    actions: { agir: AguardarApp.#agir, nao: AguardarApp.#nao },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/cena/aguardar.hbs` } };

  /** Pisca e pergunta "Agir agora?" até o jogador responder ou a vez mudar. */
  perguntando = false;

  get title() {
    const c = meusAguardando(game.combat)[0];
    return poderDe(c?.actor)?.name ?? game.i18n.localize("OP2.Aguardar.Titulo");
  }

  async _prepareContext() {
    const combate = game.combat;
    const andando = filaAndando(combate);
    const atual = andando ? combate.combatant : null;
    const lista = await Promise.all(meusAguardando(combate).map(async (c) => {
      const poder = poderDe(c.actor);
      return {
        id: c.id, nome: c.name, img: c.img ?? c.actor?.img,
        poder: poder?.name ?? L("Titulo"), poderImg: poder?.img ?? "",
        descricao: poder ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(poder.system.descricao ?? "", { relativeTo: poder }) : "",
      };
    }));
    return {
      lista, andando,
      perguntando: this.perguntando && andando && Boolean(atual),
      atual: atual ? L("AntesDe", { nome: atual.name }) : L("Esperando"),
    };
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    // A cor da ficha dos vigilantes: os tokens do perfil trocam o vermelho pelo verde.
    this.element.dataset.perfil = "vigilante";
    this.element.classList.toggle("op2-aguardar--perguntando", contexto.perguntando);
  }

  static async #agir(_evento, alvo) {
    const combate = game.combat;
    if (!filaAndando(combate)) return void ui.notifications.warn(L("AindaDeclarando"));
    this.perguntando = false;
    alvo.disabled = true;
    await comoMestre("op2AgirAgora", { combateId: combate.id, esperaId: alvo.dataset.id });
  }

  static #nao() {
    this.perguntando = false;
    this.render();
  }
}

let janela = null;
let ultimaVez = null;

/** Abre, fecha ou faz piscar a janela conforme o combate. Roda em todo cliente. */
function verificar() {
  const combate = game.combat;
  // Mestre: a vez chegou sozinha em quem aguardava (fim da fila) — a espera acabou.
  const atual = combate?.combatant;
  if (game.users.activeGM?.id === game.user.id && atual && filaAndando(combate) && estaAguardando(atual)) {
    void atual.setFlag(SYSTEM_ID, "aguardar", null);
  }

  const meus = meusAguardando(combate);
  if (!meus.length) {
    ultimaVez = null;
    if (janela?.rendered) void janela.close();
    return;
  }
  janela ??= new AguardarApp();
  // Um combatente novo vai agir: pergunta de novo.
  const vez = filaAndando(combate) && atual ? `${combate.id}.${combate.round}.${atual.id}` : null;
  if (vez && vez !== ultimaVez) janela.perguntando = true;
  if (!vez) janela.perguntando = false;
  ultimaVez = vez;
  void janela.render({ force: true }).then(() => { if (janela.perguntando) janela.bringToFront?.(); });
}

let verificarLogo = verificar;

/* ---------------- mestre ---------------- */

/** Encaixa quem aguardava logo antes de quem está agindo e passa a vez para ele. */
async function agirAgora({ combateId, esperaId }) {
  const combate = game.combats.get(combateId);
  const espera = combate?.combatants.get(esperaId);
  if (!filaAndando(combate) || !espera || !estaAguardando(espera)) return;
  const atual = combate.combatant;
  const turnos = combate.turns.map((t) => ({ id: t.id, initiative: t.initiative, ordem: t.getFlag(SYSTEM_ID, "ordem") ?? 0 }));
  const encaixe = encaixarAntes(turnos, esperaId, atual?.id);
  if (!encaixe) return;
  await combate.updateEmbeddedDocuments("Combatant", encaixe.atualizacoes.map((u) => ({
    _id: u._id,
    [`flags.${SYSTEM_ID}.ordem`]: u.ordem,
    ...(u.initiative === undefined ? {} : { initiative: u.initiative, [`flags.${SYSTEM_ID}.aguardar`]: null }),
  })));
  // A fila mudou embaixo do índice: o turno atual já aponta para quem aguardava.
  if (combate.turn !== encaixe.indice) await combate.update({ turn: encaixe.indice });
  const poder = poderDe(espera.actor);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: espera.actor }),
    content: `<div class="op2 op2-card op2-poder-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena">${esc(poder?.name ?? L("Titulo"))}</span></header>
      <p class="op2-card__texto"><i class="fa-solid fa-forward-step"></i> ${L("AgiuAntes", { nome: esc(espera.name), alvo: esc(atual?.name ?? "") })}</p></div>`,
    flags: { [SYSTEM_ID]: { tipo: "poder", atorId: espera.actorId } },
  });
}

export function registrarAguardar() {
  verificarLogo = foundry.utils.debounce(verificar, 60);
  registrarAcaoDeMestre("op2AgirAgora", agirAgora);
  for (const gancho of ["updateCombat", "updateCombatant", "createCombatant", "deleteCombatant", "deleteCombat", "combatStart"]) {
    Hooks.on(gancho, () => verificarLogo());
  }
  Hooks.once("ready", () => verificarLogo());
}
