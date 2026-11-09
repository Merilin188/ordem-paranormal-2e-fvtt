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
  await entregar(ator, mensagem, dataset);
}

/**
 * Itens de um desafio vencido: não há "quem achou" — o mestre escolhe quem recebe
 * (o grupo da investigação primeiro).
 */
async function transferirDoDesafio(_ator, dataset) {
  if (!game.user.isGM) return;
  const mensagem = mensagemDo(dataset);
  if (!mensagem) return;
  if ((mensagem.getFlag(SYSTEM_ID, "itensTransferidos") ?? []).includes(dataset.infoId)) return;
  const sugerido = dataset.sugerido ? game.actors.get(dataset.sugerido) : null;
  if (sugerido) return entregar(sugerido, mensagem, dataset);
  const candidatos = game.actors.filter((a) => a.type === "personagem")
    .sort((a, b) => Number(b.hasPlayerOwner) - Number(a.hasPlayerOwner) || a.name.localeCompare(b.name));
  if (!candidatos.length) return void ui.notifications.warn(game.i18n.localize("OP2.ItensPista.SemPersonagem"));
  const opcoes = candidatos.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  const id = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("OP2.ItensPista.QuemRecebe"), icon: "fa-solid fa-box-open" },
    classes: ["op2", "op2-dlg"],
    content: `<div class="form-group"><label>${game.i18n.localize("OP2.ItensPista.QuemRecebe")}</label>
      <select name="ator">${opcoes}</select></div>`,
    ok: { label: game.i18n.localize("OP2.ItensPista.TransferirCurto"), callback: (_e, botao) => botao.form.elements.ator.value },
    rejectClose: false,
  });
  const ator = id ? game.actors.get(id) : null;
  if (ator) await entregar(ator, mensagem, dataset);
}

/** Copia os itens que sobraram na mensagem para a ficha do ator e marca como feito. */
async function entregar(ator, mensagem, dataset) {
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
    // Itens de desafio vencido: a mesa toda fica sabendo; de pista, os mesmos do card dela.
    whisper: mensagem.getFlag(SYSTEM_ID, "tipo") === "itens-desafio" || !mensagem.whisper?.length ? [] : mensagem.whisper,
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
    const transferir = bloco.querySelector("[data-op2-acao^='transferir-itens']");
    if (transferir) {
      transferir.disabled = feito || restam === 0;
      if (feito) transferir.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize("OP2.ItensPista.Transferidos")}`;
    }
  }
}

/** Chamado no init. */
/** Quem tentou o desafio por último (o que venceu, quando ele é vencido). */
export function quemVenceu(desafio) {
  const id = desafio?.getFlag(SYSTEM_ID, "ultimoAtorId");
  return id ? game.actors.get(id) ?? null : null;
}

/**
 * Para quem vai o card: "todos" (público), "mestre" (só os mestres) ou "descobridor"
 * (os mestres e os donos do personagem que venceu). Sem personagem, cai no mestre.
 */
export function destinatarios(para, ator) {
  const mestres = game.users.filter((u) => u.isGM).map((u) => u.id);
  if (para === "todos") return [];
  if (para === "descobridor" && ator) {
    const donos = game.users.filter((u) => !u.isGM && ator.testUserPermission(u, "OWNER")).map((u) => u.id);
    return [...new Set([...mestres, ...donos])];
  }
  return mestres;
}

/**
 * Desafio vencido com itens guardados: o card com os itens. Quem venceu vê o que
 * achou; o × de cada item e o "Transferir" são só do mestre. Ao vencer, vai para
 * quem venceu (e o mestre), uma vez; o botão da ficha manda de novo para quem o
 * mestre escolher.
 */
export async function anunciarItensDoDesafio(desafio, { para = "descobridor", forcar = false } = {}) {
  if (!game.user.isGM || (!forcar && desafio.getFlag(SYSTEM_ID, "itensAnunciados"))) return;
  const itens = (desafio.system.itens ?? []).map((uuid) => fromUuidSync(uuid)).filter(podeSerItemDePista);
  if (!itens.length) return;
  await desafio.setFlag(SYSTEM_ID, "itensAnunciados", true);
  const vencedor = quemVenceu(desafio);
  const infoId = "desafio";
  const linhas = itens.map((i) => `<li class="op2-card__item-pista" data-item-uuid="${esc(i.uuid)}">
      <img src="${esc(i.img)}" alt=""> <span>${esc(i.name)}</span>
      <button type="button" class="op2-botao-icone" data-op2-gm data-op2-acao="remover-item-pista" data-info-id="${infoId}"
        data-item-uuid="${esc(i.uuid)}" aria-label="${game.i18n.localize("OP2.ItensPista.Remover")}"
        data-tooltip="${game.i18n.localize("OP2.ItensPista.Remover")}"><i class="fa-solid fa-xmark"></i></button></li>`).join("");
  await ChatMessage.create({
    speaker: { alias: desafio.name },
    whisper: destinatarios(para, vencedor),
    content: `<div class="op2 op2-card op2-card--investigacao">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena"><i class="fa-solid fa-box-open"></i> ${game.i18n.localize("OP2.ItensPista.Titulo")}</span>
        <span class="op2-card__dt">${esc(desafio.name)}</span></header>
      <p class="op2-card__texto">${vencedor
        ? game.i18n.format("OP2.ItensPista.VencedorAchou", { ator: esc(vencedor.name), desafio: esc(desafio.name) })
        : game.i18n.format("OP2.ItensPista.DesafioVencido", { desafio: esc(desafio.name) })}</p>
      <div class="op2-card__itens-pista" data-info-id="${infoId}">
        <ul class="op2-card__itens-lista">${linhas}</ul>
        <button type="button" class="op2-botao op2-botao--pequeno" data-op2-gm data-op2-acao="transferir-itens-desafio"
          data-info-id="${infoId}" data-itens="${esc(itens.map((i) => i.uuid).join(","))}" data-sugerido="${esc(vencedor?.id ?? "")}">
          <i class="fa-solid fa-right-to-bracket"></i> ${vencedor
            ? game.i18n.format("OP2.ItensPista.Transferir", { ator: esc(vencedor.name) })
            : game.i18n.localize("OP2.ItensPista.TransferirEscolher")}</button>
      </div></div>`,
    flags: { [SYSTEM_ID]: { tipo: "itens-desafio", desafioUuid: desafio.uuid } },
  });
}

export function registrarItensDaPista() {
  registrarAcaoDeChat("remover-item-pista", alternarRemovido, { semAtor: true });
  registrarAcaoDeChat("transferir-itens-pista", transferir);
  registrarAcaoDeChat("transferir-itens-desafio", transferirDoDesafio, { semAtor: true });
  Hooks.on("renderChatMessageHTML", (mensagem, html) => {
    if (game.user.isGM) pintar(mensagem, html);
  });
}
