import { test } from "node:test";
import assert from "node:assert/strict";
import "./stub-foundry.mjs";
import { cenaTemEfeitos, EFEITOS_DA_ENTRADA } from "../ui/efeitos-cena.mjs";

test("a cena configurada casa pelo nome ou pelo id, sem diferenciar maiusculas", () => {
  assert.equal(cenaTemEfeitos({ name: "Home", id: "abc" }, "home"), true);
  assert.equal(cenaTemEfeitos({ name: "Outra", id: "abc" }, "ABC"), true);
  assert.equal(cenaTemEfeitos({ name: "Primeira Cena", id: "x" }, "Home"), false);
});

test("vazio desliga", () => {
  assert.equal(cenaTemEfeitos({ name: "Home", id: "x" }, ""), false);
  assert.equal(cenaTemEfeitos(null, "Home"), false);
});

test("os tres efeitos rodam ate parar", () => {
  assert.deepEqual(EFEITOS_DA_ENTRADA.map((e) => e.action), ["fx.screenShake.start", "fx.screenBlur.start", "fx.screenSmear.start"]);
  assert.ok(EFEITOS_DA_ENTRADA.every((e) => e.durationMs === 0));
});

test("vagalumes: cor pelo peso e brilho entre 0 e 1", async () => {
  const { corDoVagalume, piscar, CORES_VAGALUMES } = await import("../ui/efeitos-cena.mjs");
  assert.equal(corDoVagalume(0), CORES_VAGALUMES[0][0]);
  assert.equal(corDoVagalume(0.9999), CORES_VAGALUMES.at(-1)[0]);
  for (let t = 0; t < 10; t += 0.37) {
    const b = piscar(t, 0.3, 1);
    assert.ok(b >= 0.25 && b <= 1);
  }
});

test("presets: Home e Profundezas; profundezas sem desfoque e mais leve", async () => {
  const { presetDaCena, EFEITOS_PROFUNDEZAS } = await import("../ui/efeitos-cena.mjs");
  const conf = { home: "Home", profundezas: "Profundezas da Mata" };
  assert.equal(presetDaCena({ name: "Home", id: "a" }, conf), "home");
  assert.equal(presetDaCena({ name: "profundezas da mata", id: "b" }, conf), "profundezas");
  assert.equal(presetDaCena({ name: "Limiar da Mata", id: "c" }, conf), null);
  const { CENAS_DA_MATA } = await import("../ui/efeitos-cena.mjs");
  const tres = { home: "Home", profundezas: CENAS_DA_MATA };
  for (const nome of ["Profundezas da Mata", "rio das brumas", "Encosta Escura"]) {
    assert.equal(presetDaCena({ name: nome, id: "x" }, tres), "profundezas", nome);
  }
  assert.equal(presetDaCena({ name: "Rio", id: "x" }, tres), null);
  assert.ok(!EFEITOS_PROFUNDEZAS.some((e) => e.action.includes("Blur")));
  const shake = (lista) => lista.find((e) => e.action === "fx.screenShake.start").intensityPx;
  const smear = (lista) => lista.find((e) => e.action === "fx.screenSmear.start").maxStrength;
  assert.ok(shake(EFEITOS_PROFUNDEZAS) < shake(EFEITOS_DA_ENTRADA));
  assert.ok(smear(EFEITOS_PROFUNDEZAS) < smear(EFEITOS_DA_ENTRADA));
});

test("mata: envelope sobe, fica e some; furtividade acelera", async () => {
  const { envelope, ritmoDaMata } = await import("../ui/efeitos-cena.mjs");
  const tempos = { entrada: 1, fica: 2, saida: 1 };
  assert.equal(envelope(0.5, tempos), 0.5);
  assert.equal(envelope(2, tempos), 1);
  assert.equal(envelope(3.5, tempos), 0.5);
  assert.equal(envelope(5, tempos), 0);
  assert.equal(ritmoDaMata({ ativa: false }).procuram, false);
  assert.ok(ritmoDaMata({ ativa: true, fase: "personagens" }).olhos > ritmoDaMata({ ativa: false }).olhos);
  assert.equal(ritmoDaMata({ ativa: true, fase: "criaturas" }).procuram, true);
});
