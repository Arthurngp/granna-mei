/**
 * Resumo diário de contas (recurso de plano superior, liberado cliente a cliente pelo admin). Relógio, gateway e banco falsos.
 * O que está travado aqui:
 *  - sai UMA mensagem por pessoa por dia, só se houver conta de hoje ou atrasada; dia vazio não gera mensagem;
 *  - o interruptor é PRÓPRIO (AVISOS_RESUMO, desligado por padrão) e AVISOS=todos NÃO o liga;
 *  - nunca vai a quem respondeu SAIR, pediu exclusão, está sem acesso ou fora do piloto, e nunca fora da janela do horário escolhido;
 *  - a leitura de "quem está liberado" nunca vira "todos": tabela ausente = ninguém, outro erro = não envia nada, e mesmo que o filtro do
 *    banco falhasse só entram os ids que de fato estão na lista de liberados;
 *  - falha de envio solta a reserva e para depois de 3 tentativas no dia; texto sem emoji nem travessão, e sem valores se a pessoa ocultou.
 *   npx tsx test/resumo-diario.ts
 */
import assert from 'node:assert/strict'

const R = await import('../src/resumo-diario.ts')
const RB = await import('../src/resumo-diario-banco.ts')
type Perfil = import('../src/resumo-diario.ts').PerfilResumo
type Deps = import('../src/resumo-diario.ts').DepsResumo
type Conta = import('../src/avisos.ts').ContaAviso

let ok = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  R.zerarEstadoResumo()
  try {
    await fn()
    ok++
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 500))
  }
}

/** 23/11/2026 09:30 em São Paulo (UTC-3, sem horário de verão). */
const AGORA = new Date('2026-11-23T12:30:00Z')
const HOJE = '2026-11-23'
const minutosDepois = (min: number, base = AGORA) => new Date(base.getTime() + min * 60_000)

const perfil = (id: string, mais: Partial<Perfil> = {}): Perfil => ({
  id, nome: 'Arthur Teste', whats: '81988887777', whats_chave: '8188887777', lembrete_hora: '09:00', antecedencia: 1, ocultar: false,
  exclusao_em: null, avisos_off: false, assinatura: { status: 'ativa', trial_fim: null }, ...mais,
})
const conta = (id: string, descricao: string, valor: number, vencimento: string): Conta => ({ id, descricao, valor, vencimento })

interface Mundo {
  perfis: Perfil[]
  contas: Record<string, Conta[]>
  enviados: { tel: string; texto: string }[]
  avisos: Set<string>
  telefone: string | null
  falharEnvio: boolean
  tentativas: number
  consultasLiberados: number
}
function mundo(mais: Partial<Mundo> = {}): Mundo {
  return { perfis: [perfil('u-1')], contas: {}, enviados: [], avisos: new Set(), telefone: '5581988887777', falharEnvio: false, tentativas: 0, consultasLiberados: 0, ...mais }
}
function deps(m: Mundo): Deps {
  return {
    liberados: async (hhmm) => {
      m.consultasLiberados++
      return m.perfis.filter((p) => p.lembrete_hora <= hhmm)
    },
    contas: async (uid, de, ate) => (m.contas[uid] ?? []).filter((c) => c.vencimento >= de && c.vencimento <= ate),
    telefoneDe: async () => m.telefone,
    jaAvisadas: async (_uid, chaves) => new Set(chaves.filter((c) => m.avisos.has(c))),
    reservar: async (_uid, _tel, itens) => {
      const ganhas: string[] = []
      for (const i of itens) if (!m.avisos.has(i.chave)) (m.avisos.add(i.chave), ganhas.push(i.chave))
      return ganhas
    },
    concluir: async (_uid, chaves, enviado) => {
      if (!enviado) for (const c of chaves) m.avisos.delete(c)
    },
    enviar: async (tel, texto) => {
      m.tentativas++
      if (m.falharEnvio) throw new Error('gateway caiu')
      m.enviados.push({ tel, texto })
    },
    esperar: async () => {},
  }
}
const cfg = (mais: Partial<import('../src/resumo-diario.ts').ConfigResumo> = {}) => ({ modo: 'todos' as const, piloto: [] as string[], janelaMin: 180, maxPorCiclo: 15, espacoMs: 0, ...mais })

/* ---------- o interruptor ---------- */

await caso('desligado por padrão: não consulta ninguém nem envia', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] } })
  assert.deepEqual(await R.rodarResumo(deps(m), cfg({ modo: 'off' }), AGORA), [])
  assert.equal(m.consultasLiberados, 0)
  assert.equal(m.enviados.length, 0)
})

await caso('o interruptor é próprio: AVISOS_RESUMO liga, e AVISOS=todos (o do vencimento) NÃO liga o resumo', async () => {
  assert.equal(R.lerConfigResumo({}).modo, 'off', 'sem nada definido: desligado')
  assert.equal(R.lerConfigResumo({ AVISOS: 'todos' }).modo, 'off', 'ligar o vencimento para todos não liga o resumo')
  assert.equal(R.lerConfigResumo({ AVISOS: 'piloto', AVISOS_PILOTO: '5581988887777' }).modo, 'off')
  assert.equal(R.lerConfigResumo({ AVISOS_RESUMO: 'todos' }).modo, 'todos')
  assert.equal(R.lerConfigResumo({ AVISOS_RESUMO: ' Piloto ', AVISOS_PILOTO: '5581988887777, u-9' }).modo, 'piloto')
  assert.deepEqual(R.lerConfigResumo({ AVISOS_RESUMO: 'piloto', AVISOS_PILOTO: '5581988887777, u-9' }).piloto, ['5581988887777', 'u-9'])
  assert.equal(R.lerConfigResumo({ AVISOS_RESUMO: 'qualquer coisa' }).modo, 'off', 'valor estranho: desligado')
})

await caso('ensaio: só escreve no log quem receberia, sem enviar nem reservar', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] } })
  const log = await R.rodarResumo(deps(m), cfg({ modo: 'ensaio' }), AGORA)
  assert.match(log.join('\n'), /ensaio: enviaria o resumo a 55\*+7777 \(1 de hoje, 0 atrasadas\)/)
  assert.equal(m.enviados.length, 0)
  assert.equal(m.avisos.size, 0)
})

await caso('piloto: só quem está na lista do piloto recebe', async () => {
  const m = mundo({ perfis: [perfil('u-1'), perfil('u-2', { whats_chave: '8155554444' })], contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)], 'u-2': [conta('c2', 'Luz', 100, HOJE)] } })
  await R.rodarResumo(deps(m), cfg({ modo: 'piloto', piloto: ['81988887777'] }), AGORA)
  assert.equal(m.enviados.length, 1)
  assert.match(m.enviados[0].texto, /Aluguel/)
  assert.doesNotMatch(m.enviados[0].texto, /Luz/)
})

/* ---------- o que sai ---------- */

await caso('conta de hoje: UMA mensagem com a conta, o total e a dica "o que vence"', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel da sala', 900, HOJE), conta('c2', 'Internet', 109.9, HOJE)] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  assert.equal(m.enviados.length, 1)
  const t = m.enviados[0].texto
  assert.match(t, /^Oi, Arthur\. Estas contas vencem hoje:/)
  assert.match(t, /- Aluguel da sala, R\$.*900,00/)
  assert.match(t, /- Internet, R\$.*109,90/)
  assert.match(t, /Total de hoje: R\$.*1\.009,90/)
  assert.match(t, /me pergunte "o que vence"/)
  assert.doesNotMatch(t, /Atrasadas/)
  assert.equal(m.enviados[0].tel, '5581988887777')
})

await caso('hoje e atrasadas juntas: as duas seções, as atrasadas com o tempo de atraso', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE), conta('c2', 'Internet', 109.9, '2026-11-15'), conta('c3', 'Luz', 150, '2026-11-22')] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  const t = m.enviados[0].texto
  assert.match(t, /Esta conta vence hoje:/)
  assert.match(t, /Atrasadas \(2\):/)
  assert.match(t, /- Internet, R\$.*109,90, venceu há 8 dias \(15\/11\)/)
  assert.match(t, /- Luz, R\$.*150,00, venceu ontem \(22\/11\)/)
  assert.match(t, /Total atrasado: R\$.*259,90/)
  assert.ok(t.indexOf('Internet') < t.indexOf('Luz'), 'as mais antigas primeiro')
})

await caso('só atrasada, nada para hoje: avisa que tem atrasada', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Internet', 109.9, '2026-11-15')] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  assert.equal(m.enviados.length, 1)
  assert.match(m.enviados[0].texto, /^Oi, Arthur\. Você tem 1 conta atrasada:/)
  assert.doesNotMatch(m.enviados[0].texto, /vence hoje/)
})

await caso('dia sem conta de hoje e sem atrasada: NÃO manda nada', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Amanhã', 50, '2026-11-24')] } })
  const log = await R.rodarResumo(deps(m), cfg(), AGORA)
  assert.equal(m.enviados.length, 0)
  assert.equal(m.avisos.size, 0, 'nem reserva')
  assert.deepEqual(log, [])
})

await caso('conta paga ou a receber não entra: o banco só devolve a pagar abertas (a consulta é a mesma do aviso de vencimento)', async () => {
  const m = mundo({ contas: { 'u-1': [] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  assert.equal(m.enviados.length, 0)
})

await caso('UMA por dia: a volta seguinte no mesmo dia não repete; no dia seguinte manda de novo', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE), conta('c2', 'Internet', 109.9, '2026-11-24')] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  await R.rodarResumo(deps(m), cfg(), minutosDepois(1))
  await R.rodarResumo(deps(m), cfg(), minutosDepois(60))
  assert.equal(m.enviados.length, 1, 'três voltas no mesmo dia, um envio só')
  R.zerarEstadoResumo() // reinício do serviço: a memória some, o registro no banco é que segura
  await R.rodarResumo(deps(m), cfg(), minutosDepois(2))
  assert.equal(m.enviados.length, 1, 'mesmo depois de reiniciar, o registro no banco impede o repetido')
  await R.rodarResumo(deps(m), cfg(), minutosDepois(24 * 60))
  assert.equal(m.enviados.length, 2, 'no dia seguinte, com conta de hoje, manda')
  assert.match(m.enviados[1].texto, /Internet/)
})

await caso('outro processo já reservou o dia: este não envia', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] } })
  const d = deps(m)
  d.jaAvisadas = async () => new Set() // a consulta passou antes de o outro reservar
  m.avisos.add(R.chaveDoResumo('u-1', HOJE)) // ...mas na hora de reservar já estava ocupado
  await R.rodarResumo(d, cfg(), AGORA)
  assert.equal(m.enviados.length, 0)
})

await caso('ocultar valores: o resumo vai sem nenhum valor em reais', async () => {
  const m = mundo({ perfis: [perfil('u-1', { ocultar: true })], contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE), conta('c2', 'Internet', 109.9, '2026-11-15')] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  const t = m.enviados[0].texto
  assert.match(t, /- Aluguel/)
  assert.doesNotMatch(t, /R\$/)
  assert.doesNotMatch(t, /900|109/)
})

await caso('muitas contas: corta em 8 de hoje e 5 atrasadas e diz quantas ficaram de fora', async () => {
  const hoje = Array.from({ length: 10 }, (_, i) => conta(`h${i}`, `Conta ${String(i).padStart(2, '0')}`, 10, HOJE))
  const atras = Array.from({ length: 7 }, (_, i) => conta(`a${i}`, `Atrasada ${i}`, 20, `2026-11-${String(10 + i).padStart(2, '0')}`))
  const m = mundo({ contas: { 'u-1': [...hoje, ...atras] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  const t = m.enviados[0].texto
  assert.equal((t.match(/^- Conta /gm) ?? []).length, 8)
  assert.match(t, /E mais 2\. Veja no painel\./)
  assert.equal((t.match(/^- Atrasada /gm) ?? []).length, 5)
  assert.match(t, /E mais 2 atrasadas\. Veja no painel\./)
  assert.match(t, /Atrasadas \(7\):/)
})

await caso('o texto não tem emoji nem travessão', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE), conta('c2', 'Internet', 109.9, '2026-11-15')] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  const t = m.enviados[0].texto
  assert.doesNotMatch(t, /[\u{1F000}-\u{1FAFF}←-➿️]/u, 'emoji')
  assert.doesNotMatch(t, /[—–]/, 'travessão')
})

/* ---------- quem nunca recebe ---------- */

await caso('quem respondeu SAIR nunca recebe, mesmo que a lista o devolva', async () => {
  const m = mundo({ perfis: [perfil('u-1', { avisos_off: true })], contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] } })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  assert.equal(m.enviados.length, 0)
  assert.equal(m.avisos.size, 0)
})

await caso('quem pediu exclusão ou está sem acesso não recebe', async () => {
  const m = mundo({
    perfis: [perfil('u-1', { exclusao_em: '2026-12-20' }), perfil('u-2', { assinatura: { status: 'bloqueada', trial_fim: null } }), perfil('u-3', { assinatura: null })],
    contas: { 'u-1': [conta('c1', 'A', 1, HOJE)], 'u-2': [conta('c2', 'B', 1, HOJE)], 'u-3': [conta('c3', 'C', 1, HOJE)] },
  })
  await R.rodarResumo(deps(m), cfg(), AGORA)
  assert.equal(m.enviados.length, 0)
})

await caso('sem número para mandar: não envia e não reserva', async () => {
  const m = mundo({ telefone: null, contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] } })
  const log = await R.rodarResumo(deps(m), cfg(), AGORA)
  assert.equal(m.enviados.length, 0)
  assert.equal(m.avisos.size, 0)
  assert.match(log.join('\n'), /sem número/)
})

await caso('janela: nunca antes da hora escolhida, nem depois da janela, nem à noite', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] } })
  await R.rodarResumo(deps(m), cfg(), new Date('2026-11-23T11:59:00Z')) // 08:59 SP, antes das 09:00
  await R.rodarResumo(deps(m), cfg(), new Date('2026-11-23T15:01:00Z')) // 12:01 SP, passou a janela de 3 h
  assert.equal(m.enviados.length, 0, 'fora da janela do horário escolhido')
  const n = mundo({ perfis: [perfil('u-1', { lembrete_hora: '21:00' })], contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] } })
  await R.rodarResumo(deps(n), cfg(), new Date('2026-11-24T00:45:00Z')) // 21:45 SP: dentro da janela de 21:00, mas já é noite
  assert.equal(n.enviados.length, 0, 'nunca depois das 21:30')
  await R.rodarResumo(deps(m), cfg(), minutosDepois(0)) // 09:30, dentro da janela
  assert.equal(m.enviados.length, 1)
})

/* ---------- falhas e limites ---------- */

await caso('falha de envio: solta a reserva, tenta de novo no minuto seguinte e para depois de 3 no dia', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] }, falharEnvio: true })
  for (let i = 0; i < 6; i++) await R.rodarResumo(deps(m), cfg(), minutosDepois(i))
  assert.equal(m.tentativas, 3, 'no máximo 3 tentativas por pessoa por dia')
  assert.equal(m.avisos.size, 0, 'a reserva é solta a cada falha: nunca fica "enviado" sem ter saído')
  assert.equal(R.estadoResumo.falhas, 3)
  m.falharEnvio = false
  await R.rodarResumo(deps(m), cfg(), minutosDepois(24 * 60))
  assert.equal(m.enviados.length, 1, 'no dia seguinte o gateway voltou: a conta que não foi paga já aparece como atrasada')
  assert.match(m.enviados[0].texto, /Você tem 1 conta atrasada:/)
  assert.match(m.enviados[0].texto, /venceu ontem \(23\/11\)/)
})

await caso('teto por ciclo: o resto fica para o minuto seguinte', async () => {
  const m = mundo({ perfis: [perfil('u-1'), perfil('u-2')], contas: { 'u-1': [conta('c1', 'A', 1, HOJE)], 'u-2': [conta('c2', 'B', 1, HOJE)] } })
  const log = await R.rodarResumo(deps(m), cfg({ maxPorCiclo: 1 }), AGORA)
  assert.equal(m.enviados.length, 1)
  assert.match(log.join('\n'), /teto de envios por ciclo/)
  await R.rodarResumo(deps(m), cfg({ maxPorCiclo: 1 }), minutosDepois(1))
  assert.equal(m.enviados.length, 2)
  assert.match(m.enviados[0].texto, /- A,/)
  assert.match(m.enviados[1].texto, /- B,/)
})

await caso('erro ao ler quem está liberado: o ciclo não envia nada e registra o erro', async () => {
  const m = mundo({ contas: { 'u-1': [conta('c1', 'Aluguel', 900, HOJE)] } })
  const d = deps(m)
  d.liberados = async () => {
    throw new Error('banco fora')
  }
  const log = await R.rodarResumo(d, cfg(), AGORA)
  assert.equal(m.enviados.length, 0)
  assert.match(log.join('\n'), /erro no ciclo do resumo/)
  assert.equal(R.estadoResumo.rodando, false, 'não deixa o ciclo preso')
})

/* ---------- a leitura real de quem está liberado, contra um banco falso ---------- */

type Tabelas = Record<string, { data?: unknown[]; error?: { code?: string; message: string } }>
/** Banco que IGNORA todo filtro (eq, in, is, lte, not): devolve sempre a tabela inteira. É o pior caso que a conferência no código tem de aguentar. */
function bancoQueNaoFiltra(tabelas: Tabelas, chamadas: string[] = []) {
  return {
    from: (t: string) => {
      chamadas.push(t)
      const q: Record<string, unknown> = {}
      for (const f of ['select', 'eq', 'in', 'is', 'lte', 'not', 'order', 'limit']) q[f] = () => q
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabelas[t]?.data ?? [], error: tabelas[t]?.error ?? null }).then(ok)
      return q
    },
  } as never
}
const linhaPerfil = (id: string, mais: Record<string, unknown> = {}) => ({ id, nome: 'X', whats: '81988887777', whats_chave: '8188887777', lembrete_hora: '09:00', antecedencia: 1, ocultar: false, exclusao_em: null, avisos_off: false, ...mais })
const enviarFalso = async () => {}

await caso('banco: tabela recursos_cliente ausente (migration não rodou) = ninguém liberado, sem erro', async () => {
  for (const erro of [{ code: 'PGRST205', message: "Could not find the table 'public.recursos_cliente' in the schema cache" }, { code: '42P01', message: 'relation "public.recursos_cliente" does not exist' }]) {
    const d = RB.depsResumoDoBanco(bancoQueNaoFiltra({ recursos_cliente: { error: erro } }), enviarFalso)
    assert.deepEqual(await d.liberados('10:00'), [])
  }
})

await caso('banco: qualquer outro erro de leitura LANÇA (nunca vira "ninguém" calado nem "todos")', async () => {
  const d = RB.depsResumoDoBanco(bancoQueNaoFiltra({ recursos_cliente: { error: { code: '57014', message: 'canceling statement due to statement timeout' } } }), enviarFalso)
  await assert.rejects(() => d.liberados('10:00'), /ler quem tem o recurso/)
  const e = RB.depsResumoDoBanco(bancoQueNaoFiltra({ recursos_cliente: { data: [{ user_id: 'u-1' }] }, perfis: { error: { message: 'timeout' } } }), enviarFalso)
  await assert.rejects(() => e.liberados('10:00'), /perfis dos liberados/)
})

await caso('banco: ninguém liberado não consulta perfis', async () => {
  const chamadas: string[] = []
  const d = RB.depsResumoDoBanco(bancoQueNaoFiltra({ recursos_cliente: { data: [] }, perfis: { data: [linhaPerfil('u-9')] } }, chamadas), enviarFalso)
  assert.deepEqual(await d.liberados('10:00'), [])
  assert.deepEqual(chamadas, ['recursos_cliente'])
})

await caso('banco: se o filtro falhasse e devolvesse todos os perfis, só entram os liberados e ninguém que respondeu SAIR', async () => {
  const d = RB.depsResumoDoBanco(
    bancoQueNaoFiltra({
      recursos_cliente: { data: [{ user_id: 'u-1' }, { user_id: 'u-3' }] },
      perfis: { data: [linhaPerfil('u-1'), linhaPerfil('u-2'), linhaPerfil('u-3', { avisos_off: true })] },
      assinaturas: { data: [{ user_id: 'u-1', status: 'ativa', trial_fim: null }] },
    }),
    enviarFalso,
  )
  const r = await d.liberados('10:00')
  assert.deepEqual(r.map((p) => p.id), ['u-1'], 'u-2 não está liberado, u-3 respondeu SAIR')
  assert.equal(r[0].assinatura?.status, 'ativa')
})

console.log(`\n${ok} casos ok${falhas ? `, ${falhas} falha(s)` : ''}`)
process.exit(falhas ? 1 : 0)
