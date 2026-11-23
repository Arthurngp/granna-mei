/**
 * Comprovante cruzado com as contas do cliente, de ponta a ponta (banco e IA falsos em memória).
 * Pedido do Arthur (23/11/2026): mandar só o comprovante e a Granninha identificar de qual banco saiu e para qual foi, e entender sozinha se foi
 * entrada, saída ou dinheiro passando de uma conta dele para outra. O cruzamento é no código (src/cruzar.ts); a IA só lê o documento.
 * Resultados esperados escritos à mão.
 *   npx tsx test/comprovante-cruzado.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msgFoto, semear, U1 } from './_falsos.ts'

const doc = (x: Record<string, unknown>) => ({ tipo: 'comprovante', meio: 'pix', vencimento: null, resumo: 'Comprovante', transacoes: [{ descricao: 'Destino', valor: 500, movimento: 'saida', data: null }], banco_origem: null, titular_origem: null, banco_destino: null, titular_destino: null, ...x })
const DONO = 'Arthur Teste' // nome do perfil no cenário semeado

function comBancos() {
  semear()
  E.tabelas.carteiras.push(
    { user_id: U1, id: 'cora', nome: 'Cora', tipo: 'banco', saldo_inicial: 0, padrao: false, fechamento: null, vencimento: null, conta_pagamento_id: null },
    { user_id: U1, id: 'bradesco', nome: 'Bradesco', tipo: 'banco', saldo_inicial: 0, padrao: false, fechamento: null, vencimento: null, conta_pagamento_id: null },
  )
}
const SEM_IA = { intencao: 'acoes', acoes: [], pergunta: null, correcao: null, falta: null }

await caso('Pix do Nubank dele para o Bradesco dele: vira transferência, sem perguntar, sem contar como entrada nem saída', async () => {
  comBancos()
  ia.documento = doc({ banco_origem: 'NU PAGAMENTOS - IP', titular_origem: DONO, banco_destino: 'BCO BRADESCO S.A.', titular_destino: DONO })
  const r = await msgFoto('f1.jpg', '')
  assert.match(r.resposta, /Não conta como entrada nem saída/)
  assert.equal(lancsU1().length, 1)
  const l = lancsU1()[0]
  assert.deepEqual([l.tipo, l.carteira_id, l.carteira_destino_id, Number(l.valor)], ['transferencia', 'nubank', 'bradesco', 500])
  assert.equal(ia.chamadas.interpretacao, 0, 'nem precisou da IA de interpretação')
})

await caso('pagamento a terceiro com legenda sem valor: saída do banco de origem, sem perguntar "de qual conta?"', async () => {
  comBancos()
  ia.documento = doc({ transacoes: [{ descricao: 'Midway', valor: 192.05, movimento: 'saida', data: null }], banco_origem: 'NU PAGAMENTOS - IP', titular_origem: DONO, banco_destino: 'BCO BRADESCO S.A.', titular_destino: 'MIDWAY' })
  ia.regras = [[/Riachuelo/, acoes(acao({ valor: null, descricao: 'Cartão Riachuelo', categoria_id: null, meio: null }))]]
  const r = await msgFoto('f1.jpg', 'Pagamento do meu cartão Riachuelo')
  assert.ok(!/qual conta/i.test(r.resposta), r.resposta)
  assert.match(r.resposta, /saiu R\$ 192,05/)
  assert.equal(lancsU1().length, 1)
  assert.deepEqual([lancsU1()[0].tipo, lancsU1()[0].carteira_id], ['saida', 'nubank'])
})

await caso('Pix recebido: entrada na conta de destino mesmo se a leitura achou que era saída', async () => {
  comBancos()
  ia.documento = doc({ transacoes: [{ descricao: 'Carla Souza', valor: 250, movimento: 'saida', data: null }], banco_origem: 'NU PAGAMENTOS', titular_origem: 'Carla Souza', banco_destino: 'CORA SCD S.A.', titular_destino: DONO })
  ia.regras = [[/serviço/, acoes(acao({ valor: null, movimento: 'entrada', descricao: 'Serviço', categoria_id: 'vendas', meio: null }))]]
  const r = await msgFoto('f1.jpg', 'entrada de serviço')
  assert.match(r.resposta, /entrou R\$ 250,00/)
  assert.deepEqual([lancsU1()[0].tipo, lancsU1()[0].carteira_id], ['entrada', 'cora'])
})

await caso('ARMADILHA: recebeu Pix de alguém que usa Nubank (ele também tem Nubank): entra na Cora, não sai do Nubank', async () => {
  comBancos()
  ia.documento = doc({ transacoes: [{ descricao: 'Carla Souza', valor: 80, movimento: 'saida', data: null }], banco_origem: 'NU PAGAMENTOS', titular_origem: 'Carla Souza', banco_destino: 'CORA SCD S.A.', titular_destino: DONO })
  ia.regras = [[/cliente/, acoes(acao({ valor: null, movimento: 'entrada', descricao: 'Cliente', categoria_id: 'vendas', meio: null }))]]
  await msgFoto('f1.jpg', 'pix de cliente')
  assert.equal(lancsU1().filter((l) => l.carteira_id === 'nubank' && l.tipo === 'saida').length, 0)
  assert.equal(lancsU1()[0].tipo, 'entrada')
})

await caso('duas contas do mesmo banco (Nubank PF e PJ): não adivinha, pergunta de qual conta saiu', async () => {
  comBancos()
  E.tabelas.carteiras.push({ user_id: U1, id: 'nu-pj', nome: 'Nubank PJ', tipo: 'banco', saldo_inicial: 0, padrao: false, fechamento: null, vencimento: null, conta_pagamento_id: null })
  ia.documento = doc({ transacoes: [{ descricao: 'Midway', valor: 90, movimento: 'saida', data: null }], banco_origem: 'NU PAGAMENTOS - IP', titular_origem: DONO, banco_destino: 'MIDWAY', titular_destino: 'MIDWAY' })
  ia.regras = [[/conta de luz/, acoes(acao({ valor: null, descricao: 'Luz', categoria_id: null, meio: 'pix' }))]]
  const r = await msgFoto('f1.jpg', 'conta de luz')
  assert.match(r.resposta, /saiu de qual conta/i)
  assert.equal(lancsU1().length, 0, 'nada gravado até ela responder')
})

await caso('banco do comprovante que o cliente não cadastrou: segue como antes (pergunta a conta quando há várias)', async () => {
  comBancos()
  ia.documento = doc({ transacoes: [{ descricao: 'Midway', valor: 90, movimento: 'saida', data: null }], banco_origem: 'Banco Safra', titular_origem: DONO })
  ia.regras = [[/conta de luz/, acoes(acao({ valor: null, descricao: 'Luz', categoria_id: null, meio: 'pix' }))]]
  const r = await msgFoto('f1.jpg', 'conta de luz')
  assert.match(r.resposta, /saiu de qual conta/i)
  void SEM_IA
})

fim()
