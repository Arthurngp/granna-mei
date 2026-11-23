/**
 * Quem pede a exclusão da conta não segue sendo cobrado nos 30 dias (f5-exclusao-cobranca), sem tirar o plano de quem desiste.
 * Stripe falsa em memória (recusa cancelar o que já está cancelado, como a de verdade) e banco falso. O que está travado aqui:
 *  - o pedido de exclusão PARA a cobrança no fim do período (cancel_at_period_end), não cancela de vez, e põe a marca da Granninha;
 *  - rodar de novo não faz nada (idempotente), e quem já ia parar (cancelou sozinho) não é tocado, nem na marca;
 *  - desistiu da exclusão: a assinatura volta a renovar, MAS só se a marca for da Granninha; o cancelamento da pessoa nunca é desfeito;
 *  - quem nunca pediu exclusão nunca é tocado, mesmo se o filtro do banco falhasse (conferido de novo no código);
 *  - uma conta com erro na Stripe não impede as outras, e o erro tenta de novo na próxima volta;
 *  - a exclusão definitiva continua funcionando com assinatura já marcada para parar e com assinatura já encerrada;
 *  - sem Stripe ligada, nada acontece.
 *   npx tsx test/exclusao-cobranca.ts
 */
import assert from 'node:assert/strict'
import { caso, E, fim, U1, U2 } from './_falsos.ts'

const { sb } = await import('../src/banco.ts')
const { trocarStripeParaTeste, cancelarAssinaturaDe, MARCA_EXCLUSAO } = await import('../src/cobranca-stripe.ts')
const { sincronizarCobrancaDasExclusoes, zerarSincronia, INTERVALO_MS } = await import('../src/exclusao-cobranca.ts')

interface SubFalsa { id: string; status: string; cancel_at_period_end: boolean; cancel_at: number | null; metadata: Record<string, string> }
const subs = new Map<string, SubFalsa>()
const chamadas = { retrieve: [] as string[], update: [] as [string, Record<string, unknown>][], cancel: [] as string[] }
let quebrarEm: string | null = null

const erroDaStripe = (msg: string, code?: string) => Object.assign(new Error(msg), { code, statusCode: code === 'resource_missing' ? 404 : 400 })
const falsa = {
  subscriptions: {
    retrieve: async (id: string) => {
      chamadas.retrieve.push(id)
      if (quebrarEm === id) throw erroDaStripe('a Stripe caiu')
      const s = subs.get(id)
      if (!s) throw erroDaStripe(`No such subscription: ${id}`, 'resource_missing')
      return structuredClone(s)
    },
    update: async (id: string, p: Record<string, unknown>) => {
      chamadas.update.push([id, p])
      const s = subs.get(id)!
      if ('cancel_at_period_end' in p) s.cancel_at_period_end = p.cancel_at_period_end as boolean
      for (const [k, v] of Object.entries((p.metadata ?? {}) as Record<string, string>)) {
        if (v === '') delete s.metadata[k]
        else s.metadata[k] = v
      }
      return structuredClone(s)
    },
    cancel: async (id: string) => {
      chamadas.cancel.push(id)
      const s = subs.get(id)
      if (!s) throw erroDaStripe(`No such subscription: ${id}`, 'resource_missing')
      if (s.status === 'canceled') throw erroDaStripe('A assinatura já está cancelada.')
      s.status = 'canceled'
      return structuredClone(s)
    },
  },
}

let t0 = 1_800_000_000_000
const agora = () => (t0 += INTERVALO_MS + 1)
const sub = (id: string, extra: Partial<SubFalsa> = {}) => subs.set(id, { id, status: 'active', cancel_at_period_end: false, cancel_at: null, metadata: {}, ...extra })

/** Prepara um cenário: U1 com assinatura sub_1 (e opcionalmente U2 com sub_2). */
function cenario(opts: { u1Pediu?: boolean; u2Pediu?: boolean; u1Sub?: string | null; u2Sub?: string | null; u1CancelaEm?: string | null; u2CancelaEm?: string | null } = {}) {
  subs.clear()
  chamadas.retrieve.length = chamadas.update.length = chamadas.cancel.length = 0
  quebrarEm = null
  zerarSincronia()
  trocarStripeParaTeste(falsa as never)
  const perfil = (u: string) => E.tabelas.perfis.find((p) => p.id === u)!
  perfil(U1).exclusao_em = opts.u1Pediu ? '2026-12-22' : null
  perfil(U2).exclusao_em = opts.u2Pediu ? '2026-12-22' : null
  E.tabelas.assinaturas = [
    { user_id: U1, status: 'ativa', trial_fim: '2099-12-31', stripe_subscription_id: opts.u1Sub === undefined ? 'sub_1' : opts.u1Sub, cancela_em: opts.u1CancelaEm ?? null },
    { user_id: U2, status: 'ativa', trial_fim: '2099-12-31', stripe_subscription_id: opts.u2Sub === undefined ? 'sub_2' : opts.u2Sub, cancela_em: opts.u2CancelaEm ?? null },
  ]
}

/* ---------- pedir a exclusão ---------- */

await caso('pediu a exclusão: a cobrança para no FIM do período, com a marca da Granninha, e não cancela de vez', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1')
  sub('sub_2')
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r.paradas, 1)
  assert.equal(subs.get('sub_1')!.cancel_at_period_end, true, 'para de renovar no fim do período')
  assert.equal(subs.get('sub_1')!.metadata[MARCA_EXCLUSAO], '1', 'marca nossa')
  assert.equal(subs.get('sub_1')!.status, 'active', 'segue ativa até o fim do que já foi pago')
  assert.deepEqual(chamadas.cancel, [], 'não cancela de vez: quem desiste perderia o plano')
})

await caso('rodar de novo não faz nada (e sem a memória, a Stripe já mostra que está parando)', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1')
  await sincronizarCobrancaDasExclusoes(sb, agora())
  const antes = chamadas.update.length
  await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(chamadas.update.length, antes, 'segunda volta com a memória: nenhuma chamada')
  zerarSincronia()
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r.paradas, 0)
  assert.equal(chamadas.update.length, antes, 'sem a memória: olha a Stripe, vê que já está parando e não atualiza de novo')
})

await caso('quem já ia parar sozinho (cancelou no portal) não é tocado, nem na marca', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1', { cancel_at_period_end: true })
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r.paradas, 0)
  assert.deepEqual(chamadas.update, [], 'nenhuma atualização')
  assert.equal(subs.get('sub_1')!.metadata[MARCA_EXCLUSAO], undefined, 'não pode assumir como nosso o cancelamento da pessoa')
})

await caso('assinatura que já acabou ou nunca existiu na Stripe não dá erro nem atualização', async () => {
  cenario({ u1Pediu: true, u2Pediu: true, u2Sub: 'sub_que_sumiu' })
  sub('sub_1', { status: 'canceled' })
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.deepEqual([r.paradas, r.erros], [0, []])
  assert.deepEqual(chamadas.update, [])
})

await caso('quem não tem assinatura na Stripe (teste grátis, cortesia) passa batido', async () => {
  cenario({ u1Pediu: true, u1Sub: null })
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.deepEqual([r.paradas, r.erros], [0, []])
  assert.deepEqual(chamadas.retrieve, [], 'nem consulta a Stripe')
})

/* ---------- quem nunca pediu ---------- */

await caso('quem nunca pediu exclusão não é tocado: a assinatura de U2 segue renovando', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1')
  sub('sub_2')
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r.paradas, 1)
  assert.equal(subs.get('sub_2')!.cancel_at_period_end, false)
  assert.ok(!chamadas.retrieve.includes('sub_2'), 'nem consulta a Stripe sobre quem não pediu')
})

await caso('mesmo que o filtro do banco falhasse e devolvesse todo mundo, quem não tem exclusao_em não é tocado (conferido de novo no código)', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1')
  sub('sub_2')
  // Banco que IGNORA todo filtro (not, in, eq): devolve sempre as duas contas. É o pior caso que a conferência dentro do código tem de aguentar.
  const perfisTodos = [{ id: U1, exclusao_em: '2026-12-22' }, { id: U2, exclusao_em: null }]
  const assinaturasTodas = [{ user_id: U1, stripe_subscription_id: 'sub_1' }, { user_id: U2, stripe_subscription_id: 'sub_2' }]
  const consulta = (tabela: string) => {
    let quem: string | null = null
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.not = () => q
    q.in = () => q
    q.eq = (_c: string, v: string) => ((quem = v), q)
    q.maybeSingle = async () => ({ data: assinaturasTodas.find((a) => a.user_id === quem) ?? null, error: null })
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabela === 'perfis' ? perfisTodos : assinaturasTodas, error: null }).then(ok)
    return q
  }
  const bancoQueNaoFiltra = { from: (t: string) => consulta(t) } as never
  await sincronizarCobrancaDasExclusoes(bancoQueNaoFiltra, agora())
  assert.ok(chamadas.retrieve.includes('sub_1'), 'quem pediu foi atendido')
  assert.equal(subs.get('sub_2')!.cancel_at_period_end, false, 'U2 não pediu: a assinatura segue renovando')
  assert.ok(!chamadas.update.some(([id]) => id === 'sub_2'), 'nenhuma atualização na assinatura de quem não pediu')
})

/* ---------- desistir ---------- */

await caso('desistiu da exclusão e a marca é nossa: a assinatura volta a renovar e a marca sai', async () => {
  cenario({ u1Pediu: false, u1CancelaEm: '2026-12-10' })
  sub('sub_1', { cancel_at_period_end: true, metadata: { [MARCA_EXCLUSAO]: '1' } })
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r.religadas, 1)
  assert.equal(subs.get('sub_1')!.cancel_at_period_end, false)
  assert.equal(subs.get('sub_1')!.metadata[MARCA_EXCLUSAO], undefined)
})

await caso('desistiu da exclusão mas o cancelamento era da própria pessoa (sem a marca): NÃO religa', async () => {
  cenario({ u1Pediu: false, u1CancelaEm: '2026-12-10' })
  sub('sub_1', { cancel_at_period_end: true })
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r.religadas, 0)
  assert.equal(subs.get('sub_1')!.cancel_at_period_end, true, 'religar seria cobrar quem pediu para não ser cobrado')
  assert.deepEqual(chamadas.update, [])
})

await caso('ainda pedindo a exclusão: a cobrança segue parada, não é religada', async () => {
  cenario({ u1Pediu: true, u1CancelaEm: '2026-12-10' })
  sub('sub_1', { cancel_at_period_end: true, metadata: { [MARCA_EXCLUSAO]: '1' } })
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r.religadas, 0)
  assert.equal(subs.get('sub_1')!.cancel_at_period_end, true)
})

await caso('ciclo completo: pede, para; desiste, volta; pede de novo, para de novo', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1')
  await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(subs.get('sub_1')!.cancel_at_period_end, true)
  // desistiu (o webhook da Stripe já mostrou cancela_em no banco)
  E.tabelas.perfis.find((p) => p.id === U1)!.exclusao_em = null
  E.tabelas.assinaturas.find((a) => a.user_id === U1)!.cancela_em = '2026-12-10'
  await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(subs.get('sub_1')!.cancel_at_period_end, false, 'voltou a renovar')
  E.tabelas.assinaturas.find((a) => a.user_id === U1)!.cancela_em = null
  E.tabelas.perfis.find((p) => p.id === U1)!.exclusao_em = '2027-01-05'
  await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(subs.get('sub_1')!.cancel_at_period_end, true, 'o segundo pedido também para a cobrança')
})

/* ---------- falhas ---------- */

await caso('uma conta com erro na Stripe não impede as outras, e o erro tenta de novo na volta seguinte', async () => {
  cenario({ u1Pediu: true, u2Pediu: true })
  sub('sub_1')
  sub('sub_2')
  quebrarEm = 'sub_1'
  const r = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r.paradas, 1, 'a outra foi resolvida')
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0], /sub_1/)
  assert.equal(subs.get('sub_2')!.cancel_at_period_end, true)
  quebrarEm = null
  const r2 = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.equal(r2.paradas, 1, 'na volta seguinte a que falhou é resolvida')
  assert.equal(subs.get('sub_1')!.cancel_at_period_end, true)
})

await caso('o intervalo entre voltas é respeitado e sem Stripe ligada nada acontece', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1')
  const t = agora()
  await sincronizarCobrancaDasExclusoes(sb, t)
  const r = await sincronizarCobrancaDasExclusoes(sb, t + 1000)
  assert.equal(r.pulou, true)
  trocarStripeParaTeste(null)
  zerarSincronia()
  const sem = await sincronizarCobrancaDasExclusoes(sb, agora())
  assert.deepEqual([sem.paradas, sem.religadas, sem.erros, sem.pulou], [0, 0, [], undefined])
})

/* ---------- a exclusão definitiva continua funcionando ---------- */

await caso('exclusão definitiva com a assinatura já marcada para parar: cancela de vez, sem erro', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1', { cancel_at_period_end: true, metadata: { [MARCA_EXCLUSAO]: '1' } })
  assert.equal(await cancelarAssinaturaDe(sb, U1), 'cancelada')
  assert.equal(subs.get('sub_1')!.status, 'canceled')
})

await caso('exclusão definitiva com a assinatura que já terminou no fim do período: não trava', async () => {
  cenario({ u1Pediu: true })
  sub('sub_1', { status: 'canceled', cancel_at_period_end: true })
  assert.equal(await cancelarAssinaturaDe(sb, U1), 'nada')
  assert.deepEqual(chamadas.cancel, [], 'não tenta cancelar o que já está cancelado (a Stripe recusaria e a exclusão travaria)')
})

fim()
