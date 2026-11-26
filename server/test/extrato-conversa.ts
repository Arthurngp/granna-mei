/**
 * Extrato pelo WhatsApp conversando (extrato.ts). Caso de origem, 2026-11-25: o Arthur mandou o print do extrato perguntando "quais desses já
 * foram lançados?" e recebeu "Achei 6 lançamentos nesse extrato... quer que eu importe? Responda SIM ou NÃO". A pergunta foi ignorada.
 * Banco e IA falsos, processar() de verdade.
 *   npx tsx test/extrato-conversa.ts
 */
import assert from 'node:assert/strict'
import { caso, E, fim, lancsU1, msg, msgFoto, ia, NUM, U1 } from './_falsos.ts'

const X = await import('../src/extrato.ts')

const T = (descricao: string, valor: number, movimento: 'entrada' | 'saida', data = '2026-11-20') => ({ descricao, valor, movimento, data })
const EXTRATO = [T('Carla Mendes', 180, 'entrada'), T('Atacadão', 96.4, 'saida'), T('Pix Joana', 50, 'saida', '2026-11-21')]
const extrato = (ts = EXTRATO) => ({ tipo: 'extrato', meio: null, vencimento: null, resumo: 'Extrato', banco: 'Nubank', saldo: null, transacoes: ts })
let seq = 0
const anotado = (valor: number, tipo: 'entrada' | 'saida', data = '2026-11-20') =>
  E.tabelas.lancamentos.push({ id: `ja-${++seq}`, user_id: U1, tipo, valor, data, descricao: 'já anotado', carteira_id: 'nubank', categoria_id: null, pessoal: false, origem: 'texto', criado_em: new Date().toISOString() })
const pendente = () => (E.tabelas.conversas ?? []).find((c) => c.telefone === NUM)?.pendente as Record<string, any> | null | undefined
const SEM_ENFEITE = /[—–]|\p{Extended_Pictographic}|\*\*|^\s*[-•]/mu

await caso('pura: conferência um a um (dois iguais no mesmo dia, um anotado: falta um)', async () => {
  const ts = [T('Pix', 10, 'saida'), T('Pix', 10, 'saida'), T('Venda', 30, 'entrada')]
  const r = X.cruzar(ts, [{ data: '2026-11-20', valor: '10.00', tipo: 'saida' }], '2026-11-25')
  assert.equal(r.anotadas.length, 1)
  assert.deepEqual(r.faltam.map((t) => t.valor), [10, 30])
})

await caso('pura: o que é pergunta sobre o anotado, e o que é sim e não curtos', async () => {
  for (const t of ['quais desses já foram lançados?', 'algum já tá anotado?', 'tem algum faltando?', 'confere pra mim', 'já foram todos?']) assert.ok(X.perguntaSobreAnotados(t), t)
  for (const t of ['sim', 'pode', 'anota', 'pode anotar', 'bora', 'manda ver', 'anota aí', 'quero', 'ok']) assert.ok(X.simParaAnotar(t), t)
  for (const t of ['anota 50 de gás', 'sim mas o de 50 foi pessoal e o resto do negócio', 'quais desses já foram lançados?']) assert.ok(!X.simParaAnotar(t), t)
  for (const t of ['não', 'deixa', 'agora não', 'não precisa', 'esquece']) assert.ok(X.naoParaAnotar(t), t)
})

await caso('print com a pergunta na legenda: responde o que já tem e o que falta, e oferece anotar só o que falta', async () => {
  anotado(180, 'entrada')
  anotado(96.4, 'saida')
  ia.documento = extrato()
  const r = await msgFoto('extrato.jpg', 'quais desses já foram lançados?')
  assert.match(r.resposta, /Conferi o extrato do Nubank: 3 movimentos, e 2 já tão anotados aqui:\n20\/11, entrou R\$ 180,00 \(Carla Mendes\)\n20\/11, saiu R\$ 96,40 \(Atacadão\)/, r.resposta)
  assert.match(r.resposta, /Falta 1:\n21\/11, saiu R\$ 50,00 \(Pix Joana\)/)
  assert.match(r.resposta, /Quer que eu anote esse\?$/)
  assert.doesNotMatch(r.resposta, /Responda|SIM ou NÃO|lançamento/i)
  assert.doesNotMatch(r.resposta, SEM_ENFEITE)
  const antes = lancsU1().length
  const s = await msg('pode anotar')
  assert.match(s, /Pronto, anotei o que faltava \(os outros 2 já estavam aqui\)/, s)
  assert.equal(lancsU1().length, antes + 1, 'anotou a mais ou a menos do que disse')
  assert.equal(Number(lancsU1().at(-1)!.valor), 50)
})

await caso('sem pergunta na legenda: diz quantos já tem, sem listar, e lista o que falta', async () => {
  anotado(180, 'entrada')
  ia.documento = extrato()
  const r = await msgFoto('extrato.jpg')
  assert.match(r.resposta, /3 movimentos, e 1 já tá anotado aqui\.\n\nFaltam 2:\n20\/11, saiu R\$ 96,40 \(Atacadão\)\n21\/11, saiu R\$ 50,00 \(Pix Joana\)\n\nQuer que eu anote esses 2\?$/, r.resposta)
})

await caso('a pergunta chega DEPOIS (passou a espera): responde e a pergunta de anotar continua valendo', async () => {
  anotado(180, 'entrada')
  ia.documento = extrato()
  await msgFoto('extrato.jpg')
  const q = await msg('quais desses já foram lançados?')
  assert.match(q, /1 já tá anotado aqui:\n20\/11, entrou R\$ 180,00 \(Carla Mendes\)/, q)
  assert.equal(pendente()?.tipo, 'importar', 'a pergunta de anotar sumiu')
  assert.doesNotMatch(q, /ficou esse aqui esperando/)
  const antes = lancsU1().length
  const s = await msg('sim')
  assert.match(s, /anotei os 2 que faltavam/)
  assert.equal(lancsU1().length, antes + 2)
})

await caso('tudo já anotado: diz isso e não deixa pergunta em aberto', async () => {
  anotado(180, 'entrada')
  anotado(96.4, 'saida')
  anotado(50, 'saida', '2026-11-21')
  ia.documento = extrato()
  const r = await msgFoto('extrato.jpg')
  assert.match(r.resposta, /os 3 movimentos já tão anotados aqui, não falta nada/)
  assert.ok(!pendente()?.tipo, 'ficou pergunta em aberto')
})

await caso('com o extrato esperando, "anota 50 de gás" NÃO anota o extrato', async () => {
  ia.documento = extrato()
  await msgFoto('extrato.jpg')
  const antes = lancsU1().length
  await msg('anota 50 de gás')
  assert.ok(lancsU1().length <= antes + 1, 'importou o extrato junto com o gás')
  assert.ok(!lancsU1().some((l) => Number(l.valor) === 96.4), 'o extrato foi anotado sem a pessoa pedir')
})

await caso('"deixa" recusa sem anotar nada', async () => {
  ia.documento = extrato()
  await msgFoto('extrato.jpg')
  const r = await msg('deixa')
  assert.match(r, /Não anotei nada desse extrato/)
  assert.equal(lancsU1().length, 0)
})

fim()
