/**
 * Excluir um desafio de vez: sai de todas as investigações e o Item é apagado.
 * Jogador também pode (janela de Ações), mas Item de mundo só o mestre escreve:
 * a exclusão passa pela ponte `comoMestre()`.
 */
import { comoMestre, registrarAcaoDeMestre } from "../ui/socket.mjs";
import { todasInvestigacoes, removerDesafio } from "./investigacao-ativa.mjs";

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

/** Pergunta e exclui. Devolve true se excluiu. */
export async function excluirDesafio(uuid) {
  const item = await fromUuid(uuid);
  if (!item) return false;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("OP2.Ferramentas.ExcluirDesafio") },
    content: `<p>${game.i18n.format("OP2.Ferramentas.ExcluirConfirma", { nome: esc(item.name) })}</p>`,
    rejectClose: false,
  });
  if (!ok) return false;
  await comoMestre("op2ExcluirDesafio", { uuid });
  return true;
}

/** Chamado no init. */
export function registrarExcluirDesafio() {
  registrarAcaoDeMestre("op2ExcluirDesafio", async ({ uuid }) => {
    const item = await fromUuid(uuid);
    if (!item) return;
    for (const investigacao of todasInvestigacoes()) {
      if (investigacao.system.desafios?.includes(uuid)) await removerDesafio(investigacao, uuid);
    }
    await item.delete();
  });
}
