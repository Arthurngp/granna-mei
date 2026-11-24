/**
 * IA REAL (OpenAI), sem banco: confere se o esquema e o prompt das ações de conta fixa são aceitos e se a IA escolhe a ação certa.
 * Gasta centavos (uma chamada por frase). NÃO está em `test:sem-ia`. Rodar com a chave da Coolify no ambiente:
 *   /usr/bin/python3 -I server/scripts/rodar-fluxo.py   (gate completo, banco real)
 *   ou um wrapper que injete OPENAI_API_KEY e rode: npx tsx test/ia-real-acoes.ts [comprovante.png ...]
 * Imagens opcionais na linha de comando: lê cada uma com a leitura de comprovante real e imprime banco e titular de origem e destino.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { interpretar, type Contexto } from '../src/interpretar.ts'
import { lerDocumento } from '../src/midia.ts'
import { cruzarComprovante } from '../src/cruzar.ts'

const ctx: Contexto = {
  hoje: '2026-11-23',
  categorias: [
    { id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida' },
    { id: 'outras-entradas', nome: 'Outras entradas', tipo: 'entrada' },
    { id: 'vendas', nome: 'Vendas', tipo: 'entrada' },
    { id: 'contas-casa', nome: 'Luz, água e internet', tipo: 'saida' },
  ],
  carteiras: [
    { id: 'nubank', nome: 'Nubank', tipo: 'banco', padrao: true },
    { id: 'cora', nome: 'Cora', tipo: 'banco', padrao: false },
  ],
  contasAbertas: [
    { id: 'c-net-1', descricao: 'Internet', valor: 120, vencimento: '2026-11-20', tipo: 'pagar' },
    { id: 'c-net-2', descricao: 'Internet', valor: 120, vencimento: '2026-12-20', tipo: 'pagar' },
    { id: 'c-luz', descricao: 'Energia', valor: 150, vencimento: '2026-11-27', tipo: 'pagar' },
  ],
  fixas: [
    { id: 'fx-net', descricao: 'Internet', valor: 120, dia: 20 },
    { id: 'fx-alu', descricao: 'Aluguel da sala', valor: 900, dia: 10 },
  ],
}

const UMA_CARTEIRA: Contexto = { ...ctx, carteiras: [ctx.carteiras[0]] }
let falhas = 0
const caso = async (frase: string, confere: (a: Awaited<ReturnType<typeof interpretar>>) => void, contexto: Contexto = ctx) => {
  try {
    const r = await interpretar(frase, contexto)
    confere(r)
    console.log('  ok   ', frase, '->', r.acoes.map((a) => `${a.tipo_acao}${a.fixa_id ? ' fixa=' + a.fixa_id : ''}${a.conta_id ? ' conta=' + a.conta_id : ''}${a.valor != null ? ' valor=' + a.valor : ''}${a.dia_do_mes ? ' dia=' + a.dia_do_mes : ''}${a.vencimento ? ' venc=' + a.vencimento : ''}`).join(' | ') || r.perguntar)
  } catch (e) {
    falhas++
    console.log('  FALHA', frase, '->', (e as Error).message.slice(0, 300))
  }
}
const um = (r: Awaited<ReturnType<typeof interpretar>>) => {
  assert.equal(r.perguntar, null, 'não devia perguntar: ' + r.perguntar)
  assert.equal(r.acoes.length, 1, `uma ação (intencao=${r.intencao}, correcao=${r.correcao}, ações=${r.acoes.length})`)
  return r.acoes[0]
}

await caso('a internet agora é 109', (r) => {
  const a = um(r)
  assert.equal(a.tipo_acao, 'ajustar_fixa')
  assert.equal(a.fixa_id, 'fx-net')
  assert.equal(a.valor, 109)
})
await caso('o aluguel da sala agora vence dia 5', (r) => {
  const a = um(r)
  assert.equal(a.tipo_acao, 'ajustar_fixa')
  assert.equal(a.fixa_id, 'fx-alu')
  assert.equal(a.dia_do_mes, 5)
})
await caso('a internet desse mês vence dia 28', (r) => {
  const a = um(r)
  assert.equal(a.tipo_acao, 'ajustar_conta')
  assert.equal(a.conta_id, 'c-net-1')
  assert.equal(a.vencimento, '2026-11-28')
})
await caso('a energia veio 180 e não 150', (r) => {
  const a = um(r)
  assert.equal(a.tipo_acao, 'ajustar_conta')
  assert.equal(a.conta_id, 'c-luz')
  assert.equal(a.valor, 180)
})
await caso('cancelei a internet', (r) => {
  const a = um(r)
  assert.equal(a.tipo_acao, 'encerrar_fixa')
  assert.equal(a.fixa_id, 'fx-net')
})
await caso('paguei 109 de internet', (r) => {
  assert.ok(r.acoes.every((a) => !['ajustar_fixa', 'ajustar_conta', 'encerrar_fixa'].includes(a.tipo_acao)), 'pagar nunca é ajuste')
})
await caso('a Joana me paga 300 todo dia 5', (r) => {
  const a = um(r)
  assert.equal(a.tipo_acao, 'recorrente')
  assert.equal(a.movimento, 'entrada')
  assert.equal(a.dia_do_mes, 5)
})
// Duas contas Internet em aberto (20/11 e 20/12): sem data dita, a baixa é na mais antiga; citando a data, na que ela citou (caso do Arthur, 24/11).
await caso('paguei a internet', (r) => {
  const a = um(r)
  assert.equal(a.tipo_acao, 'baixar_conta')
  assert.equal(a.conta_id, 'c-net-1', 'sem data dita, a mais antiga')
}, UMA_CARTEIRA)
await caso('paguei a internet do dia 20/12', (r) => {
  const a = um(r)
  assert.equal(a.tipo_acao, 'baixar_conta')
  assert.equal(a.conta_id, 'c-net-2', 'a pessoa citou a data de dezembro')
  assert.equal(a.valor, null, 'o 20/12 é data, não valor')
}, UMA_CARTEIRA)

await caso('paguei 40 de gasolina no pix', (r) => {
  // Gasolina é gasto que pode ser da casa ou do negócio: ela pergunta (comportamento esperado) ou lança o valor 40.
  assert.ok(r.acoes.some((a) => a.tipo_acao === 'lancamento' && a.valor === 40) || /negócio ou da casa/.test(r.perguntar ?? ''))
})

// Leitura de comprovante com imagem de verdade (opcional)
for (const arq of process.argv.slice(2)) {
  try {
    const { leitura } = await lerDocumento(readFileSync(arq), arq.endsWith('.pdf') ? 'application/pdf' : 'image/png', '')
    const cruz = cruzarComprovante(leitura, ctx.carteiras as never, ['Maria Teste Souza'])
    console.log('  ok   ', arq, '->', JSON.stringify({ tipo: leitura.tipo, valor: leitura.transacoes[0]?.valor, mov: leitura.transacoes[0]?.movimento, o: [leitura.banco_origem, leitura.titular_origem], d: [leitura.banco_destino, leitura.titular_destino], cruz: cruz && cruz.tipo }))
  } catch (e) {
    falhas++
    console.log('  FALHA leitura', arq, '->', (e as Error).message.slice(0, 300))
  }
}

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
