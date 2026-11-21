/** Quantas pessoas chegaram ao passo k: todas as que estão nele ou já passaram (passos de 0 a 7). */
export function chegaram(passos: Record<string, number>, k: number) {
  let s = 0
  for (let j = k; j <= 7; j++) s += passos[String(j)] ?? 0
  return s
}

/** Passo (0 a 6) em que mais gente parou, em proporção de quem chegou nele. */
export function maiorPerda(passos: Record<string, number>) {
  let melhor = { k: -1, taxa: 0 }
  for (let k = 0; k <= 6; k++) {
    const ch = chegaram(passos, k)
    const parou = passos[String(k)] ?? 0
    if (ch > 0 && parou / ch > melhor.taxa) melhor = { k, taxa: parou / ch }
  }
  return melhor.k >= 0 && melhor.taxa > 0 ? melhor : null
}

/** Link do WhatsApp com a mensagem pronta. Número sem DDI ganha o 55. */
export function waLink(whats: string, texto: string) {
  const d = whats.replace(/\D/g, '')
  const num = d.length <= 11 ? `55${d}` : d
  return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`
}

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? ''

export const dataExtensa = () => {
  const s = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "2026-11-16" → "16/11" */
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** Primeiro nome, ou o texto de reserva quando o nome está vazio. */
export const nome1 = (s: string, fallback = 'tudo bem') => (s.trim() ? s.trim().split(/\s+/)[0] : fallback)
