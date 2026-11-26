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
  /** Parte de `entrada` que vem de mensagens com foto, e de mensagens com documento (PDF). Já está DENTRO de `entrada`: nunca somar por cima. */
  entrada_foto?: number
  entrada_pdf?: number
  /**
   * Custo MEDIDO em dólar (migration custopormodelo): o servidor grava o custo de cada mensagem pelo preço do modelo que rodou de verdade
   * (server/src/precos.ts). Os campos *_medida/*_medido dizem quanto dos tokens acima já está nesse custo; só o resto (mensagens de antes) é estimado.
   */
  custo_usd?: number | string | null
  entrada_medida?: number
  saida_medida?: number
  audio_tokens_medido?: number
  audio_seg_medido?: number
}

/** Estimativa antiga: tudo pelo preço do gpt-5.4-mini. Só para o que não tem custo medido. */
function estimadoUsd(c: Pick<Consumo, 'entrada' | 'saida' | 'audio_tokens' | 'audio_seg'>) {
  return (c.entrada * PRECO_USD.entrada + c.saida * PRECO_USD.saida + c.audio_tokens * PRECO_USD.audioToken) / 1_000_000 + (c.audio_seg / 60) * PRECO_USD.audioMinuto
}

/** Custo em reais: o medido (modelo real) mais a estimativa só do que veio antes da medição. */
export function custoReais(c: Consumo) {
  const medido = Number(c.custo_usd ?? 0) || 0
  const resto = {
    entrada: Math.max(0, c.entrada - (c.entrada_medida ?? 0)),
    saida: Math.max(0, c.saida - (c.saida_medida ?? 0)),
    audio_tokens: Math.max(0, c.audio_tokens - (c.audio_tokens_medido ?? 0)),
    audio_seg: Math.max(0, c.audio_seg - (c.audio_seg_medido ?? 0)),
  }
  return (medido + estimadoUsd(resto)) * CAMBIO
}

/** Só pelos tokens, ignorando o medido: para as quebras (leitura, resposta, áudio), que são uma divisão aproximada do total. */
export const soTokens = (c: Consumo): Consumo => ({ ...c, custo_usd: null, entrada_medida: 0, saida_medida: 0, audio_tokens_medido: 0, audio_seg_medido: 0 })

/** Gasto de um modelo no período (por_modelo de admin_custo_periodo). */
export interface GastoModelo {
  modelo: string
  chamadas: number
  /** Chamadas em que o modelo escolhido falhou e ESTE (o de fábrica) respondeu no lugar. */
  reserva: number
  pedidos: string[] | null
  sem_preco: number
  entrada: number
  saida: number
  cache: number
  custo_usd: number | string
}

export const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 })

/**
 * O custo de LER (a entrada do modelo) repartido em foto, documento e o resto (texto e áudio). Os três somam sempre o custo de `entrada`: o total do
 * cliente não muda, só se reparte. Foto e documento aqui são a leitura inteira das mensagens com foto ou PDF, o que inclui as instruções de sempre.
 */
export function custoLeitura(c: Consumo) {
  const foto = Math.min(c.entrada_foto ?? 0, c.entrada)
  const pdf = Math.min(c.entrada_pdf ?? 0, c.entrada - foto)
  const em = (tokens: number) => estimadoUsd({ entrada: tokens, saida: 0, audio_tokens: 0, audio_seg: 0 }) * CAMBIO
  return { texto: em(c.entrada - foto - pdf), foto: em(foto), pdf: em(pdf) }
}
