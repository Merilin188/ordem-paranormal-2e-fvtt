/**
 * Habilidade de criatura no chat: um card só, com o que a mesa lê (texto para os
 * jogadores, dano rolado, condição ou efeito) e um bloco só do mestre (o texto de
 * bastidor e os botões que aplicam dano e condição nos alvos marcados).
 *
 * Nada se aplica sozinho: o mestre marca os alvos (tecla T) ou seleciona os tokens e
 * clica no botão do card.
 */
import { SYSTEM_ID } from "../config.mjs";
import { CONDICOES } from "./condicoes.mjs";
import { definirCondicao } from "./ferimentos.mjs";
import { aplicarDano } from "../dice/falha-critica.mjs";
import { mostrarDados3D } from "../dice/teste.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const L = (chave, dados) => (dados ? game.i18n.format(`OP2.Criatura.${chave}`, dados) : game.i18n.localize(`OP2.Criatura.${chave}`));
const paragrafos = (texto) => esc(texto).replace(/\n/g, "<br>");

/** As condições do sistema, para o seletor da ficha. */
export function opcoesDeCondicao() {
  return CONDICOES.filter((c) => c.id !== "defendendo")
    .map((c) => ({ id: c.id, rotulo: game.i18n.localize(c.name) }));
}

/** A fórmula de dano vale? Vazio = sem dano. Pura o bastante para testar com Roll. */
export function danoValido(formula) {
  const f = String(formula ?? "").trim();
  if (!f) return false;
  try { return Roll.validate(f); } catch { return false; }
}

/** Mostra a habilidade no chat, rolando o dano se houver. */
export async function mostrarHabilidadeNoChat(ator, id) {
  const h = ator?.system.habilidades?.[id];
  if (!h) return null;

  let roll = null;
  if (danoValido(h.dano)) {
    roll = await new Roll(String(h.dano).trim()).evaluate();
    await mostrarDados3D(roll);
  }
  const recurso = h.danoRecurso === "pd" ? "pd" : "pv";
  const condicao = CONDICOES.find((c) => c.id === h.condicao);
  const condicaoNome = condicao ? game.i18n.localize(condicao.name) : "";
  const efeito = String(h.efeito ?? "").trim();

  const partes = [`<h3>${esc(h.nome)}</h3>`];
  if (h.texto?.trim()) partes.push(`<p>${paragrafos(h.texto)}</p>`);
  if (roll) {
    const dados = roll.dice.flatMap((d) => d.results.map((r) => `<span class="op2-card__dado" data-tooltip="d${d.faces}">${r.result}</span>`)).join("");
    partes.push(`<div class="op2-card__dados op2-criatura-card__dano">${dados}
      <span class="op2-card__igual" aria-hidden="true">=</span><span class="op2-card__total">${roll.total}</span>
      <span class="op2-ajuda">${esc(roll.formula)} · ${game.i18n.localize(`OP2.Recurso.${recurso}`)}</span></div>`);
  }
  if (condicaoNome) partes.push(`<p class="op2-criatura-card__efeito"><i class="fa-solid fa-circle-exclamation"></i> ${L("CondicaoNoCard", { condicao: esc(condicaoNome) })}</p>`);
  if (efeito) partes.push(`<p class="op2-criatura-card__efeito"><i class="fa-solid fa-wand-sparkles"></i> ${L("EfeitoNoCard", { efeito: esc(efeito) })}</p>`);

  // O bloco do mestre: bastidor e os botões de aplicar (removido do DOM do jogador).
  const mestre = [];
  if (h.textoMestre?.trim()) mestre.push(`<p>${paragrafos(h.textoMestre)}</p>`);
  const botoes = [];
  const base = `data-ator-uuid="${esc(ator.uuid)}" data-ator-id="${esc(ator.id)}"`;
  if (roll && roll.total > 0) {
    botoes.push(`<button type="button" class="op2-botao op2-botao--pequeno" data-op2-acao="habilidade-dano" ${base}
      data-quantidade="${roll.total}" data-recurso="${recurso}"><i class="fa-solid fa-heart-crack"></i> ${L("AplicarDanoAlvos", { dano: roll.total })}</button>`);
  }
  if (condicao) {
    botoes.push(`<button type="button" class="op2-botao op2-botao--pequeno" data-op2-acao="habilidade-condicao" ${base}
      data-condicao="${esc(condicao.id)}"><i class="fa-solid fa-circle-exclamation"></i> ${L("AplicarCondicaoAlvos", { condicao: esc(condicaoNome) })}</button>`);
  }
  if (botoes.length) {
    mestre.push(`<div class="op2-card__acoes">${botoes.join("")}</div>`);
    mestre.push(`<p class="op2-ajuda">${L("AlvosDica")}</p>`);
  }
  if (mestre.length) {
    partes.push(`<div class="op2-criatura-card__mestre" data-op2-gm>
      <span class="op2-criatura-card__mestre-titulo"><i class="fa-solid fa-user-secret"></i> ${L("SoMestre")}</span>${mestre.join("")}</div>`);
  }

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-criatura-card">${partes.join("")}</div>`,
    rolls: roll ? [roll] : [],
    flags: { [SYSTEM_ID]: { tipo: "criatura-habilidade", atorId: ator.id } },
  });
}

/** Os alvos do mestre: os marcados (T); sem marca, os tokens selecionados (menos a criatura). */
function alvosDoMestre(criatura) {
  const marcados = [...(game.user.targets ?? [])].map((t) => t.actor).filter(Boolean);
  if (marcados.length) return marcados;
  return (canvas.tokens?.controlled ?? []).map((t) => t.actor).filter((a) => a && a !== criatura);
}

async function aplicarDanoNosAlvos(criatura, dataset) {
  if (!game.user.isGM) return;
  const alvos = alvosDoMestre(criatura);
  if (!alvos.length) return void ui.notifications.warn(L("SemAlvos"));
  for (const alvo of alvos) await aplicarDano(alvo, Number(dataset.quantidade), dataset.recurso ?? "pv");
  ui.notifications.info(game.i18n.format("OP2.Chat.DanoAplicado", {
    quantidade: dataset.quantidade, alvos: alvos.map((a) => a.name).join(", "),
  }));
}

async function aplicarCondicaoNosAlvos(criatura, dataset) {
  if (!game.user.isGM) return;
  const alvos = alvosDoMestre(criatura);
  if (!alvos.length) return void ui.notifications.warn(L("SemAlvos"));
  for (const alvo of alvos) await definirCondicao(alvo, dataset.condicao, true);
  const condicao = CONDICOES.find((c) => c.id === dataset.condicao);
  ui.notifications.info(L("CondicaoAplicada", {
    condicao: condicao ? game.i18n.localize(condicao.name) : dataset.condicao,
    alvos: alvos.map((a) => a.name).join(", "),
  }));
}

/** Chamado no init. */
export function registrarHabilidadeDeCriatura() {
  registrarAcaoDeChat("habilidade-dano", aplicarDanoNosAlvos);
  registrarAcaoDeChat("habilidade-condicao", aplicarCondicaoNosAlvos);
}
