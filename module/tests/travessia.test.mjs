import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizarArea, areaAtual, resultadoDaAcao, somarAvancos, concluiu, todosConcluiram, podeAgirNaArea,
  formulaPorAvanco, danoDoSalto, acoesDisponiveis, passosNaArea,
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
  assert.deepEqual(resultadoDaAcao(atravessar, true), { avancos: 2, dano: null, caiu: false });
  assert.deepEqual(resultadoDaAcao(atravessar, false), { avancos: 2, dano: "1d4", caiu: false });
  assert.deepEqual(resultadoDaAcao(nadar, true), { avancos: 1, dano: null, caiu: false });
  assert.deepEqual(resultadoDaAcao(nadar, false), { avancos: 0, dano: "1", caiu: false });
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

test("travessia: falhar por 3 ou mais (com dano por avanço) é cair: chega com 1d6 por avanço que faltava", () => {
  const descer = { avancos: 2, quando: "sucesso", danoFalha: "1d4", porAvanco: "1d6" };
  assert.deepEqual(resultadoDaAcao(descer, false, { margem: -2, faltam: 3 }), { avancos: 0, dano: "1d4", caiu: false });
  assert.deepEqual(resultadoDaAcao(descer, false, { margem: -3, faltam: 3 }), { avancos: 3, dano: "3d6", caiu: true });
  // Sem `porAvanco` configurado, falhar feio é só falhar.
  assert.equal(resultadoDaAcao({ ...descer, porAvanco: "" }, false, { margem: -5, faltam: 3 }).caiu, false);
  assert.equal(formulaPorAvanco("2d4", 2), "4d4");
  assert.equal(formulaPorAvanco("3", 2), "(3)*2");
  assert.equal(formulaPorAvanco("1d6", 0), null);
});

test("travessia: Salto de Fé — passar reduz o dano pela RB, nunca abaixo de zero", () => {
  assert.equal(danoDoSalto(14, true, 5), 9);
  assert.equal(danoDoSalto(14, false, 5), 14);
  assert.equal(danoDoSalto(3, true, 6), 0);
});

test("travessia: Na água só as ações de água; fora, só as outras", () => {
  const area = normalizarArea({ avancos: 3, acoes: [
    { id: "tronco", tipo: "equilibrio" }, { id: "nadar", estado: "agua" },
  ] });
  assert.deepEqual(acoesDisponiveis(area, {}).map((a) => a.id), ["tronco"]);
  assert.deepEqual(acoesDisponiveis(area, { agua: true }).map((a) => a.id), ["nadar"]);
});

test("travessia: passos na área — o bônus preparado e a escuridão a partir de N avanços", () => {
  const area = normalizarArea({ avancos: 4, penalidade: { aPartir: 2, passos: -1, nome: "Escuridão" } });
  assert.deepEqual(passosNaArea(area, { avancos: 1 }, "atletismo"), { bonus: 0, penalidade: 0 });
  assert.deepEqual(passosNaArea(area, { avancos: 2 }, "atletismo"), { bonus: 0, penalidade: -1 });
  assert.deepEqual(passosNaArea(normalizarArea({ avancos: 4 }), { avancos: 3, bonus: { acrobacia: 1 } }, "acrobacia"), { bonus: 1, penalidade: 0 });
});
