/**
 * Categorias de desafio: Acesso (Arrombar/Destrancar/Hackear), Equilíbrio,
 * Sustentação e Alcançar. Todas usam o mesmo Item ("desafio-acesso") com o campo
 * `categoria`; cada uma nasce com ícone próprio (que também vira o marcador no mapa)
 * e com as abordagens certas já ligadas.
 */
import { SYSTEM_ID, ICONES_PADRAO } from "../config.mjs";

const ICONES = `systems/${SYSTEM_ID}/assets/icons/desafios`;

export const CATEGORIAS_DESAFIO = {
  acesso: { icone: ICONES_PADRAO.Item["desafio-acesso"], fa: "fa-lock", abordagens: { arrombar: true, destrancar: true } },
  equilibrio: { icone: `${ICONES}/equilibrio.svg`, fa: "fa-person-falling", abordagens: { arrombar: false, destrancar: false } },
  sustentar: { icone: `${ICONES}/sustentar.svg`, fa: "fa-weight-hanging", abordagens: { arrombar: false, destrancar: false, sustentar: true } },
  alcancar: { icone: `${ICONES}/alcancar.svg`, fa: "fa-hand", abordagens: { arrombar: false, destrancar: false } },
};

export const rotuloCategoria = (c) => game.i18n.localize(`OP2.Desafio.Categoria.${c}`);

/** Pergunta qual tipo de desafio criar. Devolve a categoria ou null. */
export async function escolherCategoria() {
  const botoes = Object.entries(CATEGORIAS_DESAFIO).map(([chave, c]) => ({
    action: chave, label: rotuloCategoria(chave), icon: `fa-solid ${c.fa}`,
  }));
  const escolha = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("OP2.Desafio.NovoTipo"), icon: "fa-solid fa-plus" },
    classes: ["op2", "op2-dlg", "op2-dlg--categoria"],
    content: `<p class="op2-ajuda">${game.i18n.localize("OP2.Desafio.NovoTipoAjuda")}</p>`,
    buttons: botoes,
    rejectClose: false,
  });
  return CATEGORIAS_DESAFIO[escolha] ? escolha : null;
}

/** Cria o desafio da categoria (sem vincular). */
export async function criarDesafioDaCategoria(categoria) {
  const c = CATEGORIAS_DESAFIO[categoria];
  const [item] = await Item.createDocuments([{
    name: game.i18n.format("OP2.Desafio.NovoNome", { tipo: rotuloCategoria(categoria) }),
    type: "desafio-acesso",
    img: c.icone,
    system: { categoria, abordagens: c.abordagens },
  }]);
  return item;
}
