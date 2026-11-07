/**
 * Reduções de passo que valem até o fim da rodada: Erguer-se como ação livre e
 * Atrapalhar vencido. Ficam numa flag do ator com a chave da rodada; o próximo teste
 * na mesma rodada desce o dado da perícia e diz no card por quê.
 */
import { SYSTEM_ID } from "../config.mjs";
import { comoMestre, registrarAcaoDeMestre } from "../ui/socket.mjs";

/** As reduções da rodada atual (pura). */
export function reducoesDaRodada(lista, rodada) {
  return (Array.isArray(lista) ? lista : []).filter((r) => r && r.rodada === rodada);
}

async function rodadaAtual() {
  const { chaveDaRodada } = await import("./poderes.mjs");
  return chaveDaRodada();
}

/** Marca a redução no ator (pelo mestre: o alvo do Atrapalhar costuma ser de outro). */
export async function reduzirNaRodada(ator, { passos = 1, motivo }) {
  await comoMestre("op2ReducaoRodada", { uuid: ator.uuid, passos, motivo, rodada: await rodadaAtual() });
}

/** Quantos passos o teste perde agora, e as notas para o card. */
export async function reducaoDoTeste(ator) {
  const ativas = reducoesDaRodada(ator?.getFlag?.(SYSTEM_ID, "reducoes"), await rodadaAtual());
  return {
    passos: ativas.reduce((t, r) => t + (Number(r.passos) || 0), 0),
    notas: ativas.map((r) => ({ tipo: "reducao", motivo: r.motivo, passos: r.passos })),
  };
}

/* ---- Vantagens contra um alvo: Fintar (+2 passos no próximo ataque) e Mirar (+1d6) ---- */

/** Chave da rodada seguinte ("c<id>.3" → "c<id>.4"). */
export function proximaChave(chave) {
  return String(chave).replace(/(\d+)$/, (n) => String(Number(n) + 1));
}

/** As vantagens do agente que valem agora contra o alvo (pura). */
export function vantagensAtivas(lista, rodada, alvoUuid) {
  return (Array.isArray(lista) ? lista : []).filter((v) => v?.alvoUuid === alvoUuid && v.rodadas?.includes(rodada));
}

/**
 * Fintar vencido: +2 passos no próximo ataque contra o alvo, até o fim da PRÓXIMA rodada.
 * Mirar: +1d6 nos ataques à distância contra o alvo NA PRÓXIMA rodada.
 */
export async function registrarVantagem(agente, { tipo, alvo }) {
  const atual = await rodadaAtual();
  const rodadas = tipo === "finta" ? [atual, proximaChave(atual)] : [proximaChave(atual)];
  await comoMestre("op2Vantagem", {
    uuid: agente.uuid, atual,
    vantagem: { id: foundry.utils.randomID(), tipo, alvoUuid: alvo.uuid, alvoNome: alvo.name, rodadas },
  });
}

export async function vantagensContra(agente, alvo) {
  const ativas = vantagensAtivas(agente?.getFlag?.(SYSTEM_ID, "vantagens"), await rodadaAtual(), alvo?.uuid);
  return { finta: ativas.find((v) => v.tipo === "finta") ?? null, mira: ativas.find((v) => v.tipo === "mira") ?? null };
}

/** A finta vale para UM ataque: usada, sai. */
export async function consumirVantagem(agente, id) {
  await comoMestre("op2VantagemUsada", { uuid: agente.uuid, id });
}

export function registrarReducoes() {
  registrarAcaoDeMestre("op2Vantagem", async ({ uuid, atual, vantagem }) => {
    const ator = await fromUuid(uuid);
    if (!ator) return;
    const vivas = (ator.getFlag(SYSTEM_ID, "vantagens") ?? [])
      .filter((v) => v.rodadas?.some((r) => r === atual || r === proximaChave(atual)));
    await ator.setFlag(SYSTEM_ID, "vantagens", [...vivas, vantagem]);
  });
  registrarAcaoDeMestre("op2VantagemUsada", async ({ uuid, id }) => {
    const ator = await fromUuid(uuid);
    if (!ator) return;
    await ator.setFlag(SYSTEM_ID, "vantagens", (ator.getFlag(SYSTEM_ID, "vantagens") ?? []).filter((v) => v.id !== id));
  });
  registrarAcaoDeMestre("op2ReducaoRodada", async ({ uuid, passos, motivo, rodada }) => {
    const ator = await fromUuid(uuid);
    if (!ator) return;
    const atuais = reducoesDaRodada(ator.getFlag(SYSTEM_ID, "reducoes"), rodada);
    await ator.setFlag(SYSTEM_ID, "reducoes", [...atuais, { rodada, passos, motivo }]);
  });
}
