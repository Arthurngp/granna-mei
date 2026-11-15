/** Prova que o conferidor barra o que a IA errar, sem chamar a IA. Rodar: npx tsx test/conferir.ts */
import assert from 'node:assert/strict'
import { conferir, type AcaoIA, type Contexto, type RespostaIA } from '../src/interpretar.ts'
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
  data: null, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null, conta_id: null, ...x,
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
console.log(`\n${n} casos ok`)
