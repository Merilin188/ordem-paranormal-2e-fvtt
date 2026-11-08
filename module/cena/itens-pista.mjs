/**
 * Itens de uma pista: a linha do quadro pode guardar itens (o gládio e o elmo do baú).
 * Achar a pista NÃO entrega nada: o card da revelação mostra os itens só para o
 * mestre, que pode tirar algum da lista e então clicar em "Transferir itens" — aí
 * as cópias vão para a ficha de quem achou.
 *
 * O estado vive nas flags da mensagem (`itensRemovidos`, `itensTransferidos`), e o
 * gancho de render pinta o card a partir delas: riscado, desfeito, já transferido.
 */
import { SYSTEM_ID } from "../config.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

/** Tipos de Item que não são "coisa de inventário" e não entram numa pista. */
const NAO_SAO_ITENS = new Set(["ponto-interesse", "desafio-acesso", "evento", "ocupacao"]);

/** O item pode ser guardado numa pista? */
export function podeSerItemDePista(item) {
  return Boolean(item) && !NAO_SAO_ITENS.has(item.type);
}

/** Chave de um item numa pista do card: "<id da linha>:<uuid do item>". Pura. */
export function chaveDoItem(infoId, uuid) {
  return `${infoId}:${uuid}`;
}

/** Os itens da linha que ainda vão para a ficha (sem os que o mestre tirou). Pura. */
export function itensAEntregar(infoId, uuids = [], removidos = []) {
  const fora = new Set(removidos);
  return uuids.filter((uuid) => !fora.has(chaveDoItem(infoId, uuid)));
}

/** Os itens de uma linha do quadro, prontos para o card (nome e imagem). */
export function itensDaLinha(info) {
  return (info.itens ?? []).map((uuid) => fromUuidSync(uuid))
    .filter(podeSerItemDePista)
    .map((item) => ({ uuid: item.uuid, nome: item.name, img: item.img }));
}

function mensagemDo(dataset) {
  return game.messages.get(dataset.mensagemId);
}

/** Tira (ou devolve) um item da lista daquela pista, no card. Só o mestre. */
async function alternarRemovido(_ator, dataset) {
  if (!game.user.isGM) return;
  const mensagem = mensagemDo(dataset);
  if (!mensagem) return;
  if ((mensagem.getFlag(SYSTEM_ID, "itensTransferidos") ?? []).includes(dataset.infoId)) return;
  const chave = chaveDoItem(dataset.infoId, dataset.itemUuid);
  const removidos = new Set(mensagem.getFlag(SYSTEM_ID, "itensRemovidos") ?? []);
  if (removidos.has(chave)) removidos.delete(chave);
  else removidos.add(chave);
  await mensagem.setFlag(SYSTEM_ID, "itensRemovidos", [...removidos]);
}

/** Copia os itens que sobraram para a ficha de quem achou a pista. Só o mestre. */
async function transferir(ator, dataset) {
  if (!game.user.isGM) return;
  const mensagem = mensagemDo(dataset);
  if (!mensagem) return;
  const transferidos = mensagem.getFlag(SYSTEM_ID, "itensTransferidos") ?? [];
  if (transferidos.includes(dataset.infoId)) return;

  const uuids = String(dataset.itens ?? "").split(",").filter(Boolean);
  const entregar = itensAEntregar(dataset.infoId, uuids, mensagem.getFlag(SYSTEM_ID, "itensRemovidos") ?? []);
  if (!entregar.length) return void ui.notifications.warn(game.i18n.localize("OP2.ItensPista.Nenhum"));

  const dados = [];
  for (const uuid of entregar) {
    const item = await fromUuid(uuid);
    if (!podeSerItemDePista(item)) continue;
    const copia = item.toObject();
    delete copia._id;
    delete copia.folder;
    delete copia.sort;
    delete copia.ownership;
    copia.flags = { ...(copia.flags ?? {}), [SYSTEM_ID]: { ...(copia.flags?.[SYSTEM_ID] ?? {}), daPista: uuid } };
    dados.push(copia);
  }
  if (!dados.length) return void ui.notifications.warn(game.i18n.localize("OP2.ItensPista.Nenhum"));
  await ator.createEmbeddedDocuments("Item", dados);
  await mensagem.setFlag(SYSTEM_ID, "itensTransferidos", [...transferidos, dataset.infoId]);

  // A mesa fica sabendo o que entrou na ficha (o card da pista é só de quem achou).
  const nomes = dados.map((d) => `<strong>${esc(d.name)}</strong>`).join(", ");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-card--investigacao">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena"><i class="fa-solid fa-box-open"></i> ${game.i18n.localize("OP2.ItensPista.Titulo")}</span></header>
      <p class="op2-card__texto">${game.i18n.format("OP2.ItensPista.Recebeu", { ator: esc(ator.name), itens: nomes })}</p></div>`,
    whisper: mensagem.whisper?.length ? mensagem.whisper : [],
    flags: { [SYSTEM_ID]: { tipo: "itens-pista", atorId: ator.id } },
  });
}

/** Pinta o bloco de itens do card a partir das flags da mensagem. */
function pintar(mensagem, html) {
  const blocos = html.querySelectorAll?.(".op2-card__itens-pista");
  if (!blocos?.length) return;
  const removidos = new Set(mensagem.getFlag(SYSTEM_ID, "itensRemovidos") ?? []);
  const transferidos = mensagem.getFlag(SYSTEM_ID, "itensTransferidos") ?? [];
  for (const bloco of blocos) {
    const infoId = bloco.dataset.infoId;
    const feito = transferidos.includes(infoId);
    bloco.classList.toggle("op2-card__itens-pista--feito", feito);
    let restam = 0;
    for (const linha of bloco.querySelectorAll("[data-item-uuid]")) {
      const fora = removidos.has(chaveDoItem(infoId, linha.dataset.itemUuid));
      if (!fora) restam++;
      linha.classList.toggle("op2-card__item-pista--removido", fora);
      const botao = linha.querySelector("button");
      if (!botao) continue;
      botao.disabled = feito;
      botao.dataset.tooltip = game.i18n.localize(fora ? "OP2.ItensPista.Devolver" : "OP2.ItensPista.Remover");
      botao.setAttribute("aria-label", botao.dataset.tooltip);
      botao.querySelector("i")?.classList.replace(fora ? "fa-xmark" : "fa-rotate-left", fora ? "fa-rotate-left" : "fa-xmark");
    }
    const transferir = bloco.querySelector("[data-op2-acao='transferir-itens-pista']");
    if (transferir) {
      transferir.disabled = feito || restam === 0;
      if (feito) transferir.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize("OP2.ItensPista.Transferidos")}`;
    }
  }
}

/** Chamado no init. */
export function registrarItensDaPista() {
  registrarAcaoDeChat("remover-item-pista", alternarRemovido);
  registrarAcaoDeChat("transferir-itens-pista", transferir);
  Hooks.on("renderChatMessageHTML", (mensagem, html) => {
    if (game.user.isGM) pintar(mensagem, html);
  });
}
