import test from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();

test("uso de item: gasto pelas cargas ou pela quantidade", async () => {
  const { itemGasto, dadosDoGasto } = await import("../cena/usar-item.mjs");
  const runa = { gastaAoUsar: true, cargas: { usa: true, value: 1, max: 1 }, quantidade: 1 };
  assert.equal(itemGasto(runa), false);
  assert.deepEqual(dadosDoGasto(runa), { "system.cargas.value": 0 });
  assert.equal(itemGasto({ ...runa, cargas: { usa: true, value: 0, max: 1 } }), true);
  const pocao = { gastaAoUsar: true, cargas: { usa: false }, quantidade: 2 };
  assert.deepEqual(dadosDoGasto(pocao), { "system.quantidade": 1 });
  assert.equal(itemGasto({ ...pocao, quantidade: 0 }), true);
  assert.equal(itemGasto({ gastaAoUsar: false, quantidade: 0 }), false);
  assert.equal(dadosDoGasto({ gastaAoUsar: false }), null);
});

test("passiva: o status vale enquanto o item está na ficha e não foi gasto", async () => {
  const { statusDasPassivas } = await import("../cena/usar-item.mjs");
  const runa = (value) => ({ type: "equipamento", system: { passiva: { status: "runa" }, gastaAoUsar: true, cargas: { usa: true, value } } });
  assert.deepEqual(statusDasPassivas([runa(1)]), ["runa"]);
  assert.deepEqual(statusDasPassivas([runa(0)]), []);
  assert.deepEqual(statusDasPassivas([runa(1), runa(1)]), ["runa"]);
  assert.deepEqual(statusDasPassivas([{ type: "habilidade", system: { passiva: { status: "runa" } } }]), []);
});

test("Runa de Brenna: 1d10 PV OU 1d10 PD OU dado de esconderijo d10, uso único", async () => {
  const { RUNA_BRENNA, facesDaFormula } = await import("../cena/usar-item.mjs");
  const r = RUNA_BRENNA().system;
  assert.deepEqual(r.usos.map((u) => [u.formula, u.tipo]), [["1d10", "curaPV"], ["1d10", "curaPD"], ["1d10", "esconderijo"]]);
  assert.equal(r.escolhaUnica, true);
  assert.equal(r.gastaAoUsar, true);
  assert.deepEqual(r.cargas, { usa: true, value: 1, max: 1 });
  assert.equal(r.mensagemGasto, "Sua runa já foi apagada.");
  assert.equal(r.passiva.status, "runa");
  assert.equal(facesDaFormula("1d10"), 10);
  assert.equal(facesDaFormula("2d6+1"), 6);
});
