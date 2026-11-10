/**
 * Declaração de fase no início de cada rodada de combate.
 *
 * Ao começar o combate e a cada rodada nova, a iniciativa zera e abre para os
 * jogadores a janela "Defina a sua ação para o próximo turno": cada um escolhe a
 * fase (Geral, Distância ou Corpo a corpo) dos próprios combatentes. Um timer
 * (15 s por padrão) corre para todos; o mestre pode pausar, somar tempo ou encerrar.
 *
 * O estado vive numa flag do Combat (`declaracao`), então todas as telas mostram o
 * mesmo relógio. O tempo usa `game.time.serverTime` para não depender do relógio de
 * cada máquina.
 */
import { SYSTEM_ID } from "../config.mjs";
import { FASES_COMBATE, faseDoValor } from "./tabelas-dados.mjs";
import { INICIATIVA_AGUARDANDO } from "./poderes-regras.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const FLAG = "declaracao";
const agora = () => game.time?.serverTime ?? Date.now();

const estadoDe = (combate) => combate?.getFlag(SYSTEM_ID, FLAG) ?? null;

function restanteMs(estado) {
  if (!estado?.ativo) return 0;
  if (estado.pausadoRestante !== null && estado.pausadoRestante !== undefined) return estado.pausadoRestante;
  return Math.max(0, estado.fim - agora());
}

/* ---------------- controle (mestre) ---------------- */

export async function iniciarDeclaracao(combate) {
  if (!game.user.isGM || !combate) return;
  const segundos = Number(game.settings.get(SYSTEM_ID, "tempoDeclaracao")) || 15;
  await combate.update({
    turn: null,
    [`flags.${SYSTEM_ID}.${FLAG}`]: { ativo: true, fim: agora() + segundos * 1000, pausadoRestante: null, rodada: combate.round },
  });
}

async function pausar(combate) {
  const e = estadoDe(combate);
  if (!e?.ativo) return;
  const novo = e.pausadoRestante !== null && e.pausadoRestante !== undefined
    ? { ...e, fim: agora() + e.pausadoRestante, pausadoRestante: null }
    : { ...e, pausadoRestante: restanteMs(e) };
  await combate.setFlag(SYSTEM_ID, FLAG, novo);
}

async function adicionarTempo(combate, segundos = 15) {
  const e = estadoDe(combate);
  if (!e?.ativo) return;
  const ms = segundos * 1000;
  const pausado = e.pausadoRestante !== null && e.pausadoRestante !== undefined;
  await combate.setFlag(SYSTEM_ID, FLAG, pausado
    ? { ...e, pausadoRestante: e.pausadoRestante + ms }
    : { ...e, fim: Math.max(e.fim, agora()) + ms });
}

export async function encerrarDeclaracao(combate) {
  const e = estadoDe(combate);
  if (!e?.ativo || !game.user.isGM) return;
  await combate.update({ turn: 0, [`flags.${SYSTEM_ID}.${FLAG}`]: { ...e, ativo: false } });
  const faltando = combate.combatants.filter((c) => !c.getFlag(SYSTEM_ID, "antecipacao") && (c.initiative === null || c.initiative === undefined)).map((c) => c.name);
  if (faltando.length) {
    ui.notifications.info(game.i18n.format("OP2.Declaracao.Faltaram", { nomes: faltando.join(", ") }));
  }
}

/* ---------------- janela ---------------- */

class DeclaracaoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-declaracao",
    classes: ["op2", "op2-declaracao"],
    window: { title: "OP2.Declaracao.Titulo", icon: "fa-solid fa-hourglass-half", resizable: false },
    position: { width: 440, height: "auto", top: 90 },
    actions: {
      fase: DeclaracaoApp.#fase,
      aguardar: DeclaracaoApp.#aguardar,
      antecipar: DeclaracaoApp.#antecipar,
      pausar: DeclaracaoApp.#pausar,
      mais: DeclaracaoApp.#mais,
      encerrar: DeclaracaoApp.#encerrar,
    },
  };

  static PARTS = { corpo: { template: `systems/${SYSTEM_ID}/templates/cena/declaracao.hbs` } };

  #intervalo = null;

  get combate() { return game.combat; }

  async _prepareContext() {
    const combate = this.combate;
    const e = estadoDe(combate);
    const { podeAntecipar, antecipadosDe, poderDe } = await import("./poderes.mjs");
    const antecipados = antecipadosDe(combate);
    const meus = (combate?.combatants ?? []).filter((c) => (game.user.isGM || c.isOwner) && !c.getFlag(SYSTEM_ID, "antecipacao"));
    return {
      ehGM: game.user.isGM,
      rodada: combate?.round ?? 0,
      pausado: e?.pausadoRestante !== null && e?.pausadoRestante !== undefined,
      combatentes: meus.map((c) => {
        const fase = faseDoValor(c.initiative);
        const aguardando = c.initiative === INICIATIVA_AGUARDANDO && c.getFlag(SYSTEM_ID, "aguardar") === combate.round;
        return {
          id: c.id, nome: c.name, img: c.img ?? c.token?.texture?.src ?? c.actor?.img, npc: c.isNPC,
          fases: Object.keys(FASES_COMBATE).map((f) => ({ chave: f, rotulo: game.i18n.localize(`OP2.Combate.Fase.${f}`), ativa: f === fase })),
          declarado: Boolean(fase) || aguardando,
          // Prontidão: "Aguardar pra agir" aparece acima das fases, só para quem tem a habilidade.
          aguardar: poderDe(c.actor, "prontidao") ? { ativa: aguardando } : null,
          antecipacao: {
            img: poderDe(c.actor, "antecipacao")?.img ?? "",
            usada: antecipados.includes(c.actorId),
            pode: podeAntecipar({
              rodada: combate.round, temHabilidade: Boolean(poderDe(c.actor, "antecipacao")),
              jaUsou: antecipados.includes(c.actorId), ehNpc: c.isNPC,
            }),
          },
        };
      }),
    };
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    this.#tick();
    clearInterval(this.#intervalo);
    this.#intervalo = setInterval(() => this.#tick(), 250);
  }

  _onClose(opcoes) {
    clearInterval(this.#intervalo);
    super._onClose(opcoes);
  }

  #tick() {
    const e = estadoDe(this.combate);
    const ms = restanteMs(e);
    const total = Math.ceil(ms / 1000);
    const el = this.element?.querySelector("[data-relogio]");
    if (el) {
      el.textContent = `${total}s`;
      el.classList.toggle("urgente", total <= 5);
    }
    const barra = this.element?.querySelector("[data-barra]");
    if (barra) {
      const base = Math.max(Number(game.settings.get(SYSTEM_ID, "tempoDeclaracao")) || 15, total);
      barra.style.width = `${Math.min(100, (ms / (base * 1000)) * 100)}%`;
    }
    // Acabou o tempo: o mestre designado encerra.
    if (e?.ativo && ms <= 0 && game.users.activeGM?.id === game.user.id) void encerrarDeclaracao(this.combate);
  }

  static async #fase(_evento, alvo) {
    const c = this.combate?.combatants.get(alvo.dataset.id);
    if (!c?.isOwner) return;
    await c.update({ initiative: FASES_COMBATE[alvo.dataset.fase], [`flags.${SYSTEM_ID}.aguardar`]: null });
  }

  /** Prontidão: vai para o fim da fila e espera a hora de agir (janela "Agir agora"). */
  static async #aguardar(_evento, alvo) {
    const c = this.combate?.combatants.get(alvo.dataset.id);
    if (!c?.isOwner) return;
    const { poderDe } = await import("./poderes.mjs");
    if (!poderDe(c.actor, "prontidao")) return;
    await c.update({
      initiative: INICIATIVA_AGUARDANDO,
      [`flags.${SYSTEM_ID}.aguardar`]: this.combate.round,
      [`flags.${SYSTEM_ID}.ordem`]: 0,
    });
  }

  /** Antecipação Tática na janela: 2 PD, rodada extra antes de todos. */
  static async #antecipar(_evento, alvo) {
    const c = this.combate?.combatants.get(alvo.dataset.id);
    if (!c?.isOwner || !c.actor) return;
    alvo.disabled = true;
    const { anteciparNoCombate } = await import("./poderes.mjs");
    await anteciparNoCombate(c.actor, this.combate);
    this.render();
  }

  static async #pausar() { await pausar(this.combate); }
  static async #mais() { await adicionarTempo(this.combate, 15); }
  static async #encerrar() { await encerrarDeclaracao(this.combate); }
}

let janela = null;

function sincronizar(combate) {
  if (combate && combate !== game.combat) return;
  const e = estadoDe(game.combat);
  const temCombatente = game.user.isGM || game.combat?.combatants.some((c) => c.isOwner && !c.isNPC);
  if (e?.ativo && temCombatente) {
    janela ??= new DeclaracaoApp();
    janela.render({ force: !janela.rendered });
  } else if (janela?.rendered) {
    void janela.close();
  }
}

export function registrarDeclaracao() {
  game.settings.register(SYSTEM_ID, "tempoDeclaracao", {
    name: "OP2.Declaracao.Config", hint: "OP2.Declaracao.ConfigDica",
    scope: "world", config: true, type: Number, default: 15, range: { min: 5, max: 120, step: 5 },
  });
  Hooks.on("updateCombat", (combate) => sincronizar(combate));
  Hooks.on("updateCombatant", (c) => { if (janela?.rendered && c.parent === game.combat) janela.render(); });
  Hooks.on("deleteCombat", () => { if (janela?.rendered) void janela.close(); });
  Hooks.once("ready", () => sincronizar(game.combat));
}
