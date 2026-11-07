/**
 * Combate simplificado (spec §8.1) — orquestração.
 *
 * Guia de combate de Contos da Vigília: o ataque é contra a DT 7. Só vira teste
 * oposto quando o alvo se defende — está Defendendo-se (declarou Defender-se) ou tem
 * Esquiva — e isso é perguntado a ele ANTES de o atacante rolar. O dano, como todo
 * efeito no sistema, precisa de um clique.
 *
 * O playtest marca este módulo como temporário (§8): o combate completo vem depois.
 */
import { SYSTEM_ID } from "../config.mjs";
import { rolarTeste, renderizar, rotuloDePericia } from "../dice/teste.mjs";
import { vencedorDoOposto, resolverAtaque, opcoesDeDefesa, acertaContraDT } from "./combate.mjs";
import { perguntarA, registrarPergunta, responsavelPor } from "../ui/socket.mjs";
import { alvosDisponiveis, alvosMarcados } from "./encerrar-investigacao.mjs";

/**
 * Agredir: escolhe o alvo, pergunta a ELE se vai se defender (antes de rolar), rola e
 * publica o card. Sem defesa, o ataque é contra a DT 7; com defesa, o card espera o
 * teste oposto do alvo.
 */
export async function atacar(ator, { alvoUuid, armado, rapido = false } = {}) {
  const alvo = alvoUuid ? await fromUuid(alvoUuid) : await escolherAlvo(ator);
  if (!alvo) return null;

  const usaArma = armado ?? await perguntarSeArmado(game.i18n.localize("OP2.Combate.Atacar"));
  if (usaArma === null) return null;

  const defesa = await perguntarDefesa(ator, alvo, { distancia: false, nome: game.i18n.localize("OP2.Combate.Atacar") });
  const roll = await rolarTeste(ator, {
    chavePericia: "luta",
    ...(defesa ? { oposto: true } : { dt: 7 }),
    rapido,
    contexto: game.i18n.format("OP2.Combate.AtaqueContexto", { alvo: alvo.name }),
  });
  if (!roll) return null;
  await publicarAtaque(ator, alvo, roll, { armado: usaArma, defesa, dano: { base: usaArma ? "ra" : "rb", bonus: usaArma ? bonusDeArma(ator) : 0 } });
  return roll;
}

/**
 * Ataque de criatura (botão de punho da ficha): mesmo fluxo do Agredir, com os dados
 * do bloco e o dano da fórmula dela ("RA+1", "RB+2"). À distância, o alvo que se
 * defende só tem Acrobacia.
 * `rolar({ dt })` rola e publica o teste; devolve o roll.
 */
export async function atacarComCriatura(ator, { rolar, dano = null, distancia = false, nome = "" }) {
  const alvo = await escolherAlvo(ator);
  if (!alvo) return null;
  const defesa = await perguntarDefesa(ator, alvo, { distancia, nome });
  const roll = await rolar({ dt: defesa ? null : 7 });
  if (!roll) return null;
  await publicarAtaque(ator, alvo, roll, { armado: true, dano, distancia, nome, defesa });
  return roll;
}

/* ---------------- defesa perguntada antes da rolagem ---------------- */

const PD = (chave, dados) => (dados ? game.i18n.format(`OP2.Defesa.${chave}`, dados) : game.i18n.localize(`OP2.Defesa.${chave}`));

function rotuloDaDefesa({ modo, pericia }, itemEsquiva = null) {
  const per = rotuloDePericia(pericia);
  return modo === "habilidade"
    ? PD("OpcaoEsquiva", { pericia: per, habilidade: itemEsquiva?.name ?? "Esquiva" })
    : PD("OpcaoDefendendo", { pericia: per });
}

async function opcoesDoAlvo(alvo, distancia) {
  const { poderDe, chaveDaRodada } = await import("./poderes.mjs");
  return opcoesDeDefesa({
    defendendo: Boolean(alvo.statuses?.has("defendendo")),
    temEsquiva: Boolean(poderDe(alvo, "esquiva")),
    esquivaUsada: alvo.getFlag(SYSTEM_ID, "esquivaRodada") === chaveDaRodada(),
    distancia,
  });
}

/**
 * Antes de o atacante rolar: o alvo que está Defendendo-se (ou tem Esquiva) escolhe
 * se gasta a defesa. A janela abre para quem joga com o alvo; sem resposta, segue
 * sem defesa. Devolve `{ modo, pericia }` ou null.
 */
async function perguntarDefesa(atacante, alvo, { distancia, nome }) {
  const opcoes = await opcoesDoAlvo(alvo, distancia);
  if (!opcoes.length) return null;
  const usuario = responsavelPor(alvo);
  if (usuario && usuario.id !== game.user.id) ui.notifications.info(PD("Aguardando", { nome: alvo.name }));
  const escolha = await perguntarA(usuario, "op2PerguntarDefesa", {
    atacanteId: atacante.id, alvoUuid: alvo.uuid, distancia, nome,
  });
  return escolha?.modo ? escolha : null;
}

/** No cliente de quem joga com o alvo: a janela "vai se defender?". Gasta o que usar. */
async function responderDefesa({ atacanteId, alvoUuid, distancia, nome }) {
  const alvo = await fromUuid(alvoUuid);
  const atacante = game.actors.get(atacanteId);
  if (!alvo) return null;
  const opcoes = await opcoesDoAlvo(alvo, distancia);
  if (!opcoes.length) return null;
  const { poderDe, chaveDaRodada } = await import("./poderes.mjs");
  const esquiva = poderDe(alvo, "esquiva");
  const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
  const escolha = await foundry.applications.api.DialogV2.wait({
    window: { title: `${PD("Titulo")} — ${alvo.name}`, icon: "fa-solid fa-shield" },
    classes: ["op2", "op2-ferr-dialogo", "op2-defesa-janela"],
    position: { width: 420 },
    content: `<p>${PD("Pergunta", {
      atacante: `<strong>${esc(atacante?.name ?? "?")}</strong>`, alvo: `<strong>${esc(alvo.name)}</strong>`,
      ataque: esc(nome || game.i18n.localize("OP2.Combate.Atacar")),
      alcance: esc(PD(distancia ? "Distancia" : "Corpo")),
    })}</p><p class="op2-ajuda">${esc(PD("Ajuda"))}</p>`,
    buttons: [
      ...opcoes.map((o, i) => ({ action: String(i), label: rotuloDaDefesa(o, esquiva), icon: "fa-solid fa-shield", default: i === 0 })),
      { action: "nao", label: PD("Nao"), icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  });
  const opcao = opcoes[Number(escolha)];
  if (!opcao || escolha === "nao") return null;
  // A defesa se gasta na escolha: Defendendo-se sai; a Esquiva fica usada na rodada.
  if (opcao.modo === "declarada") await alvo.toggleStatusEffect("defendendo", { active: false });
  else await alvo.setFlag(SYSTEM_ID, "esquivaRodada", chaveDaRodada());
  return opcao;
}

/* ---------------- card do ataque ---------------- */

async function publicarAtaque(ator, alvo, roll, { armado, dano = null, distancia = false, nome = "", defesa = null }) {
  const acertou = defesa ? null : acertaContraDT(roll);
  const leitura = dano?.base === "rb" ? roll.rb : roll.ra;
  const valorDano = dano?.base ? Math.max(0, leitura + (dano.bonus ?? 0)) : 0;
  const esquiva = defesa ? (await import("./poderes.mjs")).poderDe(alvo, "esquiva") : null;
  // Os dados do card ficam na flag: a Guardiã re-renderiza o card com outro alvo.
  const dados = {
    titulo: nome || game.i18n.localize("OP2.Combate.Atacar"),
    texto: defesa
      ? game.i18n.format("OP2.Combate.AtaqueDefendido", {
        atacante: ator.name, alvo: alvo.name, total: roll.total, defesa: rotuloDaDefesa(defesa, esquiva),
      })
      : game.i18n.format(acertou ? "OP2.Combate.Acertou" : "OP2.Combate.Errou", { atacante: ator.name, alvo: alvo.name, total: roll.total }),
    atacanteId: ator.id,
    alvoId: alvo.id,
    alvoNome: alvo.name,
    total: roll.total,
    ra: roll.ra,
    rb: roll.rb,
    armado,
    danoBase: dano?.base ?? "",
    danoBonus: dano?.bonus ?? 0,
    distancia,
    defesa: defesa ? { ...defesa, rotulo: rotuloDaDefesa(defesa, esquiva) } : null,
    acertou,
    dano: acertou ? valorDano : 0,
  };
  const conteudo = await renderizar(`systems/${SYSTEM_ID}/templates/chat/ataque.hbs`, dados);

  await ChatMessage.create({
    content: conteudo,
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    flags: { [SYSTEM_ID]: { tipo: "ataque", atorId: ator.id, ataque: dados } },
  });
}

/**
 * Teste oposto do alvo que escolheu se defender: Acrobacia (ou Luta) com +d6 — a
 * única exceção aditiva do playtest (spec §8.1). Vencendo, não sofre nem causa dano.
 */
export async function defender(defensor, { atacanteId, totalAtaque, raAtaque, rbAtaque, pericia = "acrobacia", danoAtacante = null, rapido = false }) {
  const atacante = game.actors.get(atacanteId);
  if (!atacante) return null;

  const roll = await rolarTeste(defensor, {
    chavePericia: pericia,
    oposto: true,
    rapido,
    dadosExtras: [{ chave: "defesa", rotulo: game.i18n.localize("OP2.Defesa.Titulo"), tipo: "extra", dado: "d6" }],
    contexto: game.i18n.format("OP2.Combate.DefesaContexto", { atacante: atacante.name }),
  });
  if (!roll) return null;

  const danoInfo = danoAtacante ?? { base: "ra", bonus: 0 };
  const vencedor = vencedorDoOposto(totalAtaque, roll.total);
  const { dano, alvo } = resolverAtaque({
    vencedor,
    esquiva: true,
    leituraAtacante: { ra: danoInfo.base === "rb" ? rbAtaque : raAtaque, rb: rbAtaque },
    leituraDefensor: { ra: roll.ra, rb: roll.rb },
    armadoAtacante: true,
    armadoDefensor: false,
    bonusAtacante: danoInfo.bonus ?? 0,
  });

  // Escudo: o defensor perdeu, mas somou 7+ → o dano cai em RB do defensor.
  let danoFinal = dano;
  const escudo = defensor.items?.find((i) => i.type === "equipamento" && i.system.equipado && i.system.escudo);
  if (escudo && alvo === "defensor" && roll.total >= 7) danoFinal = Math.max(0, dano - roll.rb);

  const quemSofre = alvo === "defensor" ? defensor : null;
  const conteudo = await renderizar(`systems/${SYSTEM_ID}/templates/chat/ataque-resultado.hbs`, {
    titulo: game.i18n.localize("OP2.Combate.Resultado"),
    totalAtaque,
    totalDefesa: roll.total,
    esquiva: true,
    texto: textoDoDesfecho({ vencedor, atacante, defensor, dano: danoFinal }),
    danosMutuos: [],
    temDano: danoFinal > 0 && Boolean(quemSofre),
    dano: danoFinal,
    quemSofreId: quemSofre?.id ?? "",
    quemSofreNome: quemSofre?.name ?? "",
  });

  await ChatMessage.create({
    content: conteudo,
    speaker: ChatMessage.getSpeaker({ actor: defensor }),
    flags: { [SYSTEM_ID]: { tipo: "ataque-resultado", atorId: defensor.id } },
  });

  return { roll, vencedor, dano: danoFinal, alvo };
}

/** Card com defesa: o teste do alvo abre sozinho para quem joga com ele. */
const emAndamento = new Set();

export async function rolarDefesaDoCard(defensor, dataset) {
  const id = dataset.mensagemId;
  const mensagem = game.messages.get(id);
  if (mensagem?.getFlag(SYSTEM_ID, "respondido")) return void ui.notifications.warn(PD("JaRolou"));
  if (emAndamento.has(id)) return;
  emAndamento.add(id);
  try {
    const r = await defender(defensor, {
      atacanteId: dataset.atacanteId,
      totalAtaque: Number(dataset.total),
      raAtaque: Number(dataset.ra),
      rbAtaque: Number(dataset.rb),
      pericia: dataset.pericia || "acrobacia",
      danoAtacante: dataset.danoBase ? { base: dataset.danoBase, bonus: Number(dataset.danoBonus) || 0 } : null,
    });
    if (r) {
      const { marcarAtaqueRespondido } = await import("./guardia.mjs");
      await marcarAtaqueRespondido(id);
    }
  } finally {
    emAndamento.delete(id);
  }
}

function abrirDefesaAoNascer(mensagem) {
  const f = mensagem.flags?.[SYSTEM_ID];
  if (f?.tipo !== "ataque" || !f.ataque?.defesa || f.respondido) return;
  const defensor = game.actors.get(f.ataque.alvoId);
  if (!defensor || responsavelPor(defensor)?.id !== game.user.id) return;
  const a = f.ataque;
  void rolarDefesaDoCard(defensor, {
    mensagemId: mensagem.id, atacanteId: a.atacanteId, total: a.total, ra: a.ra, rb: a.rb,
    pericia: a.defesa.pericia, danoBase: a.danoBase, danoBonus: a.danoBonus,
  });
}

export function registrarDefesa() {
  registrarPergunta("op2PerguntarDefesa", responderDefesa);
  Hooks.on("createChatMessage", abrirDefesaAoNascer);
}

/** Modificador de dano da melhor arma equipada (0 sem arma). */
function bonusDeArma(ator) {
  const armas = ator?.items?.filter((i) => i.type === "equipamento" && i.system.arma && i.system.equipado) ?? [];
  return armas.reduce((max, i) => Math.max(max, i.system.danoBonus ?? 0), 0);
}

function textoDoDesfecho({ vencedor, atacante, defensor, dano }) {
  if (vencedor === "atacante") return game.i18n.format("OP2.Combate.Venceu", { vencedor: atacante.name, perdedor: defensor.name, dano });
  return game.i18n.format("OP2.Combate.DefendeuTexto", { defensor: defensor.name });
}

/**
 * Quem apanha. A mira do Foundry manda: marcou um token, é nele — sem lista, sem
 * exigir que esteja na investigação. Sem marcação, oferece quem está no combate, na
 * cena ou na investigação.
 */
export async function escolherAlvo(ator, titulo = game.i18n.localize("OP2.Combate.Atacar")) {
  const marcados = alvosMarcados({ exceto: ator });
  if (marcados.length === 1) return marcados[0];

  const candidatos = marcados.length > 1 ? marcados : alvosDisponiveis({ exceto: ator });
  if (!candidatos.length) {
    ui.notifications.warn(game.i18n.localize("OP2.Combate.SemAlvos"));
    return null;
  }
  const opcoes = candidatos
    .map((a) => `<option value="${a.uuid}">${foundry.utils.escapeHTML(a.name)}</option>`).join("");
  const uuid = await foundry.applications.api.DialogV2.prompt({
    window: { title: titulo },
    content: `
      <div class="form-group">
        <label>${game.i18n.localize("OP2.Combate.Alvo")}</label>
        <select name="alvo">${opcoes}</select>
      </div>`,
    ok: { callback: (_evento, botao) => botao.form.elements.alvo.value },
    rejectClose: false,
  });
  return uuid ? fromUuid(uuid) : null;
}

/**
 * Arma na mão decide entre RA e RB (spec §8.1). É pergunta, não leitura do
 * inventário: o playtest não define "empunhando", e a mesa resolve isso narrando.
 */
async function perguntarSeArmado(titulo) {
  const resposta = await foundry.applications.api.DialogV2.wait({
    window: { title: titulo },
    content: `<p>${game.i18n.localize("OP2.Combate.ArmadoPergunta")}</p>`,
    buttons: [
      { action: "sim", label: "OP2.Combate.Armado", icon: "fa-solid fa-khanda" },
      { action: "nao", label: "OP2.Combate.Desarmado", icon: "fa-solid fa-hand-fist" },
    ],
    rejectClose: false,
  });
  if (!resposta) return null;
  return resposta === "sim";
}
