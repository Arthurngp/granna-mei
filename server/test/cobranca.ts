/**
 * Cobrança pela Stripe: as regras de acesso e o fluxo completo (abrir pagamento, webhook, carência, exclusão).
 * Sem rede, sem IA, sem banco: Stripe e Supabase são falsos. O webhook é assinado de verdade com o segredo do teste,
 * então a verificação de assinatura é a real.
 *   npx tsx test/cobranca.ts
 *
 * O que está travado aqui (cada um custaria um cliente):
 *  - assinar durante a oferta NÃO pode trancar o cliente para fora em 01/01 (trialing vira ativa, não trial);
 *  - cobrar só depois do último dia grátis, e nunca antes da data prometida;
 *  - fatura de R$ 0 não derruba o webhook; fatura repetida não duplica;
 *  - aviso atrasado de assinatura velha não bloqueia quem já assinou de novo;
 *  - cortesia do admin nunca é sobrescrita;
 *  - conta excluída tem a assinatura cancelada na Stripe antes.
 */
export {}

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa'
process.env.STRIPE_SECRET_KEY = 'sk_test_falsa'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_teste'

const { sb } = await import('../src/banco.ts')
const regras = await import('../src/cobranca-regras.ts')
const { rotaCobranca, bloquearAtrasadas } = await import('../src/cobranca.ts')
const { stripe, trocarStripeParaTeste, cancelarAssinaturaDe } = await import('../src/cobranca-stripe.ts')
const { dataSP, mapear, trialEndDoCheckout, linhaDeFatura, MIN_TRIAL_MS } = regras

let n = 0
let falhou = 0
const caso = async (nome: string, fn: () => void | Promise<void>) => {
  try {
    await fn()
    n++
    console.log('  ok  ', nome)
  } catch (e) {
    falhou++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 300))
  }
}

const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)
const AGORA = new Date('2026-11-21T15:00:00Z')
const base = { status: 'trial', trial_fim: '2026-12-31', atrasada_desde: null as string | null }
const sub = (o: Partial<Parameters<typeof mapear>[0]> = {}) => ({
  status: 'active', intervalo: 'month' as const, trial_end: null, periodo_fim: ts('2026-12-21T12:00:00Z'), cancela_no_fim: false, cancel_at: null, ...o,
})

// ─────────────── regras puras ───────────────

await caso('dia de São Paulo, não o de UTC: 23h do dia 31 em SP ainda é dia 31', () => {
  assert.equal(dataSP(ts('2027-01-01T02:00:00Z')), '2026-12-31')
  assert.equal(dataSP(ts('2027-01-01T03:00:00Z')), '2027-01-01')
})

await caso('trialing vira ATIVA (nunca trial): senão o trial_fim vencido tranca o cliente em 01/01', () => {
  const m = mapear(sub({ status: 'trialing', trial_end: ts('2027-01-01T03:00:00Z') }), base, AGORA)!
  assert.equal(m.status, 'ativa')
  assert.equal(m.prox_cobranca, '2027-01-01')
  assert.equal(m.plano, 'mensal')
})

await caso('active anual: ativa, plano anual, próxima cobrança no fim do período', () => {
  const m = mapear(sub({ intervalo: 'year', periodo_fim: ts('2027-11-21T12:00:00Z') }), { ...base, status: 'ativa' }, AGORA)!
  assert.deepEqual([m.status, m.plano, m.prox_cobranca, m.atrasada_desde], ['ativa', 'anual', '2027-11-21', null])
})

await caso('past_due: atrasada e começa a contar a carência; aviso repetido NÃO reinicia a contagem', () => {
  const a = mapear(sub({ status: 'past_due' }), { ...base, status: 'ativa' }, AGORA)!
  assert.equal(a.status, 'atrasada')
  assert.equal(a.atrasada_desde, AGORA.toISOString())
  const antes = '2026-11-20T10:00:00.000Z'
  const b = mapear(sub({ status: 'past_due' }), { ...base, status: 'atrasada', atrasada_desde: antes }, AGORA)!
  assert.equal(b.atrasada_desde, antes)
})

await caso('past_due depois de a carência já ter bloqueado: continua bloqueada (não pisca o acesso)', () => {
  const m = mapear(sub({ status: 'past_due' }), { ...base, status: 'bloqueada', atrasada_desde: '2026-11-19T10:00:00.000Z' }, AGORA)!
  assert.equal(m.status, 'bloqueada')
})

await caso('pagou depois de atrasar: volta a ativa e zera a carência', () => {
  const m = mapear(sub(), { ...base, status: 'bloqueada', atrasada_desde: '2026-11-19T10:00:00.000Z' }, AGORA)!
  assert.deepEqual([m.status, m.atrasada_desde], ['ativa', null])
})

await caso('cancelou no meio do teste grátis: volta para o trial que foi prometido, não bloqueia', () => {
  const m = mapear(sub({ status: 'canceled' }), { ...base, status: 'ativa' }, AGORA)!
  assert.equal(m.status, 'trial')
  assert.equal(m.prox_cobranca, '2026-12-31')
})

await caso('cancelada/unpaid com o teste já vencido: bloqueada', () => {
  for (const status of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
    const m = mapear(sub({ status }), { ...base, trial_fim: '2026-11-01', status: 'ativa' }, AGORA)!
    assert.equal(m.status, 'bloqueada', status)
  }
})

await caso('cortesia do admin nunca é sobrescrita pela Stripe', () => {
  for (const status of ['active', 'past_due', 'canceled', 'trialing']) assert.equal(mapear(sub({ status }), { ...base, status: 'cortesia' }, AGORA), null)
})

await caso('incomplete e status desconhecido: não mexe em nada', () => {
  assert.equal(mapear(sub({ status: 'incomplete' }), base, AGORA), null)
  assert.equal(mapear(sub({ status: 'qualquer-coisa-nova' }), base, AGORA), null)
})

await caso('pediu para cancelar: segue ativa e guarda até quando vale', () => {
  const m = mapear(sub({ cancela_no_fim: true, cancel_at: ts('2026-12-21T12:00:00Z') }), { ...base, status: 'ativa' }, AGORA)!
  assert.deepEqual([m.status, m.cancela_em], ['ativa', '2026-12-21'])
})

await caso('primeira cobrança: 00:00 de São Paulo do dia seguinte ao último dia grátis', () => {
  const t = trialEndDoCheckout(base, AGORA)!
  assert.equal(t, ts('2027-01-01T03:00:00Z'))
})

await caso('perto do fim da oferta (menos de 49h): adia para o mínimo, nunca cobra ANTES do prometido', () => {
  const agora = new Date('2026-12-30T12:00:00Z')
  const t = trialEndDoCheckout(base, agora)!
  assert.ok(t >= ts('2027-01-01T03:00:00Z'), 'não pode ser antes de 01/01')
  assert.ok(t * 1000 - agora.getTime() >= MIN_TRIAL_MS - 1000, 'respeita o mínimo da Stripe')
})

await caso('teste vencido, bloqueada ou já assinante: cobra já (sem trial_end)', () => {
  assert.equal(trialEndDoCheckout({ status: 'trial', trial_fim: '2026-11-01' }, AGORA), undefined)
  assert.equal(trialEndDoCheckout({ status: 'bloqueada', trial_fim: '2026-12-31' }, AGORA), undefined)
  assert.equal(trialEndDoCheckout({ status: 'ativa', trial_fim: '2026-12-31' }, AGORA), undefined)
})

await caso('fatura de R$ 0 não vira linha; fatura paga vira, em reais e no dia de SP', () => {
  assert.equal(linhaDeFatura({ id: 'in_0', amount_paid: 0, paid_at: null, created: ts('2026-12-01T12:00:00Z') }), null)
  assert.deepEqual(linhaDeFatura({ id: 'in_1', amount_paid: 2990, paid_at: ts('2027-01-01T02:30:00Z'), created: ts('2027-01-01T02:00:00Z') }), {
    data: '2026-12-31', valor: 29.9, status: 'paga', stripe_invoice_id: 'in_1',
  })
})

// ─────────────── fluxo: banco e Stripe falsos ───────────────

type Linha = Record<string, any>
const tabelas: Record<string, Linha[]> = {}
function de(t: string) {
  let op: 'select' | 'update' | 'upsert' = 'select'
  let patch: Linha = {}
  let linhaUp: Linha = {}
  let conflito = ''
  let devolve = false
  let uma = false
  const filtros: ((r: Linha) => boolean)[] = []
  const executar = () => {
    const linhas = (tabelas[t] ??= [])
    if (op === 'upsert') {
      const ex = linhas.find((r) => r[conflito] === linhaUp[conflito])
      if (ex) Object.assign(ex, linhaUp)
      else linhas.push({ ...linhaUp })
      return { data: null, error: null }
    }
    const alvo = linhas.filter((r) => filtros.every((f) => f(r)))
    if (op === 'update') {
      for (const r of alvo) Object.assign(r, patch)
      return { data: devolve ? alvo.map((r) => ({ ...r })) : null, error: null }
    }
    return { data: uma ? (alvo[0] ? { ...alvo[0] } : null) : alvo.map((r) => ({ ...r })), error: null }
  }
  const b: any = {
    select: () => ((devolve = true), b),
    eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), b),
    lt: (c: string, v: string) => (filtros.push((r) => r[c] != null && r[c] < v), b),
    maybeSingle: () => ((uma = true), Promise.resolve(executar())),
    update: (p: Linha) => ((op = 'update'), (patch = p), b),
    upsert: (l: Linha, o: { onConflict: string }) => ((op = 'upsert'), (linhaUp = l), (conflito = o.onConflict), b),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, ko),
  }
  return b
}
;(sb as any).from = de
;(sb.auth as any).getUser = async (t: string) =>
  t === 'token-ana' ? { data: { user: { id: 'u-1', email: 'ana@exemplo.com' } }, error: null } : { data: { user: null }, error: { message: 'token inválido' } }

const dias = (d: number) => dataSP(Math.floor(Date.now() / 1000) + d * 86400)
function zerar(a: Linha = {}) {
  tabelas.assinaturas = [{ user_id: 'u-1', status: 'trial', trial_fim: dias(20), atrasada_desde: null, stripe_customer_id: null, stripe_subscription_id: null, plano: 'mensal', ...a }]
  tabelas.faturas = []
  tabelas.perfis = [{ id: 'u-1', nome: 'João da Padaria' }]
}

const subs: Record<string, Linha> = {}
const chamadas = { customers: [] as Linha[], sessoes: [] as Linha[], portais: [] as Linha[], canceladas: [] as string[] }
const s = stripe()!
const sub1 = (o: Linha = {}) => ({
  id: 'sub_1', status: 'trialing', customer: 'cus_1', metadata: { user_id: 'u-1' }, trial_end: ts('2027-01-01T03:00:00Z'), cancel_at_period_end: false, cancel_at: null,
  items: { data: [{ current_period_end: ts('2027-02-01T03:00:00Z'), price: { lookup_key: 'granninha_mensal', recurring: { interval: 'month' } } }] }, ...o,
})
;(s.subscriptions as any).retrieve = async (id: string) => {
  if (!subs[id]) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing', statusCode: 404 })
  return structuredClone(subs[id])
}
;(s.subscriptions as any).cancel = async (id: string) => {
  chamadas.canceladas.push(id)
  subs[id].status = 'canceled'
  return subs[id]
}
;(s.prices as any).list = async () => ({ data: [{ id: 'price_mensal', currency: 'brl', type: 'recurring' }] })
;(s.customers as any).create = async (p: Linha) => (chamadas.customers.push(p), { id: 'cus_1' })
;(s.checkout.sessions as any).create = async (p: Linha) => (chamadas.sessoes.push(p), { url: 'https://checkout.stripe.test/s1' })
;(s.billingPortal.sessions as any).create = async (p: Linha) => (chamadas.portais.push(p), { url: 'https://portal.stripe.test/p1' })

const srv = createServer((req, res) => {
  void rotaCobranca(req, res, new URL(req.url ?? '/', 'http://x').pathname).then((ok) => ok || res.writeHead(404).end())
})
await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
const URL_BASE = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`

const abrir = (plano?: string, token = 'token-ana', origin?: string) =>
  fetch(URL_BASE + '/cobranca/abrir', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ plano }) })

let seq = 0
async function webhook(tipo: string, objeto: Linha, segredo = 'whsec_teste') {
  const ev = { id: `evt_${++seq}`, object: 'event', type: tipo, data: { object: objeto } }
  const payload = JSON.stringify(ev)
  const header = s.webhooks.generateTestHeaderString({ payload, secret: segredo })
  return fetch(URL_BASE + '/cobranca/webhook', { method: 'POST', headers: { 'stripe-signature': header, 'Content-Type': 'application/json' }, body: payload })
}

await caso('abrir (teste grátis): Checkout com trial_end depois do último dia grátis, dono no metadata, e cliente criado uma vez', async () => {
  zerar()
  const r = await abrir('mensal', 'token-ana', 'https://granninha.com.br')
  assert.equal(r.status, 200)
  const j = (await r.json()) as { url: string; tipo: string }
  assert.deepEqual([j.tipo, j.url], ['checkout', 'https://checkout.stripe.test/s1'])
  const c = chamadas.sessoes.at(-1)!
  assert.equal(c.mode, 'subscription')
  assert.equal(c.client_reference_id, 'u-1')
  assert.equal(c.subscription_data.metadata.user_id, 'u-1')
  const dia = new Date(tabelas.assinaturas[0].trial_fim + 'T12:00:00Z')
  dia.setUTCDate(dia.getUTCDate() + 1)
  const primeiroDiaPago = new Date(`${dia.toISOString().slice(0, 10)}T00:00:00-03:00`).getTime() / 1000
  assert.ok(c.subscription_data.trial_end >= primeiroDiaPago, 'não cobra antes do fim do teste')
  assert.equal(c.success_url, 'https://granninha.com.br/painel/ajustes/assinatura?pagamento=ok', 'volta para o domínio de onde veio')
  assert.equal(tabelas.assinaturas[0].stripe_customer_id, 'cus_1')
  assert.equal(chamadas.customers.at(-1)!.metadata.user_id, 'u-1')
})

await caso('abrir de domínio que não é nosso: não deixa a Stripe devolver o cliente para lá', async () => {
  zerar()
  await abrir('mensal', 'token-ana', 'https://site-de-golpe.com')
  assert.ok(!String(chamadas.sessoes.at(-1)!.success_url).includes('golpe'))
})

await caso('abrir com teste vencido: cobra já (sem trial_end)', async () => {
  zerar({ status: 'bloqueada', trial_fim: dias(-3) })
  await abrir('anual')
  assert.equal(chamadas.sessoes.at(-1)!.subscription_data.trial_end, undefined)
})

await caso('abrir sem estar logada: 401 com mensagem (o painel não desloga por isso)', async () => {
  const r = await abrir('mensal', 'token-errado')
  assert.equal(r.status, 401)
  assert.ok(((await r.json()) as { erro: string }).erro.length > 5)
})

await caso('abrir quem já assina: leva ao portal e NÃO cria segunda assinatura', async () => {
  zerar({ status: 'ativa', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' })
  subs.sub_1 = sub1({ status: 'active' })
  const antes = chamadas.sessoes.length
  const j = (await (await abrir('mensal')).json()) as { tipo: string; url: string }
  assert.equal(j.tipo, 'portal')
  assert.equal(chamadas.sessoes.length, antes, 'nenhum Checkout novo')
})

await caso('abrir em atraso: leva direto à fatura em aberto para pagar', async () => {
  zerar({ status: 'atrasada', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' })
  subs.sub_1 = sub1({ status: 'past_due', latest_invoice: { status: 'open', hosted_invoice_url: 'https://invoice.stripe.test/i1' } })
  const j = (await (await abrir('mensal')).json()) as { tipo: string; url: string }
  assert.deepEqual([j.tipo, j.url], ['fatura', 'https://invoice.stripe.test/i1'])
})

await caso('abrir com conta em cortesia: 409, não deixa pagar sem querer', async () => {
  zerar({ status: 'cortesia' })
  assert.equal((await abrir('mensal')).status, 409)
})

await caso('webhook com assinatura errada: 400 e nada gravado', async () => {
  zerar()
  subs.sub_1 = sub1()
  const r = await webhook('customer.subscription.created', subs.sub_1, 'whsec_de_outro')
  assert.equal(r.status, 400)
  assert.equal(tabelas.assinaturas[0].status, 'trial')
})

await caso('webhook: assinou durante a oferta -> ATIVA, com os ids, a data da primeira cobrança e o plano', async () => {
  zerar()
  subs.sub_1 = sub1()
  const r = await webhook('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', client_reference_id: 'u-1', metadata: { user_id: 'u-1' } })
  assert.equal(r.status, 200)
  const a = tabelas.assinaturas[0]
  assert.deepEqual([a.status, a.stripe_subscription_id, a.stripe_customer_id, a.prox_cobranca, a.plano], ['ativa', 'sub_1', 'cus_1', '2027-01-01', 'mensal'])
})

await caso('webhook com acento no corpo (João) passa na verificação de assinatura', async () => {
  zerar()
  subs.sub_1 = sub1({ metadata: { user_id: 'u-1', nome: 'João Conceição Ñandú' } })
  assert.equal((await webhook('customer.subscription.updated', subs.sub_1)).status, 200)
  assert.equal(tabelas.assinaturas[0].status, 'ativa')
})

await caso('fatura de R$ 0 do início do teste: 200 e nenhuma linha em faturas (não derruba o webhook)', async () => {
  zerar()
  subs.sub_1 = sub1()
  const r = await webhook('invoice.paid', { id: 'in_zero', amount_paid: 0, created: ts('2026-11-21T12:00:00Z'), status_transitions: {}, parent: { subscription_details: { subscription: 'sub_1' } } })
  assert.equal(r.status, 200)
  assert.equal(tabelas.faturas.length, 0)
})

await caso('fatura paga: grava uma linha; o mesmo aviso de novo NÃO duplica', async () => {
  zerar()
  subs.sub_1 = sub1({ status: 'active', trial_end: null })
  const inv = { id: 'in_1', amount_paid: 2990, created: ts('2027-01-01T03:00:00Z'), status_transitions: { paid_at: ts('2027-01-01T03:05:00Z') }, parent: { subscription_details: { subscription: 'sub_1' } } }
  await webhook('invoice.paid', inv)
  await webhook('invoice.paid', inv)
  assert.equal(tabelas.faturas.length, 1)
  assert.deepEqual([tabelas.faturas[0].valor, tabelas.faturas[0].data, tabelas.faturas[0].user_id], [29.9, '2027-01-01', 'u-1'])
  assert.equal(tabelas.assinaturas[0].status, 'ativa')
})

await caso('pagamento falhou: atrasada; depois que o pagamento cai, volta a ativa', async () => {
  zerar({ status: 'ativa', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1' })
  subs.sub_1 = sub1({ status: 'past_due', trial_end: null })
  await webhook('invoice.payment_failed', { id: 'in_2', amount_paid: 0, created: ts('2027-02-01T03:00:00Z'), status_transitions: {}, parent: { subscription_details: { subscription: 'sub_1' } } })
  assert.equal(tabelas.assinaturas[0].status, 'atrasada')
  assert.ok(tabelas.assinaturas[0].atrasada_desde)
  subs.sub_1 = sub1({ status: 'active', trial_end: null })
  await webhook('invoice.paid', { id: 'in_3', amount_paid: 2990, created: ts('2027-02-02T03:00:00Z'), status_transitions: {}, parent: { subscription_details: { subscription: 'sub_1' } } })
  assert.deepEqual([tabelas.assinaturas[0].status, tabelas.assinaturas[0].atrasada_desde], ['ativa', null])
})

await caso('carência: atrasada há mais de 24h bloqueia; recente e a marcada à mão pelo admin não', async () => {
  zerar({ status: 'atrasada', atrasada_desde: new Date(Date.now() - 25 * 3600_000).toISOString() })
  tabelas.assinaturas.push({ user_id: 'u-2', status: 'atrasada', atrasada_desde: new Date(Date.now() - 2 * 3600_000).toISOString() })
  tabelas.assinaturas.push({ user_id: 'u-3', status: 'atrasada', atrasada_desde: null })
  assert.equal(await bloquearAtrasadas(24), 1)
  assert.deepEqual(tabelas.assinaturas.map((a) => a.status), ['bloqueada', 'atrasada', 'atrasada'])
})

await caso('aviso atrasado da assinatura VELHA cancelada não bloqueia quem já assinou de novo', async () => {
  zerar({ status: 'ativa', stripe_subscription_id: 'sub_nova', stripe_customer_id: 'cus_1' })
  subs.sub_nova = sub1({ id: 'sub_nova', status: 'active', trial_end: null })
  subs.sub_velha = sub1({ id: 'sub_velha', status: 'canceled' })
  await webhook('customer.subscription.deleted', subs.sub_velha)
  assert.equal(tabelas.assinaturas[0].status, 'ativa')
  assert.equal(tabelas.assinaturas[0].stripe_subscription_id, 'sub_nova')
})

await caso('duas abas pagando: a segunda assinatura viva é cancelada e a conta fica com a primeira', async () => {
  zerar({ status: 'ativa', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1' })
  subs.sub_1 = sub1({ status: 'active', trial_end: null })
  subs.sub_dup = sub1({ id: 'sub_dup', status: 'active', trial_end: null })
  chamadas.canceladas.length = 0
  await webhook('customer.subscription.created', subs.sub_dup)
  assert.deepEqual(chamadas.canceladas, ['sub_dup'])
  assert.equal(tabelas.assinaturas[0].stripe_subscription_id, 'sub_1')
})

await caso('produto de outra coisa na mesma conta Stripe: ignorado, nada muda', async () => {
  zerar({ status: 'ativa' })
  subs.sub_outra = sub1({ id: 'sub_outra', status: 'canceled', items: { data: [{ current_period_end: 1, price: { lookup_key: 'fala_app_smart', recurring: { interval: 'month' } } }] } })
  assert.equal((await webhook('customer.subscription.deleted', subs.sub_outra)).status, 200)
  assert.equal(tabelas.assinaturas[0].status, 'ativa')
  assert.equal(tabelas.assinaturas[0].stripe_subscription_id, null)
})

await caso('cortesia do admin sobrevive a qualquer aviso da Stripe', async () => {
  zerar({ status: 'cortesia' })
  subs.sub_1 = sub1({ status: 'canceled' })
  await webhook('customer.subscription.deleted', subs.sub_1)
  assert.equal(tabelas.assinaturas[0].status, 'cortesia')
})

await caso('cancelou durante o teste grátis: volta ao trial prometido (não perde o que ganhou)', async () => {
  zerar({ status: 'ativa', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', trial_fim: dias(10) })
  subs.sub_1 = sub1({ status: 'canceled' })
  await webhook('customer.subscription.deleted', subs.sub_1)
  assert.equal(tabelas.assinaturas[0].status, 'trial')
})

await caso('falha ao gravar no banco: responde 500 (a Stripe tenta de novo), não 200', async () => {
  zerar()
  subs.sub_1 = sub1()
  const original = (sb as any).from
  ;(sb as any).from = () => { throw new Error('banco fora') }
  const r = await webhook('customer.subscription.updated', subs.sub_1)
  ;(sb as any).from = original
  assert.equal(r.status, 500)
})

await caso('excluir conta: cancela a assinatura na Stripe antes; sem assinatura viva não faz nada', async () => {
  zerar({ status: 'ativa', stripe_subscription_id: 'sub_1' })
  subs.sub_1 = sub1({ status: 'active' })
  chamadas.canceladas.length = 0
  assert.equal(await cancelarAssinaturaDe(sb as any, 'u-1'), 'cancelada')
  assert.deepEqual(chamadas.canceladas, ['sub_1'])
  assert.equal(await cancelarAssinaturaDe(sb as any, 'u-1'), 'nada', 'já cancelada')
  zerar()
  assert.equal(await cancelarAssinaturaDe(sb as any, 'u-1'), 'nada', 'nunca assinou')
})

await caso('excluir conta: se a Stripe falhar, a exclusão PARA (erro), em vez de apagar e seguir cobrando', async () => {
  zerar({ status: 'ativa', stripe_subscription_id: 'sub_1' })
  subs.sub_1 = sub1({ status: 'active' })
  const original = (s.subscriptions as any).cancel
  ;(s.subscriptions as any).cancel = async () => { throw Object.assign(new Error('Stripe fora do ar'), { statusCode: 500 }) }
  await assert.rejects(() => cancelarAssinaturaDe(sb as any, 'u-1'), /NÃO foi excluída/)
  ;(s.subscriptions as any).cancel = original
})

await caso('desligada (sem STRIPE_SECRET_KEY): abrir devolve 503 com o aviso de sempre; webhook também', async () => {
  trocarStripeParaTeste(null)
  const r = await abrir('mensal')
  assert.equal(r.status, 503)
  assert.match(((await r.json()) as { erro: string }).erro, /ainda não está ligada/)
  const w = await fetch(URL_BASE + '/cobranca/webhook', { method: 'POST', body: '{}' })
  assert.equal(w.status, 503)
  trocarStripeParaTeste(s)
})

srv.close()
console.log(falhou ? `\n${falhou} falha(s) de ${n + falhou}` : `\n${n} casos ok`)
process.exit(falhou ? 1 : 0)
