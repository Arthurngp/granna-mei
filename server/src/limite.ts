/**
 * Limite mensal de uso: o que vale para cada cliente e o que a Granninha diz quando ele chega lá.
 *
 * O NÚMERO do limite não aparece em nenhum texto ao cliente (decisão do Arthur em 2026-11-21): ele não vê quantos lançamentos tem
 * por mês. Escrever "300" aqui criaria uma promessa que o admin não quer assumir e que ele muda sem avisar ninguém.
 *
 * Quem vale, nesta ordem: o limite PRÓPRIO do cliente, o PADRÃO de todos (os dois definidos no admin e guardados no banco) e, por
 * último, o valor de fábrica (300, ou a variável LIMITE_LANCAMENTOS). Zero, negativo, texto ou número quebrado nunca valem: um limite
 * 0 bloquearia todo mundo por engano. Falhou a leitura do banco, ou a migration ainda não rodou: usa o valor de fábrica e segue
 * atendendo, em vez de derrubar a conversa por causa de um número de configuração.
 */
import { sb } from './banco.ts'

export const TEXTO_LIMITE_LANCAMENTOS = 'Você chegou ao limite de uso deste mês. No dia 1 o contador zera. Se precisar de mais, fala com a gente pelo painel.'
export const TEXTO_LIMITE_MIDIAS = 'Você chegou ao limite de áudios, fotos e PDFs deste mês. Texto continua funcionando normal, e no dia 1 o contador zera.'
export const AVISO_PERTO_DO_LIMITE = 'Aviso: você está chegando perto do limite de uso do mês.'

export const LIMITE_DE_FABRICA = 300
export const LIMITE_MIDIAS_DE_FABRICA = 100

/** Inteiro de 1 a 100000 (a mesma faixa do banco), vindo de número ou de texto. Qualquer outra coisa: null. */
export function limiteValido(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null
}

/** Lido na hora (não ao carregar o módulo), e nunca 0: variável vazia ou quebrada cai no valor de fábrica. */
export const limiteDoAmbiente = () => limiteValido(process.env.LIMITE_LANCAMENTOS) ?? LIMITE_DE_FABRICA
export const limiteDeMidias = () => limiteValido(process.env.LIMITE_MIDIAS) ?? LIMITE_MIDIAS_DE_FABRICA

export type FonteDoLimite = 'cliente' | 'padrao' | 'ambiente'

/** O padrão de todos muda raramente: guardado por um minuto para não somar uma consulta a cada mensagem. */
const TTL_MS = 60_000
let padraoEmCache: { valor: number | null; ate: number } | null = null
/** Depois de uma falha de leitura, fica um minuto sem tentar (migration ainda não rodada, banco com solavanco). */
let pausadoAte = 0
let avisouEm = 0

/** Para os testes, e para quando se quer valer a mudança na hora. */
export function limparCacheDoLimite() {
  padraoEmCache = null
  pausadoAte = 0
  avisouEm = 0
}

async function padraoDoBanco(): Promise<number | null> {
  const agora = Date.now()
  if (padraoEmCache && padraoEmCache.ate > agora) return padraoEmCache.valor
  const { data, error } = await sb.from('config_limite').select('lancamentos').eq('id', true).maybeSingle()
  if (error) throw new Error('config_limite: ' + error.message)
  const valor = limiteValido(data?.lancamentos)
  padraoEmCache = { valor, ate: agora + TTL_MS }
  return valor
}

/** Quantos lançamentos por mês este cliente pode fazer, e de onde veio o número. */
export async function limiteDoCliente(userId: string): Promise<{ limite: number; fonte: FonteDoLimite }> {
  if (Date.now() >= pausadoAte) {
    try {
      const [proprio, padrao] = await Promise.all([sb.from('limite_cliente').select('lancamentos').eq('user_id', userId).maybeSingle(), padraoDoBanco()])
      if (proprio.error) throw new Error('limite_cliente: ' + proprio.error.message)
      const meu = limiteValido(proprio.data?.lancamentos)
      if (meu !== null) return { limite: meu, fonte: 'cliente' }
      if (padrao !== null) return { limite: padrao, fonte: 'padrao' }
    } catch (e) {
      const agora = Date.now()
      pausadoAte = agora + TTL_MS
      if (agora - avisouEm > TTL_MS) {
        avisouEm = agora
        console.warn('limite: não consegui ler o limite no banco, usando o valor de fábrica:', (e as Error).message)
      }
    }
  }
  return { limite: limiteDoAmbiente(), fonte: 'ambiente' }
}
