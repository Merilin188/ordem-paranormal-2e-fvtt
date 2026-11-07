import test from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();

test("reducoes: so as da rodada atual contam", async () => {
  const { reducoesDaRodada } = await import("../cena/reducoes.mjs");
  const lista = [{ rodada: "c1.1", passos: 1, motivo: "a" }, { rodada: "c1.2", passos: 1, motivo: "b" }];
  assert.deepEqual(reducoesDaRodada(lista, "c1.2").map((r) => r.motivo), ["b"]);
  assert.deepEqual(reducoesDaRodada(undefined, "c1.2"), []);
});

test("arma a distancia: pelo campo ou pelo nome", async () => {
  const { armaADistancia } = await import("../cena/acoes-combate.mjs");
  assert.equal(armaADistancia({ name: "Faca", system: { distancia: false } }), false);
  assert.equal(armaADistancia({ name: "Arco curto", system: {} }), true);
  assert.equal(armaADistancia({ name: "Revólver .38", system: {} }), true);
  assert.equal(armaADistancia({ name: "Lança", system: { distancia: true } }), true);
  assert.equal(armaADistancia(null), false);
});

test("vantagens: proxima rodada e so contra o alvo certo", async () => {
  const { proximaChave, vantagensAtivas } = await import("../cena/reducoes.mjs");
  assert.equal(proximaChave("cAbc.3"), "cAbc.4");
  assert.equal(proximaChave("i.9"), "i.10");
  const lista = [
    { tipo: "finta", alvoUuid: "A", rodadas: ["c.1", "c.2"] },
    { tipo: "mira", alvoUuid: "A", rodadas: ["c.2"] },
    { tipo: "finta", alvoUuid: "B", rodadas: ["c.1", "c.2"] },
  ];
  assert.deepEqual(vantagensAtivas(lista, "c.1", "A").map((v) => v.tipo), ["finta"]);
  assert.deepEqual(vantagensAtivas(lista, "c.2", "A").map((v) => v.tipo), ["finta", "mira"]);
  assert.deepEqual(vantagensAtivas(lista, "c.3", "A"), []);
});
