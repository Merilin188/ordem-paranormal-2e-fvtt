import { test } from "node:test";
import assert from "node:assert/strict";
import { dadosDoPlano } from "../cena/poderes-regras.mjs";

test("Plano Estrategico: passar da 1d6, e +1d6 a cada 3 acima da DT", () => {
  assert.deepEqual([7, 8, 9].map((t) => dadosDoPlano(t, true)), [1, 1, 1]);
  assert.deepEqual([10, 11, 12].map((t) => dadosDoPlano(t, true)), [2, 2, 2]);
  assert.equal(dadosDoPlano(13, true), 3);
  assert.equal(dadosDoPlano(6, false), 0);
});
