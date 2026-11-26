/**
 * Acesso ao banco com a service_role. ATENÇÃO: essa chave ignora as regras de acesso (RLS).
 * Por isso toda consulta aqui recebe o userId resolvido pelo número verificado e filtra por ele.
 */
import { createClient } from '@supabase/supabase-js'
import { env } from './env.ts'
import { faturas, type MovCartao } from './cartao.ts'
import { construirHabitos, palavrasChave, type Contexto, type FaturaAberta } from './interpretar.ts'

export const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })

export function falhou(e: { message: string } | null, onde: string) {
  if (e) throw new Error(`${onde}: ${e.message}`)
}

/** "558198765432@s.whatsapp.net" ou "5581987654321" → chave DDD + 8 últimos dígitos ("8187654321"). */
export function chaveDoNumero(jidOuNumero: string): string | null {
  let d = jidOuNumero.split('@')[0].split(':')[0].replace(/\D/g, '')
  // Endereço do WhatsApp sempre traz o código do país. A chave guarda só DDD + 8 dígitos, então número de fora do Brasil (Peru, +51 9...) cairia
  // na chave de um cliente do DDD 51 e leria o financeiro dele. Remetente do WhatsApp que não é +55 não tem chave (é ignorado).
  if (/@s\.whatsapp\.net$/.test(jidOuNumero) && !d.startsWith('55')) return null
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
  const [p, cats, carts, contas, fixas] = await Promise.all([
    sb.from('perfis').select('ramo').eq('id', userId).single(),
    sb.from('categorias').select('id,nome,tipo,pessoal').eq('user_id', userId),
    sb.from('carteiras').select('id,nome,tipo,padrao,fechamento,vencimento,conta_pagamento_id').eq('user_id', userId),
    sb.from('contas').select('id,descricao,valor,vencimento,tipo').eq('user_id', userId).eq('status', 'aberta').order('vencimento').limit(40),
    sb.from('fixas').select('id,descricao,valor,dia').eq('user_id', userId).order('dia').limit(40),
  ])
  for (const [r, n] of [[p, 'perfil'], [cats, 'categorias'], [carts, 'carteiras'], [contas, 'contas']] as const) falhou(r.error, 'contexto ' + n)
  // As contas fixas só servem para "a internet agora é 109": se a leitura falhar, registrar o resto da conversa não pode parar por isso.
  if (fixas.error) console.error('[contexto] não consegui ler as contas fixas (o registro segue sem elas):', fixas.error.message)
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
  // Em que conta o cliente costuma lançar cada coisa (só vira hábito com 2 ou 3 vezes seguidas na mesma conta).
  const hab = await sb.from('lancamentos').select('descricao,tipo,carteira_id,data').eq('user_id', userId).in('tipo', ['entrada', 'saida']).order('data', { ascending: false }).limit(300)
  falhou(hab.error, 'contexto: conta habitual')
  const habitoCarteira = construirHabitos(hab.data ?? [])
  return {
    hoje,
    ramo: p.data?.ramo || undefined,
    lembrancaPessoal,
    habitoCarteira,
    poucosRegistros: (hab.data ?? []).length < 5,
    categorias,
    carteiras,
    contasAbertas: (contas.data ?? []).map((c) => ({ ...c, valor: Number(c.valor) })),
    fixas: fixas.error ? undefined : (fixas.data ?? []).map((f) => ({ id: f.id as string, descricao: f.descricao as string, valor: Number(f.valor), dia: Number(f.dia) })),
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
/**
 * Cadastros que DIGITARAM este número e ainda não confirmaram (pode haver mais de um: a pessoa criou duas contas). Não é cliente reconhecido: serve
 * só para honrar o SAIR de quem recebeu uma mensagem nossa e para mostrar como terminar o cadastro a quem escreveu.
 */
export async function cadastrosPendentesDoNumero(jid: string): Promise<{ id: string; nome: string; avisos_off: boolean }[]> {
  const chave = chaveDoNumero(jid)
  if (!chave) return []
  const { data, error } = await sb.from('perfis').select('id,nome,avisos_off').eq('whats_chave', chave).eq('whats_verificado', false).eq('papel', 'cliente').is('exclusao_em', null).limit(5)
  falhou(error, 'cadastrosPendentesDoNumero')
  return ((data ?? []) as { id: string; nome: string | null; avisos_off: boolean | null }[]).map((l) => ({ id: l.id, nome: l.nome ?? '', avisos_off: !!l.avisos_off }))
}

export async function silenciarLembretes(userId: string) {
  const { error } = await sb.from('perfis').update({ avisos_off: true }).eq('id', userId)
  falhou(error, 'silenciar lembretes')
}

/** Uso do mês: mensagens que viraram lançamento e mídias (áudio, foto, PDF) recebidas. */
export async function usoDoMes(userId: string, inicioMes: string) {
  const base = () => sb.from('mensagens').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('criado_em', inicioMes)
  // Mensagem juntada pela espera de 10 s (rajada.ts) fica 'ignorada' com "juntada em <id>": conta como contava antes da espera existir, senão
  // 15 mensagens numa rajada valeriam 1 no limite.
  const [l, j, m] = await Promise.all([base().eq('status', 'ok'), base().eq('status', 'ignorada').like('erro', 'juntada em %'), base().in('tipo', ['audio', 'foto', 'pdf'])])
  falhou(l.error, 'uso')
  falhou(j.error, 'uso')
  falhou(m.error, 'uso')
  return { lancamentos: (l.count ?? 0) + (j.count ?? 0), midias: m.count ?? 0 }
}
