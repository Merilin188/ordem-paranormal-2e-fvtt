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

test("acoes opostas: Fintar contra Intuicao, manobras contra Acrobacia ou Luta; Mirar pede alvo", async () => {
  const { OPOSTAS, COM_ALVO, acoesDeCombate } = await import("../cena/acoes-combate-app.mjs");
  assert.deepEqual(OPOSTAS.Fintar, { pericia: "enganacao", defesas: ["intuicao"] });
  for (const m of ["Agarrar", "Derrubar", "Desarmar", "Empurrar", "Quebrar"]) {
    assert.deepEqual(OPOSTAS[m].defesas, ["acrobacia", "luta"]);
  }
  assert.ok(COM_ALVO.has("Mirar"));
  // Todo titulo com alvo existe no guia (o texto do guia e a chave da acao).
  const titulos = new Set(acoesDeCombate().flatMap((s) => s.itens.map((a) => a.titulo)));
  for (const t of COM_ALVO) assert.ok(titulos.has(t), t);
});

test("desfecho oposto: precisa vencer; empate sem efeito; 5 ou mais e forte", async () => {
  const { desfechoOposto } = await import("../cena/acoes-combate-app.mjs");
  assert.deepEqual(desfechoOposto(11, 7), { venceu: true, empate: false, margem: 4, forte: false });
  assert.equal(desfechoOposto(12, 7).forte, true);
  assert.equal(desfechoOposto(7, 7).empate, true);
  assert.equal(desfechoOposto(7, 7).venceu, false);
  assert.equal(desfechoOposto(6, 9).venceu, false);
});
