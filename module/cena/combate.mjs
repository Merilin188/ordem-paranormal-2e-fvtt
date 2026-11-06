/**
 * Combate simplificado (spec §8.1) — regras puras, sem Foundry.
 *
 * O playtest marca este módulo como temporário: o combate completo vem em
 * playtests futuros. Fica isolado de propósito, para ser trocado inteiro.
 */

/**
 * Teste oposto (spec §4.6): quem tirou mais vence, sem DT. Empate não é definido
 * pelo texto — tratamos como "ninguém vence", que preserva o status quo e é o que
 * a mesa costuma narrar (docs/LACUNAS.md).
 * @returns {"atacante"|"defensor"|"empate"}
 */
export function vencedorDoOposto(totalAtacante, totalDefensor) {
  if (totalAtacante > totalDefensor) return "atacante";
  if (totalDefensor > totalAtacante) return "defensor";
  return "empate";
}

/**
 * Dano do vencedor: RA empunhando arma, RB desarmado (spec §8.1).
 * @param {{ra: number, rb: number}} leitura
 */
export function danoDoAtaque(leitura, { armado, bonus = 0 }) {
  return armado ? leitura.ra + bonus : leitura.rb;
}

/**
 * Empate em ataques corpo a corpo opostos: os dois se acertam, desde que cada um
 * tenha atingido a DT básica (7).
 */
export function empateAcertaOsDois(totalA, totalB, dtBasica = 7) {
  return totalA === totalB && totalA >= dtBasica && totalB >= dtBasica;
}

/**
 * Esquiva (spec §8.1): o defensor abre mão de causar dano e rola Acrobacia com um
 * d6 somado. Se vencer, ninguém sofre nem causa dano — não é contra-ataque.
 * @returns {{dano: number, alvo: "atacante"|"defensor"|null}}
 */
export function resolverAtaque({ vencedor, esquiva, leituraAtacante, leituraDefensor, armadoAtacante, armadoDefensor, bonusAtacante = 0, bonusDefensor = 0 }) {
  if (vencedor === "empate") return { dano: 0, alvo: null };

  if (esquiva) {
    // Defesa pura: vencer só anula. Perder deixa o ataque acontecer normalmente.
    if (vencedor === "defensor") return { dano: 0, alvo: null };
    return { dano: danoDoAtaque(leituraAtacante, { armado: armadoAtacante, bonus: bonusAtacante }), alvo: "defensor" };
  }

  // Troca de golpes: quem vencer causa dano no outro.
  return vencedor === "atacante"
    ? { dano: danoDoAtaque(leituraAtacante, { armado: armadoAtacante, bonus: bonusAtacante }), alvo: "defensor" }
    : { dano: danoDoAtaque(leituraDefensor, { armado: armadoDefensor, bonus: bonusDefensor }), alvo: "atacante" };
}

/**
 * Como o personagem esquiva (botão Esquivar do card de ataque):
 * "declarada" — declarou Defender-se nesta rodada (a ação dele);
 * "habilidade" — tem Esquiva e ainda não usou nesta rodada (ação livre);
 * "livre" — NPC ou criatura, sem esse controle; null — não pode.
 */
export function modoDaEsquiva({ ehPersonagem, declarouDefesa, temEsquiva, esquivaUsada }) {
  if (!ehPersonagem) return "livre";
  if (declarouDefesa) return "declarada";
  if (temEsquiva && !esquivaUsada) return "habilidade";
  return null;
}
