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

/** A transição tem para onde levar? Imagem, ou uma cena existente escolhida. Pura. */
export function transicaoValida(t) {
  return t?.modo === "existente" ? Boolean(t.cenaUuid) : Boolean(t?.imagem);
}

/**
 * A transição padrão do ponto: a marcada como padrão, senão a primeira válida.
 * Pura: recebe a lista.
 */
export function transicaoPadrao(transicoes = []) {
  const validas = transicoes.filter(transicaoValida);
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

/**
 * O padrão das cenas da mesa para uma imagem: fundo preto, margem 0,15, grade
 * quadrada invisível, sem visão de token. Pura.
 * @param {{nome: string, imagem: string, largura: number, altura: number, v14: boolean}} dados
 */
export function dadosDaCenaNova({ nome, imagem, largura, altura, v14 }) {
  // No v14 o fundo mora no nível (`levels[0].background`); `background` da cena virou
  // só leitura — gravado ali, a cena nascia vazia (achado em uso real).
  const fundo = v14
    ? { levels: [{ _id: "defaultLevel0000", name: "Level", background: { src: imagem, color: "#000000" } }], initialLevel: "defaultLevel0000" }
    : { background: { src: imagem }, backgroundColor: "#000000" };
  return {
    name: nome,
    width: largura,
    height: altura,
    padding: 0.15,
    grid: { type: 1, alpha: 0 },
    tokenVision: false,
    navigation: false,
    ...fundo,
  };
}

const ehV14 = () => (game.release?.generation ?? 13) >= 14;

/** Troca a imagem de fundo de uma cena, nos dois formatos. */
async function trocarFundo(cena, imagem) {
  if (ehV14()) {
    const nivel = cena.initialLevel ?? cena.firstLevel ?? cena.levels?.contents?.[0];
    if (nivel && nivel.background?.src !== imagem) await nivel.update({ "background.src": imagem, "background.color": "#000000" });
  } else if (cena.background?.src !== imagem) {
    await cena.update({ "background.src": imagem });
  }
}

/** A pasta de cenas onde as transições criadas ficam juntas. */
async function pastaDasTransicoes() {
  const nome = game.i18n.localize("OP2.Transicao.Pasta");
  return game.folders.find((f) => f.type === "Scene" && f.name === nome)
    ?? globalThis.Folder.implementation.create({ name: nome, type: "Scene", color: "#7a1c12" });
}

/** A cena da transição: a já criada (acertada com a ficha) ou uma nova, no padrão da mesa. */
async function cenaDaTransicao(poi, t) {
  const nome = nomeDaTransicao(t, poi);
  if (t.modo === "existente") return t.cenaUuid ? fromUuid(t.cenaUuid) : null;

  // Só reaproveita cena criada por uma transição: a cena "real" escolhida no modo
  // "existente" nunca tem o fundo trocado ao voltar para "criar nova".
  const achada = t.cenaUuid ? await fromUuid(t.cenaUuid) : null;
  const existente = achada?.getFlag(SYSTEM_ID, "transicao") ? achada : null;
  if (existente) {
    // A imagem ou o nome mudaram na ficha: a cena criada por nós acompanha.
    await trocarFundo(existente, t.imagem);
    if (existente.name !== nome) await existente.update({ name: nome });
    return existente;
  }
  let largura = 1920;
  let altura = 1080;
  try {
    const textura = await foundry.canvas.loadTexture(t.imagem);
    largura = textura?.width || largura;
    altura = textura?.height || altura;
  } catch { /* fica no tamanho padrão */ }
  const pasta = await pastaDasTransicoes();
  const dados = dadosDaCenaNova({ nome, imagem: t.imagem, largura, altura, v14: ehV14() });
  const cena = await Scene.implementation.create({
    ...dados,
    folder: pasta?.id ?? null,
    flags: {
      [SYSTEM_ID]: { transicao: { poiUuid: poi.uuid, id: t.id } },
      // Lock View (se instalado): a imagem inteira na tela de todos.
      ...(game.modules.get("LockView")?.active ? { LockView: { autoscale: "autoInside", forceInitialView: true } } : {}),
    },
  });
  const transicoes = poi.system.toObject().transicoes.map((x) => (x.id === t.id ? { ...x, cenaUuid: cena.uuid } : x));
  await poi.update({ "system.transicoes": transicoes });
  return cena;
}

/** Leva a mesa para a transição: troca de cena ou abre a janela para todos. */
export async function mostrarTransicao(poi, id) {
  if (!game.user.isGM || !poi) return;
  const t = poi.system.transicoes.find((x) => x.id === id);
  if (!transicaoValida(t)) return void ui.notifications.warn(game.i18n.localize(
    t?.modo === "existente" ? "OP2.Transicao.SemCena" : "OP2.Transicao.SemImagem",
  ));
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
  if (!cena) return void ui.notifications.warn(game.i18n.localize("OP2.Transicao.SemCena"));
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
  const validas = poi.system.transicoes.filter(transicaoValida);
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
      icon: { janela: "fa-solid fa-image", existente: "fa-solid fa-map-location-dot" }[t.modo] ?? "fa-solid fa-map",
      default: t === padrao,
    })),
    rejectClose: false,
  });
  if (escolha) await mostrarTransicao(poi, escolha);
}
