/**
 * Baixa em conta com o mesmo nome (banco e IA falsos em memória). Caso de origem (24/11/2026, Arthur): Internet de R$ 120 vencida em 20/11 e outra de
 * R$ 109 em 20/12; o comprovante de R$ 109 deu baixa na de DEZEMBRO (valor igual) e a de 20/11 ficou atrasada. Agora, se a IA escolheu uma conta que
 * não é a mais antiga entre as de mesmo nome e a frase não cita a data dela, a Granninha pergunta qual.
 *   npx tsx test/baixa-ambigua.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, HOJE, ia, lancsU1, msg, msgFoto, semear, somaDias, U1 } from './_falsos.ts'

const baixa = (conta_id: string, valor: number | null) => acao({ tipo_acao: 'baixar_conta', movimento: 'saida', conta_id, descricao: 'Internet', valor, categoria_id: null, meio: null, carteira_id: 'nubank' })
const ddmm = (d: string) => d.split('-').reverse().slice(0, 2).join('/')

function duasInternet() {
  semear()
  E.tabelas.contas.push(
    { user_id: U1, id: 'nov', tipo: 'pagar', descricao: 'Internet', valor: 120, vencimento: somaDias(HOJE, -3), status: 'aberta' },
    { user_id: U1, id: 'dez', tipo: 'pagar', descricao: 'Internet', valor: 109, vencimento: somaDias(HOJE, 27), status: 'aberta' },
  )
}
const conta = (id: string) => E.tabelas.contas.find((c) => c.id === id)!

await caso('o caso do Arthur: pagou 109 e a IA escolhe a conta de DEZEMBRO (valor igual): pergunta qual, e nada é baixado', async () => {
  duasInternet()
  ia.regras = [[/paguei 109 da internet/, acoes(baixa('dez', 109))]]
  const r = await msg('paguei 109 da internet')
  assert.match(r, /Você tem mais de uma conta "Internet" em aberto/)
  assert.ok(r.includes(ddmm(somaDias(HOJE, -3))) && r.includes(ddmm(somaDias(HOJE, 27))), 'lista as duas datas')
  assert.equal(conta('dez').status, 'aberta')
  assert.equal(conta('nov').status, 'aberta')
  assert.equal(lancsU1().length, 0, 'nada foi lançado antes de ela responder')
})

await caso('a pessoa responde com a data da conta de novembro: a baixa cai na certa', async () => {
  duasInternet()
  const venc = ddmm(somaDias(HOJE, -3))
  ia.regras = [
    [new RegExp('resposta para[\\s\\S]*' + venc.replace('/', '\\/')), acoes(baixa('nov', 109))],
    [/paguei 109 da internet/, acoes(baixa('dez', 109))],
  ]
  await msg('paguei 109 da internet')
  const r = await msg(venc)
  // o valor (109) é diferente do da conta (120): ainda vem a pergunta de dar baixa pagando 109, o que é o certo
  assert.match(r, /A conta de Internet está em R\$ 120,00/)
  const r2 = await msg('1')
  assert.match(r2, /Conta paga: R\$ 109,00/)
  assert.equal(conta('nov').status, 'paga')
  assert.equal(conta('dez').status, 'aberta', 'a de dezembro segue em aberto')
  assert.equal(lancsU1().length, 1)
})

await caso('a IA escolhe a conta MAIS ANTIGA: baixa direto, sem pergunta extra', async () => {
  duasInternet()
  conta('nov').valor = 109
  ia.regras = [[/paguei a internet/, acoes(baixa('nov', null))]]
  const r = await msg('paguei a internet')
  assert.ok(!/mais de uma conta/.test(r), r)
  assert.equal(conta('nov').status, 'paga')
  assert.equal(conta('dez').status, 'aberta')
})

await caso('a frase cita a data da conta de dezembro: segue sem perguntar (a pessoa escolheu)', async () => {
  duasInternet()
  const venc = ddmm(somaDias(HOJE, 27))
  ia.regras = [[/internet do dia/, acoes(baixa('dez', null))]]
  const r = await msg('paguei a internet do dia ' + venc)
  assert.ok(!/mais de uma conta/.test(r), r)
  assert.equal(conta('dez').status, 'paga')
  assert.equal(conta('nov').status, 'aberta')
})

await caso('contas de nome diferente nunca disparam a pergunta (Energia e Internet)', async () => {
  duasInternet()
  ia.regras = [[/paguei a energia/, acoes(acao({ tipo_acao: 'baixar_conta', movimento: 'saida', conta_id: 'c1', descricao: 'Energia', valor: null, categoria_id: null, meio: null, carteira_id: 'nubank' }))]]
  const r = await msg('paguei a energia')
  assert.ok(!/mais de uma conta/.test(r), r)
  assert.equal(conta('c1').status, 'paga')
})

await caso('comprovante (foto) de 109: com duas Internet e a IA escolhendo a de dezembro, também pergunta qual (era exatamente o fluxo do print)', async () => {
  duasInternet()
  ia.documento = { tipo: 'comprovante', meio: 'pix', vencimento: null, resumo: 'Comprovante', transacoes: [{ descricao: 'Internet', valor: 109, movimento: 'saida', data: null }], banco_origem: 'Nubank', titular_origem: null, banco_destino: null, titular_destino: null }
  ia.regras = [[/Internet/, acoes(baixa('dez', 109))]]
  const r = await msgFoto('f1.jpg', 'Internet')
  assert.match(r.resposta, /Você tem mais de uma conta "Internet" em aberto/)
  assert.equal(conta('dez').status, 'aberta')
  assert.equal(lancsU1().length, 0)
})

fim()
process.exit(0)
