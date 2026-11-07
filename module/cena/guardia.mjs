/**
 * Guardiã: quando um aliado sofre um ataque, a guardiã pode gastar 2 PD (uma vez por
 * rodada) para se tornar o alvo. Assim que o card de ataque nasce, quem joga com uma
 * personagem guardiã recebe uma janela flutuante; aceitando, o card troca o alvo —
 * o dano passa a ser dela. Só aparece em ataque que acertou e sem defesa do alvo.
 *
 * "Alcance curto" fica com a mesa: a janela lembra a condição, não mede no mapa.
 */
import { SYSTEM_ID } from "../config.mjs";
import { comoMestre, registrarAcaoDeMestre, responsavelPor } from "../ui/socket.mjs";

const { DialogV2 } = foundry.applications.api;
const P = (chave, dados) => (dados ? game.i18n.format(`OP2.Poder.${chave}`, dados) : game.i18n.localize(`OP2.Poder.${chave}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const CUSTO = 2;

/** Pode proteger: tem a habilidade, não é o alvo nem o atacante, vivo, com PD, livre na rodada. */
export function podeProteger({ temHabilidade, ehAlvo, ehAtacante, morto, pd, usadaNaRodada }) {
  return Boolean(temHabilidade) && !ehAlvo && !ehAtacante && !morto && (pd ?? 0) >= CUSTO && !usadaNaRodada;
}

async function oferecer(mensagem) {
  const f = mensagem.flags?.[SYSTEM_ID];
  if (f?.tipo !== "ataque" || !f.ataque || f.ataque.defesa || !f.ataque.acertou) return;
  const alvo = game.actors.get(f.ataque.alvoId);
  if (alvo?.type !== "personagem") return;
  const { poderDe, chaveDaRodada } = await import("./poderes.mjs");
  const rodada = chaveDaRodada();
  for (const guardia of game.actors.filter((a) => a.type === "personagem")) {
    const ok = podeProteger({
      temHabilidade: Boolean(poderDe(guardia, "guardia")),
      ehAlvo: guardia.id === alvo.id,
      ehAtacante: guardia.id === f.ataque.atacanteId,
      morto: guardia.statuses?.has?.("morto"),
      pd: guardia.system.recursos?.pd?.value,
      usadaNaRodada: guardia.getFlag(SYSTEM_ID, "guardiaRodada") === rodada,
    });
    if (!ok || responsavelPor(guardia)?.id !== game.user.id) continue;
    void perguntar(mensagem, guardia, alvo, f.ataque);
  }
}

async function perguntar(mensagem, guardia, alvo, ataque) {
  const atacante = game.actors.get(ataque.atacanteId);
  const item = (await import("./poderes.mjs")).poderDe(guardia, "guardia");
  const escolha = await DialogV2.wait({
    window: { title: `${item?.name ?? P("GuardiaTitulo")} — ${guardia.name}`, icon: "fa-solid fa-shield-halved" },
    classes: ["op2", "op2-ferr-dialogo", "op2-guardia-janela"],
    position: { width: 380 },
    content: `<p>${P("GuardiaPergunta", {
      atacante: `<strong>${esc(atacante?.name ?? "?")}</strong>`, alvo: `<strong>${esc(alvo.name)}</strong>`,
      guardia: `<strong>${esc(guardia.name)}</strong>`, total: ataque.total,
    })}</p><p class="op2-ajuda">${esc(P("GuardiaLembrete"))}</p>`,
    buttons: [
      { action: "sim", label: P("GuardiaAceitar"), icon: "fa-solid fa-shield-halved", default: true },
      { action: "nao", label: P("GuardiaRecusar"), icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  });
  if (escolha !== "sim") return;
  const atual = game.messages.get(mensagem.id)?.flags?.[SYSTEM_ID];
  if (atual?.respondido || atual?.guardia) return void ui.notifications.warn(P("GuardiaTarde", { alvo: alvo.name }));
  const pd = guardia.system.recursos?.pd?.value ?? 0;
  if (pd < CUSTO) return void ui.notifications.warn(game.i18n.format("OP2.Aviso.SemPD", { nome: item?.name ?? "", custo: CUSTO }));
  const { chaveDaRodada } = await import("./poderes.mjs");
  await guardia.update({ "system.recursos.pd.value": pd - CUSTO, [`flags.${SYSTEM_ID}.guardiaRodada`]: chaveDaRodada() });
  await comoMestre("op2GuardiaTrocar", { mensagemId: mensagem.id, guardiaId: guardia.id });
}

/** No mestre: o card de ataque passa a mirar a guardiã. */
async function trocarAlvo({ mensagemId, guardiaId }) {
  const mensagem = game.messages.get(mensagemId);
  const f = mensagem?.flags?.[SYSTEM_ID];
  const guardia = game.actors.get(guardiaId);
  if (!f?.ataque || f.respondido || f.guardia || !guardia) return;
  const alvoAntigo = game.actors.get(f.ataque.alvoId);
  const atacante = game.actors.get(f.ataque.atacanteId);
  const ataque = {
    ...f.ataque,
    alvoId: guardia.id,
    alvoUuid: guardia.uuid,
    alvoNome: guardia.name,
    texto: game.i18n.format("OP2.Combate.Acertou", { atacante: atacante?.name ?? "", alvo: guardia.name, total: f.ataque.total }),
    guardiaNota: P("GuardiaTrocou", { guardia: guardia.name, alvo: alvoAntigo?.name ?? "" }),
  };
  const { renderizar } = await import("../dice/teste.mjs");
  const content = await renderizar(`systems/${SYSTEM_ID}/templates/chat/ataque.hbs`, ataque);
  await mensagem.update({ content, [`flags.${SYSTEM_ID}.ataque`]: ataque, [`flags.${SYSTEM_ID}.guardia`]: guardia.id });
}

/** O defensor respondeu: a guardiã não troca mais o alvo deste ataque. */
export async function marcarAtaqueRespondido(mensagemId) {
  if (mensagemId) await comoMestre("op2AtaqueRespondido", { mensagemId });
}

export function registrarGuardia() {
  registrarAcaoDeMestre("op2GuardiaTrocar", trocarAlvo);
  registrarAcaoDeMestre("op2AtaqueRespondido", async ({ mensagemId }) => {
    await game.messages.get(mensagemId)?.setFlag(SYSTEM_ID, "respondido", true);
  });
  Hooks.on("createChatMessage", (mensagem) => void oferecer(mensagem));
}
