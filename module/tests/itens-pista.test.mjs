import test from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();

test("itens da pista: o mestre tira itens; só o resto vai para a ficha", async () => {
  const { itensAEntregar, chaveDoItem, podeSerItemDePista } = await import("../cena/itens-pista.mjs");
  const uuids = ["Item.gladio", "Item.elmo"];
  assert.deepEqual(itensAEntregar("i1", uuids, []), uuids);
  assert.deepEqual(itensAEntregar("i1", uuids, [chaveDoItem("i1", "Item.elmo")]), ["Item.gladio"]);
  // Tirar o item de OUTRA pista do mesmo card não mexe nesta.
  assert.deepEqual(itensAEntregar("i1", uuids, [chaveDoItem("i2", "Item.elmo")]), uuids);
  assert.equal(podeSerItemDePista({ type: "equipamento" }), true);
  assert.equal(podeSerItemDePista({ type: "desafio-acesso" }), false);
  assert.equal(podeSerItemDePista(null), false);
});
