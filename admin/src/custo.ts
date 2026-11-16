/**
 * Preço da IA para mostrar o custo em reais no admin. AJUSTE AQUI quando o preço ou o câmbio mudar.
 * Valores em dólar por 1 milhão de tokens (preço de tabela da OpenAI, conferido em 16/11/2026).
 * - gpt-5.4-mini (lê as mensagens): US$ 0,75 entrada e US$ 4,50 saída.
 * - gpt-4o-mini-transcribe (áudio): o preço do áudio diverge entre as fontes. Usamos US$ 3,00 por 1 milhão de
 *   tokens de áudio e US$ 0,003 por minuto quando a API devolve só a duração. É estimativa: conferir na fatura da OpenAI.
 */
export const PRECO_USD = {
  entrada: 0.75,
  saida: 4.5,
  audioToken: 3.0,
  audioMinuto: 0.003,
}
/** Dólar em reais. Não é cotação ao vivo. */
export const CAMBIO = 5.5

export interface Consumo {
  entrada: number
  saida: number
  audio_tokens: number
  audio_seg: number
}

export function custoReais(c: Consumo) {
  const usd = (c.entrada * PRECO_USD.entrada + c.saida * PRECO_USD.saida + c.audio_tokens * PRECO_USD.audioToken) / 1_000_000 + (c.audio_seg / 60) * PRECO_USD.audioMinuto
  return usd * CAMBIO
}

export const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 1 ? 4 : 2 })
