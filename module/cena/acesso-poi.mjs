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
import { CATEGORIAS_DESAFIO } from "./categorias-desafio.mjs";

/** As abordagens oferecidas ao criar o desafio pelo ponto, com as marcadas de início. */
const ABORDAGENS = [
  ["arrombar", "OP2.Desafio.Arrombar", true], ["destrancar", "OP2.Desafio.Destrancar", true],
  ["equilibrar", "OP2.Desafio.Equilibrar", false], ["hackTecnico", "OP2.Desafio.HackTecnico", false],
  ["hackSocial", "OP2.Desafio.HackSocial", false], ["sustentar", "OP2.Desafio.Sustentar", false],
  ["generico", "OP2.Desafio.Generico", false],
];

/** Pergunta como se vence o desafio. Devolve as abordagens ({chave: bool}) ou null. */
async function escolherAbordagens() {
  const caixas = ABORDAGENS.map(([chave, rotulo, marcada]) => `<label class="op2-campo op2-campo--inline">
      <input type="checkbox" name="${chave}" ${marcada ? "checked" : ""}><span>${game.i18n.localize(rotulo)}</span></label>`).join("");
  const escolha = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("OP2.Acesso.EscolherAbordagens"), icon: "fa-solid fa-lock" },
    classes: ["op2", "op2-dlg"],
    content: `<p class="op2-ajuda">${game.i18n.localize("OP2.Acesso.EscolherAbordagensAjuda")}</p>
      <div class="op2-desafio-abordagens__lista">${caixas}</div>`,
    buttons: [
      {
        action: "criar", label: game.i18n.localize("OP2.Acesso.Criar"), icon: "fa-solid fa-plus", default: true,
        callback: (_evento, botao) => Object.fromEntries(ABORDAGENS
          .map(([chave]) => [chave, Boolean(botao.form?.elements[chave]?.checked)])),
      },
      { action: "cancelar", label: game.i18n.localize("Cancel") },
    ],
    rejectClose: false,
  });
  return escolha && typeof escolha === "object" ? escolha : null;
}

let criando = false;

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
  // Clique duplo criava dois desafios iguais.
  if (!game.user.isGM || criando) return null;
  criando = true;
  try {
    const abordagens = await escolherAbordagens();
    if (!abordagens) return null;
    // Só Equilibrar-se marcado: o ícone e a categoria de equilíbrio.
    const soEquilibrio = abordagens.equilibrar && !Object.entries(abordagens).some(([c, v]) => v && c !== "equilibrar");
    const desafio = await Item.implementation.create({
      name: game.i18n.format("OP2.Acesso.NomeDesafio", { ponto: poi.name }),
      type: "desafio-acesso",
      img: (soEquilibrio ? CATEGORIAS_DESAFIO.equilibrio : CATEGORIAS_DESAFIO.acesso).icone,
      folder: poi.folder?.id ?? null,
      system: { categoria: "acesso", abordagens },
    });
    if (!desafio) return null;
    return await ligarDesafioNovo(poi, desafio);
  } finally {
    criando = false;
  }
}

async function ligarDesafioNovo(poi, desafio) {
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
