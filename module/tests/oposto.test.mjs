import { test } from "node:test";
import { instalarStubs } from "./stub-foundry.mjs";
instalarStubs();
test("teste oposto do empate cria o card antes de alguém rolar", async () => {
  const atores = [
    { id: "a1", name: "A", img: "a.png", type: "personagem", system: { pericias: {}, atributos: {} }, isOwner: true },
    { id: "b1", name: "B", img: "b.png", type: "personagem", system: { pericias: {}, atributos: {} }, isOwner: true },
  ];
  globalThis.game.actors = Object.assign(atores, { get: (id) => atores.find((a) => a.id === id), filter: atores.filter.bind(atores) });
  globalThis.game.i18n = { localize: (k) => k, format: (k) => k };
  globalThis.foundry.utils = { ...(globalThis.foundry.utils ?? {}), escapeHTML: (s) => s };
  globalThis.canvas = { tokens: { controlled: [] } };
  globalThis.foundry.applications.api.DialogV2.wait = async () => ({ lados: [{ atorId: "a1", pericia: "atletismo" }, { atorId: "b1", pericia: "atletismo" }], motivo: "x" });
  let criada = null;
  globalThis.ChatMessage.create = async (d) => { criada = d; return d; };
  globalThis.ui = { notifications: { warn: (m) => { throw new Error("warn " + m); } } };
  const { testeOposto } = await import("../ui/ferramentas-testes.mjs");
  await testeOposto({ atorIds: ["a1", "b1"], chave: "atletismo", motivo: "x", empate: true });
  if (!criada) throw new Error("sem mensagem");
  if (criada.content.includes("data-op2-pers-resolver")) throw new Error("botão de resolver sem vencedor");
});
