/**
 * Cobrança pela Stripe.
 *
 *   POST /cobranca/abrir     (cliente logado) devolve a página certa da Stripe: Checkout para quem ainda não assina,
 *                            fatura em aberto para quem está em atraso, portal para quem já assina (trocar cartão,
 *                            plano ou cancelar). Nunca cria uma segunda assinatura para quem já tem uma.
 *   POST /cobranca/webhook   a Stripe avisa o que aconteceu (assinada). Cada aviso relê a assinatura na Stripe e
 *                            grava o estado ATUAL, então aviso fora de ordem ou repetido não estraga nada.
 *
 * Desligada até existir STRIPE_SECRET_KEY: as rotas devolvem 503 com o texto que o painel já mostrava.
 * A tradução do estado da Stripe para o do app mora em cobranca-regras.ts (testada à parte).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type Stripe from 'stripe'
import { falhou, sb } from './banco.ts'
import { cors, ORIGENS } from './admin.ts'
import { ASSINATURA_VIVA, stripe } from './cobranca-stripe.ts'
import { CHAVE_PRECO, ehPrecoDaGranninha, linhaDeFatura, mapear, planoValido, trialEndDoCheckout, type Plano, type SubResumo } from './cobranca-regras.ts'

class ErroCobranca extends Error {
  constructor(
    public status: number,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

const json = (res: ServerResponse, st: number, corpo: unknown) => res.writeHead(st, { 'Content-Type': 'application/json' }).end(JSON.stringify(corpo))

const AINDA_NAO = 'A cobrança ainda não está ligada. Seu acesso segue liberado no teste.'

/** Corpo cru em bytes. A assinatura da Stripe é calculada sobre os bytes exatos: juntar como texto corrompe acento partido entre blocos. */
function corpoCru(req: IncomingMessage, limite = 1_000_000): Promise<Buffer> {
  return new Promise((ok, falha) => {
    const partes: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > limite) {
        falha(new Error('corpo grande demais'))
        req.destroy()
        return
      }
      partes.push(c)
    })
    req.on('end', () => ok(Buffer.concat(partes)))
    req.on('error', falha)
  })
}

async function usuarioDo(req: IncomingMessage): Promise<{ id: string; email: string } | null> {
  const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const { data, error } = await sb.auth.getUser(t)
  if (error || !data.user) return null
  return { id: data.user.id, email: data.user.email ?? '' }
}

/**
 * Para onde a Stripe devolve o cliente. Vem da origem de quem chamou (conferida na lista de domínios nossos),
 * porque a sessão do painel é por origem: voltar para outro domínio pareceria deslogado logo depois de pagar.
 */
function painelDe(req: IncomingMessage): string {
  const o = req.headers.origin
  const base = o && ORIGENS.includes(o) ? o + '/painel' : (process.env.PAINEL_URL ?? 'https://granninha.com.br/painel')
  return base.replace(/\/+$/, '')
}

const cachePreco = new Map<Plano, { id: string; ate: number }>()
async function precoDe(s: Stripe, plano: Plano): Promise<string> {
  const c = cachePreco.get(plano)
  if (c && c.ate > Date.now()) return c.id
  const r = await s.prices.list({ lookup_keys: [CHAVE_PRECO[plano]], active: true, limit: 1 })
  const p = r.data[0]
  if (!p || p.currency !== 'brl' || p.type !== 'recurring') throw new ErroCobranca(503, 'Os preços da Granninha ainda não foram preparados na Stripe.')
  cachePreco.set(plano, { id: p.id, ate: Date.now() + 10 * 60_000 })
  return p.id
}

interface LinhaAssinatura {
  status: string
  trial_fim: string | null
  atrasada_desde: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

async function lerAssinatura(userId: string): Promise<LinhaAssinatura | null> {
  const r = await sb.from('assinaturas').select('status,trial_fim,atrasada_desde,stripe_customer_id,stripe_subscription_id').eq('user_id', userId).maybeSingle()
  if (r.error && /stripe_|atrasada_desde/.test(r.error.message)) throw new ErroCobranca(503, 'A cobrança ainda está sendo preparada. Tente de novo em alguns minutos.')
  falhou(r.error, 'ler assinatura')
  return r.data as LinhaAssinatura | null
}

async function clienteDaStripe(s: Stripe, userId: string, email: string, atual: LinhaAssinatura): Promise<string> {
  if (atual.stripe_customer_id) return atual.stripe_customer_id
  const p = await sb.from('perfis').select('nome').eq('id', userId).maybeSingle()
  // A chave de idempotência faz dois cliques seguidos devolverem o MESMO cliente da Stripe.
  const c = await s.customers.create({ email: email || undefined, name: (p.data?.nome as string) || undefined, metadata: { user_id: userId } }, { idempotencyKey: `granninha-cliente-${userId}` })
  const up = await sb.from('assinaturas').update({ stripe_customer_id: c.id }).eq('user_id', userId)
  falhou(up.error, 'gravar cliente da Stripe')
  return c.id
}

type Aberto = { url: string; tipo: 'checkout' | 'fatura' | 'portal' }

async function abrir(req: IncomingMessage, userId: string, email: string, plano: Plano): Promise<Aberto> {
  const s = stripe()
  if (!s) throw new ErroCobranca(503, AINDA_NAO)
  const atual = await lerAssinatura(userId)
  if (!atual) throw new ErroCobranca(404, 'Não achei a sua assinatura. Fale com a gente.')
  if (atual.status === 'cortesia') throw new ErroCobranca(409, 'Sua conta tem acesso liberado, sem cobrança. Não precisa pagar nada.')
  const painel = painelDe(req)
  const volta = `${painel}/ajustes/assinatura`

  // Já assina: não cria outra assinatura (seria cobrança em dobro). Leva para pagar o que está aberto ou para o portal.
  if (atual.stripe_subscription_id && atual.stripe_customer_id) {
    let sub: Stripe.Subscription | null = null
    try {
      sub = await s.subscriptions.retrieve(atual.stripe_subscription_id, { expand: ['latest_invoice'] })
    } catch (e) {
      if ((e as { code?: string }).code !== 'resource_missing') throw e
    }
    if (sub && ASSINATURA_VIVA.includes(sub.status)) {
      const inv = sub.latest_invoice && typeof sub.latest_invoice !== 'string' ? sub.latest_invoice : null
      if ((sub.status === 'past_due' || sub.status === 'unpaid') && inv?.status === 'open' && inv.hosted_invoice_url) return { url: inv.hosted_invoice_url, tipo: 'fatura' }
      try {
        const p = await s.billingPortal.sessions.create({ customer: atual.stripe_customer_id, return_url: volta, locale: 'pt-BR' })
        return { url: p.url, tipo: 'portal' }
      } catch (e) {
        console.error('[cobranca] portal:', (e as Error).message)
        throw new ErroCobranca(503, 'Não consegui abrir a área de pagamento agora. Tente de novo em instantes ou fale com a gente.')
      }
    }
  }

  const customer = await clienteDaStripe(s, userId, email, atual)
  const price = await precoDe(s, plano)
  const trialEnd = trialEndDoCheckout(atual, new Date())
  const sessao = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: userId,
    locale: 'pt-BR',
    line_items: [{ price, quantity: 1 }],
    metadata: { user_id: userId },
    // user_id na própria assinatura: é por ele que o webhook acha de quem é, sem depender do e-mail.
    // trial_end: quem está no teste grátis só é cobrado depois do último dia dele.
    subscription_data: { metadata: { user_id: userId }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    success_url: `${volta}?pagamento=ok`,
    cancel_url: `${volta}?pagamento=cancelado`,
  })
  if (!sessao.url) throw new Error('a Stripe não devolveu o endereço do pagamento')
  return { url: sessao.url, tipo: 'checkout' }
}

// ───────────────────────────── webhook ─────────────────────────────

function resumir(sub: Stripe.Subscription): SubResumo {
  const fins = sub.items.data.map((i) => i.current_period_end).filter((n) => Number.isFinite(n))
  const intervalo = sub.items.data[0]?.price?.recurring?.interval
  const inicios = sub.items.data.map((i) => i.current_period_start).filter((n) => Number.isFinite(n))
  return {
    status: sub.status,
    intervalo: intervalo === 'year' ? 'year' : intervalo === 'month' ? 'month' : null,
    trial_end: sub.trial_end ?? null,
    periodo_fim: fins.length ? Math.max(...fins) : null,
    periodo_inicio: inicios.length ? Math.min(...inicios) : null,
    cancela_no_fim: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    cancel_at: sub.cancel_at ?? null,
  }
}

const idDe = (x: string | { id: string } | null | undefined): string | null => (!x ? null : typeof x === 'string' ? x : x.id)

async function userIdDaAssinatura(sub: Stripe.Subscription, dica?: string | null): Promise<string | null> {
  const direto = sub.metadata?.user_id || dica
  if (direto) return direto
  const cid = idDe(sub.customer as string | { id: string })
  if (!cid) return null
  const r = await sb.from('assinaturas').select('user_id').eq('stripe_customer_id', cid).maybeSingle()
  falhou(r.error, 'achar conta pelo cliente da Stripe')
  return (r.data?.user_id as string) ?? null
}

/**
 * Relê a assinatura na Stripe e grava o estado atual. Devolve a conta afetada (ou null se o aviso não é nosso).
 * Aviso de assinatura que não é a que está gravada para a conta é ignorado: sem isso um "cancelada" atrasado da
 * assinatura velha bloquearia quem já assinou de novo.
 */
export async function sincronizar(s: Stripe, subId: string, dica?: string | null): Promise<string | null> {
  const sub = await s.subscriptions.retrieve(subId)
  if (!ehPrecoDaGranninha(sub.items.data[0]?.price?.lookup_key)) return null // outro produto da mesma conta Stripe
  const userId = await userIdDaAssinatura(sub, dica)
  if (!userId) {
    console.error('[cobranca] assinatura sem dono conhecido:', sub.id)
    return null
  }
  const atual = await lerAssinatura(userId)
  if (!atual) {
    console.error('[cobranca] assinatura de conta que não existe mais:', sub.id, userId)
    return null
  }
  if (atual.stripe_subscription_id && atual.stripe_subscription_id !== sub.id) {
    let gravada: Stripe.Subscription | null = null
    try {
      gravada = await s.subscriptions.retrieve(atual.stripe_subscription_id)
    } catch (e) {
      if ((e as { code?: string }).code !== 'resource_missing') throw e
    }
    if (gravada && ASSINATURA_VIVA.includes(gravada.status)) {
      if (ASSINATURA_VIVA.includes(sub.status)) {
        // Duas assinaturas vivas para a mesma conta (duas abas pagando): cancela a nova e deixa registro.
        await s.subscriptions.cancel(sub.id)
        console.error(`[cobranca] ASSINATURA DUPLICADA cancelada: ${sub.id} (a conta ${userId} já tem ${gravada.id}). Se a nova chegou a cobrar, reembolsar na Stripe.`)
      }
      return null
    }
  }
  const m = mapear(resumir(sub), atual, new Date())
  const cid = idDe(sub.customer as string | { id: string })
  const patch: Record<string, unknown> = { stripe_subscription_id: sub.id, atualizado_em: new Date().toISOString() }
  if (cid) patch.stripe_customer_id = cid
  if (m) {
    patch.status = m.status
    patch.cancela_em = m.cancela_em
    patch.atrasada_desde = m.atrasada_desde
    if (m.plano) patch.plano = m.plano
    if (m.prox_cobranca) patch.prox_cobranca = m.prox_cobranca
  }
  const up = await sb.from('assinaturas').update(patch).eq('user_id', userId)
  falhou(up.error, 'gravar assinatura')
  console.log(`[cobranca] ${userId.slice(0, 8)} · Stripe ${sub.status} → ${m ? m.status : 'sem mudança'}`)
  return userId
}

async function registrarFatura(inv: Stripe.Invoice, userId: string) {
  const l = linhaDeFatura({ id: inv.id!, amount_paid: inv.amount_paid, paid_at: inv.status_transitions?.paid_at ?? null, created: inv.created })
  if (!l) return // fatura de R$ 0 (início do teste)
  const r = await sb.from('faturas').upsert({ user_id: userId, ...l }, { onConflict: 'stripe_invoice_id' })
  falhou(r.error, 'gravar fatura')
}

async function tratar(s: Stripe, ev: Stripe.Event): Promise<void> {
  switch (ev.type) {
    case 'checkout.session.completed': {
      const c = ev.data.object
      const subId = idDe(c.subscription)
      if (c.mode === 'subscription' && subId) await sincronizar(s, subId, c.client_reference_id ?? c.metadata?.user_id)
      return
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await sincronizar(s, ev.data.object.id)
      return
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = ev.data.object
      const subId = idDe(inv.parent?.subscription_details?.subscription as string | { id: string } | null | undefined)
      if (!subId) return
      const userId = await sincronizar(s, subId)
      if (userId && ev.type === 'invoice.paid') await registrarFatura(inv, userId)
      return
    }
    default:
      return
  }
}

/** Quem está atrasada há mais que a carência perde o acesso. A Stripe segue tentando; se o pagamento cair, o webhook reabre. */
export async function bloquearAtrasadas(horas = Number(process.env.CARENCIA_HORAS ?? 24)): Promise<number> {
  const limite = new Date(Date.now() - horas * 3600_000).toISOString()
  const r = await sb.from('assinaturas').update({ status: 'bloqueada', atualizado_em: new Date().toISOString() }).eq('status', 'atrasada').lt('atrasada_desde', limite).select('user_id')
  // Coluna ainda não criada (migration não rodou): nada a bloquear.
  if (r.error && /atrasada_desde/.test(r.error.message)) return 0
  falhou(r.error, 'bloquear atrasadas')
  return r.data?.length ?? 0
}

export async function rotaCobranca(req: IncomingMessage, res: ServerResponse, caminho: string): Promise<boolean> {
  if (!caminho.startsWith('/cobranca/')) return false

  if (caminho === '/cobranca/webhook') {
    if (req.method !== 'POST') return json(res, 405, { erro: 'use POST' }), true
    const s = stripe()
    const segredo = process.env.STRIPE_WEBHOOK_SECRET
    if (!s || !segredo) return json(res, 503, { erro: AINDA_NAO }), true
    let ev: Stripe.Event
    try {
      ev = s.webhooks.constructEvent(await corpoCru(req), String(req.headers['stripe-signature'] ?? ''), segredo)
    } catch (e) {
      console.error('[cobranca] webhook recusado:', (e as Error).message)
      return json(res, 400, { erro: 'assinatura inválida' }), true
    }
    try {
      await tratar(s, ev)
      json(res, 200, { received: true })
    } catch (e) {
      // 500 faz a Stripe tentar de novo (com intervalo crescente): é o que queremos para falha passageira.
      console.error('[cobranca] erro tratando', ev.type, ev.id, (e as Error).message)
      json(res, 500, { erro: 'falha ao tratar' })
    }
    return true
  }

  cors(req, res)
  if (req.method === 'OPTIONS') return res.writeHead(204).end(), true
  if (req.method === 'POST' && caminho === '/cobranca/abrir') {
    // Só 4xx/5xx com mensagem: o painel mostra o texto e NUNCA desloga por resposta de cobrança.
    try {
      const u = await usuarioDo(req)
      if (!u) return json(res, 401, { erro: 'Entre na sua conta de novo para continuar.' }), true
      if (!stripe()) return json(res, 503, { erro: AINDA_NAO }), true
      const corpo = await corpoCru(req, 10_000)
      const { plano } = JSON.parse(corpo.toString('utf8') || '{}') as { plano?: unknown }
      json(res, 200, await abrir(req, u.id, u.email, planoValido(plano) ? plano : 'mensal'))
    } catch (e) {
      if (e instanceof ErroCobranca) json(res, e.status, { erro: e.message })
      else {
        console.error('[cobranca] abrir:', (e as Error).message)
        json(res, 500, { erro: 'Não consegui abrir o pagamento agora. Tente de novo em instantes.' })
      }
    }
    return true
  }
  json(res, 404, { erro: 'rota desconhecida' })
  return true
}
