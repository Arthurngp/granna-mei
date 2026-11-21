import { API_GRANNINHA } from './config'
import { supabase } from './supabase'

export type Pagamento = { url: string; tipo: 'checkout' | 'fatura' | 'portal' }

/**
 * Pede ao servidor a página certa da Stripe (Checkout, fatura em aberto ou portal) e devolve o endereço.
 * Qualquer problema vira texto para o cliente ler: cobrança NUNCA derruba a sessão nem expulsa ninguém do painel.
 */
export async function abrirPagamento(plano: 'mensal' | 'anual'): Promise<Pagamento> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = data.session?.access_token
  if (!token) throw new Error('Entre na sua conta de novo para continuar.')
  let r: Response
  try {
    r = await fetch(`${API_GRANNINHA}/cobranca/abrir`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plano }),
    })
  } catch {
    throw new Error('Sem conexão com o servidor. Confira sua internet e tente de novo.')
  }
  const j = (await r.json().catch(() => ({}))) as Partial<Pagamento> & { erro?: string }
  if (!r.ok || !j.url) throw new Error(j.erro || 'Não consegui abrir o pagamento agora. Tente de novo em instantes.')
  return { url: j.url, tipo: j.tipo ?? 'checkout' }
}
