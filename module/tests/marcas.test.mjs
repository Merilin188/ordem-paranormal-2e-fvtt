import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linhaDaTabela, modificadoresDasMarcas, modificadorDoTeste, marcaRepetida, consumidosPeloPavor,
  equilibrado, dadosDeEquilibrio, faseDoValor,
} from "../cena/tabelas-dados.mjs";
import { facesDasPosicoes } from "../cena/desafios.mjs";

test("faixas das tabelas", () => {
  assert.equal(linhaDaTabela("lesoes", 3).chave, "morteSubita");
  assert.equal(linhaDaTabela("lesoes", 14).chave, "tendao");
  assert.equal(linhaDaTabela("lesoes", 23).chave, "surto");
  assert.equal(linhaDaTabela("traumas", 16).chave, "panico");
  assert.equal(linhaDaTabela("falhaCritica", 5).chave, "acidente");
});

test("modificadores somam lesões e traumas", () => {
  const m = modificadoresDasMarcas([{ chave: "semOlho" }, { chave: "orgaoSensorial" }, { chave: "laceracao" }, { chave: "laceracao" }], [{ chave: "degradacao" }]);
  assert.equal(m.pericia.percepcao, -3);
  assert.equal(m.pvMax, -4);
  assert.equal(modificadorDoTeste(m, "percepcao", "mente"), -4);
  assert.equal(modificadorDoTeste(m, "aptidao.exatas", "mente"), -1);
});

test("marca repetida rola de novo, laceração acumula", () => {
  assert.equal(marcaRepetida("lesoes", linhaDaTabela("lesoes", 14), [{ chave: "tendao" }]), true);
  assert.equal(marcaRepetida("lesoes", linhaDaTabela("lesoes", 10), [{ chave: "laceracao" }]), false);
});

test("pavor consome dados menores", () => {
  assert.deepEqual(consumidosPeloPavor([2, 5, 4], 4), [true, false, false]);
});

test("equilíbrio, dados de equilíbrio e fases", () => {
  assert.equal(equilibrado(5, 6), true);
  assert.equal(equilibrado(5, 7), false);
  assert.equal(dadosDeEquilibrio("d6"), 3);
  assert.equal(dadosDeEquilibrio("d4"), 2);
  assert.equal(faseDoValor(3), "geral");
});

test("faces por posição da senha", () => {
  assert.deepEqual(facesDasPosicoes({ tamanhoSenha: 3, facesSenha: 6, facesPorPosicao: [8, 6, 12] }), [8, 6, 12]);
  assert.deepEqual(facesDasPosicoes({ tamanhoSenha: 2, facesSenha: 6, facesPorPosicao: [] }), [6, 6]);
});
