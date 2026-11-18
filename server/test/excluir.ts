/**
 * Exclusão definitiva de conta (cliente Supabase falso, sem banco).
 *   npx tsx test/excluir.ts
 */
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroExclusao, excluirContaDefinitivo } from '../src/excluir.ts'

function fake(opts: { papel?: string; whats?: string; falhaStorage?: boolean } = {}) {
  const log: string[] = []
  let existe = true
  const arquivos: Record<string, Record<string, { id: string | null; name: string }[]>> = {
    comprovantes: { 'u-1': [{ id: 'a', name: 'm1.jpg' }, { id: null, name: 'sub' }], 'u-1/sub': [{ id: 'b', name: 'm2.pdf' }] },
    avatares: { 'u-1': [{ id: 'c', name: 'foto-1.jpg' }] },
  }
  const consulta = (tabela: string) => {
    const r = () =>
      Promise.resolve({
        data: tabela === 'perfis' ? { papel: opts.papel ?? 'cliente', nome: 'Ana', negocio: 'Doces', whats: opts.whats ?? '(81) 98765-4321' } : null,
        error: null,
        count: tabela === 'perfis' ? (existe ? 1 : 0) : existe ? 3 : 0,
      })
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: (c: string) => (log.push(`is ${tabela}.${c}`), chain),
      like: (_c: string, p: string) => (log.push(`like ${tabela} ${p}`), chain),
      maybeSingle: () => r(),
      then: (ok: (v: unknown) => unknown) => r().then(ok),
      insert: (v: Record<string, unknown>) => (log.push(`insert ${tabela} ${JSON.stringify(v)}`), Promise.resolve({ error: null })),
      delete: () => chain,
    }
    return chain
  }
  const sb = {
    auth: {
      admin: {
        getUserById: async () => (existe ? { data: { user: { id: 'u-1', email: 'Ana@Exemplo.com' } }, error: null } : { data: { user: null }, error: { message: 'not found' } }),
        deleteUser: async () => (log.push('deleteUser'), (existe = false), { error: null }),
      },
    },
    from: consulta,
    storage: {
      from: (b: string) => ({
        list: async (pasta: string) => ({ data: arquivos[b][pasta] ?? [], error: null }),
        remove: async (l: string[]) => (log.push(`remove ${b} ${l.join(',')}`), { error: opts.falhaStorage ? { message: 'x' } : null }),
      }),
    },
  }
  return { sb: sb as unknown as SupabaseClient, log }
}

// Caminho feliz
{
  const { sb, log } = fake()
  const r = await excluirContaDefinitivo(sb, 'admin-1', 'u-1', ' ana@exemplo.COM ', 'pediu para recomeçar')
  assert.equal(r.excluido, true)
  assert.equal(r.arquivos_apagados, 3)
  assert.ok(log.includes('remove comprovantes u-1/m1.jpg,u-1/sub/m2.pdf'), 'entra em subpasta')
  assert.ok(log.includes('remove avatares u-1/foto-1.jpg'))
  assert.ok(log.some((l) => l === 'like mensagens 5581%87654321'), 'mensagens soltas por telefone')
  assert.ok(log.indexOf('deleteUser') > log.findIndex((l) => l.startsWith('remove')), 'arquivos antes do login')
  assert.ok(log.findIndex((l) => l.startsWith('insert admin_auditoria')) > log.indexOf('deleteUser'), 'auditoria depois de apagar')
  assert.ok(log.some((l) => l.includes('Ana · Doces') && l.includes('ana@exemplo.com')))
}
// Travas
const barra = async (f: () => Promise<unknown>, status: number) => {
  await assert.rejects(f, (e: unknown) => e instanceof ErroExclusao && e.status === status)
}
{
  const { sb, log } = fake()
  await barra(() => excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'outro@x.com', 'motivo ok'), 400)
  await barra(() => excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'ana@exemplo.com', 'ab'), 400)
  await barra(() => excluirContaDefinitivo(sb, 'u-1', 'u-1', 'ana@exemplo.com', 'motivo ok'), 400)
  assert.ok(!log.includes('deleteUser'), 'nenhuma trava deixa apagar')
}
{
  const { sb, log } = fake({ papel: 'admin' })
  await barra(() => excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'ana@exemplo.com', 'motivo ok'), 400)
  assert.ok(!log.includes('deleteUser'), 'admin não é apagado')
}
{
  const { sb, log } = fake({ falhaStorage: true })
  await assert.rejects(() => excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'ana@exemplo.com', 'motivo ok'))
  assert.ok(!log.includes('deleteUser'), 'falha no storage não apaga o login (dá para tentar de novo)')
}
{
  const { sb } = fake({ whats: '' })
  const r = await excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'ana@exemplo.com', 'motivo ok')
  assert.equal(r.mensagens_soltas_apagadas, 0)
}
console.log('excluir: ok')
