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
