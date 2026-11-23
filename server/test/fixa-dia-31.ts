/**
 * Conta fixa pode vencer do dia 1 ao dia 31 (achado do Arthur em 18/11). Três lugares fazem a mesma conta e os três ficam travados aqui:
 *  - o painel (src/lib/format.ts, vencimentoNoMes): usado no cadastro, em Ajustes e quando muda o dia de uma fixa;
 *  - o executor do WhatsApp (server/src/executar.ts): os 3 próximos vencimentos da conta fixa recém-criada;
 *  - a conversa de ponta a ponta: "aluguel todo dia 30" tem que ficar dia 30, não 28 (o corte em 28 da interpretação trocava em silêncio).
 * Regra: no mês que não tem o dia, vence no último dia do mês; cada vencimento sai do dia configurado, nunca do vencimento anterior.
 * Os resultados esperados abaixo são uma tabela escrita à mão (não vêm do código testado).
 *   npx tsx test/fixa-dia-31.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, msg, U1 } from './_falsos.ts'

const { vencimentoNoMes } = await import('../../src/lib/format.ts')
const { executar } = await import('../src/executar.ts')

/* ---------- o painel ---------- */

await caso('painel: no mês que não tem o dia, o vencimento vai para o último dia do mês', () => {
  const tabela: [string, number, string][] = [
    ['2027-01', 31, '2027-01-31'],
    ['2027-02', 31, '2027-02-28'], // fevereiro comum
    ['2027-02', 30, '2027-02-28'],
    ['2027-02', 29, '2027-02-28'],
    ['2028-02', 31, '2028-02-29'], // 2028 é bissexto
    ['2028-02', 30, '2028-02-29'],
    ['2028-02', 29, '2028-02-29'],
    ['2027-04', 31, '2027-04-30'], // mês de 30 dias
    ['2027-04', 30, '2027-04-30'],
    ['2027-11', 31, '2027-11-30'],
    ['2027-12', 31, '2027-12-31'],
    ['2027-03', 1, '2027-03-01'],
    ['2027-03', 28, '2027-03-28'],
  ]
  for (const [ym, dia, esperado] of tabela) assert.equal(vencimentoNoMes(ym, dia), esperado, `${ym} dia ${dia}`)
})

await caso('painel: cada mês sai do dia configurado, então o 31 de março volta a ser 31 depois do 28 de fevereiro', () => {
  const meses = ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06']
  assert.deepEqual(meses.map((ym) => vencimentoNoMes(ym, 31)), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30'])
})

await caso('painel: todo vencimento é uma data que existe (nunca 2027-02-31)', () => {
  for (let ano = 2027; ano <= 2029; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      for (const dia of [28, 29, 30, 31]) {
        const ym = `${ano}-${String(mes).padStart(2, '0')}`
        const v = vencimentoNoMes(ym, dia)
        const d = new Date(`${v}T12:00:00Z`)
        assert.equal(d.toISOString().slice(0, 10), v, `${ym} dia ${dia} deu uma data que não existe: ${v}`)
        assert.equal(v.slice(0, 7), ym, 'o vencimento não pode escorregar para outro mês')
      }
    }
  }
})

/* ---------- o executor do WhatsApp ---------- */

const ctxEm = (hoje: string) => ({ hoje, categorias: [], carteiras: [], contasAbertas: [] })
const venceu = async (hoje: string, dia: number) => {
  const antes = new Set((E.tabelas.contas ?? []).map((c) => c.id))
  await executar(U1, ctxEm(hoje) as never, [acao({ tipo_acao: 'recorrente', movimento: 'saida', valor: 900, descricao: 'Aluguel', dia_do_mes: dia, categoria_id: null, meio: null })] as never, 'texto' as never, null)
  const fixa = E.tabelas.fixas.find((f) => String(f.id).startsWith('fx-'))
  assert.ok(fixa, 'a conta fixa não foi gravada')
  assert.equal(fixa.dia, dia, 'a fixa tem que guardar o dia pedido, sem mexer')
  return (E.tabelas.contas ?? []).filter((c) => !antes.has(c.id) && c.fixa_id === fixa.id).map((c) => c.vencimento as string).sort()
}

await caso('whatsapp: dia 31 a partir de janeiro dá 31/01, 28/02 e 31/03', async () => {
  assert.deepEqual(await venceu('2027-01-15', 31), ['2027-01-31', '2027-02-28', '2027-03-31'])
})

await caso('whatsapp: hoje já é o dia 31 e o vencimento de hoje entra', async () => {
  assert.deepEqual(await venceu('2027-01-31', 31), ['2027-01-31', '2027-02-28', '2027-03-31'])
})

await caso('whatsapp: ano bissexto, dia 30 em fevereiro cai no dia 29', async () => {
  assert.deepEqual(await venceu('2028-01-20', 30), ['2028-01-30', '2028-02-29', '2028-03-30'])
})

await caso('whatsapp: dia 31 saindo de março passa por abril (30 dias) e volta a 31 em maio', async () => {
  assert.deepEqual(await venceu('2027-03-10', 31), ['2027-03-31', '2027-04-30', '2027-05-31'])
})

await caso('whatsapp: fevereiro comum com dia 30 e hoje no meio do mês', async () => {
  assert.deepEqual(await venceu('2027-02-10', 30), ['2027-02-28', '2027-03-30', '2027-04-30'])
})

await caso('whatsapp: último dia de um mês de 30 dias com a conta do dia 31 não duplica nem pula', async () => {
  assert.deepEqual(await venceu('2027-04-30', 31), ['2027-04-30', '2027-05-31', '2027-06-30'])
})

await caso('whatsapp: conta de dia normal segue igual (dia 15 depois do dia 15 começa no mês seguinte)', async () => {
  assert.deepEqual(await venceu('2027-04-30', 15), ['2027-05-15', '2027-06-15', '2027-07-15'])
})

/* ---------- a conversa de ponta a ponta ---------- */

for (const dia of [29, 30, 31]) {
  await caso(`conversa: "aluguel todo dia ${dia}" fica no dia ${dia}, não no 28`, async () => {
    const ia = (await import('./_falsos.ts')).ia
    ia.regras = [[/aluguel/, acoes(acao({ tipo_acao: 'recorrente', movimento: 'saida', valor: 1200, descricao: 'Aluguel da sala', dia_do_mes: dia, categoria_id: null, meio: null }))]]
    const r = await msg(`aluguel 1200 todo dia ${dia}`)
    assert.match(r, new RegExp(`todo dia ${dia}\\b`), r)
    const fixa = E.tabelas.fixas.find((f) => String(f.id).startsWith('fx-'))
    assert.ok(fixa, 'a conta fixa não foi gravada')
    assert.equal(fixa.dia, dia)
    const contas = E.tabelas.contas.filter((c) => c.fixa_id === fixa.id)
    assert.equal(contas.length, 3, 'três próximos vencimentos')
    for (const c of contas) assert.ok(!Number.isNaN(Date.parse(`${c.vencimento}T12:00:00Z`)), `vencimento inválido: ${c.vencimento}`)
  })
}

fim()
