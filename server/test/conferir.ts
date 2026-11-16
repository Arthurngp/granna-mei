/** Prova que o conferidor barra o que a IA errar, sem chamar a IA. Rodar: npx tsx test/conferir.ts */
import assert from 'node:assert/strict'
import { BOLETO, conferir, opcaoEscolhida, type AcaoIA, type Contexto, type RespostaIA } from '../src/interpretar.ts'
import { numerosDoTexto } from '../src/numeros.ts'
import { categoriasPadrao } from './categorias.ts'

const CTX: Contexto = {
  hoje: '2026-11-15',
  categorias: categoriasPadrao('beleza'),
  carteiras: [{ id: 'banco', nome: 'Banco', tipo: 'banco', padrao: true }],
  contasAbertas: [{ id: 'c-agua', descricao: 'Conta de água', valor: 85, vencimento: '2026-11-18', tipo: 'pagar' }],
}
const acao = (x: Partial<AcaoIA>): AcaoIA => ({
  tipo_acao: 'lancamento', movimento: 'saida', valor: 50, descricao: 'X', categoria_id: null, carteira_id: null, carteira_destino_id: null,
  meio: null, data: null, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null, conta_id: null, ...x,
})
const resp = (...acoes: AcaoIA[]): RespostaIA => ({ intencao: 'acoes', acoes, pergunta: null, correcao: null, falta: null })
let n = 0
const caso = (nome: string, fn: () => void) => {
  fn()
  n++
  console.log('  ok', nome)
}

caso('valor inventado pela IA vira pergunta', () => {
  const r = conferir('paguei 89 de luz', CTX, resp(acao({ valor: 98 })))
  assert.equal(r.acoes.length, 0)
  assert.ok(r.perguntar)
})
caso('valor zero nunca é gravado', () => assert.ok(conferir('paguei a luz', CTX, resp(acao({ valor: 0 }))).perguntar))
caso('valor nulo nunca é gravado', () => assert.ok(conferir('paguei a luz', CTX, resp(acao({ valor: null }))).perguntar))
caso('valor certo passa, sem data vira hoje e sem carteira vira a principal', () => {
  const r = conferir('paguei 89 de luz', CTX, resp(acao({ valor: 89 })))
  assert.equal(r.perguntar, null)
  assert.equal(r.acoes[0].data, '2026-11-15')
  assert.equal(r.acoes[0].carteira_id, 'banco')
})
caso('categoria de outro tipo é descartada', () => {
  const r = conferir('paguei 89 de luz', CTX, resp(acao({ valor: 89, categoria_id: 'servicos' })))
  assert.equal(r.acoes[0].categoria_id, null)
})
caso('data no futuro para algo que já aconteceu vira hoje', () => {
  assert.equal(conferir('paguei 89 de luz', CTX, resp(acao({ valor: 89, data: '2026-12-01' }))).acoes[0].data, '2026-11-15')
})
caso('baixa de conta que a pessoa não nomeou vira pergunta', () => {
  assert.ok(conferir('paguei a luz', CTX, resp(acao({ tipo_acao: 'baixar_conta', valor: null, conta_id: 'c-agua' }))).perguntar)
})
caso('baixa com valor diferente da conta vira lançamento novo', () => {
  const r = conferir('paguei 40 da água', CTX, resp(acao({ tipo_acao: 'baixar_conta', valor: 40, conta_id: 'c-agua' })))
  assert.equal(r.acoes[0].tipo_acao, 'lancamento')
})
caso('gasto pessoal cai na retirada do dono', () => {
  assert.equal(conferir('mercado de casa 230', CTX, resp(acao({ valor: 230, pessoal: true, categoria_id: 'alimentacao' }))).acoes[0].categoria_id, 'retirada')
})
caso('números do jeito brasileiro', () => {
  assert.deepEqual(numerosDoTexto('R$ 1.200,50 e 89,90 e 1,5 mil e 2k e 3x'), [1200.5, 89.9, 1500, 2000, 3])
})

// ---------- Várias contas, cartão e investimento (2026-11-16) ----------
const VARIAS: Contexto = {
  ...CTX,
  categorias: [...CTX.categorias, { id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida' }],
  carteiras: [
    { id: 'nubank', nome: 'Nubank', tipo: 'banco', padrao: true },
    { id: 'itau', nome: 'Itaú', tipo: 'banco', padrao: false },
    { id: 'santander', nome: 'Santander', tipo: 'banco', padrao: false },
    { id: 'dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', padrao: false },
    { id: 'maq', nome: 'Maquininha', tipo: 'maquininha', padrao: false },
    { id: 'xp', nome: 'XP', tipo: 'investimento', padrao: false },
    { id: 'cnu', nome: 'Cartão Nubank', tipo: 'cartao', padrao: false, fechamento: 3, vencimento: 10, conta_pagamento_id: 'nubank' },
    { id: 'cinter', nome: 'Cartão Inter', tipo: 'cartao', padrao: false, fechamento: 25, vencimento: 5 },
  ],
  faturasAbertas: [{ cartaoId: 'cnu', fatura: '2026-12', vence: '2026-12-10', falta: 480 }],
}
const UMA: Contexto = { ...VARIAS, carteiras: [{ id: 'banco', nome: 'Banco', tipo: 'banco', padrao: true }] }

caso('quem tem uma conta só nunca recebe pergunta de forma de pagamento', () => {
  const r = conferir('almoço 100', UMA, resp(acao({ valor: 100, descricao: 'Almoço' })))
  assert.equal(r.perguntar, null)
  assert.equal(r.acoes[0].carteira_id, 'banco')
})
caso('gasto sem forma de pagamento com várias contas pergunta, com opções numeradas (sem maquininha nem XP)', () => {
  const r = conferir('gastei 100 no almoço', VARIAS, resp(acao({ valor: 100, descricao: 'Almoço' })))
  assert.ok(r.perguntar?.startsWith('Pagou como'))
  assert.deepEqual(r.opcoes!.map((o) => o.id), ['nubank', 'itau', 'santander', 'dinheiro', 'cnu', 'cinter'])
})
caso('"no pix" com 3 bancos pergunta só entre os bancos', () => {
  const r = conferir('paguei 100 no pix', VARIAS, resp(acao({ valor: 100, meio: 'pix' })))
  assert.deepEqual(r.opcoes!.map((o) => o.id), ['nubank', 'itau', 'santander'])
})
caso('a resposta escolhida (forcarCarteira) fecha o lançamento', () => {
  const r = conferir('paguei 100 no pix', VARIAS, resp(acao({ valor: 100, meio: 'pix' })), { forcarCarteira: 'itau' })
  assert.equal(r.perguntar, null)
  assert.equal(r.acoes[0].carteira_id, 'itau')
})
caso('"dinheiro" com uma carteira de dinheiro não pergunta', () => {
  const r = conferir('100 em dinheiro', VARIAS, resp(acao({ valor: 100, meio: 'dinheiro' })))
  assert.equal(r.acoes[0].carteira_id, 'dinheiro')
})
caso('conta nomeada ("no Itaú") vale sem perguntar', () => {
  const r = conferir('paguei 100 no itaú', VARIAS, resp(acao({ valor: 100, carteira_id: 'itau' })))
  assert.equal(r.acoes[0].carteira_id, 'itau')
})
caso('compra no crédito com 2 cartões pergunta qual cartão', () => {
  const r = conferir('gastei 100 no crédito', VARIAS, resp(acao({ valor: 100, meio: 'credito' })))
  assert.deepEqual(r.opcoes!.map((o) => o.id), ['cnu', 'cinter'])
})
caso('compra no cartão nomeado vira compra na fatura certa (fecha 3, vence 10)', () => {
  const r = conferir('100 no cartão nubank', VARIAS, resp(acao({ valor: 100, carteira_id: 'cnu', meio: 'credito' })))
  assert.equal(r.acoes[0].noCartao, true)
  assert.equal(r.acoes[0].fatura, '2026-12')
})
caso('crédito sem cartão cadastrado pede o cadastro, não grava na maquininha', () => {
  const r = conferir('100 no crédito', { ...VARIAS, carteiras: VARIAS.carteiras.filter((c) => c.tipo !== 'cartao') }, resp(acao({ valor: 100, meio: 'credito' })))
  assert.match(r.perguntar!, /cadastrou cartão/)
})
caso('entrada no cartão vai para a maquininha', () => {
  const r = conferir('corte 80 no cartão', VARIAS, resp(acao({ valor: 80, movimento: 'entrada', meio: 'credito' })))
  assert.equal(r.acoes[0].carteira_id, 'maq')
})
caso('parcelado no crédito com cartão escolhido vira parcelas no cartão', () => {
  const r = conferir('1200 em 4x', VARIAS, resp(acao({ tipo_acao: 'parcelado', valor: 1200, parcelas: 4, meio: 'credito' })), { forcarCarteira: 'cinter' })
  assert.equal(r.acoes[0].noCartao, true)
  assert.equal(r.acoes[0].carteira_id, 'cinter')
})
caso('parcelado sem meio, com cartão cadastrado, pergunta cartão ou boleto', () => {
  const r = conferir('1200 em 4x', VARIAS, resp(acao({ tipo_acao: 'parcelado', valor: 1200, parcelas: 4 })))
  assert.deepEqual(r.opcoes!.map((o) => o.id), ['cnu', 'cinter', BOLETO])
})
caso('parcelado no boleto vira contas a pagar', () => {
  const r = conferir('1200 em 4x', VARIAS, resp(acao({ tipo_acao: 'parcelado', valor: 1200, parcelas: 4 })), { forcarCarteira: BOLETO })
  assert.equal(r.acoes[0].noCartao, false)
})
caso('pagar fatura sem valor usa o que falta da fatura e sai da conta que paga o cartão', () => {
  const r = conferir('paguei a fatura do nubank', VARIAS, resp(acao({ tipo_acao: 'pagar_fatura', valor: null, carteira_destino_id: 'cnu' })))
  assert.equal(r.perguntar, null)
  assert.equal(r.acoes[0].valor, 480)
  assert.equal(r.acoes[0].carteira_id, 'nubank')
  assert.equal(r.acoes[0].fatura, '2026-12')
})
caso('pagar fatura sem dizer o cartão, com 2 cartões, pergunta qual', () => {
  const r = conferir('paguei a fatura', VARIAS, resp(acao({ tipo_acao: 'pagar_fatura', valor: null })))
  assert.deepEqual(r.opcoes!.map((o) => o.id), ['cnu', 'cinter'])
})
caso('transferência para investimento é transferência, sem categoria', () => {
  const r = conferir('guardei 500 na xp', VARIAS, resp(acao({ tipo_acao: 'transferencia', valor: 500, carteira_id: 'nubank', carteira_destino_id: 'xp', movimento: null })))
  assert.equal(r.acoes[0].tipo_acao, 'transferencia')
  assert.equal(r.acoes[0].categoria_id, null)
})
caso('transferência para o cartão vira pagamento de fatura', () => {
  const r = conferir('passei 480 do nubank pro cartão', VARIAS, resp(acao({ tipo_acao: 'transferencia', valor: 480, carteira_id: 'nubank', carteira_destino_id: 'cnu', movimento: null })))
  assert.equal(r.acoes[0].tipo_acao, 'pagar_fatura')
})
caso('XP nunca aparece como opção de gasto', () => {
  const r = conferir('gastei 50', VARIAS, resp(acao({ valor: 50, carteira_id: 'xp' })))
  assert.ok(!r.opcoes?.some((o) => o.id === 'xp'))
})
caso('gasto sem categoria que sirva vai para "Outros gastos"', () => {
  const r = conferir('100 de coisa', UMA, resp(acao({ valor: 100, categoria_id: null })))
  assert.equal(r.acoes[0].categoria_id, 'outras-saidas')
})
caso('criar categoria passa sem valor', () => {
  const r = conferir('criar categoria Combustível', UMA, resp(acao({ tipo_acao: 'criar_categoria', valor: null, descricao: 'Combustível' })))
  assert.equal(r.perguntar, null)
  assert.equal(r.acoes[0].descricao, 'Combustível')
})
caso('resposta "2", "2." ou nome escolhe a opção; número fora da lista não escolhe', () => {
  const ops = [{ id: 'nubank', nome: 'Nubank' }, { id: 'itau', nome: 'Itaú' }]
  assert.equal(opcaoEscolhida('2', ops)?.id, 'itau')
  assert.equal(opcaoEscolhida(' 2. ', ops)?.id, 'itau')
  assert.equal(opcaoEscolhida('itau', ops)?.id, 'itau')
  assert.equal(opcaoEscolhida('foi no Itaú', ops)?.id, 'itau')
  assert.equal(opcaoEscolhida('5', ops), null)
})
caso('modo sem pergunta (importação) usa a primeira conta que serve', () => {
  const r = conferir('100', VARIAS, resp(acao({ valor: 100 })), { perguntarMeio: false })
  assert.equal(r.perguntar, null)
  assert.equal(r.acoes[0].carteira_id, 'nubank')
})
console.log(`\n${n} casos ok`)
