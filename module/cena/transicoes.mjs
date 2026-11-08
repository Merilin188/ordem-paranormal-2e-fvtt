/**
 * Transições de cena de um ponto de interesse: o mestre leva a mesa até a imagem do
 * lugar (o handout do Altar, os nichos da parede). Cada transição é uma imagem e um
 * modo:
 * - "janela": abre a imagem numa janela grande para todos, sem trocar de cena;
 * - "cena": ativa uma cena só com a imagem de fundo (criada no primeiro uso e
 *   reaproveitada depois), levando todos os jogadores para ela.
 * Um ponto pode ter várias (os nichos sem runas e com runas); a marcada como padrão é
 * a que o botão rápido do painel usa. Tudo aqui é do mestre.
 */
import { SYSTEM_ID } from "../config.mjs";

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

/** Uma transição nova, com id próprio. */
export function novaTransicao(dados = {}) {
  return {
    id: foundry.utils.randomID(), nome: "", imagem: "", modo: "cena", padrao: false, cenaUuid: "", ...dados,
  };
}

/**
 * A transição padrão do ponto: a marcada como padrão, senão a primeira com imagem.
 * Pura: recebe a lista.
 */
export function transicaoPadrao(transicoes = []) {
  const validas = transicoes.filter((t) => t.imagem);
  return validas.find((t) => t.padrao) ?? validas[0] ?? null;
}

/** Garante uma padrão só: marcar uma desmarca as outras. Pura. */
export function marcarPadrao(transicoes = [], id) {
  return transicoes.map((t) => ({ ...t, padrao: t.id === id }));
}

/** O nome que aparece no botão e na cena: o da transição, senão o arquivo. */
export function nomeDaTransicao(t, poi) {
  if (t.nome?.trim()) return t.nome.trim();
  const arquivo = decodeURIComponent(String(t.imagem ?? "").split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return arquivo || poi?.name || "";
}

/** A cena da transição: a já criada, ou uma nova só com a imagem de fundo. */
async function cenaDaTransicao(poi, t) {
  const existente = t.cenaUuid ? await fromUuid(t.cenaUuid) : null;
  if (existente) {
    // A imagem mudou na ficha: a cena acompanha.
    if (existente.background?.src !== t.imagem) await existente.update({ "background.src": t.imagem });
    return existente;
  }
  let largura = 1920;
  let altura = 1080;
  try {
    const textura = await foundry.canvas.loadTexture(t.imagem);
    largura = textura?.width || largura;
    altura = textura?.height || altura;
  } catch { /* fica no tamanho padrão */ }
  const cena = await Scene.implementation.create({
    name: nomeDaTransicao(t, poi),
    background: { src: t.imagem },
    width: largura,
    height: altura,
    padding: 0,
    backgroundColor: "#000000",
    grid: { type: 0 },
    tokenVision: false,
    fog: { exploration: false },
    navigation: false,
    flags: { [SYSTEM_ID]: { transicao: { poiUuid: poi.uuid, id: t.id } } },
  });
  const transicoes = poi.system.toObject().transicoes.map((x) => (x.id === t.id ? { ...x, cenaUuid: cena.uuid } : x));
  await poi.update({ "system.transicoes": transicoes });
  return cena;
}

/** Leva a mesa para a transição: troca de cena ou abre a janela para todos. */
export async function mostrarTransicao(poi, id) {
  if (!game.user.isGM || !poi) return;
  const t = poi.system.transicoes.find((x) => x.id === id);
  if (!t?.imagem) return void ui.notifications.warn(game.i18n.localize("OP2.Transicao.SemImagem"));
  const nome = nomeDaTransicao(t, poi);

  if (t.modo === "janela") {
    const Popout = foundry.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
    const janela = new Popout({ src: t.imagem, window: { title: nome }, showTitle: true });
    await janela.render(true);
    janela.shareImage();
    return;
  }

  const anterior = game.scenes.active;
  const cena = await cenaDaTransicao(poi, t);
  await cena.activate();
  ui.notifications.info(game.i18n.format("OP2.Transicao.Levou", {
    cena: cena.name, volta: anterior && anterior.id !== cena.id ? anterior.name : "—",
  }));
}

/**
 * O botão rápido (painel, topo da ficha): uma transição vai direto; várias abrem a
 * escolha, com a padrão em primeiro.
 */
export async function escolherEMostrar(poi) {
  if (!game.user.isGM || !poi) return;
  const validas = poi.system.transicoes.filter((t) => t.imagem);
  if (!validas.length) return void ui.notifications.warn(game.i18n.localize("OP2.Transicao.Nenhuma"));
  if (validas.length === 1) return mostrarTransicao(poi, validas[0].id);
  const padrao = transicaoPadrao(validas);
  const ordem = [padrao, ...validas.filter((t) => t !== padrao)];
  const escolha = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("OP2.Transicao.Escolher", { ponto: poi.name }), icon: "fa-solid fa-panorama" },
    classes: ["op2", "op2-dlg", "op2-dlg--transicao"],
    content: `<p class="op2-ajuda">${game.i18n.localize("OP2.Transicao.EscolherAjuda")}</p>`,
    buttons: ordem.map((t) => ({
      action: t.id,
      label: `${esc(nomeDaTransicao(t, poi))}${t === padrao ? ` (${game.i18n.localize("OP2.Transicao.Padrao")})` : ""}`,
      icon: t.modo === "janela" ? "fa-solid fa-image" : "fa-solid fa-map",
      default: t === padrao,
    })),
    rejectClose: false,
  });
  if (escolha) await mostrarTransicao(poi, escolha);
}
