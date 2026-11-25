/**
 * Comprovante de pagamento que não ficava lançado, e conversa que travava (caso de origem, 23/11/2026, print do Arthur):
 *  - "Pagamento de cartão CEA de Nathalli com meu Nubank" + comprovante: a Granninha leu R$ 325,77 e respondeu "Li R$ 325,77 nesse comprovante. O que foi?"
 *    (a IA devolvia "pagar fatura", o conferidor descartava esse tipo no comprovante e o cartão de loja nem é cadastrado);
 *  - depois disso TODA mensagem (325,77, 209,85, "cartão CEA de nath") recebia a mesma pergunta de R$ 192,05: o comprovante antigo era herdado por
 *    qualquer mensagem seguinte e o valor nunca batia.
 * Banco e IA falsos em memória. Os resultados esperados são escritos à mão.
 *   npx tsx test/comprovante-preso.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, msgFoto, semear } from './_falsos.ts'

const doc = (valor: number, descricao: string) => ({ tipo: 'comprovante', meio: 'pix', vencimento: null, resumo: `Comprovante de R$ ${valor}`, transacoes: [{ descricao, valor, movimento: 'saida', data: null }] })
const pagouCartao = (x: Partial<Parameters<typeof acao>[0]> = {}) => acao({ tipo_acao: 'pagar_fatura', movimento: null, valor: null, descricao: 'Cartão CEA', carteira_id: 'nubank', categoria_id: null, meio: null, ...x })

await caso('comprovante de pagamento de cartão de loja (não cadastrado) com legenda: lança a saída do valor do documento, sem perguntar', async () => {
  semear()
  ia.documento = doc(325.77, 'CEA')
  ia.regras = [[/CEA de Nathalli/, acoes(pagouCartao())]]
  const r = await msgFoto('f1.jpg', 'Pagamento de cartão CEA de Nathalli com meu Nubank')
  assert.ok(!/Li R\$/.test(r.resposta), r.resposta)
  assert.match(r.resposta, /saiu R\$ 325,77/)
  assert.equal(lancsU1().length, 1)
  assert.equal(Number(lancsU1()[0].valor), 325.77)
  assert.equal(lancsU1()[0].tipo, 'saida')
  assert.equal(lancsU1()[0].carteira_id, 'nubank')
})

await caso('a IA erra o valor do comprovante: vale o do documento (nunca o da IA)', async () => {
  semear()
  ia.documento = doc(192.05, 'Riachuelo')
  ia.regras = [[/Riachuelo/, acoes(pagouCartao({ valor: 9500, descricao: 'Cartão Riachuelo' }))]]
  await msgFoto('f1.jpg', 'Pagamento do meu cartão Riachuelo, paguei com meu Nubank')
  assert.equal(lancsU1().length, 1)
  assert.equal(Number(lancsU1()[0].valor), 192.05)
})

await caso('pergunta aberta do comprovante + mensagem NOVA com outro valor: registra a nova e a pergunta do comprovante volta UMA vez, separada (não é mais o laço do print)', async () => {
  semear()
  ia.documento = doc(192.05, 'Riachuelo')
  // A IA entende mal a legenda do comprovante e não devolve nada que bata: a pergunta "Li R$ 192,05" é inevitável aqui.
  ia.regras = [
    [/parcelamento de Santander/, acoes(acao({ valor: 209.85, descricao: 'Parcelamento Santander', categoria_id: null, carteira_id: 'nubank' }))],
    [/comprovante/, { intencao: 'acoes', acoes: [], pergunta: null, correcao: null, falta: null }],
  ]
  const r1 = await msgFoto('f1.jpg', 'comprovante')
  assert.match(r1.resposta, /Li R\$ 192,05 nesse comprovante/)
  const r2 = await msg('Saiu 209,85 pagamento de parcelamento de Santander do Nubank')
  assert.match(r2, /^Anotei, saiu R\$ 209,85|^Tá anotado, saiu R\$ 209,85|^Feito, saiu R\$ 209,85/, 'a mensagem nova é registrada sozinha: ' + r2)
  assert.equal(lancsU1().length, 1)
  assert.equal(Number(lancsU1()[0].valor), 209.85)
  // O comprovante de 192,05 não foi gravado: a pergunta volta, uma vez e no fim, para ele não se perder calado.
  assert.match(r2, /\n\nE ficou esse aqui esperando:\nLi R\$ 192,05 nesse comprovante/)
  assert.equal((r2.match(/Li R\$ 192,05/g) ?? []).length, 1, 'repetida mais de uma vez: ' + r2)
  // Ignorada de novo, sai, avisando. Não volta mais.
  ia.regras.unshift([/padaria/, acoes(acao({ valor: 12, descricao: 'Padaria', carteira_id: 'nubank' }))])
  const r3 = await msg('paguei 12 de padaria no nubank')
  assert.doesNotMatch(r3, /Li R\$ 192,05/)
  assert.match(r3, /Ficou sem anotar/)
  const r4 = await msg('paguei 12 de padaria no nubank de novo')
  assert.doesNotMatch(r4, /192,05|Ficou sem anotar/)
})

await caso('pergunta aberta do comprovante + resposta SEM número ("cartão CEA de nath"): continua e usa o valor do comprovante', async () => {
  semear()
  ia.documento = doc(325.77, 'CEA')
  ia.regras = [
    [/cartão CEA de nath/, acoes(pagouCartao())],
    [/comprovante/, { intencao: 'acoes', acoes: [], pergunta: null, correcao: null, falta: null }],
  ]
  const r1 = await msgFoto('f1.jpg', 'comprovante')
  assert.match(r1.resposta, /Li R\$ 325,77/)
  const r2 = await msg('cartão CEA de nath')
  assert.match(r2, /saiu R\$ 325,77/)
  assert.equal(lancsU1().length, 1)
  assert.equal(Number(lancsU1()[0].valor), 325.77)
})

await caso('pergunta aberta do comprovante + mensagem com o MESMO valor do documento continua como resposta', async () => {
  semear()
  ia.documento = doc(325.77, 'CEA')
  ia.regras = [
    [/Paguei um cartão CEA/, acoes(pagouCartao({ valor: 325.77 }))],
    [/comprovante/, { intencao: 'acoes', acoes: [], pergunta: null, correcao: null, falta: null }],
  ]
  await msgFoto('f1.jpg', 'comprovante')
  const r = await msg('Paguei um cartão CEA de Nathalli no valor de 325,77')
  assert.match(r, /saiu R\$ 325,77/)
  assert.equal(lancsU1().length, 1, 'um só lançamento, sem dobrar')
})

fim()
void E
