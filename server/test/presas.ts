/**
 * Fase "Conversa sem falha": nenhuma mensagem perdida em deploy ou queda, e resposta que não chega
 * deixa registro em vez de sumir calada.
 *
 * O defeito era de ORDEM dentro do servidor (responder 200 antes de gravar), então aqui sobe o
 * servidor de verdade e manda POST /webhook assinado, com PostgREST, IA e gateway falsos.
 *   npx tsx test/presas.ts
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { E, acao, acoes, ia, lancsU1, NUM, pedidos, semear, U1 } from './_falsos.ts'

/* ---------------- gateway falso (conta envios e pode recusar) ---------------- */

const envios: { para: string; texto: string }[] = []
let recusar: { status: number; vezes: number } | null = null
let tentativas = 0

const wa = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const corpo = await new Promise<string>((ok) => {
    let t = ''
    req.on('data', (c) => (t += c))
    req.on('end', () => ok(t))
  })
  if (url.pathname.endsWith('/send')) {
    tentativas++
    if (recusar && recusar.vezes > 0) {
      recusar.vezes--
      res.writeHead(recusar.status, { 'Content-Type': 'application/json' }).end('{"erro":"provocado"}')
      return
    }
    const para = decodeURIComponent(url.pathname.split('/').slice(-2)[0]).split('@')[0]
    envios.push({ para, texto: (JSON.parse(corpo || '{}') as { message?: { text?: string } }).message?.text ?? '' })
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data: { status: 'CONNECTED', me: { id: '5581993069537@s.whatsapp.net' } } }))
})
await new Promise<void>((ok) => wa.listen(0, '127.0.0.1', ok))

const SEGREDO = 'segredo-de-teste'
process.env.WA_GATEWAY_URL = `http://127.0.0.1:${(wa.address() as AddressInfo).port}`
process.env.WA_GATEWAY_API_KEY = 'falsa'
process.env.WA_SESSAO = 'teste'
process.env.WA_WEBHOOK_SECRET = SEGREDO
process.env.SEM_BATIMENTO = '1' // a varredura é chamada à mão em cada caso
process.env.ENVIO_ESPERA_MS = '0'
process.env.PRESAS_PISO_MS = '1000'
process.env.PRESAS_TETO_MS = '5000'

const { iniciar, varredura } = await import('../src/index.ts')
const { varrerPresas, decidir, AVISO_INTERROMPIDA } = await import('../src/presas.ts')
const { processar, registrarChegada, tentarColunaEvento, PROCESSANDO } = await import('../src/granninha.ts')

const srv = iniciar(0)
await new Promise<void>((ok) => srv.once('listening', ok))
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`

/* ---------------- ferramentas do teste ---------------- */

let seq = 0
const evento = (texto: string, id = `W${++seq}`, tel = NUM) => ({
  event: 'message.received',
  data: { key: { id, remoteJid: `${tel}@s.whatsapp.net`, fromMe: false }, from: `${tel}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: texto },
})

async function postar(ev: unknown): Promise<{ st: number; ms: number }> {
  const corpo = JSON.stringify(ev)
  const sig = 'sha256=' + createHmac('sha256', SEGREDO).update(corpo).digest('hex')
  const t0 = Date.now()
  const r = await fetch(base + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo })
  await r.text()
  return { st: r.status, ms: Date.now() - t0 }
}

/** Espera a fila do servidor terminar (o webhook responde antes de processar). */
async function esperar(cond: () => boolean, limite = 3000) {
  const fim = Date.now() + limite
  while (Date.now() < fim) {
    if (cond()) return
    await new Promise((ok) => setTimeout(ok, 15))
  }
}
const msgs = () => (E.tabelas.mensagens ?? []) as Record<string, unknown>[]
const linha = (id: string) => msgs().find((m) => m.id === id)
const presa = (x: Partial<Record<string, unknown>>) => {
  E.tabelas.mensagens ??= []
  const l = { id: 'p1', telefone: NUM, tipo: 'texto', texto: 'gastei 50 de gasolina', status: 'recebida', erro: null, efeitos: {}, desfeita: false, evento: null, criado_em: new Date(Date.now() - 2000).toISOString(), ...x }
  E.tabelas.mensagens.push(l)
  return l
}

let n = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  semear()
  E.recusarColuna = null
  E.atrasar = null
  envios.length = 0
  pedidos.length = 0
  recusar = null
  tentativas = 0
  tentarColunaEvento()
  try {
    await fn()
    n++
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 400))
  }
}

const GASOLINA = acoes(acao({ valor: 50, descricao: 'Gasolina' }))

/* ---------------- 1. a chegada é gravada ANTES do 200 ---------------- */

await caso('o 200 só sai depois de a mensagem estar no banco', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  E.atrasar = { tabela: 'mensagens', ms: 250 }
  const ev = evento('gastei 50 de gasolina')
  const { st, ms } = await postar(ev)
  assert.equal(st, 200)
  assert.ok(ms >= 240, `o webhook respondeu em ${ms} ms, sem esperar o banco: a mensagem ficaria só na memória`)
  assert.ok(linha(ev.data.key.id), 'a linha existe no banco assim que o 200 chega')
  await esperar(() => envios.length > 0)
  assert.equal(lancsU1().length, 1, 'e o processamento segue normal depois do 200')
})

await caso('banco fora na chegada: 503 em vez de engolir a mensagem', async () => {
  E.falharTabela = 'mensagens'
  const { st } = await postar(evento('gastei 50 de gasolina'))
  assert.equal(st, 503, 'o gateway precisa ver que deu errado')
  await esperar(() => false, 200)
  assert.equal(envios.length, 0, 'nada é processado sem registro')
})

await caso('mesma mensagem entregue duas vezes não vira lançamento em dobro', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  const ev = evento('gastei 50 de gasolina', 'MESMO-ID')
  await postar(ev)
  await esperar(() => envios.length > 0)
  const { st } = await postar(ev)
  assert.equal(st, 200, 'o gateway recebe 200 (não é erro dele)')
  await esperar(() => false, 250)
  assert.equal(lancsU1().length, 1, 'um lançamento só')
  assert.equal(envios.length, 1, 'e uma resposta só')
})

/* ---------------- 2. a trava de "começou" ---------------- */

await caso('duas voltas na mesma mensagem: só uma trabalha', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  const ev = evento('gastei 50 de gasolina', 'CONC-1')
  assert.equal(await registrarChegada(ev as Parameters<typeof registrarChegada>[0]), 'nova')
  const [a, b] = await Promise.all([
    processar(ev as Parameters<typeof processar>[0], { jaRegistrada: true }),
    processar(ev as Parameters<typeof processar>[0], { jaRegistrada: true }),
  ])
  assert.equal(lancsU1().length, 1, 'um lançamento só, mesmo com os dois processos juntos')
  assert.deepEqual([a.status, b.status].sort(), ['duplicada', 'ok'], 'uma ganha, a outra sai sem fazer nada')
})

await caso('mensagem que já começou NUNCA é reprocessada (e o cliente é avisado)', async () => {
  // Cenário real: "desfazer" que reverteu o lançamento e morreu antes de registrar.
  E.tabelas.lancamentos.push({ user_id: U1, id: 'l1', tipo: 'saida', valor: 50, data: '2026-11-19', carteira_id: 'nubank', descricao: 'Gasolina', pessoal: false })
  presa({ id: 'DESF-1', texto: 'desfazer', erro: PROCESSANDO })
  const log = await varrerPresas(varredura)
  await esperar(() => envios.length > 0)
  assert.equal(lancsU1().length, 1, 'o lançamento NÃO é desfeito de novo')
  assert.equal(linha('DESF-1')?.status, 'erro')
  assert.match(String(linha('DESF-1')?.erro), /interrompida/)
  assert.equal(envios[0]?.texto, AVISO_INTERROMPIDA, 'a cliente é avisada para mandar de novo')
  assert.ok(log.some((l) => l.startsWith('avisar DESF-1')), 'e fica no log do servidor')
})

await caso('REGRESSÃO: sem a trava, o desfazer retomado desfaz um segundo lançamento', async () => {
  // A MESMA linha, só sem a marca de "começou": aí ela é reprocessada e o estrago aparece.
  ia.regras = [[/desfazer/, { intencao: 'desfazer', acoes: [], pergunta: null, correcao: null, falta: null }]]
  E.tabelas.lancamentos.push({ user_id: U1, id: 'l1', tipo: 'saida', valor: 50, data: '2026-11-19', carteira_id: 'nubank', descricao: 'Gasolina', pessoal: false })
  E.tabelas.mensagens = [{ id: 'ANTES', user_id: U1, telefone: NUM, tipo: 'texto', texto: 'gastei 50 de gasolina', status: 'ok', erro: null, desfeita: false, efeitos: { lancamentos: ['l1'] }, criado_em: new Date(Date.now() - 3000).toISOString(), evento: null }]
  presa({ id: 'DESF-2', texto: 'desfazer', erro: null })
  await varrerPresas(varredura)
  await esperar(() => lancsU1().length === 0)
  assert.equal(lancsU1().length, 0, 'prova do estrago: reprocessar um desfazer reverte o lançamento anterior')
})

/* ---------------- 3. retomada de quem nunca começou ---------------- */

await caso('mensagem que nunca começou é retomada e anotada', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  presa({ id: 'PRESA-1' })
  const log = await varrerPresas(varredura)
  assert.ok(log.some((l) => l.startsWith('retomando PRESA-1')), 'entra na fila')
  await esperar(() => lancsU1().length > 0)
  assert.equal(lancsU1().length, 1, 'o lançamento que tinha se perdido no deploy é gravado')
  assert.equal(envios[0]?.para, NUM, 'e a resposta sai')
  assert.equal(linha('PRESA-1')?.status, 'ok')
})

await caso('antes do piso de tempo, não encosta (pode estar rodando agora)', async () => {
  presa({ id: 'NOVA-1', criado_em: new Date().toISOString() })
  const log = await varrerPresas(varredura)
  assert.deepEqual(log, [])
  assert.equal(linha('NOVA-1')?.status, 'recebida', 'continua à espera')
  assert.equal(envios.length, 0)
})

await caso('passou do teto, só arquiva: a cliente já mandou de novo', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  presa({ id: 'VELHA-1', criado_em: new Date(Date.now() - 6000).toISOString() })
  const log = await varrerPresas(varredura)
  await esperar(() => false, 250)
  assert.equal(lancsU1().length, 0, 'não reprocessa (viraria o dobro)')
  assert.equal(envios.length, 0, 'e não manda aviso de algo que a cliente já resolveu')
  assert.equal(linha('VELHA-1')?.status, 'erro')
  assert.ok(log.some((l) => /arquivar VELHA-1/.test(l)))
})

await caso('o que este processo está tratando agora fica de fora da varredura', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  E.atrasar = { tabela: 'lancamentos', ms: 400 }
  const ev = evento('gastei 50 de gasolina', 'VOO-1')
  void postar(ev)
  await esperar(() => Boolean(linha('VOO-1')))
  // Finge que é antiga para cair na janela da varredura, com o processamento ainda rodando.
  const l = linha('VOO-1')!
  l.criado_em = new Date(Date.now() - 2000).toISOString()
  const log = await varrerPresas(varredura)
  assert.deepEqual(log, [], 'a varredura não disputa com a fila local')
  await esperar(() => envios.length > 0, 2000)
  assert.equal(lancsU1().length, 1)
})

await caso('número que não é cliente fica no silêncio mesmo ao ser arquivado', async () => {
  presa({ id: 'ESTRANHO-1', telefone: '5511999990000', erro: PROCESSANDO })
  const log = await varrerPresas(varredura)
  await esperar(() => false, 250)
  assert.equal(envios.length, 0, 'a Granninha é muda para quem não é cliente (PR #16)')
  assert.ok(log.some((l) => /não é cliente/.test(l)))
})

/* ---------------- 4. banco sem a migration da coluna `evento` ---------------- */

await caso('sem a coluna evento o serviço continua gravando a chegada', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  E.recusarColuna = 'evento'
  const ev = evento('gastei 50 de gasolina', 'SEMCOL-1')
  const { st } = await postar(ev)
  assert.equal(st, 200, 'nada quebra entre o merge e a migration')
  assert.ok(linha('SEMCOL-1'), 'a linha foi gravada sem a coluna')
  await esperar(() => lancsU1().length > 0)
  assert.equal(lancsU1().length, 1)
})

await caso('sem a coluna evento, texto ainda é retomado e mídia é avisada', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  E.recusarColuna = 'evento'
  presa({ id: 'TXT-1' })
  presa({ id: 'FOTO-1', tipo: 'foto', texto: '' })
  const log = await varrerPresas(varredura)
  await esperar(() => lancsU1().length > 0)
  assert.equal(lancsU1().length, 1, 'o texto é reconstruído e anotado')
  await esperar(() => envios.some((e) => e.texto === AVISO_INTERROMPIDA))
  assert.ok(log.some((l) => /avisar FOTO-1/.test(l)), 'a foto não dá para refazer: a cliente é avisada')
  assert.equal(linha('FOTO-1')?.status, 'erro')
})

/* ---------------- 5. resposta que não chega (cv-envio) ---------------- */

await caso('gateway fora: tenta de novo e entrega na segunda', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  recusar = { status: 502, vezes: 1 }
  const ev = evento('gastei 50 de gasolina', 'ENV-1')
  await postar(ev)
  await esperar(() => envios.length > 0)
  assert.equal(tentativas, 2, 'a primeira falhou, a segunda passou')
  assert.equal(linha('ENV-1')?.erro, null, 'entregue: nada de erro gravado')
})

await caso('resposta não entregue fica registrada, e o DESFAZER continua achando o lançamento', async () => {
  ia.regras = [[/gasolina/, GASOLINA], [/desfazer/, { intencao: 'desfazer', acoes: [], pergunta: null, correcao: null, falta: null }]]
  recusar = { status: 500, vezes: 99 }
  const ev = evento('gastei 50 de gasolina', 'ENV-2')
  await postar(ev)
  await esperar(() => tentativas >= 3)
  await esperar(() => Boolean(linha('ENV-2')?.erro))
  assert.equal(tentativas, 3, 'três tentativas antes de desistir')
  assert.match(String(linha('ENV-2')?.erro), /resposta não entregue/)
  assert.equal(linha('ENV-2')?.status, 'ok', 'o status fica como está: o lançamento foi gravado')
  assert.equal(lancsU1().length, 1)
  // O DESFAZER procura a última mensagem com status 'ok': marcar 'erro' aqui esconderia o lançamento.
  recusar = null
  const r = await processar(evento('desfazer', 'ENV-3') as Parameters<typeof processar>[0])
  assert.match(String(r.resposta), /desfiz/)
  assert.equal(lancsU1().length, 0, 'o desfazer alcança o lançamento da resposta que não chegou')
})

await caso('pedido inválido não é repetido', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  recusar = { status: 400, vezes: 99 }
  await postar(evento('gastei 50 de gasolina', 'ENV-4'))
  await esperar(() => /não entregue/.test(String(linha('ENV-4')?.erro)))
  assert.match(String(linha('ENV-4')?.erro), /não entregue/, 'a falha fica registrada')
  assert.equal(tentativas, 1, '400 daria o mesmo erro de novo: não insiste')
})

/* ---------------- 6. decisão isolada ---------------- */

await caso('a decisão por si só: cada estado tem um caminho', async () => {
  const agora = Date.now()
  const nova = { id: 'a', telefone: NUM, tipo: 'texto', texto: 'x', erro: null, criado_em: new Date(agora - 100).toISOString(), evento: null }
  assert.equal(decidir(nova, agora).acao, 'esperar')
  assert.equal(decidir({ ...nova, criado_em: new Date(agora - 2000).toISOString() }, agora).acao, 'reprocessar')
  assert.equal(decidir({ ...nova, criado_em: new Date(agora - 2000).toISOString(), erro: PROCESSANDO }, agora).acao, 'avisar')
  assert.equal(decidir({ ...nova, criado_em: new Date(agora - 6000).toISOString() }, agora).acao, 'arquivar')
  assert.equal(decidir({ ...nova, tipo: 'audio', criado_em: new Date(agora - 2000).toISOString() }, agora).acao, 'avisar')
})

srv.close()
wa.close()
console.log(falhas ? `\n${falhas} falha(s) de ${n + falhas}` : `\n${n} casos ok`)
process.exit(falhas ? 1 : 0)
