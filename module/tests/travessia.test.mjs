import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizarArea, areaAtual, resultadoDaAcao, somarAvancos, concluiu, todosConcluiram, podeAgirNaArea,
} from "../cena/travessia-regras.mjs";
import { aplicarBusca } from "../cena/furtividade-regras.mjs";

const bosque = {
  id: "b", nome: "Bosque", avancos: 4,
  acoes: [
    { id: "atr", nome: "Atravessar", pericia: "acrobacia", dt: 10, avancos: 2, quando: "sempre", danoFalha: "1d4" },
    { id: "nad", nome: "Nadar", pericia: "atletismo", dt: 10, avancos: 1, quando: "sucesso", danoFalha: "1" },
  ],
};

test("travessia: área atual pela posição; sem área (ou depois da última) é null", () => {
  const config = { areas: [bosque, { nome: "Rio", avancos: 3 }] };
  assert.equal(areaAtual(config, 0).nome, "Bosque");
  assert.equal(areaAtual(config, 1).avancos, 3);
  assert.equal(areaAtual(config, 2), null);
  assert.equal(areaAtual({}, 0), null);
});

test("travessia: 'sempre' soma mesmo falhando (o teste só decide o dano); 'sucesso' só passando", () => {
  const [atravessar, nadar] = normalizarArea(bosque).acoes;
  assert.deepEqual(resultadoDaAcao(atravessar, true), { avancos: 2, dano: null });
  assert.deepEqual(resultadoDaAcao(atravessar, false), { avancos: 2, dano: "1d4" });
  assert.deepEqual(resultadoDaAcao(nadar, true), { avancos: 1, dano: null });
  assert.deepEqual(resultadoDaAcao(nadar, false), { avancos: 0, dano: "1" });
  // Sem dano configurado, a falha não machuca.
  assert.equal(resultadoDaAcao({ avancos: 1, quando: "sucesso" }, false).dano, null);
});

test("travessia: avanços nunca ficam negativos; concluir e todos concluírem", () => {
  assert.equal(somarAvancos(1, -3), 0);
  assert.equal(somarAvancos(3, 2), 5);
  const area = normalizarArea(bosque);
  assert.equal(concluiu({ avancos: 4 }, area), true);
  assert.equal(concluiu({ avancos: 3 }, area), false);
  assert.equal(todosConcluiram([{ avancos: 4 }, { avancos: 5 }], area), true);
  assert.equal(todosConcluiram([{ avancos: 4 }, { avancos: 1 }], area), false);
  assert.equal(todosConcluiram([], area), false);
});

test("travessia: parado em segurança não age e a busca das criaturas passa por ele", () => {
  assert.equal(podeAgirNaArea({ seguro: true }), false);
  assert.equal(podeAgirNaArea({ avancos: 4 }), true);
  const participantes = [
    { uuid: "a", seguro: true, testou: true, dados: [{ id: "1", dado: "d6", valor: 3 }] },
    { uuid: "b", testou: true, dados: [{ id: "2", dado: "d6", valor: 3 }] },
  ];
  const r = aplicarBusca(participantes, [3], "ev");
  assert.deepEqual(r.perdas.map((p) => p.uuid), ["b"]);
  assert.equal(r.participantes[0].dados[0].perdido, undefined);
});
