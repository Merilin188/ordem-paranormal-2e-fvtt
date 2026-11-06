/** Regras dos poderes que dão para testar sem o Foundry. */

/**
 * Plano Estratégico (DT 7): passar dá 1d6, e mais 1d6 a cada 3 pontos acima da DT.
 * 7–9 → 1, 10–12 → 2, 13–15 → 3. Falhou → 0.
 */
export function dadosDoPlano(total, sucesso, dt = 7) {
  if (!sucesso) return 0;
  return 1 + Math.max(0, Math.floor((Number(total) - dt) / 3));
}
