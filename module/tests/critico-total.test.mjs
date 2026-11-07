import test from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();

test("total do teste soma o dado extra do critico", async () => {
  const { OP2Roll } = await import("../dice/op2-roll.mjs");
  const roll = OP2Roll.paraComponentes([{ chave: "a", tipo: "extra", dado: "d8" }, { chave: "b", tipo: "extra", dado: "d8" }]);
  roll._total = 16;
  assert.equal(roll.total, 16);
  roll.options.bonusCritico = { dado: "d8", valor: 7 };
  assert.equal(roll.total, 23);
  assert.ok(roll.options.id, "o teste ganha um id");
});
