import { test } from "node:test";
import assert from "node:assert/strict";
import "./stub-foundry.mjs";
import { aparenciaDosDados, escurecer, luminancia } from "../ui/dados-3d.mjs";

test("o dado pega a cor do usuario, com etiqueta legivel", () => {
  const ana = aparenciaDosDados("#bf64a7");
  assert.equal(ana.diceColor, "#bf64a7");
  assert.equal(ana.edgeColor, "#bf64a7");
  assert.equal(ana.material, "pristine");
  assert.equal(ana.labelColor, "#0b0b0b");
  assert.equal(aparenciaDosDados("#1a1a40").labelColor, "#f4f1ea");
});

test("contorno e a cor escurecida; cor invalida cai no branco", () => {
  assert.equal(escurecer("#ffffff", 0.5), "#808080");
  assert.equal(aparenciaDosDados("vermelho").diceColor, "#f5f5f5");
  assert.ok(luminancia("#ffffff") > 0.99 && luminancia("#000000") === 0);
});
