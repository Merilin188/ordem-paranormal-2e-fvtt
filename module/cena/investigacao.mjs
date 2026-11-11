/**
 * Regras de investigação, isoladas do Foundry (spec §6).
 *
 * A coluna DT do quadro de informações é lida de duas formas diferentes: Investigar
 * compara o *tamanho do dado* da perícia, sem rolar; Examinar rola e compara a soma.
 * São camadas distintas sobre a mesma coluna — um personagem com Percepção d8 recebe
 * de graça toda info de DT ≤ 8 e rola para tentar as de DT 9+ (spec §6.3).
 */

/** Chave estável de uma informação revelada: "<uuid do POI>:<id da info>". */
export function chaveInfo(poiUuid, infoId) {
  return `${poiUuid}:${infoId}`;
}

/**
 * Uma linha só é achável quando não é rascunho do mestre (`oculta`) nem já foi
 * entregue de bandeja (`aberta`). As duas somem das buscas pelo mesmo motivo:
 * não há nada a descobrir ali — uma porque não existe pro jogador, a outra
 * porque ele já leu.
 */
export function descobrivel(info) {
  return !info.oculta && !info.aberta && !contadaAoGrupo(info);
}

/** Um jogador contou esta linha ao grupo: a mesa inteira já sabe (como `aberta`). */
export function contadaAoGrupo(info) {
  return (info.contadaPor?.length ?? 0) > 0;
}

/**
 * O ponto está trancado? Só quando o mestre o bloqueou, ninguém o liberou ainda e
 * nenhum dos desafios dele foi vencido. Bloqueado sem desafio fica trancado até o
 * mestre liberar à mão.
 * @param {{bloqueado?: boolean, liberado?: boolean}|undefined} acesso
 * @param {boolean[]} resolvidos um por desafio do ponto
 */
export function estaTrancado(acesso, resolvidos = []) {
  if (!acesso?.bloqueado || acesso.liberado) return false;
  return !resolvidos.some(Boolean);
}

/** As linhas que se alcançam agora: com o ponto trancado, só as de fora da tranca. */
export function infosAlcancaveis(informacoes, trancado) {
  return trancado ? informacoes.filter((info) => info.foraDaTranca) : informacoes;
}

/** As perícias que acham a linha: a principal e as alternativas ("artes ou folclore"). */
export function periciasDaLinha(info) {
  return [...new Set([info.pericia, ...(info.periciasAlternativas ?? [])].filter(Boolean))];
}

/** A perícia serve para esta linha? */
export function aceitaPericia(info, chavePericia) {
  return periciasDaLinha(info).includes(chavePericia);
}

/** Chave do grupo da linha no painel: as perícias dela juntas ("aptidao.artes|aptidao.folclore"). */
export function grupoDaLinha(info) {
  return periciasDaLinha(info).join("|");
}

/** Perícias presentes no quadro, sem repetição, na ordem em que aparecem. */
export function periciasDoQuadro(informacoes) {
  return [...new Set(informacoes.flatMap(periciasDaLinha))];
}

/**
 * INVESTIGAR (spec §6.3): entrega toda informação da perícia com DT ≤ valor da
 * perícia (o tamanho do dado: 4/6/8/10/12). Determinístico, sem rolagem.
 *
 * @param {Array<{id: string, pericia: string, dt: number}>} informacoes quadro do POI
 * @param {string} chavePericia ex.: "percepcao" ou "aptidao.artes"
 * @param {number} valorPericia tamanho do dado da perícia
 * @param {Set<string>} idsJaRevelados ids já revelados *deste POI* por este personagem
 * @returns {string[]} ids das informações novas, em DT crescente
 */
export function resolverInvestigacao(informacoes, chavePericia, valorPericia, idsJaRevelados = new Set()) {
  return informacoes
    .filter((info) => descobrivel(info) && aceitaPericia(info, chavePericia)
      && info.dt <= valorPericia && !idsJaRevelados.has(info.id))
    .sort((a, b) => a.dt - b.dt)
    .map((info) => info.id);
}

/**
 * Por que Investigar não trouxe nada? "Nenhuma informação nova" sozinho não diz
 * se a perícia não serve ali, se o dado é pequeno demais ou se já se descobriu
 * tudo — e sem isso o jogador fica sem saber o que fazer (achado em uso real).
 *
 * Rascunho do mestre (`oculta`) conta como inexistente: o jogador não pode nem
 * suspeitar que existe algo ali esperando.
 *
 * @returns {{motivo: "sem-pericia"|"dado-pequeno"|"ja-revelado", dtMinima: number|null}}
 *   `dtMinima` só existe em "dado-pequeno" — é o que faltaria alcançar.
 */
export function motivoSemRevelacao(informacoes, chavePericia, valorPericia, idsJaRevelados = new Set()) {
  const daPericia = informacoes.filter((info) => descobrivel(info) && aceitaPericia(info, chavePericia));
  if (!daPericia.length) return { motivo: "sem-pericia", dtMinima: null };

  const naoRevelados = daPericia.filter((info) => !idsJaRevelados.has(info.id));
  if (!naoRevelados.length) return { motivo: "ja-revelado", dtMinima: null };

  return { motivo: "dado-pequeno", dtMinima: Math.min(...naoRevelados.map((info) => info.dt)) };
}

/**
 * EXAMINAR (spec §6.3.1): rola a perícia e compara a *soma* contra a DT. Se nada
 * novo for revelado — por não atingir a DT ou por não haver mais nada — perde 1 PD.
 * Um crítico ignora a DT e revela tudo que falta daquela perícia: é a "informação
 * adicional" do crítico em cena de investigação (spec §4.3).
 *
 * @param {Array<{id: string, pericia: string, dt: number}>} informacoes
 * @param {string} chavePericia
 * @param {number} total soma dos dados contabilizados
 * @param {Set<string>} idsJaRevelados
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.ignorarDT] crítico: revela o que falta, sem comparar DT
 * @returns {{revelaveis: string[], perdePD: boolean}}
 */
export function resolverExaminar(informacoes, chavePericia, total, idsJaRevelados = new Set(), { ignorarDT = false } = {}) {
  const revelaveis = informacoes
    .filter((info) => descobrivel(info) && aceitaPericia(info, chavePericia)
      && !idsJaRevelados.has(info.id)
      && (ignorarDT || info.dt <= total))
    .sort((a, b) => a.dt - b.dt)
    .map((info) => info.id);
  return { revelaveis, perdePD: revelaveis.length === 0 };
}

/* ------------------------------------------------------------------ */
/* Investigar no playtest Beta: três passos, o mestre narra              */
/* ------------------------------------------------------------------ */

/**
 * Passo 1: as perícias que o mestre lista ao jogador. Linha oculta não entra — a
 * perícia dela na lista já entregaria que há algo ali; com o ponto trancado, só as
 * do lado de fora. Sem DT e sem contagem: só os nomes.
 */
export function periciasParaInvestigar(informacoes, trancado = false) {
  return periciasDoQuadro(infosAlcancaveis(informacoes, trancado).filter((info) => !info.oculta));
}

/**
 * Passo 2 (e Observar): o que a janela do mestre mostra para UMA perícia e o dado do
 * personagem nela. Todas as linhas daquela perícia, inclusive as ocultas e as que o
 * dado não alcança: o mestre decide o que envia. Vem marcado o que o livro manda
 * narrar — DT até o tamanho do dado, visível e ao alcance (fora da tranca).
 *
 * @returns {Array<{id: string, dt: number, texto: string, oculta: boolean, aberta: boolean,
 *   conhecida: boolean, alcanca: boolean, trancada: boolean, marcada: boolean}>}
 */
export function linhasParaOMestre(informacoes, chavePericia, dado, idsJaRevelados = new Set(), trancado = false) {
  return informacoes
    .filter((info) => aceitaPericia(info, chavePericia))
    .sort((a, b) => a.dt - b.dt)
    .map((info) => {
      const trancada = Boolean(trancado && !info.foraDaTranca);
      const alcanca = info.dt <= dado;
      return {
        id: info.id, dt: info.dt, texto: info.texto,
        oculta: Boolean(info.oculta), aberta: Boolean(info.aberta),
        conhecida: idsJaRevelados.has(info.id) || Boolean(info.aberta) || contadaAoGrupo(info),
        alcanca, trancada,
        marcada: !info.oculta && alcanca && !trancada,
      };
    });
}

/** Do que o mestre enviou, o que é novo para este personagem (vai para a ficha dele). */
export function novasParaOPersonagem(idsEnviados, idsJaRevelados = new Set()) {
  return idsEnviados.filter((id) => !idsJaRevelados.has(id));
}

/**
 * Passo 3: Observar OU Examinar — um só, e só depois que o mestre enviou o passivo.
 * Escolher tira os dois botões (a ação acaba depois de qualquer um). Devolve o
 * estado novo, ou null quando a escolha não vale (já escolheu, ainda não é a hora,
 * Observar sem outra perícia na lista).
 */
export function escolherAprofundamento(estado, escolha) {
  if (estado?.etapa !== "aprofundar" || !["observar", "examinar"].includes(escolha)) return null;
  if (escolha === "observar" && !periciasParaObservar(estado).length) return null;
  return { ...estado, escolha, etapa: escolha === "observar" ? "observar" : "examinando" };
}

/** Observar usa OUTRA perícia listada — nunca a do passo 2. */
export function periciasParaObservar(estado) {
  return (estado?.pericias ?? []).filter((p) => p.chave !== estado?.passivo?.pericia);
}

/**
 * Examinar no Beta: rola a perícia do passo 2 e alcança as linhas com DT até o
 * resultado. O passivo já foi entregue antes e NÃO entra na conta: perde 1 PD quem
 * não recebe nenhuma linha nova para ele — rolou abaixo do dado, já sabia tudo ou
 * não havia mais nada. (No Alpha, só custava quando passivo e teste vinham vazios.)
 */
export function resolverExaminarBeta(informacoes, chavePericia, total, idsJaRevelados = new Set(), { ignorarDT = false } = {}) {
  return resolverExaminar(informacoes, chavePericia, total, idsJaRevelados, { ignorarDT });
}

/**
 * Sobrecarga mental (spec §7.6): o dano emocional do fim da rodada. A tabela é
 * editável por cena; a última linha cobre "9 ou mais", então vale a maior rodada
 * da tabela que não passa da atual.
 *
 * @param {Array<{rodada: number, dano: string}>} tabela
 * @param {number} rodada
 * @returns {string} expressão de dano: "0", "1", "1d4"…
 */
export function danoSobrecarga(tabela, rodada) {
  const ordenada = [...tabela].sort((a, b) => a.rodada - b.rodada);
  let dano = "0";
  for (const linha of ordenada) {
    if (linha.rodada > rodada) break;
    dano = linha.dano;
  }
  return dano;
}
