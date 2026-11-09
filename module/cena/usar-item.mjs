/**
 * Itens com uso e com passiva (equipamentos).
 *
 * USO: o item tem uma lista de efeitos — uma fórmula de dados e o que ela faz (dano
 * físico ou mental nos alvos, cura de PV ou PD em quem usa, um dado de esconderijo
 * ou só um texto). Com "escolher um", quem usa escolhe UM deles (a runa da Brenna:
 * 1d10 PV OU 1d10 PD OU um dado de esconderijo). "Gasta ao usar" consome uma carga
 * (ou uma unidade); gasto, o item diz a mensagem dele ("sua runa já foi apagada").
 *
 * PASSIVA: enquanto o item está na ficha e não foi gasto, o personagem fica com uma
 * condição (status) — e a ficha mostra o símbolo. Gastou ou saiu da ficha, some.
 */
import { SYSTEM_ID } from "../config.mjs";
import { CONDICOES } from "./condicoes.mjs";

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const L = (k, d) => (d ? game.i18n.format(`OP2.Uso.${k}`, d) : game.i18n.localize(`OP2.Uso.${k}`));

/** Os tipos de efeito que um item pode ter, na ordem do seletor. */
export const TIPOS_DE_USO = ["danoFisico", "danoMental", "curaPV", "curaPD", "esconderijo", "texto"];

/** O item já foi gasto? (sem cargas, ou sem unidades quando gasta ao usar). Pura. */
export function itemGasto(system = {}) {
  if (!system.gastaAoUsar) return false;
  if (system.cargas?.usa) return (system.cargas.value ?? 0) <= 0;
  return (system.quantidade ?? 0) <= 0;
}

/** O que gastar ao usar: a carga (se usa cargas) ou uma unidade. Pura. */
export function dadosDoGasto(system = {}) {
  if (!system.gastaAoUsar) return null;
  if (system.cargas?.usa) return { "system.cargas.value": Math.max(0, (system.cargas.value ?? 0) - 1) };
  return { "system.quantidade": Math.max(0, (system.quantidade ?? 0) - 1) };
}

/** As condições que uma passiva pode dar (todas, menos as de estado de combate). */
export function opcoesDePassiva() {
  return CONDICOES.filter((c) => !["defendendo", "morto", "moribundo", "inconsciente"].includes(c.id))
    .map((c) => ({ id: c.id, rotulo: game.i18n.localize(c.name) }));
}

/** O item tem algo para usar? */
export function temUso(item) {
  return item?.type === "equipamento" && (item.system.usos ?? []).some((u) => u.formula?.trim() || u.tipo === "texto");
}

/** Usa o item: escolhe o efeito (se for "um OU outro"), rola, aplica e gasta. */
export async function usarItem(ator, item) {
  if (!ator || !temUso(item)) return null;
  if (itemGasto(item.system)) {
    ui.notifications.warn(item.system.mensagemGasto?.trim() || L("JaGasto", { item: item.name }));
    return null;
  }
  const usos = item.system.usos.filter((u) => u.formula?.trim() || u.tipo === "texto");
  let escolhidos = usos;
  if (item.system.escolhaUnica && usos.length > 1) {
    const i = await foundry.applications.api.DialogV2.wait({
      window: { title: L("Escolher", { item: item.name }), icon: "fa-solid fa-hand-sparkles" },
      classes: ["op2", "op2-dlg", "op2-defesa-janela"],
      content: `<p class="op2-ajuda">${esc(L("EscolherAjuda"))}</p>`,
      buttons: usos.map((u, n) => ({ action: String(n), label: rotuloDoUso(u), icon: `fa-solid ${ICONE[u.tipo] ?? "fa-dice"}`, default: n === 0 })),
      rejectClose: false,
    });
    if (i === null || i === undefined) return null;
    escolhidos = [usos[Number(i)]];
  }

  const linhas = [];
  for (const uso of escolhidos) {
    const r = await aplicarUso(ator, uso);
    if (r?.linha) linhas.push(r.linha);
  }

  const gasto = dadosDoGasto(item.system);
  if (gasto) await item.update(gasto);
  const acabou = gasto && itemGasto({ ...item.system, ...foundry.utils.expandObject(gasto).system });
  if (acabou) linhas.push(`<p class="op2-uso__gasto"><i class="fa-solid fa-eraser"></i> ${esc(item.system.mensagemGasto?.trim() || L("Gastou", { item: item.name }))}</p>`);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-uso-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena"><img src="${esc(item.img)}" alt=""> ${esc(item.name)}</span></header>
      <p class="op2-card__texto">${esc(L("Usou", { ator: ator.name, item: item.name }))}</p>
      ${linhas.join("")}</div>`,
    // Sem `rolls`: os dados já rolaram em 3D (com eles na mensagem, o Dice So Nice
    // rolava tudo DE NOVO — achado em uso real com a Runa de Brenna).
    flags: { [SYSTEM_ID]: { tipo: "uso-item", atorId: ator.id } },
  });
  return item;
}

const ICONE = {
  danoFisico: "fa-heart-crack", danoMental: "fa-brain", curaPV: "fa-heart-pulse", curaPD: "fa-head-side-heart",
  esconderijo: "fa-eye-slash", texto: "fa-scroll",
};

/** "1d10 — Cura de PV". Pura o bastante para os botões. */
export function rotuloDoUso(uso) {
  const tipo = game.i18n.localize(`OP2.Uso.Tipo.${uso.tipo}`);
  const formula = uso.formula?.trim();
  const texto = uso.tipo === "texto" ? (uso.texto?.trim() || tipo) : tipo;
  return formula ? `${formula} — ${texto}` : texto;
}

/** Os dados que viram o dado de esconderijo: "1d10" → d10. Pura. */
export function facesDaFormula(formula) {
  const m = /d(\d+)/i.exec(String(formula ?? ""));
  return m ? Number(m[1]) : 6;
}

async function rolarFormula(formula) {
  const f = String(formula ?? "").trim();
  if (!f || !Roll.validate(f)) return null;
  const roll = await new Roll(f).evaluate();
  const { mostrarDados3D } = await import("../dice/teste.mjs");
  await mostrarDados3D(roll);
  return roll;
}

const iconesDoRoll = (roll) => roll.dice.flatMap((d) => d.results.map((r) => `<span class="op2-card__dado" data-tooltip="d${d.faces}">${r.result}</span>`)).join("");

async function aplicarUso(ator, uso) {
  const nota = uso.texto?.trim() && uso.tipo !== "texto" ? ` <span class="op2-ajuda">${esc(uso.texto)}</span>` : "";
  if (uso.tipo === "texto") return { linha: `<p><i class="fa-solid fa-scroll"></i> ${esc(uso.texto || "")}</p>` };
  const roll = await rolarFormula(uso.formula);
  if (!roll) return null;
  const valor = roll.total;
  const dados = `<span class="op2-card__dados">${iconesDoRoll(roll)}<span class="op2-card__igual">=</span><span class="op2-card__total">${valor}</span></span>`;

  if (uso.tipo === "curaPV" || uso.tipo === "curaPD") {
    const chave = uso.tipo === "curaPV" ? "pv" : "pd";
    const r = ator.system.recursos[chave];
    const novo = Math.min(r.max, r.value + Math.max(0, valor));
    await ator.update({ [`system.recursos.${chave}.value`]: novo });
    return { roll, linha: `<div class="op2-uso__linha"><i class="fa-solid ${ICONE[uso.tipo]}"></i> ${dados}
      <span>${esc(L("Curou", { ator: ator.name, n: novo - r.value, recurso: chave.toUpperCase(), de: r.value, para: novo }))}</span>${nota}</div>` };
  }

  if (uso.tipo === "esconderijo") {
    const faces = facesDaFormula(uso.formula);
    const { ganharDadoDeEsconderijo } = await import("./furtividade.mjs");
    const onde = await ganharDadoDeEsconderijo(ator, { dado: `d${faces}`, valor });
    // O valor do dado de esconderijo é segredo das criaturas: o card não mostra o número.
    return { linha: `<div class="op2-uso__linha"><i class="fa-solid fa-eye-slash"></i>
      <span>${esc(L(onde === "cena" ? "EsconderijoCena" : "EsconderijoGuardado", { ator: ator.name, dado: `d${faces}` }))}</span>${nota}</div>` };
  }

  // Dano: nos alvos marcados por quem usa; sem alvo, o mestre aplica pelo botão.
  const recurso = uso.tipo === "danoMental" ? "pd" : "pv";
  const alvos = [...(game.user.targets ?? [])].map((t) => t.actor).filter((a) => a && a !== ator);
  if (alvos.length && game.user.isGM) {
    const { aplicarDano } = await import("../dice/falha-critica.mjs");
    for (const alvo of alvos) await aplicarDano(alvo, valor, recurso);
  }
  const textoAlvos = alvos.length && game.user.isGM
    ? L("DanoAplicadoEm", { n: valor, recurso: recurso.toUpperCase(), alvos: alvos.map((a) => a.name).join(", ") })
    : L("DanoRolado", { n: valor, recurso: recurso.toUpperCase() });
  const botao = alvos.length && game.user.isGM ? "" : `<div class="op2-card__acoes" data-op2-gm>
      <button type="button" class="op2-botao op2-botao--pequeno" data-op2-acao="habilidade-dano" data-ator-uuid="${esc(ator.uuid)}"
        data-ator-id="${esc(ator.id)}" data-quantidade="${valor}" data-recurso="${recurso}">
        <i class="fa-solid fa-heart-crack"></i> ${esc(game.i18n.format("OP2.Criatura.AplicarDanoAlvos", { dano: valor }))}</button></div>`;
  return { roll, linha: `<div class="op2-uso__linha"><i class="fa-solid ${ICONE[uso.tipo]}"></i> ${dados} <span>${esc(textoAlvos)}</span>${nota}</div>${botao}` };
}

/* -- passiva ------------------------------------------------------------------ */

/** Os status que os itens da ficha dão agora (os não gastos). Pura. */
export function statusDasPassivas(itens = []) {
  return [...new Set(itens.filter((i) => i.type === "equipamento" && i.system?.passiva?.status && !itemGasto(i.system))
    .map((i) => i.system.passiva.status))];
}

/** Liga e desliga os status das passivas do personagem conforme os itens. */
export async function sincronizarPassivas(ator) {
  if (!ator || ator.type !== "personagem" || game.users.activeGM?.id !== game.user.id) return;
  const desejados = statusDasPassivas(ator.items.contents);
  const nossos = ator.getFlag(SYSTEM_ID, "statusDePassiva") ?? [];
  const { definirCondicao } = await import("./ferimentos.mjs");
  for (const id of nossos) if (!desejados.includes(id)) await definirCondicao(ator, id, false);
  for (const id of desejados) await definirCondicao(ator, id, true);
  if (JSON.stringify([...nossos].sort()) !== JSON.stringify([...desejados].sort())) {
    await ator.setFlag(SYSTEM_ID, "statusDePassiva", desejados);
  }
}

/** Chamado no init. */
export function registrarUsoDeItens() {
  game.settings.register(SYSTEM_ID, "runaBrennaCriada", { scope: "world", config: false, type: Boolean, default: false });
  const aoMudar = (item) => {
    if (item.type === "equipamento" && item.parent?.type === "personagem") void sincronizarPassivas(item.parent);
  };
  for (const gancho of ["createItem", "updateItem", "deleteItem"]) Hooks.on(gancho, aoMudar);
  Hooks.once("ready", () => {
    for (const ator of game.actors.filter((a) => a.type === "personagem")) void sincronizarPassivas(ator);
    void criarRunaDeBrenna();
  });
}

/* -- a Runa de Brenna (Contos da Vigília) -------------------------------------- */

export const RUNA_BRENNA = () => ({
  name: "Runa de Brenna",
  type: "equipamento",
  img: `systems/${SYSTEM_ID}/assets/icons/runa-brenna.svg`,
  system: {
    quantidade: 1,
    descricao: "<p>Runa de proteção. Uso único, como ação livre: escolha recuperar 1d10 PV, recuperar 1d10 PD ou ganhar um dado de esconderijo d10. Ao usar, a runa se apaga.</p>",
    cargas: { usa: true, value: 1, max: 1 },
    usos: [
      { formula: "1d10", tipo: "curaPV", texto: "" },
      { formula: "1d10", tipo: "curaPD", texto: "" },
      { formula: "1d10", tipo: "esconderijo", texto: "" },
    ],
    escolhaUnica: true,
    gastaAoUsar: true,
    mensagemGasto: "Sua runa já foi apagada.",
    passiva: { status: "runa", simbolo: true },
  },
});

/** Uma vez por mundo, o mestre ganha a Runa de Brenna pronta nos Itens. */
async function criarRunaDeBrenna() {
  if (game.users.activeGM?.id !== game.user.id) return;
  try {
    if (game.settings.get(SYSTEM_ID, "runaBrennaCriada")) return;
  } catch { return; }
  if (!game.items.some((i) => i.name === "Runa de Brenna")) await Item.implementation.create(RUNA_BRENNA());
  await game.settings.set(SYSTEM_ID, "runaBrennaCriada", true);
}
