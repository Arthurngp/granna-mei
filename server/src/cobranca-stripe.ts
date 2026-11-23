/**
 * Cliente da Stripe, sem depender do banco do app (assim a exclusão de conta pode usar sem puxar o resto).
 * Sem STRIPE_SECRET_KEY o recurso inteiro fica DESLIGADO: nada aqui chama a Stripe e o painel mostra o aviso de sempre.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

let cliente: Stripe | null | undefined

export function stripe(): Stripe | null {
  if (cliente !== undefined) return cliente
  const chave = process.env.STRIPE_SECRET_KEY
  cliente = chave ? new Stripe(chave, { maxNetworkRetries: 2, appInfo: { name: 'granninha' } }) : null
  return cliente
}

/** Só para teste: troca o cliente pelo falso (ou null para desligar). */
export function trocarStripeParaTeste(c: Stripe | null | undefined) {
  cliente = c
}

export const ASSINATURA_VIVA = ['trialing', 'active', 'past_due', 'unpaid']

/**
 * Cancela na Stripe a assinatura da conta ANTES de ela ser excluída. Sem isso, a conta some do app e o cartão
 * do cliente continua sendo cobrado todo mês. Se não conseguir cancelar, lança o erro: é melhor a exclusão
 * parar com mensagem do que apagar a conta e seguir cobrando em silêncio.
 * Sem Stripe ligada, ou sem assinatura na Stripe, não faz nada.
 */
export async function cancelarAssinaturaDe(sb: SupabaseClient, userId: string): Promise<'nada' | 'cancelada'> {
  const s = stripe()
  if (!s) return 'nada'
  const a = await sb.from('assinaturas').select('stripe_subscription_id').eq('user_id', userId).maybeSingle()
  // Coluna ainda não criada (migration não rodou): não há o que cancelar.
  if (a.error && (a.error.code === '42703' || a.error.code === 'PGRST204' || /stripe_subscription_id/.test(a.error.message))) return 'nada'
  if (a.error) throw new Error(`ler assinatura para cancelar na Stripe: ${a.error.message}`)
  const id = (a.data as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id
  if (!id) return 'nada'
  try {
    const sub = await s.subscriptions.retrieve(id)
    if (!ASSINATURA_VIVA.includes(sub.status)) return 'nada'
    await s.subscriptions.cancel(id)
    return 'cancelada'
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; message: string }
    if (err.code === 'resource_missing' || err.statusCode === 404) return 'nada'
    throw new Error(`não consegui cancelar a assinatura na Stripe (${id}), por isso a conta NÃO foi excluída: ${err.message}`)
  }
}

/**
 * Marca que a Granninha põe na assinatura da Stripe quando É ELA que para a cobrança por causa de um pedido de exclusão de conta.
 * É o que separa "parei por causa da exclusão" de "a própria pessoa cancelou no portal": só o primeiro caso é desfeito se ela desistir da exclusão.
 */
export const MARCA_EXCLUSAO = 'cancelada_por_pedido_de_exclusao'

async function idDaAssinatura(sb: SupabaseClient, userId: string): Promise<string | null> {
  const a = await sb.from('assinaturas').select('stripe_subscription_id').eq('user_id', userId).maybeSingle()
  if (a.error && (a.error.code === '42703' || a.error.code === 'PGRST204' || /stripe_subscription_id/.test(a.error.message))) return null
  if (a.error) throw new Error(`ler assinatura na Stripe: ${a.error.message}`)
  return (a.data as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ?? null
}

const semAssinatura = (e: unknown) => {
  const err = e as { code?: string; statusCode?: number }
  return err.code === 'resource_missing' || err.statusCode === 404
}

/**
 * Quem PEDE a exclusão fica 30 dias antes de a conta sumir, e nesse prazo a assinatura seguiria cobrando. Aqui a cobrança para no FIM do período
 * já pago (cancel_at_period_end): a pessoa não é cobrada de novo e mantém o acesso até acabar o que pagou, e dá para desfazer se ela desistir
 * (religarCobrancaSeDesistiu). Cancelar na hora tiraria o plano de quem volta atrás. Se a assinatura já vai parar (a pessoa cancelou sozinha, ou
 * já marcamos), não mexe em nada, nem na marca. Sem Stripe ligada, ou sem assinatura, não faz nada.
 */
export async function pararCobrancaPorExclusao(sb: SupabaseClient, userId: string): Promise<'nada' | 'parada' | 'ja_parando'> {
  const s = stripe()
  if (!s) return 'nada'
  const id = await idDaAssinatura(sb, userId)
  if (!id) return 'nada'
  try {
    const sub = await s.subscriptions.retrieve(id)
    if (!ASSINATURA_VIVA.includes(sub.status)) return 'nada'
    if (sub.cancel_at_period_end || sub.cancel_at) return 'ja_parando'
    await s.subscriptions.update(id, { cancel_at_period_end: true, metadata: { [MARCA_EXCLUSAO]: '1' } })
    return 'parada'
  } catch (e) {
    if (semAssinatura(e)) return 'nada'
    throw new Error(`não consegui parar a cobrança na Stripe (${id}): ${(e as Error).message}`)
  }
}

/**
 * A pessoa desistiu da exclusão: se FOI a Granninha que parou a cobrança (a marca está na assinatura), a assinatura volta a renovar.
 * Se o cancelamento é decisão da própria pessoa (sem a marca), não se mexe: religar isso seria cobrar quem pediu para não ser cobrado.
 */
export async function religarCobrancaSeDesistiu(sb: SupabaseClient, userId: string): Promise<'nada' | 'religada'> {
  const s = stripe()
  if (!s) return 'nada'
  const id = await idDaAssinatura(sb, userId)
  if (!id) return 'nada'
  try {
    const sub = await s.subscriptions.retrieve(id)
    if (!ASSINATURA_VIVA.includes(sub.status)) return 'nada'
    if (sub.metadata?.[MARCA_EXCLUSAO] !== '1') return 'nada'
    if (!sub.cancel_at_period_end) {
      // A marca ficou, mas a assinatura já não está parando (a pessoa renovou pelo portal): só limpa a marca.
      await s.subscriptions.update(id, { metadata: { [MARCA_EXCLUSAO]: '' } })
      return 'nada'
    }
    await s.subscriptions.update(id, { cancel_at_period_end: false, metadata: { [MARCA_EXCLUSAO]: '' } })
    return 'religada'
  } catch (e) {
    if (semAssinatura(e)) return 'nada'
    throw new Error(`não consegui religar a cobrança na Stripe (${id}): ${(e as Error).message}`)
  }
}
