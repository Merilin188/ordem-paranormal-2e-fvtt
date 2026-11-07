/**
 * Criatura — oponente de combate (bestiário de Contos da Vigília). Parte da ficha
 * reduzida de NPC (atributos, perícias declaradas, PV/PD) e acrescenta o que o
 * bloco de estatísticas do livro traz: ações de ataque (dados do teste e dano em
 * RA/RB + N), habilidades especiais, redução de dano e a estratégia de combate.
 */
import { NpcData } from "./actor-npc.mjs";

export class CriaturaData extends NpcData {
  static defineSchema() {
    const { SchemaField, StringField, HTMLField, NumberField, TypedObjectField, ObjectField } = foundry.data.fields;
    const ataque = new SchemaField({
      nome: new StringField({ required: true, initial: "", blank: true }),
      alcance: new StringField({ required: true, initial: "corpo", choices: ["corpo", "distancia"] }),
      // "2d6", "d8+d6", "2d10": cada dado é um dado do teste (somados como sempre).
      dados: new StringField({ required: true, initial: "2d6", blank: true }),
      // "RA+1", "RB", "RA+4"; vazio = sem dano direto (ex.: Afogar).
      dano: new StringField({ required: true, initial: "RA", blank: true }),
      nota: new StringField({ required: true, initial: "", blank: true }),
      ordem: new NumberField({ required: true, initial: 0, integer: true }),
    });
    const habilidade = new SchemaField({
      nome: new StringField({ required: true, initial: "", blank: true }),
      texto: new StringField({ required: true, initial: "", blank: true }),
      ordem: new NumberField({ required: true, initial: 0, integer: true }),
    });
    const colecao = (campo) => (TypedObjectField ? new TypedObjectField(campo) : new ObjectField());
    return {
      ...super.defineSchema(),
      ataques: colecao(ataque),
      habilidades: colecao(habilidade),
      reducaoDano: new NumberField({ required: true, initial: 0, min: 0, integer: true }),
      estrategia: new HTMLField({ required: true, initial: "", blank: true }),
    };
  }

  /** A criatura tem todas as perícias: a da lista é a treinada; rola com o atributo dela. */
  get pareiaPericias() { return true; }
}

export { dadosDoAtaque, danoDoAtaque } from "./ataque-criatura.mjs";
