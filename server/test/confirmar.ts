/**
 * Confirmação do número pelo WhatsApp: o código vale para um número só, tem teto de tentativas,
 * avisa quando erra e diz o que fazer quando o número já é de outra conta.
 * PostgREST falso local, sem banco e sem IA.
 *   npx tsx test/confirmar.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'

const DONO = 'u-dono'
const CODIGO = '482913'
const OUTRO_CODIGO = '111222'
const NUM_CERTO = '5581988887777' // chave 8188887777
const NUM_OUTRO = '5581977776666'

/** O que o banco falso devolve; cada caso ajusta antes de mandar a mensagem. */
const estado = {
  // whats_chave que a pessoa digitou no painel (null = não digitou)
  chaveDoDono: '8188887777' as string | null,
  colisao: false,
  numeroJaEmOutraConta: false,
  clienteDoNumero: null as null | { id: string; nome: string; negocio: string; ramo: string },
  conversas: {} as Record<string, Record<string, unknown>>,
}
const vistos: string[] = []

const db = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const tabela = url.pathname.split('/').pop() ?? ''
  const q = url.search
  const umSo = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const corpoTxt = await new Promise<string>((ok) => {
    let t = ''
    req.on('data', (c) => (t += c))
    req.on('end', () => ok(t))
  })
  vistos.push(`${req.method} ${tabela}${q.slice(0, 80)}`)
  let corpo: unknown = []
  let st = req.method === 'POST' ? 201 : 200

  if (tabela === 'perfis' && req.method === 'GET') {
    if (q.includes('whats_chave=eq.')) corpo = estado.clienteDoNumero ? [estado.clienteDoNumero] : []
    else if (q.includes('id=eq.')) corpo = [{ nome: 'Ana Souza', whats_chave: estado.chaveDoDono }]
  } else if (tabela === 'perfis' && req.method === 'PATCH') {
    if (estado.numeroJaEmOutraConta) {
      res.writeHead(409, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ code: '23505', message: 'duplicate key' }))
    }
    corpo = [{ nome: 'Ana Souza' }]
  } else if (tabela === 'verificacoes' && req.method === 'GET') {
    const pedido = /codigo=eq\.(\d{6})/.exec(q)?.[1]
    if (pedido === CODIGO) corpo = estado.colisao ? [{ user_id: DONO }, { user_id: 'u-outro' }] : [{ user_id: DONO }]
    else if (pedido === OUTRO_CODIGO) corpo = [{ user_id: 'u-outra-conta' }]
  } else if (tabela === 'assinaturas' && req.method === 'GET') {
    corpo = [{ status: 'ativa', trial_fim: '2027-12-31' }]
  } else if (tabela === 'conversas' && req.method === 'GET') {
    const tel = /telefone=eq\.(\d+)/.exec(q)?.[1] ?? ''
    corpo = estado.conversas[tel] ? [{ pendente: estado.conversas[tel] }] : []
  } else if (tabela === 'conversas' && req.method === 'POST') {
    const b = JSON.parse(corpoTxt || '{}') as { telefone: string; pendente: Record<string, unknown> }
    estado.conversas[b.telefone] = b.pendente
    corpo = [b]
  } else if (tabela === 'conversas' && req.method === 'DELETE') {
    const tel = /telefone=eq\.(\d+)/.exec(q)?.[1] ?? ''
    delete estado.conversas[tel]
  } else if (tabela === 'mensagens' && req.method === 'PATCH') {
    // A linha acabou de ser inserida como 'recebida': a trava de "começou" casa com ela.
    corpo = [{ id: /id=eq\.([^&]+)/.exec(q)?.[1] ?? 'm' }]
  }
  const arr = Array.isArray(corpo) ? corpo : [corpo]
  if (umSo) {
    if (!arr.length) {
      res.writeHead(406, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ code: 'PGRST116', message: 'sem linhas' }))
    }
    corpo = arr[0]
    st = 200
  }
  res.writeHead(st, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(corpo))
})
await new Promise<void>((ok) => db.listen(0, '127.0.0.1', ok))
process.env.SUPABASE_URL = `http://127.0.0.1:${(db.address() as AddressInfo).port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'falsa'
process.env.OPENAI_API_KEY = 'falsa'
process.env.PAINEL_URL = 'https://granninha.amplasoft.me/painel'
delete process.env.GRANNINHA_CONVIDAR

const { processar } = await import('../src/granninha.ts')

let seq = 0
const msg = (texto: string, de = NUM_CERTO) =>
  processar({
    event: 'message.received',
    data: { key: { id: `C${Date.now()}${++seq}`, remoteJid: `${de}@s.whatsapp.net`, fromMe: false }, from: `${de}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: texto },
  } as Parameters<typeof processar>[0])

let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  estado.chaveDoDono = '8188887777'
  estado.colisao = false
  estado.numeroJaEmOutraConta = false
  estado.clienteDoNumero = null
  estado.conversas = {}
  try {
    await fn()
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 300))
  }
}

await caso('código certo, vindo do número que a pessoa digitou: confirma', async () => {
  const r = await msg(`Meu código Granninha: ${CODIGO}`)
  assert.equal(r.status, 'ok')
  assert.match(r.resposta ?? '', /confirmado/)
})

await caso('código certo vindo de OUTRO número: não confirma (é o furo de segurança)', async () => {
  const r = await msg(`Meu código Granninha: ${CODIGO}`, NUM_OUTRO)
  assert.notEqual(r.status, 'ok')
  assert.match(r.resposta ?? '', /gerado para outro número/)
  assert.ok(!vistos.some((v) => v.startsWith('PATCH perfis') && vistos.indexOf(v) > vistos.length - 3), 'não grava o número do estranho')
})

await caso('quem não digitou número no painel continua confirmando', async () => {
  estado.chaveDoDono = null
  const r = await msg(`Meu código Granninha: ${CODIGO}`, NUM_OUTRO)
  assert.equal(r.status, 'ok')
})

await caso('erra o código: é avisado, e some depois de 5 tentativas', async () => {
  for (let i = 1; i <= 5; i++) {
    const r = await msg(`meu codigo 00000${i}`)
    assert.match(r.resposta ?? '', /não confere ou já venceu/, `tentativa ${i} deveria responder`)
  }
  const sexta = await msg('meu codigo 999999')
  assert.match(sexta.resposta ?? '', /muitas tentativas/i, 'na 6ª avisa que é para esperar')
  const setima = await msg('meu codigo 888888')
  assert.equal(setima.resposta ?? '', '', 'da 7ª em diante cala de vez')
  const oitava = await msg(`Meu código Granninha: ${CODIGO}`)
  assert.notEqual(oitava.status, 'ok', 'nem o código certo passa enquanto está de castigo')
})

await caso('tentativa errada de um número não afeta outro', async () => {
  for (let i = 1; i <= 5; i++) await msg(`codigo 00000${i}`, NUM_OUTRO)
  estado.chaveDoDono = null
  const r = await msg(`Meu código Granninha: ${CODIGO}`)
  assert.equal(r.status, 'ok')
})

await caso('dois códigos iguais vivos: não confirma nenhum e pede outro', async () => {
  estado.colisao = true
  const r = await msg(`Meu código Granninha: ${CODIGO}`)
  assert.notEqual(r.status, 'ok')
  assert.match(r.resposta ?? '', /Gere um código novo/)
})

await caso('número já confirmado em outra conta: diz o caminho em vez de "fala com a gente"', async () => {
  estado.numeroJaEmOutraConta = true
  const r = await msg(`Meu código Granninha: ${CODIGO}`)
  assert.match(r.resposta ?? '', /já está ligado a outra conta/)
  assert.match(r.resposta ?? '', /troque o número em Ajustes/)
  assert.ok(!/fala com a gente/i.test(r.resposta ?? ''))
})

await caso('cliente mandando código de outra conta dele: explica em vez de virar conversa', async () => {
  estado.clienteDoNumero = { id: DONO, nome: 'Ana', negocio: 'Doces', ramo: 'alimentacao' }
  const r = await msg(OUTRO_CODIGO)
  assert.match(r.resposta ?? '', /já está confirmado nesta conta/)
  assert.match(r.resposta ?? '', /troque o número/)
})

db.close()
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
