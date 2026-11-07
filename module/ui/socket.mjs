/**
 * Ponte para o mestre executar o que o jogador não tem permissão de escrever.
 *
 * Desafio de acesso, POI e a própria Investigação são documentos de mundo: o
 * jogador não é dono de nenhum deles. Sem isto, clicar em Arrombar/Hackear rolava
 * o teste e depois estourava "User X lacks permission to update Item" na tela
 * (achado em uso real) — o teste é do personagem, mas gravar o resultado no
 * obstáculo é escrita de mundo.
 *
 * Só o GM "designado" (`game.users.activeGM`) executa: com dois mestres online,
 * os dois receberiam o pedido e a atualização aconteceria duas vezes.
 */
import { SYSTEM_ID } from "../config.mjs";

const CANAL = `system.${SYSTEM_ID}`;

/** @type {Record<string, (dados: object) => Promise<unknown>>} */
const ACOES = {};

/** O que todo cliente executa quando o mestre manda (o contador do hack técnico). */
const TODOS = {};

export function registrarAcaoDeTodos(nome, executar) {
  TODOS[nome] = executar;
}

/**
 * Manda para todos os OUTROS clientes — quem emite não recebe o próprio evento e
 * executa o que quiser localmente (às vezes com mais dados, como a resposta do
 * problema, que só o mestre pode ter).
 */
export function paraTodos(nome, dados) {
  game.socket.emit(CANAL, { acao: nome, dados, todos: true });
}

/** Registra o que o mestre sabe executar em nome de um jogador. */
export function registrarAcaoDeMestre(nome, executar) {
  ACOES[nome] = executar;
}

/** Perguntas que um cliente responde para outro (a defesa antes do ataque). */
const PERGUNTAS = {};
const PENDENTES = new Map();

export function registrarPergunta(nome, responder) {
  PERGUNTAS[nome] = responder;
}

/**
 * Pergunta a um usuário e espera a resposta (null se ele não responder a tempo).
 * Para o próprio usuário, responde direto.
 */
export function perguntarA(usuario, nome, dados, { tempoMs = 120000 } = {}) {
  if (!usuario || usuario.id === game.user.id) return Promise.resolve(PERGUNTAS[nome]?.(dados) ?? null);
  const id = foundry.utils.randomID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { PENDENTES.delete(id); resolve(null); }, tempoMs);
    PENDENTES.set(id, (valor) => { clearTimeout(timer); PENDENTES.delete(id); resolve(valor); });
    game.socket.emit(CANAL, { pergunta: nome, dados, para: usuario.id, de: game.user.id, id });
  });
}

/** Quem responde por um ator: um dono jogador conectado; sem ele, o mestre ativo. */
export function responsavelPor(ator) {
  const jogadores = game.users.filter((u) => u.active && !u.isGM && ator.testUserPermission(u, "OWNER"));
  return jogadores.find((u) => u.character?.id === ator.id) ?? jogadores[0] ?? game.users.activeGM ?? null;
}

export function registrarSocket() {
  game.socket.on(CANAL, async (msg = {}) => {
    if (msg.pergunta) {
      if (msg.para !== game.user.id) return;
      const valor = (await PERGUNTAS[msg.pergunta]?.(msg.dados)) ?? null;
      return void game.socket.emit(CANAL, { resposta: msg.id, para: msg.de, valor });
    }
    if (msg.resposta) {
      if (msg.para === game.user.id) PENDENTES.get(msg.resposta)?.(msg.valor);
      return;
    }
    const { acao, dados, todos = false } = msg;
    if (todos) {
      const executar = TODOS[acao];
      if (!executar) return void console.warn(`${SYSTEM_ID} | ação de todos desconhecida: ${acao}`);
      return void await executar(dados);
    }
    if (game.users.activeGM?.id !== game.user.id) return;
    const executar = ACOES[acao];
    if (!executar) return void console.warn(`${SYSTEM_ID} | ação de mestre desconhecida: ${acao}`);
    await executar(dados);
  });
}

/**
 * Executa direto se quem chamou é o mestre; senão pede pro mestre fazer.
 *
 * Quem pede não recebe resposta: o efeito volta pelo próprio documento, que o
 * Foundry sincroniza sozinho (a UI re-renderiza no `updateItem`/`updateActor`).
 */
export async function comoMestre(nome, dados) {
  if (game.user.isGM) return ACOES[nome]?.(dados);
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("OP2.Aviso.SemMestreOnline"));
    return null;
  }
  game.socket.emit(CANAL, { acao: nome, dados });
  return null;
}
