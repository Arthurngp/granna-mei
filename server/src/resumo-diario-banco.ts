/**
 * As consultas reais do resumo diário de contas (ver resumo-diario.ts). Reaproveita do aviso de vencimento tudo que é igual (contas, telefone,
 * reserva atômica na tabela `avisos`) e acrescenta só a leitura de QUEM está liberado.
 *
 * ATENÇÃO: usa a service_role, que ignora as regras de acesso. Toda consulta filtra por user_id.
 *
 * A leitura de quem está liberado é a parte que não pode errar para o lado de "todos":
 *  - tabela ausente (migration não rodou): ninguém está liberado, em silêncio;
 *  - qualquer outro erro: lança, o ciclo registra e não envia nada;
 *  - o que volta é conferido de novo aqui, perfil a perfil: se um filtro do banco falhasse, só entram ids que de fato estão na lista de
 *    liberados, e nunca quem respondeu SAIR.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { depsAvisosDoBanco } from './avisos-banco.ts'
import { RECURSO_RESUMO, type DepsResumo, type PerfilResumo } from './resumo-diario.ts'

const LOTE = 100

/** A tabela ainda não existe (migration recursos_cliente não rodou). Só isto vira "ninguém"; outro erro nunca. */
export function tabelaAusente(e: { code?: string; message: string }): boolean {
  return e.code === '42P01' || e.code === 'PGRST205' || (/recursos_cliente/.test(e.message) && /does not exist|schema cache|could not find/i.test(e.message))
}

export function depsResumoDoBanco(sb: SupabaseClient, enviar: (telefone: string, texto: string) => Promise<void>): DepsResumo {
  const base = depsAvisosDoBanco(sb, enviar)
  return {
    contas: base.contas,
    telefoneDe: base.telefoneDe,
    jaAvisadas: base.jaAvisadas,
    reservar: base.reservar,
    concluir: base.concluir,
    enviar: base.enviar,
    esperar: base.esperar,

    async liberados(hhmm) {
      const r = await sb.from('recursos_cliente').select('user_id').eq('recurso', RECURSO_RESUMO)
      if (r.error) {
        if (tabelaAusente(r.error)) return []
        throw new Error(`resumo diário, ler quem tem o recurso: ${r.error.message}`)
      }
      const liberados = new Set(((r.data ?? []) as { user_id: string }[]).map((x) => x.user_id))
      if (!liberados.size) return []
      const ids = [...liberados]
      const out: PerfilResumo[] = []
      for (let i = 0; i < ids.length; i += LOTE) {
        const lote = ids.slice(i, i + LOTE)
        const p = await sb
          .from('perfis')
          .select('id, nome, whats, whats_chave, lembrete_hora, antecedencia, ocultar, exclusao_em, avisos_off')
          .in('id', lote)
          .eq('whats_verificado', true)
          .is('exclusao_em', null)
          .lte('lembrete_hora', hhmm)
        if (p.error) throw new Error(`resumo diário, perfis dos liberados: ${p.error.message}`)
        const a = await sb.from('assinaturas').select('user_id, status, trial_fim').in('user_id', lote)
        if (a.error) throw new Error(`resumo diário, assinaturas dos liberados: ${a.error.message}`)
        const assin = new Map(((a.data ?? []) as { user_id: string; status: string; trial_fim: string | null }[]).map((x) => [x.user_id, { status: x.status, trial_fim: x.trial_fim }]))
        for (const x of (p.data ?? []) as (Omit<PerfilResumo, 'assinatura' | 'ocultar' | 'avisos_off'> & { ocultar: boolean | null; avisos_off: boolean | null })[]) {
          if (!liberados.has(x.id)) continue // conferido de novo: só entra quem está de fato na lista de liberados
          if (x.avisos_off) continue // respondeu SAIR
          out.push({ ...x, ocultar: !!x.ocultar, avisos_off: false, assinatura: assin.get(x.id) ?? null })
        }
      }
      return out
    },
  }
}
