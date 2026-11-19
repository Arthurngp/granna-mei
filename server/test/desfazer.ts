/**
 * Fase "Conversa sem falha": DESFAZER desfaz a coisa certa.
 *
 * O defeito: `ultimaComEfeito` pegava a última mensagem com status 'ok', mesmo que ela não tivesse
 * gravado nada. Então "paguei 89 de luz" → "quanto sobrou?" → "desfazer" respondia
 * «desfiz: "quanto sobrou?"» e os R$ 89 continuavam lançados.
 *   npx tsx test/desfazer.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, NUM, saldoNoBanco, SEM_ACAO } from './_falsos.ts'
// Import dinâmico de propósito: estaticamente, o módulo carregaria antes de o _falsos definir o
// endereço do banco falso, e o banco.ts morreria em "Variável SUPABASE_URL não definida".
const { temEfeito } = await import('../src/executar.ts')

const LUZ = acoes(acao({ valor: 89, descricao: 'Luz' }))
const PAO = acoes(acao({ valor: 12, descricao: 'Pão' }))
const DESFAZER = { intencao: 'desfazer', acoes: [], pergunta: null, correcao: null, falta: null }
const PERGUNTA = { intencao: 'pergunta', acoes: [], pergunta: 'quanto sobrou?', correcao: null, falta: null }
const pendenteDe = () => (E.tabelas.conversas ?? []).find((c) => c.telefone === NUM)?.pendente as { tipo?: string } | undefined

await caso('pergunta no meio não rouba o DESFAZER (o caso que o Arthur viveu)', async () => {
  ia.regras = [[/luz/, LUZ], [/sobrou/, PERGUNTA], [/desfazer/, DESFAZER]]
  await msg('paguei 89 de luz')
  assert.equal(lancsU1().length, 1)
  await msg('quanto sobrou esse mês?')
  const r = await msg('desfazer')
  assert.match(r, /desfiz: "paguei 89 de luz"/, 'desfaz o lançamento, não a pergunta')
  assert.equal(lancsU1().length, 0, 'os R$ 89 saem de verdade')
  assert.equal(saldoNoBanco('nubank'), 1000, 'e o saldo volta ao que era')
})

await caso('"oi" no meio também não rouba o DESFAZER', async () => {
  ia.regras = [[/luz/, LUZ], [/oi/, { ...SEM_ACAO, intencao: 'saudacao' }], [/desfazer/, DESFAZER]]
  await msg('paguei 89 de luz')
  await msg('oi')
  const r = await msg('desfazer')
  assert.match(r, /desfiz: "paguei 89 de luz"/)
  assert.equal(lancsU1().length, 0)
})

await caso('dois DESFAZER seguidos: o segundo pergunta em vez de apagar outro lançamento', async () => {
  ia.regras = [[/luz/, LUZ], [/pão/, PAO], [/desfazer/, DESFAZER]]
  await msg('paguei 12 de pão')
  await msg('paguei 89 de luz')
  assert.equal(lancsU1().length, 2)
  const um = await msg('desfazer')
  assert.match(um, /desfiz: "paguei 89 de luz"/)
  assert.equal(lancsU1().length, 1)

  const dois = await msg('desfazer')
  assert.match(dois, /já tinha desfeito/, 'avisa que já desfez')
  assert.match(dois, /paguei 12 de pão/, 'e mostra qual seria o próximo')
  assert.equal(lancsU1().length, 1, 'não apaga o pão sem pedir')
  assert.equal(pendenteDe()?.tipo, 'desfazer_mais')
})

await caso('respondendo 2 ao segundo DESFAZER, nada mais é desfeito', async () => {
  ia.regras = [[/luz/, LUZ], [/pão/, PAO], [/desfazer/, DESFAZER]]
  await msg('paguei 12 de pão')
  await msg('paguei 89 de luz')
  await msg('desfazer')
  await msg('desfazer')
  const r = await msg('2')
  assert.match(r, /parei aí/)
  assert.equal(lancsU1().length, 1, 'o pão fica')
})

await caso('respondendo 1 ao segundo DESFAZER, o anterior sai', async () => {
  ia.regras = [[/luz/, LUZ], [/pão/, PAO], [/desfazer/, DESFAZER]]
  await msg('paguei 12 de pão')
  await msg('paguei 89 de luz')
  await msg('desfazer')
  await msg('desfazer')
  const r = await msg('1')
  assert.match(r, /desfiz também: "paguei 12 de pão"/)
  assert.equal(lancsU1().length, 0)
  assert.equal(saldoNoBanco('nubank'), 1000)
})

await caso('lançamento novo no meio faz a pergunta caducar, e o "1" não apaga nada', async () => {
  ia.regras = [[/luz/, LUZ], [/pão/, PAO], [/desfazer/, DESFAZER]]
  await msg('paguei 12 de pão')
  await msg('paguei 89 de luz')
  await msg('desfazer')
  await msg('desfazer') // deixa a pergunta em aberto
  await msg('paguei 89 de luz') // mas aí ela lança outra coisa, e a pergunta é deixada de lado
  assert.equal(lancsU1().length, 2)
  await msg('1')
  assert.equal(lancsU1().length, 2, 'o "1" solto não desfaz o pão nem a luz nova')
  assert.equal(pendenteDe()?.tipo, undefined, 'a pergunta não fica para sempre')
})

await caso('sem nada gravado, DESFAZER não inventa', async () => {
  ia.regras = [[/sobrou/, PERGUNTA], [/desfazer/, DESFAZER]]
  await msg('quanto sobrou?')
  const r = await msg('desfazer')
  assert.match(r, /Não achei nada recente para desfazer/)
})

await caso('temEfeito: só conta quem gravou algo', async () => {
  assert.equal(temEfeito(null), false)
  assert.equal(temEfeito({}), false)
  assert.equal(temEfeito({ lancamentos: [], contas: [], fixas: [] }), false, 'listas montadas e vazias não contam')
  assert.equal(temEfeito({ lancamentos: ['l1'] }), true)
  assert.equal(temEfeito({ lancamentos: [], categorias: ['c1'] }), true, 'categoria nova também é efeito')
})

fim()
