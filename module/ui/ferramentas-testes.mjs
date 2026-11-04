/**
 * Ferramentas do mestre — Solicitar teste, Teste oposto e Teste de equilíbrio.
 *
 * Os diálogos e os cards seguem o visual do GM Toolkit do sistema "ordemparanormal2":
 * cartão do participante com retrato, perícia e o que o teste soma. A solicitação
 * fica "aguardando rolagem" no chat; quem controla o personagem clica em Rolar, faz o
 * teste no diálogo do sistema e o card é SUBSTITUÍDO pelo resultado.
 */
import { SYSTEM_ID, PERICIAS, APTIDOES_PADRAO, ATRIBUTOS } from "../config.mjs";
import { rolarTeste, rotuloDePericia, htmlDoTeste } from "../dice/teste.mjs";
import { lerConfig } from "../settings/register.mjs";
import { registrarAcaoDeMestre, comoMestre } from "./socket.mjs";
import { registrarAcaoDeChat } from "./chat.mjs";
import { iniciarEquilibrio } from "../cena/equilibrio.mjs";

const { DialogV2 } = foundry.applications.api;
const L = (chave) => game.i18n.localize(`OP2.Ferramentas.${chave}`);
const F = (chave, dados) => game.i18n.format(`OP2.Ferramentas.${chave}`, dados);
const esc = (texto) => foundry.utils.escapeHTML(String(texto ?? ""));
const IMG_PADRAO = "icons/svg/mystery-man.svg";

export const personagens = () => game.actors.filter((a) => a.type === "personagem");
export const testaveis = () => game.actors.filter((a) => a.type === "personagem" || a.type === "npc");
export const selecionados = () => (canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter(Boolean);

/* ------------------------------------------------------------------ */
/* Perícias e composição                                                */
/* ------------------------------------------------------------------ */

export function rotuloDeChave(chave, ator = null) {
  if (!chave) return "";
  if (ATRIBUTOS[chave]) return game.i18n.localize(`OP2.Atributo.${chave}`);
  if (chave.startsWith("aptidao.")) {
    const sub = chave.slice("aptidao.".length);
    const proprio = ator?.system?.aptidoes?.[sub]?.rotulo;
    return proprio ? `${game.i18n.localize("OP2.Pericia.aptidao")} (${proprio})` : rotuloDePericia(chave);
  }
  if (PERICIAS[chave]) return rotuloDePericia(chave);
  return ator?.system?.pericias?.[chave]?.rotulo || chave;
}

/** Chaves de teste do próprio ator (NPC tem lista reduzida; personagem pode ter aptidões extras). */
export function chavesDoAtor(ator) {
  if (ator?.type === "npc") {
    return [...Object.keys(ator.system.atributos ?? {}), ...Object.keys(ator.system.pericias ?? {})];
  }
  const chaves = [...Object.keys(ATRIBUTOS)];
  for (const chave of Object.keys(PERICIAS)) {
    if (chave !== "aptidao") chaves.push(chave);
  }
  const aptidoes = Object.keys(ator?.system?.aptidoes ?? {});
  chaves.push(...(aptidoes.length ? aptidoes : APTIDOES_PADRAO).map((a) => `aptidao.${a}`));
  return chaves;
}

function opcoesDePericia(chaves, ator = null, selecionada = "percepcao") {
  return chaves
    .map((c) => ({ c, r: rotuloDeChave(c, ator) }))
    .sort((a, b) => a.r.localeCompare(b.r, "pt-BR"))
    .map(({ c, r }) => `<option value="${esc(c)}" ${c === selecionada ? "selected" : ""}>${esc(r)}</option>`)
    .join("");
}

/** Atributo pareado (nulo para atributo puro e NPC). */
function atributoDaChave(ator, chave) {
  if (!ator || ator.type === "npc" || ATRIBUTOS[chave]) return null;
  if (chave.startsWith("aptidao.")) return ator.system.pericias?.aptidao?.atributo ?? "mente";
  return ator.system.pericias?.[chave]?.atributo ?? PERICIAS[chave]?.atributo ?? null;
}

/** "Físico + Atletismo" — o que o teste soma. */
function composicao(ator, chave) {
  if (!ator || !chave) return "—";
  const atributo = atributoDaChave(ator, chave);
  const rotulo = rotuloDeChave(chave, ator);
  return atributo ? `${game.i18n.localize(`OP2.Atributo.${atributo}`)} + ${rotulo}` : rotulo;
}

function rotuloDesfecho(resultado) {
  const mapa = {
    critico: "OP2.Ferramentas.Desfecho.critico",
    "falha-critica": "OP2.Ferramentas.Desfecho.falhaCritica",
    sucesso: "OP2.Ferramentas.Desfecho.sucesso",
    falha: "OP2.Ferramentas.Desfecho.falha",
  };
  return mapa[resultado?.desfecho] ? game.i18n.localize(mapa[resultado.desfecho]) : "";
}

/* ------------------------------------------------------------------ */
/* Bloco do participante nos diálogos                                   */
/* ------------------------------------------------------------------ */

function blocoParticipante({ id, titulo, atores, atorId, chave, comDT = false, dt = "" }) {
  const ator = game.actors.get(atorId);
  const opcoesAtor = `<option value="">${L("SelecionePersonagem")}</option>${atores
    .map((a) => `<option value="${a.id}" ${a.id === atorId ? "selected" : ""}>${esc(a.name)}${a.type === "npc" ? " (NPC)" : ""}</option>`).join("")}`;
  const opcoesTeste = ator
    ? opcoesDePericia(chavesDoAtor(ator), ator, chave)
    : `<option value="">${L("SelecioneTeste")}</option>`;
  return `<div class="op2-part" data-part="${id}">
    <span class="op2-part__titulo">${esc(titulo)}</span>
    <img class="op2-part__img" src="${esc(ator?.img ?? IMG_PADRAO)}" alt="">
    <strong class="op2-part__nome">${esc(ator?.name ?? L("NenhumParticipante"))}</strong>
    <label>${L("Personagem")}<select name="ator${id}" data-part-ator="${id}">${opcoesAtor}</select></label>
    <label>${L("Teste")}<select name="pericia${id}" data-part-teste="${id}" ${ator ? "" : "disabled"}>${opcoesTeste}</select></label>
    ${comDT ? `<label>${L("DtOpcional")}<input type="number" name="dt" min="1" value="${dt}" placeholder="—"></label>` : ""}
    <div class="op2-part__resumo"><strong data-part-rotulo="${id}">${esc(ator ? rotuloDeChave(chave, ator) : L("NenhumTeste"))}</strong>
      <span data-part-comp="${id}">${esc(ator ? composicao(ator, chave) : "—")}</span></div>
  </div>`;
}

/** Trocar o ator troca retrato, lista de testes e resumo. */
function ligarParticipante(raiz, id, aoMudar = () => {}) {
  const selAtor = raiz.querySelector(`[data-part-ator="${id}"]`);
  const selTeste = raiz.querySelector(`[data-part-teste="${id}"]`);
  const bloco = raiz.querySelector(`[data-part="${id}"]`);
  if (!selAtor || !selTeste || !bloco) return;
  const atualizarResumo = () => {
    const ator = game.actors.get(selAtor.value);
    const ok = ator && selTeste.value;
    bloco.querySelector(`[data-part-rotulo="${id}"]`).textContent = ok ? rotuloDeChave(selTeste.value, ator) : L("NenhumTeste");
    bloco.querySelector(`[data-part-comp="${id}"]`).textContent = ok ? composicao(ator, selTeste.value) : "—";
    aoMudar();
  };
  selAtor.addEventListener("change", () => {
    const ator = game.actors.get(selAtor.value);
    bloco.querySelector(".op2-part__img").src = ator?.img ?? IMG_PADRAO;
    bloco.querySelector(".op2-part__nome").textContent = ator?.name ?? L("NenhumParticipante");
    selTeste.innerHTML = ator
      ? opcoesDePericia(chavesDoAtor(ator), ator, selTeste.value || "percepcao")
      : `<option value="">${L("SelecioneTeste")}</option>`;
    selTeste.disabled = !ator;
    atualizarResumo();
  });
  selTeste.addEventListener("change", atualizarResumo);
}

const cabecalhoDialogo = (titulo, subtitulo) =>
  `<header class="op2-dlg__topo"><h2>${esc(titulo)}</h2><p>${esc(subtitulo)}</p></header>`;

/* ------------------------------------------------------------------ */
/* Solicitar teste                                                      */
/* ------------------------------------------------------------------ */

function htmlSolicitacao(dados) {
  const topo = `<header class="op2-req__topo">
      <img src="${esc(dados.img)}" alt="">
      <div><strong class="op2-req__pericia">${esc(dados.rotulo)}</strong><span>${esc(dados.nome)}</span></div>
      ${dados.semDT ? "" : `<span class="op2-req__dt">DT ${dados.dt}</span>`}
    </header>`;
  const motivo = dados.motivo ? `<p class="op2-req__motivo">${esc(dados.motivo)}</p>` : "";
  if (dados.resultadoHtml) {
    return `<div class="op2-card op2-req op2-req--resolvida">${topo}${motivo}
      <div class="op2-req__resultado">${dados.resultadoHtml}</div></div>`;
  }
  return `<div class="op2-card op2-req">${topo}${motivo}
    <p class="op2-req__status"><i class="fa-regular fa-hourglass-half"></i> ${L("AguardandoRolagem")}</p>
    <p class="op2-req__comp">${esc(dados.composicao)}</p>
    <button type="button" class="op2-req__rolar" data-op2-acao="ferr-solicitado" data-ator-id="${esc(dados.atorId)}">${L("Rolar")}</button>
  </div>`;
}

export async function solicitarTeste() {
  const atores = personagens();
  if (!atores.length) return void ui.notifications.warn(L("SemPersonagens"));
  const padrao = selecionados().find((a) => a.type === "personagem")?.id
    ?? atores.find((a) => a.hasPlayerOwner)?.id ?? atores[0].id;

  const resposta = await DialogV2.wait({
    window: { title: L("SolicitarTeste"), icon: "fa-solid fa-dice" },
    classes: ["op2", "op2-dlg", "op2-dlg--solicitar"],
    position: { width: 460 },
    content: `${cabecalhoDialogo(L("SolicitarTeste"), L("SolicitarSub"))}
      ${blocoParticipante({ id: "A", titulo: L("Participante"), atores, atorId: padrao, chave: "atletismo", comDT: true, dt: lerConfig("dtPadrao") })}
      <label class="op2-dlg__motivo">${L("Motivo")}<input type="text" name="motivo" placeholder="${L("MotivoDica")}"></label>`,
    render: (_evento, dialogo) => ligarParticipante(dialogo.element ?? dialogo, "A"),
    buttons: [
      {
        action: "ok", label: L("CriarSolicitacao"), icon: "fa-solid fa-paper-plane", default: true, class: "op2-dlg__primario",
        callback: (_evento, botao) => {
          const f = botao.form.elements;
          return { atorId: f.atorA.value, pericia: f.periciaA.value, dt: f.dt.value, motivo: f.motivo.value.trim() };
        },
      },
      { action: "cancel", label: L("Cancelar") },
    ],
    rejectClose: false,
  });
  if (!resposta || resposta === "cancel") return;
  const ator = game.actors.get(resposta.atorId);
  if (!ator || !resposta.pericia) return void ui.notifications.warn(L("NenhumSelecionado"));

  const dt = Number(resposta.dt);
  const dados = {
    atorId: ator.id, nome: ator.name, img: ator.img,
    pericia: resposta.pericia,
    rotulo: rotuloDeChave(resposta.pericia, ator),
    composicao: composicao(ator, resposta.pericia),
    dt: dt || null,
    semDT: !dt,
    motivo: resposta.motivo,
    resultadoHtml: null,
  };
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: L("Mestre") }),
    content: htmlSolicitacao(dados),
    flags: { [SYSTEM_ID]: { tipo: "solicitacao", solicitacao: dados } },
  });
}

/* ------------------------------------------------------------------ */
/* Teste oposto                                                         */
/* ------------------------------------------------------------------ */

function vencedorOposto(lados) {
  const [a, b] = lados.map((l) => l.resultado);
  if (!a || !b) return null;
  // Crítico vence, falha crítica perde; depois maior total; empate fica empatado.
  const peso = (r) => (r.desfecho === "critico" ? 1 : r.desfecho === "falha-critica" ? -1 : 0);
  if (peso(a) !== peso(b)) return peso(a) > peso(b) ? 0 : 1;
  if (a.total !== b.total) return a.total > b.total ? 0 : 1;
  return -1;
}

function htmlOposto(dados) {
  const vencedor = vencedorOposto(dados.lados);
  const lado = (l, i) => {
    const r = l.resultado;
    const extremo = r && (r.desfecho === "critico" || r.desfecho === "falha-critica");
    const corpo = r
      ? `<div class="op2-op__total ${vencedor === i ? "vencedor" : ""}">${r.total}</div>
         <div class="op2-op__dados">${(r.dados ?? []).map((d) => `<span class="${d.contado ? "" : "fora"}">${d.resultado}</span>`).join("")}</div>
         ${extremo ? `<span class="op2-op__desfecho op2-op__desfecho--${r.desfecho}">${esc(rotuloDesfecho(r))}</span>` : ""}`
      : `<p class="op2-req__status"><i class="fa-regular fa-hourglass-half"></i> ${L("Aguardando")}</p>
         <button type="button" class="op2-req__rolar" data-op2-acao="ferr-oposto" data-ator-id="${esc(l.atorId)}" data-lado="${i}">${L("Rolar")}</button>`;
    return `<div class="op2-op__lado ${vencedor === i ? "op2-op__lado--vencedor" : ""}">
      <img src="${esc(l.img)}" alt=""><strong>${esc(l.nome)}</strong><span class="op2-op__teste">${esc(l.rotulo)}</span>
      <span class="op2-op__comp">${esc(l.composicao ?? "")}</span>${corpo}</div>`;
  };
  let veredito = "";
  if (vencedor === -1) veredito = L("Empate");
  else if (vencedor !== null) veredito = F("Venceu", { nome: esc(dados.lados[vencedor].nome) });
  return `<div class="op2-card op2-op">
    <header class="op2-op__cab"><i class="fa-solid fa-swords"></i> ${L("TesteOposto")}</header>
    ${dados.motivo ? `<p class="op2-req__motivo">${esc(dados.motivo)}</p>` : ""}
    <div class="op2-op__lados">${lado(dados.lados[0], 0)}<span class="op2-op__vs">VS</span>${lado(dados.lados[1], 1)}</div>
    ${veredito ? `<p class="op2-op__veredito">${veredito}</p>` : ""}
  </div>`;
}

export async function testeOposto() {
  const atores = testaveis();
  if (!atores.length) return void ui.notifications.warn(L("SemPersonagens"));
  const sel = selecionados();

  const resposta = await DialogV2.wait({
    window: { title: L("TesteOposto"), icon: "fa-solid fa-swords" },
    classes: ["op2", "op2-dlg", "op2-dlg--oposto"],
    position: { width: 660 },
    content: `${cabecalhoDialogo(L("TesteOposto"), L("OpostoSub"))}
      <div class="op2-dlg__lados">
        ${blocoParticipante({ id: "A", titulo: L("ParticipanteA"), atores, atorId: sel[0]?.id ?? "", chave: "luta" })}
        <span class="op2-dlg__vs">VS</span>
        ${blocoParticipante({ id: "B", titulo: L("ParticipanteB"), atores, atorId: sel[1]?.id ?? "", chave: "luta" })}
      </div>
      <label class="op2-dlg__motivo">${L("Motivo")}<input type="text" name="motivo" placeholder="${L("MotivoDica")}"></label>`,
    render: (_evento, dialogo) => {
      const raiz = dialogo.element ?? dialogo;
      const botao = raiz.querySelector('[data-action="ok"]');
      const validar = () => {
        const f = raiz.querySelector("form")?.elements;
        if (botao && f) botao.disabled = !(f.atorA.value && f.atorB.value && f.periciaA.value && f.periciaB.value);
      };
      ligarParticipante(raiz, "A", validar);
      ligarParticipante(raiz, "B", validar);
      validar();
    },
    buttons: [
      {
        action: "ok", label: L("CriarTeste"), icon: "fa-solid fa-check", default: true, class: "op2-dlg__primario",
        callback: (_evento, botao) => {
          const f = botao.form.elements;
          return {
            lados: ["A", "B"].map((n) => ({ atorId: f[`ator${n}`].value, pericia: f[`pericia${n}`].value })),
            motivo: f.motivo.value.trim(),
          };
        },
      },
      { action: "cancel", label: L("Cancelar") },
    ],
    rejectClose: false,
  });
  if (!resposta || resposta === "cancel") return;
  if (resposta.lados.some((l) => !game.actors.get(l.atorId) || !l.pericia)) {
    return void ui.notifications.warn(L("NenhumSelecionado"));
  }

  const dados = {
    motivo: resposta.motivo,
    lados: resposta.lados.map(({ atorId, pericia }) => {
      const a = game.actors.get(atorId);
      return {
        atorId, pericia, rotulo: rotuloDeChave(pericia, a), composicao: composicao(a, pericia),
        nome: a.name, img: a.img, resultado: null,
      };
    }),
  };
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: L("Mestre") }),
    content: htmlOposto(dados),
    flags: { [SYSTEM_ID]: { tipo: "oposto", oposto: dados } },
  });
}

/* ------------------------------------------------------------------ */
/* Teste de equilíbrio (escolher o personagem)                          */
/* ------------------------------------------------------------------ */

export async function testeDeEquilibrio() {
  const atores = personagens();
  if (!atores.length) return void ui.notifications.warn(L("SemPersonagens"));
  const padrao = selecionados()[0]?.id ?? atores[0].id;
  const opcoes = atores.map((a) => `<option value="${a.id}" ${a.id === padrao ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const id = await DialogV2.prompt({
    window: { title: game.i18n.localize("OP2.Equilibrio.Titulo"), icon: "fa-solid fa-person-falling" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: `<p class="op2-ajuda">${game.i18n.localize("OP2.Equilibrio.Regra")}</p>
      <div class="form-group"><label>${L("Personagem")}</label><select name="ator">${opcoes}</select></div>`,
    ok: { label: game.i18n.localize("OP2.Equilibrio.Iniciar"), callback: (_e, botao) => botao.form.elements.ator.value },
    rejectClose: false,
  });
  if (id) await iniciarEquilibrio(game.actors.get(id));
}

/* ------------------------------------------------------------------ */
/* Ações dos cards de chat + gravação pelo mestre                       */
/* ------------------------------------------------------------------ */

function resumo(roll) {
  const r = roll.resultado;
  return {
    total: r.total, desfecho: r.desfecho, sucesso: r.sucesso,
    dados: roll.dados.filter((d) => !d.pavor).map((d) => ({ resultado: d.resultado, contado: d.contado })),
  };
}

async function rolarSolicitado(ator, dataset) {
  if (!ator.isOwner) return void ui.notifications.warn(L("SemPermissao"));
  const mensagem = game.messages.get(dataset.mensagemId);
  const dados = mensagem?.getFlag(SYSTEM_ID, "solicitacao");
  if (!dados || dados.resultadoHtml) return;
  const roll = await rolarTeste(ator, {
    chavePericia: dados.pericia, dt: dados.semDT ? null : dados.dt, semDT: dados.semDT,
    contexto: dados.rotulo, semCard: true,
  });
  if (!roll) return;
  const html = await htmlDoTeste(roll, ator);
  await comoMestre("ferrRegistrarSolicitacao", { mensagemId: mensagem.id, html });
}

async function rolarOposto(ator, dataset) {
  if (!ator.isOwner) return void ui.notifications.warn(L("SemPermissao"));
  const mensagem = game.messages.get(dataset.mensagemId);
  const dados = mensagem?.getFlag(SYSTEM_ID, "oposto");
  const indice = Number(dataset.lado);
  const lado = dados?.lados?.[indice];
  if (!lado || lado.resultado) return;
  const roll = await rolarTeste(ator, { chavePericia: lado.pericia, oposto: true, contexto: lado.rotulo, semCard: true });
  if (!roll) return;
  await comoMestre("ferrRegistrarOposto", { mensagemId: mensagem.id, indice, resultado: resumo(roll) });
}

async function registrarSolicitacao({ mensagemId, html }) {
  const mensagem = game.messages.get(mensagemId);
  const dados = foundry.utils.deepClone(mensagem?.getFlag(SYSTEM_ID, "solicitacao"));
  if (!dados) return;
  dados.resultadoHtml = html;
  await mensagem.update({ content: htmlSolicitacao(dados), [`flags.${SYSTEM_ID}.solicitacao`]: dados });
}

async function registrarOposto({ mensagemId, indice, resultado }) {
  const mensagem = game.messages.get(mensagemId);
  const dados = foundry.utils.deepClone(mensagem?.getFlag(SYSTEM_ID, "oposto"));
  if (!dados?.lados?.[indice]) return;
  dados.lados[indice].resultado = resultado;
  await mensagem.update({ content: htmlOposto(dados), [`flags.${SYSTEM_ID}.oposto`]: dados });
}

export function registrarTestesDoMestre() {
  registrarAcaoDeChat("ferr-solicitado", rolarSolicitado);
  registrarAcaoDeChat("ferr-oposto", rolarOposto);
  registrarAcaoDeMestre("ferrRegistrarSolicitacao", registrarSolicitacao);
  registrarAcaoDeMestre("ferrRegistrarOposto", registrarOposto);
}
