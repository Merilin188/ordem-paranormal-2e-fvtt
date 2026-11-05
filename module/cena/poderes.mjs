/**
 * Poderes automatizados das fichas do playtest 2 (Rhiona, Rowan, Cavan, Malik, Sira,
 * Sorcha, Cormac e o Arsenal de Herborista).
 *
 * Cada habilidade declara `system.automacao` (uma chave daqui). O que é escolha do
 * jogador vira botão (Usar), janela antes/depois do teste ou botão no card do chat;
 * o que é passivo entra sozinho no cálculo (armadura, passo, crítico com 5…).
 */
import { estadoFurtividade } from "./furtividade.mjs";
import { investigacaoAtiva } from "./investigacao-ativa.mjs";
import { SYSTEM_ID } from "../config.mjs";
import { comoMestre, registrarAcaoDeMestre } from "../ui/socket.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";

const { DialogV2 } = foundry.applications.api;
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const P = (chave, dados) => (dados ? game.i18n.format(`OP2.Poder.${chave}`, dados) : game.i18n.localize(`OP2.Poder.${chave}`));

export const AUTOMACOES = [
  "", "analise", "leituraCombate", "segredoAco", "prontidao", "esquiva", "lobo", "curandeiro", "mentoria",
  "impetoFervilhante", "antecipacao", "sorrateiro", "guardia", "instinto", "heranca", "plano", "arsenal",
];

/** Automações que têm botão "Usar" na ficha. */
export const USAVEIS = ["analise", "curandeiro", "mentoria", "guardia", "plano", "arsenal", "antecipacao"];

export const poderDe = (ator, automacao) => ator?.items?.find((i) => i.type === "habilidade" && i.system.automacao === automacao) ?? null;

async function card(ator, titulo, texto, extra = "") {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-poder-card">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena">${esc(titulo)}</span></header>
      <p class="op2-card__texto">${texto}</p>${extra}</div>`,
    flags: { [SYSTEM_ID]: { tipo: "poder", atorId: ator.id } },
  });
}

async function pagarPD(ator, custo) {
  const pd = ator.system.recursos.pd.value;
  if (pd < custo) {
    ui.notifications.warn(P("SemPD", { custo }));
    return false;
  }
  await ator.update({ "system.recursos.pd.value": pd - custo });
  return true;
}

function escolherAtor(titulo, atores, rotulo) {
  if (!atores.length) return Promise.resolve(null);
  const opcoes = atores.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  return DialogV2.prompt({
    window: { title: titulo },
    classes: ["op2", "op2-ferr-dialogo"],
    content: `<div class="form-group"><label>${esc(rotulo)}</label><select name="alvo">${opcoes}</select></div>`,
    ok: { callback: (_e, b) => b.form.elements.alvo.value },
    rejectClose: false,
  }).then((id) => (id ? game.actors.get(id) : null));
}

const aliados = (ator) => game.actors.filter((a) => a.type === "personagem" && a.id !== ator.id);

/* ================== usar (botão da ficha) ================== */

export async function usarPoder(ator, item) {
  switch (item.system.automacao) {
    case "analise": return ganharMarcadores(ator, item, 2, P("AnaliseAcao"));
    case "curandeiro": return curar(ator, item);
    case "mentoria": return mentorar(ator, item);
    case "guardia": {
      if (!(await pagarPD(ator, 2))) return null;
      return card(ator, item.name, P("GuardiaUso", { nome: esc(ator.name) }));
    }
    case "plano": return planoEstrategico(ator, item);
    case "arsenal": return usarArsenal(ator, item);
    case "antecipacao": {
      if (!(await pagarPD(ator, 2))) return null;
      const combatente = game.combat?.combatants.find((c) => c.actor?.id === ator.id);
      if (combatente) await comoMestre("op2DefinirIniciativa", { combateId: game.combat.id, id: combatente.id, valor: 4 });
      return card(ator, item.name, P("AntecipacaoUso", { nome: esc(ator.name) }));
    }
    default: return null;
  }
}

/* ---- Análise: marcadores (máx. 4), +2 por ação, +1 ao se defender ---- */

export async function ganharMarcadores(ator, item, n, motivo) {
  const atual = item.system.marcadores ?? 0;
  const novo = Math.min(4, atual + n);
  await item.update({ "system.marcadores": novo });
  await card(ator, item.name, P("MarcadoresGanhos", { nome: esc(ator.name), n: novo - atual, total: novo, motivo: esc(motivo) }));
}

/**
 * Depois de rolar: gastar marcadores de análise (±1 por marcador num dado, até o máximo
 * do dado). Também aplica a Mentoria pendente (trocar um dado pela RA do mentor).
 * Mexe direto nos resultados do roll.
 */
export async function ajustarDepoisDaRolagem(ator, roll) {
  const analise = poderDe(ator, "analise");
  const marcadores = analise?.system.marcadores ?? 0;
  const mentoria = ator.system.estado?.mentoria ?? 0;
  if (!marcadores && !mentoria) return;

  const dados = roll.dice.map((termo, i) => ({ i, faces: termo.faces, valor: termo.results[0].result, rotulo: roll.componentes[i]?.rotulo ?? `d${termo.faces}` }));
  const resultado = await new Promise((resolver) => {
    const estado = { valores: dados.map((d) => d.valor), gastos: 0, mentoriaEm: null };
    const linhas = () => dados.map((d) => `
      <div class="op2-analise__dado">
        <span class="op2-analise__rotulo">${esc(d.rotulo)} (d${d.faces})</span>
        ${marcadores ? `<button type="button" data-menos="${d.i}">−</button>` : ""}
        <strong data-valor="${d.i}">${estado.valores[d.i]}</strong>
        ${marcadores ? `<button type="button" data-mais="${d.i}">+</button>` : ""}
        ${mentoria ? `<button type="button" data-mentoria="${d.i}" title="${esc(P("MentoriaTrocar", { ra: mentoria }))}">→ ${mentoria}</button>` : ""}
      </div>`).join("");
    const dialogo = new DialogV2({
      window: { title: P("AjustarTitulo"), icon: "fa-solid fa-magnifying-glass-chart" },
      classes: ["op2", "op2-analise"],
      content: `<p>${marcadores ? P("AnaliseAjuda", { n: marcadores }) : ""} ${mentoria ? P("MentoriaAjuda", { ra: mentoria }) : ""}</p>
        <div class="op2-analise__dados">${linhas()}</div>
        <p class="op2-analise__restantes" data-restantes></p>`,
      buttons: [{ action: "ok", label: P("Confirmar"), default: true }],
      submit: () => resolver(estado),
    });
    dialogo.addEventListener("close", () => resolver(estado), { once: true });
    dialogo.render({ force: true }).then(() => {
      const raiz = dialogo.element;
      const atualizar = () => {
        for (const d of dados) raiz.querySelector(`[data-valor="${d.i}"]`).textContent = estado.valores[d.i];
        const r = raiz.querySelector("[data-restantes]");
        if (r && marcadores) r.textContent = P("MarcadoresRestantes", { n: marcadores - estado.gastos });
      };
      const mexer = (i, delta) => {
        const d = dados[i];
        const novo = Math.max(1, Math.min(d.faces, estado.valores[i] + delta));
        // Cada marcador é ±1; voltar em direção ao valor rolado devolve o marcador.
        const custoAntes = Math.abs(estado.valores[i] - d.valor);
        const custoDepois = Math.abs(novo - d.valor);
        if (estado.gastos - custoAntes + custoDepois > marcadores) return;
        estado.gastos += custoDepois - custoAntes;
        estado.valores[i] = novo;
        atualizar();
      };
      raiz.querySelectorAll("[data-mais]").forEach((b) => b.addEventListener("click", () => mexer(Number(b.dataset.mais), 1)));
      raiz.querySelectorAll("[data-menos]").forEach((b) => b.addEventListener("click", () => mexer(Number(b.dataset.menos), -1)));
      raiz.querySelectorAll("[data-mentoria]").forEach((b) => b.addEventListener("click", () => {
        const i = Number(b.dataset.mentoria);
        estado.mentoriaEm = i;
        estado.valores[i] = Math.min(dados[i].faces, mentoria);
        raiz.querySelectorAll("[data-mentoria]").forEach((x) => { x.disabled = true; });
        atualizar();
      }));
      atualizar();
    });
  });

  roll.dice.forEach((termo, i) => { termo.results[0].result = resultado.valores[i]; });
  if (resultado.gastos && analise) await analise.update({ "system.marcadores": marcadores - resultado.gastos });
  if (resultado.mentoriaEm !== null) await ator.update({ "system.estado.mentoria": 0 });
}

/* ---- Espectro, o lobo: dado do lobo tirou 1 → machucado até o fim da cena ---- */

export async function conferirLobo(ator, roll) {
  const lobo = poderDe(ator, "lobo");
  if (!lobo) return;
  const i = roll.componentes.findIndex((c) => c.chave === `extra.${lobo.id}`);
  if (i < 0 || roll.dice[i]?.results[0]?.result !== 1) return;
  await lobo.update({ "system.machucadoNaCena": true });
  await card(ator, lobo.name, P("LoboMachucado", { nome: esc(ator.name) }));
}

/* ---- Plano Estratégico: rola; aliados recebem +d6 por 3 pontos acima da DT ---- */

async function planoEstrategico(ator, item) {
  if (!(await pagarPD(ator, 3))) return null;
  const { rolarTeste } = await import("../dice/teste.mjs");
  const chave = Object.keys(ator.system.aptidoes ?? {}).find((k) => /guerra/i.test(k) || /guerra/i.test(ator.system.aptidoes[k]?.rotulo ?? "")) ?? "tatica";
  const roll = await rolarTeste(ator, { chavePericia: `aptidao.${chave}`, dt: 7, contexto: item.name });
  if (!roll) return null;
  if (!roll.sucesso) return card(ator, item.name, P("PlanoFalhou", { nome: esc(ator.name) }));
  const n = Math.max(0, Math.floor((roll.total - 7) / 3));
  if (!n) return card(ator, item.name, P("PlanoSemBonus", { nome: esc(ator.name) }));
  const grupo = [ator, ...aliados(ator)];
  for (const a of grupo) await comoMestre("op2DarBonusPlano", { atorId: a.id, n });
  return card(ator, item.name, P("PlanoSucesso", { nome: esc(ator.name), n }));
}

/** Antes do teste: usar dados do Plano Estratégico (d6 cada). Devolve quantos. */
export async function escolherBonusPlano(ator, espaco) {
  const disponiveis = ator.system.estado?.bonusPlano ?? 0;
  if (!disponiveis || espaco <= 0) return 0;
  const max = Math.min(disponiveis, espaco);
  const opcoes = Array.from({ length: max + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join("");
  const n = await DialogV2.prompt({
    window: { title: P("PlanoTitulo"), icon: "fa-solid fa-chess-knight" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: `<p>${P("PlanoPergunta", { n: disponiveis })}</p><div class="form-group"><label>d6</label><select name="n">${opcoes}</select></div>`,
    ok: { label: P("Confirmar"), callback: (_e, b) => Number(b.form.elements.n.value) },
    rejectClose: false,
  });
  const usar = Number(n) || 0;
  if (usar) await ator.update({ "system.estado.bonusPlano": disponiveis - usar });
  return usar;
}

/* ---- Curandeiro: ação + 2 PD, Medicina DT 7, cura = RA; 1×/cena por alvo ---- */

async function curar(ator, item) {
  const jaCurados = new Set(item.system.alvosNaCena ?? []);
  const candidatos = aliados(ator).filter((a) => !jaCurados.has(a.id));
  if (!candidatos.length) return void ui.notifications.warn(P("CurandeiroSemAlvo"));
  const alvo = await escolherAtor(item.name, candidatos, P("Aliado"));
  if (!alvo) return null;
  if (!(await pagarPD(ator, 2))) return null;
  const { rolarTeste } = await import("../dice/teste.mjs");
  const roll = await rolarTeste(ator, { chavePericia: "medicina", dt: 7, contexto: `${item.name} → ${alvo.name}` });
  if (!roll) return null;
  await item.update({ "system.alvosNaCena": [...jaCurados, alvo.id] });
  if (!roll.sucesso) return card(ator, item.name, P("CurandeiroFalhou", { nome: esc(alvo.name) }));
  await comoMestre("op2Curar", { atorId: alvo.id, recurso: "pv", quantidade: roll.ra });
  return card(ator, item.name, P("CurandeiroCurou", { nome: esc(alvo.name), n: roll.ra }));
}

/* ---- Mentoria: ao ajudar, teste DT 7; se passar, o aliado troca um dado pela RA ---- */

async function mentorar(ator, item) {
  const alvo = await escolherAtor(item.name, aliados(ator), P("Aliado"));
  if (!alvo) return null;
  const { rolarTeste } = await import("../dice/teste.mjs");
  const { escolherPericiaSimples } = await import("../ui/ferramentas-testes.mjs");
  const chave = await escolherPericiaSimples(ator, P("MentoriaPericia"));
  if (!chave) return null;
  const roll = await rolarTeste(ator, { chavePericia: chave, dt: 7, contexto: `${item.name} → ${alvo.name}` });
  if (!roll) return null;
  if (!roll.sucesso) return card(ator, item.name, P("MentoriaFalhou", { nome: esc(alvo.name) }));
  await comoMestre("op2DarMentoria", { atorId: alvo.id, ra: roll.ra });
  return card(ator, item.name, P("MentoriaSucesso", { nome: esc(alvo.name), ra: roll.ra }));
}

/* ---- Arsenal de Herborista: três preparados de uso único ---- */

const PREPARADOS = ["tonico", "balsamo", "vespa"];

async function usarArsenal(ator, item) {
  const usados = item.system.arsenal ?? {};
  const restantes = PREPARADOS.filter((p) => !usados[p]);
  if (!restantes.length) return void ui.notifications.warn(P("ArsenalVazio"));
  const botoes = restantes.map((p) => ({ action: p, label: P(`Arsenal.${p}`), icon: p === "vespa" ? "fa-solid fa-bug" : "fa-solid fa-leaf" }));
  const escolha = await DialogV2.wait({
    window: { title: item.name, icon: "fa-solid fa-seedling" },
    classes: ["op2", "op2-dlg"],
    content: `<p>${P("ArsenalPergunta")}</p><ul>${restantes.map((p) => `<li><strong>${P(`Arsenal.${p}`)}:</strong> ${P(`Arsenal.${p}Texto`)}</li>`).join("")}</ul>`,
    buttons: botoes,
    rejectClose: false,
  });
  if (!restantes.includes(escolha)) return null;
  const todos = game.actors.filter((a) => a.type === "personagem" || a.type === "npc");
  const alvo = await escolherAtor(P(`Arsenal.${escolha}`), escolha === "vespa" ? todos.filter((a) => a.id !== ator.id) : todos, P("Alvo"));
  if (!alvo) return null;
  await item.update({ [`system.arsenal.${escolha}`]: true });

  if (escolha === "tonico") {
    await comoMestre("op2AumentoTemporario", { atorId: alvo.id, atributo: "fisico" });
    return card(ator, P("Arsenal.tonico"), P("Arsenal.tonicoUso", { alvo: esc(alvo.name) }));
  }
  if (escolha === "balsamo") {
    const roll = await new Roll("2d4").evaluate();
    const { mostrarDados3D } = await import("../dice/teste.mjs");
    await mostrarDados3D(roll);
    await comoMestre("op2Curar", { atorId: alvo.id, recurso: "pv", quantidade: roll.total });
    const aviso = alvo.id === ator.id ? "" : ` ${P("Arsenal.balsamoParado", { alvo: esc(alvo.name) })}`;
    return card(ator, P("Arsenal.balsamo"), P("Arsenal.balsamoUso", { alvo: esc(alvo.name), n: roll.total }) + aviso);
  }
  // Pote de vespa: Sobrevivência como ataque à distância; dano RA+1.
  const { rolarTeste } = await import("../dice/teste.mjs");
  const roll = await rolarTeste(ator, { chavePericia: "sobrevivencia", dt: 7, contexto: `${P("Arsenal.vespa")} → ${alvo.name}` });
  if (!roll) return null;
  if (!roll.sucesso) return card(ator, P("Arsenal.vespa"), P("Arsenal.vespaErrou", { alvo: esc(alvo.name) }));
  const dano = roll.ra + 1;
  return card(ator, P("Arsenal.vespa"), P("Arsenal.vespaAcertou", { alvo: esc(alvo.name), dano }),
    `<div class="op2-card__acoes"><button type="button" class="op2-botao op2-botao--pequeno op2-botao--perigo" data-op2-gm
      data-op2-acao="aplicar-dano-alvo" data-ator-id="${alvo.id}" data-quantidade="${dano}" data-recurso="pv">${P("AplicarDano", { dano })}</button></div>`);
}

/* ================== Prontidão: rerrolar um dado (2 PD, 1×/rodada) ================== */

/**
 * A rodada que vale agora: combate iniciado, senão cena de furtividade ativa,
 * senão a investigação ativa. Cada cena entra na chave pelo id, para a rodada 1
 * de uma cena nova não parecer a rodada 1 da anterior.
 */
function chaveDaRodada() {
  if (game.combat?.started) return `c${game.combat.id}.${game.combat.round}`;
  const furtividade = estadoFurtividade();
  if (furtividade.ativa) return `f${furtividade.cenaId ?? ""}.${furtividade.rodada}`;
  const investigacao = investigacaoAtiva();
  return `i${investigacao?.id ?? ""}.${investigacao?.system?.rodada ?? 0}`;
}

async function usarProntidao(_autor, dataset) {
  const mensagem = game.messages.get(dataset.mensagemId);
  const roll = mensagem?.rolls?.[0];
  if (!roll?.dados) return;
  // Quem usa: um personagem do usuário que tenha Prontidão.
  const meus = game.actors.filter((a) => a.isOwner && a.type === "personagem" && poderDe(a, "prontidao"));
  const usuario = meus.find((a) => a.id === game.user.character?.id) ?? meus[0];
  if (!usuario) return void ui.notifications.warn(P("ProntidaoSem"));
  const poder = poderDe(usuario, "prontidao");
  const rodada = chaveDaRodada();
  if (poder.system.usadoNaRodada === rodada) return void ui.notifications.warn(P("ProntidaoJaUsou"));

  const elegiveis = roll.dados.filter((d) => !d.pavor && !d.consumido && d.resultado !== 1);
  if (!elegiveis.length) return void ui.notifications.warn(P("ProntidaoSemDado"));
  const opcoes = elegiveis.map((d) => `<option value="${d.indice}">${esc(d.componente?.rotulo ?? d.dado)}: ${d.resultado}</option>`).join("");
  const indice = await DialogV2.prompt({
    window: { title: poder.name, icon: "fa-solid fa-bolt" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: `<p>${P("ProntidaoPergunta", { nome: esc(usuario.name) })}</p><div class="form-group"><select name="d">${opcoes}</select></div>`,
    ok: { label: P("ProntidaoRerrolar"), callback: (_e, b) => Number(b.form.elements.d.value) },
    rejectClose: false,
  });
  if (indice === null || indice === undefined) return;
  if (!(await pagarPD(usuario, 2))) return;
  await poder.update({ "system.usadoNaRodada": rodada });

  const termo = roll.dice[indice];
  const novo = await new Roll(`1d${termo.faces}`).evaluate();
  const { mostrarDados3D, htmlDoTeste } = await import("../dice/teste.mjs");
  await mostrarDados3D(novo);
  const antes = termo.results[0].result;
  termo.results[0].result = novo.total;
  // Recalcula: dados voltam a valer; o pavor (se houver) anula de novo os menores.
  for (const t of roll.dice) for (const r of t.results) { r.active = true; r.discarded = false; }
  roll.options.consumidos = [];
  roll.aplicarPavor();
  if (roll.precisaSelecao) roll.aplicarSelecao(roll.selecaoSugerida());
  roll._total = roll.resultado.total;
  const dono = game.actors.get(roll.options.atorId);
  const html = await htmlDoTeste(roll, dono ?? usuario);
  const nota = `<p class="op2-prontidao-nota"><i class="fa-solid fa-bolt"></i> ${P("ProntidaoNota", { nome: esc(usuario.name), antes, depois: novo.total })}</p>`;
  await comoMestre("op2AtualizarMensagem", { id: mensagem.id, content: html + nota, rolls: [JSON.stringify(roll.toJSON())] });
}

/* ================== fim de cena ================== */

/** Encerrar a cena: Ímpeto esvazia (Fervilhante já começa com 1), marcadores somem… */
export async function encerrarCenaDosPoderes(atores) {
  for (const ator of atores) {
    const fervilhante = Boolean(poderDe(ator, "impetoFervilhante"));
    for (const item of ator.items.filter((i) => i.type === "habilidade")) {
      const s = item.system;
      const mudancas = {};
      if (s.impeto?.espacos > 0) mudancas["system.impeto.preenchidos"] = fervilhante ? 1 : 0;
      if (s.automacao === "analise" && s.marcadores) mudancas["system.marcadores"] = 0;
      if (s.automacao === "lobo" && s.machucadoNaCena) mudancas["system.machucadoNaCena"] = false;
      if (s.automacao === "curandeiro" && s.alvosNaCena?.length) mudancas["system.alvosNaCena"] = [];
      if (Object.keys(mudancas).length) await item.update(mudancas);
    }
    if (ator.system.estado?.bonusPlano) await ator.update({ "system.estado.bonusPlano": 0 });
  }
}

/* ================== registro ================== */

export function registrarPoderes() {
  registrarAcaoDeChat("prontidao", usarProntidao);
  registrarAcaoDeMestre("op2Curar", async ({ atorId, recurso, quantidade }) => {
    const a = game.actors.get(atorId);
    if (!a) return;
    const r = a.system.recursos[recurso];
    await a.update({ [`system.recursos.${recurso}.value`]: Math.min(r.max, r.value + quantidade) });
  });
  registrarAcaoDeMestre("op2AumentoTemporario", async ({ atorId, atributo }) => {
    const a = game.actors.get(atorId);
    if (!a?.system?.estado?.aumentosTemporarios) return;
    await a.update({ [`system.estado.aumentosTemporarios.${atributo}`]: (a.system.estado.aumentosTemporarios[atributo] ?? 0) + 1 });
  });
  registrarAcaoDeMestre("op2DarBonusPlano", async ({ atorId, n }) => {
    const a = game.actors.get(atorId);
    if (a?.system?.estado) await a.update({ "system.estado.bonusPlano": (a.system.estado.bonusPlano ?? 0) + n });
  });
  registrarAcaoDeMestre("op2DarMentoria", async ({ atorId, ra }) => {
    const a = game.actors.get(atorId);
    if (a?.system?.estado) await a.update({ "system.estado.mentoria": ra });
  });
  registrarAcaoDeMestre("op2AtualizarMensagem", async ({ id, content, rolls }) => {
    await game.messages.get(id)?.update({ content, rolls });
  });
  registrarAcaoDeMestre("op2DefinirIniciativa", async ({ combateId, id, valor }) => {
    await game.combats.get(combateId)?.combatants.get(id)?.update({ initiative: valor });
  });
}

