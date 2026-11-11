/**
 * A lista de fichas dos diálogos do mestre (Solicitar teste, Teste oposto) seguindo
 * as pastas da barra de atores: com muitas fichas e criaturas, uma lista corrida em
 * ordem alfabética não se achava nada (pedido em uso real). Puro, sem Foundry.
 */

const porNome = (a, b) => String(a.name).localeCompare(String(b.name), "pt-BR");

/**
 * Agrupa os atores por pasta, na ordem da barra lateral (pasta-mãe antes das filhas),
 * com o caminho como rótulo ("Missão 2 › Inimigos"). Pasta sem ator nenhum não vira
 * grupo; os atores fora de pasta (ou numa pasta desconhecida) ficam no fim.
 * @param {Array<{id: string, name: string, folderId?: string|null}>} atores
 * @param {Array<{id: string, name: string, parentId?: string|null, sort?: number}>} pastas
 * @param {{semPasta?: string}} [opcoes] rótulo do grupo dos soltos
 * @returns {Array<{id: string|null, rotulo: string, atores: object[]}>}
 */
export function agruparPorPasta(atores, pastas, { semPasta = "" } = {}) {
  const filhas = (pai) => pastas
    .filter((p) => (p.parentId ?? null) === pai)
    .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || porNome(a, b));
  const grupos = [];
  const visitar = (pai, caminho) => {
    for (const pasta of filhas(pai)) {
      const rotulo = [...caminho, pasta.name];
      const deles = atores.filter((a) => a.folderId === pasta.id).sort(porNome);
      if (deles.length) grupos.push({ id: pasta.id, rotulo: rotulo.join(" › "), atores: deles });
      visitar(pasta.id, rotulo);
    }
  };
  visitar(null, []);
  const conhecidas = new Set(pastas.map((p) => p.id));
  const soltos = atores.filter((a) => !a.folderId || !conhecidas.has(a.folderId)).sort(porNome);
  if (soltos.length) grupos.push({ id: null, rotulo: semPasta, atores: soltos });
  return grupos;
}

/** O ator passa no filtro? Busca sem acento e sem caixa; "só na cena" pelos ids da cena. */
export function atorPassaNoFiltro(ator, { termo = "", soCena = false, idsNaCena = new Set() } = {}) {
  const normalizar = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (soCena && !idsNaCena.has(ator.id)) return false;
  const busca = normalizar(termo).trim();
  return !busca || normalizar(ator.name).includes(busca);
}
