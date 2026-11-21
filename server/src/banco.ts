/**
 * Acesso ao banco com a service_role. ATENÇÃO: essa chave ignora as regras de acesso (RLS).
 * Por isso toda consulta aqui recebe o userId resolvido pelo número verificado e filtra por ele.
 */
import { createClient } from '@supabase/supabase-js'
import { env } from './env.ts'
import { faturas, type MovCartao } from './cartao.ts'
import { palavrasChave, type Contexto, type FaturaAberta } from './interpretar.ts'

export const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })

export function falhou(e: { message: string } | null, onde: string) {
  if (e) throw new Error(`${onde}: ${e.message}`)
}

/** "558198765432@s.whatsapp.net" ou "5581987654321" → chave DDD + 8 últimos dígitos ("8187654321"). */
export function chaveDoNumero(jidOuNumero: string): string | null {
  let d = jidOuNumero.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length < 10) return null
  return d.slice(0, 2) + d.slice(-8)
}

/** "558198765432" → "(81) 98765-4321" (repõe o nono dígito de celular, que o WhatsApp às vezes omite). */
export function formatarNumero(jid: string): string {
  let d = jid.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  const ddd = d.slice(0, 2)
  let n = d.slice(2)
  if (n.length === 8 && /[6-9]/.test(n[0])) n = '9' + n
  return n.length === 9 ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}` : `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`
}

export interface Cliente {
  id: string
  nome: string
  negocio: string
  ramo: string
}

/**
 * Só número VERIFICADO identifica um cliente. Número só digitado no cadastro não vale.
 * Quem pediu para excluir a conta sai daqui na hora (`exclusao_em`): o acesso pelo WhatsApp acaba
 * no mesmo instante, mesmo nos segundos até o batimento soltar o número para outra conta usar.
 */
export async function clientePorNumero(jid: string): Promise<Cliente | null> {
  const chave = chaveDoNumero(jid)
  if (!chave) return null
  const { data, error } = await sb
    .from('perfis')
    .select('id,nome,negocio,ramo')
    .eq('whats_chave', chave)
    .eq('whats_verificado', true)
    .is('exclusao_em', null)
    .maybeSingle()
  falhou(error, 'clientePorNumero')
  return data as Cliente | null
}

export type Acesso = 'liberado' | 'bloqueado'
/** Mesma regra do banco (acesso_liberado), aplicada aqui porque a service_role passa por cima dela. */
export async function acessoDe(userId: string, hoje: string): Promise<{ acesso: Acesso; status: string }> {
  const { data, error } = await sb.from('assinaturas').select('status,trial_fim').eq('user_id', userId).maybeSingle()
  falhou(error, 'acessoDe')
  if (!data) return { acesso: 'bloqueado', status: 'sem assinatura' }
  const ok = ['ativa', 'atrasada', 'cortesia'].includes(data.status) || (data.status === 'trial' && data.trial_fim >= hoje)
  return { acesso: ok ? 'liberado' : 'bloqueado', status: data.status }
}

export async function contextoDe(userId: string, hoje: string): Promise<Contexto> {
  const [p, cats, carts, contas] = await Promise.all([
    sb.from('perfis').select('ramo').eq('id', userId).single(),
    sb.from('categorias').select('id,nome,tipo,pessoal').eq('user_id', userId),
    sb.from('carteiras').select('id,nome,tipo,padrao,fechamento,vencimento,conta_pagamento_id').eq('user_id', userId),
    sb.from('contas').select('id,descricao,valor,vencimento,tipo').eq('user_id', userId).eq('status', 'aberta').order('vencimento').limit(40),
  ])
  for (const [r, n] of [[p, 'perfil'], [cats, 'categorias'], [carts, 'carteiras'], [contas, 'contas']] as const) falhou(r.error, 'contexto ' + n)
  const categorias = (cats.data ?? []).map((c) => ({ ...c, pessoal: !!c.pessoal }))
  // Categoria obrigatória: sem nenhuma que sirva, o gasto vai para "Outros gastos". Se o cliente não tem, cria agora.
  if (categorias.length && !categorias.some((c) => c.id === 'outras-saidas')) {
    const r = await sb.from('categorias').upsert({ user_id: userId, id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida', cor: '#8A8FA8' }, { onConflict: 'user_id,id', ignoreDuplicates: true })
    falhou(r.error, 'criar Outros gastos')
    categorias.push({ id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida', pessoal: false })
  }
  const carteiras = carts.data ?? []
  let faturasAbertas: FaturaAberta[] = []
  const cartoes = carteiras.filter((c) => c.tipo === 'cartao')
  if (cartoes.length) {
    const ids = cartoes.map((c) => c.id)
    const [compras, pagos] = await Promise.all([
      sb.from('lancamentos').select('id,tipo,valor,data,descricao,carteira_id,carteira_destino_id,fatura').eq('user_id', userId).eq('tipo', 'compra_cartao').in('carteira_id', ids),
      sb.from('lancamentos').select('id,tipo,valor,data,descricao,carteira_id,carteira_destino_id,fatura').eq('user_id', userId).eq('tipo', 'transferencia').in('carteira_destino_id', ids),
    ])
    falhou(compras.error, 'contexto compras no cartão')
    falhou(pagos.error, 'contexto pagamentos de fatura')
    const movs = [...(compras.data ?? []), ...(pagos.data ?? [])].map(paraMov)
    faturasAbertas = faturas(movs, cartoes.map((c) => ({ id: c.id, tipo: c.tipo, fechamento: c.fechamento ?? undefined, vencimento: c.vencimento ?? undefined })))
      .filter((f) => f.falta > 0)
      .map((f) => ({ cartaoId: f.cartaoId, fatura: f.fatura, vence: f.vence, falta: f.falta }))
  }
  // Lembrança "da casa ou do negócio": como o cliente classificou os últimos gastos (a decisão mais recente vale).
  const hist = await sb.from('lancamentos').select('descricao,pessoal,data').eq('user_id', userId).in('tipo', ['saida', 'compra_cartao']).order('data', { ascending: false }).limit(300)
  falhou(hist.error, 'contexto histórico')
  const lembrancaPessoal: Record<string, boolean> = {}
  for (const l of [...(hist.data ?? [])].reverse()) for (const w of palavrasChave(l.descricao ?? '')) lembrancaPessoal[w] = !!l.pessoal
  return {
    hoje,
    ramo: p.data?.ramo || undefined,
    lembrancaPessoal,
    categorias,
    carteiras,
    contasAbertas: (contas.data ?? []).map((c) => ({ ...c, valor: Number(c.valor) })),
    faturasAbertas,
  }
}

export const HISTORICO_MAX = 6
export const HISTORICO_MIN = 30

/**
 * As últimas trocas deste cliente (até 6, dos últimos 30 minutos), da mais antiga para a mais nova, SEM a mensagem de agora.
 * Só entra o que virou conversa de verdade (resposta enviada); mensagem ignorada, bloqueada ou com erro fica de fora.
 * Serve para a IA entender "esse", "aquele", "de novo": nunca para tirar valor ou ordem.
 */
export async function historicoRecente(userId: string, excluirMsgId: string): Promise<{ cliente: string; granninha: string }[]> {
  const desde = new Date(Date.now() - HISTORICO_MIN * 60_000).toISOString()
  const { data, error } = await sb
    .from('mensagens')
    .select('texto,resposta,criado_em')
    .eq('user_id', userId)
    .in('status', ['ok', 'pergunta'])
    .neq('id', excluirMsgId)
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false })
    .limit(HISTORICO_MAX)
  falhou(error, 'histórico recente')
  return [...(data ?? [])].reverse().filter((m) => (m.texto ?? '').trim()).map((m) => ({ cliente: m.texto as string, granninha: (m.resposta as string | null) ?? '' }))
}

/** Linha do banco no formato do módulo do cartão. */
export function paraMov(l: { id: string; tipo: string; valor: number | string; data: string; descricao: string; carteira_id: string; carteira_destino_id?: string | null; categoria_id?: string | null; pessoal?: boolean | null; fatura?: string | null }): MovCartao {
  return {
    id: l.id, tipo: l.tipo as MovCartao['tipo'], valor: Number(l.valor), data: l.data, descricao: l.descricao, carteiraId: l.carteira_id,
    carteiraDestinoId: l.carteira_destino_id ?? undefined, categoriaId: l.categoria_id ?? undefined, pessoal: !!l.pessoal, fatura: l.fatura ?? undefined,
  }
}

/** SAIR: a pessoa não quer mais lembretes de uso. Só a Granninha grava (o cliente não tem permissão nessa coluna). */
export async function silenciarLembretes(userId: string) {
  const { error } = await sb.from('perfis').update({ avisos_off: true }).eq('id', userId)
  falhou(error, 'silenciar lembretes')
}

/** Uso do mês: mensagens que viraram lançamento e mídias (áudio, foto, PDF) recebidas. */
export async function usoDoMes(userId: string, inicioMes: string) {
  const base = () => sb.from('mensagens').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('criado_em', inicioMes)
  const [l, m] = await Promise.all([base().eq('status', 'ok'), base().in('tipo', ['audio', 'foto', 'pdf'])])
  falhou(l.error, 'uso')
  falhou(m.error, 'uso')
  return { lancamentos: l.count ?? 0, midias: m.count ?? 0 }
}
