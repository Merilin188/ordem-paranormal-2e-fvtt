/**
 * Ferimentos (PV) e traumas (PD) — spec §8.2/§8.3.
 *
 * Chegar a 0 PV, ou tomar dano já em 0, pede um teste de Vigor contra uma DT que
 * escala: 7, 10, 13, 16… (+3 por teste já feito). Falhar mata. O mesmo vale para o
 * PD com Disciplina, contador próprio — e ali a consequência é configurável, porque
 * o próprio playtest avisa que morrer por PD não vai continuar assim (§8.3).
 *
 * Nada é aplicado sozinho: o dano zera o recurso, o card aparece, e alguém clica.
 * É a mesma regra do resto do sistema — o playtest é de mesa, não de automação.
 */
import { SYSTEM_ID } from "../config.mjs";
import { dtDaQueda } from "./queda.mjs";
import { rolarTeste, renderizar } from "../dice/teste.mjs";

/** @typedef {"ferimento"|"trauma"} TipoDeQueda */

const CONFIGURACAO = {
  ferimento: {
    recurso: "pv",
    contador: "testesFerimento",
    pericia: "vigor",
    i18n: "OP2.Ferimento",
  },
  trauma: {
    recurso: "pd",
    contador: "testesTrauma",
    pericia: "disciplina",
    i18n: "OP2.Trauma",
  },
  // Moribundo: no fim de cada rodada, teste de morte (Físico + Vigor, DT +3 por teste).
  morte: {
    recurso: "pv",
    contador: "testesMorte",
    pericia: "vigor",
    i18n: "OP2.Morte",
  },
};

/**
 * Card que pede o teste. Sussurrado para o dono e o mestre: o resto da mesa não
 * precisa saber quantos testes de ferimento o personagem já acumulou.
 */
export async function pedirTesteDeQueda(ator, tipo) {
  const config = CONFIGURACAO[tipo];
  const testes = ator.system.estado?.[config.contador] ?? 0;

  const conteudo = await renderizar(`systems/${SYSTEM_ID}/templates/chat/queda.hbs`, {
    tipo,
    atorId: ator.id,
    titulo: game.i18n.localize(`${config.i18n}.Titulo`),
    texto: game.i18n.format(`${config.i18n}.Texto`, {
      ator: ator.name,
      pericia: game.i18n.localize(`OP2.Pericia.${config.pericia}`),
      dt: dtDaQueda(testes),
    }),
    consequencia: game.i18n.localize(`${config.i18n}.Consequencia`),
    rotuloBotao: game.i18n.format(`${config.i18n}.Rolar`, { dt: dtDaQueda(testes) }),
  });

  return ChatMessage.create({
    content: conteudo,
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    flags: { [SYSTEM_ID]: { tipo: "queda", atorId: ator.id } },
  });
}

/**
 * Rola o teste e conta a tentativa. O contador sobe SEMPRE, sucesso ou falha: a
 * escalada da DT é por "teste já realizado" (spec §8.2), não por falha.
 *
 * A morte em si não é aplicada pelo sistema — o card diz o que a regra manda e a
 * mesa decide o que fazer com o personagem. No trauma, a consequência da falha
 * segue o setting `falhaTrauma` (o playtest avisa que vai mudar, §8.3).
 */
export async function rolarTesteDeQueda(ator, tipo, { rapido = false } = {}) {
  const config = CONFIGURACAO[tipo];
  const testes = ator.system.estado?.[config.contador] ?? 0;
  const dt = dtDaQueda(testes);

  const roll = await rolarTeste(ator, {
    chavePericia: config.pericia,
    dt,
    rapido,
    contexto: game.i18n.localize(`${config.i18n}.Titulo`),
  });
  if (!roll) return null;

  await ator.update({ [`system.estado.${config.contador}`]: testes + 1 });

  // Resultado pela tabela do teste (lesão/morte: Físico + Vigor; trauma: Emoção + Disciplina).
  const desfecho = roll.desfecho;
  let tabela = null;
  let chaveTexto;
  if (tipo === "trauma") {
    chaveTexto = roll.sucesso ? "Sucesso" : "Falha";
    if (!roll.sucesso) tabela = "traumas";
  } else if (desfecho === "critico") {
    chaveTexto = "Critico";
    await recuperar(ator, "pv", 1);
    await definirCondicao(ator, "inconsciente", false);
    await definirCondicao(ator, "moribundo", false);
  } else if (desfecho === "falha-critica") {
    chaveTexto = "FalhaCritica";
    await definirCondicao(ator, "morto", true);
  } else if (roll.sucesso) {
    chaveTexto = "Sucesso";
    await definirCondicao(ator, "inconsciente", true);
    if (!ator.statuses?.has("moribundo")) {
      await definirCondicao(ator, "moribundo", true);
      await ator.update({ "system.estado.moribundoDesde": 1 });
    }
  } else {
    chaveTexto = "Falha";
    tabela = "lesoes";
  }

  const conteudo = await renderizar(`systems/${SYSTEM_ID}/templates/chat/queda-resultado.hbs`, {
    sucesso: roll.sucesso,
    titulo: game.i18n.localize(`${config.i18n}.Titulo`),
    dt,
    total: roll.total,
    texto: game.i18n.format(`${config.i18n}.Resultado.${chaveTexto}`, { ator: ator.name }),
    proximaDt: dtDaQueda(testes + 1),
    tabela,
    rotuloTabela: tabela ? game.i18n.localize(`OP2.Tabela.Abrir.${tabela}`) : "",
    atorId: ator.id,
  });

  await ChatMessage.create({
    content: conteudo,
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    flags: { [SYSTEM_ID]: { tipo: "queda-resultado", atorId: ator.id } },
  });

  const consequencia = chaveTexto;
  return { roll, sucesso: roll.sucesso, dt, consequencia };
}

/** Zera os contadores — cura/descanso não é definido pelo playtest (docs/LACUNAS.md). */
export async function zerarContadoresDeQueda(ator) {
  await ator.update({
    "system.estado.testesFerimento": 0,
    "system.estado.testesTrauma": 0,
    "system.estado.testesMorte": 0,
  });
}

async function recuperar(ator, recurso, n) {
  const r = ator.system.recursos[recurso];
  await ator.update({ [`system.recursos.${recurso}.value`]: Math.min(r.max, r.value + n) });
}

/** Liga/desliga uma condição do sistema no ator (e nos tokens dele). */
export async function definirCondicao(ator, id, ativo) {
  if (!ator?.toggleStatusEffect) return;
  if (Boolean(ator.statuses?.has(id)) === ativo) return;
  await ator.toggleStatusEffect(id, { active: ativo });
}
