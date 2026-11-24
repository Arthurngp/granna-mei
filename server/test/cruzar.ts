/**
 * Cruzamento do banco de origem e de destino do comprovante com as carteiras do cliente (src/cruzar.ts).
 * Casos de origem: os comprovantes do Arthur de 23/11/2026 (Pix do Nubank para Bradesco/Midway, Cora, cartão de loja pago do Nubank).
 * Resultados esperados escritos à mão.
 *   npx tsx test/cruzar.ts
 */
import assert from 'node:assert/strict'
import { caso, fim } from './_falsos.ts'

const { chaveBanco, cruzarComprovante, titularEhDono } = await import('../src/cruzar.ts')

const NUBANK = { id: 'nubank', nome: 'Nubank', tipo: 'banco' }
const CORA = { id: 'cora', nome: 'Cora', tipo: 'banco' }
const BRAD = { id: 'brad', nome: 'Bradesco', tipo: 'banco' }
const CARTAO = { id: 'cartao', nome: 'Cartão Nubank', tipo: 'cartao' }
const DONOS = ['Arthur Eduardo Mendes de Oliveira', 'NGP Marketing']

await caso('nomes de banco como aparecem em comprovante e como o cliente chama a carteira', async () => {
  const t: [string, string | null][] = [
    ['NU PAGAMENTOS - IP', 'nubank'], ['Nubank', 'nubank'], ['nu', 'nubank'], ['BCO BRADESCO S.A.', 'bradesco'], ['Itaú Unibanco S.A.', 'itau'], ['Banco Inter', 'inter'],
    ['CORA SCD S.A.', 'cora'], ['Mercado Pago', 'mercadopago'], ['C6 BANK', 'c6'], ['Caixa Econômica Federal', 'caixa'], ['Banco do Brasil', 'bb'],
    ['Conta do banco', null], ['Dinheiro', null], ['', null], ['Minha conta', null],
  ]
  for (const [texto, esperado] of t) assert.equal(chaveBanco(texto), esperado, texto)
  assert.equal(chaveBanco(null), null)
})

await caso('titular: o dono (nome ou negócio) reconhece; outra pessoa não; sobrenome sozinho não basta', async () => {
  assert.ok(titularEhDono('Arthur Eduardo Mendes de Oliveira', DONOS))
  assert.ok(titularEhDono('ARTHUR E. MENDES OLIVEIRA', DONOS))
  assert.ok(titularEhDono('NGP MARKETING LTDA', DONOS))
  assert.ok(!titularEhDono('Nathalli Souza', DONOS))
  assert.ok(!titularEhDono('Maria Mendes', DONOS), 'só o sobrenome em comum não é o dono')
  assert.ok(!titularEhDono(null, DONOS))
})

await caso('Pix do Nubank dele para o Bradesco dele: transferência entre contas (não é entrada nem saída)', async () => {
  const r = cruzarComprovante({ banco_origem: 'NU PAGAMENTOS - IP', titular_origem: 'Arthur Eduardo Mendes de Oliveira', banco_destino: 'BCO BRADESCO S.A.', titular_destino: 'Arthur Eduardo Mendes de Oliveira' }, [NUBANK, BRAD, CARTAO], DONOS)
  assert.deepEqual(r && r.tipo === 'transferencia' ? [r.de.id, r.para.id] : r, ['nubank', 'brad'])
})

await caso('pagamento do Nubank dele para terceiro (cartão de loja, Midway): saída do Nubank', async () => {
  const r = cruzarComprovante({ banco_origem: 'NU PAGAMENTOS - IP', titular_origem: 'Arthur Eduardo Mendes de Oliveira', banco_destino: 'BCO BRADESCO S.A.', titular_destino: 'MIDWAY' }, [NUBANK, CORA], DONOS)
  assert.equal(r?.tipo, 'saida')
  assert.equal(r && r.tipo === 'saida' ? r.carteira.id : null, 'nubank')
})

await caso('Pix recebido de outra pessoa na Cora: entrada na Cora', async () => {
  const r = cruzarComprovante({ banco_origem: 'Banco Inter', titular_origem: 'João Pereira', banco_destino: 'CORA SCD', titular_destino: 'NGP Marketing Ltda' }, [NUBANK, CORA], DONOS)
  assert.equal(r?.tipo, 'entrada')
  assert.equal(r && r.tipo === 'entrada' ? r.carteira.id : null, 'cora')
})

await caso('ARMADILHA: recebeu Pix de alguém que também usa Nubank, e ele tem Nubank: NÃO é saída (titular de origem é outra pessoa)', async () => {
  const r = cruzarComprovante({ banco_origem: 'NU PAGAMENTOS', titular_origem: 'Carla Souza', banco_destino: 'CORA SCD', titular_destino: 'NGP Marketing' }, [NUBANK, CORA], DONOS)
  assert.equal(r?.tipo, 'entrada')
  assert.equal(r && r.tipo === 'entrada' ? r.carteira.id : null, 'cora')
})

await caso('ARMADILHA: pagou alguém que também usa Nubank: saída do banco DELE, não entrada no Nubank (titular de destino é outra pessoa)', async () => {
  const r = cruzarComprovante({ banco_origem: 'CORA SCD', titular_origem: 'NGP Marketing', banco_destino: 'NU PAGAMENTOS', titular_destino: 'Carla Souza' }, [NUBANK, CORA], DONOS)
  assert.equal(r?.tipo, 'saida')
  assert.equal(r && r.tipo === 'saida' ? r.carteira.id : null, 'cora')
})

await caso('comprovante sem titular: confia no banco', async () => {
  const r = cruzarComprovante({ banco_origem: 'Nubank', titular_origem: null, banco_destino: null, titular_destino: null }, [NUBANK, CORA], DONOS)
  assert.equal(r?.tipo, 'saida')
})

await caso('duas carteiras do mesmo banco (Nubank PF e PJ): ambíguo, não decide (o fluxo pergunta)', async () => {
  const r = cruzarComprovante({ banco_origem: 'NU PAGAMENTOS', titular_origem: 'Arthur Eduardo Mendes de Oliveira', banco_destino: null, titular_destino: null },
    [NUBANK, { id: 'nu-pj', nome: 'Nubank PJ', tipo: 'banco' }, CORA], DONOS)
  assert.equal(r, null)
})

await caso('banco que o cliente não cadastrou, banco desconhecido e carteira de outro tipo: não decide', async () => {
  assert.equal(cruzarComprovante({ banco_origem: 'Banco Safra', titular_origem: null, banco_destino: null, titular_destino: null }, [NUBANK], DONOS), null)
  assert.equal(cruzarComprovante({ banco_origem: 'Banco que não existe', titular_origem: null, banco_destino: null, titular_destino: null }, [NUBANK], DONOS), null)
  assert.equal(cruzarComprovante({ banco_origem: 'Nubank', titular_origem: null, banco_destino: null, titular_destino: null }, [CARTAO], DONOS), null, 'cartão não é conta de banco')
  assert.equal(cruzarComprovante({}, [NUBANK], DONOS), null)
})

await caso('origem e destino na MESMA carteira não é transferência', async () => {
  assert.equal(cruzarComprovante({ banco_origem: 'Nubank', titular_origem: null, banco_destino: 'Nubank', titular_destino: null }, [NUBANK], DONOS), null)
})

fim()
