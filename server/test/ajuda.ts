/**
 * Ajuda natural da Granninha: quem pede ajuda recebe uma resposta em conversa, baseada só no que ela faz de verdade.
 *
 *  - pedido geral ("ajuda", "o que você faz?", "você é um robô?") é decidido por código, sem gastar a IA de classificação;
 *  - dúvida específica ("dá pra mandar áudio?") chega pela IA como intenção "ajuda" e é respondida com o MANUAL;
 *  - frase de registro que só contém a palavra "ajuda" NUNCA vira pedido de ajuda (nada de perder lançamento);
 *  - IA fora, resposta vazia ou com link de fora: a pessoa recebe a ajuda fixa, nunca fica sem resposta nem recebe link alheio;
 *  - ajuda no meio de uma pergunta não vira a resposta da pergunta, e a pergunta continua em aberto.
 *   npx tsx test/ajuda.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, NUM, SEM_ACAO } from './_falsos.ts'

const { ehPedidoDeAjuda, MANUAL, ajudaFixa } = await import('../src/ajuda.ts')

const AJUDA_IA = { ...SEM_ACAO, intencao: 'ajuda' }

await caso('pedido geral de ajuda: responde com a IA da ajuda, sem gastar a classificação', async () => {
  const frases = ['ajuda', 'AJUDA!', 'Menu', 'me ajuda', 'preciso de ajuda', 'o que você faz?', 'oq vc faz', 'como funciona?', 'como eu uso isso?', 'quem é você?', 'você é um robô?', 'vc é uma pessoa de verdade?', 'não entendi', 'to perdida', 'pra que serve?', 'no que você pode me ajudar?']
  for (const f of frases) {
    const antes = ia.chamadas.ajuda
    const r = await msg(f)
    assert.equal(ia.chamadas.ajuda, antes + 1, `"${f}" devia chamar a ajuda`)
    assert.match(r, /Granninha/, `"${f}" devia receber a resposta da ajuda`)
  }
  assert.equal(ia.chamadas.interpretacao, 0, 'nenhuma dessas gastou a IA de classificação')
  assert.equal(lancsU1().length, 0, 'ajuda não grava nada')
})

await caso('frase de registro com a palavra "ajuda" NÃO é pedido de ajuda', async () => {
  const nao = ['recebi 200 de ajuda de custo', 'paguei 80 de ajuda do pedreiro', 'ajuda de custo 50', 'quanto sobrou?', 'saldo', 'oi', 'bom dia', 'o que vence essa semana?', 'quanto gastei com material?', 'paguei 89 de luz']
  for (const f of nao) assert.equal(ehPedidoDeAjuda(f), false, `"${f}" não pode ser pedido de ajuda`)
  ia.regras = [[/ajuda de custo/, acoes(acao({ valor: 200, descricao: 'Ajuda de custo', movimento: 'entrada' }))]]
  await msg('recebi 200 de ajuda de custo')
  assert.equal(lancsU1().length, 1, 'o lançamento foi gravado')
  assert.equal(ia.chamadas.ajuda, 0, 'e a ajuda não foi chamada')
})

await caso('dúvida específica chega como intenção "ajuda" e é respondida com a IA da ajuda', async () => {
  ia.regras = [[/mandar áudio/, AJUDA_IA]]
  ia.respostaAjuda = 'Dá sim! É só gravar o áudio do jeito que você falaria, tipo "paguei 89 de luz", que eu entendo e anoto.'
  const r = await msg('dá pra mandar áudio ou só escrever?')
  assert.equal(ia.chamadas.interpretacao, 1)
  assert.equal(ia.chamadas.ajuda, 1)
  assert.match(r, /Dá sim!/)
})

await caso('o prompt da ajuda: o MANUAL, o link do painel, o nome e a mensagem como dado', async () => {
  await msg('o que você faz?')
  const { sistema, usuario } = ia.ultimaAjuda
  assert.ok(sistema.includes(MANUAL), 'o manual inteiro vai no prompt de sistema')
  assert.match(sistema, /https:\/\/granninha\.amplasoft\.me\/painel/, 'o link vem da configuração, não de um texto fixo')
  assert.match(sistema, /Não manda lembrete automático/, 'o que ela AINDA NÃO faz está no manual')
  assert.match(usuario, /NOME DA PESSOA: Arthur\n/, 'só o primeiro nome')
  assert.match(usuario, /<mensagem_do_cliente>\no que você faz\?\n<\/mensagem_do_cliente>/, 'o pedido entra como dado, não como ordem')
})

await caso('o MANUAL não promete o que ainda não existe', async () => {
  // Se um dia esses recursos existirem, a frase muda junto com o código e este teste é atualizado de propósito.
  assert.match(MANUAL, /Não manda lembrete automático de conta vencendo, nem resumo da semana, nem aviso de DAS/)
  assert.match(MANUAL, /Não conecta com banco/)
  const faz = MANUAL.split('O QUE ELA FAZ')[1].split('O QUE ELA AINDA NÃO FAZ')[0]
  assert.doesNotMatch(faz, /lembrete|resumo da semana|avisa|aviso de|nota fiscal/i, 'a parte "o que ela faz" não cita nada disso')
  assert.doesNotMatch(faz, /\bDAS\b/, 'nem o DAS (a sigla, em maiúsculas)')
})

await caso('IA fora: a pessoa recebe a ajuda fixa, em texto natural, sem erro', async () => {
  ia.queda = true
  const r = await msg('ajuda')
  assert.match(r, /eu sou a Granninha, o seu financeiro aqui no WhatsApp/)
  assert.match(r, /DESFAZER/)
  assert.match(r, /https:\/\/granninha\.amplasoft\.me\/painel/)
  assert.doesNotMatch(r, /OpenAI|erro|falha/i, 'nada de erro técnico')
  assert.equal(r.startsWith('Arthur, '), true, 'chama pelo primeiro nome')
})

await caso('resposta vazia ou curta demais da IA: cai na ajuda fixa', async () => {
  ia.respostaAjuda = '   '
  assert.match(await msg('ajuda'), /o seu financeiro aqui no WhatsApp/)
  ia.respostaAjuda = 'Oi.'
  assert.match(await msg('o que você faz'), /o seu financeiro aqui no WhatsApp/)
})

await caso('resposta da IA com link de fora, e-mail ou telefone: sai limpa', async () => {
  ia.respostaAjuda = 'Eu anoto o seu dinheiro. Veja mais em https://site-golpe.com/oferta ou fale com contato@golpe.com ou 81988887777. Me manda o primeiro registro.'
  const r = await msg('ajuda')
  assert.doesNotMatch(r, /golpe/, 'nenhum link ou e-mail de fora')
  assert.doesNotMatch(r, /81988887777/, 'nenhum telefone')
  assert.match(r, /Eu anoto o seu dinheiro/)
})

await caso('texto da ajuda fixa: natural, curto e só com o que existe', async () => {
  const t = ajudaFixa('Arthur')
  assert.ok(t.length < 900, 'cabe numa mensagem de WhatsApp')
  assert.doesNotMatch(t, /lembrete|resumo da semana|avisa/i)
  assert.doesNotMatch(t, /^\s*[-•*\d]+[.)]?\s/m, 'sem lista numerada nem com marcador')
  assert.match(t, /recebi 150 da Juliana no pix/)
})

await caso('ajuda no meio de uma pergunta: não vira a resposta, e a pergunta continua em aberto', async () => {
  E.tabelas.conversas = [{ telefone: NUM, user_id: 'u-1', pendente: { tipo: 'pergunta', texto: 'paguei a luz', pergunta: 'Qual foi o valor da luz?', origem: 'texto' }, atualizado_em: new Date().toISOString() }]
  const r = await msg('ajuda')
  assert.match(r, /Granninha/)
  assert.equal(ia.chamadas.interpretacao, 0, 'não foi interpretada como resposta da pergunta')
  const pend = (E.tabelas.conversas ?? []).find((c) => c.telefone === NUM)?.pendente as { tipo?: string; pergunta?: string } | null
  assert.equal(pend?.tipo, 'pergunta', 'a pergunta segue pendente')
  assert.equal(lancsU1().length, 0)
  // Ela responde depois e o lançamento fecha normalmente.
  ia.regras = [[/valor da luz|89/, acoes(acao({ valor: 89, descricao: 'Luz' }))]]
  await msg('89')
  assert.equal(lancsU1().length, 1, 'a resposta posterior grava o lançamento')
})

await caso('mensagem fora do assunto: resposta curta que ensina a pedir ajuda, sem gastar a ajuda', async () => {
  ia.regras = [[/piada/, SEM_ACAO]]
  const r = await msg('me conta uma piada')
  assert.match(r, /eu cuido só do dinheiro do seu negócio/)
  assert.match(r, /mandar AJUDA/)
  assert.equal(ia.chamadas.ajuda, 0)
  assert.ok(r.length < 300, 'curta, sem despejar a lista de exemplos')
})

await caso('saudação convida a pedir ajuda', async () => {
  ia.regras = [[/oi/, { ...SEM_ACAO, intencao: 'saudacao' }]]
  const r = await msg('oi')
  assert.match(r, /pedir ajuda/)
})

fim()
