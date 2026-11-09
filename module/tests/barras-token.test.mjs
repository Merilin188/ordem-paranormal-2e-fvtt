import test from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();

test("barras: criatura some para os jogadores; personagem mostra o número", async () => {
  const { ajustarBarras } = await import("../ui/barras-token.mjs");
  const base = () => ({ bar1: { id: "bar1", attribute: "recursos.pv", otherVisibility: 30, ownerVisibility: 30, gmVisibility: -1, style: "user" } });
  const criatura = ajustarBarras("criatura", base());
  assert.equal(criatura.bar1.otherVisibility, 0);
  assert.equal(criatura.bar1.ownerVisibility, 30);
  assert.equal(criatura.bar1.style, "user");
  const personagem = ajustarBarras("personagem", base());
  assert.equal(personagem.bar1.style, "fraction");
  assert.equal(personagem.bar1.otherVisibility, 30);
  assert.equal(ajustarBarras("criatura", null), null);
});

test("habilidade de criatura: condições do seletor sem o Defendendo-se", async () => {
  const { opcoesDeCondicao } = await import("../cena/habilidade-criatura.mjs");
  const ids = opcoesDeCondicao().map((c) => c.id);
  assert.ok(ids.includes("caido"));
  assert.ok(ids.includes("sangrando"));
  assert.ok(!ids.includes("defendendo"));
});

test("desafios à vista: os do ponto trancado aparecem para o jogador mesmo ocultos", async () => {
  const { desafiosAVista } = await import("../cena/acesso-poi.mjs");
  const antes = globalThis.fromUuidSync;
  const docs = {
    "Item.bau": { system: { acesso: { bloqueado: true }, desafios: ["Item.tranca"] } },
    "Item.oculto": { system: { acesso: { bloqueado: true }, desafios: ["Item.outra"] } },
  };
  globalThis.fromUuidSync = (u) => docs[u] ?? null;
  try {
    const inv = { system: {
      desafios: ["Item.tranca", "Item.solto"], desafiosOcultos: ["Item.tranca"],
      pois: ["Item.bau", "Item.oculto"], poisOcultos: ["Item.oculto"],
    } };
    assert.deepEqual(desafiosAVista(inv, false), ["Item.solto", "Item.tranca"]);
    assert.deepEqual(desafiosAVista(inv, true), ["Item.tranca", "Item.solto"]);
  } finally {
    globalThis.fromUuidSync = antes;
  }
});

test("barras: o jogador copia a altura e o estilo da barra do mestre", async () => {
  const { diferencasDoVisual } = await import("../ui/barras-token.mjs");
  assert.deepEqual(diferencasDoVisual({ heightMultiplier: 1.6, barStyle: "large" }, { heightMultiplier: 1, barStyle: "large" }),
    { heightMultiplier: 1.6 });
  assert.deepEqual(diferencasDoVisual({}, { heightMultiplier: 1 }), {});
  assert.deepEqual(diferencasDoVisual({ barStyle: "default" }, { barStyle: "default" }), {});
});

test("perseguição: a enxurrada atinge todos abaixo do corte, sem desempate", async () => {
  const { todosAbaixoDoCorte } = await import("../cena/perseguicao-regras.mjs");
  const marcos = [{ rodada: 2, pa: 5 }, { rodada: 3, pa: 15 }, { rodada: 4, pa: 25 }];
  const ps = [{ uuid: "a", pa: 3 }, { uuid: "b", pa: 3 }, { uuid: "c", pa: 9 }, { uuid: "d", pa: 1, morto: true }];
  assert.deepEqual(todosAbaixoDoCorte(ps, 2, marcos), { corte: 5, alvos: ["a", "b"] });
  assert.deepEqual(todosAbaixoDoCorte(ps, 3, marcos).alvos, ["a", "b", "c"]);
  assert.deepEqual(todosAbaixoDoCorte(ps, 1, marcos), { corte: null, alvos: [] });
});

test("perseguição da Missão 1: 4 rodadas, 25 PA, cortes 5/15/25 e sem morte", async () => {
  const { PERSEGUICAO_ENXURRADA } = await import("../cena/cenas-config.mjs");
  const c = PERSEGUICAO_ENXURRADA();
  assert.equal(c.rodadas, 4);
  assert.equal(c.meta, 25);
  assert.equal(c.dtAvanco, 10);
  assert.deepEqual(c.marcos.map((m) => [m.rodada, m.pa]), [[2, 5], [3, 15], [4, 25]]);
  assert.equal(c.alcancadoMorte, false);
  assert.equal(c.alcancaTodos, true);
  assert.equal(c.alcancado.dano, "1d6");
  assert.equal(c.alcancado.porRodada, true);
});
