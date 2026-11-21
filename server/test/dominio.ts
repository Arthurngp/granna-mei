/**
 * O domínio próprio (granninha.com.br) entrou em 2026-11-21 sem derrubar nenhum dos antigos: o admin servido
 * em qualquer um deles tem que conseguir falar com a API (CORS), e uma origem de fora continua barrada.
 * Sem banco e sem IA. Rodar: npx tsx test/dominio.ts
 */
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'http://127.0.0.1:1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'falsa'
delete process.env.ADMIN_ORIGENS
const { rotaAdmin } = await import('../src/admin.ts')

async function preflight(origem: string | undefined) {
  const cab: Record<string, string> = {}
  let status = 0
  const req = { method: 'OPTIONS', headers: origem ? { origin: origem } : {} } as never
  const res = {
    setHeader: (k: string, v: string) => void (cab[k.toLowerCase()] = v),
    writeHead(st: number) {
      status = st
      return this
    },
    end() {},
  } as never
  const tratou = await rotaAdmin(req, res, '/admin/alerta', async () => '')
  return { tratou, status, permitida: cab['access-control-allow-origin'] }
}

let n = 0
const caso = async (nome: string, fn: () => Promise<void>) => {
  await fn()
  n++
  console.log('  ok', nome)
}

for (const origem of ['https://granninha.com.br', 'https://www.granninha.com.br', 'https://granninha.amplasoft.me', 'https://grannamei.amplasoft.me']) {
  await caso('admin aceita a origem ' + origem, async () => {
    const r = await preflight(origem)
    assert.equal(r.tratou, true)
    assert.equal(r.status, 204)
    assert.equal(r.permitida, origem, 'o navegador bloquearia o admin por CORS')
  })
}
for (const origem of ['https://granninha.com.br.golpe.com', 'https://meugranninha.com.br', 'http://granninha.com.br', 'https://outra.com']) {
  await caso('admin barra a origem ' + origem, async () => {
    const r = await preflight(origem)
    assert.equal(r.permitida, undefined, 'não pode liberar origem de fora')
  })
}
await caso('sem cabeçalho Origin não libera nada', async () => {
  assert.equal((await preflight(undefined)).permitida, undefined)
})

console.log('dominio: ' + n + ' casos ok')
