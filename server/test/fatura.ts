/** Leitura de fatura de cartão em imagem (chama a IA). Rodar: npx tsx test/fatura.ts */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lerDocumento } from '../src/midia.ts'

const { leitura } = await lerDocumento(readFileSync(new URL('./fixtures/fatura-cartao.png', import.meta.url)), 'image/png', '')
console.log('  lido:', leitura.tipo, leitura.vencimento, leitura.transacoes.map((t) => `${t.data} ${t.descricao} ${t.valor}`))
assert.equal(leitura.tipo, 'fatura_cartao', 'tipo')
assert.equal(leitura.vencimento, '2026-12-10', 'vencimento')
const valores = leitura.transacoes.map((t) => t.valor).sort((a, b) => a - b)
assert.deepEqual(valores, [45.5, 89.9, 120], 'só as 3 compras, sem o pagamento e sem o total')
assert.ok(leitura.transacoes.every((t) => t.movimento === 'saida'))
assert.ok(leitura.transacoes.some((t) => /2\/4/.test(t.descricao)), 'parcela na descrição')
console.log('  ok fatura lida: 3 compras, vencimento 10/12, sem pagamento nem total')
