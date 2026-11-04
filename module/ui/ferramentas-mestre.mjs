/**
 * Ferramentas do mestre — paleta flutuante e arrastável (só GM) com atalhos para:
 * Solicitar teste, Teste oposto, Desafios de acesso e Importar aventura.
 *
 * Ideia portada do sistema "ordemparanormal2" (antoniohbmonteiro), reescrita sobre as
 * mecânicas deste sistema: `rolarTeste`, os desafios de acesso de `acoes-desafio.mjs`
 * e a janela de aventuras.
 */
import { SYSTEM_ID, PERICIAS, APTIDOES_PADRAO, ATRIBUTOS } from "../config.mjs";
import { rolarTeste, rotuloDePericia } from "../dice/teste.mjs";
import { lerConfig } from "../settings/register.mjs";
import { registrarAcaoDeMestre, comoMestre } from "./socket.mjs";
import { registrarAcaoDeChat } from "./chat.mjs";
import { abrirAventurasApp } from "../aventura/aventuras-app.mjs";
import { investigacaoAtiva, todasInvestigacoes, removerDesafio } from "../cena/investigacao-ativa.mjs";
import {
  arrombar, hackTecnico, hackSocial, desafioGenerico, sustentar,
} from "../cena/acoes-desafio.mjs";
import { abrirDestrancar, iniciarDestrancar } from "../cena/destrancar-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const ICONES = `systems/${SYSTEM_ID}/assets/icons/ferramentas-mestre`;
const L = (chave) => game.i18n.localize(`OP2.Ferramentas.${chave}`);
const F = (chave, dados) => game.i18n.format(`OP2.Ferramentas.${chave}`, dados);
const esc = (texto) => foundry.utils.escapeHTML(String(texto ?? ""));

/* ------------------------------------------------------------------ */
/* Perícias                                                             */
/* ------------------------------------------------------------------ */

function rotuloDeChave(chave, ator = null) {
  if (ATRIBUTOS[chave]) return game.i18n.localize(`OP2.Atributo.${chave}`);
  if (chave.startsWith("aptidao.") || PERICIAS[chave]) return rotuloDePericia(chave);
  return ator?.system?.pericias?.[chave]?.rotulo || chave;
}

/** Chaves de teste que valem para qualquer personagem. */
function chavesGerais() {
  const chaves = [...Object.keys(ATRIBUTOS)];
  for (const chave of Object.keys(PERICIAS)) {
    if (chave === "aptidao") chaves.push(...APTIDOES_PADRAO.map((a) => `aptidao.${a}`));
    else chaves.push(chave);
  }
  return chaves;
}

/** Chaves de teste do próprio ator (NPC tem lista reduzida; personagem pode ter aptidões extras). */
function chavesDoAtor(ator) {
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

const personagens = () => game.actors.filter((a) => a.type === "personagem");
const testaveis = () => game.actors.filter((a) => a.type === "personagem" || a.type === "npc");
const selecionados = () => (canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter(Boolean);

function rotuloDesfecho(resultado) {
  if (!resultado) return "";
  const mapa = {
    critico: "OP2.Ferramentas.Desfecho.critico",
    "falha-critica": "OP2.Ferramentas.Desfecho.falhaCritica",
    sucesso: "OP2.Ferramentas.Desfecho.sucesso",
    falha: "OP2.Ferramentas.Desfecho.falha",
  };
  return mapa[resultado.desfecho] ? game.i18n.localize(mapa[resultado.desfecho]) : "";
}

/* ------------------------------------------------------------------ */
/* Solicitar teste                                                      */
/* ------------------------------------------------------------------ */

function htmlSolicitacao(dados) {
  const dt = dados.semDT ? L("SemDT") : `DT ${dados.dt}`;
  const linhas = dados.alvos.map((alvo) => {
    const r = alvo.resultado;
    const acao = r
      ? `<span class="op2-ferr-res op2-ferr-${esc(r.desfecho)}">${r.total} · ${esc(rotuloDesfecho(r) || L("Rolado"))}</span>`
      : `<button type="button" data-op2-acao="ferr-solicitado" data-ator-id="${esc(alvo.atorId)}">${L("Rolar")}</button>`;
    return `<li><img src="${esc(alvo.img)}" alt=""><span class="op2-ferr-nome">${esc(alvo.nome)}</span>${acao}</li>`;
  }).join("");
  return `<div class="op2-card op2-ferr-card">
    <header><i class="fa-solid fa-dice"></i> ${L("SolicitarTeste")}</header>
    <p class="op2-ferr-sub"><strong>${esc(dados.rotulo)}</strong> · ${esc(dt)}</p>
    ${dados.motivo ? `<p class="op2-ferr-motivo">${esc(dados.motivo)}</p>` : ""}
    <ul class="op2-ferr-lista">${linhas}</ul>
  </div>`;
}

async function solicitarTeste() {
  const atores = personagens();
  if (!atores.length) return void ui.notifications.warn(L("SemPersonagens"));
  const marcados = new Set(selecionados().map((a) => a.id));
  const nenhumMarcado = marcados.size === 0;
  const checks = atores.map((a) => {
    const marcado = nenhumMarcado ? a.hasPlayerOwner : marcados.has(a.id);
    return `<label class="op2-ferr-check"><input type="checkbox" name="atores" value="${a.id}" ${marcado ? "checked" : ""}>
      <img src="${esc(a.img)}" alt=""> ${esc(a.name)}</label>`;
  }).join("");

  const conteudo = `<div class="op2-ferr-form">
    <fieldset><legend>${L("Personagens")}</legend><div class="op2-ferr-checks">${checks}</div></fieldset>
    <div class="form-group"><label>${L("Pericia")}</label><select name="pericia">${opcoesDePericia(chavesGerais())}</select></div>
    <div class="form-group"><label>DT</label><input type="number" name="dt" min="1" value="${lerConfig("dtPadrao")}"></div>
    <div class="form-group"><label>${L("SemDT")}</label><input type="checkbox" name="semDT"></div>
    <div class="form-group"><label>${L("Motivo")}</label><input type="text" name="motivo" placeholder="${L("MotivoDica")}"></div>
  </div>`;

  const resposta = await DialogV2.prompt({
    window: { title: L("SolicitarTeste"), icon: "fa-solid fa-dice" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: conteudo,
    ok: {
      label: L("Enviar"),
      icon: "fa-solid fa-paper-plane",
      callback: (_evento, botao) => {
        const form = botao.form;
        return {
          atores: [...form.querySelectorAll("input[name=atores]:checked")].map((i) => i.value),
          pericia: form.elements.pericia.value,
          dt: Number(form.elements.dt.value) || lerConfig("dtPadrao"),
          semDT: form.elements.semDT.checked,
          motivo: form.elements.motivo.value.trim(),
        };
      },
    },
    rejectClose: false,
  });
  if (!resposta) return;
  if (!resposta.atores.length) return void ui.notifications.warn(L("NenhumSelecionado"));

  const dados = {
    pericia: resposta.pericia,
    rotulo: rotuloDeChave(resposta.pericia),
    dt: resposta.dt,
    semDT: resposta.semDT,
    motivo: resposta.motivo,
    alvos: resposta.atores.map((id) => {
      const a = game.actors.get(id);
      return { atorId: id, nome: a.name, img: a.img, resultado: null };
    }),
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
  const linhas = dados.lados.map((lado, i) => {
    const r = lado.resultado;
    const acao = r
      ? `<span class="op2-ferr-res ${vencedor === i ? "op2-ferr-sucesso" : ""}">${r.total}${r.desfecho === "critico" || r.desfecho === "falha-critica" ? ` · ${esc(rotuloDesfecho(r))}` : ""}</span>`
      : `<button type="button" data-op2-acao="ferr-oposto" data-ator-id="${esc(lado.atorId)}" data-lado="${i}">${L("Rolar")}</button>`;
    return `<li><img src="${esc(lado.img)}" alt=""><span class="op2-ferr-nome">${esc(lado.nome)}<small>${esc(lado.rotulo)}</small></span>${acao}</li>`;
  }).join(`<li class="op2-ferr-vs">VS</li>`);
  let rodape = "";
  if (vencedor === -1) rodape = `<p class="op2-ferr-veredito">${L("Empate")}</p>`;
  else if (vencedor !== null) rodape = `<p class="op2-ferr-veredito">${F("Venceu", { nome: esc(dados.lados[vencedor].nome) })}</p>`;
  return `<div class="op2-card op2-ferr-card">
    <header><i class="fa-solid fa-swords"></i> ${L("TesteOposto")}</header>
    ${dados.motivo ? `<p class="op2-ferr-motivo">${esc(dados.motivo)}</p>` : ""}
    <ul class="op2-ferr-lista">${linhas}</ul>${rodape}
  </div>`;
}

async function testeOposto() {
  const atores = testaveis();
  if (atores.length < 1) return void ui.notifications.warn(L("SemPersonagens"));
  const sel = selecionados();
  const padraoA = sel[0]?.id ?? atores[0].id;
  const padraoB = sel[1]?.id ?? atores.find((a) => a.id !== padraoA)?.id ?? padraoA;
  const opcoesAtor = (padrao) => atores
    .map((a) => `<option value="${a.id}" ${a.id === padrao ? "selected" : ""}>${esc(a.name)}${a.type === "npc" ? " (NPC)" : ""}</option>`)
    .join("");
  const lado = (n, padrao) => `<fieldset><legend>${F("Lado", { n })}</legend>
    <div class="form-group"><label>${L("Ator")}</label><select name="ator${n}" data-lado="${n}">${opcoesAtor(padrao)}</select></div>
    <div class="form-group"><label>${L("Pericia")}</label><select name="pericia${n}">${opcoesDePericia(chavesDoAtor(game.actors.get(padrao)), game.actors.get(padrao))}</select></div>
  </fieldset>`;

  const conteudo = `<div class="op2-ferr-form">${lado(1, padraoA)}${lado(2, padraoB)}
    <div class="form-group"><label>${L("Motivo")}</label><input type="text" name="motivo" placeholder="${L("MotivoDica")}"></div></div>`;

  const resposta = await DialogV2.prompt({
    window: { title: L("TesteOposto"), icon: "fa-solid fa-swords" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: conteudo,
    render: (_evento, dialogo) => {
      const raiz = dialogo.element ?? dialogo;
      for (const select of raiz.querySelectorAll("select[data-lado]")) {
        select.addEventListener("change", () => {
          const ator = game.actors.get(select.value);
          const alvo = raiz.querySelector(`select[name=pericia${select.dataset.lado}]`);
          alvo.innerHTML = opcoesDePericia(chavesDoAtor(ator), ator, alvo.value);
        });
      }
    },
    ok: {
      label: L("Enviar"),
      icon: "fa-solid fa-paper-plane",
      callback: (_evento, botao) => {
        const f = botao.form.elements;
        return {
          lados: [1, 2].map((n) => ({ atorId: f[`ator${n}`].value, pericia: f[`pericia${n}`].value })),
          motivo: f.motivo.value.trim(),
        };
      },
    },
    rejectClose: false,
  });
  if (!resposta) return;

  const dados = {
    motivo: resposta.motivo,
    lados: resposta.lados.map(({ atorId, pericia }) => {
      const a = game.actors.get(atorId);
      return { atorId, pericia, rotulo: rotuloDeChave(pericia, a), nome: a.name, img: a.img, resultado: null };
    }),
  };
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: L("Mestre") }),
    content: htmlOposto(dados),
    flags: { [SYSTEM_ID]: { tipo: "oposto", oposto: dados } },
  });
}

/* ------------------------------------------------------------------ */
/* Ações dos cards de chat + gravação pelo mestre                       */
/* ------------------------------------------------------------------ */

function mensagemDoBotao(dataset) {
  return game.messages.get(dataset.mensagemId);
}

function resumo(roll) {
  const r = roll.resultado;
  return { total: r.total, desfecho: r.desfecho, sucesso: r.sucesso };
}

async function rolarSolicitado(ator, dataset) {
  if (!ator.isOwner) return void ui.notifications.warn(L("SemPermissao"));
  const mensagem = mensagemDoBotao(dataset);
  const dados = mensagem?.getFlag(SYSTEM_ID, "solicitacao");
  if (!dados) return;
  const roll = await rolarTeste(ator, {
    chavePericia: dados.pericia, dt: dados.semDT ? null : dados.dt, semDT: dados.semDT,
    contexto: dados.motivo || undefined,
  });
  if (!roll) return;
  await comoMestre("ferrRegistrarSolicitacao", { mensagemId: mensagem.id, atorId: ator.id, resultado: resumo(roll) });
}

async function rolarOposto(ator, dataset) {
  if (!ator.isOwner) return void ui.notifications.warn(L("SemPermissao"));
  const mensagem = mensagemDoBotao(dataset);
  const dados = mensagem?.getFlag(SYSTEM_ID, "oposto");
  const indice = Number(dataset.lado);
  const lado = dados?.lados?.[indice];
  if (!lado) return;
  const roll = await rolarTeste(ator, { chavePericia: lado.pericia, oposto: true, contexto: dados.motivo || undefined });
  if (!roll) return;
  await comoMestre("ferrRegistrarOposto", { mensagemId: mensagem.id, indice, resultado: resumo(roll) });
}

async function registrarSolicitacao({ mensagemId, atorId, resultado }) {
  const mensagem = game.messages.get(mensagemId);
  const dados = foundry.utils.deepClone(mensagem?.getFlag(SYSTEM_ID, "solicitacao"));
  if (!dados) return;
  const alvo = dados.alvos.find((a) => a.atorId === atorId);
  if (!alvo) return;
  alvo.resultado = resultado;
  await mensagem.update({ content: htmlSolicitacao(dados), [`flags.${SYSTEM_ID}.solicitacao`]: dados });
}

async function registrarOposto({ mensagemId, indice, resultado }) {
  const mensagem = game.messages.get(mensagemId);
  const dados = foundry.utils.deepClone(mensagem?.getFlag(SYSTEM_ID, "oposto"));
  if (!dados?.lados?.[indice]) return;
  dados.lados[indice].resultado = resultado;
  await mensagem.update({ content: htmlOposto(dados), [`flags.${SYSTEM_ID}.oposto`]: dados });
}

/* ------------------------------------------------------------------ */
/* Desafios de acesso                                                   */
/* ------------------------------------------------------------------ */

const ABORDAGENS = ["arrombar", "destrancar", "hackTecnico", "hackSocial", "sustentar", "generico"];

class DesafiosApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-ferr-desafios",
    classes: ["op2", "op2-ferr-desafios"],
    window: { title: "OP2.Ferramentas.DesafiosAcesso", icon: "fa-solid fa-lock", resizable: true },
    position: { width: 520, height: 560 },
    actions: {
      abordagem: DesafiosApp.#abordagem,
      abrir: DesafiosApp.#abrir,
      novo: DesafiosApp.#novo,
      excluir: DesafiosApp.#excluir,
      monitorar: DesafiosApp.#monitorar,
      escopo: DesafiosApp.#escopo,
    },
  };

  static PARTS = { main: { template: `systems/${SYSTEM_ID}/templates/ui/ferramentas-desafios.hbs`, scrollable: [".op2-ferr-lista-desafios"] } };

  atorId = null;
  todos = false;

  async _prepareContext() {
    const investigacao = investigacaoAtiva();
    // Participantes da investigação primeiro, depois os demais personagens e NPCs.
    const daCena = (investigacao?.system.participantes ?? [])
      .map((uuid) => fromUuidSync(uuid)).filter((a) => a?.documentName === "Actor");
    const vistos = new Set();
    const atores = [...daCena, ...personagens(), ...game.actors.filter((a) => a.type === "npc")]
      .filter((a) => (vistos.has(a.id) ? false : vistos.add(a.id)));
    if (!this.atorId || !atores.some((a) => a.id === this.atorId)) {
      this.atorId = selecionados()[0]?.id ?? atores[0]?.id ?? null;
    }
    let itens;
    if (!this.todos && investigacao) {
      itens = (await Promise.all((investigacao.system.desafios ?? []).map((uuid) => fromUuid(uuid)))).filter(Boolean);
    } else {
      itens = game.items.filter((i) => i.type === "desafio-acesso");
    }
    const desafios = itens.map((item) => {
      const ab = item.system.abordagens ?? {};
      const s = item.system;
      const sessao = item.getFlag(SYSTEM_ID, "sessao");
      let estado = "";
      if (s.destrancado) estado = L("Estado.destrancado");
      else if (s.quebrado) estado = L("Estado.quebrado");
      else if (sessao?.ativa) estado = F("Estado.emCurso", { nome: game.actors.get(sessao.atorId)?.name ?? "?" });
      return {
        uuid: item.uuid,
        nome: item.name,
        estado,
        emCurso: Boolean(sessao?.ativa) && !s.destrancado && !s.quebrado,
        img: item.img,
        abordagens: ABORDAGENS.filter((chave) => ab[chave]).map((chave) => ({
          chave,
          rotulo: chave === "generico" && item.system.generico?.rotulo
            ? item.system.generico.rotulo
            : game.i18n.localize(`OP2.Ferramentas.Abordagem.${chave}`),
        })),
      };
    });
    return {
      atores: atores.map((a) => ({
        id: a.id, nome: a.type === "npc" ? `${a.name} (NPC)` : a.name, selecionado: a.id === this.atorId,
      })),
      desafios,
      investigacao: investigacao?.name ?? null,
      todos: this.todos || !investigacao,
      temInvestigacao: Boolean(investigacao),
    };
  }

  _onRender(contexto, opcoes) {
    super._onRender(contexto, opcoes);
    this.element.querySelector("select[name=ator]")?.addEventListener("change", (e) => {
      this.atorId = e.target.value;
    });
  }

  static async #abordagem(_evento, alvo) {
    const { uuid, chave } = alvo.dataset;
    const ator = game.actors.get(this.atorId);
    if (!ator) return void ui.notifications.warn(L("EscolhaPersonagem"));
    if (chave === "destrancar") return void await iniciarDestrancar(uuid, ator.id);
    const acoes = { arrombar, hackTecnico, hackSocial, generico: desafioGenerico, sustentar };
    if (chave === "sustentar") await sustentar(ator, { desafioUuid: uuid });
    else await acoes[chave]?.(ator, uuid);
    this.render();
  }

  static async #abrir(_evento, alvo) {
    (await fromUuid(alvo.dataset.uuid))?.sheet.render(true);
  }

  static async #novo() {
    const item = await Item.create({ name: L("NovoDesafio"), type: "desafio-acesso" });
    item?.sheet.render(true);
    this.todos = true;
    this.render();
  }

  static #monitorar(_evento, alvo) {
    abrirDestrancar(alvo.dataset.uuid);
  }

  static async #excluir(_evento, alvo) {
    const item = await fromUuid(alvo.dataset.uuid);
    if (!item) return;
    const ok = await DialogV2.confirm({
      window: { title: L("ExcluirDesafio") },
      content: `<p>${F("ExcluirConfirma", { nome: esc(item.name) })}</p>`,
    });
    if (!ok) return;
    for (const investigacao of todasInvestigacoes()) {
      if (investigacao.system.desafios?.includes(item.uuid)) await removerDesafio(investigacao, item.uuid);
    }
    await item.delete();
  }

  static #escopo() {
    this.todos = !this.todos;
    this.render();
  }
}

let appDesafios = null;

// A lista acompanha o mundo: renomear, criar, excluir ou mexer na investigação.
function rerrenderDesafios(doc) {
  if (!appDesafios?.rendered) return;
  if (doc.type === "desafio-acesso" || doc.type === "investigacao") appDesafios.render();
}
for (const gancho of ["createItem", "updateItem", "deleteItem", "updateActor"]) Hooks.on(gancho, rerrenderDesafios);
function abrirDesafios() {
  appDesafios ??= new DesafiosApp();
  appDesafios.render({ force: true });
}

/* ------------------------------------------------------------------ */
/* Paleta flutuante                                                     */
/* ------------------------------------------------------------------ */

class FerramentasMestre extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "op2-ferramentas-mestre",
    classes: ["op2-ferramentas-mestre"],
    window: { frame: false, positioned: true, minimizable: false, resizable: false },
    position: { width: "auto", height: "auto" },
    actions: {
      solicitarTeste: () => solicitarTeste(),
      testeOposto: () => testeOposto(),
      desafios: () => abrirDesafios(),
      aventura: () => abrirAventurasApp(),
    },
  };

  static PARTS = { main: { template: `systems/${SYSTEM_ID}/templates/ui/ferramentas-mestre.hbs` } };

  _canRender(opcoes) {
    if (!game.user.isGM) return false;
    return super._canRender(opcoes);
  }

  async _prepareContext() {
    return {
      botoes: [
        { acao: "solicitarTeste", icone: `${ICONES}/rolling-dices.svg`, rotulo: L("SolicitarTeste") },
        { acao: "testeOposto", icone: `${ICONES}/sword-clash.svg`, rotulo: L("TesteOposto") },
        { acao: "desafios", icone: `${ICONES}/access-challenges.png`, rotulo: L("DesafiosAcesso"), grande: true },
        { acao: "aventura", icone: `${ICONES}/adventure-import.svg`, rotulo: L("ImportarAventura") },
      ],
    };
  }

  async _onFirstRender(contexto, opcoes) {
    await super._onFirstRender(contexto, opcoes);
    const salvo = game.settings.get(SYSTEM_ID, "posicaoFerramentasMestre") ?? {};
    this.setPosition({ top: salvo.top ?? 80, left: salvo.left ?? 120 });
    const alca = this.element.querySelector("[data-alca]");
    const Draggable = foundry.applications.ux?.Draggable;
    const Impl = Draggable?.implementation ?? Draggable;
    if (alca && Impl) new Impl(this, this.element, alca, false);
  }

  setPosition(posicao) {
    const resultado = super.setPosition(posicao);
    if (this.rendered) this.#salvarPosicao();
    return resultado;
  }

  #salvarPosicao = foundry.utils.debounce(() => {
    const { top, left } = this.position;
    void game.settings.set(SYSTEM_ID, "posicaoFerramentasMestre", { top, left });
  }, 400);
}

let paleta = null;

/** Mostra/esconde a paleta (exposto em `game.op2.ferramentasMestre`). */
export function alternarFerramentasMestre(forcar) {
  if (!game.user.isGM) return;
  paleta ??= new FerramentasMestre();
  const mostrar = forcar ?? !paleta.rendered;
  if (mostrar) paleta.render({ force: true });
  else void paleta.close();
}

/** Chamar no `init`. */
export function registrarFerramentasMestre() {
  game.settings.register(SYSTEM_ID, "posicaoFerramentasMestre", {
    scope: "client", config: false, type: Object, default: {},
  });
  game.settings.register(SYSTEM_ID, "mostrarFerramentasMestre", {
    name: "OP2.Ferramentas.Config.Mostrar",
    hint: "OP2.Ferramentas.Config.MostrarDica",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: (valor) => alternarFerramentasMestre(valor),
  });
  game.keybindings.register(SYSTEM_ID, "ferramentasMestre", {
    name: "OP2.Ferramentas.Atalho",
    editable: [{ key: "KeyG", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => { alternarFerramentasMestre(); return true; },
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });

  registrarAcaoDeChat("ferr-solicitado", rolarSolicitado);
  registrarAcaoDeChat("ferr-oposto", rolarOposto);
  registrarAcaoDeChat("ferr-abrir-destrancar", (ator, dataset) => {
    if (!game.user.isGM && !ator.isOwner) return void ui.notifications.warn(L("SemPermissao"));
    abrirDestrancar(dataset.desafioUuid);
  });
  registrarAcaoDeMestre("ferrRegistrarSolicitacao", registrarSolicitacao);
  registrarAcaoDeMestre("ferrRegistrarOposto", registrarOposto);

  Hooks.once("ready", () => {
    if (game.user.isGM && game.settings.get(SYSTEM_ID, "mostrarFerramentasMestre")) alternarFerramentasMestre(true);
  });
}

export { solicitarTeste, testeOposto, abrirDesafios };
