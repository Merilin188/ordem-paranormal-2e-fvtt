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

/**
 * O que a ação faz:
 * - `teste`: teste da perícia; soma avanços (sempre ou só passando); falha = dano. Com
 *   `porAvanco`, falhar por 3 ou mais é cair: dano por avanço que faltava, e chega.
 * - `preparo`: teste; passando, +1 passo em `periciaBonus` até o fim da área (Procurar
 *   Trilhas). Não soma avanço.
 * - `equilibrio`: teste de equilíbrio (2d10 e os dados de equilíbrio); equilibrou, soma;
 *   caiu, sofre o dano e fica Na água (mantém os avanços).
 * - `salto`: dano de `porAvanco` por avanço que falta, reduzido pela RB se passar no
 *   teste; chega do outro lado de qualquer jeito (Salto de Fé).
 */
export const TIPOS_ACAO = ["teste", "preparo", "equilibrio", "salto"];
/** Em que estado a ação aparece: fora d'água (o normal) ou só Na água (Nadar). */
export const ESTADOS_ACAO = ["", "agua"];

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
    tipo: TIPOS_ACAO.includes(acao.tipo) ? acao.tipo : "teste",
    estado: ESTADOS_ACAO.includes(acao.estado) ? acao.estado : "",
    porAvanco: String(acao.porAvanco ?? "").trim(),
    periciaBonus: String(acao.periciaBonus ?? "").trim(),
  };
}

/** Uma área com tudo preenchido. */
export function normalizarArea(area = {}) {
  return {
    id: String(area.id ?? ""),
    nome: String(area.nome ?? "").trim(),
    avancos: Math.max(1, Math.trunc(Number(area.avancos) || 1)),
    acoes: (area.acoes ?? []).map(normalizarAcao),
    // Penalidade da área (Escuridão): a partir de N avanços, passos em todos os testes.
    penalidade: {
      aPartir: Math.max(0, Math.trunc(Number(area.penalidade?.aPartir) || 0)),
      passos: Math.trunc(Number(area.penalidade?.passos) || -1),
      nome: String(area.penalidade?.nome ?? "").trim(),
    },
  };
}

/** A área em que a cena está, ou null (cena sem travessia, ou já passou da última). */
export function areaAtual(config, indice = 0) {
  const area = (config?.areas ?? [])[indice];
  return area ? normalizarArea(area) : null;
}

/**
 * "1d6" por avanço, `n` avanços → "3d6" (um dado por avanço). Outra fórmula vira
 * "(fórmula)*n". Pura.
 */
export function formulaPorAvanco(formula, n) {
  const f = String(formula ?? "").trim();
  if (!f || n <= 0) return null;
  const m = f.match(/^(\d*)d(\d+)$/i);
  return m ? `${(Number(m[1]) || 1) * n}d${m[2]}` : `(${f})*${n}`;
}

/**
 * O que a ação rende: os avanços e, se falhou, o dano a rolar (ou null). Crítico conta
 * como sucesso; falha crítica, como falha. Com `porAvanco`, falhar por 3 ou mais
 * (`margem` ≤ −3) é cair: chega do outro lado (os avanços que faltam) com dano por
 * avanço que faltava.
 * @returns {{avancos: number, dano: string|null, caiu: boolean}}
 */
export function resultadoDaAcao(acao, sucesso, { margem = 0, faltam = 0 } = {}) {
  const a = normalizarAcao(acao);
  if (!sucesso && a.porAvanco && margem <= -3 && faltam > 0) {
    return { avancos: faltam, dano: formulaPorAvanco(a.porAvanco, faltam), caiu: true };
  }
  const avancos = a.quando === "sempre" || sucesso ? a.avancos : 0;
  return { avancos, dano: !sucesso && a.danoFalha ? a.danoFalha : null, caiu: false };
}

/** Salto de Fé: o dano de `porAvanco` por avanço que falta; passar no teste reduz pela RB. Pura. */
export function danoDoSalto(danoRolado, sucesso, rb) {
  return Math.max(0, Number(danoRolado) - (sucesso ? Number(rb) || 0 : 0));
}

/** As ações que aparecem para este personagem: Na água só as de água; fora, só as outras. */
export function acoesDisponiveis(area, participante) {
  const agua = Boolean(participante?.agua);
  return (area?.acoes ?? []).filter((a) => (a.estado === "agua") === agua);
}

/**
 * Passos no teste de uma ação: o bônus que ele preparou (Procurar Trilhas) naquela
 * perícia e a penalidade da área (Escuridão) se já tem os avanços. Pura.
 * @returns {{bonus: number, penalidade: number}}
 */
export function passosNaArea(area, participante, pericia) {
  const bonus = Number(participante?.bonus?.[pericia]) || 0;
  const p = area?.penalidade;
  const penalidade = p?.aPartir > 0 && (participante?.avancos ?? 0) >= p.aPartir ? p.passos : 0;
  return { bonus, penalidade };
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
