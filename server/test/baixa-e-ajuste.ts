/**
 * O pedido literal do Arthur (23/11/2026): "Saiu 209,85 pagamento de parcelamento de Santander do Nubank, dá baixa na conta pagando 209,85
 * e altera o valor da conta fixa para esse valor". São DUAS ações na mesma mensagem: baixar a conta em aberto (com valor diferente do dela) e
 * ajustar a conta fixa. As duas têm que acontecer, nenhuma pode se perder.
 *   npx tsx test/baixa-e-ajuste.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, HOJE, ia, lancsU1, msg, semear, somaDias, U1 } from './_falsos.ts'

function santander() {
  semear()
  E.tabelas.fixas.push({ user_id: U1, id: 'f-sant', descricao: 'Parcelamento Santander', valor: 200, dia: 20 })
  E.tabelas.contas.push(
    { user_id: U1, id: 's-1', tipo: 'pagar', descricao: 'Parcelamento Santander', valor: 200, vencimento: somaDias(HOJE, -2), status: 'aberta', fixa_id: 'f-sant' },
    { user_id: U1, id: 's-2', tipo: 'pagar', descricao: 'Parcelamento Santander', valor: 200, vencimento: somaDias(HOJE, 28), status: 'aberta', fixa_id: 'f-sant' },
  )
}
const FRASE = 'Saiu 209,85 pagamento de parcelamento de Santander do Nubank, dá baixa na conta pagando 209,85 e altera o valor da conta fixa para esse valor'
const regra = () => [[/parcelamento de Santander/, acoes(
  acao({ tipo_acao: 'baixar_conta', movimento: 'saida', conta_id: 's-1', descricao: 'Parcelamento Santander', valor: 209.85, carteira_id: 'nubank', categoria_id: null, meio: null }),
  acao({ tipo_acao: 'ajustar_fixa', movimento: null, fixa_id: 'f-sant', descricao: 'Parcelamento Santander', valor: 209.85, categoria_id: null, meio: null }),
)]] as [RegExp, unknown][]

await caso('baixa com valor diferente + ajuste da conta fixa na mesma mensagem: pergunta uma vez e, respondida, faz as DUAS coisas', async () => {
  santander()
  ia.regras = regra()
  const r1 = await msg(FRASE)
  console.log('   1a resposta:', JSON.stringify(r1.slice(0, 220)))
  const fixa = () => E.tabelas.fixas.find((f) => f.id === 'f-sant')!
  const c = (id: string) => E.tabelas.contas.find((x) => x.id === id)!
  // Se perguntou (valor diferente do da conta), responde "1" (dar baixa); se já fez, segue.
  if (!/Pronto|Anotei|Paguei|agora/i.test(r1) && /\n1\./.test(r1)) {
    const r2 = await msg('1')
    console.log('   2a resposta:', JSON.stringify(r2.slice(0, 220)))
  }
  assert.equal(c('s-1').status, 'paga', 'a conta foi baixada')
  assert.equal(lancsU1().filter((l) => Math.abs(Number(l.valor) - 209.85) < 0.005).length, 1, 'um lançamento de 209,85, sem dobrar')
  assert.equal(Number(fixa().valor), 209.85, 'a conta fixa passou para 209,85')
  assert.equal(Number(c('s-2').valor), 209.85, 'a próxima conta também')
})

fim()
