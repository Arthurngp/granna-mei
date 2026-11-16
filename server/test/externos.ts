/**
 * Granninha em silêncio para quem não é cliente (sem banco real, sem IA).
 * Sobe um PostgREST falso local e chama processar() direto.
 *   npx tsx test/externos.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'

const CODIGO_VALIDO = '482913'
const db = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const tabela = url.pathname.split('/').pop()
  const umSo = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  let corpo: unknown = []
  if (req.method === 'GET' && tabela === 'verificacoes' && url.search.includes(CODIGO_VALIDO)) corpo = [{ user_id: 'u-1' }]
  if (req.method === 'PATCH' && tabela === 'perfis') corpo = [{ nome: 'Camila Teste' }]
  const arr = corpo as unknown[]
  if (umSo) {
    if (!arr.length) {
      res.writeHead(406, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ code: 'PGRST116', message: 'sem linhas' }))
    }
    corpo = arr[0]
  }
  res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(corpo))
})
await new Promise<void>((ok) => db.listen(0, '127.0.0.1', ok))
process.env.SUPABASE_URL = `http://127.0.0.1:${(db.address() as AddressInfo).port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'falsa'
process.env.OPENAI_API_KEY = 'falsa'
process.env.PAINEL_URL = 'https://grannamei.amplasoft.me/painel'
delete process.env.GRANNINHA_CONVIDAR

const { processar } = await import('../src/granninha.ts')

let seq = 0
const msg = (texto: string) =>
  processar({
    event: 'message.received',
    data: { key: { id: `EXT${Date.now()}${++seq}`, remoteJid: '5581988887777@s.whatsapp.net', fromMe: false }, from: '5581988887777@s.whatsapp.net', isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: texto },
  } as Parameters<typeof processar>[0])

let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 300))
  }
}

await caso('quem não é cliente não recebe nada', async () => {
  const r = await msg('oi, quero saber do granna mei')
  assert.equal(r.status, 'ignorada')
  assert.equal(r.resposta ?? '', '')
})
await caso('nem com código errado', async () => {
  const r = await msg('meu código 000000')
  assert.equal(r.resposta ?? '', '')
})
await caso('código válido (cliente que criou a conta no site) continua confirmando o número', async () => {
  const r = await msg(`Meu código Granna Mei: ${CODIGO_VALIDO}`)
  assert.equal(r.status, 'ok')
  assert.match(r.resposta ?? '', /confirmado/)
})
await caso('com GRANNINHA_CONVIDAR=1 o convite volta (prova de que o teste enxerga o convite)', async () => {
  process.env.GRANNINHA_CONVIDAR = '1'
  const r = await msg('oi')
  delete process.env.GRANNINHA_CONVIDAR
  assert.match(r.resposta ?? '', /criar-conta/)
})

db.close()
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
