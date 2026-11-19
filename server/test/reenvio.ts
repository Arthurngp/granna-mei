/**
 * Fase "Conversa sem falha": o mesmo áudio ou a mesma foto mandados de novo não viram lançamento em
 * dobro. Áudio e foto demoram alguns segundos; a pessoa acha que travou e reenvia.
 *
 * processar() real, com banco, IA e gateway falsos em memória.
 *   npx tsx test/reenvio.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, msgAudio, msgFoto, NUM } from './_falsos.ts'
import { pareceReenvio, perguntaReenvio } from '../src/duplicata.ts'
import type { Acao, Contexto } from '../src/interpretar.ts'

const GASOLINA = acoes(acao({ valor: 50, descricao: 'Gasolina' }))
const pendenteDe = (tel = NUM) => (E.tabelas.conversas ?? []).find((c) => c.telefone === tel)?.pendente as { tipo?: string } | undefined

/* ---------------- áudio ---------------- */

await caso('mesmo áudio mandado duas vezes: pergunta antes de anotar de novo', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  const um = await msgAudio()
  assert.match(um.resposta, /R\$ 50,00/, 'o primeiro áudio é anotado normalmente')
  assert.equal(lancsU1().length, 1)

  const dois = await msgAudio()
  assert.match(dois.resposta, /Já anotei/, 'o segundo pergunta em vez de anotar')
  assert.match(dois.resposta, /É o mesmo\?/)
  assert.equal(lancsU1().length, 1, 'e NADA é gravado antes da resposta')
  assert.equal(pendenteDe()?.tipo, 'reenvio')
})

await caso('respondendo 1 (é o mesmo), nada é anotado de novo', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  await msgAudio()
  await msgAudio()
  const r = await msg('1')
  assert.match(r, /deixei só o de antes/)
  assert.equal(lancsU1().length, 1, 'continua um lançamento só')
})

await caso('respondendo 2 (é outro), o segundo é anotado', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  await msgAudio()
  await msgAudio()
  const r = await msg('2')
  assert.match(r, /R\$ 50,00/)
  assert.equal(lancsU1().length, 2, 'duas despesas de verdade de R$ 50')
})

await caso('áudio de valor diferente nunca é tratado como reenvio', async () => {
  ia.regras = [[/gasolina/, GASOLINA], [[/pão/][0], acoes(acao({ valor: 12, descricao: 'Pão' }))]]
  await msgAudio()
  ia.transcricao = 'paguei 12 de pão'
  const dois = await msgAudio('a2.ogg')
  assert.doesNotMatch(dois.resposta, /Já anotei/)
  assert.equal(lancsU1().length, 2)
})

/* ---------------- foto de comprovante ---------------- */

await caso('mesma foto de comprovante duas vezes: pergunta', async () => {
  // O comprovante vira texto ("Gasolina R$ 50...") antes de ir para a interpretação.
  ia.regras = [[/Gasolina/i, GASOLINA]]
  const foto = await msgFoto()
  assert.match(foto.resposta, /R\$ 50,00/)
  assert.equal(lancsU1().length, 1)
  const dois = await msgFoto('f2.jpg')
  assert.match(dois.resposta, /Já anotei/, 'o comprovante repetido não entra calado')
  assert.equal(lancsU1().length, 1, 'nada é gravado antes da resposta')
  assert.equal(pendenteDe()?.tipo, 'reenvio')
})

await caso('foto depois de texto do mesmo valor NÃO é reenvio (são coisas diferentes)', async () => {
  ia.regras = [[/gasolina/i, GASOLINA]]
  await msg('paguei 50 de gasolina')
  const foto = await msgFoto()
  assert.doesNotMatch(foto.resposta, /Já anotei/, 'texto e foto são origens diferentes: pode ser o comprovante de outra coisa')
  assert.equal(lancsU1().length, 2)
})

await caso('a pergunta de reenvio não atropela a trava de correção em texto', async () => {
  ia.regras = [[/gasolina/, GASOLINA], [/na verdade/, GASOLINA]]
  await msg('paguei 50 de gasolina')
  const r = await msg('na verdade foi de gasolina')
  assert.match(r, /Esse novo é o mesmo\?/, 'em texto continua a pergunta de correção, com 1 corrigir / 2 outro')
  assert.equal(pendenteDe()?.tipo, 'duplicata')
})

/* ---------------- decisão isolada ---------------- */

await caso('pareceReenvio: só mídia com mídia, mesmo valor e mesmo sentido', async () => {
  const antigos = [{ id: 'l1', tipo: 'saida', valor: 50, categoria_id: 'material', carteira_id: 'nubank', pessoal: false, descricao: 'Gasolina' }]
  const novas = [acao({ valor: 50, movimento: 'saida' })] as unknown as Acao[]
  assert.ok(pareceReenvio('audio', 'audio', antigos, novas), 'áudio depois de áudio')
  assert.ok(pareceReenvio('foto', 'pdf', antigos, novas), 'foto depois de PDF (a pessoa reenviou de outro jeito)')
  assert.equal(pareceReenvio('texto', 'audio', antigos, novas), null, 'texto não entra')
  assert.equal(pareceReenvio('audio', 'texto', antigos, novas), null, 'o anterior tem que ser mídia')
  assert.equal(pareceReenvio('audio', 'audio', antigos, [acao({ valor: 51 })] as unknown as Acao[]), null, 'valor diferente')
  assert.equal(pareceReenvio('audio', 'audio', antigos, [acao({ valor: 50, movimento: 'entrada' })] as unknown as Acao[]), null, 'sentido diferente')
})

await caso('a pergunta diz há quanto tempo foi, sem inventar minuto', async () => {
  const ctx = { categorias: [{ id: 'material', nome: 'Material' }], carteiras: [{ id: 'nubank', nome: 'Nubank' }] } as unknown as Contexto
  const a = { id: 'l1', tipo: 'saida', valor: 50, categoria_id: 'material', carteira_id: 'nubank', pessoal: false, descricao: 'Gasolina' }
  assert.match(perguntaReenvio(a, ctx, 0), /agora mesmo/)
  assert.match(perguntaReenvio(a, ctx, 1), /há 1 minuto\b/)
  assert.match(perguntaReenvio(a, ctx, 7), /há 7 minutos/)
})

fim()
