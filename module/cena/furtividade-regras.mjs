/**
 * Mecânica de furtividade (Contos da Vigília, p. 55–56) — só regra, sem Foundry.
 *
 * Cada personagem guarda os dados do teste de esconderijo com o valor rolado para
 * cima. As criaturas procuram rolando dados: todo dado de esconderijo com o mesmo
 * valor de um rolado é descartado. Sem dados, o personagem foi encontrado.
 */

/** DT das ações especiais: 7 na primeira vez, +3 a cada uso (10, 13…). */
export const dtPorUsos = (usos = 0, base = 7, passo = 3) => base + passo * Math.max(0, usos);

export const facesDe = (dado) => Number(String(dado ?? "").replace(/^\d*d/, "")) || 0;

/**
 * Tabela "Ações das criaturas" (1d10). `tipo`:
 * - numeros: o mestre fala dois números;
 * - sopro: um personagem sorteado escolhe ficar parado (2d6 PD) ou perder um dado;
 * - todos: procura todos rolando `formula`;
 * - um: procura um personagem sorteado, com a fórmula pelo maior dado dele;
 * - nada: as criaturas param.
 */
export const TABELA_CRIATURAS = {
  1: { tipo: "numeros" },
  2: { tipo: "sopro" },
  3: { tipo: "todos", formula: "1d10" },
  4: { tipo: "todos", formula: "2d8" },
  5: { tipo: "todos", formula: "3d6" },
  6: { tipo: "todos", formula: "1d8" },
  7: { tipo: "todos", formula: "2d6" },
  8: { tipo: "um", formulas: ["1d12", "2d10", "3d8"] },
  9: { tipo: "um", formulas: ["1d10", "2d8", "3d6"] },
  10: { tipo: "nada" },
};

/** Linha 8/9: d12 → primeira fórmula, d10 → segunda, d8 ou menor → terceira. */
export function formulaPeloMaiorDado(dados, formulas) {
  const maior = Math.max(0, ...(dados ?? []).map((d) => facesDe(d.dado)));
  if (maior >= 12) return formulas[0];
  if (maior >= 10) return formulas[1];
  return formulas[2];
}

/** Dados que ainda escondem (os perdidos ficam na lista só para a animação). */
export const dadosAtivos = (participante) => (participante?.dados ?? []).filter((d) => !d.perdido);

export const encontrado = (participante) => !!participante?.testou && dadosAtivos(participante).length === 0;

/**
 * Aplica uma busca: todo dado ativo cujo valor saiu nos rolados é marcado como
 * perdido (com o id do evento). `alvos` limita a quem é procurado (null = todos).
 * Devolve os participantes novos, quem perdeu o quê e quem acabou de ser encontrado.
 */
export function aplicarBusca(participantes, valores, eventoId, alvos = null) {
  const procurados = new Set(valores.map(Number));
  const perdas = [];
  const descobertos = [];
  const novos = participantes.map((p) => {
    if (alvos && !alvos.includes(p.uuid)) return p;
    const antes = dadosAtivos(p).length;
    const dados = p.dados.map((d) => {
      if (d.perdido || !procurados.has(d.valor)) return d;
      perdas.push({ uuid: p.uuid, id: d.id, dado: d.dado, valor: d.valor });
      return { ...d, perdido: eventoId };
    });
    const novo = { ...p, dados };
    if (antes > 0 && dadosAtivos(novo).length === 0) descobertos.push(p.uuid);
    return novo;
  });
  return { participantes: novos, perdas, descobertos };
}

/** Marca um dado específico como perdido (descartar, sopro na nuca, ação chamativa). */
export function perderDado(participante, dadoId, eventoId) {
  const dados = participante.dados.map((d) => (d.id === dadoId && !d.perdido ? { ...d, perdido: eventoId } : d));
  return { ...participante, dados };
}

/** Tira de vez os dados perdidos em eventos anteriores ao atual. */
export function limparPerdidos(participante, eventoAtual) {
  return { ...participante, dados: participante.dados.filter((d) => !d.perdido || d.perdido === eventoAtual) };
}
