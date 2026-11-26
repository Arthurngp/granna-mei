/**
 * Sinais de conversa, pelo servidor de verdade: tiques azuis, "digitando..." 3 s depois da última mensagem (aqui 120 ms, com espera de 400 ms),
 * renovado enquanto pensa e desligado na resposta, e reação antes da resposta. Pedido do Arthur em 2026-11-26.
 *   npx tsx test/sinais-conversa.ts
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { acao, acoes, ia, NUM, pedidos, semear } from './_falsos.ts'

/* ---------------- gateway falso (conta envios e pode recusar) ---------------- */

const envios: { para: string; texto: string }[] = []
/** Tudo o que chegou ao gateway, na ordem: 'lida:<id>', 'digitando', 'parou', 'reacao:<id>:<emoji>', 'envio'. */
const sinais: { o: string; t: number }[] = []
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
    sinais.push({ o: 'envio', t: Date.now() })
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
    return
  }
  const c = (corpo ? JSON.parse(corpo) : {}) as { presence?: string; messageIds?: string[]; emoji?: string }
  if (url.pathname.endsWith('/presence')) sinais.push({ o: c.presence === 'composing' ? 'digitando' : 'parou', t: Date.now() })
  else if (url.pathname.endsWith('/read')) sinais.push({ o: `lida:${(c.messageIds ?? []).join(',')}`, t: Date.now() })
  else if (url.pathname.endsWith('/react')) sinais.push({ o: `reacao:${decodeURIComponent(url.pathname.split('/').slice(-2)[0])}:${c.emoji}`, t: Date.now() })
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
process.env.GRANNINHA_DIGITAR_MS = '120'
process.env.GRANNINHA_LIDA_MS = '20'


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

let n = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  semear()
  envios.length = 0
  sinais.length = 0
  process.env.GRANNINHA_SINAIS = 'on'
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
const os = () => sinais.map((s) => s.o)
const quando = (o: string) => sinais.find((s) => s.o === o)?.t ?? -1

await caso('uma mensagem: lida logo, digitando depois de 120 ms (não antes), reação antes da resposta, e nada de "parou" pendurado', async () => {
  ia.regras = [[/gasolina/, GASOLINA]]
  const t0 = Date.now()
  await postar(evento('gastei 50 de gasolina', 'S-a'))
  await dorme(80)
  assert.ok(os().includes('lida:S-a'), 'não marcou como lida: ' + os())
  assert.ok(!os().includes('digitando'), 'digitando cedo demais: ' + os())
  await esperar(() => envios.length > 0)
  await dorme(100)
  assert.ok(quando('digitando') - t0 >= 110, 'digitando antes dos 120 ms')
  const o = os()
  assert.ok(o.indexOf('digitando') < o.indexOf('reacao:S-a:\u{1F44D}'), 'ordem errada: ' + o)
  assert.ok(o.indexOf('reacao:S-a:\u{1F44D}') < o.indexOf('envio'), 'a reação tem de vir antes da resposta: ' + o)
  assert.ok(!o.slice(o.indexOf('envio')).includes('digitando'), 'voltou a digitar depois de responder: ' + o)
})

await caso('mensagem nova enquanto digita: para de digitar e volta 120 ms depois da nova', async () => {
  ia.regras = [[/oi\ngastei 50 de gasolina/, GASOLINA]]
  await postar(evento('oi', 'S-b'))
  await dorme(200)
  assert.ok(os().includes('digitando'), 'não começou a digitar: ' + os())
  const tNova = Date.now()
  await postar(evento('gastei 50 de gasolina', 'S-c'))
  await esperar(() => envios.length > 0)
  const o = os()
  const parou = sinais.findIndex((s) => s.o === 'parou')
  assert.ok(parou > o.indexOf('digitando'), 'não parou de digitar quando chegou mensagem nova: ' + o)
  const volta = sinais.slice(parou + 1).find((s) => s.o === 'digitando')
  assert.ok(volta && volta.t - tNova >= 110, 'não voltou a digitar no tempo certo: ' + o)
  assert.equal(envios.length, 1)
  assert.ok(o.includes('lida:S-b') && o.includes('lida:S-c'))
})

await caso('pergunta (nada anotado): sem reação; resposta sai e o digitando não fica ligado', async () => {
  ia.regras = []
  await postar(evento('o que você faz?', 'S-d'))
  await esperar(() => envios.length > 0)
  await dorme(100)
  assert.ok(!os().some((x) => x.startsWith('reacao')), 'reagiu sem ter anotado: ' + os())
})

await caso('número que não é cliente: nem lida nem digitando (ele recebe silêncio)', async () => {
  const ev = evento('oi', 'S-e') as any
  ev.data.key.remoteJid = '5511900001111@s.whatsapp.net'
  ev.data.from = '5511900001111@s.whatsapp.net'
  await postar(ev)
  await dorme(700)
  assert.ok(!os().some((x) => x.startsWith('lida') || x === 'digitando'), 'mandou sinal para quem não é cliente: ' + os())
})

await caso('GRANNINHA_SINAIS=off: nenhum sinal, a resposta sai igual', async () => {
  process.env.GRANNINHA_SINAIS = 'off'
  ia.regras = [[/gasolina/, GASOLINA]]
  await postar(evento('gastei 50 de gasolina', 'S-f'))
  await esperar(() => envios.length > 0)
  await dorme(100)
  assert.deepEqual(os(), ['envio'])
})

srv.close()
wa.close()
console.log(falhas ? `\n${falhas} falha(s) de ${n + falhas}` : `\nsinais de conversa: ${n} de ${n}`)
process.exit(falhas ? 1 : 0)
