/**
 * Regras da perseguição (Contos da Vigília, p. 73) — só regra, sem Foundry.
 *
 * 5 rodadas acumulando pontos de avanço (PA). No fim das rodadas 3, 4 e 5, quem
 * estiver abaixo do corte (15, 20, 30) e tiver a MENOR pontuação é alcançado.
 */
export const RODADAS = 5;
export const CORTES = { 3: 15, 4: 20, 5: 30 };
export const DT_AVANCO = 10;
export const DT_VALA = 10;
export const PA_DA_VALA = 15;
/** Dados somados no teste: 2 da ficha + até 2 bônus (fôlego, sacrifício). */
export const MAX_BONUS = 2;

const faces = (dado) => Number(String(dado ?? "").replace(/^\d*d/, "")) || 0;

/** Vigor d6 → 3 dados de fôlego; d10 → 5. */
export const folegoInicial = (dadoVigor) => Math.floor(faces(dadoVigor) / 2);

/** Esforço extra: 1d4 na primeira vez, 2d4 na segunda… */
export const formulaDoEsforco = (usosAnteriores = 0) => `${usosAnteriores + 1}d4`;

/**
 * Passou: pontos = RA. Falhou: pontos = RB. Crítico: as duas rolagens mais altas
 * somadas (como o crítico soma mais uma rolagem nos testes estendidos).
 * `valores`: os resultados dos dados que contam no teste.
 */
export function pontosDoAvanco({ sucesso, ra, rb, critico = false }, valores = []) {
  if (critico && valores.length >= 2) return [...valores].sort((a, b) => b - a).slice(0, 2).reduce((t, v) => t + v, 0);
  return sucesso ? ra : rb;
}

/**
 * Quem é alcançado no fim da rodada. `alvo` quando há um só com a menor
 * pontuação abaixo do corte; `empate` quando vários dividem a menor (teste oposto).
 */
export function quemEAlcancado(participantes, rodada, marcos = null) {
  const corte = marcos ? marcos.find((m) => Number(m.rodada) === Number(rodada))?.pa ?? null : CORTES[rodada];
  if (!corte) return { corte: null, alvo: null, empate: [] };
  const abaixo = participantes.filter((p) => !p.morto && (p.pa ?? 0) < corte);
  if (!abaixo.length) return { corte, alvo: null, empate: [] };
  const menor = Math.min(...abaixo.map((p) => p.pa ?? 0));
  const ultimos = abaixo.filter((p) => (p.pa ?? 0) === menor).map((p) => p.uuid);
  return ultimos.length === 1 ? { corte, alvo: ultimos[0], empate: [] } : { corte, alvo: null, empate: ultimos };
}

/**
 * A enxurrada não escolhe o último: atinge TODOS abaixo do corte (Missão 1, p. 35).
 * Devolve o corte e a lista de quem foi alcançado.
 */
export function todosAbaixoDoCorte(participantes, rodada, marcos = null) {
  const corte = marcos ? marcos.find((m) => Number(m.rodada) === Number(rodada))?.pa ?? null : CORTES[rodada];
  if (!corte) return { corte: null, alvos: [] };
  return { corte, alvos: participantes.filter((p) => !p.morto && (p.pa ?? 0) < corte).map((p) => p.uuid) };
}

/** Próximo corte a partir da rodada atual (para o painel avisar). */
export function proximoCorte(rodada, marcos = null) {
  const lista = marcos ?? Object.entries(CORTES).map(([r, pa]) => ({ rodada: Number(r), pa }));
  const proximo = [...lista].sort((a, b) => a.rodada - b.rodada).find((m) => Number(m.rodada) >= rodada);
  return proximo ? { rodada: Number(proximo.rodada), pa: Number(proximo.pa) } : null;
}
