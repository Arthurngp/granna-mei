/**
 * Sonda da IA (seg-ia-sonda): descobre a IA parada antes de um cliente ser atingido. O que está travado aqui:
 *  - a chamada mínima é barata (1 mensagem, poucos tokens), usa a chave e o modelo, e classifica cota, chave, limite, queda e erro 400;
 *  - cota zerada e chave inválida viram problema NA HORA e o alerta que já existe (alerta.ts) avisa o dono;
 *  - limite de taxa e queda só viram problema depois de DUAS falhas seguidas (o alerta não oscila entre "parou" e "voltou");
 *  - erro 400 da própria sonda fica no /saude mas NÃO derruba o estado da IA;
 *  - chamada real que deu certo há pouco dispensa a sonda; a sonda não conta como chamada real;
 *  - com a IA em problema sonda a cada 2 minutos e, quando volta, o problema some e o alerta manda "voltou".
 * Sem rede nem custo: a OpenAI é um servidor HTTP local.
 *   npx tsx test/ia-sonda.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

interface Pedido { metodo: string; caminho: string; autorizacao: string; corpo: Record<string, unknown> }
const pedidos: Pedido[] = []
let resposta: { status: number; corpo: unknown } = { status: 200, corpo: { usage: { prompt_tokens: 8, completion_tokens: 5 } } }

const servidor = createServer((req, res) => {
  const partes: Buffer[] = []
  req.on('data', (c) => partes.push(c))
  req.on('end', () => {
    let corpo: Record<string, unknown> = {}
    try {
      corpo = JSON.parse(Buffer.concat(partes).toString() || '{}')
    } catch {
      /* corpo vazio */
    }
    pedidos.push({ metodo: req.method ?? '', caminho: req.url ?? '', autorizacao: String(req.headers.authorization ?? ''), corpo })
    res.writeHead(resposta.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(resposta.corpo))
  })
})
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1`
process.env.OPENAI_API_KEY = 'chave-falsa-de-teste'

const { chamadaMinimaIA } = await import('../src/openai.ts')
const { sondarIA, estadoSonda, zerarSonda, SONDA_CONFIRMAR_MS, SONDA_INTERVALO_MS, SONDA_INTERVALO_FORA_MS } = await import('../src/ia-sonda.ts')
const { estadoIA, zerarEstadoIA, registrarOkIA } = await import('../src/ia-estado.ts')
const { decidirAviso, problemaDe } = await import('../src/alerta.ts')

let ok = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  zerarEstadoIA()
  zerarSonda()
  pedidos.length = 0
  try {
    await fn()
    ok++
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 400))
  }
}

type Chamada = Awaited<ReturnType<typeof chamadaMinimaIA>>
const bem = (entrada = 9, saida = 7): Chamada => ({ ok: true, uso: { entrada, saida } })
const mal = (tipo: 'sem_cota' | 'sem_chave' | 'limite' | 'fora' | 'outro', detalhe = 'x'): Chamada => ({ ok: false, tipo, detalhe })
const roteiro = (...respostas: Chamada[]) => {
  const fila = [...respostas]
  const espera: number[] = []
  return { chamadas: () => respostas.length - fila.length, espera, chamar: async () => fila.shift()!, esperar: async (ms: number) => void espera.push(ms) }
}
const T0 = Date.parse('2026-11-23T03:00:00Z')
const cfg = { alerta_whats: '5581999990000', alerta_ligado: true, alerta_tipo: null as string | null, alerta_em: null as string | null }
const sintomas = () => {
  const e = estadoIA()
  return { iaOk: e.ok, iaProblema: e.problema, iaDesde: e.desde, whatsappEstado: 'CONNECTED' }
}

/* ---------- a chamada de verdade, contra uma OpenAI local ---------- */

await caso('chamada mínima: 1 mensagem curta, poucos tokens, com a chave e o modelo, e devolve o uso medido', async () => {
  resposta = { status: 200, corpo: { usage: { prompt_tokens: 8, completion_tokens: 5 } } }
  const r = await chamadaMinimaIA()
  assert.deepEqual(r, { ok: true, uso: { entrada: 8, saida: 5 } })
  assert.equal(pedidos.length, 1)
  const p = pedidos[0]
  assert.equal(p.metodo, 'POST')
  assert.equal(p.caminho, '/v1/chat/completions')
  assert.equal(p.autorizacao, 'Bearer chave-falsa-de-teste')
  assert.ok(typeof p.corpo.model === 'string' && p.corpo.model, 'manda o modelo')
  assert.ok(Number(p.corpo.max_completion_tokens) > 0 && Number(p.corpo.max_completion_tokens) <= 32, 'poucos tokens de saída (é uma chamada barata)')
  assert.equal((p.corpo.messages as unknown[]).length, 1, 'uma mensagem só')
  assert.equal(p.corpo.response_format, undefined, 'sem esquema: não é uma interpretação de cliente')
})

for (const [status, corpo, tipo] of [
  [429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } }, 'sem_cota'],
  [429, { error: { message: 'Rate limit reached for requests' } }, 'limite'],
  [401, { error: { message: 'Incorrect API key provided' } }, 'sem_chave'],
  [500, { error: { message: 'The server had an error' } }, 'fora'],
  [400, { error: { message: 'Unsupported parameter' } }, 'outro'],
] as [number, unknown, string][]) {
  await caso(`chamada mínima: resposta ${status} (${tipo}) é classificada como ${tipo}`, async () => {
    resposta = { status, corpo }
    const r = await chamadaMinimaIA()
    assert.equal(r.ok, false)
    assert.equal((r as { tipo: string }).tipo, tipo)
  })
}

await caso('chamada mínima: 400 "limite de saída atingido" (o modelo gastou tudo pensando) é IA de pé, não falha da sonda (visto em produção em 24/11)', async () => {
  resposta = { status: 400, corpo: { error: { message: 'Could not finish the message because max_tokens or model output limit was reached. Please try again with higher max_tokens.', type: 'invalid_request_error' } } }
  const r = await chamadaMinimaIA()
  assert.equal(r.ok, true)
  // Mas um 400 de outro tipo continua sendo defeito nosso e aparece no /saude (caso acima, 'Unsupported parameter').
  resposta = { status: 400, corpo: { error: { message: 'Unsupported parameter: max_completion_tokens' } } }
  assert.equal((await chamadaMinimaIA()).ok, false)
})

await caso('chamada mínima: sem a chave da OpenAI vira sem_chave, sem chamar a rede; servidor fora vira fora', async () => {
  const guardada = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  const semChave = await chamadaMinimaIA()
  process.env.OPENAI_API_KEY = guardada
  assert.equal((semChave as { tipo: string }).tipo, 'sem_chave')
  assert.equal(pedidos.length, 0, 'sem chave nem chama')
  servidor.close()
  const fora = await chamadaMinimaIA()
  assert.equal((fora as { tipo: string }).tipo, 'fora')
})

/* ---------- a lógica da sonda ---------- */

await caso('IA bem: a sonda registra ok, mede os tokens e não conta como chamada real', async () => {
  const r = roteiro(bem(9, 7))
  assert.equal(await sondarIA({ agora: T0, chamar: r.chamar, esperar: r.esperar }), 'ok')
  assert.equal(estadoIA().ok, true)
  assert.deepEqual([estadoSonda().resultado, estadoSonda().tokens_entrada, estadoSonda().tokens_saida], ['ok', 9, 7])
  assert.equal(estadoIA().chamadas_ok, 0, 'a sonda não é tráfego de cliente')
  assert.equal(estadoIA().ultimo_ok, null)
})

await caso('cota zerada de madrugada, sem ninguém ter escrito: vira problema NA HORA e o alerta que já existe avisa', async () => {
  const r = roteiro(mal('sem_cota', 'insufficient_quota'))
  assert.equal(await sondarIA({ agora: T0, chamar: r.chamar, esperar: r.esperar }), 'sem_cota')
  assert.equal(estadoIA().ok, false)
  assert.equal(estadoIA().problema, 'sem_cota')
  assert.deepEqual(r.espera, [], 'cota não é soluço: não perde tempo confirmando')
  assert.equal(problemaDe(sintomas())?.tipo, 'ia:sem_cota')
  const d = decidirAviso(cfg, sintomas(), T0)
  assert.equal(d.acao, 'avisar')
  assert.match(d.aviso!.texto, /sem crédito/)
})

await caso('chave inválida: vira problema na hora', async () => {
  const r = roteiro(mal('sem_chave'))
  assert.equal(await sondarIA({ agora: T0, chamar: r.chamar, esperar: r.esperar }), 'sem_chave')
  assert.equal(estadoIA().problema, 'sem_chave')
  assert.deepEqual(r.espera, [])
})

await caso('limite de taxa passageiro: a segunda tentativa dá certo e NÃO vira problema (o alerta não oscila)', async () => {
  const r = roteiro(mal('limite'), bem())
  assert.equal(await sondarIA({ agora: T0, chamar: r.chamar, esperar: r.esperar }), 'ok')
  assert.equal(estadoIA().ok, true)
  assert.deepEqual(r.espera, [SONDA_CONFIRMAR_MS], 'esperou um pouco e tentou de novo')
  assert.equal(r.chamadas(), 2)
  assert.equal(estadoIA().falhas, 0, 'a falha passageira não entra na conta de falhas')
})

await caso('queda que continua na segunda tentativa: vira problema', async () => {
  const r = roteiro(mal('fora'), mal('fora', 'sem resposta'))
  assert.equal(await sondarIA({ agora: T0, chamar: r.chamar, esperar: r.esperar }), 'fora')
  assert.equal(estadoIA().ok, false)
  assert.equal(estadoIA().problema, 'fora')
})

await caso('erro 400 da própria sonda (defeito nosso): fica no /saude mas NÃO derruba a IA', async () => {
  const r = roteiro(mal('outro', 'Unsupported parameter: max_completion_tokens'))
  assert.equal(await sondarIA({ agora: T0, chamar: r.chamar, esperar: r.esperar }), 'outro')
  assert.equal(estadoIA().ok, true, 'a IA não está parada')
  assert.equal(estadoSonda().resultado, 'outro')
  assert.match(estadoSonda().detalhe ?? '', /Unsupported parameter/)
  assert.deepEqual(r.espera, [], 'não confirma: repetir um 400 não adianta')
})

await caso('chamada real que deu certo há pouco dispensa a sonda (não gasta nem uma chamada)', async () => {
  registrarOkIA()
  const r = roteiro(bem())
  assert.equal(await sondarIA({ agora: Date.now(), chamar: r.chamar, esperar: r.esperar }), 'dispensada')
  assert.equal(r.chamadas(), 0)
})

await caso('sem tráfego real há mais de 10 minutos, a sonda roda', async () => {
  registrarOkIA()
  const r = roteiro(bem())
  assert.equal(await sondarIA({ agora: Date.now() + 11 * 60_000, chamar: r.chamar, esperar: r.esperar }), 'ok')
  assert.equal(r.chamadas(), 1)
})

await caso('com a IA bem, a sonda não repete antes de 10 minutos', async () => {
  const r = roteiro(bem(), bem(), bem())
  assert.equal(await sondarIA({ agora: T0, chamar: r.chamar, esperar: r.esperar }), 'ok')
  assert.equal(await sondarIA({ agora: T0 + SONDA_INTERVALO_MS - 1000, chamar: r.chamar, esperar: r.esperar }), 'pulou')
  assert.equal(await sondarIA({ agora: T0 + SONDA_INTERVALO_MS + 1, chamar: r.chamar, esperar: r.esperar }), 'ok')
  assert.equal(r.chamadas(), 2)
})

await caso('IA em problema: sonda a cada 2 minutos; quando volta, o problema some e o alerta manda "voltou"', async () => {
  const r = roteiro(mal('sem_cota'), bem())
  await sondarIA({ agora: T0, chamar: r.chamar, esperar: r.esperar })
  assert.equal(estadoIA().ok, false)
  const avisou = { ...cfg, alerta_tipo: 'ia:sem_cota', alerta_em: new Date(T0).toISOString() }
  assert.equal(decidirAviso(avisou, sintomas(), T0 + 60_000).acao, 'nada', 'já avisado, fica quieto')
  assert.equal(await sondarIA({ agora: T0 + SONDA_INTERVALO_FORA_MS - 1000, chamar: r.chamar, esperar: r.esperar }), 'pulou')
  assert.equal(await sondarIA({ agora: T0 + SONDA_INTERVALO_FORA_MS + 1, chamar: r.chamar, esperar: r.esperar }), 'ok')
  assert.equal(estadoIA().ok, true, 'o crédito voltou')
  assert.equal(decidirAviso(avisou, sintomas(), T0 + 3 * 60_000).acao, 'voltou')
})

console.log(`\n${ok} casos ok${falhas ? `, ${falhas} falha(s)` : ''}`)
process.exit(falhas ? 1 : 0)
