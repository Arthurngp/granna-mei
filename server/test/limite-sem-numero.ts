/**
 * O cliente não vê quantos lançamentos tem por mês (decisão do Arthur, 2026-11-21): nem na tela, nem no WhatsApp.
 * Aqui o limite é atingido de verdade, no fluxo completo, e a resposta não pode trazer o número do limite.
 * Os limites do teste são pequenos e diferentes de 300 e 100, para um número que vazasse não passar por coincidência.
 * Sem banco e sem IA reais. Rodar: npx tsx test/limite-sem-numero.ts
 */
import assert from 'node:assert/strict'

// Antes de importar o fluxo: os limites são lidos quando o módulo carrega.
process.env.LIMITE_LANCAMENTOS = '10'
process.env.LIMITE_MIDIAS = '3'
const { acao, acoes, caso, E, fim, ia, msg, msgAudio, U1 } = await import('./_falsos.ts')

/** "No dia 1 o contador zera" tem um 1 legítimo (o dia em que o uso zera). Fora isso, nenhum número pode aparecer. */
const semDia1 = (txt: string) => txt.replace(/dia 1\b/, 'dia')

/** Mensagens do mês que já viraram lançamento (é isso que conta no limite). */
function semearUso(lancamentos: number, midias = 0) {
  const agora = new Date().toISOString()
  E.tabelas.mensagens ??= []
  for (let i = 0; i < lancamentos; i++) E.tabelas.mensagens.push({ id: `uso-${i}`, user_id: U1, telefone: '5581988887777', texto: `t${i}`, resposta: 'r', status: 'ok', tipo: 'texto', criado_em: agora })
  for (let i = 0; i < midias; i++) E.tabelas.mensagens.push({ id: `mid-${i}`, user_id: U1, telefone: '5581988887777', texto: `m${i}`, resposta: 'r', status: 'ignorada', tipo: 'audio', criado_em: agora })
}

const LUZ = acoes(acao({ valor: 89, descricao: 'Luz' }))

await caso('estourou o limite de lançamentos: avisa, não anota, e a resposta não tem número nenhum', async () => {
  semearUso(10)
  ia.regras = [[/luz/, LUZ]]
  const r = await msg('paguei 89 de luz')
  assert.match(r, /limite de uso deste mês/, 'diz que chegou ao limite')
  assert.doesNotMatch(semDia1(r), /\d/, `nem o limite nem o uso aparecem: ${r}`)
  assert.equal(E.tabelas.lancamentos.filter((l) => l.user_id === U1 && l.descricao === 'Luz').length, 0, 'e não anotou')
})

await caso('estourou o limite de mídias: o áudio é recusado sem número, o texto continua', async () => {
  semearUso(0, 3)
  const r = (await msgAudio()).resposta
  assert.match(r, /limite de áudios, fotos e PDFs/)
  assert.doesNotMatch(semDia1(r), /\d/, `a resposta não traz o número: ${r}`)
  ia.regras = [[/luz/, LUZ]]
  assert.match(await msg('paguei 89 de luz'), /89/, 'texto segue funcionando')
})

await caso('perto do limite: o aviso sai uma vez, sem dizer quantos lançamentos nem qual é o limite', async () => {
  semearUso(7) // o próximo é o 8º, 80% de 10
  ia.regras = [[/luz/, LUZ]]
  const r = await msg('paguei 89 de luz')
  assert.match(r, /89/, 'anotou normalmente')
  const aviso = r.split('Aviso:')[1]
  assert.ok(aviso, `traz o aviso: ${r}`)
  assert.match(aviso, /perto do limite/)
  assert.doesNotMatch(aviso, /\d/, `o aviso não tem número: ${aviso}`)
})

await caso('longe do limite: nenhum aviso', async () => {
  semearUso(2)
  ia.regras = [[/luz/, LUZ]]
  const r = await msg('paguei 89 de luz')
  assert.doesNotMatch(r, /limite/i)
})

fim()
