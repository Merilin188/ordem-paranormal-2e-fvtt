/**
 * Cena de furtividade (Contos da Vigília, p. 55–56): painel compartilhado com os
 * dados de esconderijo de cada personagem, fase dos personagens e fase das
 * criaturas, tabela de ações das criaturas, vinheta na tela e as animações de
 * dado perdido e de personagem encontrado.
 *
 * O estado mora num setting de mundo (só o mestre grava). O jogador rola no
 * próprio cliente e pede a gravação pela ponte `comoMestre()`. O `onChange` do
 * setting roda em todos os clientes: re-renderiza o painel, liga a vinheta e
 * dispara as animações do evento novo.
 */
import { EFEITOS, precarregarEfeitos } from "../ui/terror.mjs";
import { SYSTEM_ID } from "../config.mjs";
import { comoMestre, registrarAcaoDeMestre, paraTodos, registrarAcaoDeTodos } from "../ui/socket.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";
import { iconeResultado } from "../ui/dice-icons.mjs";
import {
  TABELA_CRIATURAS, dtPorUsos, formulaPeloMaiorDado, dadosAtivos, encontrado,
  aplicarBusca, perderDado, limparPerdidos, facesDe,
} from "./furtividade-regras.mjs";
import { listarCenas, obterCena, novaCena, ConfigCenaApp, linhaDaTabela } from "./cenas-config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const CHAVE = "furtividade";
const L = (k, d) => (d ? game.i18n.format(`OP2.Furtividade.${k}`, d) : game.i18n.localize(`OP2.Furtividade.${k}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const ANONIMO = "icons/svg/mystery-man.svg";

/* -- estado ----------------------------------------------------------------- */

const VAZIO = () => ({
  ativa: false, rodada: 1, fase: "personagens", participantes: [], criaturas: [],
  usosDistrair: 0, acaoRolada: false, evento: null,
});

export function estadoFurtividade() {
  let salvo = {};
  try { salvo = game.settings.get(SYSTEM_ID, CHAVE) ?? {}; } catch { /* antes do init */ }
  const e = { ...VAZIO(), ...foundry.utils.deepClone(salvo) };
  e.config ??= obterCena("furtividade");
  return e;
}

/** DT das ações especiais pela cena configurada. */
const dtDe = (e, usos) => dtPorUsos(usos, Number(e.config?.dtBase ?? 7), Number(e.config?.dtPasso ?? 3));
/** Texto da linha da tabela: o configurado ou o padrão traduzido. */
const textoDaLinha = (config, n) => linhaDaTabela(config, n)?.texto || L(`Tabela.${n}`);
const ator = (uuid) => fromUuidSync(uuid);
const nomeDe = (uuid) => ator(uuid)?.name ?? "?";

/** Nome de quem procura no card (anônimo se alguma criatura está oculta). */
function quemProcura(estado) {
  const criaturas = estado.criaturas ?? [];
  if (!criaturas.length || criaturas.some((c) => c.oculta)) return L("Algo");
  return criaturas.map((c) => nomeDe(c.uuid)).join(", ");
}

/* -- operações do mestre ------------------------------------------------------ */

let fila = Promise.resolve();

async function gravar(estado, eventoId = null) {
  if (eventoId) estado.participantes = estado.participantes.map((p) => limparPerdidos(p, eventoId));
  await game.settings.set(SYSTEM_ID, CHAVE, estado);
}

const OPS = {
  iniciar(e, { configId } = {}) {
    e.config = obterCena("furtividade", configId);
    Object.assign(e, { ativa: true, cenaId: foundry.utils.randomID(), rodada: 1, fase: "personagens", usosDistrair: 0, acaoRolada: false, evento: null });
    e.participantes = e.participantes.map((p) => ({ ...p, dados: [], testou: false, usosEsconder: 0, agiu: false }));
  },
  encerrar(e) { e.ativa = false; e.evento = null; },
  adicionar(e, { uuid, papel }) {
    if (e.participantes.some((p) => p.uuid === uuid) || e.criaturas.some((c) => c.uuid === uuid)) return;
    if (papel === "criatura") e.criaturas.push({ uuid, oculta: false });
    else e.participantes.push({ uuid, dados: [], testou: false, usosEsconder: 0 });
  },
  remover(e, { uuid }) {
    e.participantes = e.participantes.filter((p) => p.uuid !== uuid);
    e.criaturas = e.criaturas.filter((c) => c.uuid !== uuid);
  },
  agiu(e, { uuid }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p) p.agiu = !p.agiu;
  },
  ocultar(e, { uuid }) {
    const c = e.criaturas.find((x) => x.uuid === uuid);
    if (c) c.oculta = !c.oculta;
  },
  dadoExtra(e, { uuid, dado, valor }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p) p.dados = [...(p.dados ?? []), { id: foundry.utils.randomID(), dado, valor }];
  },
  esconderijo(e, { uuid, dados }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (!p) return;
    p.dados = dados.map((d) => ({ id: foundry.utils.randomID(), dado: d.dado, valor: d.valor }));
    p.testou = true;
  },
  uso(e, { uuid, tipo }) {
    if (tipo === "distrair") e.usosDistrair = (e.usosDistrair ?? 0) + 1;
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (p && tipo === "esconder") p.usosEsconder = (p.usosEsconder ?? 0) + 1;
  },
  ganhar(e, { uuid, dado, valor }) {
    const p = e.participantes.find((x) => x.uuid === uuid);
    if (!p) return;
    p.dados.push({ id: foundry.utils.randomID(), dado, valor });
    p.testou = true;
  },
  transferir(e, { de, para, dadoId }, eventoId) {
    const origem = e.participantes.find((x) => x.uuid === de);
    const destino = e.participantes.find((x) => x.uuid === para);
    const dado = origem?.dados.find((d) => d.id === dadoId && !d.perdido);
    if (!dado || !destino) return;
    origem.dados = origem.dados.filter((d) => d.id !== dadoId);
    destino.dados.push({ ...dado, id: foundry.utils.randomID() });
    destino.testou = true;
    // Deu o último dado: quem chamou a atenção foi encontrado.
    if (!dadosAtivos(origem).length) {
      e.evento = { id: eventoId, perdas: [], descobertos: [de] };
      return true;
    }
  },
  perder(e, { uuid, dadoId }, eventoId) {
    const i = e.participantes.findIndex((x) => x.uuid === uuid);
    if (i < 0) return;
    const antes = dadosAtivos(e.participantes[i]).length;
    const dado = e.participantes[i].dados.find((d) => d.id === dadoId);
    e.participantes[i] = perderDado(e.participantes[i], dadoId, eventoId);
    e.evento = {
      id: eventoId, perdas: dado ? [{ uuid, ...dado }] : [],
      descobertos: antes > 0 && dadosAtivos(e.participantes[i]).length === 0 ? [uuid] : [],
    };
    return true;
  },
  busca(e, { valores, alvos = null }, eventoId) {
    const r = aplicarBusca(e.participantes, valores, eventoId, alvos);
    e.participantes = r.participantes;
    e.evento = { id: eventoId, perdas: r.perdas, descobertos: r.descobertos, valores };
    return r;
  },
};

/** Executa uma operação no cliente do mestre, em fila (duas ao mesmo tempo perdiam escrita). */
function executar({ op, ...dados }) {
  const resultado = fila.then(async () => {
    if (op === "acaoCriaturas") return executarTabela(dados.valor);
    if (op === "linha") return executarLinha(dados.valor);
    if (op === "avancar") return avancarFase();
    if (op === "procurar") return procurar(dados);
    const estado = estadoFurtividade();
    const eventoId = foundry.utils.randomID();
    const novoEvento = OPS[op]?.(estado, dados, eventoId);
    await gravar(estado, novoEvento ? eventoId : null);
    if (novoEvento && ["perder", "transferir"].includes(op) && estado.evento?.descobertos?.length) await cardDescobertos(estado.evento.descobertos);
  });
  fila = resultado.catch((erro) => console.error(`${SYSTEM_ID} | furtividade`, erro));
  return resultado.catch(() => false);
}

const pedir = (op, dados = {}) => comoMestre("op2Furtividade", { op, ...dados });

/* -- criaturas (cliente do mestre) ------------------------------------------- */

async function rolar(formula, opcoes = {}) {
  const roll = await new Roll(formula).evaluate();
  const { mostrarDados3D } = await import("../dice/teste.mjs");
  await mostrarDados3D(roll, opcoes);
  return roll;
}

const valoresDe = (roll) => roll.dice.flatMap((d) => d.results.map((r) => r.result));

async function card(html, extra = {}) {
  await ChatMessage.create({
    content: `<div class="op2 op2-card op2-furt-card">${html}</div>`,
    speaker: { alias: L("Titulo") },
    flags: { [SYSTEM_ID]: { tipo: "furtividade" } },
    ...extra,
  });
}

async function cardDescobertos(uuids) {
  if (!uuids.length) return;
  await card(uuids.map((u) => `<p class="op2-furt-card__encontrado"><i class="fa-solid fa-skull"></i> ${esc(L("FoiEncontrado", { nome: nomeDe(u) }))}</p>`).join(""));
}

/** Busca: rola, descarta os dados iguais e conta no chat. */
async function buscar(formula, alvos = null, valoresProntos = null) {
  const estado = estadoFurtividade();
  const valores = valoresProntos ?? valoresDe(await rolar(formula));
  const eventoId = foundry.utils.randomID();
  const r = OPS.busca(estado, { valores, alvos }, eventoId);
  await gravar(estado, eventoId);

  const chips = valores.map((v) => `<span class="op2-furt-card__valor">${v}</span>`).join("");
  const perdas = {};
  for (const p of r.perdas) (perdas[p.uuid] ??= []).push(`${p.dado}:${p.valor}`);
  const linhas = Object.entries(perdas)
    .map(([u, l]) => `<li>${esc(L("Perdeu", { nome: nomeDe(u), dados: l.join(", ") }))}</li>`).join("");
  const alvoTxt = alvos ? alvos.map(nomeDe).join(", ") : L("Todos");
  await card(`
    <h3>${esc(L("Procura", { quem: quemProcura(estado), alvo: alvoTxt }))}</h3>
    <p class="op2-furt-card__valores">${formula ? `<small>${esc(formula)}</small>` : ""}${chips}</p>
    ${linhas ? `<ul>${linhas}</ul>` : `<p>${esc(L("NinguemPerdeu"))}</p>`}`);
  await cardDescobertos(r.descobertos);
}

/** Anuncia o resultado do d10. A ação só acontece quando o mestre clica no card. */
async function executarTabela(valor) {
  const estado = estadoFurtividade();
  const linha = linhaDaTabela(estado.config, valor);
  if (!linha) return;
  estado.acaoRolada = true;
  await gravar(estado);
  mostrarTabelaMestre(valor);
  const botao = linha.tipo === "nada" ? "" : `
    <div class="op2-furt-card__executar">
      <button type="button" class="op2-botao op2-botao--pequeno op2-botao--perigo" data-op2-gm data-op2-furt-executar="${valor}">
        <i class="fa-solid fa-play"></i> ${esc(L("Executar"))}</button>
      <p class="op2-dica">${esc(L("AguardandoMestre"))}</p>
    </div>`;
  await card(`<h3>${esc(L("AcaoTitulo", { valor }))}</h3><p>${esc(textoDaLinha(estado.config, valor))}</p>${botao}`);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** A lista que acende de cima para baixo, desacelera e para em `final`. Roda em todos os clientes. */
export async function animarSorteio({ itens, final, passos, titulo = null }) {
  document.getElementById("op2-sorteio-tela")?.remove();
  const tela = document.createElement("div");
  tela.id = "op2-sorteio-tela";
  tela.className = "op2 op2-sorteio-tela";
  tela.innerHTML = `<div class="op2-sorteio-tela__caixa">
    <h3>${esc(titulo ?? L("SorteioTitulo"))}</h3>
    <ul class="op2-furt-sorteio__lista">${itens.map((p) => `<li><img src="${esc(p.img)}" alt=""><span>${esc(p.nome)}</span></li>`).join("")}</ul>
  </div>`;
  document.body.append(tela);
  const linhas = [...tela.querySelectorAll("li")];
  const atrasos = Array.from({ length: passos }, (_, passo) => 70 + 380 * (passo / passos) ** 2.2);
  tocarBatimento((atrasos.reduce((t, x) => t + x, 0) + 1500) / 1000);
  for (let passo = 0; passo < passos; passo++) {
    linhas.forEach((el, j) => el.classList.toggle("aceso", j === passo % linhas.length));
    await espera(atrasos[passo]);
  }
  linhas[final]?.classList.add("escolhido");
  await espera(1800);
  tela.classList.add("saindo");
  setTimeout(() => tela.remove(), 600);
}

/**
 * Sorteio do alvo: o mestre abre a lista dos personagens ainda escondidos e clica
 * em Sortear; a animação roda na tela de todos. Só nomes, nada de dados.
 */
async function sortearAlvo(estado) {
  const candidatos = estado.participantes.filter((p) => dadosAtivos(p).length);
  if (!candidatos.length) {
    ui.notifications.info(L("NinguemEscondido"));
    return null;
  }
  const itens = candidatos.map((p) => ({ nome: ator(p.uuid)?.name ?? "?", img: ator(p.uuid)?.img ?? ANONIMO }));
  const lista = itens.map((p) => `<li><img src="${esc(p.img)}" alt=""><span>${esc(p.nome)}</span></li>`).join("");
  const ok = await DialogV2.confirm({
    window: { title: L("SorteioTitulo"), icon: "fa-solid fa-shuffle" },
    classes: ["op2", "op2-furt-sorteio"],
    position: { width: 380 },
    content: `<p class="op2-dica">${esc(L("SorteioAjuda"))}</p><ul class="op2-furt-sorteio__lista">${lista}</ul>`,
    yes: { label: L("Sortear"), icon: "fa-solid fa-dice" },
    no: { label: L("Cancelar") },
    rejectClose: false,
  });
  if (!ok) return null;
  const final = Math.floor(Math.random() * itens.length);
  const passos = itens.length * Math.max(3, Math.ceil(12 / itens.length)) + final + 1;
  const sorteio = { itens, final, passos };
  paraTodos("op2FurtSorteio", sorteio);
  await animarSorteio(sorteio);
  return candidatos[final];
}

/** Executa a linha da tabela (clique do mestre no card). false = cancelado. */
async function executarLinha(valor) {
  const estado = estadoFurtividade();
  const linha = linhaDaTabela(estado.config, valor);
  if (!linha) return false;
  if (linha.tipo === "todos") {
    await buscar(linha.formula);
    return true;
  }
  if (linha.tipo === "numeros") {
    const valores = await DialogV2.prompt({
      window: { title: L("DoisNumeros") },
      content: `<p>${esc(L("DoisNumerosAjuda"))}</p>
        <div class="op2-furt-numeros"><input type="number" name="a" min="1" max="12" value="1">
        <input type="number" name="b" min="1" max="12" value="2"></div>`,
      ok: { callback: (_e, b) => [Number(b.form.elements.a.value), Number(b.form.elements.b.value)] },
      rejectClose: false,
    });
    if (!valores) return false;
    await buscar(null, null, valores.filter(Boolean));
    return true;
  }
  if (linha.tipo !== "um" && linha.tipo !== "sopro") return true;
  const alvo = await sortearAlvo(estado);
  if (!alvo) return false;
  const doc = ator(alvo.uuid);
  await card(`<h3 class="op2-furt-card__alvo">${esc(L(`Alvo.${valor}`, { nome: doc?.name ?? "?" }))}</h3>`);
  if (linha.tipo === "um") {
    await buscar(formulaPeloMaiorDado(dadosAtivos(alvo), linha.formulas), [alvo.uuid]);
    return true;
  }
  await card(`<p>${esc(L("SoproPara", { nome: doc?.name ?? "?" }))}</p><p>${esc(L("SoproAjuda"))}</p>
    <div class="op2-furt-card__botoes">
      <button type="button" class="op2-botao op2-botao--pequeno" data-op2-acao="furtividade-sopro" data-ator-id="${doc?.id}" data-escolha="parado">${esc(L("SoproParado"))}</button>
      <button type="button" class="op2-botao op2-botao--pequeno" data-op2-acao="furtividade-sopro" data-ator-id="${doc?.id}" data-escolha="sair">${esc(L("SoproSair"))}</button>
    </div>`);
  return true;
}

/** Botão "Executar ação" do card da tabela: só o mestre, uma vez. */
function ligarBotaoExecutar(msg, html) {
  for (const botao of html.querySelectorAll("[data-op2-furt-executar]")) {
    botao.addEventListener("click", async (evento) => {
      evento.preventDefault();
      if (!game.user.isGM) return;
      botao.disabled = true;
      const feito = `<p class="op2-dica"><i class="fa-solid fa-check"></i> ${esc(L("Executada"))}</p></div>`;
      // Só marca como executada depois que a ação aconteceu: fechar o sorteio ou os dois números devolve o botão.
      const ok = await executar({ op: "linha", valor: Number(botao.dataset.op2FurtExecutar) });
      if (ok === false) return void (botao.disabled = false);
      await msg.update({ content: msg.content.replace(/<div class="op2-furt-card__executar">[\s\S]*$/, feito) });
    });
  }
}

/** A tabela Ações das Criaturas, só na tela do mestre, com a linha rolada acesa. */
let janelaTabela = null;
export function mostrarTabelaMestre(valor = null) {
  if (!game.user.isGM) return;
  const config = estadoFurtividade().config;
  const linhas = Object.keys(TABELA_CRIATURAS).map((n) => `
    <tr class="${Number(n) === valor ? "op2-tabela__sorteada" : ""}">
      <td class="op2-tabela__faixa">${n}</td><td>${esc(textoDaLinha(config, n))}</td></tr>`).join("");
  janelaTabela?.close();
  janelaTabela = new DialogV2({
    window: { title: L("TabelaTitulo"), icon: "fa-solid fa-dice-d10" },
    classes: ["op2", "op2-furt-tabela"],
    position: { width: 560 },
    content: `<p class="op2-dica">${esc(valor ? L("TabelaRolado", { valor }) : L("TabelaAjuda"))}</p>
      <div class="op2-tabela__linhas"><table><thead><tr><th>d10</th><th>${esc(L("TabelaAcao"))}</th></tr></thead><tbody>${linhas}</tbody></table></div>`,
    buttons: [{ action: "ok", label: L("Fechar"), default: true }],
  });
  janelaTabela.render({ force: true });
}

async function procurar({ formula, alvo }) {
  if (!formula || !Roll.validate(formula)) return void ui.notifications.warn(L("FormulaInvalida"));
  await buscar(formula, alvo ? [alvo] : null);
}

/** Passa de fase. Do fim da fase das criaturas para a próxima rodada: 1d6 em quem foi encontrado. */
async function avancarFase() {
  const estado = estadoFurtividade();
  if (estado.fase === "personagens") {
    estado.fase = "criaturas";
    estado.acaoRolada = false;
    return gravar(estado);
  }
  const { aplicarDano } = await import("../dice/falha-critica.mjs");
  for (const p of estado.participantes.filter(encontrado)) {
    const doc = ator(p.uuid);
    if (!doc) continue;
    const roll = await rolar(Roll.validate(estado.config?.danoEncontrado ?? "") ? estado.config.danoEncontrado : "1d6");
    await aplicarDano(doc, roll.total, "pv");
    await card(`<p class="op2-furt-card__encontrado"><i class="fa-solid fa-hand-back-fist"></i> ${esc(L("DanoEncontrado", { nome: doc.name, n: roll.total }))}</p>`);
  }
  Object.assign(estado, { fase: "personagens", rodada: estado.rodada + 1, acaoRolada: false });
  estado.participantes = estado.participantes.map((p) => ({ ...p, agiu: false }));
  await gravar(estado);
}

/* -- ações do jogador (no cliente dele) --------------------------------------- */

async function escolherDado(dados, titulo) {
  if (!dados.length) return null;
  if (dados.length === 1) return dados[0];
  const escolha = await DialogV2.wait({
    window: { title: titulo },
    content: `<p>${esc(L("EscolhaDado"))}</p>`,
    buttons: dados.map((d, i) => ({ action: String(i), label: `${d.dado}: ${d.valor}` })),
    rejectClose: false,
  });
  return escolha === null || escolha === undefined ? null : dados[Number(escolha)] ?? null;
}

async function escolherAliado(estado, excluir, incluirSiMesmo = false) {
  const opcoes = estado.participantes.filter((p) => incluirSiMesmo || p.uuid !== excluir);
  if (!opcoes.length) return null;
  if (opcoes.length === 1) return opcoes[0].uuid;
  return DialogV2.prompt({
    window: { title: L("EscolhaAliado") },
    content: `<select name="alvo">${opcoes.map((p) => `<option value="${p.uuid}">${esc(nomeDe(p.uuid))}</option>`).join("")}</select>`,
    ok: { callback: (_e, b) => b.form.elements.alvo.value },
    rejectClose: false,
  });
}

const dadosDoRoll = (roll) => roll.dadosDoTeste.map((d) => ({ dado: d.dado, valor: d.resultado }));

async function testeDeEsconderijo(doc) {
  const { escolherPericia } = await import("../dice/pericia-dialog.mjs");
  const chave = await escolherPericia(doc, { titulo: L("TesteEsconderijo"), ajuda: L("TesteEsconderijoAjuda"), mostrarAtributo: true });
  if (!chave) return;
  const { rolarTeste } = await import("../dice/teste.mjs");
  const roll = await rolarTeste(doc, { chavePericia: chave, semDT: true, contexto: L("TesteEsconderijo"), ocultoDoMestre: true });
  if (!roll) return;
  const dados = dadosDoRoll(roll);
  // Crítico: rola mais um dado igual a um dos do teste e ele também vira esconderijo.
  if (roll.resultado?.critico) {
    const { dadoDoCritico } = await import("../dice/critico-extra.mjs");
    const faces = dadoDoCritico(roll.dados);
    const extra = await rolar(`1d${faces}`, { ocultoDoMestre: true });
    dados.push({ dado: `d${faces}`, valor: extra.total });
  }
  // Dados de esconderijo guardados (a runa invocada fora da cena) entram agora.
  const guardados = doc.getFlag(SYSTEM_ID, "esconderijoGuardado") ?? [];
  if (guardados.length) {
    dados.push(...guardados);
    await doc.unsetFlag(SYSTEM_ID, "esconderijoGuardado");
  }
  await pedir("esconderijo", { uuid: doc.uuid, dados });
}

/**
 * Um dado de esconderijo ganho fora do teste (a Runa de Brenna: 1d10). Com a cena de
 * furtividade em andamento e o personagem nela, entra na hora; senão fica guardado
 * e entra no próximo teste de esconderijo. Devolve "cena" ou "guardado".
 */
export async function ganharDadoDeEsconderijo(doc, { dado, valor }) {
  const e = estadoFurtividade();
  if (e.ativa && e.participantes?.some((p) => p.uuid === doc.uuid)) {
    await pedir("dadoExtra", { uuid: doc.uuid, dado, valor });
    return "cena";
  }
  const atuais = doc.getFlag(SYSTEM_ID, "esconderijoGuardado") ?? [];
  await doc.setFlag(SYSTEM_ID, "esconderijoGuardado", [...atuais, { dado, valor }]);
  return "guardado";
}

async function acaoComTeste(doc, { chave, dt, uso, titulo }) {
  const { rolarTeste } = await import("../dice/teste.mjs");
  const roll = await rolarTeste(doc, { chavePericia: chave, dt, contexto: titulo, ocultoDoMestre: true });
  if (!roll) return null;
  await pedir("uso", { uuid: doc.uuid, tipo: uso });
  return roll.resultado?.sucesso ? roll : null;
}

const ACOES_JOGADOR = {
  async teste(doc) { await testeDeEsconderijo(doc); },
  async esconder(doc, estado, p) {
    const roll = await acaoComTeste(doc, { chave: "furtividade", dt: dtDe(estado, p.usosEsconder), uso: "esconder", titulo: L("Esconder") });
    if (!roll) return;
    const d = await escolherDado(dadosDoRoll(roll), L("Esconder"));
    if (d) await pedir("ganhar", { uuid: doc.uuid, ...d });
  },
  async distrair(doc, estado) {
    const roll = await acaoComTeste(doc, { chave: "enganacao", dt: dtDe(estado, estado.usosDistrair), uso: "distrair", titulo: L("Distrair") });
    if (!roll) return;
    const d = await escolherDado(dadosDoRoll(roll), L("Distrair"));
    const alvo = d && await escolherAliado(estado, doc.uuid, true);
    if (alvo) await pedir("ganhar", { uuid: alvo, ...d });
  },
  async chamar(doc, estado, p) {
    const meus = dadosAtivos(p);
    if (!meus.length) return void ui.notifications.warn(L("SemDados"));
    const alvo = await escolherAliado(estado, doc.uuid);
    if (!alvo) return;
    const dado = await escolherDado(meus, L("Transferir"));
    if (!dado) return;
    await pedir("transferir", { de: doc.uuid, para: alvo, dadoId: dado.id });
    const resto = meus.filter((d) => d.id !== dado.id);
    const descarte = await escolherDado(resto, L("Descartar"));
    if (descarte) await pedir("perder", { uuid: doc.uuid, dadoId: descarte.id });
  },
  async chamativa(doc, _estado, p) {
    const dado = await escolherDado(dadosAtivos(p), L("Chamativa"));
    if (dado) await pedir("perder", { uuid: doc.uuid, dadoId: dado.id });
  },
};

async function soproNaNuca(doc, dataset) {
  if (!doc.isOwner) return void ui.notifications.warn(L("SoproNaoEhVoce", { nome: doc.name }));
  const sair = dataset.escolha === "sair";
  // Sair de perto: escolhe o dado antes; fechar a janela não gasta a escolha.
  let dado = null;
  if (sair) {
    const p = estadoFurtividade().participantes.find((x) => x.uuid === doc.uuid);
    dado = await escolherDado(dadosAtivos(p), L("SoproSair"));
    if (!dado) return;
  }
  // O card do sopro vira "Ação executada" (mensagem do mestre: passa pela ponte).
  const mensagem = game.messages.get(dataset.mensagemId);
  if (mensagem) {
    const feito = `<p class="op2-dica"><i class="fa-solid fa-check"></i> ${esc(L("Executada"))}</p></div>`;
    await comoMestre("op2AtualizarMensagem", { id: mensagem.id, content: mensagem.content.replace(/<div class="op2-furt-card__botoes">[\s\S]*$/, feito) });
  }
  await card(`<p><strong>${esc(L(sair ? "SoproEscolheuSair" : "SoproEscolheuParado", { nome: doc.name }))}</strong></p>`);
  if (sair) return void await pedir("perder", { uuid: doc.uuid, dadoId: dado.id });
  const roll = await rolar("2d6");
  const { aplicarDano } = await import("../dice/falha-critica.mjs");
  await aplicarDano(doc, roll.total, "pd");
  await card(`<p>${esc(L("SoproPerdeuPD", { nome: doc.name, n: roll.total }))}</p>`);
}

/* -- painel ------------------------------------------------------------------- */

/** Eventos cuja animação este cliente já mostrou. */
const animados = new Set();

export class FurtividadeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-furtividade",
    classes: ["op2", "op2-furtividade"],
    window: { title: "OP2.Furtividade.Titulo", icon: "fa-solid fa-eye-slash", resizable: true },
    position: { width: 520, height: 620 },
    actions: {
      iniciar: FurtividadeApp.#iniciar,
      novaCena: FurtividadeApp.#novaCena,
      configurar: FurtividadeApp.#configurar,
      encerrar: FurtividadeApp.#encerrar,
      avancar: () => pedir("avancar"),
      rolarAcao: FurtividadeApp.#rolarAcao,
      procurar: FurtividadeApp.#procurar,
      ocultar: (_e, alvo) => pedir("ocultar", { uuid: alvo.dataset.uuid }),
      remover: (_e, alvo) => pedir("remover", { uuid: alvo.dataset.uuid }),
      descartar: FurtividadeApp.#descartar,
      ficha: (_e, alvo) => ator(alvo.dataset.uuid)?.sheet?.render(true),
      jogador: FurtividadeApp.#jogador,
      agiu: (_e, alvo) => pedir("agiu", { uuid: alvo.dataset.uuid }),
      tabela: () => mostrarTabelaMestre(),
    },
  };

  static PARTS = { corpo: { template: "systems/ordem-paranormal-2e/templates/cena/furtividade.hbs" } };

  /** Cena configurada escolhida no seletor (antes de iniciar). */
  configId = null;

  static async #iniciar() {
    await pedir("iniciar", { configId: this.configId });
  }

  static async #novaCena() {
    const id = await novaCena("furtividade");
    if (id) this.configId = id;
    this.render();
  }

  static #configurar() {
    new ConfigCenaApp("furtividade", this.configId).render({ force: true });
  }

  async _prepareContext() {
    const e = estadoFurtividade();
    const gm = game.user.isGM;
    const eventoId = e.evento?.id;
    const animar = eventoId && !animados.has(eventoId);
    const criaturas = e.criaturas.map((c) => {
      const doc = ator(c.uuid);
      const anonima = c.oculta && !gm;
      return {
        uuid: c.uuid, oculta: c.oculta,
        nome: anonima ? L("Anonima") : doc?.name ?? "?",
        img: anonima ? ANONIMO : doc?.img ?? ANONIMO,
      };
    });
    const participantes = e.participantes.map((p) => {
      const doc = ator(p.uuid);
      // O mestre não vê valor, forma nem quantidade dos dados de esconderijo.
      const dados = gm ? [] : p.dados
        .filter((d) => !d.perdido || (animar && d.perdido === eventoId))
        .map((d) => ({ id: d.id, sumindo: !!d.perdido, html: iconeResultado({ dado: d.dado, resultado: d.valor }) }));
      return {
        uuid: p.uuid, nome: doc?.name ?? "?", img: doc?.img ?? ANONIMO,
        dono: !gm && !!doc?.isOwner, podeMarcar: gm || !!doc?.isOwner, agiu: !!p.agiu,
        dados, testou: p.testou,
        encontrado: encontrado(p), dtEsconder: dtDe(e, p.usosEsconder),
      };
    });
    return {
      gm, ativa: e.ativa, rodada: e.rodada, criaturasFase: e.fase === "criaturas",
      podeRolarAcao: e.ativa && e.fase === "criaturas" && (gm || !e.acaoRolada),
      dtDistrair: dtDe(e, e.usosDistrair), criaturas, participantes,
      nomeCena: e.config?.nome,
      cenas: listarCenas("furtividade").map((c) => ({ id: c.id, nome: c.nome, sel: c.id === (this.configId ??= listarCenas("furtividade")[0]?.id) })),
      vazio: !criaturas.length && !participantes.length,
    };
  }

  get _dragDrop() {
    return this._op2DragDrop ??= new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".op2-furt",
      permissions: { drop: () => game.user.isGM },
      callbacks: { drop: this.#aoSoltar.bind(this) },
    });
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    this._dragDrop.bind(this.element);
    this.element.querySelector("[data-seletor-cena]")?.addEventListener("change", (ev) => {
      this.configId = ev.target.value;
    });
    const eventoId = estadoFurtividade().evento?.id;
    if (eventoId && this.element.querySelector(".op2-furt__dado--sumindo")) {
      setTimeout(() => animados.add(eventoId), 2200);
    }
  }

  async #aoSoltar(evento) {
    let dados;
    try { dados = JSON.parse(evento.dataTransfer.getData("text/plain")); } catch { return; }
    if (dados?.type !== "Actor") return;
    const doc = await fromUuid(dados.uuid);
    if (!doc) return;
    const papel = evento.target.closest("[data-zona]")?.dataset.zona
      ?? (doc.type === "personagem" ? "personagem" : "criatura");
    await pedir("adicionar", { uuid: doc.uuid, papel });
  }

  static async #encerrar() {
    const ok = await DialogV2.confirm({ window: { title: L("Encerrar") }, content: `<p>${esc(L("EncerrarPergunta"))}</p>`, rejectClose: false });
    if (ok) await pedir("encerrar");
  }

  static async #rolarAcao() {
    const roll = await rolar("1d10");
    await pedir("acaoCriaturas", { valor: roll.total });
  }

  static async #procurar(_e, alvo) {
    const e = estadoFurtividade();
    const doc = ator(alvo.dataset.uuid);
    const fichas = Object.entries({ ...(doc?.system?.atributos ?? {}), ...(doc?.system?.pericias ?? {}) })
      .filter(([, v]) => v?.die)
      .map(([k, v]) => ({ rotulo: v.rotulo || game.i18n.localize(`OP2.Atributo.${k}`), faces: facesDe(v.die) }));
    const presets = ["1d6", "1d8", "1d10", "1d12", "2d6", "2d8", "2d10", "3d6", "3d8"];
    const opcoesFicha = fichas.flatMap((f) => [1, 2, 3].map((n) => `<option value="${n}d${f.faces}">${n}d${f.faces} — ${esc(f.rotulo)}</option>`)).join("");
    const resposta = await DialogV2.prompt({
      window: { title: L("ProcurarTitulo", { nome: doc?.name ?? "" }) },
      content: `<div class="op2-furt-procurar">
        <label>${esc(L("Dados"))}<select name="formula">
          ${opcoesFicha ? `<optgroup label="${esc(L("DaFicha"))}">${opcoesFicha}</optgroup>` : ""}
          <optgroup label="${esc(L("DaTabela"))}">${presets.map((f) => `<option>${f}</option>`).join("")}</optgroup>
        </select></label>
        <label>${esc(L("OuFormula"))}<input type="text" name="livre" placeholder="2d8"></label>
        <label>${esc(L("Alvo"))}<select name="alvo"><option value="">${esc(L("Todos"))}</option>
          ${e.participantes.map((p) => `<option value="${p.uuid}">${esc(nomeDe(p.uuid))}</option>`).join("")}</select></label>
      </div>`,
      ok: { label: L("Procurar"), callback: (_ev, b) => ({ formula: b.form.elements.livre.value.trim() || b.form.elements.formula.value, alvo: b.form.elements.alvo.value }) },
      rejectClose: false,
    });
    if (resposta) await pedir("procurar", resposta);
  }

  static async #descartar(_e, alvo) {
    if (!game.user.isGM) return;
    const { uuid, id } = alvo.dataset;
    const ok = await DialogV2.confirm({ window: { title: L("Descartar") }, content: `<p>${esc(L("DescartarPergunta"))}</p>`, rejectClose: false });
    if (ok) await pedir("perder", { uuid, dadoId: id });
  }

  static async #jogador(_e, alvo) {
    const { uuid, acao } = alvo.dataset;
    const doc = await fromUuid(uuid);
    const estado = estadoFurtividade();
    const p = estado.participantes.find((x) => x.uuid === uuid);
    if (!doc?.isOwner || !p) return;
    await ACOES_JOGADOR[acao]?.(doc, estado, p);
  }
}

let painel = null;
export function abrirFurtividade() {
  painel ??= new FurtividadeApp();
  painel.render({ force: true });
  return painel;
}

/* -- vinheta e animações ------------------------------------------------------ */

/** Quem pediu a vinheta (furtividade, perseguição): ela fica enquanto houver algum. */
const fontesVinheta = new Set();
export function ligarVinheta(fonte, ativa) {
  if (ativa) fontesVinheta.add(fonte);
  else fontesVinheta.delete(fonte);
  atualizarVinheta(fontesVinheta.size > 0);
}

function atualizarVinheta(ativa) {
  let vinheta = document.getElementById("op2-vinheta-furtividade");
  const ligar = ativa && game.settings.get(SYSTEM_ID, "vinhetaFurtividade");
  if (!ligar) return void vinheta?.classList.remove("ativa");
  if (!vinheta) {
    vinheta = document.createElement("div");
    vinheta.id = "op2-vinheta-furtividade";
    vinheta.className = "op2-vinheta";
    vinheta.innerHTML = `<span class="op2-vinheta__nevoa n1"></span><span class="op2-vinheta__nevoa n2"></span><span class="op2-vinheta__nevoa n3"></span>`;
    // Logo depois do canvas: cobre o mapa, mas fica embaixo da interface.
    const board = document.getElementById("board");
    if (board) board.after(vinheta);
    else document.body.prepend(vinheta);
  }
  requestAnimationFrame(() => vinheta.classList.add("ativa"));
}

/** Tela de "encontrado": vulto, garras e o retrato manchando de vermelho. */
export function mostrarEncontrado(uuid, rotulo = null) {
  const doc = ator(uuid);
  if (!doc) return;
  const el = document.createElement("div");
  el.className = "op2 op2-encontrado";
  el.innerHTML = `
    <div class="op2-encontrado__flash"></div>
    <div class="op2-encontrado__retrato"><img src="${esc(doc.img)}" alt="">
      <img class="op2-encontrado__garras" src="${EFEITOS}/garras.webp" alt="">
    </div>
    <div class="op2-encontrado__texto"><small>${esc(rotulo ?? L("Encontrado"))}</small><strong>${esc(doc.name)}</strong></div>`;
  document.body.append(el);
  tocarAviso();
  setTimeout(() => el.remove(), 4600);
}

function tocarAviso() {
  tocarBatimento(4.4);
}

/**
 * Batimento cardíaco gerado na hora (sem arquivo): grave, abafado, começando
 * em ~52 bpm e subindo só até ~88 bpm, com uma batida que "falha" no meio e um
 * zumbido baixo por baixo. Volume baixo, pelo volume de interface do Foundry.
 * @param {number} duracao segundos
 */
export function tocarBatimento(duracao = 4.4) {
  try {
    const Contexto = window.AudioContext ?? window.webkitAudioContext;
    if (!Contexto) return;
    let volume = 0.5;
    try { volume = game.settings.get("core", "globalInterfaceVolume") ?? 0.5; } catch { /* sem o setting */ }
    if (volume <= 0) return;
    const ctx = new Contexto();
    const t = ctx.currentTime;
    const mestre = ctx.createGain();
    mestre.gain.setValueAtTime(0.0001, t);
    mestre.gain.exponentialRampToValueAtTime(0.26 * volume, t + 0.3);
    mestre.gain.setValueAtTime(0.26 * volume, t + duracao - 0.8);
    mestre.gain.linearRampToValueAtTime(0.0001, t + duracao);
    mestre.connect(ctx.destination);
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 140;
    filtro.connect(mestre);

    // Zumbido grave que cresce devagar (a "pressão" no ouvido).
    const zumbido = ctx.createOscillator();
    const gZumbido = ctx.createGain();
    zumbido.type = "sine";
    zumbido.frequency.setValueAtTime(38, t);
    zumbido.frequency.linearRampToValueAtTime(44, t + duracao);
    gZumbido.gain.setValueAtTime(0.0001, t);
    gZumbido.gain.exponentialRampToValueAtTime(0.18, t + duracao * 0.8);
    zumbido.connect(gZumbido).connect(filtro);
    zumbido.start(t);
    zumbido.stop(t + duracao);

    const pulsar = (inicio, freq, forca) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq * 1.6, t + inicio);
      o.frequency.exponentialRampToValueAtTime(freq, t + inicio + 0.1);
      g.gain.setValueAtTime(0.0001, t + inicio);
      g.gain.exponentialRampToValueAtTime(forca, t + inicio + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + inicio + 0.38);
      o.connect(g).connect(filtro);
      o.start(t + inicio);
      o.stop(t + inicio + 0.4);
    };
    let inicio = 0.1;
    let intervalo = 1.15;
    let batida = 0;
    while (inicio < duracao - 0.5) {
      const forca = 0.75 + 0.25 * (inicio / duracao);
      pulsar(inicio, 55, forca);
      pulsar(inicio + 0.24, 46, forca * 0.6);
      batida++;
      // Uma batida "falha" (pausa mais longa) no meio: o susto de quem prende o fôlego.
      inicio += batida === 3 ? intervalo * 1.6 : intervalo;
      intervalo = Math.max(0.68, intervalo * 0.92);
    }
    setTimeout(() => ctx.close(), (duracao + 0.5) * 1000);
  } catch (erro) {
    console.warn(`${SYSTEM_ID} | som de aviso`, erro);
  }
}

let ultimoEvento = null;
let estavaAtiva = false;

function aoMudar(valor) {
  const e = { ...VAZIO(), ...(valor ?? {}) };
  ligarVinheta("furtividade", e.ativa);
  if (e.ativa && !estavaAtiva) abrirFurtividade();
  estavaAtiva = e.ativa;
  atualizarBotao(e.ativa);
  if (painel?.rendered) painel.render();
  if (e.evento?.id && e.evento.id !== ultimoEvento) {
    ultimoEvento = e.evento.id;
    (e.evento.descobertos ?? []).forEach((uuid, i) => setTimeout(() => mostrarEncontrado(uuid), 900 + i * 4700));
  }
}

/* -- botão flutuante e registro ---------------------------------------------- */

function posicionarBotao() {
  const botao = document.getElementById("op2-botao-furtividade");
  if (botao) botao.style.right = `${(document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0) + 12}px`;
}

function atualizarBotao(ativa) {
  const botao = document.getElementById("op2-botao-furtividade");
  // Jogador só vê o botão com a cena ativa (style direto: a regra do botão não está na camada).
  if (botao) botao.style.display = game.user.isGM || ativa ? "" : "none";
}

function criarBotao() {
  if (document.getElementById("op2-botao-furtividade")) return;
  const botao = document.createElement("button");
  botao.id = "op2-botao-furtividade";
  botao.type = "button";
  botao.className = "op2 op2-botao-flutuante op2-botao-flutuante--furtividade";
  botao.dataset.tooltip = L("Titulo");
  botao.dataset.tooltipDirection = "LEFT";
  botao.innerHTML = `<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>`;
  botao.addEventListener("click", () => (painel?.rendered ? painel.close() : abrirFurtividade()));
  document.body.appendChild(botao);
  posicionarBotao();
  document.getElementById("sidebar")?.addEventListener("transitionend", posicionarBotao);
}

/** aeris-damage-vignette lê o PV por caminho; o padrão dele é o do D&D. */
async function ajustarVinhetaDeDano() {
  const modulo = "aeris-damage-vignette";
  if (!game.user.isGM || !game.modules.get(modulo)?.active) return;
  const caminhos = { hpPathValue: ["system.attributes.hp.value", "system.recursos.pv.value"], hpPathMax: ["system.attributes.hp.max", "system.recursos.pv.max"] };
  for (const [chave, [padrao, nosso]] of Object.entries(caminhos)) {
    try {
      if (game.settings.get(modulo, chave) === padrao) await game.settings.set(modulo, chave, nosso);
    } catch { /* versão do módulo sem esse setting */ }
  }
}

export function registrarFurtividade() {
  game.settings.register(SYSTEM_ID, CHAVE, { scope: "world", config: false, type: Object, default: {}, onChange: aoMudar });
  game.settings.register(SYSTEM_ID, "vinhetaFurtividade", {
    name: "OP2.Furtividade.VinhetaNome", hint: "OP2.Furtividade.VinhetaDica",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => atualizarVinheta(fontesVinheta.size > 0),
  });
  registrarAcaoDeMestre("op2Furtividade", executar);
  registrarAcaoDeChat("furtividade-sopro", soproNaNuca);
  Hooks.on("renderChatMessageHTML", ligarBotaoExecutar);
  registrarAcaoDeTodos("op2FurtSorteio", animarSorteio);

  Hooks.once("ready", () => {
    precarregarEfeitos();
    const e = estadoFurtividade();
    ultimoEvento = e.evento?.id ?? null;
    if (ultimoEvento) animados.add(ultimoEvento);
    estavaAtiva = e.ativa;
    criarBotao();
    atualizarBotao(e.ativa);
    ligarVinheta("furtividade", e.ativa);
    ajustarVinhetaDeDano();
  });
  Hooks.on("collapseSidebar", () => setTimeout(posicionarBotao, 400));
  Hooks.on("updateActor", () => { if (painel?.rendered) painel.render(); });
  Hooks.on("op2CenasConfig", () => { if (painel?.rendered) painel.render(); });
}
