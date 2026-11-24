/**
 * Ligar um pagamento à conta que ele pagou (src/lib/vinculo.ts).
 * Caso de origem (24/11/2026, Arthur): Internet de R$ 120 vencida em 20/11; o pagamento de R$ 109 foi dar baixa numa OUTRA conta Internet (a de
 * 20/12, que valia 109) e a de 120 ficou atrasada, com o gasto aparecendo em dobro. Resultados esperados escritos à mão.
 *   npx tsx test/vinculo.ts
 */
import assert from 'node:assert/strict'
import { caso, fim } from './_falsos.ts'

const { vincular, soltar, religar, candidatosParaConta, candidatasParaLancamento, contaDoLancamento } = await import('../../src/lib/vinculo.ts')

type C = { id: string; tipo: 'pagar' | 'receber'; descricao: string; valor: number; vencimento: string; status: 'aberta' | 'paga'; fixaId?: string; pagoEm?: string; lancId?: string }
type L = { id: string; tipo: 'entrada' | 'saida' | 'transferencia' | 'compra_cartao'; valor: number; descricao: string; carteiraId: string; data: string; hora: string; origem: string }
const c = (id: string, desc: string, valor: number, venc: string, extra: Partial<C> = {}): C => ({ id, tipo: 'pagar', descricao: desc, valor, vencimento: venc, status: 'aberta', ...extra })
const l = (id: string, desc: string, valor: number, data: string, tipo: L['tipo'] = 'saida'): L => ({ id, tipo, valor, descricao: desc, carteiraId: 'nubank', data, hora: '21:46', origem: 'foto' })
const HOJE = '2026-11-23'

/** A conta do Arthur: 120 vencida em 20/11 (a que ficou aberta), a de 20/12 de 109, e o pagamento de 109 que já baixou a de dezembro. */
const estado = () =>
  ({
    fixas: [{ id: 'f1', descricao: 'Internet', valor: 120, dia: 20 }],
    contas: [
      c('nov', 'Internet', 120, '2026-11-20', { fixaId: 'f1' }),
      c('dez', 'Internet', 109, '2026-12-20', { fixaId: 'f1', status: 'paga', pagoEm: HOJE, lancId: 'pg109' }),
      c('luz', 'Energia', 150, '2026-11-27'),
      c('joana', 'Joana', 300, '2026-11-24', { tipo: 'receber' }),
    ],
    lancamentos: [l('pg109', 'Internet', 109, HOJE), l('mercado', 'Mercado', 80, '2026-11-10'), l('venda', 'Venda Joana', 300, HOJE, 'entrada'), l('transf', 'Transferência', 50, HOJE, 'transferencia')],
  }) as never as Parameters<typeof vincular>[0]

await caso('o caso do Arthur: desliga o pagamento da conta errada (o lançamento FICA) e liga na certa', async () => {
  let a = estado()
  a = soltar(a, 'dez', false)
  assert.equal(a.contas.find((x) => x.id === 'dez')!.status, 'aberta', 'a de dezembro voltou a ficar em aberto')
  assert.ok(a.lancamentos.some((x) => x.id === 'pg109'), 'o pagamento de 109 CONTINUA lançado (era dinheiro que saiu)')
  a = vincular(a, 'nov', 'pg109')
  const nov = a.contas.find((x) => x.id === 'nov')!
  assert.deepEqual([nov.status, nov.lancId, nov.valor, nov.pagoEm], ['paga', 'pg109', 109, HOJE], 'a de 20/11 fica paga com o que foi realmente pago e a data do pagamento')
  assert.equal(a.lancamentos.filter((x) => x.descricao === 'Internet').length, 1, 'nenhum lançamento novo: o gasto não aparece em dobro')
})

await caso('um lançamento só paga UMA conta: ligar de novo no mesmo pagamento é recusado (senão o mesmo dinheiro contaria duas vezes)', async () => {
  const a = estado()
  assert.equal(vincular(a, 'nov', 'pg109'), a, 'pg109 já paga a de dezembro')
  assert.equal(contaDoLancamento(a, 'pg109')!.id, 'dez')
})

await caso('só liga o que combina: saída paga conta a pagar, entrada paga conta a receber; transferência e conta já paga nunca', async () => {
  const a = estado()
  assert.equal(vincular(a, 'joana', 'mercado'), a, 'saída não paga conta a receber')
  assert.equal(vincular(a, 'luz', 'venda'), a, 'entrada não paga conta a pagar')
  assert.equal(vincular(a, 'luz', 'transf'), a, 'transferência não é pagamento de conta')
  assert.equal(vincular(a, 'dez', 'mercado'), a, 'conta já paga não é ligada de novo')
  assert.equal(vincular(a, 'nao-existe', 'mercado'), a)
  assert.equal(vincular(a, 'luz', 'nao-existe'), a)
  const ok = vincular(a, 'joana', 'venda')
  assert.deepEqual([ok.contas.find((x) => x.id === 'joana')!.status, ok.contas.find((x) => x.id === 'joana')!.valor], ['paga', 300])
})

await caso('desligar com "apagar o pagamento" apaga o lançamento; sem isso nunca apaga', async () => {
  const a = estado()
  const manteve = soltar(a, 'dez', false)
  assert.equal(manteve.lancamentos.length, a.lancamentos.length)
  const apagou = soltar(a, 'dez', true)
  assert.equal(apagou.lancamentos.some((x) => x.id === 'pg109'), false)
  assert.equal(apagou.lancamentos.length, a.lancamentos.length - 1)
  assert.equal(soltar(a, 'luz', true), a, 'conta em aberto não tem o que desligar e nada é apagado')
})

await caso('desligar não mexe no valor da conta (nada é sobrescrito sem a pessoa saber)', async () => {
  const a = estado()
  assert.equal(soltar(a, 'dez').contas.find((x) => x.id === 'dez')!.valor, 109)
})

await caso('candidatos: para a conta de 120 aparece o pagamento de Internet de 109 (mesmo nome) à frente do Mercado', async () => {
  let a = estado()
  a = soltar(a, 'dez', false)
  const nov = a.contas.find((x) => x.id === 'nov')!
  const ids = candidatosParaConta(a, nov, HOJE).map((x) => x.l.id)
  assert.equal(ids[0], 'pg109', 'o mais provável vem primeiro')
  assert.ok(!ids.includes('venda') && !ids.includes('transf'), 'entrada e transferência não são candidatas a conta a pagar')
})

await caso('candidatos: o pagamento que já paga OUTRA conta aparece (é o caso do Arthur), marcado com a conta que ele paga, e em primeiro por ser o mais provável', async () => {
  const a = estado()
  const nov = a.contas.find((x) => x.id === 'nov')!
  const op = candidatosParaConta(a, nov, HOJE)
  assert.equal(op[0].l.id, 'pg109', 'mesmo nome e valor perto: vem primeiro, mesmo ocupado')
  assert.equal(op[0].ocupada?.id, 'dez', 'vem marcado: já paga a conta de dezembro')
  assert.equal(op.find((x) => x.l.id === 'mercado')?.ocupada, undefined, 'lançamento livre não tem marca')
  assert.deepEqual(candidatosParaConta(a, a.contas.find((x) => x.id === 'dez')!, HOJE), [], 'conta paga não tem candidatos')
})

await caso('busca: acha por nome ou por valor em TODOS os lançamentos do tipo certo, sem o limite de 60 dias, e ignora acento e caixa', async () => {
  const a = estado()
  a.lancamentos.push(l('antigo', 'Mensalidade Açaí', 77.5, '2026-03-02') as never)
  const luz = a.contas.find((x) => x.id === 'luz')!
  assert.deepEqual(candidatosParaConta(a, luz, HOJE, 'acai').map((x) => x.l.id), ['antigo'], 'achou o de março pelo nome sem acento')
  assert.deepEqual(candidatosParaConta(a, luz, HOJE, 'MERCADO').map((x) => x.l.id), ['mercado'])
  assert.deepEqual(candidatosParaConta(a, luz, HOJE, '109').map((x) => x.l.id), ['pg109'], 'achou pelo valor')
  assert.deepEqual(candidatosParaConta(a, luz, HOJE, '77,5').map((x) => x.l.id), ['antigo'], 'valor com vírgula')
  assert.deepEqual(candidatosParaConta(a, luz, HOJE, 'nada disso existe'), [])
  assert.ok(!candidatosParaConta(a, luz, HOJE, 'venda').some((x) => x.l.id === 'venda'), 'entrada não aparece para conta a pagar')
})

await caso('religar: passa o pagamento de uma conta para a outra; a de antes volta a ficar em aberto e o lançamento FICA (o caso do Arthur em um passo)', async () => {
  const a = estado()
  const r = religar(a, 'nov', 'pg109')
  const nov = r.contas.find((x) => x.id === 'nov')!
  const dez = r.contas.find((x) => x.id === 'dez')!
  assert.deepEqual([nov.status, nov.lancId, nov.valor], ['paga', 'pg109', 109])
  assert.deepEqual([dez.status, dez.lancId], ['aberta', undefined], 'a de dezembro foi liberada')
  assert.equal(r.lancamentos.length, a.lancamentos.length, 'nenhum lançamento criado nem apagado')
  assert.equal(contaDoLancamento(r, 'pg109')!.id, 'nov', 'o pagamento paga UMA conta só')
})

await caso('religar: sem ligação anterior é o mesmo que vincular; o que não fecha devolve o MESMO estado sem desligar nada pela metade', async () => {
  const a = estado()
  assert.equal(religar(a, 'luz', 'mercado').contas.find((x) => x.id === 'luz')!.status, 'paga')
  assert.equal(religar(a, 'joana', 'pg109'), a, 'saída não paga conta a receber: nada muda, a de dezembro continua paga')
  assert.equal(religar(a, 'dez', 'mercado'), a, 'conta já paga não recebe outro pagamento')
  assert.equal(religar(a, 'nov', 'transf'), a, 'transferência nunca')
  assert.equal(religar(a, 'nov', 'nao-existe'), a)
  assert.equal(contaDoLancamento(a, 'pg109')!.id, 'dez')
})

await caso('candidatas para o lançamento: oferece as contas em aberto de mesma direção, a de nome parecido primeiro, e nada se já está ligado', async () => {
  let a = soltar(estado(), 'dez', false)
  const pg = a.lancamentos.find((x) => x.id === 'pg109')!
  const ids = candidatasParaLancamento(a, pg).map((x) => x.id)
  assert.ok(ids.includes('nov') && ids.includes('dez') && !ids.includes('joana'), 'só contas a pagar para uma saída')
  assert.ok(['nov', 'dez'].includes(ids[0]), 'as Internet vêm antes da Energia')
  a = vincular(a, 'nov', 'pg109')
  assert.deepEqual(candidatasParaLancamento(a, a.lancamentos.find((x) => x.id === 'pg109')!), [], 'já ligado a uma conta: não oferece outra')
})

await caso('conta muito antiga ou pagamento no futuro não entra nos candidatos (janela de 60 dias, nada depois de hoje)', async () => {
  const a = estado()
  a.lancamentos.push(l('velho', 'Energia', 150, '2026-05-01') as never, l('futuro', 'Energia', 150, '2026-12-30') as never)
  const luz = a.contas.find((x) => x.id === 'luz')!
  const ids = candidatosParaConta(a, luz, HOJE).map((x) => x.l.id)
  assert.ok(!ids.includes('velho') && !ids.includes('futuro'))
})

fim()
