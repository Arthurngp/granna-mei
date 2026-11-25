/**
 * Leitura de documentos com a IA REAL (custa alguns centavos por rodada). Cobre os prints que o onboarding pelo WhatsApp vai pedir (tela de saldo
 * do app do banco, print de extrato) e, para provar que a mudança no prompt não estragou nada, os documentos que já eram lidos (comprovante, extrato
 * em PDF, fatura de cartão e os comprovantes com ordem escondida). As imagens novas são SINTÉTICAS, com dados inventados (nada de print de cliente).
 *
 *   /usr/bin/python3 -I server/scripts/rodar-leitura-real.py
 *
 * Saída: uma linha por documento com o que foi lido, e FALHA com o motivo. Termina com código 1 se algo falhou.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lerDocumento, type Leitura } from '../src/midia.ts'

const ler = async (arquivo: string, legenda = ''): Promise<Leitura> => {
  const buf = readFileSync(new URL(`./fixtures/${arquivo}`, import.meta.url))
  const { leitura } = await lerDocumento(buf, arquivo.endsWith('.pdf') ? 'application/pdf' : 'image/png', legenda)
  return leitura
}
const ver = (l: Leitura) => JSON.stringify({ tipo: l.tipo, banco: (l as { banco?: unknown }).banco ?? null, saldo: (l as { saldo?: unknown }).saldo ?? null, n: l.transacoes.length, valores: l.transacoes.map((t) => `${t.movimento === 'entrada' ? '+' : '-'}${t.valor}${t.data ? '@' + t.data : ''}`) })

let falhas = 0
async function caso(nome: string, arquivo: string, confere: (l: Leitura) => void, legenda = '') {
  let l: Leitura | null = null
  try {
    l = await ler(arquivo, legenda)
    confere(l)
    console.log('  ok   ', nome, '|', ver(l))
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '|', l ? ver(l) : '(não leu)', '->', (e as Error).message.slice(0, 200))
  }
}

/* ---------- o que é novo ---------- */

await caso('print da tela de saldo: é SALDO, não lançamento (o valor nunca vira gasto nem entrada)', 'saldo-app.png', (l) => {
  assert.equal(l.tipo, 'saldo')
  assert.equal(l.transacoes.length, 0, 'saldo virou transação')
  assert.equal((l as { saldo?: number }).saldo, 1237.45)
  assert.match(String((l as { banco?: string }).banco ?? ''), /nubank|^nu\b/i)
})

await caso('print do extrato no app: extrato com o banco, cada transação com data e o saldo final', 'extrato-print.png', (l) => {
  assert.equal(l.tipo, 'extrato')
  assert.match(String((l as { banco?: string }).banco ?? ''), /inter/i)
  assert.deepEqual(l.transacoes.map((t) => t.valor).sort((a, b) => a - b), [75, 96.4, 132.18, 180])
  assert.deepEqual(l.transacoes.filter((t) => t.movimento === 'entrada').map((t) => t.valor).sort((a, b) => a - b), [75, 180])
  assert.ok(l.transacoes.every((t) => t.data === '2026-11-20' || t.data === '2026-11-21'), 'datas')
  assert.equal((l as { saldo?: number }).saldo, 842.3)
})

/* ---------- o que já funcionava e não pode quebrar ---------- */

await caso('comprovante de Pix continua comprovante, com uma transação', 'comprovante.png', (l) => {
  assert.equal(l.tipo, 'comprovante')
  assert.equal(l.transacoes.length, 1)
})

await caso('extrato em PDF continua extrato, com as 3 transações', 'extrato.pdf', (l) => {
  assert.equal(l.tipo, 'extrato')
  assert.equal(l.transacoes.length, 3)
})

await caso('fatura de cartão continua fatura, só as 3 compras', 'fatura-cartao.png', (l) => {
  assert.equal(l.tipo, 'fatura_cartao')
  assert.deepEqual(l.transacoes.map((t) => t.valor).sort((a, b) => a - b), [45.5, 89.9, 120])
})

for (const f of ['pix-com-ordem.png', 'pix-ordem-escondida.png']) {
  await caso(`ordem escondida no documento continua ignorada (${f})`, f, (l) => {
    assert.ok(l.transacoes.length <= 1, 'ordem virou mais de uma transação')
    assert.ok(!l.transacoes.some((t) => t.valor >= 9000), 'valor da ordem escondida entrou')
  })
}

await caso('documento que só tem uma ordem não vira transação nem saldo', 'so-ordem.png', (l) => {
  assert.equal(l.transacoes.length, 0)
  assert.ok(!(l as { saldo?: number | null }).saldo, 'ordem virou saldo')
})

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
