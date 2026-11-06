import test from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();
const { podeProteger } = await import("../cena/guardia.mjs");

test("Guardiã: aliado com a habilidade, 2 PD, uma vez por rodada", () => {
  const base = { temHabilidade: true, ehAlvo: false, ehAtacante: false, morto: false, pd: 2, usadaNaRodada: false };
  assert.equal(podeProteger(base), true);
  assert.equal(podeProteger({ ...base, ehAlvo: true }), false);
  assert.equal(podeProteger({ ...base, ehAtacante: true }), false);
  assert.equal(podeProteger({ ...base, pd: 1 }), false);
  assert.equal(podeProteger({ ...base, usadaNaRodada: true }), false);
  assert.equal(podeProteger({ ...base, morto: true }), false);
  assert.equal(podeProteger({ ...base, temHabilidade: false }), false);
});
