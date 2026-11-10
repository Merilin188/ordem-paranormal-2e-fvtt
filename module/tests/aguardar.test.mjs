import test from "node:test";
import assert from "node:assert/strict";
import { ordenarCombatentes, encaixarAntes, INICIATIVA_AGUARDANDO } from "../cena/poderes-regras.mjs";

/** Aplica as mudanças do encaixe e reordena como o core faria (com o nosso desempate). */
function aplicar(turnos, encaixe) {
  const porId = new Map(turnos.map((t) => [t.id, { ...t }]));
  for (const u of encaixe.atualizacoes) {
    const t = porId.get(u._id);
    t.ordem = u.ordem;
    if (u.initiative !== undefined) t.initiative = u.initiative;
  }
  return [...porId.values()].sort(ordenarCombatentes);
}

const fila = () => [
  { id: "a-jog1", initiative: 3, ordem: 0 },
  { id: "b-cri1", initiative: 3, ordem: 0 },
  { id: "c-jog2", initiative: 2, ordem: 0 },
  { id: "d-cri2", initiative: 1, ordem: 0 },
  { id: "e-rowan", initiative: INICIATIVA_AGUARDANDO, ordem: 0 },
].sort(ordenarCombatentes);

test("aguardar: quem aguarda vai para o fim, abaixo do Corpo a corpo; sem fase fica por último", () => {
  const lista = [...fila(), { id: "0-sem", initiative: null, ordem: 0 }].sort(ordenarCombatentes);
  assert.deepEqual(lista.map((t) => t.id), ["a-jog1", "b-cri1", "c-jog2", "d-cri2", "e-rowan", "0-sem"]);
});

test("aguardar: sem ordem gravada, o desempate é o do core (id)", () => {
  const a = { id: "x", initiative: 2 };
  const b = { id: "y", initiative: 2 };
  assert.equal(ordenarCombatentes(a, b), -1);
  assert.equal(ordenarCombatentes(b, a), 1);
  // A ordem também é lida da flag do sistema, como vem do Combatant.
  const c = { id: "z", initiative: 2, flags: { "ordem-paranormal-2e": { ordem: -1 } } };
  assert.equal(ordenarCombatentes(c, a), -1);
});

test("agir agora: entra logo antes de quem ia agir, na mesma fase, sem repetir quem já agiu", () => {
  const turnos = fila();
  // A vez é da criatura 1 (índice 1); o jogador 1, da mesma fase, já agiu.
  const encaixe = encaixarAntes(turnos, "e-rowan", "b-cri1");
  assert.equal(encaixe.indice, 1);
  const nova = aplicar(turnos, encaixe);
  assert.deepEqual(nova.map((t) => t.id), ["a-jog1", "e-rowan", "b-cri1", "c-jog2", "d-cri2"]);
  // O turno continua no índice 1 — agora é de quem aguardava.
  assert.equal(nova[encaixe.indice].id, "e-rowan");
  assert.equal(nova.find((t) => t.id === "e-rowan").initiative, 3);
});

test("agir agora: antes de alguém de outra fase e antes do primeiro da fila", () => {
  let turnos = fila();
  let encaixe = encaixarAntes(turnos, "e-rowan", "d-cri2");
  assert.deepEqual(aplicar(turnos, encaixe).map((t) => t.id), ["a-jog1", "b-cri1", "c-jog2", "e-rowan", "d-cri2"]);
  assert.equal(encaixe.indice, 3);
  turnos = fila();
  encaixe = encaixarAntes(turnos, "e-rowan", "a-jog1");
  assert.equal(encaixe.indice, 0);
  assert.deepEqual(aplicar(turnos, encaixe).map((t) => t.id), ["e-rowan", "a-jog1", "b-cri1", "c-jog2", "d-cri2"]);
});

test("agir agora: dois aguardando — o segundo encaixe não desfaz o primeiro", () => {
  let turnos = [...fila(), { id: "f-sira", initiative: INICIATIVA_AGUARDANDO, ordem: 0 }].sort(ordenarCombatentes);
  turnos = aplicar(turnos, encaixarAntes(turnos, "e-rowan", "b-cri1"));
  // Rowan agiu; a vez passa para a criatura 1 (índice 2) e a Sira decide agir antes dela.
  const encaixe = encaixarAntes(turnos, "f-sira", "b-cri1");
  assert.equal(encaixe.indice, 2);
  assert.deepEqual(aplicar(turnos, encaixe).map((t) => t.id), ["a-jog1", "e-rowan", "f-sira", "b-cri1", "c-jog2", "d-cri2"]);
});

test("agir agora: sem encaixe quando já é a vez de quem aguardava ou alguém sumiu", () => {
  const turnos = fila();
  assert.equal(encaixarAntes(turnos, "e-rowan", "e-rowan"), null);
  assert.equal(encaixarAntes(turnos, "nao-existe", "b-cri1"), null);
  assert.equal(encaixarAntes(turnos, "e-rowan", undefined), null);
});
