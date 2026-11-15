import { diasNoMes, hoje, mesCurto, mesDe, somaMeses } from './format'
import type { Categoria, Estado, Lancamento } from './tipos'

export interface Totais {
  entrou: number
  saiu: number
  retirada: number
  sobrou: number
}

/** Entrou e saiu da EMPRESA. Retirada do dono fica à parte e não entra no resultado. */
export function totais(lancs: Lancamento[]): Totais {
  let entrou = 0
  let saiu = 0
  let retirada = 0
  for (const l of lancs) {
    if (l.tipo === 'entrada') entrou += l.valor
    else if (l.tipo === 'saida') {
      if (l.pessoal) retirada += l.valor
      else saiu += l.valor
    }
  }
  return { entrou, saiu, retirada, sobrou: entrou - saiu }
}

export const doMes = (lancs: Lancamento[], ym: string) => lancs.filter((l) => mesDe(l.data) === ym)
export const doPeriodo = (lancs: Lancamento[], de: string, ate: string) => lancs.filter((l) => l.data >= de && l.data <= ate)

/** Saldo atual de cada carteira: saldo inicial mais tudo que entrou, saiu e foi transferido. */
export function saldos(s: Estado): Record<string, number> {
  const r: Record<string, number> = {}
  for (const c of s.carteiras) r[c.id] = c.saldoInicial
  for (const l of s.lancamentos) {
    if (l.tipo === 'entrada') r[l.carteiraId] = (r[l.carteiraId] ?? 0) + l.valor
    else if (l.tipo === 'saida') r[l.carteiraId] = (r[l.carteiraId] ?? 0) - l.valor
    else {
      r[l.carteiraId] = (r[l.carteiraId] ?? 0) - l.valor
      if (l.carteiraDestinoId) r[l.carteiraDestinoId] = (r[l.carteiraDestinoId] ?? 0) + l.valor
    }
  }
  return r
}

/** Entradas e saídas por dia do mês. No mês corrente, para em hoje. */
export function serieDiaria(lancs: Lancamento[], ym: string) {
  const h = hoje()
  const n = mesDe(h) === ym ? Number(h.slice(8)) : diasNoMes(ym)
  const entradas = Array<number>(n).fill(0)
  const saidas = Array<number>(n).fill(0)
  for (const l of lancs) {
    if (mesDe(l.data) !== ym) continue
    const i = Number(l.data.slice(8)) - 1
    if (i >= n) continue
    if (l.tipo === 'entrada') entradas[i] += l.valor
    else if (l.tipo === 'saida' && !l.pessoal) saidas[i] += l.valor
  }
  return { labels: entradas.map((_, i) => String(i + 1)), entradas, saidas }
}

/** Entradas e saídas dos últimos n meses, terminando em ymFim. */
export function serieMensal(lancs: Lancamento[], ymFim: string, n: number) {
  const meses = Array.from({ length: n }, (_, i) => somaMeses(ymFim, i - n + 1))
  const idx = new Map(meses.map((m, i) => [m, i]))
  const entradas = Array<number>(n).fill(0)
  const saidas = Array<number>(n).fill(0)
  for (const l of lancs) {
    const i = idx.get(mesDe(l.data))
    if (i === undefined) continue
    if (l.tipo === 'entrada') entradas[i] += l.valor
    else if (l.tipo === 'saida' && !l.pessoal) saidas[i] += l.valor
  }
  return { meses, labels: meses.map(mesCurto), entradas, saidas }
}

export interface FatiaCategoria {
  id: string
  nome: string
  cor: string
  valor: number
  frac: number
  qtd: number
}

export function porCategoria(lancs: Lancamento[], cats: Categoria[], tipo: 'entrada' | 'saida', incluirPessoal = false): FatiaCategoria[] {
  const mapa = new Map<string, { valor: number; qtd: number }>()
  let total = 0
  for (const l of lancs) {
    if (l.tipo !== tipo) continue
    if (l.pessoal && !incluirPessoal) continue
    const k = l.categoriaId ?? 'sem'
    const a = mapa.get(k) ?? { valor: 0, qtd: 0 }
    a.valor += l.valor
    a.qtd += 1
    mapa.set(k, a)
    total += l.valor
  }
  return [...mapa.entries()]
    .map(([id, v]) => {
      const c = cats.find((x) => x.id === id)
      return { id, nome: c?.nome ?? 'Sem categoria', cor: c?.cor ?? '#B1B9D8', valor: v.valor, qtd: v.qtd, frac: total ? v.valor / total : 0 }
    })
    .sort((a, b) => b.valor - a.valor)
}

/** Faturamento do ano (tudo que entrou), separado em serviço e comércio para a declaração anual. */
export function faturamentoAno(s: Estado, ano: string) {
  let total = 0
  let servico = 0
  let comercio = 0
  const porMes = Array<number>(12).fill(0)
  for (const l of s.lancamentos) {
    if (l.tipo !== 'entrada' || !l.data.startsWith(ano)) continue
    total += l.valor
    porMes[Number(l.data.slice(5, 7)) - 1] += l.valor
    const nat = s.categorias.find((c) => c.id === l.categoriaId)?.natureza
    if (nat === 'comercio') comercio += l.valor
    else servico += l.valor
  }
  return { total, servico, comercio, porMes }
}

/** Quantos lançamentos e mídias (áudio, foto, PDF) o cliente mandou no mês: base do uso justo. */
export function usoDoMes(s: Estado, ym: string) {
  let lancamentos = 0
  let midias = 0
  for (const l of s.lancamentos) {
    if (mesDe(l.data) !== ym || l.origem === 'painel') continue
    lancamentos++
    if (l.origem !== 'texto') midias++
  }
  return { lancamentos, midias }
}
