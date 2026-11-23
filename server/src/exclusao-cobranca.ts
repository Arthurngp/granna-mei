/**
 * Cobrança de quem pediu para excluir a conta (item f5-exclusao-cobranca).
 *
 * O pedido de exclusão é gravado pelo painel direto no banco (perfis.exclusao_em), sem passar por servidor, e a conta só some 30 dias depois.
 * Nesse prazo a assinatura seguiria cobrando. Este varredor roda no batimento e resolve dos dois lados, de forma idempotente:
 *   1) quem tem exclusao_em: a cobrança para no fim do período já pago (cancel_at_period_end, com a marca da Granninha na assinatura);
 *   2) quem desistiu (exclusao_em voltou a ser nulo) e foi a Granninha que parou a cobrança: a assinatura volta a renovar.
 * O cancelamento que a própria pessoa fez no portal da Stripe nunca é desfeito aqui (sem a marca, não se toca).
 * A exclusão definitiva continua cancelando de vez (cancelarAssinaturaDe), e uma assinatura já marcada ou já encerrada não a trava.
 * Sem Stripe ligada, nada acontece.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { pararCobrancaPorExclusao, religarCobrancaSeDesistiu, stripe } from './cobranca-stripe.ts'

/** Entre uma volta e outra: o batimento é de 1 minuto, mas a Stripe não precisa ser consultada tanto. */
export const INTERVALO_MS = 5 * 60_000
/** Quem já foi resolvido não é consultado de novo por este tempo (a conferência na Stripe é uma chamada de rede por pessoa). */
export const LEMBRAR_MS = 6 * 3_600_000
const MAX_POR_VOLTA = 50
const LOTE = 100

let ultima = 0
const vistas = new Map<string, number>()

/** Só para teste. */
export function zerarSincronia() {
  ultima = 0
  vistas.clear()
}

export interface Sincronia {
  paradas: number
  religadas: number
  erros: string[]
  pulou?: boolean
}

export async function sincronizarCobrancaDasExclusoes(sb: SupabaseClient, agora = Date.now()): Promise<Sincronia> {
  const r: Sincronia = { paradas: 0, religadas: 0, erros: [] }
  if (!stripe()) return r
  if (agora - ultima < INTERVALO_MS) return { ...r, pulou: true }
  ultima = agora

  // 1) Pediu a exclusão: a cobrança para no fim do período.
  const pedidos = await sb.from('perfis').select('id, exclusao_em').not('exclusao_em', 'is', null)
  if (pedidos.error) throw new Error(`procurar quem pediu exclusão: ${pedidos.error.message}`)
  let olhadas = 0
  for (const p of (pedidos.data ?? []) as { id: string; exclusao_em: string | null }[]) {
    // Confere de novo aqui: se o filtro do banco falhasse, isto mexeria na cobrança de quem nunca pediu para sair.
    if (!p.exclusao_em) continue
    if (olhadas >= MAX_POR_VOLTA) break
    if ((vistas.get(`p:${p.id}`) ?? 0) > agora) continue
    olhadas++
    try {
      const res = await pararCobrancaPorExclusao(sb, p.id)
      vistas.set(`p:${p.id}`, agora + LEMBRAR_MS)
      if (res === 'parada') r.paradas++
    } catch (e) {
      r.erros.push((e as Error).message) // sem lembrar: tenta de novo na próxima volta
    }
  }

  // 2) Desistiu: só entram aqui assinaturas que estão paradas no fim do período (cancela_em) e cuja conta NÃO pede mais exclusão.
  const paradas = await sb.from('assinaturas').select('user_id').not('cancela_em', 'is', null).not('stripe_subscription_id', 'is', null)
  if (paradas.error) throw new Error(`procurar assinaturas paradas: ${paradas.error.message}`)
  const ids = ((paradas.data ?? []) as { user_id: string }[]).map((a) => a.user_id)
  let religadasOlhadas = 0
  for (let i = 0; i < ids.length; i += LOTE) {
    const perfis = await sb.from('perfis').select('id, exclusao_em').in('id', ids.slice(i, i + LOTE))
    if (perfis.error) throw new Error(`ler perfis das assinaturas paradas: ${perfis.error.message}`)
    for (const p of (perfis.data ?? []) as { id: string; exclusao_em: string | null }[]) {
      if (p.exclusao_em) continue // ainda quer sair: a cobrança segue parada
      if (religadasOlhadas >= MAX_POR_VOLTA) break
      if ((vistas.get(`d:${p.id}`) ?? 0) > agora) continue
      religadasOlhadas++
      try {
        const res = await religarCobrancaSeDesistiu(sb, p.id)
        vistas.set(`d:${p.id}`, agora + LEMBRAR_MS)
        if (res === 'religada') {
          r.religadas++
          vistas.delete(`p:${p.id}`) // se pedir a exclusão de novo, é uma conta nova para parar
        }
      } catch (e) {
        r.erros.push((e as Error).message)
      }
    }
  }
  return r
}
