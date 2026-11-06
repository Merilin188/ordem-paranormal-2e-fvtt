import { test } from "node:test";
import assert from "node:assert/strict";
import "./stub-foundry.mjs";
import { cenaTemEfeitos, EFEITOS_DA_ENTRADA } from "../ui/efeitos-cena.mjs";

test("a cena configurada casa pelo nome ou pelo id, sem diferenciar maiusculas", () => {
  assert.equal(cenaTemEfeitos({ name: "Home", id: "abc" }, "home"), true);
  assert.equal(cenaTemEfeitos({ name: "Outra", id: "abc" }, "ABC"), true);
  assert.equal(cenaTemEfeitos({ name: "Primeira Cena", id: "x" }, "Home"), false);
});

test("vazio desliga", () => {
  assert.equal(cenaTemEfeitos({ name: "Home", id: "x" }, ""), false);
  assert.equal(cenaTemEfeitos(null, "Home"), false);
});

test("os tres efeitos rodam ate parar", () => {
  assert.deepEqual(EFEITOS_DA_ENTRADA.map((e) => e.action), ["fx.screenShake.start", "fx.screenBlur.start", "fx.screenSmear.start"]);
  assert.ok(EFEITOS_DA_ENTRADA.every((e) => e.durationMs === 0));
});
