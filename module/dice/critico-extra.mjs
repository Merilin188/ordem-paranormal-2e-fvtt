/**
 * O dado do crítico — SÓ no teste de esconderijo (furtividade): "role um dado
 * adicional igual a um dos dados rolados no teste e adicione-o como esconderijo",
 * para quem critou não ficar com os mesmos valores nos dados de furtividade.
 *
 * Nos testes comuns NÃO existe dado extra: o crítico passa direto e, em testes
 * estendidos e ataques, soma as duas rolagens mais altas (`duasMaisAltas`).
 */

/** O dado do crítico: o maior entre os dados com o valor repetido (>= 6). */
export function dadoDoCritico(dados) {
  const validos = (dados ?? []).filter((d) => !d.pavor && !d.consumido);
  const contagem = {};
  for (const d of validos) contagem[d.resultado] = (contagem[d.resultado] ?? 0) + 1;
  const valor = Math.max(...Object.entries(contagem).filter(([v, n]) => Number(v) >= 6 && n >= 2).map(([v]) => Number(v)), 0);
  const faces = (d) => Number(String(d.dado ?? "").replace("d", "")) || 0;
  const doPar = validos.filter((d) => d.resultado === valor);
  const base = doPar.length ? doPar : validos;
  return Math.max(...base.map(faces), 6);
}
