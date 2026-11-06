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

test("vagalumes: cor pelo peso e brilho entre 0 e 1", async () => {
  const { corDoVagalume, piscar, CORES_VAGALUMES } = await import("../ui/efeitos-cena.mjs");
  assert.equal(corDoVagalume(0), CORES_VAGALUMES[0][0]);
  assert.equal(corDoVagalume(0.9999), CORES_VAGALUMES.at(-1)[0]);
  for (let t = 0; t < 10; t += 0.37) {
    const b = piscar(t, 0.3, 1);
    assert.ok(b >= 0.25 && b <= 1);
  }
});
