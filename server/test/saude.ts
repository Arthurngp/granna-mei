/**
 * /saude só entrega o detalhe para quem tem a chave. Sobe o servidor de verdade
 * com um PostgREST falso, sem banco e sem IA.
 *   npx tsx test/saude.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'

const db = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' })
  res.end('[]')
})
await new Promise<void>((ok) => db.listen(0, '127.0.0.1', ok))
process.env.SUPABASE_URL = `http://127.0.0.1:${(db.address() as AddressInfo).port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'falsa'
process.env.OPENAI_API_KEY = 'falsa'
process.env.WA_URL = 'http://127.0.0.1:1'
process.env.WA_SESSAO = 'teste'
process.env.WEBHOOK_SEGREDO = 'falso'
process.env.SEM_BATIMENTO = '1' // nada de batimento nem de varredura de exclusão no teste
process.env.SAUDE_CHAVE = 'chave-de-teste'

process.env.GRANNINHA_ESPERA_MS ??= '0' // a espera da rajada tem teste próprio (test/rajada.ts)
const { iniciar } = await import('../src/index.ts')
const srv = iniciar(0)
await new Promise<void>((ok) => srv.once('listening', ok))
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`

const pegar = async (caminho: string, headers: Record<string, string> = {}) => {
  const r = await fetch(base + caminho, { headers })
  return { st: r.status, corpo: (await r.json()) as Record<string, unknown> }
}

// Sem chave: diz que está de pé e nada mais. Nenhum número, nenhum volume.
{
  const { st, corpo } = await pegar('/saude')
  assert.equal(st, 200, 'continua respondendo 200 para o healthcheck')
  assert.deepEqual(corpo, { ok: true })
  assert.ok(!('whatsapp' in corpo) && !('mensagens_24h' in corpo), 'não vaza número nem volume')
}
// Chave errada: igual a sem chave.
{
  const { corpo } = await pegar('/saude', { Authorization: 'Bearer errada' })
  assert.deepEqual(corpo, { ok: true })
}
// Chave certa, no cabeçalho: vem o detalhe.
{
  const { corpo } = await pegar('/saude', { Authorization: 'Bearer chave-de-teste' })
  assert.ok('whatsapp' in corpo, 'com a chave vem o estado do WhatsApp')
  assert.ok('mensagens_24h' in corpo)
  // O estado da IA entra aqui porque é o que faltava em 19/11: a chave da OpenAI ficou sem cota, a
  // Granninha ficou muda para todos os clientes e nada avisou ninguém.
  const estadoIa = corpo.ia as Record<string, unknown>
  assert.ok(estadoIa, 'o /saude conta o estado da IA')
  assert.equal(estadoIa.ok, true, 'sem falha conhecida, diz que está ok')
  for (const campo of ['problema', 'desde', 'ultima_falha', 'ultimo_ok', 'falhas']) {
    assert.ok(campo in estadoIa, 'o monitoramento precisa do campo ' + campo)
  }
  // Os avisos de conta vencendo (fase f4) começam desligados, e o /saude diz isso sem vazar número nem conta.
  const avisos = corpo.avisos as Record<string, unknown>
  assert.ok(avisos, 'o /saude conta o estado dos avisos')
  assert.equal(avisos.modo, 'off', 'desligado por padrão')
  for (const campo of ['ultimo_ciclo', 'enviados_desde_inicio', 'falhas_desde_inicio', 'ultimo_erro']) {
    assert.ok(campo in avisos, 'o monitoramento precisa do campo ' + campo)
  }
  assert.ok(!/\d{10,}/.test(JSON.stringify(avisos)), 'nenhum número de telefone no estado dos avisos')
}
// Chave certa na URL (o N8N às vezes só manda query).
{
  const { corpo } = await pegar('/saude?chave=chave-de-teste')
  assert.ok('whatsapp' in corpo)
}
// Sem SAUDE_CHAVE definida, ninguém vê o detalhe (fecha por padrão).
{
  delete process.env.SAUDE_CHAVE
  const { corpo } = await pegar('/saude?chave=')
  assert.deepEqual(corpo, { ok: true })
  const vazio = await pegar('/saude', { Authorization: 'Bearer ' })
  assert.deepEqual(vazio.corpo, { ok: true })
}

srv.close()
db.close()
console.log('saude: ok')
