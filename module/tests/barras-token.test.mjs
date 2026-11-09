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
