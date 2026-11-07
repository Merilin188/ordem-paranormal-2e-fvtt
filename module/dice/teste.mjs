/**
 * Orquestra um teste do começo ao fim: monta os componentes, rola, resolve a escolha
 * dos dados contabilizados e publica o card no chat.
 */
import { definicaoDoEfeito } from "../cena/efeitos-mundo.mjs";
import { SYSTEM_ID } from "../config.mjs";
import { OP2Roll } from "./op2-roll.mjs";
import { TesteDialog } from "./teste-dialog.mjs";
import { SelecaoDados } from "./selecao-dados.mjs";
import { lerConfig } from "../settings/register.mjs";
import { stepDie } from "./escada.mjs";
import { consumirAjuda } from "../cena/acoes-ajuda.mjs";
import { gastarImpeto, podePreencherImpeto } from "../cena/impeto.mjs";
import { modificadorDoTeste } from "../cena/tabelas-dados.mjs";
import { ajustarDepoisDaRolagem, conferirLobo, escolherBonusPlano } from "../cena/poderes.mjs";
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
  semCard = false, dadosExtras = [], ocultoDoMestre = false, passos = null, arma = undefined, notas = [],
} = {}) {
  const sistema = ator.system;
  // Redução até o fim da rodada (Erguer-se livre, Atrapalhar): desce o dado da perícia.
  const { reducaoDoTeste } = await import("../cena/reducoes.mjs");
  const reducao = await reducaoDoTeste(ator);
  if (reducao.passos) passos = { ...(passos ?? {}), pericia: (passos?.pericia ?? 0) - reducao.passos };
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
    // Passos que a cena impõe (perseguição: esforço extra, vala oculta).
    passos,
    ajuda: ator.system.estado?.ajuda?.passos
      ? { ...ator.system.estado.ajuda, alvo: lerConfig("ajudaAlvo") }
      : null,
  };

  const config = rapido ? configuracaoRapida(ator, base) : await TesteDialog.abrir({ ator, base });
  if (!config) return null;
  // Habilidades que mudaram o passo e merecem nota no card (Instinto de Sobrevivência).
  // Habilidades marcadas que mudaram o dado: passo (Instinto e outras) ou dado extra.
  const notasDeHabilidade = (rapido ? [instintoAtivo(ator)?.id] : config.habilidades ?? [])
    .map((id) => ator.items?.get(id)).filter((i) => i && (i.system?.automacao === "instinto"
      || ["passo", "dado-extra"].includes(i.system?.efeito?.tipo)))
    .map((i) => (i.system.efeito?.tipo === "dado-extra"
      ? { tipo: "texto", texto: game.i18n.format("OP2.Motivo.DadoHabilidade", { dado: i.system.efeito.dado, habilidade: i.name }) }
      : { tipo: "instinto", habilidade: i.name }));
  // Quem chamou já sabe de outro motivo (Fintar, Mirar, defesa).
  for (const texto of notas) notasDeHabilidade.push({ tipo: "texto", texto });
  notasDeHabilidade.push(...reducao.notas);
  // Ajuda do aliado usada neste teste: o card diz de quem veio (Mentoria, se ele tem).
  if (base.ajuda?.passos) notasDeHabilidade.push(notaDaAjuda(base.ajuda));

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
  if (pavor) {
    // Antes de rolar: janela obrigatória para controlar, abraçar ou só rolar.
    const escolha = await escolherUsoDoPavor(ator, pavor);
    if (escolha === "controlar") {
      pavor = await controlarPavor(ator);
    } else if (escolha === "abracar") {
      await abracarPavor(ator);
      componentes.push({ chave: "pavorAbracado", rotulo: game.i18n.localize("OP2.Pavor.Abracado"), tipo: "extra", dado: pavor });
      pavorAbracado = true;
    }
  }
  // Plano Estratégico: d6 bônus guardados entram agora, se o jogador quiser.
  const bonusPlano = await escolherBonusPlano(ator, 4 - componentes.length);
  for (let i = 0; i < bonusPlano; i++) {
    componentes.push({ chave: `plano.${i}`, rotulo: game.i18n.localize("OP2.Poder.PlanoTitulo"), tipo: "extra", dado: "d6" });
  }
  // Todo dado que a ficha já entrega mudado (Caído, falha crítica, efeito, item) diz por quê.
  notasDeHabilidade.push(...motivosDosDados(ator, componentes, chavePericia));
  // Arma com crítico facilitado (espada: dois valores 5+) nos testes de ataque.
  const armaCritico = ["luta", "pontaria"].includes(chavePericia)
    ? (arma === undefined ? melhorArma(ator) : arma)?.system?.criticoMinimo : 0;

  const roll = OP2Roll.paraComponentes(componentes, {
    criticoMinimo: armaCritico || 0,
    dt: config.dt,
    escopoCritico: lerConfig("escopoCritico"),
    rotulo: contexto ?? base.rotuloPericia,
    atorId: ator.id,
    chavePericia,
    modificador,
  });
  if (notasDeHabilidade.length) roll.options.ajustes = [...(roll.options.ajustes ?? []), ...notasDeHabilidade];

  await roll.evaluate();

  // 1) Os dados do jogador rolam em 3D primeiro (todos veem).
  await mostrarDados3D(roll, { ocultoDoMestre });

  // 1b) Análise (marcadores ±1) e Mentoria (trocar um dado pela RA) — depois de rolar.
  if (ator.type === "personagem") {
    await ajustarDepoisDaRolagem(ator, roll);
    roll._total = roll.resultado.total;
    await conferirLobo(ator, roll);
  }

  // 2) Com pavor: depois de ver os próprios dados, o jogador é obrigado a rolar o
  //    dado de pavor, antes da soma e do resultado. Ele rola em 3D com aparência
  //    sombria e anula os resultados menores.
  if (pavor && !pavorAbracado) {
    await pedirDadoDePavor(roll, ator, pavor);
    const rollPavor = await new Roll(`1${pavor}`).evaluate();
    vestirDadoDePavor(rollPavor);
    await mostrarDados3D(rollPavor, { ocultoDoMestre });
    roll.definirPavor(pavor, rollPavor.total);
  }

  // 3) Rolou mais do que soma: o jogador escolhe quais contam (já sem os anulados).
  if (roll.precisaSelecao) roll.aplicarSelecao(await SelecaoDados.abrir(roll, ator));

  // `semCard`: quem chamou publica o próprio card com os dados dentro (Examinar,
  // solicitação do mestre). A animação já aconteceu; o card não repete.
  if (!semCard) await enviarParaChat(roll, ator, { pularDados3D: true, ocultoDoMestre });

  // Ajuda é para UMA rolagem: usada, acabou (spec §4.7 — custa a ação do aliado
  // para aquele teste, não é um efeito com duração).
  if (base.ajuda) await consumirAjuda(ator);

  // Vencendo o pavor: tirou 1 no dado de pavor, o medo termina.
  if (roll.resultado.pavor?.resultado === 1) await vencerPavor(ator);

  return roll;
}

/** Configuração sem diálogo: perícia + atributo pareado, DT padrão. */
const sinal = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Motivos dos dados que já chegam mudados ao teste: Caído e as reduções/aumentos
 * temporários no atributo, efeitos do mundo, penalidade de item e passo concedido na
 * perícia; e os dados extras (Ímpeto, Plano Estratégico, defesa, pavor abraçado).
 */
function motivosDosDados(ator, componentes, chavePericia) {
  const M = (chave, dados) => game.i18n.format(`OP2.Motivo.${chave}`, dados);
  const notas = [];
  const atributo = componentes.find((c) => c.tipo === "atributo")?.chave?.split(".")[1];
  const pericia = String(chavePericia ?? "");
  const nomeAtributo = atributo ? game.i18n.localize(`OP2.Atributo.${atributo}`) : "";
  const nomePericia = rotuloDePericia(pericia);
  const s = ator.system;
  if (ator.type === "personagem") {
    if (atributo === "fisico" && ator.statuses?.has?.("caido")) notas.push(M("Caido", { atributo: nomeAtributo }));
    const red = atributo ? s.estado?.reducoesTemporarias?.[atributo] : 0;
    if (red) notas.push(M("FalhaCritica", { passos: red, atributo: nomeAtributo }));
    const aum = atributo ? s.estado?.aumentosTemporarios?.[atributo] : 0;
    if (aum) notas.push(M("Aumento", { passos: aum, atributo: nomeAtributo }));
    for (const item of ator.items ?? []) {
      const p = item.type === "equipamento" && item.system.equipado ? item.system.penalidade : null;
      if (p?.passos && p.pericia === pericia) notas.push(M("Item", { item: item.name, passos: p.passos, pericia: nomePericia }));
    }
    const concedido = s.pericias?.[pericia]?.stepMod;
    if (concedido) notas.push(M("Concedido", { passos: sinal(concedido), pericia: nomePericia }));
    for (const ef of efeitosComPasso(ator)) {
      const alvo = ef.passos.alvo;
      if (alvo === "todos" || alvo === atributo || alvo === pericia) {
        notas.push(M("Efeito", { efeito: ef.nome, passos: sinal(ef.passos.valor), alvo: alvo === "todos" ? M("Todos") : (alvo === atributo ? nomeAtributo : nomePericia) }));
      }
    }
  }
  const EXTRAS = { impeto: "Impeto", defesa: "Defesa", pavorAbracado: "PavorAbracado" };
  for (const c of componentes) {
    if (c.tipo !== "extra") continue;
    const chave = String(c.chave ?? "");
    if (EXTRAS[chave]) notas.push(M(EXTRAS[chave], { dado: c.dado }));
    else if (chave.startsWith("plano.")) notas.push(M("Plano", { dado: c.dado }));
  }
  return notas.map((texto) => ({ tipo: "texto", texto }));
}

/** Efeitos do mundo ativos no ator que mexem em passo. */
function efeitosComPasso(ator) {
  const lista = [];
  for (const id of ator.statuses ?? []) {
    const d = definicaoDoEfeito(id);
    if (d?.passos?.valor && d.passos.alvo) lista.push(d);
  }
  return lista;
}

/** Nota do passo que veio da ajuda: "Mentoria de X" quando quem ajudou tem Mentoria. */
function notaDaAjuda(ajuda) {
  const ajudante = game.actors?.find((a) => a.type === "personagem" && a.name === ajuda.de);
  const mentoria = ajudante?.items?.find((i) => i.type === "habilidade" && i.system.automacao === "mentoria");
  return { tipo: "ajuda", de: ajuda.de, passos: ajuda.passos, mentoria: mentoria?.name ?? "" };
}

/** Instinto de Sobrevivência ligado agora (metade ou menos dos PV), ou null. */
function instintoAtivo(ator) {
  const pv = ator.system?.recursos?.pv;
  if (!pv || (pv.value ?? 0) > (pv.max ?? 0) / 2) return null;
  return ator.items?.find((i) => i.type === "habilidade" && i.system.automacao === "instinto") ?? null;
}

function configuracaoRapida(ator, base) {
  // Sem diálogo, a ajuda pendente precisa entrar aqui — senão o modo rápido
  // (macros, cards, testes) ignoraria silenciosamente o passo do aliado.
  const instinto = instintoAtivo(ator);
  const passosDaAjuda = (tipo) => (base.ajuda && base.ajuda.alvo === tipo ? base.ajuda.passos : 0) + (base.passos?.[tipo] ?? 0)
    + (tipo === "pericia" && instinto ? instinto.system.efeito?.passos ?? 1 : 0);

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

export async function mostrarDados3D(roll, { ocultoDoMestre = false } = {}) {
  if (!game.dice3d) return;
  try {
    // Furtividade: os dados de esconderijo só aparecem para os jogadores.
    if (ocultoDoMestre) {
      const jogadores = game.users.filter((u) => u.active && !u.isGM).map((u) => u.id);
      return void await game.dice3d.showForRoll(roll, game.user, true, jogadores);
    }
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
/** "Rhiona gastou 2 pontos de análise para transformar um (3) em um (5)." */
function notasDeAjuste(ajustes = []) {
  const L = (chave, dados) => game.i18n.format(`OP2.Poder.${chave}`, dados);
  return ajustes.map((a) => {
    if (a.tipo === "mentoria") return L("MentoriaNota", { nome: a.nome, de: a.de, para: a.para });
    if (a.tipo === "mentoriaRecusada") return L("MentoriaRecusada", { nome: a.nome, valor: a.valor });
    if (a.tipo === "instinto") return L("InstintoNota", { habilidade: a.habilidade });
    if (a.tipo === "reducao") return L("ReducaoNota", { motivo: a.motivo, passos: a.passos });
    if (a.tipo === "texto") return a.texto;
    if (a.tipo === "ajuda") return a.mentoria
      ? L("AjudaNotaMentoria", { mentoria: a.mentoria, nome: a.de, passos: a.passos })
      : L("AjudaNota", { nome: a.de, passos: a.passos });
    const pontos = L(a.gastos === 1 ? "AnalisePonto" : "AnalisePontos", { n: a.gastos });
    if (a.mudancas.length === 1) return L("AnaliseNota", { nome: a.nome, pontos, de: a.mudancas[0].de, para: a.mudancas[0].para });
    const lista = a.mudancas.map((m) => `(${m.de}) → (${m.para})`).join(", ");
    return L("AnaliseNotaVarios", { nome: a.nome, pontos, lista });
  });
}

/**
 * Base do dano de um teste de ataque: RA (ou RB). No crítico com o dado extra já
 * rolado, as DUAS rolagens mais altas entre os dados do teste e o extra.
 */
export function danoBaseDoRoll(roll, base = "ra") {
  const extra = roll.options?.bonusCritico?.valor;
  if (extra) {
    return duasMaiores(roll).reduce((t, v) => t + v, 0);
  }
  return base === "rb" ? roll.resultado?.rb ?? roll.rb : roll.resultado?.ra ?? roll.ra;
}

/** As duas rolagens mais altas do crítico (dados contados + o dado extra). */
export function duasMaiores(roll) {
  const extra = roll.options?.bonusCritico?.valor ?? 0;
  return (roll.dados ?? []).filter((d) => d.contado !== false && !d.pavor && !d.consumido).map((d) => d.resultado)
    .concat(extra).sort((x, y) => y - x).slice(0, 2);
}

export function htmlDoTeste(roll, ator) {
  const resultado = roll.resultado;
  // Teste de ataque (Luta/Pontaria): oferece o dano com o modificador da arma equipada.
  const ehAtaque = ["luta", "pontaria"].includes(roll.options.chavePericia);
  // Criatura: o dano vem do próprio ataque ("RA+1", "RB+2").
  const danoCriatura = roll.options.danoCriatura ?? null;
  const armaItem = ehAtaque && !roll.options.semArma ? melhorArma(ator) : null;
  const arma = danoCriatura
    ? { name: danoCriatura.nome, system: { danoBonus: danoCriatura.bonus } }
    : armaItem;
  // Dado extra do crítico (botão no card): soma no total e no dano da arma.
  const bonusCritico = roll.options.bonusCritico ?? null;
  const extra = bonusCritico?.valor ?? 0;
  // Dano no crítico: as DUAS rolagens mais altas entre os dados do teste e o dado
  // extra (+ arma). O extra só entra se for maior que um dos dois — nunca troca uma
  // rolagem alta por uma menor (achado em uso real: 6, 6 e extra 5 dava 6+5).
  const baseDano = danoBaseDoRoll(roll, danoCriatura?.base === "rb" ? "rb" : "ra");
  return renderizar("systems/ordem-paranormal-2e/templates/chat/teste.hbs", {
    rotulo: roll.options.rotulo,
    componentes: roll.dados,
    ...resultado,
    total: resultado.total + extra,
    bonusCritico,
    notasAjuste: notasDeAjuste(roll.options.ajustes),
    arma: arma ? { nome: arma.name, bonus: arma.system.danoBonus, base: baseDano, dano: baseDano + arma.system.danoBonus } : null,
    atorId: ator.id,
    ehGM: game.user.isGM,
    // "Sempre que falha em um teste, você preenche um espaço" (ficha do Ato I).
    podePreencherImpeto: !resultado.sucesso && podePreencherImpeto(ator),
  });
}

export async function enviarParaChat(roll, ator, { pularDados3D = false, ocultoDoMestre = false } = {}) {
  const conteudo = await htmlDoTeste(roll, ator);

  return roll.toMessage(
    {
      speaker: ChatMessage.getSpeaker({ actor: ator }),
      content: conteudo,
      flags: {
        [SYSTEM_ID]: { tipo: "teste", atorId: ator.id, desfecho: roll.desfecho, ...(ocultoDoMestre ? { ocultoDoMestre: true } : {}) },
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
