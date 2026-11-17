/**
 * Travessia por áreas dentro da cena de furtividade (os desafios naturais da Missão
 * 1: bosque, rio, encosta) — só regra, sem Foundry.
 *
 * Cada área pede N avanços. Na fase dos personagens, cada ação da área é um teste:
 * soma avanços SEMPRE (atravessar o bosque: os avanços vêm, o teste só diz se você se
 * arranha) ou SÓ SE PASSAR (nadar, descer escalando), e a falha pode custar dano.
 * Quem chega ao total escolhe ficar parado em segurança (não age e não perde dados de
 * esconderijo: a busca das criaturas passa por ele) ou seguir agindo, exposto. Quando
 * todos chegam, o mestre passa para a próxima área.
 */

export const QUANDO_AVANCA = ["sempre", "sucesso"];

/** Uma ação da área com tudo preenchido (o que vem da configuração pode faltar campo). */
export function normalizarAcao(acao = {}) {
  return {
    id: String(acao.id ?? ""),
    nome: String(acao.nome ?? "").trim(),
    pericia: String(acao.pericia ?? "acrobacia"),
    dt: Math.max(1, Number(acao.dt) || 7),
    avancos: Math.max(0, Math.trunc(Number(acao.avancos) || 0)),
    quando: QUANDO_AVANCA.includes(acao.quando) ? acao.quando : "sucesso",
    danoFalha: String(acao.danoFalha ?? "").trim(),
  };
}

/** Uma área com tudo preenchido. */
export function normalizarArea(area = {}) {
  return {
    id: String(area.id ?? ""),
    nome: String(area.nome ?? "").trim(),
    avancos: Math.max(1, Math.trunc(Number(area.avancos) || 1)),
    acoes: (area.acoes ?? []).map(normalizarAcao),
  };
}

/** A área em que a cena está, ou null (cena sem travessia, ou já passou da última). */
export function areaAtual(config, indice = 0) {
  const area = (config?.areas ?? [])[indice];
  return area ? normalizarArea(area) : null;
}

/**
 * O que a ação rende: os avanços e, se falhou, o dano a rolar (ou null). Crítico conta
 * como sucesso; falha crítica, como falha.
 * @returns {{avancos: number, dano: string|null}}
 */
export function resultadoDaAcao(acao, sucesso) {
  const a = normalizarAcao(acao);
  const avancos = a.quando === "sempre" || sucesso ? a.avancos : 0;
  return { avancos, dano: !sucesso && a.danoFalha ? a.danoFalha : null };
}

/** Avanços depois de somar `delta` (nunca abaixo de zero; pode passar do total). */
export const somarAvancos = (atuais, delta) => Math.max(0, (Number(atuais) || 0) + (Number(delta) || 0));

/** Este personagem já cruzou a área. */
export const concluiu = (participante, area) => Boolean(area) && (participante?.avancos ?? 0) >= area.avancos;

/** Todos os personagens da cena cruzaram a área (cena vazia não conta como concluída). */
export function todosConcluiram(participantes, area) {
  return Boolean(area) && participantes.length > 0 && participantes.every((p) => concluiu(p, area));
}

/** Quem pode agir na área: está na cena, não está parado em segurança e não cruzou ainda… ou cruzou e seguiu agindo. */
export const podeAgirNaArea = (participante) => !participante?.seguro;
