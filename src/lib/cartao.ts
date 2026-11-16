/**
 * Cartão de crédito no regime de caixa (decisão do Arthur, 2026-11-16): a compra no cartão NÃO é gasto
 * no dia da compra. Ela fica na fatura e vira gasto quando a fatura é paga, com a categoria de cada compra.
 *
 * Pagamento parcial ou em várias vezes: cada pagamento cobre as faturas mais antigas primeiro e é
 * dividido entre as compras da fatura na proporção de cada uma. Assim "saiu no mês" é sempre igual
 * ao dinheiro que saiu do banco para o cartão. Pagamento acima do devido não vira gasto.
 *
 * ESTE ARQUIVO EXISTE IGUAL EM DOIS LUGARES: src/lib/cartao.ts (painel) e server/src/cartao.ts (Granninha).
 * O teste server/test/cartao.ts falha se os dois divergirem.
 */

export interface MovCartao {
  id: string
  tipo: 'entrada' | 'saida' | 'transferencia' | 'compra_cartao'
  valor: number
  data: string
  descricao: string
  carteiraId: string
  carteiraDestinoId?: string
  categoriaId?: string
  pessoal?: boolean
  fatura?: string
}

export interface CartaoInfo {
  id: string
  tipo: string
  fechamento?: number
  vencimento?: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const somaMes = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const ultimoDia = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
const cent = (n: number) => Math.round(n * 100) / 100

/**
 * Mês de vencimento (AAAA-MM) da fatura em que cai uma compra feita em `data`.
 * Compra no dia do fechamento ou depois vai para a fatura seguinte (o "melhor dia de compra").
 */
export function faturaDe(data: string, fechamento: number, vencimento: number): string {
  const ym = data.slice(0, 7)
  const dia = Number(data.slice(8, 10))
  const fech = Math.min(fechamento, ultimoDia(ym))
  const mesFechamento = dia >= fech ? somaMes(ym, 1) : ym
  // Vencimento depois do fechamento: vence no mesmo mês em que fecha. Senão, no mês seguinte.
  return vencimento > fechamento ? mesFechamento : somaMes(mesFechamento, 1)
}

/** Data de vencimento (AAAA-MM-DD) de uma fatura. */
export function vencimentoDaFatura(fatura: string, vencimento: number): string {
  return `${fatura}-${pad(Math.min(vencimento, ultimoDia(fatura)))}`
}

export interface FaturaResumo {
  cartaoId: string
  fatura: string
  vence: string
  total: number
  pago: number
  falta: number
  compras: number
}

const ehCartao = (c: CartaoInfo) => c.tipo === 'cartao'

/** Faturas de cada cartão com o que foi comprado, pago (pela regra das mais antigas primeiro) e o que falta. */
export function faturas<L extends MovCartao>(lancs: L[], carteiras: CartaoInfo[]): FaturaResumo[] {
  const out: FaturaResumo[] = []
  for (const c of carteiras.filter(ehCartao)) {
    const { grupos, alocado } = alocar(lancs, c.id)
    for (const [f, compras] of grupos) {
      const total = cent(compras.reduce((a, x) => a + x.valor, 0))
      const pago = cent(alocado.get(f) ?? 0)
      out.push({ cartaoId: c.id, fatura: f, vence: vencimentoDaFatura(f, c.vencimento ?? 10), total, pago, falta: cent(Math.max(0, total - pago)), compras: compras.length })
    }
  }
  return out.sort((a, b) => (a.vence < b.vence ? -1 : 1))
}

interface Fatia {
  compra: MovCartao
  pagamento: MovCartao
  valor: number
}

/** Distribui os pagamentos de um cartão pelas faturas, das mais antigas para as mais novas. */
function alocar(lancs: MovCartao[], cartaoId: string) {
  const grupos = new Map<string, MovCartao[]>()
  for (const l of lancs) {
    if (l.tipo !== 'compra_cartao' || l.carteiraId !== cartaoId) continue
    const f = l.fatura ?? l.data.slice(0, 7)
    grupos.set(f, [...(grupos.get(f) ?? []), l])
  }
  const ordem = [...grupos.keys()].sort()
  const resta = new Map(ordem.map((f) => [f, cent(grupos.get(f)!.reduce((a, x) => a + x.valor, 0))]))
  const alocado = new Map<string, number>()
  const fatias: Fatia[] = []
  const pagamentos = lancs
    .filter((l) => l.tipo === 'transferencia' && l.carteiraDestinoId === cartaoId)
    .sort((a, b) => (a.data === b.data ? (a.id < b.id ? -1 : 1) : a.data < b.data ? -1 : 1))
  for (const p of pagamentos) {
    let sobra = p.valor
    for (const f of ordem) {
      if (sobra <= 0.004) break
      const r = resta.get(f)!
      if (r <= 0.004) continue
      const usa = Math.min(sobra, r)
      const totalF = grupos.get(f)!.reduce((a, x) => a + x.valor, 0)
      for (const compra of grupos.get(f)!) fatias.push({ compra, pagamento: p, valor: (compra.valor / totalF) * usa })
      resta.set(f, cent(r - usa))
      alocado.set(f, (alocado.get(f) ?? 0) + usa)
      sobra -= usa
    }
  }
  return { grupos: new Map(ordem.map((f) => [f, grupos.get(f)!])), alocado, fatias }
}

/**
 * Lançamentos como contam no caixa: tira as compras no cartão e devolve, no dia de cada pagamento de fatura,
 * a parte de cada compra que aquele pagamento cobriu, como saída com a categoria da compra.
 * Use SEMPRE isto (e não a lista crua) para entrou, saiu, sobrou, séries e categorias.
 */
export function efetivos<L extends MovCartao>(lancs: L[], carteiras: CartaoInfo[]): L[] {
  const out: L[] = lancs.filter((l) => l.tipo !== 'compra_cartao')
  for (const c of carteiras.filter(ehCartao)) {
    for (const f of alocar(lancs, c.id).fatias) {
      const valor = cent(f.valor)
      if (valor <= 0) continue
      out.push({ ...(f.compra as L), id: `${f.compra.id}~${f.pagamento.id}`, tipo: 'saida', valor, data: f.pagamento.data })
    }
  }
  return out
}

/** Contas que não entram no dinheiro disponível: cartão (é dívida) e investimento (é guardado). */
export const foraDoDisponivel = (tipo: string) => tipo === 'cartao' || tipo === 'investimento'
