import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dtPorUsos, formulaPeloMaiorDado, aplicarBusca, perderDado, limparPerdidos, encontrado, dadosAtivos, TABELA_CRIATURAS,
} from "../cena/furtividade-regras.mjs";
import { nivelDeLoucura } from "../ui/vinheta-loucura.mjs";

const pj = (uuid, valores) => ({ uuid, testou: true, dados: valores.map((v, i) => ({ id: `${uuid}${i}`, dado: "d8", valor: v })) });

test("DT das ações especiais sobe +3 por uso", () => {
  assert.deepEqual([0, 1, 2].map(dtPorUsos), [7, 10, 13]);
});

test("linha 8 e 9 escolhem a fórmula pelo maior dado", () => {
  const f = TABELA_CRIATURAS[8].formulas;
  assert.equal(formulaPeloMaiorDado([{ dado: "d12" }, { dado: "d6" }], f), "1d12");
  assert.equal(formulaPeloMaiorDado([{ dado: "d10" }], f), "2d10");
  assert.equal(formulaPeloMaiorDado([{ dado: "d8" }, { dado: "d4" }], f), "3d8");
});

test("busca descarta todos os dados com valor igual e acusa quem foi encontrado", () => {
  const r = aplicarBusca([pj("a", [3, 5, 7]), pj("b", [3]), pj("c", [8])], [3, 5], "e1");
  assert.equal(r.perdas.length, 3);
  assert.deepEqual(r.descobertos, ["b"]);
  assert.deepEqual(dadosAtivos(r.participantes[0]).map((d) => d.valor), [7]);
  assert.equal(encontrado(r.participantes[1]), true);
  assert.equal(encontrado(r.participantes[2]), false);
});

test("busca com alvo só procura o alvo", () => {
  const r = aplicarBusca([pj("a", [3]), pj("b", [3])], [3], "e1", ["b"]);
  assert.deepEqual(r.descobertos, ["b"]);
  assert.equal(dadosAtivos(r.participantes[0]).length, 1);
});

test("perdidos de eventos antigos saem; os do atual ficam para a animação", () => {
  let p = perderDado(pj("a", [1, 2]), "a0", "e1");
  p = perderDado(p, "a1", "e2");
  assert.deepEqual(limparPerdidos(p, "e2").dados.map((d) => d.id), ["a1"]);
});

test("quem ainda não testou não conta como encontrado", () => {
  assert.equal(encontrado({ uuid: "x", dados: [], testou: false }), false);
});

test("loucura começa abaixo da metade dos PD e chega a 1 no zero", () => {
  assert.equal(nivelDeLoucura({ value: 10, max: 20 }), 0);
  assert.equal(nivelDeLoucura({ value: 5, max: 20 }), 0.5);
  assert.equal(nivelDeLoucura({ value: 0, max: 20 }), 1);
  assert.equal(nivelDeLoucura({ value: 3, max: 0 }), 0);
});
