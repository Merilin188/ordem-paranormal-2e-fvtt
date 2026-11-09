/**
 * Cena de perseguição: painel compartilhado com pontos de avanço (PA), dados de
 * fôlego, ações de perseguição, eventos no caminho (a vala oculta), o evento de
 * início de rodada (ataque das cabeças) e os marcos de corte.
 *
 * Tudo que é da aventura vem de uma perseguição configurada (`cenas-config.mjs`);
 * ao iniciar, uma cópia dela fica em `estado.config`. O estado mora num setting de
 * mundo que só o mestre grava; o jogador rola no próprio cliente e pede a
 * gravação por `comoMestre()`.
 */
import { SYSTEM_ID } from "../config.mjs";
import { comoMestre, registrarAcaoDeMestre, paraTodos, registrarAcaoDeTodos } from "../ui/socket.mjs";
import { iconeDado } from "../ui/dice-icons.mjs";
import { stepDie } from "../dice/escada.mjs";
import { MAX_BONUS, folegoInicial, formulaDoEsforco, pontosDoAvanco, quemEAlcancado, proximoCorte } from "./perseguicao-regras.mjs";
import { animarSorteio, ligarVinheta } from "./furtividade.mjs";
import { listarCenas, obterCena, novaCena, ConfigCenaApp, PERSEGUICAO_PADRAO, salvarCena } from "./cenas-config.mjs";
import { enviarCaixasDeSussurro, jogadoresDe } from "../ui/sussurro.mjs";
import { iniciarAmbientePerseguicao, pararAmbientePerseguicao, mostrarAlcancado, precarregarEfeitos } from "../ui/terror.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const CHAVE = "perseguicao";
const L = (k, d) => (d ? game.i18n.format(`OP2.Perseguicao.${k}`, d) : game.i18n.localize(`OP2.Perseguicao.${k}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const ANONIMO = "icons/svg/mystery-man.svg";
const ator = (uuid) => fromUuidSync(uuid);
const nomeDe = (uuid) => ator(uuid)?.name ?? "?";
const comNome = (texto, nome, extra = {}) => Object.entries({ nome, ...extra })
  .reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), String(texto ?? ""));
/** Tempo da tela de alcançado antes de zerar a vida (ms). */
const DURACAO_ALCANCADO = 5800;

export const perseguicaoHabilitada = () => {
  try { return game.settings.get(SYSTEM_ID, "perseguicaoHabilitada"); } catch { return false; }
};

/* -- estado ----------------------------------------------------------------- */

const VAZIO = () => ({
  ativa: false, cenaId: "", rodada: 1, participantes: [], criaturas: [], avisos: {}, cabecas: false, fim: false, evento: null, config: null, empate: null,
});

export function estadoPerseguicao() {
  let salvo = {};
  try { salvo = game.settings.get(SYSTEM_ID, CHAVE) ?? {}; } catch { /* antes do init */ }
  const e = { ...VAZIO(), ...foundry.utils.deepClone(salvo) };
  e.config ??= obterCena("perseguicao");
  return e;
}

const novoParticipante = (uuid, config) => ({
  uuid, pa: 0,
  folego: config?.folego === false ? 0 : folegoInicial(ator(uuid)?.system?.pericias?.vigor?.dadoEfetivo ?? "d6"),
  esforcos: 0, periciasUsadas: [], eventos: {}, agiu: false, sacrificou: false, morto: false,
});

const vivos = (e) => e.participantes.filter((p) => !p.morto);

async function card(html) {
  return ChatMessage.create({
    content: `<div class="op2 op2-card op2-furt-card op2-pers-card">${html}</div>`,
    speaker: { alias: estadoPerseguicao().config?.nome ?? L("Titulo") },
    flags: { [SYSTEM_ID]: { tipo: "perseguicao" } },
  });
}

/* -- operações do mestre ------------------------------------------------------ */

const acharP = (e, uuid) => e.participantes.find((x) => x.uuid === uuid);

const OPS = {
  iniciar(e, { configId }) {
    const config = obterCena("perseguicao", configId);
    Object.assign(e, { ativa: true, cenaId: foundry.utils.randomID(), rodada: 1, avisos: {}, cabecas: false, fim: false, evento: null, config, empate: null });
    e.participantes = e.participantes.map((p) => novoParticipante(p.uuid, config));
  },
  encerrar(e) { e.ativa = false; e.evento = null; e.empate = null; },
  adicionar(e, { uuid, papel }) {
    if (e.participantes.some((p) => p.uuid === uuid) || e.criaturas.some((c) => c.uuid === uuid)) return;
    if (papel === "criatura") e.criaturas.push({ uuid });
    else e.participantes.push(novoParticipante(uuid, e.config));
  },
  remover(e, { uuid }) {
    e.participantes = e.participantes.filter((p) => p.uuid !== uuid);
    e.criaturas = e.criaturas.filter((c) => c.uuid !== uuid);
  },
  agiu(e, { uuid }) { const p = acharP(e, uuid); if (p) p.agiu = !p.agiu; },
  ajustarPA(e, { uuid, pa }) { const p = acharP(e, uuid); if (p) p.pa = Math.max(0, Number(pa) || 0); },
  avanco(e, { uuid, pontos, chave, folegoUsado = 0, esforco = false, mensagemId = null }) {
    const p = acharP(e, uuid);
    if (!p) return;
    p.pa += Math.max(0, pontos);
    // Guarda de qual card veio o avanço: se a Prontidão mudar o teste, o PA é refeito.
    if (mensagemId) p.avancos = { ...(p.avancos ?? {}), [mensagemId]: Math.max(0, pontos) };
    p.folego = Math.max(0, p.folego - folegoUsado);
    if (esforco) p.esforcos += 1;
    if (chave !== e.config?.periciaPadrao && !p.periciasUsadas.includes(chave)) p.periciasUsadas.push(chave);
    p.agiu = true;
  },
  evento(e, { uuid, eventoId, resultado }) {
    const p = acharP(e, uuid);
    if (p) p.eventos = { ...(p.eventos ?? {}), [eventoId]: resultado };
  },
  folego(e, { uuid }) { const p = acharP(e, uuid); if (p) Object.assign(p, { folego: p.folego + 2, agiu: true }); },
  sacrificio(e, { uuid }) { const p = acharP(e, uuid); if (p) Object.assign(p, { sacrificou: true, agiu: true }); },
  outra(e, { uuid }) { const p = acharP(e, uuid); if (p) p.agiu = true; },
  aviso(e, { eventoId }) { e.avisos = { ...(e.avisos ?? {}), [eventoId]: true }; },
};

let fila = Promise.resolve();
function executar({ op, ...dados }) {
  const resultado = fila.then(async () => {
    if (op === "proxima") return proximaRodada();
    if (op === "prosseguiu") return marcarProsseguiu(dados.uuid);
    if (op === "sussurroEmpate") return sussurroDoEmpate();
    if (op === "resolverOposto") return resolverPeloOposto(dados);
    if (op === "reavaliar") return reavaliarAvanco(dados.mensagemId);
    if (op === "cabecas") return eventoDeInicio();
    if (op === "perseguidor") return renomearPerseguidor(dados);
    const e = estadoPerseguicao();
    OPS[op]?.(e, dados);
    await game.settings.set(SYSTEM_ID, CHAVE, e);
    const nome = nomeDe(dados.uuid);
    if (op === "aviso") await card(`<p><i class="fa-solid fa-bullhorn"></i> ${esc(L("AvisouEvento", { nome, evento: dados.eventoNome ?? "" }))}</p>`);
    if (op === "sacrificio") await card(`<p><i class="fa-solid fa-hand-fist"></i> ${esc(L("Sacrificou", { nome, perseguidor: e.config?.perseguidor || L("Perseguidor") }))}</p>`);
    if (op === "folego") await card(`<p><i class="fa-solid fa-lungs"></i> ${esc(L("RecuperouFolego", { nome }))}</p>`);
    return true;
  });
  fila = resultado.catch((erro) => console.error(`${SYSTEM_ID} | perseguição`, erro));
  return resultado.catch(() => false);
}

const pedir = (op, dados = {}) => comoMestre("op2Perseguicao", { op, ...dados });

/**
 * O nome do perseguidor, editado direto no painel: vale para a cena em andamento e
 * fica gravado na configuração dela (a próxima vez já vem com ele).
 */
async function renomearPerseguidor({ nome, configId }) {
  const limpo = String(nome ?? "").trim();
  const e = estadoPerseguicao();
  const id = e.ativa ? e.config?.id : (configId ?? e.config?.id);
  const config = obterCena("perseguicao", id);
  if (config && config.id === id) await salvarCena("perseguicao", { ...config, perseguidor: limpo });
  if (e.config && (e.ativa || e.config.id === id)) {
    e.config.perseguidor = limpo;
    await game.settings.set(SYSTEM_ID, CHAVE, e);
  }
  return true;
}

async function rolar(formula) {
  const roll = await new Roll(formula).evaluate();
  const { mostrarDados3D } = await import("../dice/teste.mjs");
  await mostrarDados3D(roll);
  return roll;
}

/** Sorteio na tela de todos (o mesmo da furtividade). */
async function sortear(candidatos, titulo) {
  const itens = candidatos.map((p) => ({ nome: nomeDe(p.uuid), img: ator(p.uuid)?.img ?? ANONIMO }));
  const final = Math.floor(Math.random() * itens.length);
  const passos = itens.length * Math.max(3, Math.ceil(12 / itens.length)) + final + 1;
  const sorteio = { itens, final, passos, titulo };
  paraTodos("op2FurtSorteio", sorteio);
  await animarSorteio(sorteio);
  return candidatos[final];
}

/** Evento de início de rodada: cada ataque configurado sorteia um alvo diferente. */
async function eventoDeInicio() {
  const e = estadoPerseguicao();
  const inicio = e.config?.inicioRodada;
  if (e.cabecas || !inicio?.ataques?.length) return false;
  const restantes = [...vivos(e)];
  const { aplicarDano } = await import("../dice/falha-critica.mjs");
  for (const ataque of inicio.ataques) {
    if (!restantes.length) break;
    const alvo = await sortear(restantes, ataque.nome || inicio.nome);
    restantes.splice(restantes.indexOf(alvo), 1);
    const doc = ator(alvo.uuid);
    const roll = await rolar(Roll.validate(ataque.dano) ? ataque.dano : "1d6");
    if (doc) await aplicarDano(doc, roll.total, ataque.recurso === "pd" ? "pd" : "pv");
    await card(`<h3>${esc(ataque.nome)}</h3><p>${esc(comNome(ataque.texto, doc?.name ?? "?", { n: roll.total }))}</p>`);
  }
  await game.settings.set(SYSTEM_ID, CHAVE, { ...estadoPerseguicao(), cabecas: true });
  return true;
}

/** Zera a vida e marca como morto, depois da tela de alcançado. */
async function matar(uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) return;
  await doc.update({ "system.recursos.pv.value": 0 }, { op2SemQueda: true });
  const { definirCondicao } = await import("./ferimentos.mjs");
  await definirCondicao(doc, "morto", true);
}

/** Fim da rodada: marco de corte, depois a próxima rodada ou o fim da perseguição. */
/* -- empate no corte: decidido no próprio card ---------------------------------- */

/** HTML do card de empate: retratos na vertical e, para o mestre, como decidir. */
function htmlDoEmpate(empate, perdedor = null) {
  const linhas = empate.uuids.map((u) => {
    const doc = ator(u);
    const salvo = empate.salvos.includes(u);
    const morto = u === perdedor;
    return `<button type="button" class="op2-pers-empate__pj${salvo ? " op2-pers-empate__pj--salvo" : ""}${morto ? " op2-pers-empate__pj--morto" : ""}"
      data-op2-pers-escolher="${u}" ${perdedor || salvo ? "disabled" : ""}>
      <img src="${esc(doc?.img ?? ANONIMO)}" alt=""><span>${esc(doc?.name ?? "?")}</span>
      ${salvo ? `<i class="fa-solid fa-person-running" data-tooltip="${esc(L("Prosseguiu"))}"></i>` : ""}${morto ? `<i class="fa-solid fa-skull"></i>` : ""}</button>`;
  }).join("");
  // Teste oposto só entre dois: num empate triplo, volta a valer quando sobram dois.
  const restantes = empate.uuids.filter((u) => !empate.salvos.includes(u));
  const dois = restantes.length === 2;
  const mestre = perdedor ? "" : `
    <div class="op2-pers-empate__mestre" data-op2-gm>
      <button type="button" class="op2-botao" data-op2-pers-oposto="${restantes.join(",")}" ${dois ? "" : "disabled"}
        ${dois ? "" : `data-tooltip="${esc(L("OpostoSoDois"))}"`}><i class="fa-solid fa-swords"></i> ${esc(L("SolicitarOposto"))}</button>
      <span class="op2-pers-empate__ou">${esc(L("Ou"))}</span>
      <button type="button" class="op2-botao op2-botao--perigo" data-op2-pers-manual><i class="fa-solid fa-hand-pointer"></i> ${esc(L("DecidirManual"))}</button>
    </div>
    <p class="op2-dica op2-pers-empate__instrucao" data-op2-gm ${empate.manual ? "" : "hidden"}>${esc(L(dois ? "CliqueQuemProsseguiu" : "CliqueQuemProsseguiuVarios"))}</p>`;
  return `<p>${esc(L("Empate", { nomes: empate.uuids.map(nomeDe).join(", "), corte: empate.corte }))}</p>
    <p class="op2-pers-empate__pergunta"><strong>${esc(L("QuemProsseguiu"))}</strong></p>
    <div class="op2-pers-empate${empate.manual ? " op2-pers-empate--manual" : ""}">${linhas}</div>${mestre}`;
}

const conteudoDoCard = (html) => `<div class="op2 op2-card op2-furt-card op2-pers-card">${html}</div>`;

/** Decidir manualmente: cada empatado recebe uma caixa para sussurrar o que faz (uma vez). */
async function sussurroDoEmpate() {
  const e = estadoPerseguicao();
  if (!e.empate || e.empate.sussurro) return false;
  const destinos = e.empate.uuids.flatMap((u) => jogadoresDe(ator(u)).map((usuario) => ({ usuarioId: usuario.id, atorUuid: u })));
  if (destinos.length) await enviarCaixasDeSussurro({ destinos, pergunta: L("PerguntaEmpate") });
  e.empate.sussurro = true;
  await game.settings.set(SYSTEM_ID, CHAVE, e);
  return true;
}

/**
 * O card do teste de avanço mudou (Prontidão rerrolou um dado): refaz os pontos.
 * Falha que virou sucesso passa de RB para RA; virou crítico, soma as duas maiores.
 */
async function reavaliarAvanco(mensagemId) {
  const e = estadoPerseguicao();
  const p = e.participantes.find((x) => x.avancos?.[mensagemId] !== undefined);
  const roll = game.messages.get(mensagemId)?.rolls?.[0];
  if (!p || !roll?.resultado) return false;
  const valores = (roll.dadosDoTeste ?? []).filter((d) => d.contado !== false).map((d) => d.resultado);
  const novo = Math.max(0, pontosDoAvanco(roll.resultado, valores));
  const antigo = p.avancos[mensagemId];
  if (novo === antigo) return false;
  p.pa = Math.max(0, p.pa + novo - antigo);
  p.avancos[mensagemId] = novo;
  await game.settings.set(SYSTEM_ID, CHAVE, e);
  await card(`<p><i class="fa-solid fa-bolt"></i> ${esc(L("AvancoRefeito", { nome: nomeDe(p.uuid), antes: antigo, depois: novo, total: p.pa }))}</p>`);
  return true;
}

/** Card do teste oposto: o mestre resolve o empate com o vencedor do teste. */
async function resolverPeloOposto({ atorId, mensagemId }) {
  const e = estadoPerseguicao();
  if (!e.empate) return void ui.notifications.warn(L("SemEmpate"));
  const uuid = e.empate.uuids.find((u) => ator(u)?.id === atorId);
  if (!uuid) return void ui.notifications.warn(L("VencedorForaDoEmpate"));
  const mensagem = game.messages.get(mensagemId);
  const dados = foundry.utils.deepClone(mensagem?.getFlag(SYSTEM_ID, "oposto"));
  if (dados) {
    dados.resolvido = true;
    const { htmlOposto } = await import("../ui/ferramentas-testes.mjs");
    await mensagem.update({ content: htmlOposto(dados), [`flags.${SYSTEM_ID}.oposto`]: dados });
  }
  return marcarProsseguiu(uuid);
}

/** Mestre clicou em quem prosseguiu: quando sobra um só, ele é alcançado. */
async function marcarProsseguiu(uuid) {
  const e = estadoPerseguicao();
  const empate = e.empate;
  if (!empate || !empate.uuids.includes(uuid) || empate.salvos.includes(uuid)) return false;
  empate.salvos.push(uuid);
  const restantes = empate.uuids.filter((u) => !empate.salvos.includes(u));
  const mensagem = game.messages.get(empate.mensagemId);
  if (restantes.length > 1) {
    await mensagem?.update({ content: conteudoDoCard(htmlDoEmpate({ ...empate, manual: true })) });
    await game.settings.set(SYSTEM_ID, CHAVE, e);
    return true;
  }
  const perdedor = restantes[0];
  await mensagem?.update({ content: conteudoDoCard(htmlDoEmpate(empate, perdedor)) });
  e.empate = null;
  return concluirRodada(e, perdedor, empate.corte);
}

function ligarCardDeEmpate(msg, html) {
  if (!game.user.isGM) return;
  html.querySelector("[data-op2-pers-resolver]")?.addEventListener("click", (ev) => {
    ev.currentTarget.disabled = true;
    void executar({ op: "resolverOposto", atorId: ev.currentTarget.dataset.op2PersResolver, mensagemId: msg.id });
  });
  const raiz = html.querySelector(".op2-pers-empate")?.parentElement;
  if (!raiz) return;
  raiz.querySelector("[data-op2-pers-oposto]")?.addEventListener("click", async (ev) => {
    const [a, b] = ev.currentTarget.dataset.op2PersOposto.split(",").map((u) => ator(u)?.id);
    const { testeOposto } = await import("../ui/ferramentas-testes.mjs");
    await testeOposto({ atorIds: [a, b], chave: "atletismo", motivo: L("MotivoOposto"), empate: true });
  });
  raiz.querySelector("[data-op2-pers-manual]")?.addEventListener("click", () => {
    raiz.querySelector(".op2-pers-empate")?.classList.add("op2-pers-empate--manual");
    raiz.querySelector(".op2-pers-empate__instrucao")?.removeAttribute("hidden");
    void executar({ op: "sussurroEmpate" });
  });
  for (const botao of raiz.querySelectorAll("[data-op2-pers-escolher]")) {
    botao.addEventListener("click", () => {
      if (!raiz.querySelector(".op2-pers-empate--manual")) return void ui.notifications.info(L("AtiveManual"));
      void executar({ op: "prosseguiu", uuid: botao.dataset.op2PersEscolher });
    });
  }
}

async function proximaRodada() {
  const e = estadoPerseguicao();
  if (e.empate) {
    // Empate de outra rodada/cena, cuja mensagem sumiu ou com gente que saiu da cena: não pode travar.
    const valido = e.empate.rodada === e.rodada && e.empate.cenaId === e.cenaId && game.messages.get(e.empate.mensagemId)
      && e.empate.uuids.every((u) => e.participantes.some((p) => p.uuid === u && !p.morto));
    if (valido) {
      const descartar = await DialogV2.confirm({
        window: { title: L("EmpateTitulo") },
        content: `<p>${esc(L("EmpatePendente"))}</p>`,
        yes: { label: L("DescartarEmpate") }, no: { label: L("Voltar") },
        rejectClose: false,
      });
      if (!descartar) return false;
    }
    e.empate = null;
    await game.settings.set(SYSTEM_ID, CHAVE, e);
  }
  const config = e.config;
  const { corte, alvo, empate } = quemEAlcancado(e.participantes, e.rodada, config.marcos);
  if (!alvo && empate.length) {
    const dados = { corte, uuids: empate, salvos: [] };
    const mensagem = await card(htmlDoEmpate(dados));
    e.empate = { ...dados, mensagemId: mensagem?.id, rodada: e.rodada, cenaId: e.cenaId };
    await game.settings.set(SYSTEM_ID, CHAVE, e);
    return true;
  }
  return concluirRodada(e, alvo, corte);
}

/** O resto do fim da rodada: quem foi alcançado, depois a próxima rodada ou o fim. */
async function concluirRodada(e, morto, corte) {
  const config = e.config;
  if (morto) {
    const p = acharP(e, morto);
    if (p) p.morto = true;
    e.evento = { id: foundry.utils.randomID(), mortos: [morto] };
    await card(`<p class="op2-furt-card__encontrado"><i class="fa-solid fa-skull"></i> ${esc(L("FoiAlcancado", { nome: nomeDe(morto), corte, perseguidor: config.perseguidor || L("Perseguidor") }))}</p>`);
  } else if (corte) {
    await card(`<p>${esc(L("NinguemAlcancado", { corte }))}</p>`);
  }
  if (e.rodada >= config.rodadas) {
    e.fim = true;
    const salvos = vivos(e).filter((p) => p.pa >= config.meta).map((p) => nomeDe(p.uuid));
    await card(`<h3>${esc(L("FimTitulo"))}</h3><p>${esc(salvos.length ? L("Salvos", { nomes: salvos.join(", ") }) : L("NinguemSalvo", { meta: config.meta }))}</p>`);
  } else {
    e.rodada += 1;
    e.cabecas = false;
    e.participantes = e.participantes.map((p) => ({ ...p, agiu: false, sacrificou: false }));
  }
  await game.settings.set(SYSTEM_ID, CHAVE, e);
  if (morto) setTimeout(() => void matar(morto), DURACAO_ALCANCADO);
  return true;
}

/* -- avançar: uma janela só, com os dados à vista ---------------------------- */

/** Os dados que o teste vai rolar: perícia (com passos) + atributo pareado. */
function dadosDaPericia(doc, chave, passos = 0) {
  const s = doc.system;
  const p = s.resolverChave?.(chave);
  if (!p) return [];
  if (p.tipo === "atributo") return [stepDie(p.dado, passos)];
  const atributo = s.atributos?.[s.atributoDe?.(chave) ?? "fisico"];
  return [stepDie(p.dado, passos), atributo?.dadoEfetivo ?? "d6"].filter(Boolean);
}

const icones = (dados) => dados.map((d) => iconeDado(d)).join("");
const rotuloPericia = (k) => game.i18n.localize(`OP2.Pericia.${k}`);

/** HTML da janela do evento (o mesmo para quem age e para quem assiste). */
function htmlDoEvento(d, comChips) {
  return `<div class="op2-pers-evento-janela__corpo">
    <p>${esc(d.texto)}</p>
    ${d.avisado ? `<p class="op2-dica">${esc(L("EventoAvisado", { n: d.avisado }))}</p>` : ""}
    <p class="op2-pers-evento-janela__chamada">${esc(d.chamada)}</p>
    ${comChips ? `<div class="op2-pers-evento__opcoes">${d.opcoes.map((o) => `<span class="op2-pers-evento__opcao">${esc(o.rotulo)} ${o.dados}</span>`).join("")}</div>` : ""}
    <p class="op2-dica">DT ${d.dt}. ${esc(d.falha)}</p>
  </div>`;
}

/** Janela do evento para quem só assiste (todos os outros). Fecha quando o teste sai. */
let janelaEventoAlheio = null;
function mostrarEventoParaOutros(d) {
  janelaEventoAlheio?.close();
  janelaEventoAlheio = new DialogV2({
    window: { title: `${d.titulo}: ${d.nome}`, icon: "fa-solid fa-triangle-exclamation" },
    classes: ["op2", "op2-pers-evento-janela"],
    position: { width: 520 },
    content: htmlDoEvento(d, true),
    buttons: [{ action: "ok", label: L("Fechar"), default: true }],
  });
  janelaEventoAlheio.render({ force: true });
}
function fecharEventoParaOutros() {
  janelaEventoAlheio?.close();
  janelaEventoAlheio = null;
}

/**
 * O evento no caminho, numa janela própria e para todos: quem age escolhe o
 * método (botões na horizontal, com os dados); os outros veem a mesma janela.
 * Devolve "passou", "falhou" ou null (fechou sem escolher).
 */
async function enfrentarEvento(doc, evento, avisado) {
  const d = {
    titulo: evento.nome, nome: doc.name, texto: comNome(evento.descricao, doc.name),
    chamada: comNome(evento.chamada || PERSEGUICAO_PADRAO().eventos.find((x) => x.id === evento.id)?.chamada || L("ChamadaPadrao"), doc.name),
    dt: evento.dt, avisado,
    falha: L("EventoFalha", { n: evento.passosFalha }),
    opcoes: evento.pericias.map((k) => ({ k, rotulo: rotuloPericia(k), dados: icones(dadosDaPericia(doc, k, avisado)) })),
  };
  paraTodos("op2PersEvento", d);
  const chave = await DialogV2.wait({
    window: { title: evento.nome, icon: "fa-solid fa-triangle-exclamation" },
    classes: ["op2", "op2-pers-evento-janela"],
    position: { width: 520 },
    content: htmlDoEvento(d, false),
    buttons: d.opcoes.map((o, i) => ({ action: o.k, label: o.rotulo, default: i === 0 })),
    render: (_ev, dialogo) => {
      for (const o of d.opcoes) {
        dialogo.element.querySelector(`button[data-action="${o.k}"]`)
          ?.insertAdjacentHTML("beforeend", `<span class="op2-pers-evento__dados">${o.dados}</span>`);
      }
    },
    rejectClose: false,
  });
  if (!chave) {
    paraTodos("op2PersEventoFim", {});
    return null;
  }
  const opcoesTxt = d.opcoes.map((o) => `${esc(o.rotulo)} ${o.dados}`).join(` ${esc(L("Ou"))} `);
  await card(`<h3><i class="fa-solid fa-triangle-exclamation"></i> ${esc(evento.nome)}</h3><p>${esc(d.texto)}</p>
    <p class="op2-pers-card__dados">${esc(L("TesteDoEvento"))} ${opcoesTxt} (DT ${evento.dt})</p>`);
  const { rolarTeste } = await import("../dice/teste.mjs");
  const teste = await rolarTeste(doc, {
    chavePericia: chave, dt: evento.dt, contexto: evento.nome, rapido: true, passos: avisado ? { pericia: avisado } : null,
  });
  paraTodos("op2PersEventoFim", {});
  if (!teste) return null;
  const resultado = teste.resultado?.sucesso ? "passou" : "falhou";
  await card(`<p>${esc(comNome(resultado === "passou" ? evento.textoPassou : evento.textoFalhou, doc.name))}</p>`);
  await pedir("evento", { uuid: doc.uuid, eventoId: evento.id, resultado });
  return resultado;
}

async function avancar(doc, e, p) {
  const config = e.config;
  const padrao = config.periciaPadrao || "atletismo";
  const opcoes = Object.keys(doc.system.pericias ?? {})
    .filter((k) => k !== "aptidao" && (k === padrao || !config.outrasUmaVez || !p.periciasUsadas.includes(k)))
    .sort((a, b) => (a === padrao ? -1 : b === padrao ? 1 : rotuloPericia(a).localeCompare(rotuloPericia(b))));
  const sacrificios = Math.min(MAX_BONUS, e.participantes.filter((x) => x.sacrificou && x.uuid !== p.uuid && !x.morto).length);
  const maxFolego = config.folego ? Math.min(p.folego, Math.max(0, MAX_BONUS - sacrificios)) : 0;
  const evento = (config.eventos ?? []).find((ev) => ev.pericias?.length && p.pa >= ev.gatilhoPA && !p.eventos?.[ev.id]) ?? null;
  const avisado = evento && e.avisos?.[evento.id] ? Number(evento.passosAviso) || 0 : 0;

  // Primeiro o evento, na janela dele; depois a janela de Avançar já com o resultado.
  let resultadoEvento = null;
  if (evento) {
    resultadoEvento = await enfrentarEvento(doc, evento, avisado);
    if (!resultadoEvento) return;
  }
  const passosEvento = resultadoEvento === "falhou" ? Number(evento.passosFalha) || 0 : 0;

  const escolha = await DialogV2.prompt({
    window: { title: L("Avancar"), icon: "fa-solid fa-person-running" },
    classes: ["op2", "op2-pers-dialogo"],
    position: { width: 460 },
    content: `<div class="op2-furt-procurar">
      <label>${esc(L("Pericia"))}<select name="chave">${opcoes.map((k) => `<option value="${k}">${esc(rotuloPericia(k))}</option>`).join("")}</select></label>
      ${config.outrasUmaVez ? `<p class="op2-dica">${esc(L("PericiaAjuda", { pericia: rotuloPericia(padrao) }))}</p>` : ""}
      ${config.folego ? `<label>${esc(L("UsarFolego", { n: p.folego }))}<input type="number" name="folego" min="0" max="${maxFolego}" value="0"></label>` : ""}
      ${sacrificios ? `<p class="op2-dica"><i class="fa-solid fa-hand-fist"></i> ${esc(L("BonusSacrificio", { n: sacrificios }))}</p>` : ""}
      <label class="op2-pers-check"><input type="checkbox" name="esforco"> ${esc(L("EsforcoExtra", { formula: formulaDoEsforco(p.esforcos) }))}</label>
      <div class="op2-pers-previa"><small>${esc(L("VaiRolar", { dt: config.dtAvanco }))}</small><span data-previa></span></div>
    </div>`,
    render: (_ev, dialogo) => {
      const raiz = dialogo.element;
      const atualizar = () => {
        const chave = raiz.querySelector("[name=chave]").value;
        const folego = Math.clamp(Number(raiz.querySelector("[name=folego]")?.value) || 0, 0, maxFolego);
        const esforco = raiz.querySelector("[name=esforco]").checked ? 1 : 0;
        const extras = Array(folego + sacrificios).fill("d6");
        raiz.querySelector("[data-previa]").innerHTML = `${icones(dadosDaPericia(doc, chave, esforco + passosEvento))}${extras.length ? ` + ${icones(extras)}` : ""}`
          + (passosEvento ? ` <em>${esc(L("PassosDoEvento", { evento: evento.nome, n: passosEvento }))}</em>` : "");
      };
      raiz.querySelectorAll("select, input").forEach((el) => el.addEventListener("change", atualizar));
      raiz.querySelector("[name=folego]")?.addEventListener("input", atualizar);
      atualizar();
    },
    ok: {
      label: L("Avancar"),
      callback: (_ev, b) => ({
        chave: b.form.elements.chave.value,
        folego: Math.clamp(Number(b.form.elements.folego?.value) || 0, 0, maxFolego),
        esforco: b.form.elements.esforco.checked,
      }),
    },
    rejectClose: false,
  });
  if (!escolha) return;
  const { rolarTeste } = await import("../dice/teste.mjs");

  const d6 = (rotulo, n) => Array.from({ length: n }, (_, i) => ({ chave: `${rotulo}.${i}`, rotulo: L(rotulo), tipo: "extra", dado: "d6" }));
  const passos = (escolha.esforco ? 1 : 0) + passosEvento;
  const roll = await rolarTeste(doc, {
    chavePericia: escolha.chave, dt: config.dtAvanco, contexto: L("TesteAvanco"), rapido: true,
    dadosExtras: [...d6("Folego", escolha.folego), ...d6("Sacrificio", sacrificios)],
    passos: passos ? { pericia: passos } : null,
  });
  if (!roll) return;
  if (escolha.esforco) {
    const perda = await rolar(formulaDoEsforco(p.esforcos));
    const { aplicarDano } = await import("../dice/falha-critica.mjs");
    await aplicarDano(doc, perda.total, "pv");
    await card(`<p>${esc(L("EsforcoPerdeu", { nome: doc.name, n: perda.total }))}</p>`);
  }
  const pontos = pontosDoAvanco(roll.resultado ?? {}, (roll.dadosDoTeste ?? []).filter((d) => d.contado !== false).map((d) => d.resultado));
  await card(`<p><i class="fa-solid fa-person-running"></i> ${esc(L("Avancou", { nome: doc.name, n: pontos }))}</p>`);
  const mensagem = game.messages.contents.filter((m) => m.author?.id === game.user.id && m.rolls?.[0]?.options?.atorId === doc.id).at(-1);
  await pedir("avanco", { uuid: doc.uuid, pontos, chave: escolha.chave, folegoUsado: escolha.folego, esforco: escolha.esforco, mensagemId: mensagem?.id ?? null });
}

const ACOES = {
  avancar,
  folego: (doc) => pedir("folego", { uuid: doc.uuid }),
  sacrificio: (doc) => pedir("sacrificio", { uuid: doc.uuid }),
  outra: (doc) => pedir("outra", { uuid: doc.uuid }),
  aviso: (doc, e, _p, alvo) => {
    const ev = e.config?.eventos?.find((x) => x.id === alvo.dataset.evento);
    return pedir("aviso", { uuid: doc.uuid, eventoId: alvo.dataset.evento, eventoNome: ev?.nome ?? "" });
  },
};

/* -- painel ------------------------------------------------------------------- */

export class PerseguicaoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-perseguicao",
    classes: ["op2", "op2-furtividade", "op2-perseguicao"],
    window: { title: "OP2.Perseguicao.Titulo", icon: "fa-solid fa-person-running", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      iniciar: PerseguicaoApp.#iniciar,
      novaCena: PerseguicaoApp.#novaCena,
      configurar: PerseguicaoApp.#configurar,
      encerrar: PerseguicaoApp.#encerrar,
      proxima: () => pedir("proxima"),
      cabecas: () => pedir("cabecas"),
      remover: (_e, alvo) => pedir("remover", { uuid: alvo.dataset.uuid }),
      agiu: (_e, alvo) => pedir("agiu", { uuid: alvo.dataset.uuid }),
      ficha: (_e, alvo) => ator(alvo.dataset.uuid)?.sheet?.render(true),
      jogador: PerseguicaoApp.#jogador,
    },
  };

  static PARTS = { corpo: { template: "systems/ordem-paranormal-2e/templates/cena/perseguicao.hbs" } };

  /** Perseguição escolhida no seletor (só antes de iniciar). */
  configId = null;

  async _prepareContext() {
    const e = estadoPerseguicao();
    const gm = game.user.isGM;
    const config = e.config;
    const corte = proximoCorte(e.rodada, config.marcos);
    const cenas = listarCenas("perseguicao");
    this.configId ??= cenas[0]?.id;
    return {
      gm, ativa: e.ativa, rodada: e.rodada, total: config.rodadas, dtAvanco: config.dtAvanco, fim: e.fim, cabecas: e.cabecas,
      nomeCena: config.nome,
      perseguidor: e.ativa ? config.perseguidor : (obterCena("perseguicao", this.configId)?.perseguidor ?? config.perseguidor),
      inicioNome: config.inicioRodada?.ataques?.length ? config.inicioRodada.nome : null,
      cenas: cenas.map((c) => ({ id: c.id, nome: c.nome, sel: c.id === this.configId })),
      corte,
      marcos: (config.marcos ?? []).map((m) => ({ ...m, pos: Math.min(100, (m.pa / Math.max(config.meta * 1.15, 1)) * 100).toFixed(2) })),
      criaturas: e.criaturas.map((c) => ({ uuid: c.uuid, nome: nomeDe(c.uuid), img: ator(c.uuid)?.img ?? ANONIMO })),
      participantes: e.participantes.map((p) => {
        const doc = ator(p.uuid);
        const dono = !!doc?.isOwner && !gm;
        const eventos = (config.eventos ?? []).filter((ev) => p.eventos?.[ev.id])
          .map((ev) => ({ nome: ev.nome, resultado: p.eventos[ev.id], podeAvisar: dono && ev.avisavel && p.eventos[ev.id] === "passou" && !e.avisos?.[ev.id], id: ev.id }));
        return {
          ...p, nome: doc?.name ?? "?", img: doc?.img ?? ANONIMO,
          dono, podeMarcar: gm || !!doc?.isOwner,
          largura: Math.min(100, Math.round((p.pa / Math.max(config.meta * 1.15, 1)) * 100)),
          abaixo: corte ? p.pa < corte.pa : false,
          folegoIcones: config.folego ? iconeDado("d6", { texto: p.folego }) : null,
          eventosP: eventos,
          podeAgir: dono && e.ativa && !e.fim && !p.agiu && !p.morto,
        };
      }),
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
    for (const campo of this.element.querySelectorAll("[data-pa]")) {
      campo.addEventListener("change", () => pedir("ajustarPA", { uuid: campo.dataset.pa, pa: campo.value }));
    }
    this.element.querySelector("[data-seletor-cena]")?.addEventListener("change", (ev) => {
      this.configId = ev.target.value;
      this.render();
    });
    // Nome do perseguidor, editável pelo mestre direto no painel.
    this.element.querySelector("[data-perseguidor]")?.addEventListener("change", (ev) => {
      void pedir("perseguidor", { nome: ev.target.value, configId: this.configId });
    });
  }

  async #aoSoltar(evento) {
    let dados;
    try { dados = JSON.parse(evento.dataTransfer.getData("text/plain")); } catch { return; }
    if (dados?.type !== "Actor") return;
    const doc = await fromUuid(dados.uuid);
    if (!doc) return;
    const papel = evento.target.closest("[data-zona]")?.dataset.zona ?? (doc.type === "personagem" ? "personagem" : "criatura");
    await pedir("adicionar", { uuid: doc.uuid, papel });
  }

  static async #iniciar() {
    await pedir("iniciar", { configId: this.configId });
  }

  static async #novaCena() {
    const id = await novaCena("perseguicao");
    if (id) this.configId = id;
    this.render();
  }

  static #configurar() {
    new ConfigCenaApp("perseguicao", this.configId).render({ force: true });
  }

  static async #encerrar() {
    const ok = await DialogV2.confirm({ window: { title: L("Encerrar") }, content: `<p>${esc(L("EncerrarPergunta"))}</p>`, rejectClose: false });
    if (ok) await pedir("encerrar");
  }

  static async #jogador(_e, alvo) {
    const { uuid, acao } = alvo.dataset;
    const doc = await fromUuid(uuid);
    const e = estadoPerseguicao();
    const p = acharP(e, uuid);
    if (!doc?.isOwner || !p) return;
    await ACOES[acao]?.(doc, e, p, alvo);
  }
}

let painel = null;
export function abrirPerseguicao() {
  if (!perseguicaoHabilitada()) return null;
  painel ??= new PerseguicaoApp();
  painel.render({ force: true });
  return painel;
}

/* -- registro ----------------------------------------------------------------- */

let estavaAtiva = false;
let ultimoEvento = null;

function somAmbiente(ativa) {
  let ligado = true;
  try { ligado = game.settings.get(SYSTEM_ID, "somPerseguicao"); } catch { /* sem setting */ }
  const daCena = estadoPerseguicao().config?.som !== false;
  if (ativa && ligado && daCena && perseguicaoHabilitada()) iniciarAmbientePerseguicao();
  else pararAmbientePerseguicao();
}

function aoMudar(valor) {
  if (!perseguicaoHabilitada()) return;
  const e = { ...VAZIO(), ...(valor ?? {}) };
  ligarVinheta("perseguicao", e.ativa && !e.fim);
  somAmbiente(e.ativa && !e.fim);
  if (e.ativa && !estavaAtiva) abrirPerseguicao();
  estavaAtiva = e.ativa;
  atualizarBotao(e.ativa);
  if (painel?.rendered) painel.render();
  if (e.evento?.id && e.evento.id !== ultimoEvento) {
    ultimoEvento = e.evento.id;
    (e.evento.mortos ?? []).forEach((uuid, i) => setTimeout(() => mostrarAlcancado(uuid, L("Alcancado")), 400 + i * 6400));
  }
}

function posicionarBotao() {
  const botao = document.getElementById("op2-botao-perseguicao");
  if (botao) botao.style.right = `${(document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0) + 12}px`;
}

function atualizarBotao(ativa) {
  const botao = document.getElementById("op2-botao-perseguicao");
  if (botao) botao.style.display = game.user.isGM || ativa ? "" : "none";
}

function criarBotao() {
  if (document.getElementById("op2-botao-perseguicao")) return;
  const botao = document.createElement("button");
  botao.id = "op2-botao-perseguicao";
  botao.type = "button";
  botao.className = "op2 op2-botao-flutuante op2-botao-flutuante--perseguicao";
  botao.dataset.tooltip = L("Titulo");
  botao.dataset.tooltipDirection = "LEFT";
  botao.innerHTML = `<i class="fa-solid fa-person-running" aria-hidden="true"></i>`;
  botao.addEventListener("click", () => (painel?.rendered ? painel.close() : abrirPerseguicao()));
  document.body.appendChild(botao);
  posicionarBotao();
  document.getElementById("sidebar")?.addEventListener("transitionend", posicionarBotao);
}

export function registrarPerseguicao() {
  game.settings.register(SYSTEM_ID, "perseguicaoHabilitada", {
    name: "OP2.Perseguicao.HabilitadaNome", hint: "OP2.Perseguicao.HabilitadaDica",
    scope: "world", config: true, type: Boolean, default: false, requiresReload: true,
  });
  game.settings.register(SYSTEM_ID, "somPerseguicao", {
    name: "OP2.Perseguicao.SomNome", hint: "OP2.Perseguicao.SomDica",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => somAmbiente(estadoPerseguicao().ativa && !estadoPerseguicao().fim),
  });
  game.settings.register(SYSTEM_ID, CHAVE, { scope: "world", config: false, type: Object, default: {}, onChange: aoMudar });
  registrarAcaoDeMestre("op2Perseguicao", executar);
  registrarAcaoDeTodos("op2PersEvento", mostrarEventoParaOutros);
  registrarAcaoDeTodos("op2PersEventoFim", fecharEventoParaOutros);
  Hooks.on("op2CenasConfig", () => { if (painel?.rendered) painel.render(); });
  Hooks.on("renderChatMessageHTML", ligarCardDeEmpate);
  Hooks.on("updateChatMessage", (msg, mudancas) => {
    if (!("rolls" in mudancas) || game.users.activeGM?.id !== game.user.id) return;
    if (estadoPerseguicao().participantes.some((p) => p.avancos?.[msg.id] !== undefined)) void executar({ op: "reavaliar", mensagemId: msg.id });
  });
  Hooks.once("ready", () => {
    if (!perseguicaoHabilitada()) return;
    precarregarEfeitos();
    const e = estadoPerseguicao();
    estavaAtiva = e.ativa;
    ultimoEvento = e.evento?.id ?? null;
    criarBotao();
    atualizarBotao(e.ativa);
    ligarVinheta("perseguicao", e.ativa && !e.fim);
    somAmbiente(e.ativa && !e.fim);
  });
  Hooks.on("collapseSidebar", () => setTimeout(posicionarBotao, 400));
  Hooks.on("updateActor", () => { if (painel?.rendered) painel.render(); });
}
