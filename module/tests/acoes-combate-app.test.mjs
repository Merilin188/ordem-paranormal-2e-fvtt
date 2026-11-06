import { test } from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();

test("acoes de combate: gerais, ataques e manobras; regras de referencia sem botao", async () => {
  const { acoesDeCombate } = await import("../cena/acoes-combate-app.mjs");
  const secoes = acoesDeCombate();
  assert.equal(secoes.length, 3);
  const todos = secoes.flatMap((s) => s.itens);
  assert.ok(todos.find((a) => a.titulo === "Defender-se").executavel);
  assert.ok(todos.find((a) => a.titulo === "Agredir").executavel);
  assert.ok(todos.find((a) => a.titulo === "Agarrar").executavel);
  assert.equal(todos.find((a) => a.titulo === "Dano").executavel, false);
});
