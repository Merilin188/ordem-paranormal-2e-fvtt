/**
 * Ações de desafio de acesso físico (spec §7.2–§7.5).
 *
 * Arrombar cobra 1 PV por tentativa e grava a pontuação direto no Item — como
 * Investigar grava revelação sem confirmação extra, a atualização do contador não é
 * uma decisão de mesa. Alcançar não guarda estado: dano de queda vai pro card com
 * botão, nunca automático. Sustentar liga uma flag no ator; o desgaste por rodada
 * é aplicado por `avancarRodada()` (module/cena/rodada.mjs). Hackear automatiza só
 * o teste e o gate de rodada — o problema matemático (técnico) e conferir as
 * respostas (social) exigem input humano, a spec é explícita sobre isso
 * (docs/LACUNAS.md).
 */
import { SYSTEM_ID, CUSTO_PV_ARROMBAR, CUSTO_PV_SUSTENTAR, BONUS_DT_ALCANCAR_ARRISCADO } from "../config.mjs";
import {
  acumularArrombar, arrombou, excedeuTentativas, danoDeAlcancar, avaliarPalpite, venceuDestrancar,
  podeTentarHackNestaRodada, chancesDeErroHackSocial, linhaDaTabelaDeHack,
  tentativasPorRodadaDeDestrancar, tentativasDeDestrancarNaRodada, facesDasPosicoes,
} from "./desafios.mjs";
import { rolarTeste, renderizar, enviarParaChat, rotuloDePericia } from "../dice/teste.mjs";
import { enviarCardAoMestre } from "../ui/card-mestre.mjs";
import { aplicarDano } from "../dice/falha-critica.mjs";
import { stepDie } from "../dice/escada.mjs";
import { iconeDado } from "../ui/dice-icons.mjs";
import { OP2Roll } from "../dice/op2-roll.mjs";
import { lerConfig } from "../settings/register.mjs";
import { rodadaAtual } from "./rodada.mjs";
import { comoMestre, registrarAcaoDeMestre, paraTodos, registrarAcaoDeTodos, responsavelPor } from "../ui/socket.mjs";
import { registrarAcaoDeChat } from "../ui/chat.mjs";

const CHAT = "systems/ordem-paranormal-2e/templates/chat";

/**
 * O obstáculo é documento de mundo: o teste é do personagem, mas gravar o
 * resultado nele é escrita que o jogador não tem permissão de fazer (achado em
 * uso real: rolava e estourava "lacks permission to update Item"). O mestre
 * grava por ele.
 */
registrarAcaoDeMestre("atualizarDesafio", async ({ uuid, dados }) => {
  const desafio = await fromUuid(uuid);
  if (desafio?.type === "desafio-acesso") await desafio.update(dados);
});

function gravarNoDesafio(desafio, dados) {
  return comoMestre("atualizarDesafio", { uuid: desafio.uuid, dados });
}

/**
 * Quem está tentando o desafio: ao ser vencido, o card dos itens guardados vai para
 * esse personagem (e o "Transferir" já o sugere).
 */
export async function marcarQuemTenta(desafio, ator) {
  if (!desafio || !ator || desafio.getFlag(SYSTEM_ID, "ultimoAtorId") === ator.id) return;
  await gravarNoDesafio(desafio, { [`flags.${SYSTEM_ID}.ultimoAtorId`]: ator.id });
}

/**
 * Rodada que conta para o teto de tentativas: a do desafio iniciado pelo mestre
 * (ferramentas do mestre), senão a da investigação ativa.
 */
export function rodadaDoDesafio(desafio) {
  const sessao = desafio?.getFlag?.(SYSTEM_ID, "sessao");
  return sessao?.ativa ? sessao.rodada : rodadaAtual();
}

/** @returns {Promise<Item|null>} */
export async function carregarDesafio(desafioUuid) {
  const desafio = await fromUuid(desafioUuid);
  if (desafio?.type !== "desafio-acesso") {
    ui.notifications.warn(game.i18n.localize("OP2.Aviso.DesafioAusente"));
    return null;
  }
  return desafio;
}

function sussurroPara(ator) {
  return game.users
    .filter((u) => u.isGM || ator.testUserPermission(u, "OWNER"))
    .map((u) => u.id);
}

async function enviarCard(ator, template, contexto, { whisper } = {}) {
  const conteudo = await renderizar(`${CHAT}/${template}.hbs`, contexto);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    content: conteudo,
    whisper,
    flags: { [SYSTEM_ID]: { tipo: "desafio", atorId: ator.id } },
  });
}

/**
 * ARROMBAR (spec §7.2): 1 PV por tentativa, Atletismo vs DT do objeto. Sucesso
 * acumula RA na pontuação; ao atingir a PA, arromba. Excedeu o teto de
 * tentativas sem arrombar? Fica quebrado — só resta achar a chave.
 * @returns {Promise<{roll: OP2Roll, desafio: Item, arrombou: boolean, quebrado: boolean}|null>}
 */
export async function arrombar(ator, desafioUuid, { rapido = false } = {}) {
  const desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;
  await marcarQuemTenta(desafio, ator);
  if (desafio.system.quebrado) {
    ui.notifications.warn(game.i18n.localize("OP2.Desafio.JaQuebrado"));
    return null;
  }

  const roll = await rolarTeste(ator, {
    chavePericia: "atletismo",
    dt: desafio.system.dtObjeto,
    rapido,
    // Um card só, com os dados dentro: o card genérico de teste ainda oferecia
    // "Dano RA/RB", que não existe aqui, e o de Arrombar vinha depois sem os dados
    // (achado em uso real: "as lógicas de desafio estão estranhas").
    semCard: true,
    contexto: `${game.i18n.localize("OP2.Desafio.Arrombar")} — ${desafio.name}`,
  });
  if (!roll) return null;

  // Custa 1 PV por tentativa — só depois de o teste rodar de fato, nunca por um
  // diálogo cancelado (spec §7.2).
  await aplicarDano(ator, CUSTO_PV_ARROMBAR, "pv");

  const tentativasUsadas = desafio.system.tentativasUsadas + 1;
  const pontuacaoAtual = roll.sucesso
    ? acumularArrombar(desafio.system, roll.ra)
    : desafio.system.pontuacaoAtual;
  const estadoAtualizado = { ...desafio.system, pontuacaoAtual, tentativasUsadas };

  const conseguiu = arrombou(estadoAtualizado);
  const quebrado = !conseguiu && excedeuTentativas(estadoAtualizado);

  await gravarNoDesafio(desafio, {
    "system.pontuacaoAtual": pontuacaoAtual,
    "system.tentativasUsadas": tentativasUsadas,
    "system.quebrado": quebrado,
  });

  await enviarCard(ator, "arrombar", {
    titulo: game.i18n.localize("OP2.Desafio.Arrombar"),
    ocultarProgresso: desafio.system.ocultarProgresso,
    ocultarTentativas: desafio.system.ocultarTentativas,
    desafioNome: desafio.name,
    atorId: ator.id,
    componentes: roll.dados,
    total: roll.total,
    ra: roll.ra,
    critico: roll.critico,
    falhaCritica: roll.falhaCritica,
    dt: desafio.system.dtObjeto,
    custoPv: CUSTO_PV_ARROMBAR,
    sucesso: roll.sucesso,
    conseguiu,
    quebrado,
    pontuacaoAtual,
    pontuacaoAlvo: desafio.system.pontuacaoAlvo,
    tentativasUsadas,
    maxTentativas: desafio.system.maxTentativas,
  }, { whisper: sussurroPara(ator) });

  return { roll, desafio, arrombou: conseguiu, quebrado };
}

/**
 * ALCANÇAR (spec §7.4): pede a DT do ambiente e resolve o modo escolhido.
 * Seguro: duas ações de Acrobacia em sequência imediata (LACUNAS: o playtest não
 * detalha o que pode acontecer entre elas); falhar qualquer uma aplica RB e
 * recomeça — a M1 já resolve as duas na mesma chamada, então "recomeçar" só
 * importa para saber que a segunda ação não roda. Arriscado: uma ação, DT+3,
 * falha aplica RA.
 * @param {"seguro"|"arriscado"} modo
 * @returns {Promise<{modo: string, sucesso: boolean, dano: number|null}|null>}
 */
export async function alcancar(ator, { modo, dt, rapido = false, desafio = null } = {}) {
  if (dt === undefined || dt === null) {
    dt = await pedirDtAmbiente();
    if (dt === null) return null;
  }

  const contexto = `${game.i18n.localize("OP2.Desafio.Alcancar")} — ${game.i18n.localize(`OP2.Desafio.Modo.${modo}`)}`;

  if (modo === "arriscado") {
    const roll = await rolarTeste(ator, { chavePericia: "acrobacia", dt: dt + BONUS_DT_ALCANCAR_ARRISCADO, rapido, contexto });
    if (!roll) return null;
    return publicarAlcancar(ator, modo, [roll], roll.sucesso, desafio);
  }

  // Seguro: duas ações em sequência imediata; a segunda só roda se a primeira passar.
  const primeira = await rolarTeste(ator, { chavePericia: "acrobacia", dt, rapido, contexto: `${contexto} (1/2)` });
  if (!primeira) return null;
  if (!primeira.sucesso) return publicarAlcancar(ator, modo, [primeira], false, desafio);

  const segunda = await rolarTeste(ator, { chavePericia: "acrobacia", dt, rapido, contexto: `${contexto} (2/2)` });
  if (!segunda) return null;
  return publicarAlcancar(ator, modo, [primeira, segunda], segunda.sucesso, desafio);
}

/**
 * Alcançar um obstáculo (abordagem do desafio): o jogador escolhe o modo, com a
 * regra de cada um à vista, e a DT é a do desafio. Alcançou: o desafio é vencido.
 */
export async function alcancarDesafio(ator, desafioUuid, { rapido = false } = {}) {
  const desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;
  await marcarQuemTenta(desafio, ator);
  const dt = desafio.system.alcancar?.dt ?? 7;
  const modo = await foundry.applications.api.DialogV2.wait({
    window: { title: `${game.i18n.localize("OP2.Desafio.Alcancar")} — ${desafio.name}`, icon: "fa-solid fa-person-walking" },
    classes: ["op2", "op2-dlg", "op2-defesa-janela"],
    content: `<p class="op2-ajuda">${game.i18n.localize("OP2.Desafio.AlcancarEscolha")}</p>`,
    buttons: [
      {
        action: "seguro", icon: "fa-solid fa-person-walking", default: true,
        label: game.i18n.format("OP2.Desafio.AlcancarSeguroRegra", { dt }),
      },
      {
        action: "arriscado", icon: "fa-solid fa-person-running",
        label: game.i18n.format("OP2.Desafio.AlcancarArriscadoRegra", { dt: dt + BONUS_DT_ALCANCAR_ARRISCADO }),
      },
    ],
    rejectClose: false,
  });
  if (!["seguro", "arriscado"].includes(modo)) return null;
  return alcancar(ator, { modo, dt, rapido, desafio });
}

async function pedirDtAmbiente() {
  const dt = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("OP2.Desafio.Alcancar") },
    content: `
      <div class="form-group">
        <label>${game.i18n.localize("OP2.Desafio.DtAmbiente")}</label>
        <input type="number" name="dt" value="7" min="0">
      </div>`,
    ok: { callback: (_evento, botao) => Number(botao.form.elements.dt.value) },
    rejectClose: false,
  });
  return dt ?? null;
}

// Nunca aplica dano sozinho — o botão do card reaproveita a ação genérica
// "aplicar-dano" (já registrada em ui/chat.mjs), do mesmo jeito que o card de
// teste comum oferece "Dano RA"/"Dano RB" (spec: nada se aplica sem clique).
async function publicarAlcancar(ator, modo, rolls, sucesso, desafio = null) {
  const ultima = rolls.at(-1);
  const dano = sucesso ? null : danoDeAlcancar(modo, ultima.resultado);
  // Alcançou o obstáculo de um desafio: vencido (e o ponto trancado, se houver, abre).
  if (sucesso && desafio && !desafio.system.alcancar?.resolvido) {
    await gravarNoDesafio(desafio, { "system.alcancar.resolvido": true });
  }

  await enviarCard(ator, "alcancar", {
    titulo: desafio
      ? `${game.i18n.localize("OP2.Desafio.Alcancar")} — ${desafio.name}`
      : game.i18n.localize("OP2.Desafio.Alcancar"),
    modo: game.i18n.localize(`OP2.Desafio.Modo.${modo}`),
    sucesso,
    dano,
    atorId: ator.id,
  }, { whisper: sussurroPara(ator) });

  return { modo, sucesso, dano };
}

/**
 * SUSTENTAR (spec §7.5): 1 PV + teste de Atletismo inicial. Liga `estado.sustentando`
 * no ator; o desgaste de cada rodada é aplicado por `avancarRodada()`. O "efeito
 * final" (o que se solta ao falhar) não é modelado — descrição textual, mesa resolve.
 */
export async function sustentar(ator, { rapido = false, desafioUuid = null } = {}) {
  // Já segurando algo: pergunta se solta para fazer a nova ação (antes só barrava,
  // e quem tirou sucesso ficava preso — achado em uso real).
  const atual = ator.system.estado.sustentando;
  if (atual?.ativo) {
    const soltar = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("OP2.Desafio.Sustentar") },
      content: `<p>${game.i18n.format("OP2.Desafio.SoltarParaContinuar", { nome: foundry.utils.escapeHTML(atual.nome || game.i18n.localize("OP2.Desafio.Algo")) })}</p>`,
      rejectClose: false,
    });
    if (!soltar) return null;
    await pararDeSustentar(ator);
  }

  // Sustentar um obstáculo concreto (a estante-porta do Ato I) usa a DT dele; solto,
  // é a DT padrão da mesa.
  const desafio = desafioUuid ? await carregarDesafio(desafioUuid) : null;
  if (desafio) await marcarQuemTenta(desafio, ator);
  const contexto = desafio
    ? `${game.i18n.localize("OP2.Desafio.Sustentar")} — ${desafio.name}`
    : game.i18n.localize("OP2.Desafio.Sustentar");

  const roll = await rolarTeste(ator, {
    chavePericia: "atletismo", rapido, contexto,
    ...(desafio ? { dt: desafio.system.sustentar.dt } : {}),
  });
  if (!roll) return null;

  // Custo inicial de 1 PV — só depois de o teste rodar, nunca por um diálogo
  // cancelado (spec §7.5).
  await aplicarDano(ator, CUSTO_PV_SUSTENTAR, "pv");

  if (!roll.sucesso) {
    await enviarCard(ator, "acao-cena", {
      titulo: contexto,
      texto: [game.i18n.format("OP2.Desafio.SustentarFalhouInicio", { ator: ator.name }),
        desafio?.system.sustentar.aoFalhar].filter(Boolean).join(" "),
      atorId: ator.id,
    });
    return { roll, sustentando: false };
  }

  await ator.update({ "system.estado.sustentando": {
    ativo: true, fadiga: 0, desafioUuid: desafio?.uuid ?? "", nome: desafio?.name ?? "",
  } });
  await enviarCard(ator, "acao-cena", {
    titulo: contexto,
    texto: [
      roll.critico ? game.i18n.localize("OP2.Critico") + "!" : "",
      game.i18n.format("OP2.Desafio.SustentarSucesso", { ator: ator.name }),
      game.i18n.localize("OP2.Desafio.SustentarComoContinua"),
    ].filter(Boolean).join(" "),
    atorId: ator.id,
    botaoSoltar: true,
  });
  // Quem sustenta abre caminho: os itens atrás do obstáculo ficam ao alcance de todos.
  if (desafio?.system.itens?.length) await comoMestre("op2ItensSustentados", { uuid: desafio.uuid, atorId: ator.id });
  return { roll, sustentando: true };
}

/** Nomes de quem está sustentando este desafio agora. */
export function quemSustenta(uuid) {
  return game.actors.filter((a) => a.type === "personagem" && a.system.estado?.sustentando?.ativo
    && a.system.estado.sustentando.desafioUuid === uuid).map((a) => a.name);
}

/** Para de sustentar por decisão do jogador — sem teste, sem custo. */
export async function pararDeSustentar(ator) {
  const nome = ator.system.estado.sustentando?.nome;
  if (ator.system.estado.sustentando?.ativo) {
    await enviarCard(ator, "acao-cena", {
      titulo: game.i18n.localize("OP2.Desafio.Sustentar"),
      texto: game.i18n.format("OP2.Desafio.SoltouPorVontade", { ator: ator.name, nome: nome || game.i18n.localize("OP2.Desafio.Algo") }),
      atorId: ator.id,
    });
  }
  await ator.update({ "system.estado.sustentando": { ativo: false, fadiga: 0, desafioUuid: "", nome: "" } });
}

/**
 * Fadiga de fim de rodada (spec §7.5): quem está sustentando testa Atletismo de novo,
 * com redução de passo cumulativa a cada rodada — o dado de Atletismo desce um passo
 * por rodada sustentada, só para este teste (não é `reducoesTemporarias`: aquilo é o
 * efeito "até o fim da cena" da falha crítica, esta é fadiga própria de sustentar, e
 * as duas não deviam se somar por engano). Falhar solta o que era sustentado — o card
 * avisa, a mesa decide o que isso significa. Chamado por `avancarRodada()`.
 */
/**
 * O teste de fadiga que vem a seguir, explicado: DT, o dado de Atletismo antes e
 * depois da redução e o do atributo. A caixa do jogador e o card leem daqui.
 */
export function previaDaFadiga(ator) {
  const estado = ator.system.estado.sustentando;
  const fadiga = (estado?.fadiga ?? 0) + 1;
  const pericia = ator.system.pericias.atletismo;
  const atributo = ator.system.atributos[pericia.atributo];
  const de = pericia.dadoEfetivo;
  const para = stepDie(de, -fadiga);
  return {
    fadiga, de, para, piso: para === de,
    chaveAtributo: pericia.atributo,
    rotuloPericia: rotuloDePericia("atletismo"),
    rotuloAtributo: game.i18n.localize(`OP2.Atributo.${pericia.atributo}`),
    dadoAtributo: atributo.dadoEfetivo,
    dt: lerConfig("dtPadrao"),
    nome: estado?.nome || game.i18n.localize("OP2.Desafio.Algo"),
  };
}

export async function testarFadigaDeSustentar(ator) {
  const estado = ator.system.estado.sustentando;
  if (!estado?.ativo) return null;

  const previa = previaDaFadiga(ator);
  const { fadiga, de, para } = previa;
  const pericia = ator.system.pericias.atletismo;
  const atributo = ator.system.atributos[pericia.atributo];
  const rotulo = `${game.i18n.localize("OP2.Desafio.Sustentar")} — ${game.i18n.localize("OP2.Desafio.Fadiga")} ${fadiga}`;

  // Regra de ouro: o card diz que o dado desceu, quanto e por quê.
  const nota = game.i18n.format(previa.piso ? "OP2.Motivo.FadigaPiso" : "OP2.Motivo.Fadiga", {
    passos: fadiga, pericia: previa.rotuloPericia, de, para,
  });
  const roll = OP2Roll.paraComponentes([
    { chave: "pericia.atletismo", rotulo: rotuloDePericia("atletismo"), tipo: "pericia", dado: para },
    { chave: `atributo.${pericia.atributo}`, rotulo: game.i18n.localize(`OP2.Atributo.${pericia.atributo}`), tipo: "atributo", dado: atributo.dadoEfetivo },
  ], {
    dt: lerConfig("dtPadrao"), escopoCritico: lerConfig("escopoCritico"), rotulo, atorId: ator.id,
    ajustes: [{ tipo: "texto", texto: nota }],
  });
  await roll.evaluate();
  await enviarParaChat(roll, ator);

  if (!roll.sucesso) {
    await ator.update({ "system.estado.sustentando": { ativo: false, fadiga: 0, desafioUuid: "", nome: "" } });
    await enviarCard(ator, "acao-cena", {
      titulo: game.i18n.localize("OP2.Desafio.Sustentar"),
      texto: game.i18n.format("OP2.Desafio.SustentarSoltou", { ator: ator.name }),
      atorId: ator.id,
    });
    return { roll, continua: false };
  }

  await ator.update({ "system.estado.sustentando.fadiga": fadiga });
  return { roll, continua: true };
}

/**
 * DESTRANCAR — gerar senha (spec §7.1): o mestre rola a senha e mantém oculta.
 * Zera tentativas e histórico anteriores — é uma fechadura nova.
 * @returns {Promise<number[]>} a senha, só para quem gerou (o mestre) ver na hora
 */
export async function gerarSenhaDestrancar(desafioUuid, { tamanho, facesSenha } = {}) {
  const desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;

  const tam = tamanho ?? desafio.system.tamanhoSenha;
  const faces = facesSenha ?? desafio.system.facesSenha;
  const porPosicao = facesDasPosicoes({ ...desafio.system, tamanhoSenha: tam, facesSenha: faces });
  const roll = await new Roll(porPosicao.map((f) => `1d${f}`).join(" + ")).evaluate();
  const senha = roll.dice.map((d) => d.results[0].result);

  await gravarNoDesafio(desafio, {
    "system.tamanhoSenha": tam,
    "system.facesSenha": faces,
    "system.senha": senha,
    "system.destrancarTentativas": 0,
    "system.destrancado": false,
    "system.quebrado": false,
    "system.historicoDestrancar": [],
  });

  return senha;
}

/**
 * DESTRANCAR — tentar (spec §7.1): um palpite por chamada. Resposta posição a
 * posição (exato/alto/baixo), nunca a contagem agregada — o jogador deduz sozinho.
 * Exceder o teto de tentativas quebra a fechadura (mesmo campo `quebrado` de
 * Arrombar: as duas abordagens levam ao mesmo "só resta achar a chave").
 * @returns {Promise<{resultado: string[], venceu: boolean, quebrado: boolean}|null>}
 */
export async function tentarDestrancar(ator, desafioUuid, palpite) {
  let desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;
  await marcarQuemTenta(desafio, ator);
  if (desafio.system.quebrado) {
    ui.notifications.warn(game.i18n.localize("OP2.Desafio.JaQuebrado"));
    return null;
  }
  if (desafio.system.destrancado) {
    ui.notifications.warn(game.i18n.localize("OP2.Desafio.JaDestrancado"));
    return null;
  }
  // A senha nasce sozinha na primeira tentativa: exigir que o mestre fosse na ficha
  // gerar à mão travava a mesa (achado em uso real). O mestre grava na hora; o
  // jogador pede pelo socket e a senha chega em seguida — tenta de novo.
  if (!desafio.system.senha.length) {
    await gerarSenhaDestrancar(desafioUuid);
    desafio = await carregarDesafio(desafioUuid);
    if (!desafio?.system.senha.length) {
      ui.notifications.info(game.i18n.localize("OP2.Desafio.DestrancarGerando"));
      return null;
    }
  }

  // Teto por rodada pelo dado de Crime (spec §7.1): d4 = 1 … d12 = 5. O histórico do
  // desafio guarda quem tentou em que rodada, então a contagem é ele mesmo.
  const rodada = rodadaDoDesafio(desafio);
  const dadoCrime = ator?.system?.pericias?.crime?.dadoEfetivo ?? "d4";
  const tetoRodada = tentativasPorRodadaDeDestrancar(dadoCrime);
  const naRodada = tentativasDeDestrancarNaRodada(desafio.system.historicoDestrancar, ator?.id, rodada);
  if (naRodada >= tetoRodada) {
    ui.notifications.warn(game.i18n.format("OP2.Desafio.DestrancarTetoRodada", {
      teto: tetoRodada, dado: dadoCrime,
    }));
    return null;
  }

  const resultado = avaliarPalpite(desafio.system.senha, palpite);
  const venceu = venceuDestrancar(resultado);
  const destrancarTentativas = desafio.system.destrancarTentativas + 1;
  const quebrado = !venceu && excedeuTentativas({
    maxTentativas: desafio.system.maxTentativas, tentativasUsadas: destrancarTentativas,
  });
  const historicoDestrancar = [...desafio.system.historicoDestrancar,
    { palpite, resultado, atorId: ator?.id ?? "", rodada }];

  await gravarNoDesafio(desafio, {
    "system.destrancarTentativas": destrancarTentativas,
    "system.destrancado": venceu,
    "system.quebrado": quebrado,
    "system.historicoDestrancar": historicoDestrancar,
  });

  // O card mostra o palpite posição a posição com a resposta (exato/alto/baixo):
  // "tentativa registrada, veja o histórico" não dizia nada (achado em uso real).
  // A senha NÃO vai no card: ele nasce no cliente do jogador. O mestre a vê no app.
  await enviarCard(ator, "destrancar", {
    titulo: game.i18n.localize("OP2.Desafio.Destrancar"),
    ocultarTentativas: desafio.system.ocultarTentativas,
    desafioNome: desafio.name,
    venceu,
    quebrado,
    posicoes: posicoesDoPalpite(palpite, resultado),
    tentativas: destrancarTentativas,
    maxTentativas: desafio.system.maxTentativas,
    naRodada: naRodada + 1,
    tetoRodada,
    dadoCrime,
  }, { whisper: sussurroPara(ator) });

  return { resultado, venceu, quebrado, naRodada: naRodada + 1, tetoRodada };
}

/**
 * HACK TÉCNICO (spec §7.3): Tecnologia vs DT do objeto. Sem curva automática pro
 * problema matemático em si (docs/LACUNAS.md) — o card mostra o resultado (quanto
 * maior, mais fácil deveria ser o problema que o mestre escolhe) e um timer visual
 * de 10s fica disponível na ficha do desafio para o mestre iniciar. Falha só libera
 * nova tentativa na rodada seguinte.
 * @returns {Promise<{roll: OP2Roll, sucesso: boolean}|null>}
 */
/** Cada posição do palpite com a resposta, para o card e para o histórico do app. */
export function posicoesDoPalpite(palpite, resultado) {
  const icones = { exato: "fa-check", alto: "fa-arrow-down", baixo: "fa-arrow-up" };
  return resultado.map((valor, i) => ({
    valor,
    palpite: palpite[i],
    icone: icones[valor],
    rotulo: game.i18n.localize(`OP2.Desafio.DestrancarResultado.${valor}`),
  }));
}

export async function hackTecnico(ator, desafioUuid, { rapido = false } = {}) {
  const desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;
  await marcarQuemTenta(desafio, ator);
  if (desafio.system.hackTecnico.resolvido) {
    ui.notifications.warn(game.i18n.localize("OP2.Desafio.HackJaResolvido"));
    return null;
  }
  const rodada = rodadaAtual();
  if (!podeTentarHackNestaRodada(desafio.system.hackTecnico.ultimaTentativaRodada, rodada)) {
    ui.notifications.warn(game.i18n.localize("OP2.Desafio.HackEsperaRodada"));
    return null;
  }

  const roll = await rolarTeste(ator, {
    chavePericia: "tecnologia",
    dt: desafio.system.dtObjeto,
    rapido,
    // Um card só, sussurrado, com os dados dentro: o card genérico saía PÚBLICO —
    // a mesa inteira via a rolagem do hack — e ainda oferecia "Dano RA/RB", que não
    // existe aqui (achado em uso real).
    semCard: true,
    contexto: `${game.i18n.localize("OP2.Desafio.HackTecnico")} — ${desafio.name}`,
  });
  if (!roll) return null;

  // Painel com tabela (o do Ato I) não abre pelo teste: o total escolhe a faixa, e a
  // faixa entrega o problema. Quem resolve é o jogador, na mesa — então o desafio só
  // fica resolvido quando o mestre marca (mesmo caminho do hack social).
  const linha = linhaDaTabelaDeHack(desafio.system.hackTecnico.tabela, roll.total);
  const temTabela = desafio.system.hackTecnico.tabela.length > 0;

  await gravarNoDesafio(desafio, {
    "system.hackTecnico.ultimaTentativaRodada": rodada,
    "system.hackTecnico.resolvido": temTabela ? false : roll.sucesso,
  });

  const sucesso = temTabela ? Boolean(linha) : roll.sucesso;
  const cartao = {
    titulo: game.i18n.localize("OP2.Desafio.HackTecnico"),
    desafioNome: desafio.name,
    atorId: ator.id,
    dt: desafio.system.dtObjeto,
    componentes: roll.dados,
    total: roll.total,
    critico: roll.critico,
    falhaCritica: roll.falhaCritica,
    desafioUuid: desafio.uuid,
    sucesso,
    tecnico: true,
    comTabela: temTabela,
    // Sem faixa alcançada o painel não devolveu nada — nem por isso o hack falhou de
    // vez: dá para tentar de novo na rodada seguinte.
    semResposta: temTabela && !linha,
  };
  // Com tabela, o jogador não recebe veredito nem a conta: o mestre prepara a mesa,
  // revela o problema e inicia o contador (`timer-hack.mjs`). Antes o card do jogador
  // já vinha com "sucesso" e a conta com a resposta (achado em uso real).
  await enviarCard(ator, "hackear", { ...cartao, aguardaMestre: temTabela && Boolean(linha) }, { whisper: sussurroPara(ator) });
  if (sucesso) {
    await enviarCardAoMestre(ator, "hackear", {
      ...cartao,
      soMestre: true,
      faixa: linha?.rolagem ?? "",
      problema: linha?.desafio ?? "",
      segundos: linha?.segundos > 0 ? linha.segundos : 10,
      indiceFaixa: linha ? desafio.system.hackTecnico.tabela.indexOf(linha) : -1,
    }, { tipo: "desafio" });
  }

  return { roll, sucesso, linha };
}

/** O painel abriu: quem confere a resposta do jogador é o mestre (spec §7.3). */
export async function marcarHackTecnicoResolvido(desafioUuid) {
  const desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;
  await gravarNoDesafio(desafio, { "system.hackTecnico.resolvido": true });
}

/**
 * HACK SOCIAL (spec §7.3): Intuição vs DT do objeto. Sucesso revela o banco de
 * perguntas (mestre-only) e quantas "chances de errar" o excedente sobre a DT
 * concede (`chancesDeErroHackSocial`) — contar acertos/erros contra
 * `respostasNecessarias` é julgamento de mesa (comparar resposta falada com o
 * gabarito não é string match), por isso `marcarHackSocialResolvido` é manual.
 * @returns {Promise<{roll: OP2Roll, sucesso: boolean, chancesDeErro: number}|null>}
 */
export async function hackSocial(ator, desafioUuid, { rapido = false } = {}) {
  const desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;
  await marcarQuemTenta(desafio, ator);
  if (desafio.system.hackSocial.resolvido) {
    ui.notifications.warn(game.i18n.localize("OP2.Desafio.HackJaResolvido"));
    return null;
  }
  const rodada = rodadaAtual();
  if (!podeTentarHackNestaRodada(desafio.system.hackSocial.ultimaTentativaRodada, rodada)) {
    ui.notifications.warn(game.i18n.localize("OP2.Desafio.HackEsperaRodada"));
    return null;
  }

  const roll = await rolarTeste(ator, {
    chavePericia: "intuicao",
    dt: desafio.system.dtObjeto,
    rapido,
    semCard: true,
    contexto: `${game.i18n.localize("OP2.Desafio.HackSocial")} — ${desafio.name}`,
  });
  if (!roll) return null;

  const chancesDeErro = roll.sucesso ? chancesDeErroHackSocial(roll.total, desafio.system.dtObjeto) : 0;

  await gravarNoDesafio(desafio, { "system.hackSocial.ultimaTentativaRodada": rodada });

  const cartao = {
    titulo: game.i18n.localize("OP2.Desafio.HackSocial"),
    desafioNome: desafio.name,
    atorId: ator.id,
    dt: desafio.system.dtObjeto,
    componentes: roll.dados,
    total: roll.total,
    critico: roll.critico,
    falhaCritica: roll.falhaCritica,
    desafioUuid: desafio.uuid,
    sucesso: roll.sucesso,
    social: true,
  };
  await enviarCard(ator, "hackear", cartao, { whisper: sussurroPara(ator) });
  // Perguntas, respostas e o botão de marcar são bastidor: nascem no cliente do
  // mestre — num card do jogador, ele veria as respostas (achado em uso real).
  if (roll.sucesso) {
    await enviarCardAoMestre(ator, "hackear", {
      ...cartao,
      soMestre: true,
      chancesDeErro,
      respostasNecessarias: desafio.system.hackSocial.respostasNecessarias,
      perguntas: desafio.system.hackSocial.perguntas,
    }, { tipo: "desafio" });
  }

  return { roll, sucesso: roll.sucesso, chancesDeErro };
}

/**
 * O mestre marca o hack social como resolvido depois de conferir as respostas na
 * mesa — não dá pra automatizar comparar o que o jogador falou com o gabarito.
 */
export async function marcarHackSocialResolvido(desafioUuid) {
  const desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;
  await gravarNoDesafio(desafio, { "system.hackSocial.resolvido": true });
}

/**
 * DESAFIO GENÉRICO — a escapatória para o que o playtest não nomeia: uma tábua
 * pregada, um portão enferrujado, uma janela alta. O mestre escolhe a perícia e o
 * rótulo na ficha; aqui é só um teste contra a DT do objeto, e o sucesso resolve.
 * Sem gate de rodada: quem inventa o obstáculo decide se cabe tentar de novo.
 * @returns {Promise<{roll: OP2Roll, sucesso: boolean}|null>}
 */
export async function desafioGenerico(ator, desafioUuid, { rapido = false } = {}) {
  const desafio = await carregarDesafio(desafioUuid);
  if (!desafio) return null;
  await marcarQuemTenta(desafio, ator);
  if (desafio.system.generico.resolvido) {
    ui.notifications.warn(game.i18n.localize("OP2.Desafio.GenericoJaResolvido"));
    return null;
  }

  const rotulo = desafio.system.generico.rotulo?.trim()
    || game.i18n.localize("OP2.Desafio.Generico");

  const roll = await rolarTeste(ator, {
    chavePericia: desafio.system.generico.pericia,
    dt: desafio.system.dtObjeto,
    rapido,
    semCard: true,
    contexto: `${rotulo} — ${desafio.name}`,
  });
  if (!roll) return null;

  if (roll.sucesso) await gravarNoDesafio(desafio, { "system.generico.resolvido": true });

  await enviarCard(ator, "hackear", {
    titulo: rotulo,
    desafioNome: desafio.name,
    atorId: ator.id,
    dt: desafio.system.dtObjeto,
    componentes: roll.dados,
    total: roll.total,
    critico: roll.critico,
    falhaCritica: roll.falhaCritica,
    sucesso: roll.sucesso,
  }, { whisper: sussurroPara(ator) });

  return { roll, sucesso: roll.sucesso };
}

/** "Soltar" no card de sustentar: só quem controla o personagem. Chamado no init. */
const fadigasAbertas = new Set();

/**
 * A caixa do fim da rodada para quem está sustentando: a DT, os dados que vai rolar
 * (Atletismo já reduzido pela fadiga, com o porquê) e as duas saídas — continuar
 * (rola o teste) ou soltar. Abre no cliente do dono do personagem.
 */
export async function perguntarFadiga(ator) {
  if (!ator?.system.estado.sustentando?.ativo || fadigasAbertas.has(ator.id)) return null;
  fadigasAbertas.add(ator.id);
  try {
    const p = previaDaFadiga(ator);
    const esc = foundry.utils.escapeHTML;
    const reducao = game.i18n.format(p.piso ? "OP2.Motivo.FadigaPiso" : "OP2.Motivo.Fadiga", {
      passos: p.fadiga, pericia: p.rotuloPericia, de: p.de, para: p.para,
    });
    const escolha = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("OP2.Desafio.FadigaTitulo", { ator: ator.name }), icon: "fa-solid fa-weight-hanging" },
      classes: ["op2", "op2-dlg", "op2-defesa-janela", "op2-fadiga-janela"],
      position: { width: 420 },
      content: `
        <p>${game.i18n.format("OP2.Desafio.FadigaPergunta", { nome: esc(p.nome) })}</p>
        <ul class="op2-fadiga__dados">
          <li><strong>${game.i18n.localize("OP2.DT")}</strong> <span class="op2-fadiga__dt">${p.dt}</span></li>
          <li><strong>${esc(p.rotuloPericia)}</strong> ${iconeDado(p.para, { titulo: p.para })}${p.piso ? ""
            : ` <span class="op2-fadiga__antes" data-tooltip="${esc(game.i18n.format("OP2.Desafio.FadigaAntes", { de: p.de }))}">${iconeDado(p.de, { titulo: p.de })}</span>`}</li>
          <li><strong>${esc(p.rotuloAtributo)}</strong> ${iconeDado(p.dadoAtributo, { titulo: p.dadoAtributo })}</li>
        </ul>
        <p class="op2-ajuda">${esc(reducao)}</p>
        <p class="op2-ajuda">${game.i18n.localize("OP2.Desafio.FadigaFalha")}</p>`,
      buttons: [
        { action: "continuar", icon: "fa-solid fa-dice", default: true, label: game.i18n.format("OP2.Desafio.FadigaContinuar", { de: p.para, atributo: p.dadoAtributo }) },
        { action: "soltar", icon: "fa-solid fa-hand", label: game.i18n.localize("OP2.Desafio.Soltar") },
      ],
      rejectClose: false,
    });
    if (escolha === "continuar") return testarFadigaDeSustentar(ator);
    if (escolha === "soltar") return pararDeSustentar(ator);
    return null;
  } finally {
    fadigasAbertas.delete(ator.id);
  }
}

/**
 * Fim da rodada (mestre): manda a caixa da fadiga para quem responde pelo
 * personagem — o jogador dono, ou o próprio mestre se ninguém estiver on-line.
 */
export function pedirTesteDeFadiga(ator) {
  const quem = responsavelPor(ator);
  if (!quem || quem.id === game.user.id) return void perguntarFadiga(ator);
  paraTodos("op2PerguntarFadiga", { atorId: ator.id, para: quem.id });
}

export function registrarSoltarSustentar() {
  registrarAcaoDeChat("soltar-sustentar", soltarPeloCard);
  registrarAcaoDeTodos("op2PerguntarFadiga", ({ atorId, para }) => {
    if (para !== game.user.id) return;
    void perguntarFadiga(game.actors.get(atorId));
  });
}

async function soltarPeloCard(_autor, dataset) {
  const ator = game.actors.get(dataset.atorId);
  if (!ator?.isOwner) return;
  if (!ator.system.estado.sustentando?.ativo) return void ui.notifications.info(game.i18n.localize("OP2.Desafio.NadaSustentado"));
  await pararDeSustentar(ator);
}
