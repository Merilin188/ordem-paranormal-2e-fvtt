/**
 * Orquestra um teste do começo ao fim: monta os componentes, rola, resolve a escolha
 * dos dados contabilizados e publica o card no chat.
 */
import { SYSTEM_ID } from "../config.mjs";
import { OP2Roll } from "./op2-roll.mjs";
import { TesteDialog } from "./teste-dialog.mjs";
import { SelecaoDados } from "./selecao-dados.mjs";
import { lerConfig } from "../settings/register.mjs";
import { stepDie } from "./escada.mjs";
import { consumirAjuda } from "../cena/acoes-ajuda.mjs";
import { gastarImpeto, podePreencherImpeto } from "../cena/impeto.mjs";
import { modificadorDoTeste } from "../cena/tabelas-dados.mjs";
import {
  escolherUsoDoPavor, controlarPavor, abracarPavor, vencerPavor, pedirDadoDePavor, vestirDadoDePavor,
} from "../cena/pavor.mjs";

/**
 * @param {Actor} ator
 * @param {object} opcoes
 * @param {string} opcoes.chavePericia   "percepcao" ou "aptidao.exatas"
 * @param {string} [opcoes.chaveAtributo] default: o atributo pareado na ficha
 * @param {number|null} [opcoes.dt]
 * @param {boolean} [opcoes.oposto]
 * @param {boolean} [opcoes.semDT]       teste sem DT e sem sucesso/falha — Examinar
 *                                       compara o total contra várias DTs (spec §6.3.1)
 * @param {string} [opcoes.contexto]     título do card (default: nome da perícia)
 * @param {boolean} [opcoes.rapido]      pula o diálogo e usa os defaults
 * @returns {Promise<OP2Roll|null>}
 */
export async function rolarTeste(ator, {
  chavePericia, chaveAtributo, dt, oposto = false, semDT = false, contexto, rapido = false,
  semCard = false, dadosExtras = [],
} = {}) {
  const sistema = ator.system;
  const pericia = sistema.resolverChave(chavePericia);
  if (!pericia) {
    ui.notifications.error(game.i18n.format("OP2.Aviso.PericiaDesconhecida", { chave: chavePericia }));
    return null;
  }

  // Clicar direto num atributo (Físico/Mente/Emoção) não tem par natural — a regra do
  // playtest é sempre perícia + atributo (spec §4.1), e um atributo não pareia consigo
  // mesmo. `atributoDe()` só sabe o pareamento de perícias; para um atributo puro o
  // teste é o dado dele sozinho, sem segundo componente automático.
  const somenteAtributo = pericia.tipo === "atributo";

  const base = {
    chavePericia,
    rotuloPericia: rotuloDePericia(chavePericia),
    pericia: { ...pericia, dadoEfetivo: pericia.dado },
    chaveAtributo: somenteAtributo ? null : (chaveAtributo ?? sistema.atributoDe(chavePericia) ?? "fisico"),
    somenteAtributo,
    dt: semDT ? null : (dt ?? lerConfig("dtPadrao")),
    oposto,
    semDT,
    // Dados somados que não vêm da ficha — hoje só o +d6 da esquiva (spec §8.1),
    // a única exceção aditiva do playtest.
    dadosExtras,
    // Ajuda recebida e ainda não usada (spec §4.7): entra como passo já aplicado
    // no dado que o setting `ajudaAlvo` indica, e some depois desta rolagem.
    ajuda: ator.system.estado?.ajuda?.passos
      ? { ...ator.system.estado.ajuda, alvo: lerConfig("ajudaAlvo") }
      : null,
  };

  const config = rapido ? configuracaoRapida(ator, base) : await TesteDialog.abrir({ ator, base });
  if (!config) return null;

  // Habilidade com custo em PD ("gaste 2 PD para receber +d4"): cobra ao confirmar,
  // não ao marcar — desmarcar ou fechar o diálogo não pode custar nada.
  if (config.custoPD > 0) {
    await ator.update({
      "system.recursos.pd.value": Math.max(0, (ator.system.recursos?.pd?.value ?? 0) - config.custoPD),
    });
  }

  // O espaço de ímpeto só some depois de a rolagem ser confirmada.
  if (config.gastarImpeto) await gastarImpeto(ator, 1);

  // Lesões/traumas dão modificador fixo; o dado de pavor rola junto e consome os menores.
  const atributoUsado = config.componentes.find((c) => c.tipo === "atributo")?.chave?.split(".")[1] ?? null;
  const modificador = modificadorDoTeste(sistema.modificadores, chavePericia, atributoUsado);
  const componentes = [...config.componentes];
  // Dado de pavor: antes do teste dá para controlá-lo (1 PD, −1 passo) ou abraçá-lo
  // (5 PD, vira dado bônus e o pavor acaba). Sem isso, rola junto e anula os menores.
  let pavor = sistema.estado?.pavor;
  let pavorAbracado = false;
  if (pavor && !rapido) {
    const escolha = await escolherUsoDoPavor(ator, pavor);
    if (escolha === null) return null;
    if (escolha === "controlar") {
      pavor = await controlarPavor(ator);
    } else if (escolha === "abracar") {
      await abracarPavor(ator);
      componentes.push({ chave: "pavorAbracado", rotulo: game.i18n.localize("OP2.Pavor.Abracado"), tipo: "extra", dado: pavor });
      pavorAbracado = true;
    }
  }
  const roll = OP2Roll.paraComponentes(componentes, {
    dt: config.dt,
    escopoCritico: lerConfig("escopoCritico"),
    rotulo: contexto ?? base.rotuloPericia,
    atorId: ator.id,
    chavePericia,
    modificador,
  });

  await roll.evaluate();

  // 1) Os dados do jogador rolam em 3D primeiro (todos veem).
  await mostrarDados3D(roll);

  // 2) Com pavor: depois de ver os próprios dados, o jogador é obrigado a rolar o
  //    dado de pavor, antes da soma e do resultado. Ele rola em 3D com aparência
  //    sombria e anula os resultados menores.
  if (pavor && !pavorAbracado) {
    await pedirDadoDePavor(roll, ator, pavor);
    const rollPavor = await new Roll(`1${pavor}`).evaluate();
    vestirDadoDePavor(rollPavor);
    await mostrarDados3D(rollPavor);
    roll.definirPavor(pavor, rollPavor.total);
  }

  // 3) Rolou mais do que soma: o jogador escolhe quais contam (já sem os anulados).
  if (roll.precisaSelecao) roll.aplicarSelecao(await SelecaoDados.abrir(roll, ator));

  // `semCard`: quem chamou publica o próprio card com os dados dentro (Examinar,
  // solicitação do mestre). A animação já aconteceu; o card não repete.
  if (!semCard) await enviarParaChat(roll, ator, { pularDados3D: true });

  // Ajuda é para UMA rolagem: usada, acabou (spec §4.7 — custa a ação do aliado
  // para aquele teste, não é um efeito com duração).
  if (base.ajuda) await consumirAjuda(ator);

  // Vencendo o pavor: tirou 1 no dado de pavor, o medo termina.
  if (roll.resultado.pavor?.resultado === 1) await vencerPavor(ator);

  return roll;
}

/** Configuração sem diálogo: perícia + atributo pareado, DT padrão. */
function configuracaoRapida(ator, base) {
  // Sem diálogo, a ajuda pendente precisa entrar aqui — senão o modo rápido
  // (macros, cards, testes) ignoraria silenciosamente o passo do aliado.
  const passosDaAjuda = (tipo) => (base.ajuda && base.ajuda.alvo === tipo ? base.ajuda.passos : 0);

  const componentes = [
    {
      chave: `pericia.${base.chavePericia}`,
      rotulo: base.rotuloPericia,
      tipo: "pericia",
      dado: stepDie(base.pericia.dado, passosDaAjuda("pericia")),
    },
  ];

  if (!base.somenteAtributo) {
    const atributo = ator.system.atributos[base.chaveAtributo];
    componentes.push({
      chave: `atributo.${base.chaveAtributo}`,
      rotulo: game.i18n.localize(`OP2.Atributo.${base.chaveAtributo}`),
      tipo: "atributo",
      dado: stepDie(atributo.dadoEfetivo, passosDaAjuda("atributo")),
    });
  }

  componentes.push(...(base.dadosExtras ?? []));

  return {
    dt: (base.oposto || base.semDT) ? null : base.dt,
    oposto: base.oposto,
    componentes,
  };
}

/** "aptidao.exatas" → "Aptidão (Exatas)". */
export function rotuloDePericia(chave) {
  if (!chave.startsWith("aptidao.")) return game.i18n.localize(`OP2.Pericia.${chave}`);
  const sub = chave.slice("aptidao.".length);
  const rotuloSub = game.i18n.localize(`OP2.Aptidao.${sub}`);
  return `${game.i18n.localize("OP2.Pericia.aptidao")} (${rotuloSub})`;
}

export async function mostrarDados3D(roll) {
  if (!game.dice3d) return;
  try {
    await game.dice3d.showForRoll(roll, game.user, true);
  } catch (erro) {
    console.warn(`${SYSTEM_ID} | Dice So Nice falhou, seguindo sem animação`, erro);
  }
}

/**
 * @param {OP2Roll} roll
 * @param {Actor} ator
 */
/** Arma equipada com o maior modificador de dano. */
export function melhorArma(ator) {
  const armas = ator?.items?.filter((i) => i.type === "equipamento" && i.system.arma && i.system.equipado) ?? [];
  return armas.sort((a, b) => (b.system.danoBonus ?? 0) - (a.system.danoBonus ?? 0))[0] ?? null;
}

/** HTML do card de resultado de um teste (o mesmo do chat). */
export function htmlDoTeste(roll, ator) {
  const resultado = roll.resultado;
  // Teste de ataque (Luta/Pontaria): oferece o dano com o modificador da arma equipada.
  const ehAtaque = ["luta", "pontaria"].includes(roll.options.chavePericia);
  const arma = ehAtaque ? melhorArma(ator) : null;
  return renderizar("systems/ordem-paranormal-2e/templates/chat/teste.hbs", {
    rotulo: roll.options.rotulo,
    componentes: roll.dados,
    ...resultado,
    arma: arma ? { nome: arma.name, bonus: arma.system.danoBonus, dano: resultado.ra + arma.system.danoBonus } : null,
    atorId: ator.id,
    ehGM: game.user.isGM,
    // "Sempre que falha em um teste, você preenche um espaço" (ficha do Ato I).
    podePreencherImpeto: !resultado.sucesso && podePreencherImpeto(ator),
  });
}

export async function enviarParaChat(roll, ator, { pularDados3D = false } = {}) {
  const conteudo = await htmlDoTeste(roll, ator);

  return roll.toMessage(
    {
      speaker: ChatMessage.getSpeaker({ actor: ator }),
      content: conteudo,
      flags: {
        [SYSTEM_ID]: { tipo: "teste", atorId: ator.id, desfecho: roll.desfecho },
        // Quando os dados já rolaram em 3D antes da escolha (4 rolados → 3 contados),
        // a mensagem não pode animar de novo. O Dice So Nice decide isso pela flag
        // `skip` — `dsnHide` nas opções do `toMessage` não existe e era ignorada em
        // silêncio, então a animação acontecia duas vezes (achado em uso real).
        ...(pularDados3D ? { "dice-so-nice": { skip: true } } : {}),
      },
    },
    // Sem `rollMode`: o core aplica o modo do usuário nas duas versões (v13 lê
    // `core.rollMode`, v14 lê `core.messageMode`) — e no v14 a opção `rollMode` está
    // depreciada (até a 16), com aviso a cada rolagem.
    { create: true },
  );
}

/** `renderTemplate` mudou de lugar no v13; o fallback mantém o v12 utilizável em dev. */
export function renderizar(caminho, contexto) {
  const render = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return render(caminho, contexto);
}
