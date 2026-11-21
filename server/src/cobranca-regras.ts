/**
 * Regras da cobrança, sem Stripe e sem banco: só entra um resumo do que a Stripe disse e sai o que gravar.
 * É a parte que decide quem pode usar a Granninha, por isso fica separada e coberta por teste (test/cobranca.ts).
 *
 * A Stripe é o provedor; o app continua falando os status que já tinha (trial, ativa, atrasada, bloqueada,
 * cortesia), então acesso_liberado() no banco, o gate do bot (acessoDe) e o painel não mudam.
 */

export type StatusApp = 'trial' | 'ativa' | 'atrasada' | 'bloqueada' | 'cortesia'

/** O que o app precisa saber de uma assinatura da Stripe (o resto do objeto não interessa). */
export interface SubResumo {
  /** trialing, active, past_due, unpaid, canceled, incomplete, incomplete_expired, paused */
  status: string
  intervalo: 'month' | 'year' | null
  /** Unix, em segundos. */
  trial_end: number | null
  /** Fim do período atual (Unix, segundos). Nas versões novas da API fica no item, não na assinatura. */
  periodo_fim: number | null
  cancela_no_fim: boolean
  cancel_at: number | null
}

/** Como a conta está no banco agora. */
export interface AssinaturaAtual {
  status: string
  trial_fim: string | null
  atrasada_desde: string | null
}

export interface Mudanca {
  status: StatusApp
  plano?: 'mensal' | 'anual'
  prox_cobranca?: string
  cancela_em: string | null
  atrasada_desde: string | null
}

const FUSO = 'America/Sao_Paulo'

/** Segundos Unix → AAAA-MM-DD no dia de São Paulo (o banco pode rodar em UTC, onde o dia vira às 21h). */
export function dataSP(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts * 1000))
}

const soma1 = (data: string): string => {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Traduz a assinatura da Stripe para o que gravar. Devolve null quando não deve mexer em nada.
 *
 *  - cortesia nunca é sobrescrita: é o admin dando acesso de graça, a Stripe não tem voto.
 *  - trialing vira ATIVA, não trial. Quem assinou durante a oferta tem `trial_fim` no passado em 01/01, e o
 *    banco e o bot bloqueiam trial vencido; se ficasse como trial, o cliente seria trancado para fora à meia-noite,
 *    antes da primeira fatura ser paga.
 *  - past_due vira atrasada e a carência corre; depois dela o servidor bloqueia (ver `bloquearAtrasadas`).
 *    Se a carência já bloqueou, um novo aviso de falha não reabre o acesso.
 *  - unpaid, canceled, incomplete_expired e paused viram bloqueada, EXCETO se o teste grátis prometido ainda
 *    não acabou: quem assina e cancela no meio da oferta volta para o trial, não perde o que lhe foi prometido.
 *  - incomplete (primeiro pagamento pendente) e status desconhecido: não mexe.
 */
export function mapear(sub: SubResumo, atual: AssinaturaAtual, agora: Date): Mudanca | null {
  if (atual.status === 'cortesia') return null
  const hoje = dataSP(agora.getTime() / 1000)
  const plano = sub.intervalo === 'year' ? 'anual' : sub.intervalo === 'month' ? 'mensal' : undefined
  const fimDoPeriodo = sub.cancel_at ?? sub.periodo_fim
  const cancela_em = sub.cancela_no_fim && fimDoPeriodo ? dataSP(fimDoPeriodo) : null

  switch (sub.status) {
    case 'trialing':
      return { status: 'ativa', plano, prox_cobranca: sub.trial_end ? dataSP(sub.trial_end) : undefined, cancela_em, atrasada_desde: null }
    case 'active':
      return { status: 'ativa', plano, prox_cobranca: sub.periodo_fim ? dataSP(sub.periodo_fim) : undefined, cancela_em, atrasada_desde: null }
    case 'past_due': {
      if (atual.status === 'bloqueada' && atual.atrasada_desde) return { status: 'bloqueada', plano, cancela_em, atrasada_desde: atual.atrasada_desde }
      return { status: 'atrasada', plano, cancela_em, atrasada_desde: atual.atrasada_desde ?? agora.toISOString() }
    }
    case 'unpaid':
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      if (atual.trial_fim && atual.trial_fim >= hoje) return { status: 'trial', plano, prox_cobranca: atual.trial_fim, cancela_em: null, atrasada_desde: null }
      return { status: 'bloqueada', plano, cancela_em: null, atrasada_desde: null }
    default:
      return null
  }
}

/**
 * A Checkout da Stripe não aceita trial_end muito perto de agora (o mínimo não está na documentação lida;
 * 48 h é o que a API cobra na prática, e 49 deixa folga). Perto do fim da oferta a data prometida cai dentro dessa janela:
 * nesse caso adia a cobrança para o mínimo, que favorece o cliente, em vez de cobrar ANTES da data combinada.
 */
export const MIN_TRIAL_MS = 49 * 3600_000

/**
 * Quando a primeira cobrança deve acontecer (Unix, segundos), ou undefined para cobrar já.
 * Quem está no teste grátis só é cobrado depois do último dia dele (00:00 de São Paulo do dia seguinte);
 * teste vencido, bloqueado ou sem assinatura paga na hora.
 */
export function trialEndDoCheckout(atual: { status: string; trial_fim: string | null }, agora: Date): number | undefined {
  if (atual.status !== 'trial' || !atual.trial_fim) return undefined
  const hoje = dataSP(agora.getTime() / 1000)
  if (atual.trial_fim < hoje) return undefined
  // São Paulo está em UTC-3 o ano todo desde que o Brasil acabou com o horário de verão (2019).
  const primeiroDiaPago = new Date(`${soma1(atual.trial_fim)}T00:00:00-03:00`).getTime()
  return Math.floor(Math.max(primeiroDiaPago, agora.getTime() + MIN_TRIAL_MS) / 1000)
}

export interface FaturaResumo {
  id: string
  /** Em centavos. */
  amount_paid: number
  paid_at: number | null
  created: number
}

/** Fatura de R$ 0 (a do início do teste) não vira linha: `faturas.valor` exige maior que zero. */
export function linhaDeFatura(f: FaturaResumo): { data: string; valor: number; status: 'paga'; stripe_invoice_id: string } | null {
  if (!(f.amount_paid > 0)) return null
  return { data: dataSP(f.paid_at ?? f.created), valor: f.amount_paid / 100, status: 'paga', stripe_invoice_id: f.id }
}

export type Plano = 'mensal' | 'anual'
export const planoValido = (p: unknown): p is Plano => p === 'mensal' || p === 'anual'

/** Chave do preço na Stripe (lookup_key). O script de preparo cria os dois; o servidor acha por aqui, sem id fixo. */
export const CHAVE_PRECO: Record<Plano, string> = { mensal: 'granninha_mensal', anual: 'granninha_anual' }
export const ehPrecoDaGranninha = (lookupKey: string | null | undefined): boolean => Boolean(lookupKey && lookupKey.startsWith('granninha_'))
