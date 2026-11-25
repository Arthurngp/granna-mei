/**
 * Fila de perguntas em aberto (itens at-04 e at-05 do backlog).
 *
 * Casos de origem, de produção:
 * - 16/11: 5 comprovantes de gás em 30 segundos. Cada um que perguntava "do negócio ou pessoal?" apagava a pergunta anterior: 2 se perderam.
 * - 16/11: com "Qual foi o valor?" em aberto, a pessoa respondeu "2" achando que escolhia a opção de outra pergunta, e virou uma saída de R$ 2,00.
 * - 20/11: 5 áudios seguidos, 5 perguntas, o primeiro (R$ 281 de mercadinho) se perdeu.
 * Com o onboarding pelo WhatsApp, que pede prints e extratos, a rajada vira o caso comum.
 *
 * Banco e IA falsos, processar() de verdade.
 *   npx tsx test/fila-perguntas.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, msgFoto, NUM, SEM_ACAO } from './_falsos.ts'

const F = await import('../src/fila.ts')

const pendente = () => (E.tabelas.conversas ?? []).find((c) => c.telefone === NUM)?.pendente as (Record<string, any> & { fila?: Record<string, any>[] }) | null | undefined
const valores = () => lancsU1().map((l) => Number(l.valor)).sort((a, b) => a - b)
const gas = (valor: number) => ({ tipo: 'comprovante', meio: 'boleto', vencimento: null, resumo: `Boleto de gás de ${valor}`, transacoes: [{ descricao: 'Bahiana Distribuidora de Gas', valor, movimento: 'saida', data: null }] })
/** A IA entende o comprovante como gás, sem dizer se é da casa ou do negócio: o código pergunta. Conta dita, para não perguntar "pagou como?". */
const GAS_TALVEZ = acoes(acao({ valor: null, descricao: 'Gás', categoria_id: null, meio: 'boleto', carteira_id: 'nubank', talvez_pessoal: true }))
const PERGUNTA_GAS = /Gás de R\$ [\d,]+: é gasto do negócio ou da casa\?/
const envelhecer = (min: number) => {
  const c = E.tabelas.conversas.find((x) => x.telefone === NUM)! as Record<string, any>
  const antes = new Date(Date.now() - min * 60_000).toISOString()
  c.atualizado_em = antes
  if (c.pendente) {
    c.pendente.em = antes
    for (const x of c.pendente.fila ?? []) x.em = antes
  }
}

/* ===================== o que a fila faz, funções puras ===================== */

await caso('pura: pergunta nova empurra a anterior não respondida para a fila; resposta que continua a mesma conversa não duplica', async () => {
  const agora = Date.now()
  const velha = { tipo: 'pergunta', texto: 'gás 50', pergunta: 'Do negócio?', em: new Date(agora - 60_000).toISOString() }
  const nova = { tipo: 'pergunta', texto: 'gás 25', pergunta: 'Do negócio? (2)' }
  const p = F.comNova(nova, velha, false, agora)
  assert.equal(p.pergunta, 'Do negócio? (2)')
  assert.deepEqual(p.fila.map((x) => x.texto), ['gás 50'])
  // A mensagem respondeu a velha e gerou uma pergunta de continuação: a velha não volta para a fila.
  assert.deepEqual(F.comNova(nova, velha, true, agora).fila, [])
  // A fila da anterior vem junto, sem as vencidas; nunca passa de MAX_FILA.
  const cheia = { ...velha, fila: Array.from({ length: 9 }, (_, i) => ({ tipo: 'pergunta', texto: `x${i}`, pergunta: 'p', em: velha.em })) }
  assert.equal(F.comNova(nova, cheia, false, agora).fila.length, F.MAX_FILA)
  const vencida = { ...velha, em: new Date(agora - F.PRAZO_MS - 1).toISOString() }
  assert.deepEqual(F.comNova(nova, vencida, false, agora).fila, [], 'pergunta vencida não entra na fila')
  // Pergunta que não segura registro ("é o mesmo?", "já pagou?") não entra na fila.
  for (const tipo of ['duplicata', 'reenvio', 'desfazer_mais', 'baixa_conta']) assert.deepEqual(F.comNova(nova, { ...velha, tipo }, false, agora).fila, [], tipo)
})

await caso('pura: depois da resposta, a próxima da fila volta; ignorada, volta UMA vez e depois sai avisando; vencida há mais de 1 dia sai calada', async () => {
  const agora = Date.now()
  const em = new Date(agora - 60_000).toISOString()
  const a = { tipo: 'pergunta', texto: 'paguei 50 de gás', pergunta: 'Q-A', em }
  const b = { tipo: 'pergunta', texto: 'paguei 25 de gás', pergunta: 'Q-B', em }
  let d = F.depois({ ...a, fila: [b] }, true, agora)
  assert.equal(d.pendente?.pergunta, 'Q-B')
  assert.match(d.texto, /^E ficou esse aqui esperando:\nQ-B$/)
  d = F.depois({ ...a, fila: [] }, false, agora)
  assert.equal(d.pendente?.pergunta, 'Q-A')
  assert.equal(d.pendente?.voltas, 1)
  d = F.depois({ ...a, voltas: 1, fila: [] }, false, agora)
  assert.equal(d.pendente, null)
  assert.match(d.texto, /^Ficou sem anotar, porque a pergunta ficou sem resposta: "paguei 50 de gás"\. Se quiser, me manda de novo\.$/)
  const velhissima = { ...a, em: new Date(agora - 3 * 24 * 3600_000).toISOString() }
  d = F.depois({ ...velhissima, fila: [] }, false, agora)
  assert.deepEqual(d, { pendente: null, texto: '' }, 'pergunta de 3 dias atrás sai sem barulho')
  // Pendente gravado antes desta mudança (sem `em`): o prazo conta do atualizado_em.
  d = F.depois({ tipo: 'pergunta', texto: 't', pergunta: 'Q' }, false, agora, new Date(agora - F.PRAZO_MS - 1).toISOString())
  assert.equal(d.pendente, null)
  assert.equal(F.resumoDe({ tipo: 'importar', transacoes: [1, 2, 3] }), 'o extrato com 3 lançamentos')
  assert.equal(F.resumoDe({ tipo: 'pergunta', texto: 'paguei 50 de gás (comprovante)\n(resposta para "x"): 1' }), '"paguei 50 de gás"')
  for (const t of [d.texto, F.depois({ ...a, voltas: 1 }, false, agora).texto]) assert.doesNotMatch(t, /[—–]|\p{Extended_Pictographic}/u)
})

await caso('pura: "2" sozinho só é duvidoso como resposta a uma pergunta de VALOR', async () => {
  assert.equal(F.valorSoltoDuvidoso('2', 'Qual foi o valor?'), 2)
  assert.equal(F.valorSoltoDuvidoso(' 7 ', 'Qual foi o valor de "Luz"?'), 7)
  assert.equal(F.valorSoltoDuvidoso('2', 'Que dia do mês vence "Internet"?'), null)
  assert.equal(F.valorSoltoDuvidoso('12', 'Qual foi o valor?'), null, '12 é um valor plausível')
  assert.equal(F.valorSoltoDuvidoso('R$ 2', 'Qual foi o valor?'), null, 'com R$ é valor dito')
  assert.equal(F.valorSoltoDuvidoso('0', 'Qual foi o valor?'), null)
})

/* ===================== o fluxo de verdade ===================== */

await caso('rajada de 3 comprovantes (caso de 16/11): nenhuma pergunta se perde, e as três voltam em ordem até fechar', async () => {
  ia.regras = [[/Bahiana|Gás|gas/i, GAS_TALVEZ]]
  ia.documento = gas(50.23)
  const r1 = await msgFoto('f1.jpg')
  assert.match(r1.resposta, PERGUNTA_GAS)
  ia.documento = gas(25.01)
  const r2 = await msgFoto('f2.jpg')
  assert.match(r2.resposta, PERGUNTA_GAS, 'a foto nova é outro registro, não a resposta da pergunta anterior')
  ia.documento = gas(65.59)
  const r3 = await msgFoto('f3.jpg')
  assert.match(r3.resposta, PERGUNTA_GAS)
  assert.equal(lancsU1().length, 0, 'nada gravado antes de responder')
  assert.equal(pendente()?.fila?.length, 2, 'as duas anteriores estão guardadas')

  // Responde a pergunta que acabou de ver (a do 65,59): grava, e a próxima guardada volta junto.
  const a1 = await msg('1')
  assert.match(a1, /R\$ 65,59/)
  assert.match(a1, /E ficou esse aqui esperando:\nGás de R\$ [\d,]+: é gasto do negócio ou da casa\?/)
  const a2 = await msg('2')
  assert.match(a2, /R\$ 25,01/)
  assert.match(a2, /E ficou esse aqui esperando:/)
  const a3 = await msg('1')
  assert.match(a3, /R\$ 50,23/)
  assert.doesNotMatch(a3, /esperando/)
  assert.deepEqual(valores(), [25.01, 50.23, 65.59], 'os três comprovantes gravados, cada um com o seu valor')
  assert.ok(!pendente()?.tipo, 'nada sobrou em aberto')
  // Cada resposta foi para o comprovante certo: o 25,01 foi o "2" (pessoal), os outros "1" (negócio).
  const pessoais = lancsU1().filter((l) => l.pessoal).map((l) => Number(l.valor))
  assert.deepEqual(pessoais, [25.01])
})

await caso('"2" como resposta a "Qual foi o valor?" (caso de 16/11): confirma antes, nada vira R$ 2,00 às cegas', async () => {
  ia.regras = [
    [/resposta para .*\): R\$ 2/, acoes(acao({ valor: 2, descricao: 'Paguei agora', carteira_id: 'nubank', categoria_id: null }))],
    [/Paguei agora/, acoes(acao({ valor: null, descricao: 'Paguei agora', carteira_id: 'nubank', categoria_id: null }))],
  ]
  const p = await msg('Paguei agora')
  assert.match(p, /Qual foi o valor/)
  const d = await msg('2')
  assert.match(d, /^Só R\$ 2,00\? Pra eu não anotar errado, me manda o valor com o R\$, tipo "R\$ 2", ou o valor certo\.$/)
  assert.equal(lancsU1().length, 0, 'gravou R$ 2,00 sem confirmar')
  assert.match(String(pendente()?.pergunta), /Qual foi o valor/, 'a pergunta continua a mesma')
  const ok = await msg('R$ 2')
  assert.match(ok, /R\$ 2,00/)
  assert.deepEqual(valores(), [2])
})

await caso('a sequência real de 16/11: pergunta de opções, mensagem nova que pede o valor, "2": nada se perde nem vira R$ 2,00', async () => {
  ia.regras = [
    [/Paguei agora/, acoes(acao({ valor: null, descricao: 'Paguei agora', carteira_id: 'nubank', categoria_id: null }))],
    [/Bahiana|Gás|gas/i, GAS_TALVEZ],
  ]
  ia.documento = gas(50.23)
  await msgFoto('f1.jpg')
  const p = await msg('Paguei agora')
  assert.match(p, /Qual foi o valor/)
  assert.equal(pendente()?.fila?.length, 1, 'a pergunta do gás foi guardada, não apagada')
  const d = await msg('2')
  assert.match(d, /^Só R\$ 2,00\?/)
  assert.equal(lancsU1().length, 0)
  // Pergunta sem opções aceita texto livre: "paguei 12 de padaria" fecha o "paguei agora" com 12. Fechada ela, a do gás, que estava guardada, volta.
  ia.regras.unshift([/padaria/, acoes(acao({ valor: 12, descricao: 'Padaria', carteira_id: 'nubank' }))])
  const x = await msg('paguei 12 de padaria no nubank')
  assert.match(x, /R\$ 12,00/)
  assert.match(x, /E ficou esse aqui esperando:\nGás de R\$ 50,23: é gasto do negócio ou da casa\?/)
  assert.equal(pendente()?.fila?.length, 0)
  const g = await msg('1')
  assert.match(g, /R\$ 50,23/)
  assert.deepEqual(valores(), [12, 50.23], 'nenhum R$ 2,00 e o gás não se perdeu')
})

await caso('comprovante chega com "Qual foi o valor?" em aberto: é outro registro (gravado com o valor dele), e a pergunta volta', async () => {
  ia.regras = [
    [/Paguei agora/, acoes(acao({ valor: null, descricao: 'Paguei agora', carteira_id: 'nubank', categoria_id: null }))],
    [/Bahiana|Gás|gas/i, acoes(acao({ valor: null, descricao: 'Gás', categoria_id: null, meio: 'boleto', carteira_id: 'nubank' }))],
  ]
  const p = await msg('Paguei agora')
  assert.match(p, /Qual foi o valor/)
  ia.documento = gas(50.23)
  const f = await msgFoto('f1.jpg')
  assert.match(f.resposta, /R\$ 50,23/)
  assert.match(f.resposta, /E ficou esse aqui esperando:\nQual foi o valor de "Paguei agora"\?/, 'o comprovante virou resposta da pergunta anterior: ' + f.resposta)
  assert.deepEqual(valores(), [50.23])
})

await caso('mensagem que ignora a pergunta: o registro novo é gravado, a pergunta volta UMA vez, e ignorada de novo sai avisando', async () => {
  ia.regras = [
    [/Bahiana|Gás|gas/i, GAS_TALVEZ],
    [/padaria/, acoes(acao({ valor: 12, descricao: 'Padaria', carteira_id: 'nubank' }))],
    [/feira/, acoes(acao({ valor: 30, descricao: 'Feira', carteira_id: 'nubank' }))],
  ]
  ia.documento = gas(50.23)
  await msgFoto('f1.jpg')
  const r1 = await msg('paguei 12 de padaria no nubank')
  assert.match(r1, /R\$ 12,00[\s\S]*E ficou esse aqui esperando:\nGás de R\$ [\d,]+: é gasto do negócio ou da casa\?/)
  const r2 = await msg('paguei 30 de feira no nubank')
  assert.match(r2, /R\$ 30,00/)
  assert.match(r2, /Ficou sem anotar, porque a pergunta ficou sem resposta: "paguei 50,23 de Bahiana Distribuidora de Gas/)
  assert.ok(!pendente()?.tipo)
  const r3 = await msg('paguei 12 de padaria no nubank')
  assert.doesNotMatch(r3, /Ficou sem anotar|esperando/, 'avisa uma vez só')
  assert.ok(!valores().includes(50.23), 'o gás ignorado não foi gravado às cegas')
})

await caso('pergunta que passou do prazo (30 min): sai na próxima mensagem, dizendo o que ficou sem anotar; nunca some calada', async () => {
  ia.regras = [[/Bahiana|Gás|gas/i, GAS_TALVEZ], [/padaria/, acoes(acao({ valor: 12, descricao: 'Padaria', carteira_id: 'nubank' }))]]
  ia.documento = gas(50.23)
  await msgFoto('f1.jpg')
  ia.documento = gas(25.01)
  await msgFoto('f2.jpg')
  envelhecer(40)
  const r = await msg('paguei 12 de padaria no nubank')
  assert.match(r, /R\$ 12,00/)
  assert.match(r, /Ficou sem anotar, porque a pergunta ficou sem resposta: "paguei 25,01 de Bahiana[^"]*", "paguei 50,23 de Bahiana/)
  assert.doesNotMatch(r, /esperando/)
  assert.ok(!pendente()?.tipo)
  // "1" agora não responde mais nada vencido: não grava gás nenhum.
  ia.regras.push([/^1$/, SEM_ACAO])
  await msg('1')
  assert.deepEqual(valores(), [12])
})

await caso('pedir ajuda no meio não gasta a pergunta nem a fila', async () => {
  ia.regras = [[/Bahiana|Gás|gas/i, GAS_TALVEZ]]
  ia.documento = gas(50.23)
  await msgFoto('f1.jpg')
  ia.documento = gas(25.01)
  await msgFoto('f2.jpg')
  const h = await msg('ajuda')
  assert.doesNotMatch(h, /esperando|Ficou sem anotar/)
  assert.equal(pendente()?.fila?.length, 1)
  const a = await msg('1')
  assert.match(a, /R\$ 25,01[\s\S]*E ficou esse aqui esperando/)
})

await caso('IA fora no meio da rajada: a pergunta e a fila ficam intactas para quando ela voltar', async () => {
  ia.regras = [[/Bahiana|Gás|gas/i, GAS_TALVEZ]]
  ia.documento = gas(50.23)
  await msgFoto('f1.jpg')
  ia.documento = gas(25.01)
  await msgFoto('f2.jpg')
  const antes = JSON.stringify(pendente())
  ia.queda = true
  await msg('1')
  ia.queda = false
  assert.equal(JSON.stringify(pendente()), antes, 'a falha mexeu na pergunta ou na fila')
  const a = await msg('1')
  assert.match(a, /R\$ 25,01[\s\S]*E ficou esse aqui esperando/)
})

await caso('extrato chega com uma pergunta em aberto: a pergunta vai para a fila, o extrato é importado no SIM, e a pergunta volta', async () => {
  ia.regras = [[/Bahiana|Gás|gas/i, GAS_TALVEZ]]
  ia.documento = gas(50.23)
  await msgFoto('f1.jpg')
  // Uma conta de banco só: o extrato pergunta só SIM ou NÃO.
  E.tabelas.carteiras = E.tabelas.carteiras.filter((c) => !(c.user_id === 'u-1' && c.id !== 'nubank' && c.id !== 'cartao'))
  ia.documento = {
    tipo: 'extrato', meio: null, vencimento: null, resumo: 'Extrato com 2 lançamentos',
    transacoes: [{ descricao: 'Cliente Ana', valor: 300, movimento: 'entrada', data: null }, { descricao: 'Mercado', valor: 80, movimento: 'saida', data: null }],
  }
  const e = await msgFoto('extrato.jpg')
  assert.match(e.resposta, /Achei 2 lançamentos nesse extrato/)
  assert.equal(pendente()?.fila?.length, 1)
  const s = await msg('sim')
  assert.match(s, /E ficou esse aqui esperando:\nGás de R\$ [\d,]+: é gasto do negócio ou da casa\?/, s)
  assert.ok(valores().includes(300) && valores().includes(80), 'o extrato foi importado')
  const g = await msg('1')
  assert.match(g, /R\$ 50,23/)
  assert.deepEqual(valores(), [50.23, 80, 300])
})

fim()
