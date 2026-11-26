/**
 * Preço de cada modelo de IA, para o custo de cada mensagem sair pelo modelo que RODOU (pedido do Arthur em 2026-11-25: "eu quero que seja
 * real e aplicado a escolha de llm, não pode ficar errado"). Antes o admin calculava tudo com o preço do gpt-5.4-mini, fosse qual fosse o
 * modelo escolhido, e não havia registro de qual modelo respondeu.
 *
 * Valores em US$ por 1 milhão de tokens (entrada cheia, entrada lida do cache, saída). AJUSTE AQUI quando o preço mudar; a fonte de cada linha
 * está ao lado. Modelo que não está na tabela usa o preço do MAIS CARO da mesma família (nunca subestima) e a mensagem fica marcada com
 * `sem_preco` em `ia_chamadas`.
 * Transcrição de áudio: por 1 milhão de tokens de áudio, ou por minuto quando a API devolve só a duração.
 */
import type { ChamadaIA } from './openai.ts'

export interface Preco {
  entrada: number
  cache: number
  saida: number
  /** Áudio: por 1M tokens de áudio de entrada e por minuto. */
  audioToken?: number
  audioMinuto?: number
}

export const PRECOS: Record<string, Preco> = {
  // OpenAI, tier standard, conferido em 25/11/2026 em https://developers.openai.com/api/docs/pricing. Raciocínio do gpt-5.x é cobrado como saída.
  // gpt-5.4 e gpt-5.5 dobram a entrada acima de 272K tokens de prompt: nossas mensagens ficam em ~3K, então vale a faixa de baixo.
  'gpt-4.1-nano': { entrada: 0.1, cache: 0.025, saida: 0.4 }, // DESLIGADO pela OpenAI (página do modelo diz "Shut down")
  'gpt-4o-mini': { entrada: 0.15, cache: 0.075, saida: 0.6 },
  'gpt-4.1-mini': { entrada: 0.4, cache: 0.1, saida: 1.6 },
  'gpt-5.4-mini': { entrada: 0.75, cache: 0.075, saida: 4.5 },
  'gpt-5.4': { entrada: 2.5, cache: 0.25, saida: 15 },
  'gpt-5.5': { entrada: 5, cache: 0.5, saida: 30 },
  'gpt-4.1': { entrada: 2, cache: 0.5, saida: 8 },
  'gpt-4o': { entrada: 2.5, cache: 1.25, saida: 10 },
  // Transcrição: a OpenAI publica só "audio tokens" de entrada; o texto de entrada (prompt) é quase zero aqui e vai pelo preço do áudio.
  'gpt-4o-mini-transcribe': { entrada: 1.25, cache: 1.25, saida: 5, audioToken: 1.25, audioMinuto: 0.003 }, // marcado Deprecated
  'gpt-4o-transcribe': { entrada: 2.5, cache: 2.5, saida: 10, audioToken: 2.5, audioMinuto: 0.006 }, // marcado Deprecated
  'whisper-1': { entrada: 0, cache: 0, saida: 0, audioMinuto: 0.006 },
  // Anthropic, conferido em 25/11/2026 em https://platform.claude.com/docs/en/about-claude/pricing (cache = leitura do cache). Pensamento é cobrado como saída.
  // Haiku 5.5 cobra 5x acima de 100K tokens de prompt: fora do nosso caso.
  'claude-haiku-5-5': { entrada: 0.1, cache: 0.01, saida: 0.5 },
  'claude-sonnet-5-5': { entrada: 2, cache: 0.1, saida: 10 },
  'claude-opus-5-5': { entrada: 4, cache: 0.2, saida: 20 },
  'claude-fable-5-2': { entrada: 8, cache: 0.2, saida: 40 },
}

/** O preço para um modelo: o dele, ou o mais caro conhecido do mesmo provedor quando ele não está na tabela. */
export function precoDe(modelo: string): { preco: Preco; conhecido: boolean } {
  const exato = PRECOS[modelo]
  if (exato) return { preco: exato, conhecido: true }
  const mesmos = Object.entries(PRECOS).filter(([m]) => (/^claude/i.test(m) ? 'a' : 'o') === (/^claude/i.test(modelo) ? 'a' : 'o')).map(([, p]) => p)
  const caro = mesmos.sort((a, b) => b.saida - a.saida)[0] ?? PRECOS['gpt-5.4-mini']
  return { preco: caro, conhecido: false }
}

/** Custo em dólar de uma chamada. A parte lida do cache paga o preço de cache; o resto da entrada, o preço cheio. */
export function custoDaChamada(c: ChamadaIA): number {
  const { preco } = precoDe(c.modelo)
  const cache = Math.min(c.cache ?? 0, c.entrada)
  let usd = ((c.entrada - cache) * preco.entrada + cache * preco.cache + c.saida * preco.saida) / 1_000_000
  if (c.audio) usd += (c.audio * (preco.audioToken ?? preco.entrada)) / 1_000_000
  if (c.audioSeg) usd += (c.audioSeg / 60) * (preco.audioMinuto ?? 0)
  return usd
}

/** Custo em dólar de todas as chamadas de uma mensagem, arredondado a 6 casas (o que cabe na coluna). */
export function custoUsd(chamadas: ChamadaIA[]): number {
  let total = 0
  for (const c of chamadas as (ChamadaIA & { sem_preco?: boolean; usd?: number })[]) {
    if (!precoDe(c.modelo).conhecido) c.sem_preco = true
    const usd = custoDaChamada(c)
    c.usd = Math.round(usd * 1e8) / 1e8
    total += usd
  }
  return Math.round(total * 1e6) / 1e6
}

/**
 * Antes da migration `custopormodelo` as colunas `ia_chamadas` e `custo_usd` não existem: grava sem elas por um tempo e volta a tentar depois,
 * porque a migration pode rodar com o app já no ar (mesmo jeito da coluna `evento`).
 */
let faltouEm = 0
export const semColunaCusto = () => faltouEm > 0 && Date.now() - faltouEm < 600_000
export const marcarColunaCustoFaltando = () => {
  faltouEm = Date.now()
  console.error('[custo] colunas ia_chamadas/custo_usd não existem: custo por modelo fica de fora até a migration custopormodelo rodar')
}
