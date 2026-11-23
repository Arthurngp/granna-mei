/**
 * As consultas reais da reposição das contas fixas (ver fixas-repor.ts).
 *
 * ATENÇÃO: usa a service_role, que ignora as regras de acesso. Lê as tabelas inteiras, de mil em mil linhas, até vir uma página curta: com a
 * lista cortada a "última ocorrência" de uma fixa seria uma mais antiga e o passo criaria contas de meses que a pessoa JÁ TEM.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DepsRepor, FixaRep, NovaConta, OcorrenciaRep } from './fixas-repor.ts'

const PAGINA = 1000
const LOTE_GRAVACAO = 200

type Pagina = { data: unknown[] | null; error: { message: string } | null }

/** Lê todas as páginas de uma consulta. `consulta(de, ate)` deve devolver a faixa pedida, na mesma ordem a cada chamada. */
async function lerTudo<T>(nome: string, consulta: (de: number, ate: number) => PromiseLike<Pagina>): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const r = await consulta(de, de + PAGINA - 1)
    if (r.error) throw new Error(`reposição das fixas, ${nome}: ${r.error.message}`)
    const pagina = (r.data ?? []) as T[]
    out.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  return out
}

export function depsReporDoBanco(sb: SupabaseClient): DepsRepor {
  return {
    async fixas() {
      // Só entram contas de cliente que NÃO pediram exclusão: admin e quem está saindo ficam de fora.
      const perfis = await lerTudo<{ id: string; papel: string; exclusao_em: string | null }>('perfis', (de, ate) =>
        sb.from('perfis').select('id, papel, exclusao_em').order('id').range(de, ate),
      )
      const permitidos = new Set(perfis.filter((p) => p.papel === 'cliente' && !p.exclusao_em).map((p) => p.id))
      const fixas = await lerTudo<{ user_id: string; id: string; descricao: string; valor: number | string; dia: number | string }>('fixas', (de, ate) =>
        sb.from('fixas').select('user_id, id, descricao, valor, dia').order('user_id').order('id').range(de, ate),
      )
      return fixas
        .filter((f) => permitidos.has(f.user_id)) // conferido aqui, perfil a perfil, e não só na consulta
        .map((f): FixaRep => ({ user_id: f.user_id, id: f.id, descricao: f.descricao, valor: Number(f.valor), dia: Number(f.dia) }))
    },

    async ocorrencias(userIds) {
      const linhas = await lerTudo<{ user_id: string; fixa_id: string | null; vencimento: string; tipo: string; categoria_id: string | null; das: boolean | null }>('contas', (de, ate) =>
        sb.from('contas').select('user_id, fixa_id, vencimento, tipo, categoria_id, das').in('user_id', userIds).not('fixa_id', 'is', null).order('user_id').order('id').range(de, ate),
      )
      return linhas
        .filter((l) => !!l.fixa_id && userIds.includes(l.user_id))
        .map((l): OcorrenciaRep => ({ user_id: l.user_id, fixa_id: l.fixa_id as string, vencimento: l.vencimento, tipo: l.tipo === 'receber' ? 'receber' : 'pagar', categoria_id: l.categoria_id, das: !!l.das }))
    },

    async gravar(linhas: NovaConta[]) {
      let criadas = 0
      for (let i = 0; i < linhas.length; i += LOTE_GRAVACAO) {
        // ignoreDuplicates: o upsert devolve só as linhas que ELE criou. É o que torna a reposição idempotente.
        const r = await sb.from('contas').upsert(linhas.slice(i, i + LOTE_GRAVACAO), { onConflict: 'user_id,id', ignoreDuplicates: true }).select('id')
        if (r.error) throw new Error(`reposição das fixas, gravar: ${r.error.message}`)
        criadas += (r.data ?? []).length
      }
      return criadas
    },
  }
}
