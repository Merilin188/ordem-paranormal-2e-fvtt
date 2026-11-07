/**
 * Sucesso crítico: botão no card para rolar mais um dado e somar ao total
 * ("soma mais uma rolagem à pontuação ou ao dano" — usado em testes estendidos e
 * ataques). O dado é o maior entre os que formaram o crítico. Uma vez por card.
 */
import { comoMestre } from "../ui/socket.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";

/** O dado do crítico: o maior entre os dados com o valor repetido (>= 6). */
export function dadoDoCritico(dados) {
  const validos = (dados ?? []).filter((d) => !d.pavor && !d.consumido);
  const contagem = {};
  for (const d of validos) contagem[d.resultado] = (contagem[d.resultado] ?? 0) + 1;
  const valor = Math.max(...Object.entries(contagem).filter(([v, n]) => Number(v) >= 6 && n >= 2).map(([v]) => Number(v)), 0);
  const faces = (d) => Number(String(d.dado ?? "").replace("d", "")) || 0;
  const doPar = validos.filter((d) => d.resultado === valor);
  const base = doPar.length ? doPar : validos;
  return Math.max(...base.map(faces), 6);
}

/**
 * Rola o dado extra do crítico e guarda no teste (o total passa a somá-lo). Em
 * ataques e testes opostos isso acontece sozinho, ANTES dos cards que dependem do
 * total — senão "vence ... (16 × 7)" saía sem o dado do crítico.
 */
export async function rolarExtraDoCritico(roll) {
  if (!roll?.resultado?.critico || roll.options.bonusCritico) return null;
  const faces = dadoDoCritico(roll.dados);
  const extra = await new Roll(`1d${faces}`).evaluate();
  const { mostrarDados3D } = await import("./teste.mjs");
  await mostrarDados3D(extra);
  roll.options.bonusCritico = { dado: `d${faces}`, valor: extra.total };
  return roll.options.bonusCritico;
}

async function rolarDadoDoCritico(_autor, dataset) {
  const mensagem = game.messages.get(dataset.mensagemId);
  const roll = mensagem?.rolls?.[0];
  if (!roll?.dados || !roll.resultado?.critico) return;
  const ator = game.actors.get(roll.options.atorId ?? dataset.atorId);
  if (!game.user.isGM && !ator?.isOwner) return;
  if (roll.options.bonusCritico) return void ui.notifications.info(game.i18n.localize("OP2.CriticoExtra.JaRolado"));

  await rolarExtraDoCritico(roll);
  const { htmlDoTeste } = await import("./teste.mjs");
  const html = await htmlDoTeste(roll, ator);
  await comoMestre("op2AtualizarMensagem", { id: mensagem.id, content: html, rolls: [JSON.stringify(roll.toJSON())] });
  // O card "acerta X" daquele ataque passa a usar as duas rolagens mais altas.
  const { atualizarAtaquesDoTeste } = await import("../cena/acoes-combate.mjs");
  await atualizarAtaquesDoTeste(roll);
}

/** Chamado no init. */
export function registrarCriticoExtra() {
  registrarAcaoDeChat("dado-critico", rolarDadoDoCritico);
}
