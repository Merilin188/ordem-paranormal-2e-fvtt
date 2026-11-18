/**
 * Regras que mudaram na versão 1.2 do PDF de Contos da Vigília: crítico com 4 dados,
 * pavor "Apenas em Testes", Escalar e Primeiros Socorros.
 */
import test from "node:test";
import assert from "node:assert/strict";
import "./stub-foundry.mjs";
import * as a from "../dice/analise.mjs";
import { passoDaEscalada, desafioResolvido } from "../cena/desafios.mjs";
import { dtDosPrimeirosSocorros, reducoesDosPrimeirosSocorros } from "../cena/primeiros-socorros.mjs";

const d = (...specs) => specs.map((s, i) => {
  const [dado, valor, contado] = s.split(":");
  return { indice: i, dado, resultado: Number(valor), contado: contado !== "off" };
});

test("4 dados sem crítico: descarta o menor", () => {
  assert.deepEqual(a.selecaoSugerida(d("d8:8", "d8:7", "d6:5", "d6:2")), [0, 1, 2]);
});

test("4 dados: o menor fica quando é um dos dados do crítico (8, 7, 6, 6 → 8, 6, 6)", () => {
  assert.deepEqual(a.selecaoSugerida(d("d8:8", "d8:7", "d6:6", "d6:6")), [0, 2, 3]);
  const escolhidos = new Set(a.selecaoSugerida(d("d8:8", "d8:7", "d6:6", "d6:6")));
  const dados = d("d8:8", "d8:7", "d6:6", "d6:6").map((x) => ({ ...x, contado: escolhidos.has(x.indice) }));
  const r = a.analisar(dados, { dt: 30, escopoCritico: "contados" });
  assert.equal(r.critico, true);
  assert.equal(r.total, 20);
});

test("4 dados: o crítico sai dos três que ficam (descartar o par perde o crítico)", () => {
  const dados = d("d8:8", "d8:7", "d6:6", "d6:6:off");
  assert.equal(a.analisar(dados, { escopoCritico: "contados" }).critico, false);
});

test("crítico facilitado (espada, 5+) também preserva o par na seleção", () => {
  assert.deepEqual(a.selecaoSugerida(d("d8:8", "d8:7", "d6:5", "d6:5"), 5), [0, 2, 3]);
  assert.deepEqual(a.selecaoSugerida(d("d8:8", "d8:7", "d6:5", "d6:5")), [0, 1, 2]);
});

test("pavor: os anulados saem da soma, mas valem para RA e RB", () => {
  const contados = d("d8:7", "d6:5");
  const anulados = d("d6:2");
  assert.deepEqual(a.raRbComAnulados(contados, anulados), { ra: 7, rb: 2 });
  assert.deepEqual(a.raRbComAnulados([], d("d6:3", "d4:1")), { ra: 3, rb: 1 });
});

test("escalar: rápida soma a RA, cautelosa a RB", () => {
  assert.deepEqual(passoDaEscalada({ modo: "rapida", sucesso: true, ra: 8, rb: 4 }, 0, 10),
    { pontos: 8, ganho: 8, caiu: false, dano: 0, chegou: false });
  assert.deepEqual(passoDaEscalada({ modo: "cautelosa", sucesso: true, ra: 5, rb: 3 }, 8, 10),
    { pontos: 11, ganho: 3, caiu: false, dano: 0, chegou: true });
});

test("escalar: falhar derruba com dano igual ao acumulado e zera", () => {
  assert.deepEqual(passoDaEscalada({ modo: "rapida", sucesso: false, ra: 3, rb: 1 }, 8, 10),
    { pontos: 0, ganho: 0, caiu: true, dano: 8, chegou: false });
});

test("escalar: crítico soma as duas rolagens mais altas", () => {
  const r = passoDaEscalada({ modo: "cautelosa", sucesso: true, ra: 7, rb: 7, critico: true, duas: [7, 7] }, 0, 10);
  assert.equal(r.ganho, 14);
  assert.equal(r.chegou, true);
});

test("escalar vencido resolve o desafio", () => {
  assert.equal(desafioResolvido({ abordagens: { escalar: true }, escalar: { resolvido: true } }), true);
  assert.equal(desafioResolvido({ abordagens: { escalar: true }, escalar: { resolvido: false } }), false);
});

test("primeiros socorros: DT 7, 10, 13 e reduções que somam", () => {
  assert.deepEqual([0, 1, 2].map(dtDosPrimeirosSocorros), [7, 10, 13]);
  assert.equal(reducoesDosPrimeirosSocorros({ temMaleta: true }), 0);
  assert.equal(reducoesDosPrimeirosSocorros({ temMaleta: false }), 2);
  assert.equal(reducoesDosPrimeirosSocorros({ temMaleta: false, emSiMesmo: true }), 4);
});
