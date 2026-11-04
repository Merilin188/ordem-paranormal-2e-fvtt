/**
 * Equipamento genérico.
 *
 * O playtest não publicou regras de carga nem de compra — só cita "espaço de compra"
 * na tabela de falha crítica (spec §4.4). Os campos ficam livres até isso sair.
 */
export class EquipamentoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const { SchemaField, NumberField, BooleanField, HTMLField, StringField } = foundry.data.fields;

    return {
      quantidade: new NumberField({ required: true, initial: 1, min: 0, integer: true, nullable: false }),
      equipado: new BooleanField({ required: true, initial: false }),
      descricao: new HTMLField({ required: true, initial: "", blank: true }),

      /** Armas mudam o dano de RB para RA no combate corpo a corpo (spec §8.1). */
      arma: new BooleanField({ required: true, initial: false }),
      /** Modificador de dano da arma: dano = RA + modificador. */
      danoBonus: new NumberField({ required: true, initial: 0, integer: true, nullable: false }),
      /** Reduz uma perícia em N passos enquanto equipado (elmo: Percepção; cota de malha: Furtividade). */
      penalidade: new SchemaField({
        pericia: new StringField({ required: true, initial: "", blank: true }),
        passos: new NumberField({ required: true, initial: 0, min: 0, max: 4, integer: true, nullable: false }),
      }),
      /** Crítico com dois valores iguais a partir deste número ao atacar com a arma (0 = padrão, 6). */
      criticoMinimo: new NumberField({ required: true, initial: 0, min: 0, max: 12, integer: true, nullable: false }),
      /** Escudo: perdeu o teste oposto de ataque mas somou 7+, reduz a RB do dano recebido. */
      escudo: new BooleanField({ required: true, initial: false }),
      /** Pontos de armadura que o item fornece. */
      armadura: new NumberField({ required: true, initial: 0, min: 0, integer: true, nullable: false }),

      /** Ferramentas com carga limitada: UV tem 3, Pó Revelador tem 5 (spec §9). */
      cargas: new SchemaField({
        usa: new BooleanField({ required: true, initial: false }),
        value: new NumberField({ required: true, initial: 0, min: 0, integer: true, nullable: false }),
        max: new NumberField({ required: true, initial: 0, min: 0, integer: true, nullable: false }),
      }),
    };
  }
}
