/**
 * Exclusão de conta: pelo admin, o corte de acesso na hora e o prazo de 30 dias.
 * Cliente Supabase falso, sem banco e sem IA.
 *   npx tsx test/excluir.ts
 */
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroExclusao, excluirContaDefinitivo, excluirVencidas, soltarNumerosDeExcluidas } from '../src/excluir.ts'

interface Perfil {
  id: string
  nome?: string
  negocio?: string
  whats?: string
  papel?: string
  exclusao_em?: string | null
  whats_verificado?: boolean
}

function fake(opts: { perfis?: Perfil[]; falhaStorage?: boolean; falhaUpdate?: boolean } = {}) {
  const log: string[] = []
  const perfis: Perfil[] = opts.perfis ?? [{ id: 'u-1', nome: 'Ana', negocio: 'Doces', whats: '(81) 98765-4321', papel: 'cliente', exclusao_em: null, whats_verificado: true }]
  const apagados = new Set<string>()
  const arquivos: Record<string, Record<string, { id: string | null; name: string }[]>> = {
    comprovantes: { 'u-1': [{ id: 'a', name: 'm1.jpg' }, { id: null, name: 'sub' }], 'u-1/sub': [{ id: 'b', name: 'm2.pdf' }] },
    avatares: { 'u-1': [{ id: 'c', name: 'foto-1.jpg' }] },
  }
  const vivos = () => perfis.filter((p) => !apagados.has(p.id))

  const consulta = (tabela: string) => {
    const f: Record<string, unknown> = {}
    let op = 'select'
    const resolve = () => {
      if (tabela !== 'perfis') return { data: null, error: null, count: apagados.size ? 0 : 3 }
      let linhas = vivos()
      if (f.id) linhas = linhas.filter((p) => p.id === f.id)
      if (f.naoNulo === 'exclusao_em') linhas = linhas.filter((p) => p.exclusao_em)
      if (f.whats_verificado !== undefined) linhas = linhas.filter((p) => p.whats_verificado === f.whats_verificado)
      if (f.lteExclusao) linhas = linhas.filter((p) => p.exclusao_em && p.exclusao_em <= (f.lteExclusao as string))
      return { data: op === 'maybeSingle' ? (linhas[0] ?? null) : linhas, error: null, count: linhas.length }
    }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => ((f[c] = v), chain),
      is: (c: string, _v: unknown) => (log.push(`is ${tabela}.${c}`), chain),
      not: (c: string, _o: string, _v: unknown) => ((f.naoNulo = c), chain),
      lte: (c: string, v: string) => ((f.lteExclusao = v), log.push(`lte ${tabela}.${c} ${v}`), chain),
      like: (_c: string, p: string) => (log.push(`like ${tabela} ${p}`), chain),
      maybeSingle: () => ((op = 'maybeSingle'), Promise.resolve(resolve())),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(resolve()).then(ok),
      insert: (v: Record<string, unknown>) => (log.push(`insert ${tabela} ${JSON.stringify(v)}`), Promise.resolve({ error: null })),
      update: (v: Record<string, unknown>) => {
        log.push(`update ${tabela} ${JSON.stringify(v)}`)
        return {
          eq: (_c: string, id: string) => {
            if (opts.falhaUpdate) return Promise.resolve({ error: { message: 'sem permissão' } })
            const p = perfis.find((x) => x.id === id)
            if (p) Object.assign(p, v)
            return Promise.resolve({ error: null })
          },
        }
      },
      delete: () => chain,
    }
    return chain
  }

  const sb = {
    auth: {
      admin: {
        getUserById: async (id: string) =>
          !apagados.has(id) && perfis.some((p) => p.id === id)
            ? { data: { user: { id, email: 'Ana@Exemplo.com' } }, error: null }
            : { data: { user: null }, error: { message: 'not found' } },
        deleteUser: async (id: string) => (log.push('deleteUser ' + id), apagados.add(id), { error: null }),
      },
    },
    from: consulta,
    storage: {
      from: (b: string) => ({
        list: async (pasta: string) => ({ data: arquivos[b]?.[pasta] ?? [], error: null }),
        remove: async (l: string[]) => (log.push(`remove ${b} ${l.join(',')}`), { error: opts.falhaStorage ? { message: 'x' } : null }),
      }),
    },
  }
  return { sb: sb as unknown as SupabaseClient, log, perfis, apagados }
}

// ---------- Admin apaga na hora ----------
{
  const { sb, log } = fake()
  const r = await excluirContaDefinitivo(sb, 'admin-1', 'u-1', ' ana@exemplo.COM ', 'pediu para recomeçar')
  assert.equal(r.excluido, true)
  assert.equal(r.arquivos_apagados, 3)
  assert.ok(log.includes('remove comprovantes u-1/m1.jpg,u-1/sub/m2.pdf'), 'entra em subpasta')
  assert.ok(log.some((l) => l === 'like mensagens 5581%87654321'), 'mensagens soltas por telefone')
  assert.ok(log.indexOf('deleteUser u-1') > log.findIndex((l) => l.startsWith('remove')), 'arquivos antes do login')
  assert.ok(log.findIndex((l) => l.startsWith('insert admin_auditoria')) > log.indexOf('deleteUser u-1'), 'auditoria depois de apagar')
}
const barra = async (f: () => Promise<unknown>, status: number) => {
  await assert.rejects(f, (e: unknown) => e instanceof ErroExclusao && e.status === status)
}
{
  const { sb, log } = fake()
  await barra(() => excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'outro@x.com', 'motivo ok'), 400)
  await barra(() => excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'ana@exemplo.com', 'ab'), 400)
  await barra(() => excluirContaDefinitivo(sb, 'u-1', 'u-1', 'ana@exemplo.com', 'motivo ok'), 400)
  assert.ok(!log.some((l) => l.startsWith('deleteUser')), 'nenhuma trava deixa apagar')
}
{
  const { sb, log } = fake({ perfis: [{ id: 'u-1', nome: 'Chefe', papel: 'admin', whats: '', exclusao_em: null }] })
  await barra(() => excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'ana@exemplo.com', 'motivo ok'), 400)
  assert.ok(!log.some((l) => l.startsWith('deleteUser')), 'admin não é apagado')
}
{
  const { sb, log } = fake({ falhaStorage: true })
  await assert.rejects(() => excluirContaDefinitivo(sb, 'admin-1', 'u-1', 'ana@exemplo.com', 'motivo ok'))
  assert.ok(!log.some((l) => l.startsWith('deleteUser')), 'falha no storage não apaga o login')
}

// ---------- Pediu para excluir: perde o WhatsApp na hora ----------
{
  const { sb, log, perfis } = fake({
    perfis: [
      { id: 'u-1', whats: '(81) 98765-4321', exclusao_em: '2026-12-18', whats_verificado: true, papel: 'cliente' },
      { id: 'u-2', whats: '(11) 91234-5678', exclusao_em: null, whats_verificado: true, papel: 'cliente' },
    ],
  })
  const n = await soltarNumerosDeExcluidas(sb)
  assert.equal(n, 1, 'só quem pediu exclusão perde o número')
  assert.equal(perfis[0].whats_verificado, false)
  assert.equal(perfis[1].whats_verificado, true, 'quem não pediu continua atendido')
  assert.ok(log.some((l) => l === 'like conversas 5581%87654321'), 'pergunta em aberto do telefone é apagada')
  // roda de novo: não acha mais nada para soltar (idempotente)
  assert.equal(await soltarNumerosDeExcluidas(sb), 0)
}
{
  const { sb, perfis } = fake({ perfis: [{ id: 'u-1', whats: '(81) 98765-4321', exclusao_em: '2026-12-18', whats_verificado: true }], falhaUpdate: true })
  assert.equal(await soltarNumerosDeExcluidas(sb), 0, 'falha ao soltar não quebra o batimento')
  assert.equal(perfis[0].whats_verificado, true)
}

// ---------- Prazo de 30 dias ----------
const tresContas = (): Perfil[] => [
  { id: 'u-1', nome: 'Ana', negocio: 'Doces', whats: '(81) 98765-4321', exclusao_em: '2026-11-10', papel: 'cliente' },
  { id: 'u-2', nome: 'Chefe', negocio: 'NGP', whats: '', exclusao_em: '2026-11-10', papel: 'admin' },
  { id: 'u-3', nome: 'Bia', negocio: 'Bolos', whats: '(11) 91234-5678', exclusao_em: '2026-12-30', papel: 'cliente' },
]
{
  const { sb, log, apagados } = fake({ perfis: tresContas() })
  const lista = await excluirVencidas(sb, '2026-11-18', false)
  assert.equal(lista.length, 2, 'só os vencidos entram na lista')
  assert.ok(lista.every((v) => !v.apagada), 'sem EXCLUSAO_AUTOMATICA não apaga nada')
  assert.equal(apagados.size, 0)
  assert.ok(!log.some((l) => l.startsWith('deleteUser')))
}
{
  const { sb, apagados } = fake({ perfis: tresContas() })
  const lista = await excluirVencidas(sb, '2026-11-18', true)
  const porId = Object.fromEntries(lista.map((v) => [v.id, v]))
  assert.equal(porId['u-1'].apagada, true, 'cliente vencido é apagado')
  assert.equal(porId['u-2'].apagada, false, 'admin nunca é apagado pela rotina')
  assert.match(porId['u-2'].erro ?? '', /admin/)
  assert.ok(!porId['u-3'], 'quem ainda está no prazo não é tocado')
  assert.deepEqual([...apagados], ['u-1'])
}
{
  // Uma conta com problema não impede as outras de serem apagadas.
  const { sb, apagados } = fake({ perfis: [{ id: 'u-9', nome: 'Fantasma', whats: '', exclusao_em: '2026-11-01', papel: 'cliente' }, ...tresContas()], falhaStorage: false })
  const lista = await excluirVencidas(sb, '2026-11-18', true)
  assert.equal(lista.filter((v) => v.apagada).length, 2, 'u-9 e u-1 apagados')
  assert.equal(apagados.size, 2)
}
// ---------- Se o filtro do banco falhar, o código não pode fazer estrago ----------
// Simula o pior caso: a consulta devolve TODO MUNDO, inclusive quem nunca pediu exclusão.
function bancoSemFiltro(perfis: Perfil[]) {
  const log: string[] = []
  const apagados = new Set<string>()
  const chain = (tabela: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      is: () => c,
      not: () => c,
      lte: () => c,
      like: () => c,
      maybeSingle: () => Promise.resolve({ data: perfis[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: perfis, error: null, count: 0 }).then(ok),
      insert: () => Promise.resolve({ error: null }),
      update: (v: Record<string, unknown>) => ({
        eq: (_k: string, id: string) => (log.push(`desverificou ${id} ${JSON.stringify(v)}`), Promise.resolve({ error: null })),
      }),
      delete: () => c,
    }
    void tabela
    return c
  }
  const sb = {
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: 'x@y.com' } }, error: null }), deleteUser: async (id: string) => (apagados.add(id), { error: null }) } },
    from: chain,
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }) },
  }
  return { sb: sb as unknown as SupabaseClient, log, apagados }
}
{
  const ativos: Perfil[] = [
    { id: 'ativo-1', whats: '(81) 98765-4321', exclusao_em: null, whats_verificado: true, papel: 'cliente' },
    { id: 'ativo-2', whats: '(11) 91234-5678', exclusao_em: null, whats_verificado: true, papel: 'cliente' },
  ]
  const { sb, log } = bancoSemFiltro(ativos)
  assert.equal(await soltarNumerosDeExcluidas(sb), 0, 'ninguém sem data de exclusão perde o número')
  assert.equal(log.length, 0, 'nenhum update disparado')
}
{
  const { sb, apagados } = bancoSemFiltro([
    { id: 'ativo-1', whats: '', exclusao_em: null, papel: 'cliente' },
    { id: 'futuro-1', whats: '', exclusao_em: '2027-01-30', papel: 'cliente' },
  ])
  const lista = await excluirVencidas(sb, '2026-11-18', true)
  assert.equal(lista.length, 0, 'quem não venceu não é apagado nem com o banco devolvendo tudo')
  assert.equal(apagados.size, 0)
}
console.log('excluir: ok')
