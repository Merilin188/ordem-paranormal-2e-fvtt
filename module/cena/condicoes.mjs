/**
 * Condições do sistema (no lugar das do core), iniciativa por fases de combate e os
 * gatilhos automáticos de PV/PD a zero e de Moribundo no fim da rodada.
 */
import { SYSTEM_ID } from "../config.mjs";
import { FASES_COMBATE, faseDoValor } from "./tabelas-dados.mjs";
import { pedirTesteDeQueda } from "./ferimentos.mjs";
import { iniciarDeclaracao } from "./declaracao.mjs";
import { INICIATIVA_AGUARDANDO, ordenarCombatentes } from "./poderes-regras.mjs";

const C = (id, img) => ({ id, img, name: `OP2.Condicao.${id}`, _id: `op2${id}`.padEnd(16, "0").slice(0, 16) });

export const CONDICOES = [
  C("caido", "icons/svg/falling.svg"),
  C("inconsciente", "icons/svg/unconscious.svg"),
  C("moribundo", "icons/svg/blood.svg"),
  C("morto", "icons/svg/skull.svg"),
  C("agarrado", "icons/svg/net.svg"),
  C("sobrecarregado", "icons/svg/anchor.svg"),
  C("atordoado", "icons/svg/daze.svg"),
  C("apavorado", "icons/svg/terror.svg"),
  C("cego", "icons/svg/blind.svg"),
  C("sangrando", "icons/svg/degen.svg"),
  C("defendendo", "icons/svg/shield.svg"),
  // Passiva da Runa de Brenna (e de qualquer item de proteção que o mestre criar).
  C("runa", "systems/ordem-paranormal-2e/assets/icons/runa-brenna.svg"),
];

/* ---------------- Iniciativa por fases ---------------- */

const ROTULO_FASE = (fase) => game.i18n.localize(`OP2.Combate.Fase.${fase}`);

/** Pergunta a fase de cada combatente e grava como iniciativa (Geral 3, Distância 2, Corpo 1). */
async function escolherFases(combate, ids) {
  const combatentes = ids.map((id) => combate.combatants.get(id)).filter((c) => c?.isOwner);
  if (!combatentes.length) return;
  const opcoes = Object.keys(FASES_COMBATE)
    .map((f) => `<option value="${f}">${ROTULO_FASE(f)}</option>`).join("");
  const linhas = combatentes.map((c) => `<div class="form-group"><label>${foundry.utils.escapeHTML(c.name)}</label>
    <select name="${c.id}">${opcoes}</select></div>`).join("");
  const resposta = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("OP2.Combate.EscolherFase"), icon: "fa-solid fa-swords" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: `<p class="op2-ajuda">${game.i18n.localize("OP2.Combate.FaseAjuda")}</p>${linhas}`,
    ok: {
      label: game.i18n.localize("OP2.Combate.Declarar"),
      callback: (_e, botao) => Object.fromEntries(combatentes.map((c) => [c.id, botao.form.elements[c.id].value])),
    },
    rejectClose: false,
  });
  if (!resposta) return;
  const atualizacoes = Object.entries(resposta).map(([_id, fase]) => ({ _id, initiative: FASES_COMBATE[fase] }));
  await combate.updateEmbeddedDocuments("Combatant", atualizacoes);
  const resumo = Object.entries(resposta)
    .map(([id, fase]) => `<li><strong>${foundry.utils.escapeHTML(combate.combatants.get(id)?.name ?? "")}</strong>: ${ROTULO_FASE(fase)}</li>`).join("");
  await ChatMessage.create({
    content: `<div class="op2 op2-card"><header class="op2-card__topo"><span class="op2-tag op2-tag--pequena">${game.i18n.localize("OP2.Combate.FasesDeclaradas")}</span></header><ul>${resumo}</ul></div>`,
  });
}

export function criarClasseDeCombate(Base) {
  return class OP2Combat extends Base {
    /** Fase decrescente; no empate, a ordem do encaixe da Prontidão (Aguardar pra agir). */
    _sortCombatants(a, b) {
      return ordenarCombatentes(a, b);
    }

    async rollInitiative(ids, _opcoes = {}) {
      const lista = typeof ids === "string" ? [ids] : ids;
      await escolherFases(this, lista);
      return this;
    }

    /** Início do combate: zera a iniciativa e abre a declaração de fases. */
    async startCombat() {
      const r = await super.startCombat();
      await this.#novaDeclaracao();
      return r;
    }

    /** Nova rodada: ninguém fica como turno atual; todo mundo declara a fase de novo. */
    async nextRound() {
      const r = await super.nextRound();
      await this.#novaDeclaracao();
      return r;
    }

    async #novaDeclaracao() {
      if (!game.user.isGM) return;
      // A rodada extra da Antecipação Tática é só a primeira: a cópia sai na rodada 2.
      const extras = this.combatants.filter((c) => c.getFlag(SYSTEM_ID, "antecipacao"));
      if (this.round > 1 && extras.length) await this.deleteEmbeddedDocuments("Combatant", extras.map((c) => c.id));
      const restantes = this.combatants.filter((c) => !c.getFlag(SYSTEM_ID, "antecipacao"));
      await this.updateEmbeddedDocuments("Combatant", restantes.map((c) => ({
        _id: c.id, initiative: null, [`flags.${SYSTEM_ID}.aguardar`]: null, [`flags.${SYSTEM_ID}.ordem`]: 0,
      })));
      await tirarDefendendo(this);
      await iniciarDeclaracao(this);
    }
  };
}

/** Defender-se vale para a rodada: na rodada nova (e no fim do combate) o status sai. */
async function tirarDefendendo(combate) {
  for (const c of combate.combatants) {
    if (c.actor?.statuses?.has("defendendo")) await c.actor.toggleStatusEffect("defendendo", { active: false });
  }
}

/** No tracker, o número da iniciativa vira o nome da fase. */
function rotularFases(app, html) {
  const raiz = html instanceof HTMLElement ? html : html?.[0];
  if (!raiz) return;
  for (const li of raiz.querySelectorAll("[data-combatant-id]")) {
    const combate = app.viewed ?? game.combat;
    const c = combate?.combatants.get(li.dataset.combatantId);
    const fase = c?.initiative === 4 ? "antecipacao" : c?.initiative === INICIATIVA_AGUARDANDO ? "aguardar" : faseDoValor(c?.initiative);
    const alvo = li.querySelector(".initiative, .token-initiative span");
    if (fase && alvo) {
      alvo.textContent = ROTULO_FASE(fase);
      alvo.classList.add("op2-fase", `op2-fase--${fase}`);
    }
  }
}

/* ---------------- Gatilhos ---------------- */

async function processarFimDeRodada() {
  if (game.users.activeGM?.id !== game.user.id) return;
  for (const ator of game.actors.filter((a) => a.type === "personagem" && a.statuses?.has("moribundo"))) {
    if (ator.statuses.has("morto")) continue;
    // Não testa na rodada em que ficou moribundo.
    if (ator.system.estado.moribundoDesde === 1) {
      await ator.update({ "system.estado.moribundoDesde": 0 });
      continue;
    }
    await pedirTesteDeQueda(ator, "morte");
  }
}

export function registrarCondicoes() {
  CONFIG.statusEffects = CONDICOES.map((c) => ({ ...c }));
  CONFIG.specialStatusEffects.DEFEATED = "morto";
  if (CONFIG.specialStatusEffects.BLIND !== undefined) CONFIG.specialStatusEffects.BLIND = "cego";
  CONFIG.Combat.documentClass = criarClasseDeCombate(CONFIG.Combat.documentClass);
  CONFIG.Combat.initiative = { formula: "0", decimals: 0 };

  Hooks.on("renderCombatTracker", rotularFases);
  Hooks.on("deleteCombat", (combate) => { if (game.users.activeGM?.id === game.user.id) void tirarDefendendo(combate); });

  // PV ou PD chegando a 0 (por dano ou edição manual): pede o teste de lesão/trauma.
  Hooks.on("preUpdateActor", (ator, mudancas, opcoes) => {
    if (ator.type !== "personagem") return;
    opcoes.op2Antes = { pv: ator.system.recursos.pv.value, pd: ator.system.recursos.pd.value };
  });
  Hooks.on("updateActor", (ator, mudancas, opcoes, userId) => {
    if (ator.type !== "personagem" || userId !== game.user.id || !opcoes.op2Antes || opcoes.op2SemQueda) return;
    for (const recurso of ["pv", "pd"]) {
      const novo = foundry.utils.getProperty(mudancas, `system.recursos.${recurso}.value`);
      if (novo === 0 && opcoes.op2Antes[recurso] > 0) {
        void pedirTesteDeQueda(ator, recurso === "pd" ? "trauma" : "ferimento");
      }
    }
  });

  // Fim de rodada (combate ou investigação): Moribundo testa morte.
  Hooks.on("updateCombat", (_combate, mudancas) => {
    if ("round" in mudancas) void processarFimDeRodada();
  });
  Hooks.on("updateActor", (ator, mudancas) => {
    if (ator.type === "investigacao" && foundry.utils.hasProperty(mudancas, "system.rodada")) void processarFimDeRodada();
  });
}

