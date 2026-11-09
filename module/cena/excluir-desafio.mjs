/**
 * Excluir um desafio de vez: sai de todas as investigações e dos pontos, e o Item é
 * apagado. Excluir um ponto de interesse também: sai das investigações (o marcador
 * no mapa some pelo `deleteItem`) e, se o mestre quiser, leva os desafios dele.
 * Jogador também pode (janela de Ações), mas Item de mundo só o mestre escreve:
 * a exclusão passa pela ponte `comoMestre()`.
 */
import { comoMestre, registrarAcaoDeMestre } from "../ui/socket.mjs";
import { todasInvestigacoes, removerDesafio, removerPoi } from "./investigacao-ativa.mjs";

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

/** Pergunta e exclui. Devolve true se excluiu. */
export async function excluirDesafio(uuid) {
  // Só o mestre exclui desafio (o jogador nem vê o botão).
  if (!game.user.isGM) return false;
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

/** Tira o desafio das investigações e dos pontos, e apaga. Só no mestre. */
async function apagarDesafio(uuid) {
  const item = await fromUuid(uuid);
  if (!item) return;
  for (const investigacao of todasInvestigacoes()) {
    if (investigacao.system.desafios?.includes(uuid)) await removerDesafio(investigacao, uuid);
  }
  for (const poi of game.items.filter((i) => i.type === "ponto-interesse" && i.system.desafios?.includes(uuid))) {
    await poi.update({ "system.desafios": poi.system.desafios.filter((d) => d !== uuid) });
  }
  await item.delete();
}

/**
 * Pergunta e exclui um ponto de interesse (só o mestre). Os desafios do ponto vão
 * junto por padrão — sem o ponto, ficariam soltos na investigação.
 * @returns {Promise<boolean>} true se excluiu
 */
export async function excluirPontoDeInteresse(uuid) {
  if (!game.user.isGM) return false;
  const poi = await fromUuid(uuid);
  if (poi?.type !== "ponto-interesse") return false;
  const desafios = (poi.system.desafios ?? []).filter((d) => fromUuidSync(d));
  const caixa = desafios.length
    ? `<label class="op2-campo op2-campo--inline"><input type="checkbox" name="desafiosJunto" checked>
        <span>${game.i18n.format("OP2.POI.ExcluirDesafiosJunto", { n: desafios.length })}</span></label>`
    : "";
  const escolha = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("OP2.POI.Excluir"), icon: "fa-solid fa-trash" },
    classes: ["op2", "op2-dlg"],
    content: `<p>${game.i18n.format("OP2.POI.ExcluirConfirma", { nome: esc(poi.name) })}</p>${caixa}`,
    buttons: [
      {
        action: "sim", label: game.i18n.localize("OP2.POI.Excluir"), icon: "fa-solid fa-trash", default: true,
        callback: (_evento, botao) => ({ desafiosJunto: Boolean(botao.form?.elements.desafiosJunto?.checked) }),
      },
      { action: "nao", label: game.i18n.localize("Cancel") },
    ],
    rejectClose: false,
  });
  if (!escolha || escolha === "nao") return false;
  for (const investigacao of todasInvestigacoes()) {
    if (investigacao.system.pois?.includes(uuid)) await removerPoi(investigacao, uuid);
  }
  if (escolha.desafiosJunto) for (const d of desafios) await apagarDesafio(d);
  // A ficha aberta fecha sozinha ao apagar o documento.
  await poi.delete();
  return true;
}

/** Chamado no init. */
export function registrarExcluirDesafio() {
  registrarAcaoDeMestre("op2ExcluirDesafio", ({ uuid }) => apagarDesafio(uuid));
}
