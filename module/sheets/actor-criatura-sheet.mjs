/** Ficha de Criatura: a do NPC + ataques, habilidades, redução de dano e estratégia. */
import { NpcSheet } from "./actor-npc-sheet.mjs";
import { SYSTEM_ID } from "../config.mjs";
import { dadosDoAtaque, danoDoAtaque } from "../data/actor-criatura.mjs";
import { OP2Roll } from "../dice/op2-roll.mjs";
import { mostrarDados3D, enviarParaChat } from "../dice/teste.mjs";
import { lerConfig } from "../settings/register.mjs";
import { iconeDado } from "../ui/dice-icons.mjs";
import { enriquecerHtml } from "../ui/enriquecer.mjs";

const L = (k, d) => (d ? game.i18n.format(`OP2.Criatura.${k}`, d) : game.i18n.localize(`OP2.Criatura.${k}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const ordenar = (obj) => Object.entries(obj ?? {}).sort(([, a], [, b]) => (a.ordem ?? 0) - (b.ordem ?? 0));

export class CriaturaSheet extends NpcSheet {
  static DEFAULT_OPTIONS = {
    classes: ["op2-ficha--criatura"],
    position: { width: 540, height: 760 },
    window: { icon: "fa-solid fa-skull" },
    actions: {
      adicionarAtaque: CriaturaSheet.#adicionarAtaque,
      removerAtaque: CriaturaSheet.#remover,
      rolarAtaque: CriaturaSheet.#rolarAtaque,
      adicionarHabilidade: CriaturaSheet.#adicionarHabilidade,
      removerHabilidade: CriaturaSheet.#remover,
      mostrarHabilidade: CriaturaSheet.#mostrarHabilidade,
    },
  };

  static PARTS = {
    corpo: { template: "systems/ordem-paranormal-2e/templates/actor/criatura.hbs" },
  };

  async _prepareContext(opcoes) {
    const contexto = await super._prepareContext(opcoes);
    const sistema = this.actor.system;
    return {
      ...contexto,
      estrategiaEnriquecida: await enriquecerHtml(sistema.estrategia, this.actor),
      ataques: ordenar(sistema.ataques).map(([id, a]) => ({
        id, ...a,
        icones: dadosDoAtaque(a.dados).map((d) => iconeDado(d)).join(""),
        invalido: !dadosDoAtaque(a.dados).length,
        corpo: a.alcance === "corpo",
      })),
      habilidades: ordenar(sistema.habilidades).map(([id, h]) => ({ id, ...h })),
    };
  }

  static async #adicionarAtaque() {
    const id = foundry.utils.randomID();
    await this.actor.update({ [`system.ataques.${id}`]: { nome: L("NovoAtaque"), ordem: Object.keys(this.actor.system.ataques ?? {}).length } });
  }

  static async #adicionarHabilidade() {
    const id = foundry.utils.randomID();
    await this.actor.update({ [`system.habilidades.${id}`]: { nome: L("NovaHabilidade"), ordem: Object.keys(this.actor.system.habilidades ?? {}).length } });
  }

  static async #remover(_evento, alvo) {
    const { colecao, id } = alvo.dataset;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("Remover") }, content: `<p>${esc(L("RemoverPergunta"))}</p>`, rejectClose: false,
    });
    if (ok) await this.actor.update({ [`system.${colecao}.-=${id}`]: null });
  }

  /** Teste do ataque: os dados do bloco ("2d10", "d8+d6") e o dano RA/RB + N no card. */
  static async #rolarAtaque(_evento, alvo) {
    const ataque = this.actor.system.ataques?.[alvo.dataset.id];
    if (!ataque) return;
    const dados = dadosDoAtaque(ataque.dados);
    if (!dados.length) return void ui.notifications.warn(L("DadosInvalidos", { dados: ataque.dados }));
    const dano = danoDoAtaque(ataque.dano);
    const roll = OP2Roll.paraComponentes(
      dados.map((dado, i) => ({ chave: `ataque.${i}`, rotulo: ataque.nome, tipo: "extra", dado })),
      {
        dt: null,
        escopoCritico: lerConfig("escopoCritico"),
        rotulo: `${ataque.nome}${ataque.nota ? ` (${ataque.nota})` : ""}`,
        atorId: this.actor.id,
        chavePericia: "luta",
        danoCriatura: dano ? { nome: ataque.nome, ...dano } : null,
        semArma: true,
      },
    );
    await roll.evaluate();
    await mostrarDados3D(roll);
    if (roll.precisaSelecao) roll.aplicarSelecao(roll.selecaoSugerida());
    await enviarParaChat(roll, this.actor, { pularDados3D: true });
  }

  static async #mostrarHabilidade(_evento, alvo) {
    const h = this.actor.system.habilidades?.[alvo.dataset.id];
    if (!h) return;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="op2 op2-card op2-criatura-card"><h3>${esc(h.nome)}</h3><p>${esc(h.texto).replace(/\n/g, "<br>")}</p></div>`,
      flags: { [SYSTEM_ID]: { tipo: "criatura-habilidade" } },
    });
  }
}
