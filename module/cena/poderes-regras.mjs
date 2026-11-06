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
 * O que a Análise e a Mentoria mudaram nos dados, para a nota do card.
 * `antes`/`depois`: valores por dado; `mentoriaEm`: índice trocado pela Mentoria.
 */
export function ajustesDoTeste(nome, antes, depois, gastos, mentoriaEm = null) {
  const ajustes = [];
  const mudancas = antes
    .map((de, i) => ({ i, de, para: depois[i] }))
    .filter((m) => m.de !== m.para && m.i !== mentoriaEm);
  if (gastos && mudancas.length) ajustes.push({ tipo: "analise", nome, gastos, mudancas: mudancas.map(({ de, para }) => ({ de, para })) });
  if (mentoriaEm !== null && mentoriaEm !== undefined && antes[mentoriaEm] !== depois[mentoriaEm]) {
    ajustes.push({ tipo: "mentoria", nome, de: antes[mentoriaEm], para: depois[mentoriaEm] });
  }
  return ajustes;
}
