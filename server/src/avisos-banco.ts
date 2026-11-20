/**
 * As consultas reais do aviso de conta vencendo (ver avisos.ts). Separado para o ciclo poder ser testado a seco
 * e para este arquivo poder ser testado contra o banco falso, com as consultas de verdade.
 *
 * ATENÇÃO: usa a service_role, que ignora as regras de acesso. Toda consulta filtra por user_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContaAviso, DepsAvisos, PerfilAviso } from './avisos.ts'

const LOTE = 100

function falha(onde: string, e: { message: string } | null) {
  if (e) throw new Error(`avisos ${onde}: ${e.message}`)
}

export function depsAvisosDoBanco(sb: SupabaseClient, enviar: (telefone: string, texto: string) => Promise<void>): DepsAvisos {
  return {
    async perfis(hhmm) {
      const { data, error } = await sb
        .from('perfis')
        .select('id, nome, whats, whats_chave, lembrete_hora, antecedencia, ocultar, exclusao_em')
        .eq('whats_verificado', true)
        .is('exclusao_em', null)
        .lte('lembrete_hora', hhmm)
      falha('perfis', error)
      const base = (data ?? []) as Omit<PerfilAviso, 'assinatura'>[]
      const assinaturas = new Map<string, { status: string; trial_fim: string | null }>()
      for (let i = 0; i < base.length; i += LOTE) {
        const ids = base.slice(i, i + LOTE).map((p) => p.id)
        const r = await sb.from('assinaturas').select('user_id, status, trial_fim').in('user_id', ids)
        falha('assinaturas', r.error)
        for (const a of (r.data ?? []) as { user_id: string; status: string; trial_fim: string | null }[]) assinaturas.set(a.user_id, { status: a.status, trial_fim: a.trial_fim })
      }
      return base.map((p) => ({ ...p, ocultar: !!p.ocultar, assinatura: assinaturas.get(p.id) ?? null }))
    },

    async contas(userId, de, ate) {
      const { data, error } = await sb
        .from('contas')
        .select('id, descricao, valor, vencimento')
        .eq('user_id', userId)
        .eq('tipo', 'pagar')
        .eq('status', 'aberta')
        .gte('vencimento', de)
        .lte('vencimento', ate)
        .order('vencimento')
      falha('contas', error)
      return ((data ?? []) as { id: string; descricao: string; valor: number | string; vencimento: string }[]).map(
        (c): ContaAviso => ({ id: c.id, descricao: c.descricao, valor: Number(c.valor), vencimento: c.vencimento }),
      )
    },

    async telefoneDe(p) {
      // O número em que a pessoa realmente escreveu: é o que o WhatsApp aceita (às vezes sem o nono dígito).
      const { data, error } = await sb
        .from('mensagens')
        .select('telefone')
        .eq('user_id', p.id)
        .in('status', ['ok', 'pergunta'])
        .order('criado_em', { ascending: false })
        .limit(1)
      falha('telefone', error)
      const t = String((data as { telefone: string }[] | null)?.[0]?.telefone ?? '').replace(/\D/g, '')
      if (t.length >= 10) return t
      // Ainda não conversou: usa o número cadastrado e verificado.
      const d = (p.whats ?? '').replace(/\D/g, '')
      if (d.length === 10 || d.length === 11) return '55' + d
      if (d.length >= 12 && d.startsWith('55')) return d
      return null
    },

    async jaAvisadas(userId, chaves) {
      const ja = new Set<string>()
      for (let i = 0; i < chaves.length; i += LOTE) {
        const { data, error } = await sb.from('avisos').select('chave').eq('user_id', userId).in('chave', chaves.slice(i, i + LOTE))
        falha('consultar avisos', error)
        for (const r of (data ?? []) as { chave: string }[]) ja.add(r.chave)
      }
      return ja
    },

    async reservar(userId, telefone, itens) {
      const linhas = itens.map((i) => ({ chave: i.chave, user_id: userId, tipo: 'vencimento', referencia: i.referencia, para: telefone, status: 'enviando' }))
      // ignoreDuplicates: o insert devolve só as linhas que ELE criou. Quem reserva primeiro é quem envia.
      const { data, error } = await sb.from('avisos').upsert(linhas, { onConflict: 'chave', ignoreDuplicates: true }).select('chave')
      falha('reservar', error)
      return ((data ?? []) as { chave: string }[]).map((r) => r.chave)
    },

    async concluir(userId, chaves, enviado) {
      if (!chaves.length) return
      const q = enviado
        ? await sb.from('avisos').update({ status: 'enviado', enviado_em: new Date().toISOString() }).eq('user_id', userId).in('chave', chaves)
        : await sb.from('avisos').delete().eq('user_id', userId).in('chave', chaves)
      falha(enviado ? 'marcar enviado' : 'soltar reserva', q.error)
    },

    enviar,
    esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)),
  }
}
