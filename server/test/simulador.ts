/**
 * Simulador de conversa do admin (pedido do Arthur em 2026-11-27): a mensagem entra pelo caminho do webhook e o que sairia para o WhatsApp
 * cai na caixa do simulador. O que este teste prova, com banco e IA falsos:
 *  - só os números fixos do simulador são reconhecidos (comparação exata, nada de prefixo, nada de @lid);
 *  - número do simulador NUNCA chama o gateway, e número real continua chamando (o desvio não pode calar cliente de verdade);
 *  - a conversa de ponta a ponta (lida, digitando, resposta) e a confirmação do código de cadastro funcionam pelo simulador;
 *  - a rota recusa número que não é do simulador antes de mexer em qualquer coisa.
 *   npx tsx test/simulador.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { caso, E, fim } from './_falsos.ts'

/* ---------------- gateway que conta tudo o que chega nele ---------------- */
const chamadas: string[] = []
const wa = createServer((req, res) => {
  chamadas.push(`${req.method} ${req.url}`)
  req.resume()
  if ((req.url ?? '').startsWith('/api/media/')) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    return res.end(Buffer.from('imagem-do-gateway'))
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: true, data: { status: 'CONNECTED', results: [{ exists: true, jid: '5581988887777@s.whatsapp.net' }] } }))
})
await new Promise<void>((ok) => wa.listen(0, '127.0.0.1', ok))
process.env.WA_GATEWAY_URL = `http://127.0.0.1:${(wa.address() as AddressInfo).port}`
process.env.WA_WEBHOOK_SECRET = 'segredo-de-teste'
process.env.SEM_BATIMENTO = '1'
process.env.ENVIO_ESPERA_MS = '0'
process.env.GRANNINHA_ESPERA_MS = '250'
process.env.GRANNINHA_DIGITAR_MS = '60'
process.env.GRANNINHA_LIDA_MS = '10'

const sim = await import('../src/simulador.ts')
const gw = await import('../src/gateway.ts')
const { iniciar, receberDoSimulador } = await import('../src/index.ts')
const { rotaSimulador } = await import('../src/simulador-rotas.ts')
const srv = iniciar(0)
await new Promise<void>((ok) => srv.once('listening', ok))

const N1 = '5500900000001'
const N2 = '5500900000002'
const esperar = async (cond: () => boolean, ms = 4000) => {
  const ate = Date.now() + ms
  while (!cond()) {
    if (Date.now() > ate) throw new Error('tempo esgotado esperando a condição')
    await new Promise((ok) => setTimeout(ok, 20))
  }
}
const contaSim = (id: string, chave: string, verificado: boolean, extra: Record<string, unknown> = {}) => {
  E.tabelas.perfis.push({ id, nome: 'Simulador Teste', negocio: 'Loja', ramo: 'servicos', papel: 'cliente', whats_chave: chave, whats_verificado: verificado, exclusao_em: null, avisos_off: false, ...extra })
  E.tabelas.assinaturas.push({ user_id: id, status: 'trial', trial_fim: '2099-12-31' })
}

await caso('reconhece só os números fixos do simulador, por comparação exata', async () => {
  assert.equal(sim.numeroDoSimulador(N1), N1)
  assert.equal(sim.numeroDoSimulador(`${N1}@s.whatsapp.net`), N1)
  assert.equal(sim.numeroDoSimulador('(00) 90000-0001'), N1)
  for (const fora of ['5581988887777', `${N1}@lid`, `${N1}@g.us`, '55009000000010', '5500900000007', '550090000000', '00900000001@s.whatsapp.net', '', 'abc']) {
    assert.equal(sim.numeroDoSimulador(fora), null, fora)
  }
})

await caso('número do simulador nunca chama o gateway; número real continua chamando', async () => {
  chamadas.length = 0
  await gw.enviarTexto(N1, 'oi do teste')
  await gw.digitando(`${N1}@s.whatsapp.net`, true)
  await gw.digitando(`${N1}@s.whatsapp.net`, false)
  await gw.marcarLidas(`${N1}@s.whatsapp.net`, ['ABC123'])
  await gw.reagir(`${N1}@s.whatsapp.net`, 'ABC123', '👍')
  const c = await gw.conferirNumero(N1)
  assert.deepEqual(c, { existe: true, jid: `${N1}@s.whatsapp.net` })
  assert.equal(chamadas.length, 0, `o gateway foi chamado: ${chamadas.join(' | ')}`)
  const tipos = sim.eventosDoSimulador(N1).map((e) => e.tipo)
  assert.deepEqual(tipos.slice(-5), ['texto', 'digitando', 'parou', 'lida', 'reacao'])

  // Número real: as mesmas seis funções vão ao gateway.
  await gw.enviarTexto('5581988887777', 'oi real')
  await gw.digitando('5581988887777@s.whatsapp.net', true)
  await gw.marcarLidas('5581988887777@s.whatsapp.net', ['ABC123'])
  await gw.reagir('5581988887777@s.whatsapp.net', 'ABC123', '👍')
  await gw.conferirNumero('5581988887777')
  await gw.baixarMidia('/api/media/granninha-FOTO1.jpg')
  assert.equal(chamadas.length, 6, chamadas.join(' | '))
  assert.equal(sim.eventosDoSimulador('5581988887777').length, 0)
  sim.limparCaixaDoSimulador(N1)
})

await caso('mídia do simulador sai da memória; desconhecida dá erro e não cai no gateway', async () => {
  chamadas.length = 0
  const url = sim.guardarMidiaDoSimulador(Buffer.from('bytes-da-foto'), 'image/png', 'png')
  assert.match(url, /^\/api\/media\/[A-Za-z0-9_.-]+$/)
  const m = await gw.baixarMidia(url)
  assert.equal(m.buffer.toString(), 'bytes-da-foto')
  assert.equal(m.mime, 'image/png')
  await assert.rejects(gw.baixarMidia('/api/media/simulador-granninha-' + '0'.repeat(32) + '.png'), /simulador/)
  assert.equal(chamadas.length, 0, chamadas.join(' | '))
})

await caso('conversa pelo simulador segue o caminho do webhook: lida, digitando, resposta, sem tocar no gateway', async () => {
  contaSim('u-sim', '0000000001', true)
  E.tabelas.categorias.push({ user_id: 'u-sim', id: 'vendas', nome: 'Vendas', tipo: 'entrada', pessoal: false }, { user_id: 'u-sim', id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida', pessoal: false })
  E.tabelas.carteiras.push({ user_id: 'u-sim', id: 'banco', nome: 'Conta do banco', tipo: 'banco', saldo_inicial: 120, padrao: true, fechamento: null, vencimento: null, conta_pagamento_id: null })
  chamadas.length = 0
  sim.limparCaixaDoSimulador(N1)
  const { id, evento } = sim.eventoDoSimulador(N1, { tipo: 'texto', texto: 'saldo' })
  assert.equal(await receberDoSimulador(evento as never), 'nova')
  await esperar(() => sim.eventosDoSimulador(N1).some((e) => e.tipo === 'texto'))
  const ev = sim.eventosDoSimulador(N1)
  assert.ok(ev.some((e) => e.tipo === 'lida' && e.ids?.includes(id)), 'sem os tiques azuis')
  assert.ok(ev.some((e) => e.tipo === 'digitando'), 'sem o digitando')
  const resposta = ev.find((e) => e.tipo === 'texto')!.texto ?? ''
  assert.match(resposta, /120/, resposta)
  const linha = E.tabelas.mensagens.find((m) => m.id === id)!
  assert.equal(linha.telefone, N1)
  assert.equal(linha.user_id, 'u-sim')
  assert.notEqual(linha.status, 'recebida')
  assert.equal(chamadas.length, 0, chamadas.join(' | '))
  // A mesma mensagem duas vezes não é atendida duas vezes (mesma trava do webhook).
  assert.equal(await receberDoSimulador(evento as never), 'duplicada')
})

await caso('onboarding: o código do cadastro, mandado pelo simulador, confirma o número da conta de teste', async () => {
  contaSim('u-sim2', '0000000002', false)
  E.tabelas.verificacoes = [{ user_id: 'u-sim2', codigo: '482913', expira_em: new Date(Date.now() + 600_000).toISOString() }]
  sim.limparCaixaDoSimulador(N2)
  chamadas.length = 0
  const { evento } = sim.eventoDoSimulador(N2, { tipo: 'texto', texto: '482913' })
  await receberDoSimulador(evento as never)
  await esperar(() => sim.eventosDoSimulador(N2).some((e) => e.tipo === 'texto'))
  const p = E.tabelas.perfis.find((x) => x.id === 'u-sim2')!
  assert.equal(p.whats_verificado, true, 'o número não foi confirmado')
  assert.equal(p.whats, '(00) 90000-0002')
  assert.equal((E.tabelas.verificacoes ?? []).length, 0, 'o código não saiu')
  assert.ok((sim.eventosDoSimulador(N2).find((e) => e.tipo === 'texto')!.texto ?? '').length > 10)
  assert.equal(chamadas.length, 0, chamadas.join(' | '))
})

await caso('a rota recusa número que não é do simulador, antes de mexer em qualquer coisa', async () => {
  let recebeu = 0
  const receber = (async () => {
    recebeu++
    return 'nova'
  }) as never
  for (const rota of ['/admin/simulador/enviar', '/admin/simulador/zerar', '/admin/simulador/conta', '/admin/simulador/codigo']) {
    for (const numero of ['5581988887777', `${N1}@lid`, '']) {
      const r = await rotaSimulador('POST', rota, new URLSearchParams(), async () => JSON.stringify({ numero, tipo: 'texto', texto: 'oi' }), 'admin-1', receber)
      assert.equal(r?.status, 400, `${rota} ${numero}`)
    }
  }
  const g = await rotaSimulador('GET', '/admin/simulador/conversa', new URLSearchParams({ numero: '5581988887777' }), async () => '', 'admin-1', receber)
  assert.equal(g?.status, 400)
  assert.equal(recebeu, 0)
  // Com o número certo, a rota entrega ao caminho do webhook um evento do número do simulador.
  let ultimo: { data?: { from?: string; type?: string; content?: string } } | null = null
  const r = await rotaSimulador('POST', '/admin/simulador/enviar', new URLSearchParams(), async () => JSON.stringify({ numero: N1, tipo: 'texto', texto: 'gastei 30 de gasolina' }), 'admin-1', (async (ev: typeof ultimo) => {
    ultimo = ev
    return 'nova'
  }) as never)
  assert.equal(r?.status, 200)
  assert.equal(ultimo!.data?.from, `${N1}@s.whatsapp.net`)
  assert.equal(ultimo!.data?.type, 'TEXT')
  assert.equal(ultimo!.data?.content, 'gastei 30 de gasolina')
  assert.equal(await rotaSimulador('GET', '/admin/outra', new URLSearchParams(), async () => '', 'admin-1', receber), null)
})

srv.close()
wa.close()
fim()
