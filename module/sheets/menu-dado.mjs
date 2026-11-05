/**
 * O menu do seletor de dado abre para baixo; perto do fim de uma área com rolagem
 * (a lista de perícias), ele ficava cortado e era preciso rolar para ver as opções.
 * Aqui ele vira para cima quando não cabe embaixo.
 */
function areaRolavel(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return document.documentElement;
}

export function posicionarMenuDeDado(controle) {
  if (!controle) return;
  controle.classList.remove("acima");
  if (!controle.classList.contains("aberto")) return;
  const menu = controle.querySelector(".op2-controle-dado__menu");
  if (!menu) return;
  const limite = areaRolavel(controle).getBoundingClientRect().bottom;
  if (menu.getBoundingClientRect().bottom > Math.min(limite, window.innerHeight)) controle.classList.add("acima");
}
