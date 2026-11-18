/**
 * Leitura de um teste, isolada do Foundry.
 *
 * Fica separada de `OP2Roll` de propósito: são as regras mais sutis do playtest
 * (spec §4.2–4.5) e precisam ser testáveis sem subir o Foundry.
 */
import { MAX_DADOS_CONTADOS, VALOR_MINIMO_CRITICO } from "../config.mjs";

/**
 * @typedef {object} DadoRolado
 * @property {number} indice
 * @property {string} dado       "d8"
 * @property {number} resultado
 * @property {boolean} contado   entra na soma?
 */

/** @param {DadoRolado[]} dados */
export const contados = (dados) => dados.filter((d) => d.contado);

/** @param {DadoRolado[]} dados */
export const soma = (dados) => contados(dados).reduce((s, d) => s + d.resultado, 0);

/**
 * Rolagem Alta — o maior *valor* rolado, não o maior dado. Um d8 que saiu 3 ao lado de
 * um d6 que saiu 6 dá RA 6 (spec §4.2).
 * @param {DadoRolado[]} dados
 */
export function ra(dados) {
  const v = contados(dados).map((d) => d.resultado);
  return v.length ? Math.max(...v) : 0;
}

/**
 * Crítico em teste estendido e ataque: em vez de só a rolagem mais alta, somam-se
 * as DUAS mais altas (livro, Críticos). Não há dado extra — esse só existe no teste
 * de esconderijo. Devolve os dois valores, do maior para o menor.
 * @param {DadoRolado[]} dados
 */
export function duasMaisAltas(dados) {
  return contados(dados).map((d) => d.resultado).sort((a, b) => b - a).slice(0, 2);
}

/** Rolagem Baixa — o menor valor rolado. @param {DadoRolado[]} dados */
export function rb(dados) {
  const v = contados(dados).map((d) => d.resultado);
  return v.length ? Math.min(...v) : 0;
}

/**
 * O valor repetido que gera o crítico, ou null.
 *
 * Crítico é dois ou mais dados com o mesmo valor, e esse valor ≥ 6 (spec §4.3). Par de
 * 5 não conta; par de 1 é falha crítica, nunca crítico.
 *
 * @param {DadoRolado[]} dados
 * @param {"todos"|"contados"} [escopo] o sistema usa "contados": o crítico sai dos 3
 *   dados que ficam depois de descartar o 4º (v1.2, Críticos)
 */
export function valorCritico(dados, escopo = "todos", minimo = VALOR_MINIMO_CRITICO) {
  const alvo = escopo === "contados" ? contados(dados) : dados;
  const contagem = new Map();
  for (const d of alvo) {
    if (d.resultado < minimo) continue;
    contagem.set(d.resultado, (contagem.get(d.resultado) ?? 0) + 1);
  }
  const repetidos = [...contagem.entries()].filter(([, n]) => n >= 2).map(([v]) => v);
  return repetidos.length ? Math.max(...repetidos) : null;
}

/** Falha crítica: *todos* os dados em 1 (spec §4.3). @param {DadoRolado[]} dados */
export function ehFalhaCritica(dados, escopo = "todos") {
  const alvo = escopo === "contados" ? contados(dados) : dados;
  return alvo.length > 0 && alvo.every((d) => d.resultado === 1);
}

/**
 * Desfecho completo. Crítico e falha crítica têm precedência sobre a DT (spec §4.3).
 * @param {DadoRolado[]} dados
 * @param {{dt?: number|null, escopoCritico?: "todos"|"contados"}} [opcoes]
 */
export function analisar(dados, { dt = null, escopoCritico = "todos", minimoCritico = VALOR_MINIMO_CRITICO } = {}) {
  const critico = valorCritico(dados, escopoCritico, minimoCritico || VALOR_MINIMO_CRITICO);
  const falhaCritica = ehFalhaCritica(dados, escopoCritico);
  const total = soma(dados);

  let sucesso = null;
  if (critico !== null) sucesso = true;
  else if (falhaCritica) sucesso = false;
  else if (dt !== null) sucesso = total >= dt;

  let desfecho = "indefinido";
  if (critico !== null) desfecho = "critico";
  else if (falhaCritica) desfecho = "falha-critica";
  else if (sucesso !== null) desfecho = sucesso ? "sucesso" : "falha";

  return {
    total, dt,
    ra: ra(dados), rb: rb(dados),
    critico: critico !== null, valorCritico: critico,
    falhaCritica, sucesso, desfecho,
  };
}

/**
 * Seleção padrão quando se rola mais dados do que se soma (até 4 rolados, 3 somados).
 *
 * O livro (v1.2, Críticos): "se rolar 4 dados, determine o crítico após descartar o
 * menor valor". O padrão é descartar o menor — a menos que ele seja um dos dados do
 * crítico: 8, 7, 6, 6 mantém 8, 6, 6 (crítico) e descarta o 7. O jogador ainda pode
 * escolher outra combinação na janela de seleção (spec §4.5).
 * @param {DadoRolado[]} dados
 * @param {number} [minimo] valor mínimo do crítico (espada: 5)
 */
export function selecaoSugerida(dados, minimo = VALOR_MINIMO_CRITICO) {
  const ordenados = [...dados].sort((a, b) => b.resultado - a.resultado);
  if (ordenados.length <= MAX_DADOS_CONTADOS) return ordenados.map((d) => d.indice).sort((a, b) => a - b);
  const valor = valorCritico(dados, "todos", minimo || VALOR_MINIMO_CRITICO);
  let escolhidos;
  if (valor === null) escolhidos = ordenados.slice(0, MAX_DADOS_CONTADOS);
  else {
    const par = ordenados.filter((d) => d.resultado === valor).slice(0, 2);
    const resto = ordenados.filter((d) => !par.includes(d));
    escolhidos = [...par, ...resto].slice(0, MAX_DADOS_CONTADOS);
  }
  return escolhidos.map((d) => d.indice).sort((a, b) => a - b);
}

/**
 * Pavor "Apenas em Testes" (v1.2): os dados anulados saem só da soma e continuam
 * valendo para RA e RB. Recebe os dados contados e os anulados.
 * @param {DadoRolado[]} contadosDoTeste
 * @param {DadoRolado[]} anulados
 */
export function raRbComAnulados(contadosDoTeste, anulados) {
  const v = [...contadosDoTeste, ...anulados].map((d) => d.resultado);
  return v.length ? { ra: Math.max(...v), rb: Math.min(...v) } : { ra: 0, rb: 0 };
}
