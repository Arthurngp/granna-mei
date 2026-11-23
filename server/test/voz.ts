/**
 * A voz da Granninha (a moedinha): amiguinha de confiança, próxima, confiante e confiável.
 *
 *  - a voz vive em src/voz.ts e os prompts de IA (ajuda, perguntas) a carregam;
 *  - as mensagens fixas respeitam os vetos: sem travessão, sem emoji, sem frase de chatbot, sem marcar gênero;
 *  - a confirmação de um registro abre com variações e SEMPRE traz o valor exato e o comando DESFAZER;
 *  - o número continua vindo do código: a IA não reescreve valor.
 *   npx tsx test/voz.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, SEM_ACAO } from './_falsos.ts'

const { VOZ, MSG, ERROU, confirma, ABRE_ENTRADA, ABRE_SAIDA } = await import('../src/voz.ts')
const { ajudaFixa } = await import('../src/ajuda.ts')

const ABRE_E = `(${ABRE_ENTRADA.join('|')})`
const ABRE_S = `(${ABRE_SAIDA.join('|')})`

/** Tudo o que a Granninha fala por mensagem fixa, para varrer os vetos de uma vez. */
const FIXAS = (): string[] => [
  MSG.nadaParaDesfazer, MSG.corrigi, MSG.problemaAoAnotar, MSG.foraDoAssunto, MSG.saudacao('Arthur'), MSG.saudacao(''), MSG.numeroConfirmado('Arthur'),
  ERROU, ajudaFixa('Arthur'), ajudaFixa(null),
  ...ABRE_ENTRADA.map((a) => `${a} R$ 150,00.`), ...ABRE_SAIDA.map((a) => `${a} R$ 89,00.`),
  confirma.transferencia('R$ 10,00'), confirma.pagouFatura('R$ 10,00'), confirma.compraCartao('R$ 10,00'),
  confirma.conta('pagar', 'R$ 10,00'), confirma.conta('receber', 'R$ 10,00'), confirma.baixa('pagar', 'R$ 10,00'), confirma.baixa('receber', 'R$ 10,00'),
]

await caso('a voz: quem fala, como soa e o que nunca diz', async () => {
  assert.match(VOZ, /QUEM FALA/)
  assert.match(VOZ, /a moedinha/)
  assert.match(VOZ, /amiguinha de confiança/)
  assert.match(VOZ, /Confiante/)
  assert.match(VOZ, /Confiável/)
  assert.match(VOZ, /Nenhum emoji/)
  assert.match(VOZ, /não marque gênero/, 'sem gênero sobre si')
  assert.match(VOZ, /inteligência artificial em forma de moedinha/, 'honesta sobre ser IA, sem cara de robô')
  assert.match(VOZ, /não é X, é Y/, 'os mesmos vetos do Instagram')
})

await caso('mensagens fixas: sem travessão, sem emoji e sem frase de chatbot', async () => {
  for (const t of FIXAS()) {
    assert.doesNotMatch(t, /[–—]/, `sem travessão: ${t}`)
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, `sem emoji: ${t}`)
    assert.doesNotMatch(t, /Claro!|Com certeza|Ótima pergunta|Obrigad[oa] pela paciência|Infelizmente|Fico à disposição|Além disso|No entanto/i, `sem frase de chatbot: ${t}`)
  }
})

await caso('mensagens fixas: ela não marca gênero sobre si', async () => {
  for (const t of FIXAS()) assert.doesNotMatch(t, /\bobrigad[oa]\b|\bsozinh[oa]\b|\b(estou|sou|tô) (pront|cert|segur|feliz|anim)[oa]\b/i, `sem gênero: ${t}`)
})

await caso('mensagem de problema: assume em uma frase e não culpa a pessoa', async () => {
  assert.match(MSG.problemaAoAnotar, /aqui do meu lado/)
  assert.match(MSG.problemaAoAnotar, /nada que você fez/)
  assert.doesNotMatch(MSG.problemaAoAnotar, /tente novamente|por favor|desculpe/i)
})

await caso('confirmação de entrada e de saída: abertura da lista, valor exato, DESFAZER no fim', async () => {
  ia.regras = [[/recebi 150/, acoes(acao({ valor: 150, descricao: 'Corte', movimento: 'entrada', categoria_id: 'vendas' }))], [/paguei 89/, acoes(acao({ valor: 89, descricao: 'Luz' }))]]
  const e = await msg('recebi 150 da Juliana no pix')
  assert.match(e, new RegExp(`^${ABRE_E} R\\$ 150,00\\.`), e)
  assert.match(e, /Errou\? É só responder DESFAZER\.$/, 'fecha com o comando')
  const s = await msg('paguei 89 de luz')
  assert.match(s, new RegExp(`^${ABRE_S} R\\$ 89,00\\.`), s)
  assert.match(s, /Errou\? É só responder DESFAZER\.$/)
  assert.equal(lancsU1().length, 2)
})

await caso('as aberturas variam: em várias confirmações aparece mais de uma', async () => {
  ia.regras = [[/recebi/, acoes(acao({ valor: 10, descricao: 'x', movimento: 'entrada', categoria_id: 'vendas' }))]]
  const vistas = new Set<string>()
  for (let i = 0; i < 40; i++) vistas.add(confirma.lancamento('entrada', 'R$ 10,00').split(',')[0])
  assert.ok(vistas.size >= 2, `só apareceu: ${[...vistas].join(' | ')}`)
})

await caso('conta a pagar, a receber e baixa: a linha de cima fala como amiga e traz o valor', async () => {
  assert.equal(confirma.conta('pagar', 'R$ 300,00'), 'Guardei a conta: R$ 300,00 a pagar.')
  assert.equal(confirma.conta('receber', 'R$ 300,00'), 'Guardei a conta: R$ 300,00 a receber.')
  assert.equal(confirma.baixa('pagar', 'R$ 85,00'), 'Conta paga: R$ 85,00.')
  assert.equal(confirma.baixa('receber', 'R$ 85,00'), 'Boa, recebeu R$ 85,00.')
})

await caso('a IA de perguntas carrega a voz e sabe oferecer o próximo passo no mês ruim', async () => {
  ia.regras = [[/com material/, { ...SEM_ACAO, intencao: 'pergunta', pergunta: 'quanto gastei com material' }]]
  await msg('quanto gastei com material?')
  assert.equal(ia.chamadas.resposta, 1)
  assert.match(ia.ultimoSistemaPergunta, /QUEM FALA/)
  assert.match(ia.ultimoSistemaPergunta, /maiores gastos do mês/, 'o próximo passo oferecido é algo que existe')
  assert.match(ia.ultimoSistemaPergunta, /Nunca invente número/, 'o número continua vindo do resumo, não da IA')
})

await caso('a IA da ajuda carrega a mesma voz', async () => {
  await msg('ajuda')
  assert.match(ia.ultimaAjuda.sistema, /QUEM FALA/)
  assert.match(ia.ultimaAjuda.sistema, /a moedinha/)
  assert.match(ia.ultimaAjuda.sistema, /Nenhum emoji/)
})

await caso('o prompt de interpretação pede a pergunta de "falta" no jeito de amiga', async () => {
  ia.regras = [[/paguei a luz/, { ...SEM_ACAO, intencao: 'acoes', acoes: [acao({ valor: null as unknown as number, descricao: 'Luz' })], falta: 'Faltou só o valor da luz. Quanto foi?' }]]
  await msg('paguei a luz')
  assert.match(ia.ultimoSistema, /no jeito de amiga: direta, sem "por favor" nem "poderia"/)
})

await caso('sem lançamento em ajuda ou saudação: a voz não grava nada', async () => {
  await msg('ajuda')
  assert.equal(lancsU1().length, 0)
  assert.equal((E.tabelas.contas ?? []).filter((c) => c.user_id === 'u-1').length, 3, 'as contas do cenário seguem intactas')
})

fim()
