/**
 * Fim de investigação.
 *
 * A investigação é a unidade estrutural do jogo, não uma unidade de tempo (spec §5.1).
 * Encerrar é um evento explícito do mestre, e é o único momento em que as reduções
 * temporárias de atributo somem e as ações travadas do grupo voltam a ficar
 * disponíveis. O roster (`participantes`), os POIs e os desafios vinculados são
 * estrutura da investigação e não são zerados — só rodada, sobrecarga e as travas,
 * que são estado de sessão.
 */
import { investigacaoAtiva } from "./investigacao-ativa.mjs";

/**
 * @param {object} [opcoes]
 * @param {Actor[]} [opcoes.atores] default: todos os participantes da investigação ativa
 * @param {boolean} [opcoes.avisar]
 */
export async function encerrarCena({ atores, avisar = true, investigacao = investigacaoAtiva() } = {}) {
  const alvos = atores ?? personagensDaCenaAtiva(investigacao);
  if (!alvos.length) {
    if (avisar) ui.notifications.warn(game.i18n.localize("OP2.Cena.SemPersonagens"));
    return [];
  }

  const zerado = {
    "system.estado.reducoesTemporarias.fisico": 0,
    "system.estado.reducoesTemporarias.mente": 0,
    "system.estado.reducoesTemporarias.emocao": 0,
    // O aumento do Ímpeto também vale "até o fim da cena".
    "system.estado.aumentosTemporarios.fisico": 0,
    "system.estado.aumentosTemporarios.mente": 0,
    "system.estado.aumentosTemporarios.emocao": 0,
    "system.estado.acoesUsadasNaCena": [],
    // A revelação é por investigação: encerrada, o que foi descoberto nela é
    // conhecimento da mesa, não estado do sistema.
    "system.estado.poisInvestigados": [],
    "system.estado.infosReveladas": [],
  };

  const atualizacoes = alvos.map((ator) => ({ _id: ator.id, ...zerado }));
  await Actor.updateDocuments(atualizacoes);
  // Poderes "até o fim da cena": Ímpeto esvazia, marcadores e lobo machucado zeram.
  const { encerrarCenaDosPoderes } = await import("./poderes.mjs");
  await encerrarCenaDosPoderes(alvos);
  const { encerrarCenaDosEfeitos } = await import("./efeitos-mundo.mjs");
  await encerrarCenaDosEfeitos(alvos);

  // O contador de rodadas alimenta a sobrecarga mental (spec §7.6) e reinicia junto.
  // Travas de 1×-por-investigação e a ordem das rodadas também são da sessão que
  // terminou — o roster e os vínculos de POI/desafio continuam.
  if (investigacao) {
    await investigacao.update({
      "system.rodada": 0,
      "system.recapitularUsado": { usado: false, atorId: "", nome: "" },
      "system.compartilharUsado": { usado: false, atorId: "", nome: "" },
      "system.ordemParticipantes": [],
    });
  }

  if (avisar) {
    ui.notifications.info(game.i18n.format("OP2.Cena.Encerrada", { total: alvos.length }));
  }
  return alvos;
}

/** "<uuid do ponto>:<id da linha>" → o uuid do ponto (o uuid não tem ":"). Pura. */
export function poiDaChave(chave) {
  return String(chave).split(":").slice(0, -1).join(":");
}

/**
 * RESETAR CENA: a cena volta ao começo, como se o grupo nunca tivesse passado por ela
 * (outra mesa vai jogar o mesmo lugar). Tudo o que "Encerrar cena" zera, e mais:
 * - o que qualquer personagem descobriu nos pontos dela e o que foi contado ao grupo;
 * - as trancas: ponto bloqueado volta trancado, desafios voltam do zero;
 * - os usos das habilidades limitadas dos participantes (Prontidão, Arsenal…);
 * - quem já agiu na rodada e os eventos com roteiro (voltam a antes do gatilho).
 * O que é preparo do mestre fica: pontos, linhas e o estado delas (oculta/aberta),
 * participantes, vínculos e o que está oculto na investigação.
 */
export async function resetarCena(investigacao = investigacaoAtiva()) {
  if (!game.user.isGM || !investigacao) return false;
  const { DialogV2 } = foundry.applications.api;
  const ok = await DialogV2.confirm({
    window: { title: game.i18n.localize("OP2.Cena.ResetarTitulo"), icon: "fa-solid fa-rotate-left" },
    content: `<p>${game.i18n.format("OP2.Cena.ResetarPergunta", { nome: foundry.utils.escapeHTML(investigacao.name) })}</p>
      <p class="op2-ajuda">${game.i18n.localize("OP2.Cena.ResetarFica")}</p>`,
    yes: { label: game.i18n.localize("OP2.Cena.ResetarSim") },
    rejectClose: false,
  });
  if (!ok) return false;

  const participantes = personagensDaCenaAtiva(investigacao);
  await encerrarCena({ atores: participantes, avisar: false, investigacao });

  // As descobertas nos pontos desta cena, de qualquer personagem (não só do roster).
  const pois = (investigacao.system.pois ?? []).map((uuid) => fromUuidSync(uuid)).filter((p) => p?.type === "ponto-interesse");
  const uuids = new Set(pois.map((p) => p.uuid));
  const dosPontos = (chave) => uuids.has(poiDaChave(chave));
  const limpar = game.actors.filter((a) => a.type === "personagem" && ([...a.system.estado.infosReveladas].some(dosPontos)
    || [...a.system.estado.poisInvestigados].some((u) => uuids.has(u))));
  if (limpar.length) {
    await Actor.updateDocuments(limpar.map((a) => ({
      _id: a.id,
      "system.estado.infosReveladas": [...a.system.estado.infosReveladas].filter((c) => !dosPontos(c)),
      "system.estado.poisInvestigados": [...a.system.estado.poisInvestigados].filter((u) => !uuids.has(u)),
    })));
  }

  // Pontos: nada contado ao grupo; quem era bloqueado volta trancado, desafios do zero.
  const { dadosParaTrancar, desafiosDoPonto } = await import("./acesso-poi.mjs");
  const { SYSTEM_ID } = await import("../config.mjs");
  for (const poi of pois) {
    await poi.update({
      "system.informacoes": poi.system.informacoes.map((info) => ({ ...info, contadaPor: [] })),
      "system.acesso.liberado": false,
    });
  }
  const desafios = new Map();
  for (const poi of pois) for (const d of desafiosDoPonto(poi)) desafios.set(d.uuid, d);
  for (const uuid of investigacao.system.desafios ?? []) {
    const d = fromUuidSync(uuid);
    if (d?.type === "desafio-acesso") desafios.set(d.uuid, d);
  }
  for (const desafio of desafios.values()) {
    await desafio.update(dadosParaTrancar(desafio.system));
    const sessao = desafio.getFlag(SYSTEM_ID, "sessao");
    if (sessao?.ativa) await desafio.setFlag(SYSTEM_ID, "sessao", { ...sessao, ativa: false });
  }

  // Habilidades limitadas dos participantes, como o "Resetar usos" da ficha.
  const { zerarUsosDasHabilidades } = await import("./efeitos-mundo.mjs");
  for (const ator of participantes) await zerarUsosDasHabilidades(ator);

  // Quem já agiu e os eventos com roteiro.
  // Também aqui (e não só no Encerrar): sem participantes, o Encerrar sai antes de zerar.
  await investigacao.update({
    "system.rodada": 0,
    "system.jaAgiram": [],
    "system.ordemParticipantes": [],
    "system.recapitularUsado": { usado: false, atorId: "", nome: "" },
    "system.compartilharUsado": { usado: false, atorId: "", nome: "" },
  });
  const { eventosDaInvestigacao, reiniciarEvento } = await import("./investigacao-ativa.mjs");
  for (const evento of eventosDaInvestigacao(investigacao)) {
    if (evento.system.disparado) await reiniciarEvento(evento);
  }

  ui.notifications.info(game.i18n.format("OP2.Cena.Resetada", { nome: investigacao.name }));
  return true;
}

/** Personagens no roster da investigação ativa. */
export function personagensDaCenaAtiva(investigacao = investigacaoAtiva()) {
  return participantesDaInvestigacao("personagem", investigacao);
}

/** NPCs no roster da investigação ativa — agem por último (spec §5.2). */
export function npcsDaCenaAtiva(investigacao = investigacaoAtiva()) {
  return participantesDaInvestigacao("npc", investigacao);
}

/**
 * Quem pode ser alvo de uma ação que envolve outro personagem (Ajudar, Compartilhar,
 * Atacar).
 *
 * Não é "todo ator do mundo", nem sequer todo participante: quem o mestre escondeu
 * (`participantesOcultos`) não está em cena, e oferecê-lo como alvo entrega que ele
 * existe (achado em uso real: "lista tudo, não faz sentido algum"). Quem chama diz se
 * NPC entra — Ajudar é entre personagens, Atacar não.
 *
 * @param {object} [opcoes]
 * @param {Actor}  [opcoes.exceto]   quem está agindo, fora da própria lista
 * @param {boolean} [opcoes.comNpcs] inclui os NPCs do roster
 */
export function alvosDaCenaAtiva({ exceto, comNpcs = false } = {}) {
  const investigacao = investigacaoAtiva();
  const ocultos = investigacao?.system.participantesOcultos ?? [];
  const roster = comNpcs
    ? [...personagensDaCenaAtiva(), ...npcsDaCenaAtiva()]
    : personagensDaCenaAtiva();

  return roster
    .filter((ator) => !ocultos.includes(ator.uuid))
    .filter((ator) => ator.id !== exceto?.id);
}

/**
 * Quem pode ser alvo agora: os combatentes do combate em curso, os tokens visíveis da
 * cena e o roster da investigação. Sem investigação aberta, o combate ainda acha
 * alvos (achado em uso: o ataque da criatura dizia que não havia ninguém).
 * Um por uuid: duas Crias do mesmo ator (tokens sem vínculo) são dois alvos.
 */
export function alvosDisponiveis({ exceto, tipos = ["personagem", "npc", "criatura"] } = {}) {
  const vistos = new Map();
  const somar = (ator) => {
    if (!ator || !tipos.includes(ator.type) || ator.uuid === exceto?.uuid || vistos.has(ator.uuid)) return;
    vistos.set(ator.uuid, ator);
  };
  for (const c of game.combat?.combatants ?? []) {
    if (c.defeated || (c.hidden && !game.user?.isGM)) continue;
    somar(c.actor);
  }
  for (const t of globalThis.canvas?.tokens?.placeables ?? []) {
    if (t.visible === false || (t.document?.hidden && !game.user?.isGM)) continue;
    somar(t.actor);
  }
  for (const a of alvosDaCenaAtiva({ exceto, comNpcs: true })) somar(a);
  return [...vistos.values()];
}

/**
 * O alvo marcado no mapa (a mira do Foundry), que é como a mesa já diz "é nele".
 *
 * Quando existe um alvo marcado, ele manda: não faz sentido abrir uma lista para
 * escolher de novo quem você já apontou, nem exigir que ele esteja no roster da
 * investigação (achado em uso real). Só entram tipos que o sistema conhece.
 *
 * @param {object} [opcoes]
 * @param {Actor}  [opcoes.exceto]   quem está agindo nunca é o próprio alvo
 * @param {string[]} [opcoes.tipos]  tipos aceitos; default personagem e NPC
 * @returns {Actor[]}
 */
export function alvosMarcados({ exceto, tipos = ["personagem", "npc", "criatura"] } = {}) {
  const marcados = [...(game.user?.targets ?? [])]
    .map((token) => token.actor)
    .filter((ator) => ator && tipos.includes(ator.type) && ator.id !== exceto?.id);
  return [...new Set(marcados)];
}

function participantesDaInvestigacao(tipo, investigacao = investigacaoAtiva()) {
  const uuids = investigacao?.system.participantes ?? [];
  const atores = [];
  for (const uuid of uuids) {
    const ator = fromUuidSync(uuid);
    if (ator?.type === tipo) atores.push(ator);
  }
  return atores;
}
