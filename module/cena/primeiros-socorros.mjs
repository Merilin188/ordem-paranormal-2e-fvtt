/**
 * Primeiros Socorros (v1.2, Lesões): outra forma de salvar um personagem moribundo.
 *
 * Mente + Medicina contra DT 7, +3 a cada uso de primeiros socorros naquele
 * personagem na cena. Passou: ele deixa de estar moribundo, recupera 1 PV e, se
 * estava inconsciente, acorda. Sem maleta de medicamentos, duas reduções de passo;
 * em si mesmo, outras duas. A ação fica em Ações de combate → Ações gerais.
 */
import { SYSTEM_ID } from "../config.mjs";

export const DT_PRIMEIROS_SOCORROS = 7;
export const INCREMENTO_PRIMEIROS_SOCORROS = 3;
const FLAG = "primeirosSocorros";

/** DT do próximo uso naquele personagem: 7, 10, 13… */
export const dtDosPrimeirosSocorros = (usos = 0) => DT_PRIMEIROS_SOCORROS + INCREMENTO_PRIMEIROS_SOCORROS * Math.max(0, usos);

/** Reduções de passo na perícia: −2 sem maleta, −2 em si mesmo (somam). */
export function reducoesDosPrimeirosSocorros({ temMaleta = true, emSiMesmo = false } = {}) {
  return (temMaleta ? 0 : 2) + (emSiMesmo ? 2 : 0);
}

/** Tem algo que pareça uma maleta de medicamentos no inventário? */
export const temMaleta = (ator) => Boolean(ator?.items?.some((i) => /maleta|kit m[eé]dico/i.test(i.name ?? "")));

const L = (chave, dados) => (dados ? game.i18n.format(`OP2.PrimeirosSocorros.${chave}`, dados) : game.i18n.localize(`OP2.PrimeirosSocorros.${chave}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));

/** Quantos usos de primeiros socorros este personagem já recebeu na cena. */
export const usosEm = (ator) => Number(ator?.getFlag?.(SYSTEM_ID, FLAG) ?? 0);

/** Fim da cena (combate encerrado ou contadores zerados): a escada da DT recomeça. */
export async function zerarPrimeirosSocorros(ator) {
  if (ator?.getFlag?.(SYSTEM_ID, FLAG) !== undefined) await ator.unsetFlag(SYSTEM_ID, FLAG);
}

/**
 * Executa a ação: escolhe o moribundo, confirma a maleta, rola e aplica.
 * @param {Actor} ator quem socorre
 */
export async function primeirosSocorros(ator) {
  const { alvosDisponiveis } = await import("./encerrar-investigacao.mjs");
  const candidatos = [ator, ...alvosDisponiveis({ exceto: ator })]
    .filter((a) => a?.statuses?.has("moribundo") && !a.statuses.has("morto"));
  if (!candidatos.length) return void ui.notifications.warn(L("NinguemMoribundo"));

  const maleta = temMaleta(ator);
  const opcoes = candidatos.map((a) => {
    const dt = dtDosPrimeirosSocorros(usosEm(a));
    return `<option value="${esc(a.uuid)}">${esc(a.name)}${a === ator ? ` (${esc(L("VoceMesmo"))})` : ""} — DT ${dt}</option>`;
  }).join("");
  const escolha = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${L("Titulo")} — ${ator.name}`, icon: "fa-solid fa-kit-medical" },
    classes: ["op2", "op2-ferr-dialogo"],
    content: `<p class="op2-ajuda">${esc(L("Regra"))}</p>
      <div class="form-group"><label>${esc(L("Quem"))}</label><select name="alvo">${opcoes}</select></div>
      <div class="form-group"><label>${esc(L("TemMaleta"))}</label><input type="checkbox" name="maleta" ${maleta ? "checked" : ""}></div>`,
    ok: {
      label: L("Rolar"), icon: "fa-solid fa-kit-medical",
      callback: (_e, botao) => ({ uuid: botao.form.elements.alvo.value, maleta: botao.form.elements.maleta.checked }),
    },
    rejectClose: false,
  });
  if (!escolha?.uuid) return null;
  const alvo = await fromUuid(escolha.uuid);
  if (!alvo) return null;

  const usos = usosEm(alvo);
  const dt = dtDosPrimeirosSocorros(usos);
  const emSiMesmo = alvo.uuid === ator.uuid;
  const reducao = reducoesDosPrimeirosSocorros({ temMaleta: escolha.maleta, emSiMesmo });
  const notas = [];
  if (usos) notas.push(L("NotaDt", { usos, dt }));
  if (!escolha.maleta) notas.push(L("NotaSemMaleta"));
  if (emSiMesmo) notas.push(L("NotaEmSiMesmo"));

  const { rolarTeste } = await import("../dice/teste.mjs");
  const roll = await rolarTeste(ator, {
    chavePericia: "medicina", chaveAtributo: "mente", dt,
    passos: reducao ? { pericia: -reducao } : null, notas,
    contexto: L("Contexto", { alvo: alvo.name }),
  });
  if (!roll) return null;

  // Conta o uso com sucesso ou falha: a DT sobe por uso, não por falha.
  const { comoMestre } = await import("../ui/socket.mjs");
  await comoMestre("op2PrimeirosSocorros", { alvoUuid: alvo.uuid, usos: usos + 1, sucesso: Boolean(roll.sucesso) });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: `<div class="op2 op2-card op2-card--${roll.sucesso ? "sucesso" : "falha"}">
      <header class="op2-card__topo"><span class="op2-tag op2-tag--pequena"><i class="fa-solid fa-kit-medical"></i> ${esc(L("Titulo"))}</span>
        <span class="op2-card__dt">DT ${dt}</span></header>
      <p class="op2-card__texto">${esc(L(roll.sucesso ? "Sucesso" : "Falha", { nome: ator.name, alvo: alvo.name }))}</p>
      <p class="op2-ajuda">${esc(L("Proxima", { alvo: alvo.name, dt: dtDosPrimeirosSocorros(usos + 1) }))}</p></div>`,
    flags: { [SYSTEM_ID]: { tipo: "primeiros-socorros", atorId: ator.id } },
  });
  return roll;
}

/** No mestre: conta o uso e, no sucesso, tira o moribundo, acorda e dá 1 PV. */
async function aplicar({ alvoUuid, usos, sucesso }) {
  const alvo = await fromUuid(alvoUuid);
  if (!alvo) return;
  await alvo.setFlag(SYSTEM_ID, FLAG, usos);
  if (!sucesso) return;
  const { definirCondicao } = await import("./ferimentos.mjs");
  await definirCondicao(alvo, "moribundo", false);
  await definirCondicao(alvo, "inconsciente", false);
  const pv = alvo.system.recursos?.pv;
  if (pv) await alvo.update({ "system.recursos.pv.value": Math.min(pv.max, pv.value + 1) });
}

export async function registrarPrimeirosSocorros() {
  const { registrarAcaoDeMestre } = await import("../ui/socket.mjs");
  registrarAcaoDeMestre("op2PrimeirosSocorros", aplicar);
  // Fim do combate é fim de cena: a escada da DT recomeça para todos.
  Hooks.on("deleteCombat", async () => {
    if (game.users.activeGM?.id !== game.user.id) return;
    for (const a of game.actors) await zerarPrimeirosSocorros(a);
  });
}
