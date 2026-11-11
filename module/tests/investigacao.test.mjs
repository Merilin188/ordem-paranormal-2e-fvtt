import test from "node:test";
import assert from "node:assert/strict";
import {
  chaveInfo, periciasDoQuadro, resolverInvestigacao, resolverExaminar, danoSobrecarga,
  estaTrancado, infosAlcancaveis, aceitaPericia, grupoDaLinha,
} from "../cena/investigacao.mjs";
import { TABELA_SOBRECARGA_PADRAO } from "../config.mjs";

const QUADRO = [
  { id: "i1", pericia: "percepcao", dt: 6, texto: "marca de dedo no vidro" },
  { id: "i2", pericia: "percepcao", dt: 10, texto: "bilhete atrás do quadro" },
  { id: "i3", pericia: "ocultismo", dt: 8, texto: "símbolo riscado a carvão" },
];

test("investigar revela só o que a perícia alcança, sem rolar (spec §6.3)", () => {
  // d8 de Percepção: entrega a DT 6, mas não a DT 10.
  assert.deepEqual(resolverInvestigacao(QUADRO, "percepcao", 8), ["i1"]);
  // d12 de Percepção: as duas.
  assert.deepEqual(resolverInvestigacao(QUADRO, "percepcao", 12), ["i1", "i2"]);
  // d4 de Percepção: nada.
  assert.deepEqual(resolverInvestigacao(QUADRO, "percepcao", 4), []);
  // Ocultismo d8: a de ocultismo, não as de percepção.
  assert.deepEqual(resolverInvestigacao(QUADRO, "ocultismo", 8), ["i3"]);
});

test("investigar não repete o que o personagem já tem", () => {
  assert.deepEqual(resolverInvestigacao(QUADRO, "percepcao", 12, new Set(["i1"])), ["i2"]);
});

test("examinar compara a soma rolada contra a DT (spec §6.3.1)", () => {
  const { revelaveis, perdePD } = resolverExaminar(QUADRO, "percepcao", 11);
  assert.deepEqual(revelaveis, ["i1", "i2"]);
  assert.equal(perdePD, false);
});

test("examinar sem info nova custa 1 PD — por falhar na DT ou por não haver mais nada", () => {
  // Falhou na DT: soma 5 não alcança nada de Percepção.
  assert.equal(resolverExaminar(QUADRO, "percepcao", 5).perdePD, true);
  // Já tem tudo: não há mais nada a revelar.
  assert.equal(resolverExaminar(QUADRO, "percepcao", 12, new Set(["i1", "i2"])).perdePD, true);
  // O POI pode ser vazio de propósito (spec §6.2).
  assert.equal(resolverExaminar([], "percepcao", 12).perdePD, true);
  // Pista contada ao grupo é sabida por todos: Examinar não a acha de novo, e cobra o PD.
  const contada = QUADRO.map((i) => (i.id === "i1" ? { ...i, contadaPor: ["a1"] } : i));
  assert.equal(resolverExaminar(contada, "percepcao", 11).revelaveis.includes("i1"), false);
  assert.equal(resolverExaminar(contada.filter((i) => i.id === "i1"), "percepcao", 12).perdePD, true);
});

test("examinar com crítico ignora a DT e revela o que falta da perícia (spec §4.3)", () => {
  const { revelaveis, perdePD } = resolverExaminar(QUADRO, "percepcao", 5, new Set(), { ignorarDT: true });
  assert.deepEqual(revelaveis, ["i1", "i2"]);
  assert.equal(perdePD, false);
});

test("revelação vem em DT crescente", () => {
  const quadroInvertido = [QUADRO[1], QUADRO[0]];
  assert.deepEqual(resolverInvestigacao(quadroInvertido, "percepcao", 12), ["i1", "i2"]);
  assert.deepEqual(resolverExaminar(quadroInvertido, "percepcao", 12).revelaveis, ["i1", "i2"]);
});

test("periciasDoQuadro lista sem repetição, na ordem do quadro", () => {
  assert.deepEqual(periciasDoQuadro(QUADRO), ["percepcao", "ocultismo"]);
});

test("chaveInfo amarra a info ao POI", () => {
  assert.equal(chaveInfo("Item.abc", "i1"), "Item.abc:i1");
});

test("sobrecarga: tabela de referência do playtest (spec §7.6)", () => {
  assert.equal(danoSobrecarga(TABELA_SOBRECARGA_PADRAO, 1), "0");
  assert.equal(danoSobrecarga(TABELA_SOBRECARGA_PADRAO, 3), "1");
  assert.equal(danoSobrecarga(TABELA_SOBRECARGA_PADRAO, 5), "1d4");
  assert.equal(danoSobrecarga(TABELA_SOBRECARGA_PADRAO, 8), "1d6");
});

test("sobrecarga: '9 ou mais' vale a última linha (LACUNAS)", () => {
  assert.equal(danoSobrecarga(TABELA_SOBRECARGA_PADRAO, 9), "2d4");
  assert.equal(danoSobrecarga(TABELA_SOBRECARGA_PADRAO, 12), "2d4");
});

test("sobrecarga: a tabela editada pela cena é a que vale", () => {
  const tabela = [{ rodada: 1, dano: "1d4" }];
  assert.equal(danoSobrecarga(tabela, 1), "1d4");
  assert.equal(danoSobrecarga(tabela, 7), "1d4");
});

test("ponto bloqueado: só tranca quando bloqueado, sem liberação e sem desafio vencido", () => {
  assert.equal(estaTrancado(undefined, []), false);
  assert.equal(estaTrancado({ bloqueado: false }, [false]), false);
  assert.equal(estaTrancado({ bloqueado: true, liberado: false }, []), true);
  assert.equal(estaTrancado({ bloqueado: true, liberado: false }, [false, false]), true);
  assert.equal(estaTrancado({ bloqueado: true, liberado: false }, [false, true]), false);
  assert.equal(estaTrancado({ bloqueado: true, liberado: true }, [false]), false);
});

test("ponto bloqueado: trancado, Examinar só alcança as linhas de fora da tranca", () => {
  const quadro = [
    { id: "fora", pericia: "oficio", dt: 8, foraDaTranca: true },
    { id: "dentro", pericia: "percepcao", dt: 5 },
  ];
  assert.deepEqual(infosAlcancaveis(quadro, true).map((i) => i.id), ["fora"]);
  assert.deepEqual(infosAlcancaveis(quadro, false).map((i) => i.id), ["fora", "dentro"]);
  assert.deepEqual(resolverInvestigacao(infosAlcancaveis(quadro, true), "percepcao", 12), []);
});

test("perícias alternativas: a mesma linha achada por qualquer uma delas", () => {
  const quadro = [
    { id: "a", pericia: "aptidao.artes", periciasAlternativas: ["aptidao.folclore"], dt: 6 },
    { id: "b", pericia: "acrobacia", periciasAlternativas: ["sobrevivencia"], dt: 6 },
    { id: "c", pericia: "percepcao", dt: 6 },
  ];
  assert.deepEqual(resolverInvestigacao(quadro, "aptidao.folclore", 6), ["a"]);
  assert.deepEqual(resolverInvestigacao(quadro, "aptidao.artes", 6), ["a"]);
  assert.deepEqual(resolverExaminar(quadro, "sobrevivencia", 7).revelaveis, ["b"]);
  assert.deepEqual(periciasDoQuadro(quadro), ["aptidao.artes", "aptidao.folclore", "acrobacia", "sobrevivencia", "percepcao"]);
  assert.equal(grupoDaLinha(quadro[0]), "aptidao.artes|aptidao.folclore");
  assert.equal(aceitaPericia(quadro[2], "sobrevivencia"), false);
});

test("transições: a padrão é a marcada, senão a primeira com imagem; só uma padrão", async () => {
  const { transicaoPadrao, marcarPadrao, nomeDaTransicao } = await import("../cena/transicoes.mjs");
  const lista = [
    { id: "a", imagem: "", padrao: true },
    { id: "b", imagem: "x/HANDOUT%20NICHO%20PAREDE%20SEM%20RUNAS.jpg", padrao: false },
    { id: "c", imagem: "x/HANDOUT NICHO PAREDE.jpg", padrao: false },
  ];
  assert.equal(transicaoPadrao(lista).id, "b");
  assert.equal(transicaoPadrao(marcarPadrao(lista, "c")).id, "c");
  assert.deepEqual(marcarPadrao(lista, "c").map((t) => t.padrao), [false, false, true]);
  assert.equal(transicaoPadrao([]), null);
  assert.equal(nomeDaTransicao(lista[1]), "HANDOUT NICHO PAREDE SEM RUNAS");
  assert.equal(nomeDaTransicao({ ...lista[1], nome: " Nichos " }), "Nichos");
});

test("transições: cena existente vale pela cena escolhida; cena nova no padrão da mesa", async () => {
  const { transicaoValida, transicaoPadrao, dadosDaCenaNova } = await import("../cena/transicoes.mjs");
  assert.equal(transicaoValida({ modo: "existente", cenaUuid: "", imagem: "x.jpg" }), false);
  assert.equal(transicaoValida({ modo: "existente", cenaUuid: "Scene.a" }), true);
  assert.equal(transicaoValida({ modo: "janela", imagem: "x.jpg" }), true);
  assert.equal(transicaoPadrao([{ id: "a", modo: "existente", cenaUuid: "" }, { id: "b", modo: "cena", imagem: "y" }]).id, "b");
  const v14 = dadosDaCenaNova({ nome: "Altar", imagem: "h/altar.jpg", largura: 4961, altura: 3366, v14: true });
  assert.equal(v14.levels[0].background.src, "h/altar.jpg");
  assert.equal(v14.levels[0].background.color, "#000000");
  assert.equal(v14.background, undefined);
  assert.equal(v14.padding, 0.15);
  assert.deepEqual(v14.grid, { type: 1, alpha: 0 });
  const v13 = dadosDaCenaNova({ nome: "Altar", imagem: "h/altar.jpg", largura: 10, altura: 10, v14: false });
  assert.equal(v13.background.src, "h/altar.jpg");
  assert.equal(v13.levels, undefined);
});

/* ---- Investigar no Beta: passivo → Observar ou Examinar ---- */

test("beta: o passo 1 lista as perícias do ponto sem as das linhas ocultas nem as de dentro da tranca", async () => {
  const { periciasParaInvestigar } = await import("../cena/investigacao.mjs");
  const quadro = [
    { id: "a", pericia: "percepcao", dt: 6, foraDaTranca: true },
    { id: "b", pericia: "ocultismo", dt: 8, oculta: true },
    { id: "c", pericia: "medicina", dt: 7 },
  ];
  assert.deepEqual(periciasParaInvestigar(quadro), ["percepcao", "medicina"]);
  assert.deepEqual(periciasParaInvestigar(quadro, true), ["percepcao"]);
});

test("beta: a janela do mestre mostra tudo da perícia e marca só o passivo (DT até o dado, visível, ao alcance)", async () => {
  const { linhasParaOMestre } = await import("../cena/investigacao.mjs");
  const quadro = [
    { id: "a", pericia: "percepcao", dt: 6 },
    { id: "b", pericia: "percepcao", dt: 10 },
    { id: "c", pericia: "percepcao", dt: 4, oculta: true },
    { id: "d", pericia: "ocultismo", dt: 4 },
    { id: "e", pericia: "percepcao", dt: 8, aberta: true },
  ];
  const linhas = linhasParaOMestre(quadro, "percepcao", 8, new Set(["a"]));
  assert.deepEqual(linhas.map((l) => l.id), ["c", "a", "e", "b"]);
  assert.deepEqual(linhas.filter((l) => l.marcada).map((l) => l.id), ["a", "e"]);
  assert.equal(linhas.find((l) => l.id === "c").oculta, true);
  assert.equal(linhas.find((l) => l.id === "a").conhecida, true);
  assert.equal(linhas.find((l) => l.id === "b").alcanca, false);
  // Trancado: a linha de dentro aparece, mas não vem marcada.
  const trancado = linhasParaOMestre([{ id: "x", pericia: "percepcao", dt: 4 }], "percepcao", 8, new Set(), true);
  assert.equal(trancado[0].trancada, true);
  assert.equal(trancado[0].marcada, false);
});

test("beta: passivo e Observar não custam PD — só gravam o que é novo", async () => {
  const { novasParaOPersonagem } = await import("../cena/investigacao.mjs");
  assert.deepEqual(novasParaOPersonagem(["a", "b", "c"], new Set(["b"])), ["a", "c"]);
  assert.deepEqual(novasParaOPersonagem([], new Set(["b"])), []);
});

test("beta: Examinar cobra 1 PD só quando nada é novo — o passivo não conta", async () => {
  const { resolverExaminarBeta } = await import("../cena/investigacao.mjs");
  const quadro = [
    { id: "a", pericia: "percepcao", dt: 6 },
    { id: "b", pericia: "percepcao", dt: 11 },
  ];
  // O passivo (d8) já entregou "a": rolar 9 não alcança "b" → nada novo, perde PD.
  assert.deepEqual(resolverExaminarBeta(quadro, "percepcao", 9, new Set(["a"])), { revelaveis: [], perdePD: true });
  // Rolar 12 alcança "b": novo, sem custo.
  assert.deepEqual(resolverExaminarBeta(quadro, "percepcao", 12, new Set(["a"])), { revelaveis: ["b"], perdePD: false });
  // Rolar abaixo do próprio dado também é nada novo.
  assert.equal(resolverExaminarBeta(quadro, "percepcao", 5, new Set(["a"])).perdePD, true);
  // Linha oculta nunca é achada pelo teste.
  assert.equal(resolverExaminarBeta([{ id: "o", pericia: "percepcao", dt: 2, oculta: true }], "percepcao", 20).perdePD, true);
});

test("beta: o bloco da perícia escolhida leva a chave em `pericia` — é por ela que a janela acha as linhas", async () => {
  const { blocoDaPericia, normalizarEstado, linhasParaOMestre, periciasParaObservar } = await import("../cena/investigacao.mjs");
  const quadro = [{ id: "a", pericia: "percepcao", dt: 4 }, { id: "b", pericia: "percepcao", dt: 8 }];
  const bloco = blocoDaPericia({ chave: "percepcao", rotulo: "Percepção", dado: 8 });
  assert.equal(bloco.pericia, "percepcao");
  assert.deepEqual(linhasParaOMestre(quadro, bloco.pericia, bloco.dado).filter((l) => l.marcada).map((l) => l.id), ["a", "b"]);
  // Card criado antes da correção (só `chave`): o estado lido é consertado.
  const antigo = normalizarEstado({ pericias: [{ chave: "percepcao" }, { chave: "intuicao" }], passivo: { chave: "percepcao", dado: 8 } });
  assert.equal(antigo.passivo.pericia, "percepcao");
  assert.deepEqual(periciasParaObservar(antigo).map((p) => p.chave), ["intuicao"]);
});

test("beta: Observar e Examinar são exclusivos e só valem depois do passivo", async () => {
  const { escolherAprofundamento, periciasParaObservar } = await import("../cena/investigacao.mjs");
  const pericias = [{ chave: "percepcao" }, { chave: "intuicao" }];
  const estado = { etapa: "aprofundar", pericias, passivo: { pericia: "percepcao" } };
  assert.deepEqual(periciasParaObservar(estado).map((p) => p.chave), ["intuicao"]);
  const observando = escolherAprofundamento(estado, "observar");
  assert.equal(observando.etapa, "observar");
  // Escolhido um, o outro não vale mais (os dois botões somem).
  assert.equal(escolherAprofundamento(observando, "examinar"), null);
  assert.equal(escolherAprofundamento(escolherAprofundamento(estado, "examinar"), "observar"), null);
  // Antes de o mestre enviar o passivo, nenhum dos dois.
  assert.equal(escolherAprofundamento({ ...estado, etapa: "mestre" }, "examinar"), null);
  // Sem outra perícia na lista, Observar não existe.
  assert.equal(escolherAprofundamento({ ...estado, pericias: [{ chave: "percepcao" }] }, "observar"), null);
});

test("lista de fichas: agrupa pelas pastas da barra (mãe antes das filhas) e deixa os soltos no fim", async () => {
  const { agruparPorPasta, atorPassaNoFiltro } = await import("../ui/lista-atores.mjs");
  const pastas = [
    { id: "m2", name: "Missão 2", parentId: null, sort: 2 },
    { id: "jog", name: "Jogadores", parentId: null, sort: 1 },
    { id: "ini", name: "Inimigos", parentId: "m2", sort: 0 },
    { id: "vazia", name: "Vazia", parentId: null, sort: 3 },
  ];
  const atores = [
    { id: "1", name: "Ellén Trechend", folderId: "ini" },
    { id: "2", name: "Crias da Floresta", folderId: "ini" },
    { id: "3", name: "Rowan", folderId: "jog" },
    { id: "4", name: "Cavalo", folderId: null },
  ];
  const grupos = agruparPorPasta(atores, pastas, { semPasta: "Sem pasta" });
  assert.deepEqual(grupos.map((g) => g.rotulo), ["Jogadores", "Missão 2 › Inimigos", "Sem pasta"]);
  assert.deepEqual(grupos[1].atores.map((a) => a.name), ["Crias da Floresta", "Ellén Trechend"]);
  // Busca sem acento e "só na cena".
  assert.equal(atorPassaNoFiltro({ id: "1", name: "Ellén Trechend" }, { termo: "ellen" }), true);
  assert.equal(atorPassaNoFiltro({ id: "1", name: "Ellén" }, { soCena: true, idsNaCena: new Set(["3"]) }), false);
});

test("beta: o que já se sabia (achado antes ou contado ao grupo) não é novo — Examinar perde 1 PD", async () => {
  const { resolverExaminarBeta } = await import("../cena/investigacao.mjs");
  const quadro = [
    { id: "a", pericia: "percepcao", dt: 4 },
    { id: "b", pericia: "percepcao", dt: 6, contadaPor: ["rowan"] },
  ];
  // Muirenn rola 5: "a" ela já tinha achado, "b" alguém contou ao grupo — nada novo.
  assert.deepEqual(resolverExaminarBeta(quadro, "percepcao", 5, new Set(["a"])), { revelaveis: [], perdePD: true });
  assert.deepEqual(resolverExaminarBeta(quadro, "percepcao", 9, new Set(["a"])), { revelaveis: [], perdePD: true });
});

test("beta: Prontidão no Examinar refaz o alcance a partir do que ele sabia antes", async () => {
  const { refazerExaminar } = await import("../cena/investigacao.mjs");
  const quadro = [
    { id: "a", pericia: "percepcao", dt: 4 },
    { id: "b", pericia: "percepcao", dt: 9 },
    { id: "c", pericia: "percepcao", dt: 12 },
  ];
  // Sabia "a"; rolou 10 (achou "b"); a Prontidão leva a 13: ganha "c".
  assert.deepEqual(refazerExaminar(quadro, "percepcao", 13, ["a"], ["b"]), { revelaveis: ["b", "c"], ganhar: ["c"], perder: [] });
  // Leva a 7: perde "b", nada novo.
  assert.deepEqual(refazerExaminar(quadro, "percepcao", 7, ["a"], ["b"]), { revelaveis: [], ganhar: [], perder: ["b"] });
  // Crítico depois da Prontidão: tudo o que falta.
  assert.deepEqual(refazerExaminar(quadro, "percepcao", 7, ["a"], [], { ignorarDT: true }).revelaveis, ["b", "c"]);
});

test("resetar cena: a chave da revelação aponta o ponto dela", async () => {
  const { poiDaChave } = await import("../cena/encerrar-investigacao.mjs");
  const { chaveInfo } = await import("../cena/investigacao.mjs");
  assert.equal(poiDaChave(chaveInfo("Item.abc123", "linha9")), "Item.abc123");
  assert.equal(poiDaChave(chaveInfo("Compendium.mundo.pois.Item.x", "l1")), "Compendium.mundo.pois.Item.x");
});
