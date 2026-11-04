/**
 * Tabelas de Lesões (1d20), Traumas (1d20) e Falha crítica (1d8) — dados puros,
 * sem Foundry, para dar pra testar offline. Textos resumidos das regras do playtest.
 *
 * `efeito` diz o que a automação faz ao sair o resultado:
 * - `morte`         marca Morto
 * - `pv`/`pd`       recupera N pontos
 * - `marca`         registra na ficha (lesão permanente / trauma até ser curado)
 * - `reducao`       reduz um atributo em um passo até o fim da cena
 * - `pavor`         recebe um dado de pavor
 * - `narrativo`     só o texto (o mestre aplica)
 */

export const TABELA_LESOES = [
  { de: 1, ate: 4, chave: "morteSubita", nome: "Morte Súbita", texto: "O personagem morre.", efeito: "morte" },
  { de: 5, ate: 9, chave: "morteLenta", nome: "Morte Lenta", texto: "Ferimento fatal: recupera 1 PV (acorda, se inconsciente) e age uma última vez; morre ao fim da rodada seguinte.", efeito: "morteLenta" },
  { de: 10, ate: 10, chave: "laceracao", nome: "Laceração Profunda", texto: "Perde 2 PV máximos. Acumula se sair de novo.", efeito: "marca", acumula: true, mods: { pvMax: -2 } },
  { de: 11, ate: 11, chave: "semOlho", nome: "Sem Olho", texto: "Perde um olho: −1 em Percepção e Pontaria.", efeito: "marca", mods: { pericia: { percepcao: -1, pontaria: -1 } } },
  { de: 12, ate: 12, chave: "semMao", nome: "Sem Mão", texto: "Perde uma mão ou braço: empunha um item só; tarefas de duas mãos sofrem redução de passo ou falham (a critério do mestre).", efeito: "marca" },
  { de: 13, ate: 13, chave: "semPe", nome: "Sem Pé", texto: "Perde um pé ou perna: duas reduções de passo para se movimentar e em perseguições a pé.", efeito: "marca" },
  { de: 14, ate: 14, chave: "tendao", nome: "Tendão Comprometido", texto: "−2 em Acrobacia.", efeito: "marca", mods: { pericia: { acrobacia: -2 } } },
  { de: 15, ate: 15, chave: "musculo", nome: "Músculo Comprometido", texto: "−2 em Atletismo.", efeito: "marca", mods: { pericia: { atletismo: -2 } } },
  { de: 16, ate: 16, chave: "orgaoInterno", nome: "Órgão Interno Comprometido", texto: "−2 em Vigor.", efeito: "marca", mods: { pericia: { vigor: -2 } } },
  { de: 17, ate: 17, chave: "orgaoSensorial", nome: "Órgão Sensorial Comprometido", texto: "−2 em Percepção.", efeito: "marca", mods: { pericia: { percepcao: -2 } } },
  { de: 18, ate: 18, chave: "cicatriz", nome: "Cicatriz Assustadora", texto: "−2 em Persuasão e +1 em Intimidar.", efeito: "marca", mods: { pericia: { persuasao: -2, intimidar: 1 } } },
  { de: 19, ate: 19, chave: "contusao", nome: "Contusão", texto: "Físico reduz um passo até o fim da cena.", efeito: "reducao", alvo: "fisico" },
  { de: 20, ate: 99, chave: "surto", nome: "Surto de Adrenalina", texto: "Sem sequelas: recupera 1 PV.", efeito: "pv", quantidade: 1 },
];

export const TABELA_TRAUMAS = [
  { de: 1, ate: 4, chave: "colapso", nome: "Colapso Total", texto: "A mente sucumbe: o corpo vive, mas o personagem está perdido.", efeito: "morte" },
  { de: 5, ate: 6, chave: "tept", nome: "Estresse Pós-Traumático", texto: "Todo dano emocional sofrido aumenta em +1.", efeito: "marca", mods: { danoEmocional: 1 } },
  { de: 7, ate: 8, chave: "degradacao", nome: "Degradação Cognitiva", texto: "−1 em testes de Mente.", efeito: "marca", mods: { atributo: { mente: -1 } } },
  { de: 9, ate: 10, chave: "macula", nome: "Mácula Psíquica", texto: "−1 em testes de Emoção.", efeito: "marca", mods: { atributo: { emocao: -1 } } },
  { de: 11, ate: 12, chave: "chaga", nome: "Chaga da Alma", texto: "Perde 2 PD máximos enquanto durar.", efeito: "marca", mods: { pdMax: -2 } },
  { de: 13, ate: 14, chave: "retracao", nome: "Retração Defensiva", texto: "−2 em Persuasão e Intuição.", efeito: "marca", mods: { pericia: { persuasao: -2, intuicao: -2 } } },
  { de: 15, ate: 17, chave: "panico", nome: "Pânico", texto: "Recebe um dado de pavor.", efeito: "pavor" },
  { de: 18, ate: 19, chave: "estupor", nome: "Estupor Catatônico", texto: "Perde a ação na próxima rodada.", efeito: "narrativo" },
  { de: 20, ate: 99, chave: "animo", nome: "Injeção de Ânimo", texto: "Sem sequelas: recupera 1 PD.", efeito: "pd", quantidade: 1 },
];

export const TABELA_FALHA_CRITICA_TEXTO = [
  { de: 1, ate: 1, chave: "vexame", nome: "Vexame", texto: "Descreva a ação de forma vergonhosa. Sem efeito em regras além da falha." },
  { de: 2, ate: 2, chave: "machucado", nome: "Machucado", texto: "Físico diminui um passo até o fim da cena." },
  { de: 3, ate: 3, chave: "desatencao", nome: "Desatenção", texto: "Mente diminui um passo até o fim da cena." },
  { de: 4, ate: 4, chave: "irritacao", nome: "Irritação", texto: "Emoção diminui um passo até o fim da cena." },
  { de: 5, ate: 5, chave: "acidente", nome: "Acidente", texto: "Perde 1d4 PV." },
  { de: 6, ate: 6, chave: "frustracao", nome: "Frustração", texto: "Perde 1d4 PD." },
  { de: 7, ate: 7, chave: "perda", nome: "Perda", texto: "Um item carregado (ou espaço de compra) se perde: estragou, foi esquecido ou roubado." },
  { de: 8, ate: 8, chave: "nenhum", nome: "Nenhum efeito adicional", texto: "Só a falha normal." },
];

export const TABELAS = {
  lesoes: { formula: "1d20", titulo: "Lesões", linhas: TABELA_LESOES, rerrolaRepetida: true },
  traumas: { formula: "1d20", titulo: "Traumas", linhas: TABELA_TRAUMAS, rerrolaRepetida: true },
  falhaCritica: { formula: "1d8", titulo: "Efeitos de falhas críticas", linhas: TABELA_FALHA_CRITICA_TEXTO, rerrolaRepetida: false },
};

/** Linha da tabela para um resultado. */
export function linhaDaTabela(tabela, resultado) {
  const linhas = TABELAS[tabela]?.linhas ?? [];
  return linhas.find((l) => resultado >= l.de && resultado <= l.ate) ?? linhas.at(-1) ?? null;
}

/** Rótulo da faixa ("1-4", "10", "20+"). */
export function rotuloDaFaixa(linha) {
  if (linha.ate >= 99) return `${linha.de}+`;
  return linha.de === linha.ate ? `${linha.de}` : `${linha.de}-${linha.ate}`;
}

/**
 * Já possui essa marca? Lesões/traumas repetidos rolam de novo (exceto Laceração,
 * que acumula).
 */
export function marcaRepetida(tabela, linha, marcas) {
  if (linha?.efeito !== "marca" || linha.acumula) return false;
  return (marcas ?? []).some((m) => m.chave === linha.chave);
}

function linhaPorChave(chave) {
  return TABELA_LESOES.find((l) => l.chave === chave) ?? TABELA_TRAUMAS.find((l) => l.chave === chave) ?? null;
}

/** Nome e texto de uma marca registrada na ficha. */
export function descreverMarca(chave) {
  const linha = linhaPorChave(chave);
  return linha ? { nome: linha.nome, texto: linha.texto } : { nome: chave, texto: "" };
}

/**
 * Soma os modificadores das lesões e traumas registrados.
 * @returns {{pericia: Record<string, number>, atributo: Record<string, number>, pvMax: number, pdMax: number, danoEmocional: number}}
 */
export function modificadoresDasMarcas(lesoes = [], traumas = []) {
  const total = { pericia: {}, atributo: {}, pvMax: 0, pdMax: 0, danoEmocional: 0 };
  for (const { chave } of [...lesoes, ...traumas]) {
    const mods = linhaPorChave(chave)?.mods;
    if (!mods) continue;
    for (const [k, v] of Object.entries(mods.pericia ?? {})) total.pericia[k] = (total.pericia[k] ?? 0) + v;
    for (const [k, v] of Object.entries(mods.atributo ?? {})) total.atributo[k] = (total.atributo[k] ?? 0) + v;
    total.pvMax += mods.pvMax ?? 0;
    total.pdMax += mods.pdMax ?? 0;
    total.danoEmocional += mods.danoEmocional ?? 0;
  }
  return total;
}

/**
 * Modificador fixo de um teste: o da perícia mais o do atributo pareado.
 * @param {{pericia: object, atributo: object}} mods
 */
export function modificadorDoTeste(mods, chavePericia, chaveAtributo) {
  if (!mods) return 0;
  const base = String(chavePericia ?? "").split(".")[0];
  return (mods.pericia?.[base] ?? 0) + (chaveAtributo ? (mods.atributo?.[chaveAtributo] ?? 0) : 0);
}

/* ---------------- Dado de pavor ---------------- */

/**
 * O dado de pavor "consome" os dados do teste que tiraram MENOS que ele: esses não
 * contam (nem para soma, RA/RB ou crítico).
 * @param {number[]} resultados  resultados dos dados do teste
 * @param {number} pavor         resultado do dado de pavor
 * @returns {boolean[]} consumido por posição
 */
export function consumidosPeloPavor(resultados, pavor) {
  return resultados.map((r) => r < pavor);
}

/* ---------------- Teste de equilíbrio ---------------- */

/** Equilibrado: os dois d10 iguais ou com 1 de diferença. */
export function equilibrado(a, b) {
  return Math.abs(a - b) <= 1;
}

/** Dados de equilíbrio (d4) = metade das faces da Acrobacia (d4 → 2, d6 → 3…). */
export function dadosDeEquilibrio(dadoAcrobacia) {
  const faces = Number(String(dadoAcrobacia ?? "d4").replace(/^d/, "")) || 4;
  return Math.floor(faces / 2);
}

/* ---------------- Iniciativa por fases ---------------- */

/** Valor de iniciativa de cada fase: maior age antes. */
export const FASES_COMBATE = { geral: 3, distancia: 2, corpo: 1 };

export function faseDoValor(valor) {
  return Object.entries(FASES_COMBATE).find(([, v]) => v === Number(valor))?.[0] ?? null;
}
