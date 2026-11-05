/** Leitura do bloco de ataque da criatura (puro, sem Foundry). */
/** "2d6" → ["d6","d6"]; "d8+d6" → ["d8","d6"]. Inválido → []. */
export function dadosDoAtaque(texto) {
  const dados = [];
  for (const parte of String(texto ?? "").toLowerCase().replace(/\s/g, "").split("+")) {
    const m = parte.match(/^(\d*)d(4|6|8|10|12|20)$/);
    if (!m) return [];
    for (let i = 0; i < (Number(m[1]) || 1); i++) dados.push(`d${m[2]}`);
  }
  return dados;
}

/** "RA+1" → {base:"ra", bonus:1}; "RB" → {base:"rb", bonus:0}; "" ou inválido → null. */
export function danoDoAtaque(texto) {
  const m = String(texto ?? "").toUpperCase().replace(/\s/g, "").match(/^(RA|RB)([+-]\d+)?$/);
  return m ? { base: m[1].toLowerCase(), bonus: Number(m[2] ?? 0) } : null;
}
