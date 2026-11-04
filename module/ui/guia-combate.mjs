/**
 * Guia rápido de combate — consulta para todos os jogadores: botão flutuante (abaixo
 * do painel de investigação) e atalho Shift+C. Resumo das ações de combate, manobras,
 * testes de ataque e situações específicas, com busca.
 */
import { SYSTEM_ID } from "../config.mjs";

const { ApplicationV2 } = foundry.applications.api;

const GUIA = [
  { secao: "Fases da rodada", itens: [
    ["Ordem", "Cada rodada tem três fases: Geral (qualquer ação, exceto ataques), Ataques à Distância e Ataques Corpo a Corpo. Quem age numa fase não age nas seguintes. Ações da mesma fase são simultâneas."],
  ] },
  { secao: "Ações gerais", itens: [
    ["Atrapalhar", "Alvo em alcance curto. Teste de uma perícia coerente oposto à Percepção dele. Se vencer, ele sofre uma redução de passo em todos os testes até o fim da rodada."],
    ["Defender-se", "Acrobacia +1d6 oposto ao teste de um ataque que você sofrerá nesta rodada (escolha antes do ataque). Se vencer, não sofre dano (nem causa). Contra corpo a corpo, pode usar Luta no lugar de Acrobacia."],
    ["Erguer-se", "Se estiver caído, levanta. Pode ser ação livre, mas aí sofre uma redução de passo em todos os testes da rodada."],
    ["Fintar", "Enganação oposta à Intuição de um alvo em alcance curto. Se vencer, recebe dois aumentos de passo no próximo ataque contra ele (até o fim da próxima rodada)."],
    ["Jogar-se no chão (livre)", "A partir da próxima rodada, recebe os benefícios e penalidades de estar caído até se levantar."],
    ["Mirar", "Mire em um alvo visível dentro do alcance da arma. Na próxima rodada, +1d6 nos ataques à distância contra ele."],
    ["Preparar", "Declare uma ação e o evento que a dispara. Ela acontece como reação, antes do evento se resolver. Se o evento não ocorrer até o fim da rodada, perde a ação."],
    ["Sacar ou guardar item", "Saca ou guarda um item. Como ação livre, sofre uma redução de passo em todos os testes da rodada."],
    ["Usar habilidade ou item", "Usa uma habilidade ou item que precise ser ativado. Veja o texto dele."],
  ] },
  { secao: "Ataques", itens: [
    ["Agredir", "Ataque a um alvo. Corpo a corpo: alvos em alcance curto. À distância: alcance curto ou longo."],
    ["Teste de ataque", "Luta (corpo a corpo) ou Pontaria (à distância). DT 7; alcance longo +3 (exige arma de distância)."],
    ["Atirando em corpo a corpo", "Atacar à distância um alvo envolvido em corpo a corpo: duas reduções de passo. Pode ignorar a penalidade rolando 1d6: ímpar, o ataque vai em quem lutava com o alvo."],
    ["Ataques opostos", "Se você e o inimigo atacam corpo a corpo um ao outro, os testes ficam opostos: o maior acerta; empate, os dois acertam (desde que atinjam a DT 7)."],
    ["Dano", "Ao acertar: normalmente RA (rolagem alta) + modificador da arma."],
  ] },
  { secao: "Manobras (substituem um ataque corpo a corpo)", itens: [
    ["Como funciona", "Teste de ataque oposto à Acrobacia ou Luta do alvo. Se vencer, gera o efeito."],
    ["Agarrar", "O alvo fica imóvel, sofre redução de passo em ataques e só ataca com armas pequenas. Soltar-se: ação padrão vencendo manobra oposta. Você fica com a mão ocupada e sobrecarregado; pode trocar um ataque por causar dano de impacto igual à RA."],
    ["Derrubar", "O alvo fica caído. Vencendo por 5 ou mais, causa dano de impacto igual à RB."],
    ["Desarmar", "O alvo derruba um item empunhado. Vencendo por 5 ou mais, pode pegá-lo (mão livre) ou arremessá-lo."],
    ["Empurrar", "Empurra o alvo alguns metros. Vencendo por 5 ou mais, ele fica desequilibrado: redução de passo no próximo teste."],
    ["Quebrar", "Atinge um item do alvo. Se vencer, causa o dano do ataque no objeto."],
  ] },
  { secao: "Situações específicas", itens: [
    ["Caído", "Redução de passo em testes físicos. Corpo a corpo contra caído: aumento de passo. À distância contra caído: DT +3."],
    ["Cobertura leve", "Atrás de árvore, carro etc.: DT para atingir +3 (10 em alcance curto, 13 em longo)."],
    ["Cobertura total", "Totalmente protegido: não pode ser atacado."],
    ["Ocultação leve", "Penumbra, neblina, folhagem: inimigos sofrem uma redução de passo nos ataques contra você."],
    ["Ocultação total", "Escuridão total: duas reduções de passo nos ataques contra você. Se os dois tiverem ocultação, ambos sofrem as reduções."],
    ["Vantagem tática", "Posição favorável (alvo caído, terreno elevado…): um aumento de passo no ataque."],
  ] },
  { secao: "Defesa e medo", itens: [
    ["Pontos de armadura", "Vêm dos itens. Ao sofrer dano, gaste 1 ponto (ação livre, só 1 por vez) para reduzir esse dano em 10. Gastos não voltam neste playtest."],
    ["Levantar-se", "Caído levanta gastando uma ação, ou como ação livre sofrendo uma redução de passo em todos os testes da rodada."],
    ["Dado de pavor", "Começa em d6 (receber de novo: sobe um passo). Rola junto em todo teste, não soma e anula os resultados menores que ele; anulou todos, falha crítica. Tirou 1: o pavor termina. Antes do teste: 1 PD reduz um passo; 5 PD o convertem em dado bônus."],
  ] },
];

class GuiaCombate extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "op2-guia-combate",
    classes: ["op2", "op2-guia"],
    window: { title: "OP2.Guia.Titulo", icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 520, height: 640 },
  };

  async _renderHTML() {
    const esc = foundry.utils.escapeHTML;
    const secoes = GUIA.map((s) => `<section class="op2-guia__secao"><h3>${esc(s.secao)}</h3>${s.itens
      .map(([t, d]) => `<details class="op2-guia__item" data-busca="${esc(`${t} ${d}`.toLowerCase())}"><summary>${esc(t)}</summary><p>${esc(d)}</p></details>`)
      .join("")}</section>`).join("");
    const div = document.createElement("div");
    div.className = "op2-guia__corpo";
    div.innerHTML = `<input type="search" class="op2-guia__busca" placeholder="${game.i18n.localize("OP2.Guia.Buscar")}">${secoes}`;
    return div;
  }

  _replaceHTML(resultado, conteudo) {
    conteudo.replaceChildren(resultado);
    const busca = conteudo.querySelector(".op2-guia__busca");
    busca.addEventListener("input", () => {
      const termo = busca.value.trim().toLowerCase();
      for (const item of conteudo.querySelectorAll(".op2-guia__item")) {
        const casa = !termo || item.dataset.busca.includes(termo);
        item.hidden = !casa;
        item.open = Boolean(termo) && casa;
      }
      for (const secao of conteudo.querySelectorAll(".op2-guia__secao")) {
        secao.hidden = ![...secao.querySelectorAll(".op2-guia__item")].some((i) => !i.hidden);
      }
    });
  }
}

let guia = null;
export function alternarGuiaCombate() {
  guia ??= new GuiaCombate();
  if (guia.rendered) void guia.close();
  else guia.render({ force: true });
}

function posicionarBotao() {
  const botao = document.getElementById("op2-botao-guia");
  const sidebar = document.getElementById("sidebar");
  if (!botao) return;
  botao.style.right = `${(sidebar?.getBoundingClientRect().width ?? 0) + 12}px`;
}

export function registrarGuiaCombate() {
  game.keybindings.register(SYSTEM_ID, "guiaCombate", {
    name: "OP2.Guia.Titulo",
    editable: [{ key: "KeyC", modifiers: ["Shift"] }],
    onDown: () => { alternarGuiaCombate(); return true; },
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });
  Hooks.once("ready", () => {
    if (document.getElementById("op2-botao-guia")) return;
    const botao = document.createElement("button");
    botao.id = "op2-botao-guia";
    botao.type = "button";
    botao.className = "op2 op2-botao-flutuante op2-botao-flutuante--guia";
    botao.dataset.tooltip = game.i18n.localize("OP2.Guia.Titulo");
    botao.dataset.tooltipDirection = "LEFT";
    botao.innerHTML = `<i class="fa-solid fa-book-open" aria-hidden="true"></i>`;
    botao.addEventListener("click", alternarGuiaCombate);
    document.body.appendChild(botao);
    posicionarBotao();
    document.getElementById("sidebar")?.addEventListener("transitionend", posicionarBotao);
  });
  Hooks.on("collapseSidebar", () => setTimeout(posicionarBotao, 400));
  Hooks.on("renderSidebar", () => setTimeout(posicionarBotao, 50));
}
