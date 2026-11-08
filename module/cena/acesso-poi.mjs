/**
 * Ponto de interesse bloqueado por desafio de acesso (o baú romano trancado).
 *
 * O ponto bloqueado só deixa achar, antes de abrir, as linhas marcadas "fora da
 * tranca" (analisar a construção do baú). Quando um desafio do ponto é vencido —
 * arrombado, destrancado, hackeado —, o mestre ativo grava `acesso.liberado` e o chat
 * narra o que havia dentro (`acesso.aoLiberar`). O mestre também libera à mão.
 */
import { SYSTEM_ID } from "../config.mjs";
import { estaTrancado } from "./investigacao.mjs";
import { desafioResolvido } from "./desafios.mjs";
import { renderizar } from "../dice/teste.mjs";
import { todasInvestigacoes, vincularDesafio, vincularDesafioAoPonto } from "./investigacao-ativa.mjs";

const CHAT = `systems/${SYSTEM_ID}/templates/chat`;

/** Os desafios de acesso ligados ao ponto, já carregados. */
export function desafiosDoPonto(poi) {
  return (poi?.system?.desafios ?? []).map((uuid) => fromUuidSync(uuid))
    .filter((desafio) => desafio?.type === "desafio-acesso");
}

/** O ponto está trancado agora? */
export function pontoTrancado(poi) {
  return estaTrancado(poi?.system?.acesso, desafiosDoPonto(poi).map((d) => desafioResolvido(d.system)));
}

/** O jogador pode ver o ponto em alguma investigação? Senão, o anúncio vai só ao mestre. */
function pontoAVista(poi) {
  return todasInvestigacoes()
    .some((inv) => inv.system.pois.includes(poi.uuid) && !inv.system.poisOcultos.includes(poi.uuid));
}

/**
 * Abre o ponto e narra no chat. Só o mestre escreve no Item (é documento de mundo).
 * @param {Item} poi
 * @param {object} [opcoes]
 * @param {Item|null} [opcoes.desafio] o desafio vencido, se foi por ele
 */
export async function liberarAcesso(poi, { desafio = null } = {}) {
  if (!game.user.isGM || poi?.system?.acesso?.liberado) return;
  await poi.update({ "system.acesso.liberado": true });

  const editor = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
  const texto = poi.system.acesso.aoLiberar?.trim() ?? "";
  const linhasDentro = poi.system.informacoes.filter((info) => !info.foraDaTranca && !info.oculta).length;
  const conteudo = await renderizar(`${CHAT}/acesso-liberado.hbs`, {
    poiNome: poi.name,
    img: poi.img,
    como: desafio
      ? game.i18n.format("OP2.Acesso.LiberadoPorDesafio", { desafio: desafio.name })
      : game.i18n.localize("OP2.Acesso.LiberadoPeloMestre"),
    texto: texto ? await editor.enrichHTML(texto, { relativeTo: poi }) : "",
    temDentro: linhasDentro > 0,
  });
  await ChatMessage.create({
    speaker: { alias: poi.name },
    content: conteudo,
    whisper: pontoAVista(poi) ? [] : game.users.filter((u) => u.isGM).map((u) => u.id),
    flags: { [SYSTEM_ID]: { tipo: "acesso-liberado", poiUuid: poi.uuid } },
  });
}

/** Tranca de novo (o mestre liberou cedo demais). Desafio já vencido continua abrindo. */
export async function trancarDeNovo(poi) {
  if (!game.user.isGM) return;
  await poi.update({ "system.acesso.liberado": false });
}

/**
 * Cria um desafio de acesso para o ponto, liga os dois, leva o desafio às
 * investigações do ponto (oculto se o ponto está oculto) e bloqueia o ponto.
 */
export async function criarDesafioDoPonto(poi) {
  if (!game.user.isGM) return null;
  const desafio = await Item.implementation.create({
    name: game.i18n.format("OP2.Acesso.NomeDesafio", { ponto: poi.name }),
    type: "desafio-acesso",
    folder: poi.folder?.id ?? null,
    system: { categoria: "acesso" },
  });
  if (!desafio) return null;
  await vincularDesafioAoPonto(poi, desafio.uuid);
  for (const inv of todasInvestigacoes().filter((i) => i.system.pois.includes(poi.uuid))) {
    await vincularDesafio(inv, desafio.uuid, { oculto: inv.system.poisOcultos.includes(poi.uuid) });
  }
  if (!poi.system.acesso.bloqueado) await poi.update({ "system.acesso.bloqueado": true });
  desafio.sheet?.render(true);
  return desafio;
}

/**
 * Vencer o desafio abre o ponto. Quem grava é o mestre ativo: o update do desafio
 * chega a todos os clientes, e só um deve narrar.
 */
export function registrarAcessoPoi() {
  Hooks.on("updateItem", (item) => {
    if (item.type !== "desafio-acesso" || game.users.activeGM?.id !== game.user.id) return;
    if (!desafioResolvido(item.system)) return;
    const pontos = game.items.filter((poi) => poi.type === "ponto-interesse"
      && poi.system.acesso?.bloqueado && !poi.system.acesso.liberado
      && poi.system.desafios.includes(item.uuid));
    for (const poi of pontos) void liberarAcesso(poi, { desafio: item });
  });
}
