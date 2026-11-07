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

export function registrarReducoes() {
  registrarAcaoDeMestre("op2ReducaoRodada", async ({ uuid, passos, motivo, rodada }) => {
    const ator = await fromUuid(uuid);
    if (!ator) return;
    const atuais = reducoesDaRodada(ator.getFlag(SYSTEM_ID, "reducoes"), rodada);
    await ator.setFlag(SYSTEM_ID, "reducoes", [...atuais, { rodada, passos, motivo }]);
  });
}
