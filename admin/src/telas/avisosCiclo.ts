/**
 * Quando a aba Avisos deve alertar que o servidor parou de trabalhar nos lembretes.
 *
 * O servidor só grava o carimbo do ciclo quando há alguma regra ligada. Por isso, logo depois de ligar a primeira regra, o carimbo ainda é
 * velho (ou vazio) por até um minuto, e a tela alertava à toa justo no momento em que o Arthur acabava de ligar. Só vale alertar quando
 * a regra já está ligada há mais que a folga e, mesmo assim, o servidor continua sem marcar.
 */
export const FOLGA_CICLO_MS = 5 * 60_000

export function cicloParado(regras: { modo: string; atualizado_em: string }[], cicloEm: string | null, agora = Date.now()): boolean {
  const ligadas = regras.filter((r) => r.modo !== 'desligado')
  if (!ligadas.length) return false
  // Data ilegível conta como antiga: na dúvida, alertar é melhor que calar.
  const ligadaHaTempo = ligadas.some((r) => !(agora - Date.parse(r.atualizado_em) <= FOLGA_CICLO_MS))
  const ciclo = cicloEm ? Date.parse(cicloEm) : Number.NaN
  const cicloVelho = Number.isNaN(ciclo) || agora - ciclo > FOLGA_CICLO_MS
  return ligadaHaTempo && cicloVelho
}
