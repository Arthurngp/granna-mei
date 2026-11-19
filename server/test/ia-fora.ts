/**
 * Quando a IA para, alguém tem que saber.
 *
 * Caso de origem (2026-11-19): a chave da OpenAI ficou SEM COTA. A Granninha respondia "tive um
 * problema para anotar agora" para todos os clientes, nenhum lançamento entrava, nada avisava ninguém,
 * e isso só apareceu porque eu estava rodando o teste de fluxo — com o Instagram levando gente nova
 * para um produto que não respondia.
 *   npx tsx test/ia-fora.ts
 */
import assert from 'node:assert/strict'
import { caso, E, fim, ia, lancsU1, msg, msgAudio, msgCompleta, msgFoto, NUM, semear } from './_falsos.ts'

const { classificarFalhaIA, estadoIA, valeTentarDeNovoIA, zerarEstadoIA, recadoDaFalhaIA, MARCA_RETOMAR, valeRetomarIA } = await import('../src/ia-estado.ts')
const { processar } = await import('../src/granninha.ts')

const COTA = { status: 429, corpo: JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } }) }
const LIMITE = { status: 429, corpo: JSON.stringify({ error: { message: 'Rate limit reached for gpt-5.4-mini', type: 'requests', code: 'rate_limit_exceeded' } }) }
const CHAVE = { status: 401, corpo: JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }) }
const msgDoBanco = (i = 0) => (E.tabelas.mensagens ?? [])[i] as Record<string, unknown> | undefined

/* ---------------- classificação ---------------- */

await caso('reconhece o motivo pelo que a OpenAI responde', async () => {
  assert.equal(classificarFalhaIA(429, COTA.corpo), 'sem_cota', 'cota esgotada vem como 429, não como 402')
  assert.equal(classificarFalhaIA(429, LIMITE.corpo), 'limite')
  assert.equal(classificarFalhaIA(401, CHAVE.corpo), 'sem_chave')
  assert.equal(classificarFalhaIA(503, 'upstream error'), 'fora')
  assert.equal(classificarFalhaIA(400, 'invalid request'), 'outro')
})

await caso('insiste só onde insistir resolve', async () => {
  assert.equal(valeTentarDeNovoIA('limite'), true, 'limite de taxa passa em segundos')
  assert.equal(valeTentarDeNovoIA('fora'), true)
  assert.equal(valeTentarDeNovoIA('sem_cota'), false, 'cota não volta em 2 segundos: repetir só faz esperar')
  assert.equal(valeTentarDeNovoIA('sem_chave'), false)
})

await caso('retomar depois vale para falha externa, não para erro nosso', async () => {
  // Insistir AGORA e retomar DEPOIS são decisões diferentes: cota não vale insistir, mas vale retomar
  // quando o crédito entrar.
  assert.equal(valeRetomarIA('sem_cota'), true, 'o crédito entra e a mensagem ainda faz sentido')
  assert.equal(valeRetomarIA('limite'), true)
  assert.equal(valeRetomarIA('fora'), true)
  assert.equal(valeRetomarIA('outro'), false, 'erro nosso (400) não melhora com o tempo')
  assert.equal(valeRetomarIA('sem_chave'), false, 'chave errada precisa de gente, não de espera')
})

/* ---------------- o que acontece com a cliente ---------------- */

await caso('sem cota: a cliente ouve que o problema é nosso, e nada é gravado', async () => {
  zerarEstadoIA()
  ia.erro = COTA
  const r = await msgCompleta('paguei 50 de gasolina')
  assert.match(r.resposta, /problema técnico aqui do meu lado/, r.resposta)
  assert.doesNotMatch(r.resposta, /quota|billing|openai|429/i, 'nada de jargão nem de erro cru para a cliente')
  assert.equal(lancsU1().length, 0)
  assert.equal(r.status, 'erro')
})

await caso('sem cota NÃO é tentada três vezes', async () => {
  zerarEstadoIA()
  ia.erro = COTA
  await msg('paguei 50 de gasolina')
  assert.equal(ia.pedidos, 1, 'uma chamada só: antes eram 3, com ~2,5s de espera para dar o mesmo erro')
})

await caso('limite de taxa continua sendo tentado de novo', async () => {
  zerarEstadoIA()
  ia.erro = LIMITE
  const r = await msg('paguei 50 de gasolina')
  assert.equal(ia.pedidos, 3, 'limite passa: insistir faz sentido')
  assert.match(r, /muita coisa ao mesmo tempo/, r)
})

await caso('o motivo fica registrado na mensagem, não um "erro" genérico', async () => {
  zerarEstadoIA()
  ia.erro = COTA
  await msg('paguei 50 de gasolina')
  const m = msgDoBanco()
  assert.equal(m?.status, 'erro')
  assert.match(String(m?.erro), /IA sem_cota/, String(m?.erro))
})

/* ---------------- o que o monitoramento vê ---------------- */

await caso('o estado da IA conta o problema, desde quando, e volta ao normal', async () => {
  zerarEstadoIA()
  assert.equal(estadoIA().ok, true, 'começa sem problema conhecido')

  ia.erro = COTA
  await msg('paguei 50 de gasolina')
  const fora = estadoIA()
  assert.equal(fora.ok, false)
  assert.equal(fora.problema, 'sem_cota')
  assert.ok(fora.desde, 'diz desde quando (é isso que vira alerta)')
  assert.ok(fora.falhas >= 1)
  assert.match(String(fora.detalhe), /quota/i, 'o detalhe técnico fica aqui, não na conversa')

  // A cota volta: a próxima chamada bem-sucedida limpa o estado.
  ia.erro = null
  ia.regras = [[/gasolina/, { intencao: 'outro', acoes: [], pergunta: null, correcao: null, falta: null }]]
  await msg('paguei 50 de gasolina')
  const voltou = estadoIA()
  assert.equal(voltou.ok, true, 'voltou ao normal sozinho')
  assert.equal(voltou.problema, null)
  assert.ok(voltou.ultimo_ok)
})

/* ---------------- a premissa que torna a retomada segura ---------------- */

await caso('PREMISSA: falha de IA nunca deixa nada gravado, em nenhum caminho', async () => {
  // A retomada só é segura porque a IA é sempre chamada ANTES de gravar. Se alguém mover uma chamada
  // de IA para depois do executar(), este caso cai — e a retomada passaria a criar lançamento em dobro.
  for (const [nome, mandar] of [
    ['texto', () => msg('paguei 50 de gasolina')],
    ['áudio', () => msgAudio()],
    ['foto', () => msgFoto()],
  ] as [string, () => Promise<unknown>][]) {
    semear()
    zerarEstadoIA()
    ia.erro = COTA
    await mandar()
    assert.equal(lancsU1().length, 0, `${nome}: nada gravado quando a IA falha`)
    assert.equal((E.tabelas.contas ?? []).filter((c) => c.user_id === 'u-1' && c.id !== 'c1' && c.id !== 'c2' && c.id !== 'c3').length, 0, `${nome}: nenhuma conta nova`)
  }
})

await caso('mensagem perdida pela IA fica marcada para retomar', async () => {
  zerarEstadoIA()
  ia.erro = COTA
  await msg('paguei 50 de gasolina')
  assert.match(String(msgDoBanco()?.erro), new RegExp('^' + MARCA_RETOMAR), 'a marca entra no começo do erro')
})

await caso('erro NOSSO (400) não é marcado para retomar: não melhora com o tempo', async () => {
  zerarEstadoIA()
  ia.erro = { status: 400, corpo: JSON.stringify({ error: { message: 'invalid request' } }) }
  await msg('paguei 50 de gasolina')
  assert.doesNotMatch(String(msgDoBanco()?.erro), new RegExp(MARCA_RETOMAR))
})

await caso('retomada que falha de novo CONTINUA esperando (quem limita é a janela)', async () => {
  zerarEstadoIA()
  ia.erro = COTA
  const ev = {
    event: 'message.received',
    data: { key: { id: 'RETRY-1', remoteJid: `${NUM}@s.whatsapp.net`, fromMe: false }, from: `${NUM}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: 'paguei 50 de gasolina' },
  }
  await processar(ev as Parameters<typeof processar>[0])
  const linha = (E.tabelas.mensagens ?? []).find((m) => m.id === 'RETRY-1')!
  assert.match(String(linha.erro), new RegExp('^' + MARCA_RETOMAR), 'a primeira falha marca')
  // A retomada roda com a IA ainda fora: a mensagem tem que CONTINUAR na fila, senão ela seria
  // esquecida justamente no cenário em que a cota demora para entrar. O limite é a janela de tempo.
  const r = await processar(ev as Parameters<typeof processar>[0], { jaRegistrada: true, retomada: true })
  assert.equal(r.status, 'erro', 'a retomada falhou porque a IA segue fora')
  const depois = (E.tabelas.mensagens ?? []).find((m) => m.id === 'RETRY-1')!
  assert.match(String(depois.erro), new RegExp('^' + MARCA_RETOMAR), 'continua marcada para a próxima volta')
})

await caso('o recado nunca promete atendimento que não existe', async () => {
  for (const t of ['sem_cota', 'limite', 'fora', 'sem_chave', 'outro'] as const) {
    const r = recadoDaFalhaIA(t)
    assert.doesNotMatch(r, /suporte|atendimento|fala com a gente|estamos verificando|nossa equipe/i, `${t}: ${r}`)
    assert.ok(r.length < 180, `${t} é curto`)
  }
})

fim()
