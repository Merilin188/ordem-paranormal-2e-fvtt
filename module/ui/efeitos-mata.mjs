/**
 * Calibração da "mata que observa" — as cenas da furtividade (Profundezas da Mata, Rio
 * das Brumas, Encosta Escura…): tremor e rastro leves, vagalumes, os olhos entre as
 * árvores (calmos, atentos na furtividade, procurando na fase das criaturas) e o
 * batimento nas bordas durante a furtividade. Quem desenha é `efeitos-cena.mjs`.
 */
import { SYSTEM_ID } from "../config.mjs";
import { mesclarComLimites, criarJanelaDeCalibracao } from "./calibracao-efeitos.mjs";

export const CHAVE_MATA = "efeitosMataConfig";

/** Os valores de antes da calibração existir: quem não mexer vê a mesma mata. */
export const configMataPadrao = () => ({
  tremor: { ligado: true, intensidadePx: 7, freqHz: 0.1 },
  rastro: { ligado: true, forca: 0.12 },
  vagalumes: { ligado: true, quantidade: 55, tamanho: 1, velocidade: 1 },
  olhos: { ligado: true, frequencia: 1, maxCalmo: 6, maxFurtividade: 9, maxCriaturas: 12, procuram: true, corVermelho: "#ff2a1f", corClaro: "#fff1d2", corAmbar: "#ffc23a" },
  batimento: { ligado: true, intensidade: 1 },
});

export const LIMITES_MATA = Object.freeze({
  "tremor.intensidadePx": [0, 18], "tremor.freqHz": [0.02, 1.6],
  "rastro.forca": [0, 0.3],
  "vagalumes.quantidade": [0, 150], "vagalumes.tamanho": [0.3, 3], "vagalumes.velocidade": [0.2, 3],
  "olhos.frequencia": [0.1, 4], "olhos.maxCalmo": [0, 30], "olhos.maxFurtividade": [0, 30], "olhos.maxCriaturas": [0, 30],
  "batimento.intensidade": [0, 1],
});

export const mesclarMata = (salvo) => mesclarComLimites(salvo, configMataPadrao(), LIMITES_MATA);

export function lerConfigMata() {
  try { return mesclarMata(game.settings.get(SYSTEM_ID, CHAVE_MATA)); } catch { return configMataPadrao(); }
}

/** As ações do FX Bus da mata para esta configuração. Pura. */
export function acoesDaMata(c) {
  const acoes = [];
  if (c.tremor.ligado && c.tremor.intensidadePx > 0) {
    acoes.push({ action: "fx.screenShake.start", intensityPx: c.tremor.intensidadePx, freqHz: c.tremor.freqHz, durationMs: 0 });
  }
  if (c.rastro.ligado && c.rastro.forca > 0) {
    acoes.push({
      action: "fx.screenSmear.start", strength: 1, persistence: 0.78, cameraWeighted: true, jitterPx: 0, maxStepPx: 22,
      ease: "inOut", freqHz: 0.07, minStrength: 0, maxStrength: c.rastro.forca, durationMs: 0,
    });
  }
  return acoes;
}

/**
 * O ritmo dos olhos na furtividade, já com a calibração: multiplicador de nascimento,
 * quantos cabem e se procuram (fase das criaturas). Pura.
 */
export function ritmoCalibrado(furtividade, c = configMataPadrao()) {
  const o = c.olhos;
  if (!furtividade?.ativa) return { olhos: o.frequencia, maxOlhos: o.maxCalmo, procuram: false };
  if (furtividade.fase === "criaturas") return { olhos: 3 * o.frequencia, maxOlhos: o.maxCriaturas, procuram: o.procuram };
  return { olhos: 2 * o.frequencia, maxOlhos: o.maxFurtividade, procuram: false };
}

/** "#ff2a1f" → 0xff2a1f. Pura. */
export const corHex = (cor) => parseInt(String(cor).slice(1), 16);

/** Chamado no init. `aoMudar` reaplica os efeitos se a cena atual for da mata. */
export function registrarCalibracaoDaMata(aoMudar) {
  game.settings.register(SYSTEM_ID, CHAVE_MATA, {
    scope: "world", config: false, type: Object, default: configMataPadrao(), onChange: () => aoMudar(),
  });
  game.settings.registerMenu(SYSTEM_ID, "calibrarMataMenu", {
    name: "OP2.EfeitosMata.MenuNome",
    label: "OP2.EfeitosMata.MenuBotao",
    hint: "OP2.EfeitosMata.MenuAjuda",
    icon: "fa-solid fa-sliders",
    type: criarJanelaDeCalibracao({
      id: "op2-calibrar-mata",
      i18n: "OP2.EfeitosMata",
      chave: CHAVE_MATA,
      chaveCenas: "cenaEfeitosProfundezas",
      padrao: configMataPadrao,
      mesclar: mesclarMata,
      limites: LIMITES_MATA,
      grupos: [
        { id: "tremor", campos: [{ chave: "intensidadePx" }, { chave: "freqHz", passo: 0.01 }] },
        { id: "rastro", campos: [{ chave: "forca", passo: 0.01 }] },
        { id: "vagalumes", campos: [{ chave: "quantidade" }, { chave: "tamanho", passo: 0.1 }, { chave: "velocidade", passo: 0.1 }] },
        { id: "olhos", campos: [
          { chave: "frequencia", passo: 0.1 }, { chave: "maxCalmo" }, { chave: "maxFurtividade" }, { chave: "maxCriaturas" },
          { chave: "procuram", tipo: "bool" },
          { chave: "corVermelho", tipo: "cor" }, { chave: "corClaro", tipo: "cor" }, { chave: "corAmbar", tipo: "cor" },
        ] },
        { id: "batimento", campos: [{ chave: "intensidade", passo: 0.05 }] },
      ],
    }),
    restricted: true,
  });
}
