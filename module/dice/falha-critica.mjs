/**
 * Tabela de falha crítica (spec §4.4).
 *
 * Rola 1d8 e mostra o efeito, mas nunca aplica sozinho: o texto é explícito em deixar a
 * decisão com o mestre, que pode trocar o efeito se não fizer sentido na situação.
 */
import { SYSTEM_ID, TABELA_FALHA_CRITICA } from "../config.mjs";
import { renderizar } from "./teste.mjs";
import { devidoTesteDeQueda } from "../cena/queda.mjs";
import { pedirTesteDeQueda } from "../cena/ferimentos.mjs";

/**
 * @param {Actor} ator
 * @returns {Promise<{face: number, entrada: object}>}
 */
export async function rolarFalhaCritica(ator) {
  const roll = await new Roll("1d8").evaluate();
  const { mostrarDados3D } = await import("./teste.mjs");
  await mostrarDados3D(roll);
  return cartaoFalhaCritica(ator, roll.total);
}

/** Card do efeito sorteado (a face já rolada), com o botão de aplicar do mestre. */
export async function cartaoFalhaCritica(ator, face) {
  const entrada = TABELA_FALHA_CRITICA[face];
  const conteudo = await renderizar("systems/ordem-paranormal-2e/templates/chat/falha-critica.hbs", {
    face,
    chave: entrada.chave,
    efeito: entrada.efeito,
    alvo: entrada.alvo,
    formula: entrada.formula,
    aplicavel: entrada.efeito === "reducao" || entrada.efeito === "dano",
    atorId: ator.id,
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: conteudo,
    flags: { [SYSTEM_ID]: { tipo: "falha-critica", face, atorId: ator.id } },
  });

  return { face, entrada };
}

/**
 * Aplica o efeito sorteado. Só o mestre chega aqui — o botão do card é dele.
 * @param {Actor} ator
 * @param {number} face
 */
export async function aplicarFalhaCritica(ator, face) {
  const entrada = TABELA_FALHA_CRITICA[face];
  if (!entrada) return;

  if (entrada.efeito === "reducao") {
    // Redução "até o fim da cena": incrementa o contador, que é zerado ao encerrar a cena.
    const caminho = `system.estado.reducoesTemporarias.${entrada.alvo}`;
    await ator.update({ [caminho]: foundry.utils.getProperty(ator, caminho) + 1 });
    ui.notifications.info(game.i18n.format("OP2.FalhaCritica.Aplicada", {
      ator: ator.name,
      efeito: game.i18n.localize(`OP2.FalhaCritica.${entrada.chave}.nome`),
    }));
    return;
  }

  if (entrada.efeito === "dano") {
    const roll = await new Roll(entrada.formula).evaluate();
    const { cardDeDano } = await import("../cena/rodada.mjs");
    await cardDeDano(ator, roll, {
      titulo: game.i18n.localize(`OP2.FalhaCritica.${entrada.chave}.nome`),
      recurso: entrada.alvo,
      flags: { tipo: "falha-critica-dano" },
    });
    await aplicarDano(ator, roll.total, entrada.alvo);
  }
}

/**
 * @param {Actor} ator
 * @param {number} quantidade
 * @param {"pv"|"pd"} recurso
 */
export async function aplicarDano(ator, quantidade, recurso = "pv") {
  // Estresse pós-traumático: todo dano emocional aumenta em +1.
  if (recurso === "pd" && quantidade > 0) quantidade += ator.system.modificadores?.danoEmocional ?? 0;

  // Pontos de armadura: 1 ponto reduz este dano em 10 (ação livre, decisão do jogador).
  const armadura = ator.system.armadura?.value ?? 0;
  if (recurso === "pv" && quantidade > 0 && armadura > 0) {
    const usar = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("OP2.Armadura.Titulo") },
      content: `<p>${game.i18n.format("OP2.Armadura.Pergunta", { nome: ator.name, dano: quantidade, pontos: armadura })}</p>`,
    });
    if (usar) {
      quantidade = Math.max(0, quantidade - 10);
      await ator.update({ "system.armadura.gastos": (ator.system.armadura.gastos ?? 0) + 1 });
    }
  }

  const atual = ator.system.recursos[recurso].value;
  const novo = Math.max(0, atual - quantidade);
  await ator.update({ [`system.recursos.${recurso}.value`]: novo });
  // Chegar a 0 é tratado pelo gancho de updateActor (vale também para edição manual);
  // aqui só o caso "sofrer dano já estando em 0".
  if (atual > 0) return;

  // Chegar a 0 — ou tomar dano já em 0 — pede teste de Vigor (PV) ou Disciplina
  // (PD), com DT que escala (spec §8.2/§8.3). O card só PEDE: quem rola é a mesa,
  // como em todo o resto do sistema. NPC não tem os contadores da ficha de
  // personagem, então fica de fora.
  if (ator.type === "personagem" && devidoTesteDeQueda(novo, quantidade)) {
    await pedirTesteDeQueda(ator, recurso === "pd" ? "trauma" : "ferimento");
  }
}
