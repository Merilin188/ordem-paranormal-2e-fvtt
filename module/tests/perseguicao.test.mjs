import { test } from "node:test";
import assert from "node:assert/strict";
import { folegoInicial, formulaDoEsforco, pontosDoAvanco, quemEAlcancado, proximoCorte } from "../cena/perseguicao-regras.mjs";
import { dadosDoAtaque, danoDoAtaque } from "../data/ataque-criatura.mjs";

test("fôlego é metade do dado de Vigor em d6", () => {
  assert.equal(folegoInicial("d6"), 3);
  assert.equal(folegoInicial("d10"), 5);
});

test("esforço extra cresce 1d4 por uso", () => {
  assert.deepEqual([0, 1, 2].map(formulaDoEsforco), ["1d4", "2d4", "3d4"]);
});

test("avanço: RA se passou, RB se falhou", () => {
  assert.equal(pontosDoAvanco({ sucesso: true, ra: 6, rb: 2 }), 6);
  assert.equal(pontosDoAvanco({ sucesso: false, ra: 6, rb: 2 }), 2);
});

test("corte: só o de menor PA abaixo do limite é alcançado; empate pede teste oposto", () => {
  const ps = [{ uuid: "a", pa: 10 }, { uuid: "b", pa: 12 }, { uuid: "c", pa: 20 }];
  assert.equal(quemEAlcancado(ps, 3).alvo, "a");
  assert.equal(quemEAlcancado(ps, 2).corte, null);
  assert.deepEqual(quemEAlcancado([{ uuid: "a", pa: 9 }, { uuid: "b", pa: 9 }], 3).empate, ["a", "b"]);
  assert.equal(quemEAlcancado([{ uuid: "a", pa: 9, morto: true }, { uuid: "b", pa: 16 }], 3).alvo, null);
  assert.deepEqual(proximoCorte(1), { rodada: 3, pa: 15 });
  assert.equal(proximoCorte(6), null);
});

test("ataque de criatura: dados e dano do bloco", () => {
  assert.deepEqual(dadosDoAtaque("2d10"), ["d10", "d10"]);
  assert.deepEqual(dadosDoAtaque("d8 + d6"), ["d8", "d6"]);
  assert.deepEqual(dadosDoAtaque("2x"), []);
  assert.deepEqual(danoDoAtaque("RA+4"), { base: "ra", bonus: 4 });
  assert.deepEqual(danoDoAtaque("rb"), { base: "rb", bonus: 0 });
  assert.equal(danoDoAtaque(""), null);
});
