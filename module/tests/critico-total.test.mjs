import test from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();

test("crítico não rola dado extra: o OP2Roll não soma nada ao total do core", async () => {
  const { OP2Roll } = await import("../dice/op2-roll.mjs");
  // O total é o do Roll do Foundry; antes um getter próprio somava o dado extra.
  assert.equal(Object.getOwnPropertyDescriptor(OP2Roll.prototype, "total"), undefined);
  const roll = OP2Roll.paraComponentes([{ chave: "a", tipo: "extra", dado: "d8" }, { chave: "b", tipo: "extra", dado: "d8" }]);
  assert.ok(roll.options.id, "o teste ganha um id");
});

test("crítico em ataque e teste estendido soma as duas rolagens mais altas", async () => {
  const { duasMaisAltas } = await import("../dice/analise.mjs");
  const d = (resultado, contado = true) => ({ resultado, contado });
  assert.deepEqual(duasMaisAltas([d(6), d(6), d(3)]), [6, 6]);
  assert.deepEqual(duasMaisAltas([d(8), d(2), d(8), d(10, false)]), [8, 8]);
  assert.deepEqual(duasMaisAltas([d(7)]), [7]);
});
