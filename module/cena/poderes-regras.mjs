/** Regras dos poderes que dão para testar sem o Foundry. */

/**
 * Plano Estratégico (DT 7): passar dá 1d6, e mais 1d6 a cada 3 pontos acima da DT.
 * 7–9 → 1, 10–12 → 2, 13–15 → 3. Falhou → 0.
 */
export function dadosDoPlano(total, sucesso, dt = 7) {
  if (!sucesso) return 0;
  return 1 + Math.max(0, Math.floor((Number(total) - dt) / 3));
}

/**
 * O que a Análise e a Mentoria fizeram nos dados, para a nota do card.
 * `antes`/`depois`: valores por dado; `mentoriaEm`: índice trocado pela Mentoria;
 * `mentoria`: a RA oferecida (0 = não havia). Mentoria oferecida e não usada também
 * vira nota — ela vale só para este teste.
 */
export function ajustesDoTeste(nome, antes, depois, gastos, mentoriaEm = null, mentoria = 0) {
  const ajustes = [];
  const usouMentoria = mentoriaEm !== null && mentoriaEm !== undefined;
  const mudancas = antes
    .map((de, i) => ({ i, de, para: depois[i] }))
    .filter((m) => m.de !== m.para && !(usouMentoria && m.i === mentoriaEm));
  if (gastos && mudancas.length) ajustes.push({ tipo: "analise", nome, gastos, mudancas: mudancas.map(({ de, para }) => ({ de, para })) });
  if (usouMentoria) ajustes.push({ tipo: "mentoria", nome, de: antes[mentoriaEm], para: depois[mentoriaEm] });
  else if (mentoria) ajustes.push({ tipo: "mentoriaRecusada", nome, valor: mentoria });
  return ajustes;
}

/* ---- Prontidão: aguardar pra agir ---- */

/** Iniciativa de quem declarou "Aguardar pra agir": abaixo de todas as fases (Corpo a corpo = 1). */
export const INICIATIVA_AGUARDANDO = 0;

const ordemDe = (c) => Number(c?.flags?.["ordem-paranormal-2e"]?.ordem ?? c?.ordem ?? 0) || 0;
const iniciativaDe = (c) => (Number.isFinite(Number(c?.initiative)) && c?.initiative !== null ? Number(c.initiative) : -Infinity);

/**
 * A ordem da fila: iniciativa (fase) decrescente; no empate, a `ordem` gravada pelo
 * encaixe da Prontidão e, por fim, o id (o desempate do core). Não usa `this`: o core
 * passa a função solta para o `sort`.
 */
export function ordenarCombatentes(a, b) {
  const ia = iniciativaDe(a);
  const ib = iniciativaDe(b);
  if (ia !== ib) return ib > ia ? 1 : -1;
  return (ordemDe(a) - ordemDe(b)) || (a.id > b.id ? 1 : -1);
}

/**
 * Quem aguardava decide agir agora: entra na fila logo antes de quem ia agir.
 * `turnos`: a fila atual, em ordem (`{id, initiative, ordem}`). Devolve as mudanças
 * (`{_id, ordem, initiative?}`) e o índice novo de quem aguardava — que é o mesmo
 * índice do turno atual, então o turno passa a ser dele sem mexer no `turn`.
 * Null quando não dá (quem aguardava ou quem age não está na fila, ou é o mesmo).
 */
export function encaixarAntes(turnos, idEspera, idAtual) {
  if (!idEspera || idEspera === idAtual) return null;
  const espera = turnos.find((t) => t.id === idEspera);
  const lista = turnos.filter((t) => t.id !== idEspera);
  const indice = lista.findIndex((t) => t.id === idAtual);
  if (!espera || indice < 0) return null;
  const fase = lista[indice].initiative;
  lista.splice(indice, 0, { ...espera, initiative: fase });
  const atualizacoes = [];
  lista.forEach((t, i) => {
    if (t.initiative !== fase) return;
    const ehEspera = t.id === idEspera;
    if (!ehEspera && ordemDe(t) === i) return;
    atualizacoes.push(ehEspera ? { _id: t.id, ordem: i, initiative: fase } : { _id: t.id, ordem: i });
  });
  return { atualizacoes, indice };
}
