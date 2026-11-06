import { test } from "node:test";
import assert from "node:assert/strict";
import { dadosDoPlano } from "../cena/poderes-regras.mjs";

test("Plano Estrategico: passar da 1d6, e +1d6 a cada 3 acima da DT", () => {
  assert.deepEqual([7, 8, 9].map((t) => dadosDoPlano(t, true)), [1, 1, 1]);
  assert.deepEqual([10, 11, 12].map((t) => dadosDoPlano(t, true)), [2, 2, 2]);
  assert.equal(dadosDoPlano(13, true), 3);
  assert.equal(dadosDoPlano(6, false), 0);
});

test("Analise e Mentoria viram notas do card", async () => {
  const { ajustesDoTeste } = await import("../cena/poderes-regras.mjs");
  assert.deepEqual(ajustesDoTeste("Rhiona", [3, 10], [5, 10], 2), [
    { tipo: "analise", nome: "Rhiona", gastos: 2, mudancas: [{ de: 3, para: 5 }] },
  ]);
  assert.deepEqual(ajustesDoTeste("Rhiona", [3, 4], [3, 6], 0, 1), [{ tipo: "mentoria", nome: "Rhiona", de: 4, para: 6 }]);
  assert.deepEqual(ajustesDoTeste("Rhiona", [3, 4], [3, 4], 0), []);
  // Troca por um valor igual ainda conta como troca; recusar também vira nota.
  assert.deepEqual(ajustesDoTeste("Muirenn", [3, 4], [3, 4], 0, 1, 4), [{ tipo: "mentoria", nome: "Muirenn", de: 4, para: 4 }]);
  assert.deepEqual(ajustesDoTeste("Muirenn", [3, 4], [3, 4], 0, null, 4), [{ tipo: "mentoriaRecusada", nome: "Muirenn", valor: 4 }]);
});

test("Antecipacao Tatica: so na primeira rodada, uma vez, personagem com a habilidade", async () => {
  const { instalarStubs } = await import("./stub-foundry.mjs");
  instalarStubs();
  const { podeAntecipar } = await import("../cena/poderes.mjs");
  const base = { rodada: 1, temHabilidade: true, jaUsou: false, ehNpc: false };
  assert.equal(podeAntecipar(base), true);
  assert.equal(podeAntecipar({ ...base, rodada: 2 }), false);
  assert.equal(podeAntecipar({ ...base, jaUsou: true }), false);
  assert.equal(podeAntecipar({ ...base, temHabilidade: false }), false);
  assert.equal(podeAntecipar({ ...base, ehNpc: true }), false);
});
