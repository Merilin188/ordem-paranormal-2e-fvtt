import test from "node:test";
import assert from "node:assert/strict";
import { instalarStubs } from "./stub-foundry.mjs";

instalarStubs();

test("perseguição: calibração respeita os limites (nada de tremor que enjoe)", async () => {
  const { mesclarConfig, configPadrao } = await import("../ui/efeitos-perseguicao.mjs");
  const c = mesclarConfig({ tremor: { intensidadePx: 999, freqHz: 30 }, pisadas: { intervaloMin: 80, intervaloMax: 20 }, nevoa: { opacidade: 2, cor: "azul" } });
  assert.equal(c.tremor.intensidadePx, 18);
  assert.equal(c.tremor.freqHz, 1.6);
  assert.equal(c.pisadas.intervaloMax, 80);
  assert.equal(c.nevoa.opacidade, 0.85);
  assert.equal(c.nevoa.cor, configPadrao().nevoa.cor);
  assert.deepEqual(mesclarConfig({}), configPadrao());
});

test("perseguição: a pisada é um tranco que morre e as próximas vêm entre 40 e 70 s", async () => {
  const { deslocamentoDaPisada, proximaPisada, acoesDoFxBus, configPadrao, rgbDe } = await import("../ui/efeitos-perseguicao.mjs");
  const cfg = { intensidadePx: 24, duracaoMs: 1000, freqHz: 9 };
  const pico = Math.max(...Array.from({ length: 50 }, (_x, i) => Math.abs(deslocamentoDaPisada(i * 4, cfg).y)));
  const fim = Math.max(...Array.from({ length: 50 }, (_x, i) => Math.abs(deslocamentoDaPisada(800 + i * 4, cfg).y)));
  assert.ok(pico > 10 && pico <= 24);
  assert.ok(fim < pico / 5);
  assert.deepEqual(deslocamentoDaPisada(1200, cfg), { x: 0, y: 0 });
  assert.equal(proximaPisada(40, 70, 0), 40);
  assert.equal(proximaPisada(40, 70, 0.5), 55);
  const fx = acoesDoFxBus(configPadrao());
  assert.equal(fx[0].action, "fx.screenShake.start");
  assert.equal(fx[0].intensityPx, 9);
  assert.equal(acoesDoFxBus({ ...configPadrao(), tremor: { ligado: false }, rastro: { ligado: false } }).length, 0);
  assert.equal(rgbDe("#a9bcc0"), "169,188,192");
});

test("cenas: Caminho para Bellynyr cai no preset de perseguição", async () => {
  const { presetDaCena, CENAS_DA_PERSEGUICAO } = await import("../ui/efeitos-cena.mjs");
  assert.equal(presetDaCena({ name: "Caminho para Bellynyr", id: "x" }, { home: "Home", profundezas: "Rio", perseguicao: CENAS_DA_PERSEGUICAO }), "perseguicao");
  assert.equal(presetDaCena({ name: "Rio", id: "x" }, { profundezas: "Rio", perseguicao: CENAS_DA_PERSEGUICAO }), "profundezas");
});

test("mata que observa: calibração com o padrão de antes e limites", async () => {
  const { mesclarMata, configMataPadrao, ritmoCalibrado, acoesDaMata, corHex } = await import("../ui/efeitos-mata.mjs");
  assert.deepEqual(mesclarMata({}), configMataPadrao());
  const c = mesclarMata({ olhos: { maxCriaturas: 99, procuram: 0, corAmbar: "x" }, vagalumes: { quantidade: -3 } });
  assert.equal(c.olhos.maxCriaturas, 30);
  assert.equal(c.olhos.procuram, false);
  assert.equal(c.olhos.corAmbar, "#ffffff");
  assert.equal(c.vagalumes.quantidade, 0);
  // Sem mexer, o ritmo é o de sempre: 6 / 9 / 12 olhos, procurando na fase das criaturas.
  const p = configMataPadrao();
  assert.deepEqual(ritmoCalibrado(null, p), { olhos: 1, maxOlhos: 6, procuram: false });
  assert.deepEqual(ritmoCalibrado({ ativa: true, fase: "personagens" }, p), { olhos: 2, maxOlhos: 9, procuram: false });
  assert.deepEqual(ritmoCalibrado({ ativa: true, fase: "criaturas" }, p), { olhos: 3, maxOlhos: 12, procuram: true });
  assert.equal(acoesDaMata(p)[0].intensityPx, 7);
  assert.equal(acoesDaMata({ ...p, tremor: { ...p.tremor, ligado: false }, rastro: { ...p.rastro, forca: 0 } }).length, 0);
  assert.equal(corHex("#ff2a1f"), 0xff2a1f);
});
