/**
 * Reposição das contas fixas (f4-fixas-repor). Este passo ESCREVE dado de todos os clientes, então o que está travado aqui é o que custaria um cliente:
 *  - repõe só os meses DEPOIS da última ocorrência, até o mês atual + 2, e NUNCA cria vencimento no passado (uma fixa abandonada não vira "atrasada");
 *  - nunca preenche buraco: o mês que a pessoa apagou para pular não volta;
 *  - fixa sem nenhuma ocorrência (a pessoa apagou todas) não é tocada; dia 31 corta no último dia do mês sempre a partir do dia configurado;
 *  - o molde (pagar ou receber, categoria, DAS) vem da última ocorrência; o id é determinístico, então rodar de novo não duplica;
 *  - o id de uma fixa se repete entre clientes ("fx-aluguel"): nada se mistura; conta em exclusão e conta de admin ficam de fora;
 *  - a leitura pagina até o fim (com a lista cortada a "última ocorrência" seria antiga e o passo criaria meses que a pessoa já tem).
 *   npx tsx test/fixas-repor.ts
 */
import assert from 'node:assert/strict'

const R = await import('../src/fixas-repor.ts')
const RB = await import('../src/fixas-repor-banco.ts')
type Fixa = import('../src/fixas-repor.ts').FixaRep
type Oc = import('../src/fixas-repor.ts').OcorrenciaRep
type Nova = import('../src/fixas-repor.ts').NovaConta

let ok = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  R.zerarEstadoReposicao()
  try {
    await fn()
    ok++
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 500))
  }
}

const fixa = (mais: Partial<Fixa> = {}): Fixa => ({ user_id: 'u-1', id: 'fx-aluguel', descricao: 'Aluguel', valor: 900, dia: 10, ...mais })
const oc = (vencimento: string, mais: Partial<Oc> = {}): Oc => ({ user_id: 'u-1', fixa_id: 'fx-aluguel', vencimento, tipo: 'pagar', categoria_id: 'moradia', das: false, ...mais })
const venc = (l: Nova[]) => l.map((x) => x.vencimento)

/* ---------- a conta de uma fixa ---------- */

await caso('fixa recém-criada, com os meses à frente: nada a repor', async () => {
  assert.deepEqual(R.reporFixa(fixa(), [oc('2026-12-10'), oc('2027-01-10')], '2026-11-23'), [])
})

await caso('passou o tempo: repõe até o mês atual + 2 e NUNCA no passado (novembro já passou, então só dezembro e janeiro)', async () => {
  const r = R.reporFixa(fixa(), [oc('2026-08-10'), oc('2026-09-10'), oc('2026-10-10')], '2026-11-23')
  assert.deepEqual(venc(r), ['2026-12-10', '2027-01-10'])
  assert.deepEqual(r.map((x) => x.id), ['rep-fx-aluguel-2026-12', 'rep-fx-aluguel-2027-01'], 'id determinístico')
})

await caso('se o vencimento do mês atual ainda não passou, ele entra (o cadastro também faz assim)', async () => {
  assert.deepEqual(venc(R.reporFixa(fixa(), [oc('2026-10-10')], '2026-11-05')), ['2026-11-10', '2026-12-10', '2027-01-10'])
})

await caso('no 1º dia do mês seguinte repõe mais um mês', async () => {
  assert.deepEqual(venc(R.reporFixa(fixa(), [oc('2027-01-10')], '2026-12-01')), ['2027-02-10'])
})

await caso('dia 31 corta no último dia do mês, sempre a partir do dia configurado (fev comum, bissexto, abril)', async () => {
  assert.deepEqual(venc(R.reporFixa(fixa({ dia: 31 }), [oc('2027-01-31')], '2027-01-15')), ['2027-02-28', '2027-03-31'])
  assert.deepEqual(venc(R.reporFixa(fixa({ dia: 31 }), [oc('2028-01-31')], '2028-01-15')), ['2028-02-29', '2028-03-31'])
  assert.deepEqual(venc(R.reporFixa(fixa({ dia: 31 }), [oc('2027-03-31')], '2027-03-20')), ['2027-04-30', '2027-05-31'])
  assert.deepEqual(venc(R.reporFixa(fixa({ dia: 30 }), [oc('2027-01-30')], '2027-01-15')), ['2027-02-28', '2027-03-30'])
})

await caso('fixa abandonada (última ocorrência em agosto): não gera atrasadas, só os meses que ainda não venceram', async () => {
  const r = R.reporFixa(fixa(), [oc('2026-08-10')], '2026-11-23')
  assert.deepEqual(venc(r), ['2026-12-10', '2027-01-10'])
  assert.ok(r.every((x) => x.vencimento >= '2026-11-23'), 'nenhum vencimento no passado')
})

await caso('buraco: o mês que a pessoa apagou para pular NÃO volta', async () => {
  // Outubro e dezembro existem, novembro foi apagado. Hoje é 02/10: o horizonte vai até dezembro, que já existe.
  assert.deepEqual(R.reporFixa(fixa(), [oc('2026-10-10'), oc('2026-12-10')], '2026-10-02'), [])
  // Um mês depois (02/11) o horizonte vai até janeiro: só janeiro entra, novembro segue de fora.
  assert.deepEqual(venc(R.reporFixa(fixa(), [oc('2026-10-10'), oc('2026-12-10')], '2026-11-02')), ['2027-01-10'])
})

await caso('fixa sem nenhuma ocorrência (a pessoa apagou todas) não é tocada', async () => {
  assert.deepEqual(R.reporFixa(fixa(), [], '2026-11-23'), [])
})

await caso('o molde vem da última ocorrência (pagar ou receber, categoria, DAS); descrição, valor e dia vêm da fixa', async () => {
  const antigas = [oc('2026-09-10', { tipo: 'pagar', categoria_id: 'outra', das: false }), oc('2026-10-10', { tipo: 'receber', categoria_id: 'servicos', das: true })]
  const r = R.reporFixa(fixa({ descricao: '  Aluguel da sala ', valor: 1200, dia: 15 }), antigas, '2026-11-23')
  assert.equal(r.length, 2)
  for (const x of r) {
    assert.equal(x.tipo, 'receber')
    assert.equal(x.categoria_id, 'servicos')
    assert.equal(x.das, true)
    assert.equal(x.descricao, 'Aluguel da sala')
    assert.equal(x.valor, 1200)
    assert.equal(x.status, 'aberta')
    assert.equal(x.fixa_id, 'fx-aluguel')
    assert.equal(x.user_id, 'u-1')
  }
  assert.deepEqual(venc(r), ['2026-12-15', '2027-01-15'])
})

await caso('fixa com dado inválido (dia fora de 1 a 31, valor zero, sem descrição) é pulada', async () => {
  const o = [oc('2026-10-10')]
  for (const ruim of [{ dia: 0 }, { dia: 32 }, { dia: 10.5 }, { valor: 0 }, { valor: -5 }, { descricao: '  ' }]) assert.deepEqual(R.reporFixa(fixa(ruim), o, '2026-11-23'), [], JSON.stringify(ruim))
})

/* ---------- o passo inteiro, com dados falsos ---------- */

interface Mundo { fixas: Fixa[]; ocs: Oc[]; gravados: Nova[]; ids: Set<string>; lerOcorrencias: number; gravar: number }
function mundo(fixas: Fixa[], ocs: Oc[]): { m: Mundo; deps: import('../src/fixas-repor.ts').DepsRepor } {
  const m: Mundo = { fixas, ocs: [...ocs], gravados: [], ids: new Set(), lerOcorrencias: 0, gravar: 0 }
  return {
    m,
    deps: {
      fixas: async () => m.fixas,
      ocorrencias: async (userIds) => {
        m.lerOcorrencias++
        return m.ocs.filter((o) => userIds.includes(o.user_id))
      },
      gravar: async (linhas) => {
        m.gravar++
        let criadas = 0
        for (const l of linhas) {
          const k = `${l.user_id}|${l.id}`
          if (m.ids.has(k)) continue // ignoreDuplicates
          m.ids.add(k)
          m.gravados.push(l)
          m.ocs.push({ user_id: l.user_id, fixa_id: l.fixa_id, vencimento: l.vencimento, tipo: l.tipo, categoria_id: l.categoria_id, das: l.das })
          criadas++
        }
        return criadas
      },
    },
  }
}
const HOJE = '2026-11-23'

await caso('repõe e é idempotente: a segunda volta, e uma volta com a memória zerada, não criam nada', async () => {
  const { m, deps } = mundo([fixa()], [oc('2026-08-10'), oc('2026-09-10'), oc('2026-10-10')])
  const a = await R.reporContasFixas(deps, HOJE, 'todos')
  assert.deepEqual([a.criadas, a.aCriar, a.erros], [2, 2, []])
  const b = await R.reporContasFixas(deps, HOJE, 'todos')
  assert.deepEqual([b.criadas, b.aCriar], [0, 0])
  m.ocs = m.ocs.filter((o) => o.vencimento < '2026-12-01') // finge que a leitura não viu o que foi gravado: o id determinístico segura
  const c = await R.reporContasFixas(deps, HOJE, 'todos')
  assert.equal(c.criadas, 0, 'mesmo sem ver as ocorrências novas, o upsert ignora as que já existem')
  assert.equal(m.gravados.length, 2)
})

await caso('o id de uma fixa se repete entre clientes: nada se mistura', async () => {
  const { m, deps } = mundo(
    [fixa({ user_id: 'u-1' }), fixa({ user_id: 'u-2' })],
    [oc('2026-10-10', { user_id: 'u-1' }), oc('2027-01-10', { user_id: 'u-2' })], // u-2 já tem os meses à frente
  )
  const r = await R.reporContasFixas(deps, HOJE, 'todos')
  assert.equal(r.criadas, 2)
  assert.ok(m.gravados.every((g) => g.user_id === 'u-1'), 'só o u-1 precisava; o u-2 não foi tocado')
})

await caso('modo ensaio calcula e conta, mas não grava; modo off nem lê', async () => {
  const { m, deps } = mundo([fixa()], [oc('2026-10-10')])
  const e = await R.reporContasFixas(deps, HOJE, 'ensaio')
  assert.deepEqual([e.aCriar, e.criadas, m.gravar], [2, 0, 0])
  assert.equal(e.amostra.length, 2)
  const o = await R.reporContasFixas(deps, HOJE, 'off')
  assert.deepEqual([o.fixas, o.aCriar, m.lerOcorrencias], [0, 0, 1], 'o off não leu nada (a única leitura foi a do ensaio)')
  assert.equal(R.lerModoRepor({}), 'todos')
  assert.equal(R.lerModoRepor({ REPOR_FIXAS: 'off' }), 'off')
  assert.equal(R.lerModoRepor({ REPOR_FIXAS: ' Ensaio ' }), 'ensaio')
  assert.equal(R.lerModoRepor({ REPOR_FIXAS: 'qualquer coisa' }), 'todos')
})

await caso('fixa sem ocorrência é contada e pulada', async () => {
  const { m, deps } = mundo([fixa(), fixa({ id: 'fx-internet' })], [oc('2026-10-10')])
  const r = await R.reporContasFixas(deps, HOJE, 'todos')
  assert.equal(r.semOcorrencia, 1)
  assert.ok(m.gravados.every((g) => g.fixa_id === 'fx-aluguel'))
})

await caso('teto por volta: não grava mais que o limite, mesmo quando a última fixa passa dele, e avisa que parou', async () => {
  // Hoje 05/11 e a última ocorrência em agosto: cada fixa precisa de 3 contas (nov, dez, jan). 500 não é múltiplo de 3: a fixa nº 167 leva a conta a 501.
  const muitas = Array.from({ length: 600 }, (_, i) => fixa({ id: `fx-${i}` }))
  const ocs = muitas.map((f) => oc('2026-08-10', { fixa_id: f.id }))
  const { m, deps } = mundo(muitas, ocs)
  const r = await R.reporContasFixas(deps, '2026-11-05', 'todos')
  assert.equal(r.limitado, true)
  assert.equal(r.criadas, R.MAX_POR_VOLTA, 'nem uma a mais que o teto')
  assert.equal(m.gravados.length, R.MAX_POR_VOLTA)
})

await caso('erro ao ler: registra e não grava nada; erro ao gravar: registra', async () => {
  const { m, deps } = mundo([fixa()], [oc('2026-10-10')])
  const d1 = { ...deps, ocorrencias: async () => { throw new Error('banco fora') } }
  const a = await R.reporContasFixas(d1, HOJE, 'todos')
  assert.match(a.erros[0], /banco fora/)
  assert.equal(m.gravar, 0)
  assert.match(R.estadoReposicao.ultimoErro ?? '', /banco fora/)
  const d2 = { ...deps, gravar: async () => { throw new Error('gravar falhou') } }
  const b = await R.reporContasFixas(d2, HOJE, 'todos')
  assert.match(b.erros[0], /gravar falhou/)
})

/* ---------- a leitura real, contra um banco falso que PAGINA ---------- */

interface Espiao { upserts: { linhas: { id: string }[]; opcoes: Record<string, unknown> }[] }
function bancoFalso(tabelas: Record<string, unknown[]>, espiao: Espiao = { upserts: [] }, erroEm?: string) {
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {}
      let faixa: [number, number] | null = null
      let escrito: { id: string }[] | null = null
      for (const f of ['select', 'eq', 'in', 'not', 'order', 'is', 'lte', 'limit']) q[f] = () => q
      q.range = (de: number, ate: number) => ((faixa = [de, ate]), q)
      q.upsert = (linhas: { id: string }[], opcoes: Record<string, unknown>) => {
        espiao.upserts.push({ linhas, opcoes })
        escrito = linhas
        return q
      }
      q.then = (ok: (v: unknown) => unknown) => {
        if (erroEm === t) return Promise.resolve({ data: null, error: { message: 'timeout' } }).then(ok)
        if (escrito) return Promise.resolve({ data: escrito.map((l) => ({ id: l.id })), error: null }).then(ok)
        const linhas = tabelas[t] ?? []
        return Promise.resolve({ data: faixa ? linhas.slice(faixa[0], faixa[1] + 1) : linhas, error: null }).then(ok)
      }
      return q
    },
  } as never
}
const perfil = (id: string, papel = 'cliente', exclusao_em: string | null = null) => ({ id, papel, exclusao_em })
const linhaFixa = (user_id: string, id = 'fx-aluguel') => ({ user_id, id, descricao: 'Aluguel', valor: '900.00', dia: 10 })
const linhaConta = (user_id: string, vencimento: string, fixa_id: string | null = 'fx-aluguel', mais: Record<string, unknown> = {}) => ({ user_id, fixa_id, vencimento, tipo: 'pagar', categoria_id: null, das: false, ...mais })

await caso('banco: conta em exclusão e conta de admin ficam de fora, mesmo que o filtro devolvesse todo mundo', async () => {
  const d = RB.depsReporDoBanco(bancoFalso({ perfis: [perfil('u-1'), perfil('u-2', 'cliente', '2026-12-20'), perfil('u-3', 'admin')], fixas: [linhaFixa('u-1'), linhaFixa('u-2'), linhaFixa('u-3'), linhaFixa('u-9')] }))
  assert.deepEqual((await d.fixas()).map((f) => f.user_id), ['u-1'], 'u-2 está saindo, u-3 é admin, u-9 nem perfil tem')
  assert.equal((await d.fixas())[0].valor, 900, 'o valor vem como número')
})

await caso('banco: com mais de 1000 contas a última ocorrência da página 2 é lida (senão repunha meses que a pessoa já tem)', async () => {
  const enchimento = Array.from({ length: 1100 }, (_, i) => linhaConta('u-1', `2025-${String((i % 12) + 1).padStart(2, '0')}-10`, 'fx-outra'))
  const contas = [...enchimento.slice(0, 1050), linhaConta('u-1', '2027-01-10'), ...enchimento.slice(1050)] // a última ocorrência de fx-aluguel está na linha 1050 (página 2)
  assert.ok(contas.findIndex((c) => c.vencimento === '2027-01-10') >= 1000)
  const d = RB.depsReporDoBanco(bancoFalso({ perfis: [perfil('u-1')], fixas: [linhaFixa('u-1')], contas }))
  const r = await R.reporContasFixas(d, HOJE, 'ensaio')
  assert.equal(r.aCriar, 0, 'a fixa já tem janeiro: não há o que repor')
  assert.equal(r.semOcorrencia, 0)
})

await caso('banco: ocorrências de outra fixa ou sem fixa não contam, e o tipo "receber" é preservado', async () => {
  const d = RB.depsReporDoBanco(bancoFalso({ contas: [linhaConta('u-1', '2026-10-10', 'fx-aluguel', { tipo: 'receber', categoria_id: 'servicos', das: true }), linhaConta('u-1', '2026-10-12', null), linhaConta('u-8', '2026-10-10')] }))
  const o = await d.ocorrencias(['u-1'])
  assert.equal(o.length, 1, 'a conta sem fixa e a de outro cliente ficam de fora')
  assert.deepEqual([o[0].tipo, o[0].categoria_id, o[0].das], ['receber', 'servicos', true])
})

await caso('banco: grava com upsert ignorando duplicados, por (user_id, id), em lotes de 200, e conta só o que foi criado', async () => {
  const espiao: Espiao = { upserts: [] }
  const d = RB.depsReporDoBanco(bancoFalso({}, espiao))
  const linhas = Array.from({ length: 450 }, (_, i): Nova => ({ user_id: 'u-1', id: `rep-fx-${i}-2026-12`, tipo: 'pagar', descricao: 'x', valor: 1, vencimento: '2026-12-10', status: 'aberta', categoria_id: null, fixa_id: `fx-${i}`, das: false }))
  assert.equal(await d.gravar(linhas), 450)
  assert.deepEqual(espiao.upserts.map((u) => u.linhas.length), [200, 200, 50])
  for (const u of espiao.upserts) assert.deepEqual(u.opcoes, { onConflict: 'user_id,id', ignoreDuplicates: true })
})

await caso('banco: erro de leitura ou de gravação LANÇA (nunca vira "nada a repor" calado)', async () => {
  await assert.rejects(() => RB.depsReporDoBanco(bancoFalso({}, undefined, 'perfis')).fixas(), /perfis/)
  await assert.rejects(() => RB.depsReporDoBanco(bancoFalso({}, undefined, 'contas')).ocorrencias(['u-1']), /contas/)
  await assert.rejects(() => RB.depsReporDoBanco(bancoFalso({}, undefined, 'contas')).gravar([{ user_id: 'u-1', id: 'rep-x-2026-12', tipo: 'pagar', descricao: 'x', valor: 1, vencimento: '2026-12-10', status: 'aberta', categoria_id: null, fixa_id: 'x', das: false }]), /gravar/)
})

console.log(`\n${ok} casos ok${falhas ? `, ${falhas} falha(s)` : ''}`)
process.exit(falhas ? 1 : 0)
