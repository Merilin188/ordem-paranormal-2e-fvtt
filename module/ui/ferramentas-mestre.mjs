/**
 * Ferramentas do mestre — paleta flutuante e arrastável (só GM) com atalhos para:
 * Solicitar teste, Teste oposto, Desafios de acesso e Importar aventura.
 *
 * Ideia portada do sistema "ordemparanormal2" (antoniohbmonteiro), reescrita sobre as
 * mecânicas deste sistema: `rolarTeste`, os desafios de acesso de `acoes-desafio.mjs`
 * e a janela de aventuras.
 */
import { SYSTEM_ID } from "../config.mjs";
import {
  solicitarTeste, testeOposto, testeDeEquilibrio, registrarTestesDoMestre, personagens, selecionados,
} from "./ferramentas-testes.mjs";
import { abrirPavor } from "../cena/pavor.mjs";
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
    const { escolherCategoria, criarDesafioDaCategoria } = await import("../cena/categorias-desafio.mjs");
    const categoria = await escolherCategoria();
    if (!categoria) return;
    const item = await criarDesafioDaCategoria(categoria);
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
      equilibrio: () => testeDeEquilibrio(),
      pavor: () => abrirPavor(),
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
        { acao: "equilibrio", fa: "fa-person-falling", rotulo: game.i18n.localize("OP2.Equilibrio.Titulo") },
        { acao: "pavor", fa: "fa-ghost", rotulo: game.i18n.localize("OP2.Pavor.Janela") },
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

  registrarTestesDoMestre();
  registrarAcaoDeChat("ferr-abrir-destrancar", (ator, dataset) => {
    if (!game.user.isGM && !ator.isOwner) return void ui.notifications.warn(L("SemPermissao"));
    abrirDestrancar(dataset.desafioUuid);
  });

  Hooks.once("ready", () => {
    if (game.user.isGM && game.settings.get(SYSTEM_ID, "mostrarFerramentasMestre")) alternarFerramentasMestre(true);
  });
}

export { solicitarTeste, testeOposto, abrirDesafios };
