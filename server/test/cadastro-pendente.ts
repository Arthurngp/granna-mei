/**
 * Quem DIGITOU o número no cadastro e não confirmou (sem banco real, sem IA).
 *
 * O admin agora pode chamar essa pessoa pelo número da Granninha, e a mensagem termina com "responda SAIR". O que está em jogo aqui:
 *   - o SAIR dela tem de ser gravado, mesmo ela não sendo cliente reconhecida (antes caía no silêncio e ela seguiria recebendo);
 *   - se ela responder qualquer outra coisa, recebe o caminho para terminar o cadastro, no máximo uma vez por dia;
 *   - um estranho de verdade (número que ninguém digitou) continua sem resposta nenhuma, inclusive mandando SAIR.
 * Sobe um PostgREST falso local e chama processar() direto.
 *   npx tsx test/cadastro-pendente.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'

interface Pendente {
  id: string
  nome: string
  avisos_off: boolean
}
const E = {
  pendentes: [] as Pendente[],
  conversa: null as null | { telefone: string; pendente: Record<string, unknown> },
  silenciados: [] as string[],
  falharSilenciar: false,
  consultasPendentes: 0,
}
function zerar() {
  E.pendentes = []
  E.conversa = null
  E.silenciados = []
  E.falharSilenciar = false
  E.consultasPendentes = 0
}

const db = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const tabela = url.pathname.split('/').pop()
  const busca = decodeURIComponent(url.search)
  const umSo = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  let pedaco = ''
  req.on('data', (c) => (pedaco += c))
  req.on('end', () => {
    let corpo: unknown = []
    if (req.method === 'GET' && tabela === 'perfis' && busca.includes('whats_verificado=eq.false')) {
      E.consultasPendentes++
      // Só devolve quem digitou ESTE número: a chave vem na consulta (DDD + 8 últimos dígitos).
      corpo = busca.includes('whats_chave=eq.8188887777') ? E.pendentes : []
    }
    if (req.method === 'PATCH' && tabela === 'perfis' && pedaco.includes('avisos_off')) {
      if (E.falharSilenciar) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ message: 'banco fora' }))
      }
      E.silenciados.push(/id=eq\.([^&]+)/.exec(busca)?.[1] ?? '?')
    }
    if (req.method === 'GET' && tabela === 'conversas' && E.conversa) corpo = [E.conversa]
    if (req.method === 'POST' && tabela === 'conversas') {
      const l = JSON.parse(pedaco || '{}') as { telefone: string; pendente: Record<string, unknown> } | { telefone: string; pendente: Record<string, unknown> }[]
      E.conversa = Array.isArray(l) ? l[0] : l
    }
    // A linha nasce 'recebida': a trava de "começou" (granninha.ts) casa com ela e devolve o id.
    if (req.method === 'PATCH' && tabela === 'mensagens') corpo = [{ id: /id=eq\.([^&]+)/.exec(busca)?.[1] ?? 'm' }]
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
})
await new Promise<void>((ok) => db.listen(0, '127.0.0.1', ok))
process.env.SUPABASE_URL = `http://127.0.0.1:${(db.address() as AddressInfo).port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'falsa'
process.env.OPENAI_API_KEY = 'falsa'
process.env.PAINEL_URL = 'https://granninha.com.br/painel'
delete process.env.GRANNINHA_CONVIDAR

const { processar } = await import('../src/granninha.ts')
const { MSG } = await import('../src/voz.ts')

let seq = 0
const msg = (texto: string, de = '5581988887777') =>
  processar({
    event: 'message.received',
    data: { key: { id: `PEN${Date.now()}${++seq}`, remoteJid: `${de}@s.whatsapp.net`, fromMe: false }, from: `${de}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: texto },
  } as Parameters<typeof processar>[0])

let ok = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  zerar()
  try {
    await fn()
    ok++
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 400))
  }
}
const camila: Pendente = { id: 'u-camila', nome: 'Camila Souza', avisos_off: false }

await caso('SAIR de quem digitou o número e não confirmou é GRAVADO e respondido (não cai no silêncio)', async () => {
  E.pendentes = [camila]
  const r = await msg('Sair.')
  assert.deepEqual(E.silenciados, ['u-camila'])
  assert.equal(r.resposta, MSG.sairSemConfirmar)
})

await caso('o mesmo número em duas contas não confirmadas: o SAIR vale para as duas', async () => {
  E.pendentes = [camila, { id: 'u-camila-2', nome: 'Camila', avisos_off: false }]
  await msg('SAIR')
  assert.deepEqual(E.silenciados.sort(), ['u-camila', 'u-camila-2'])
})

await caso('não conseguiu gravar o SAIR: não responde "pronto" (vira erro, nunca um falso sim)', async () => {
  E.pendentes = [camila]
  E.falharSilenciar = true
  const r = await msg('sair')
  assert.notEqual(r.resposta, MSG.sairSemConfirmar)
  assert.equal(r.status, 'erro')
})

await caso('SAIR de um estranho (número que ninguém digitou) continua sem resposta e sem gravar nada', async () => {
  E.pendentes = [camila]
  const r = await msg('sair', '5511977776666')
  assert.equal(r.resposta ?? '', '')
  assert.deepEqual(E.silenciados, [])
})

await caso('quem ficou no meio do cadastro e escreve recebe o caminho para terminar, com o primeiro nome e o endereço do painel', async () => {
  E.pendentes = [camila]
  const r = await msg('oi, como eu faço?')
  assert.equal(r.resposta, MSG.terminarCadastro('Camila', 'https://granninha.com.br/painel'))
  assert.match(r.resposta ?? '', /código de 6 números/)
  assert.ok(E.conversa?.pendente.link_em, 'guarda quando respondeu, para não repetir')
  assert.equal(r.status, 'ignorada', 'não vira uso nem lançamento')
})

await caso('no máximo uma vez por dia: a segunda mensagem no mesmo dia fica sem resposta', async () => {
  E.pendentes = [camila]
  E.conversa = { telefone: '5581988887777', pendente: { link_em: new Date(Date.now() - 3 * 3600_000).toISOString() } }
  const r = await msg('alô?')
  assert.equal(r.resposta ?? '', '')
})

await caso('passadas 24 horas, responde de novo', async () => {
  E.pendentes = [camila]
  E.conversa = { telefone: '5581988887777', pendente: { link_em: new Date(Date.now() - 25 * 3600_000).toISOString() } }
  const r = await msg('oi')
  assert.match(r.resposta ?? '', /continua o cadastro/)
})

await caso('quem já pediu SAIR e escreve de novo sem confirmar segue no silêncio', async () => {
  E.pendentes = [{ ...camila, avisos_off: true }]
  const r = await msg('oi')
  assert.equal(r.resposta ?? '', '')
})

await caso('estranho de verdade continua sem resposta nenhuma (o silêncio para quem não é cliente não mudou)', async () => {
  E.pendentes = [camila]
  const r = await msg('oi, quero saber da granninha', '5511977776666')
  assert.equal(r.status, 'ignorada')
  assert.equal(r.resposta ?? '', '')
  assert.ok(E.consultasPendentes >= 1, 'o teste só vale se a consulta de pendentes foi feita e veio vazia')
})

await caso('código errado de quem está pendente continua recebendo o aviso de código (o caminho da confirmação não mudou)', async () => {
  E.pendentes = [camila]
  const r = await msg('meu código 000000')
  assert.match(r.resposta ?? '', /não confere ou já venceu/)
})

await caso('as duas mensagens novas seguem a voz: sem emoji, sem travessão e sem a palavra SAIR onde ela confundiria', async () => {
  for (const t of [MSG.terminarCadastro('Camila', 'https://granninha.com.br/painel'), MSG.sairSemConfirmar]) {
    assert.doesNotMatch(t, /[—–]/)
    assert.doesNotMatch(t, /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}]/u)
  }
  assert.doesNotMatch(MSG.terminarCadastro('', 'x'), /Oi, !/, 'sem nome, não sobra vírgula solta')
})

db.close()
console.log(falhas ? `\n${ok} ok, ${falhas} falha(s)` : `\n${ok} ok, tudo certo`)
process.exit(falhas ? 1 : 0)
