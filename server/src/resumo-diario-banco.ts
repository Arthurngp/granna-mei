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
import { faturas as faturasDosCartoes, type MovCartao } from './cartao.ts'
import type { ContaAviso } from './avisos.ts'
import { RECURSO_RESUMO, type DepsResumo, type PerfilResumo } from './resumo-diario.ts'

const LOTE = 100
const PAGINA = 1000

type LinhaLanc = { id: string; tipo: string; valor: number | string; data: string; descricao: string; carteira_id: string; carteira_destino_id?: string | null; categoria_id?: string | null; pessoal?: boolean | null; fatura?: string | null }

/** Mesmo mapeamento de banco.paraMov, escrito aqui porque importar banco.ts cria o cliente do Supabase no import. */
const paraMov = (l: LinhaLanc): MovCartao => ({
  id: l.id, tipo: l.tipo as MovCartao['tipo'], valor: Number(l.valor), data: l.data, descricao: l.descricao, carteiraId: l.carteira_id,
  carteiraDestinoId: l.carteira_destino_id ?? undefined, categoriaId: l.categoria_id ?? undefined, pessoal: !!l.pessoal, fatura: l.fatura ?? undefined,
})

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

    async faturas(userId, hoje) {
      const c = await sb.from('carteiras').select('id, nome, tipo, fechamento, vencimento').eq('user_id', userId).eq('tipo', 'cartao')
      if (c.error) throw new Error(`resumo diário, cartões: ${c.error.message}`)
      const cartoes = (c.data ?? []) as { id: string; nome: string; tipo: string; fechamento: number | null; vencimento: number | null }[]
      if (!cartoes.length) return [] // sem cartão não há o que carregar
      const ids = cartoes.map((x) => x.id)
      // Compras (carteira_id) e pagamentos de fatura (carteira_destino_id) dos cartões, em páginas de 1000 até vir uma página curta. Com a lista CORTADA,
      // um pagamento ficaria de fora e uma fatura já paga apareceria como devida (e vencida: atrasada falsa).
      const porId = new Map<string, LinhaLanc>()
      for (const coluna of ['carteira_id', 'carteira_destino_id']) {
        for (let de = 0; ; de += PAGINA) {
          const r = await sb
            .from('lancamentos')
            .select('id, tipo, valor, data, categoria_id, carteira_id, carteira_destino_id, pessoal, descricao, fatura')
            .eq('user_id', userId)
            .in(coluna, ids)
            .order('data', { ascending: false })
            .order('id', { ascending: true })
            .range(de, de + PAGINA - 1)
          if (r.error) throw new Error(`resumo diário, lançamentos dos cartões: ${r.error.message}`)
          const pagina = (r.data ?? []) as LinhaLanc[]
          for (const l of pagina) porId.set(l.id, l)
          if (pagina.length < PAGINA) break
        }
      }
      const nome = new Map(cartoes.map((x) => [x.id, x.nome]))
      return faturasDosCartoes([...porId.values()].map(paraMov), cartoes.map((x) => ({ id: x.id, tipo: x.tipo, fechamento: x.fechamento ?? undefined, vencimento: x.vencimento ?? undefined })))
        .filter((f) => f.falta > 0.004 && f.vence <= hoje)
        .map((f): ContaAviso => ({ id: `fatura:${f.cartaoId}:${f.fatura}`, descricao: `Fatura ${nome.get(f.cartaoId) ?? 'do cartão'}`, valor: f.falta, vencimento: f.vence }))
    },

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
