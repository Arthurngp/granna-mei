/**
 * Print da tela do banco (saldo) e extrato com o banco escrito. Banco e IA falsos, processar() de verdade.
 * A leitura com a IA de verdade está em test/leitura-real.ts.
 *   npx tsx test/print-banco.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, msgFoto, NUM, saldoNoBanco } from './_falsos.ts'

const P = await import('../src/print-banco.ts')
const saldo = (banco: string | null, valor: number | null) => ({ tipo: 'saldo', meio: null, vencimento: null, resumo: 'Tela de saldo', banco, saldo: valor, transacoes: [] })
const extrato = (banco: string | null) => ({
  tipo: 'extrato', meio: null, vencimento: null, resumo: 'Extrato', banco, saldo: 842.3,
  transacoes: [{ descricao: 'Carla Mendes', valor: 180, movimento: 'entrada', data: '2026-11-20' }, { descricao: 'Atacadão', valor: 96.4, movimento: 'saida', data: '2026-11-20' }],
})
const pendente = () => (E.tabelas.conversas ?? []).find((c) => c.telefone === NUM)?.pendente as Record<string, any> | null | undefined
const SEM_ENFEITE = /[\u2014\u2013]|\p{Extended_Pictographic}/u

await caso('pura: a conta do banco do print, só quando é UMA', async () => {
  const cs = [{ id: 'nu', nome: 'Nubank', tipo: 'banco' }, { id: 'it', nome: 'Itaú', tipo: 'banco' }, { id: 'k', nome: 'Cartão Nubank', tipo: 'cartao' }]
  assert.equal(P.carteiraDoBanco('NU PAGAMENTOS - IP', cs)?.id, 'nu')
  assert.equal(P.carteiraDoBanco('Banco Itaú Unibanco', cs)?.id, 'it')
  assert.equal(P.carteiraDoBanco('Banco Inter', cs), null)
  assert.equal(P.carteiraDoBanco(null, cs), null)
  assert.equal(P.carteiraDoBanco('Nubank', [...cs, { id: 'nu2', nome: 'Nubank PJ', tipo: 'banco' }]), null, 'duas contas do mesmo banco: não decide')
  for (const t of [P.textoSaldoLido('Nubank', 100, cs[0], 100), P.textoSaldoLido('Nubank', 100, cs[0], 80), P.textoSaldoLido('Inter', 100, null, null), P.textoSaldoLido(null, null, null, null)]) {
    assert.doesNotMatch(t, SEM_ENFEITE, t)
  }
})

await caso('print de saldo que bate com o anotado: confere, e nada é gravado', async () => {
  ia.documento = saldo('Nubank', 1000)
  const r = await msgFoto('saldo.jpg')
  assert.equal(r.status, 'ok')
  assert.equal(r.resposta, 'Conferi: no Nubank aqui também está R$ 1.000,00. Tudo batendo.')
  assert.equal(lancsU1().length, 0)
  assert.equal(ia.chamadas.interpretacao, 0, 'o print não passa pelo leitor de lançamentos')
})

await caso('print de saldo diferente do anotado: diz a diferença e sugere o extrato, SEM mexer no saldo', async () => {
  ia.documento = saldo('NU PAGAMENTOS - IP', 1237.45)
  const r = await msgFoto('saldo.jpg')
  assert.match(r.resposta, /^Vi R\$ 1\.237,45 de saldo no Nubank, e aqui eu tenho R\$ 1\.000,00 anotado\. A diferença de R\$ 237,45 costuma ser algo que entrou e não me contou\./)
  assert.match(r.resposta, /me manda o extrato/)
  assert.equal(lancsU1().length, 0, 'saldo virou lançamento')
  assert.equal(saldoNoBanco('nubank'), 1000, 'o saldo anotado mudou sozinho')
  const menor = await (async () => { ia.documento = saldo('Nubank', 900); return msgFoto('saldo2.jpg') })()
  assert.match(menor.resposta, /costuma ser algo que saiu/)
})

await caso('print de saldo de um banco que a pessoa não tem: diz e aponta o painel', async () => {
  ia.documento = saldo('Banco Inter', 500)
  const r = await msgFoto('saldo.jpg')
  assert.match(r.resposta, /^Vi o saldo de R\$ 500,00 no Banco Inter, mas não tenho essa conta entre as suas\./)
  assert.equal(lancsU1().length, 0)
})

await caso('print de saldo ilegível: pede o valor, não inventa', async () => {
  ia.documento = saldo('Nubank', null)
  const r = await msgFoto('saldo.jpg')
  assert.match(r.resposta, /não deu pra ler o saldo/)
  assert.equal(lancsU1().length, 0)
})

await caso('mesmo que a leitura mande transação junto do saldo, nada é gravado', async () => {
  // A leitura real descarta (midia.ts); aqui a IA falsa devolve direto, então o fluxo também tem que ignorar.
  ia.documento = { ...saldo('Nubank', 1237.45), transacoes: [{ descricao: 'Saldo', valor: 1237.45, movimento: 'entrada', data: null }] }
  ia.regras = [[/./, acoes(acao({ valor: 1237.45, descricao: 'Saldo', movimento: 'entrada', carteira_id: 'nubank' }))]]
  const r = await msgFoto('saldo.jpg')
  assert.equal(lancsU1().length, 0, 'saldo virou entrada: ' + r.resposta)
})

await caso('extrato que diz o banco e bate com UMA conta: não pergunta qual, e importa nela', async () => {
  // O cenário tem Nubank e Dinheiro (e um cartão): sem o banco no extrato, com uma conta de banco só, já não perguntava; com dois bancos perguntaria.
  E.tabelas.carteiras.push({ user_id: 'u-1', id: 'itau', nome: 'Itaú', tipo: 'banco', saldo_inicial: 0, padrao: false, fechamento: null, vencimento: null, conta_pagamento_id: null })
  ia.documento = extrato('Itaú Unibanco')
  const r = await msgFoto('extrato.jpg')
  assert.match(r.resposta, /Conferi o extrato do Itaú: 2 movimentos/)
  assert.match(r.resposta, /Quer que eu anote os dois\?$/)
  assert.equal(pendente()?.carteira, 'itau')
  const s = await msg('sim')
  assert.match(s, /anotei os 2 que faltavam/)
  assert.ok(lancsU1().every((l) => l.carteira_id === 'itau'), 'importou em outra conta')
  assert.equal(saldoNoBanco('itau'), 83.6)
})

await caso('extrato sem banco (ou de banco que ela não tem) com dois bancos: pergunta qual, como antes', async () => {
  E.tabelas.carteiras.push({ user_id: 'u-1', id: 'itau', nome: 'Itaú', tipo: 'banco', saldo_inicial: 0, padrao: false, fechamento: null, vencimento: null, conta_pagamento_id: null })
  for (const banco of [null, 'Banco Inter']) {
    E.tabelas.conversas = []
    ia.documento = extrato(banco)
    const r = await msgFoto('extrato.jpg')
    assert.match(r.resposta, /Só me diz de qual conta é esse extrato:/, String(banco))
    assert.ok(!pendente()?.carteira)
  }
})

fim()
