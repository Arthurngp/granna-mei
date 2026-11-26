/**
 * Espera antes de responder, pelo servidor de verdade (POST /webhook assinado, banco, IA e gateway falsos).
 * Na produção a espera é 10 s; aqui 400 ms, mesma lógica.
 *   npx tsx test/rajada-servidor.ts
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { E, acao, acoes, ia, lancsU1, NUM, pedidos, semear } from './_falsos.ts'

/* ---------------- gateway falso (conta envios e pode recusar) ---------------- */

const envios: { para: string; texto: string }[] = []
const recusar = null as { status: number; vezes: number } | null
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
process.env.GRANNINHA_ESPERA_MS = '400'


const { iniciar } = await import('../src/index.ts')
const { NA_FILA } = await import('../src/granninha.ts')
void NA_FILA
const srv = iniciar(0)
await new Promise<void>((ok) => srv.once('listening', ok))
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`

let seq = 0
const evento = (texto: string, id = `J${++seq}`) => ({
  event: 'message.received',
  data: { key: { id, remoteJid: `${NUM}@s.whatsapp.net`, fromMe: false }, from: `${NUM}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: texto },
})
async function postar(ev: unknown) {
  const corpo = JSON.stringify(ev)
  const sig = 'sha256=' + createHmac('sha256', SEGREDO).update(corpo).digest('hex')
  const r = await fetch(base + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo })
  await r.text()
  return r.status
}
const dorme = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
async function esperar(cond: () => boolean, limite = 4000) {
  const fim = Date.now() + limite
  while (Date.now() < fim && !cond()) await dorme(15)
}
const linha = (id: string) => ((E.tabelas.mensagens ?? []) as Record<string, unknown>[]).find((m) => m.id === id)

let n = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  semear()
  envios.length = 0
  pedidos.length = 0
  ia.chamadas.interpretacao = 0
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

await caso('"oi", "gastei 50", "de gasolina" com menos de 400 ms entre elas: o relógio reinicia, sai UMA resposta e UM lançamento', async () => {
  ia.regras = [[/oi\ngastei 50\nde gasolina/, GASOLINA]]
  const t0 = Date.now()
  assert.equal(await postar(evento('oi', 'J-a')), 200)
  await dorme(250)
  await postar(evento('gastei 50', 'J-b'))
  await dorme(250)
  assert.equal(envios.length, 0, 'respondeu antes de a pessoa parar de escrever')
  await postar(evento('de gasolina', 'J-c'))
  await dorme(300)
  assert.equal(envios.length, 0, 'não esperou 400 ms depois da ÚLTIMA mensagem')
  await esperar(() => envios.length > 0)
  assert.ok(Date.now() - t0 >= 900, 'respondeu cedo demais')
  await dorme(200)
  assert.equal(envios.length, 1, `deveria sair uma resposta só, saíram ${envios.length}`)
  assert.equal(ia.chamadas.interpretacao, 1, 'a IA deveria ser chamada uma vez, com o texto junto')
  assert.equal(lancsU1().length, 1)
  assert.equal(Number(lancsU1()[0].valor), 50)
  assert.equal(linha('J-c')?.status, 'ok')
  assert.equal(linha('J-c')?.texto, 'oi\ngastei 50\nde gasolina')
  for (const id of ['J-a', 'J-b']) {
    assert.equal(linha(id)?.status, 'ignorada', id)
    assert.match(String(linha(id)?.erro), /juntada em J-c/)
  }
})

await caso('mensagem sozinha também espera e é respondida uma vez', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  const t0 = Date.now()
  await postar(evento('gastei 50 de gasolina', 'J-d'))
  await dorme(250)
  assert.equal(envios.length, 0)
  await esperar(() => envios.length > 0)
  assert.ok(Date.now() - t0 >= 380)
  assert.equal(envios.length, 1)
  assert.equal(linha('J-d')?.status, 'ok')
})

await caso('"gastei 50 de gasolina" e "DESFAZER" na mesma rajada: duas respostas, na ordem, e o desfazer pega o lançamento', async () => {
  ia.regras = [[/gasolina/, GASOLINA], [/^DESFAZER$/, { intencao: 'desfazer', acoes: [], pergunta: null, correcao: null, falta: null }]]
  await postar(evento('gastei 50 de gasolina', 'J-e'))
  await dorme(100)
  await postar(evento('DESFAZER', 'J-f'))
  await esperar(() => envios.length >= 2)
  assert.equal(envios.length, 2)
  assert.equal(linha('J-e')?.status, 'ok')
  assert.notEqual(linha('J-f')?.status, 'ignorada')
})

await caso('a marcação das juntadas falha em parte: desfaz e atende uma a uma, nenhuma some e nenhuma fica na fila', async () => {
  ia.regras = [[/gastei 50/, GASOLINA]]
  await postar(evento('oi', 'J-g'))
  await postar(evento('gastei 50', 'J-h'))
  await postar(evento('de gasolina', 'J-i'))
  // Outro processo pegou a J-g no meio da espera: a marcação vai achar só 1 de 2.
  const g = linha('J-g')!
  g.erro = 'processando'
  await esperar(() => envios.length >= 2)
  await dorme(300)
  assert.equal(linha('J-h')?.status, 'ok', 'a J-h ficou presa: ' + JSON.stringify(linha('J-h')))
  assert.notEqual(linha('J-h')?.erro, 'na fila')
  assert.ok(!String(linha('J-h')?.erro ?? '').startsWith('juntada'), 'a J-h ficou marcada como juntada e não foi atendida')
  assert.notEqual(linha('J-i')?.status, 'recebida')
  assert.equal(lancsU1().length, 1)
})

srv.close()
wa.close()
console.log(falhas ? `\n${falhas} falha(s) de ${n + falhas}` : `\nrajada no servidor: ${n} de ${n}`)
process.exit(falhas ? 1 : 0)
