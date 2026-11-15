const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

export const brl = (n: number) => fmtBRL.format(n).replace(/ /g, ' ')

/** R$ 1,2 mil / R$ 58 mil: para eixos e resumos curtos */
export function brlCurto(n: number) {
  const a = Math.abs(n)
  if (a >= 1000) {
    const v = a / 1000
    const s = v >= 10 ? fmtInt.format(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
    return `${n < 0 ? '-' : ''}R$ ${s} mil`
  }
  return `${n < 0 ? '-' : ''}R$ ${fmtInt.format(a)}`
}

export const pct = (n: number) => `${fmtInt.format(Math.round(n * 100))}%`

const pad = (n: number) => String(n).padStart(2, '0')

/** Date -> 'AAAA-MM-DD' no fuso local */
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const hoje = () => iso(new Date())
export const mesDe = (data: string) => data.slice(0, 7)
export const mesAtual = () => hoje().slice(0, 7)

/** 'AAAA-MM-DD' -> Date local (sem escorregar de dia por causa de fuso) */
export function parse(data: string) {
  const [y, m, d] = data.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function somaDias(data: string, n: number) {
  const d = parse(data)
  d.setDate(d.getDate() + n)
  return iso(d)
}

export function somaMeses(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export const diasNoMes = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function difDias(a: string, b: string) {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000)
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MESES_C = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export const DIAS_SEMANA = SEMANA

export function nomeMes(ym: string, comAno = true) {
  const [y, m] = ym.split('-').map(Number)
  return comAno ? `${MESES[m - 1]} de ${y}` : MESES[m - 1]
}
export const mesCurto = (ym: string) => MESES_C[Number(ym.split('-')[1]) - 1]

/** '15 nov' */
export function diaCurto(data: string) {
  const d = parse(data)
  return `${d.getDate()} ${MESES_C[d.getMonth()]}`
}

/** 'Hoje', 'Ontem', 'sexta, 13 de novembro' */
export function diaExtenso(data: string) {
  const dif = difDias(data, hoje())
  if (dif === 0) return 'Hoje'
  if (dif === -1) return 'Ontem'
  if (dif === 1) return 'Amanhã'
  const d = parse(data)
  return `${SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`
}

/** Texto de prazo de uma conta: 'vence hoje', 'venceu há 2 dias', 'vence em 3 dias' */
export function prazo(vencimento: string) {
  const dif = difDias(vencimento, hoje())
  if (dif === 0) return 'vence hoje'
  if (dif === 1) return 'vence amanhã'
  if (dif === -1) return 'venceu ontem'
  if (dif < 0) return `venceu há ${-dif} dias`
  return `vence em ${dif} dias`
}

export const capitaliza = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const primeiroNome = (s: string) => s.trim().split(/\s+/)[0] || ''

export function mascaraFone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function mascaraCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** Campo de dinheiro: o usuário digita só números e os centavos entram pela direita. */
export function centavosDe(texto: string) {
  const d = texto.replace(/\D/g, '').slice(0, 11)
  return d ? Number(d) / 100 : 0
}
export const dinheiroCampo = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
