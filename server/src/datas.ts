/**
 * Datas de vencimento de contas que se repetem, numa função só: o executor do WhatsApp (executar.ts) e a reposição das contas fixas
 * (fixas-repor.ts) usam esta, para nunca divergirem. É a mesma regra do painel (src/lib/format.ts, vencimentoNoMes).
 *
 * No mês que não tem o dia, o vencimento vai para o último dia do mês (31 vira 30 em abril, 28 ou 29 em fevereiro). Cada vencimento
 * sai do dia CONFIGURADO, nunca do vencimento anterior: o 31 de março volta a ser 31 depois do 28 de fevereiro.
 */
const pad = (n: number) => String(n).padStart(2, '0')

/** 'AAAA-MM' + n meses. */
export function somaMeses(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function ultimoDiaDoMes(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** 'AAAA-MM-DD' do dia `dia` do mês `ym`, cortado no último dia do mês quando ele não existe. */
export function vencimentoNoMes(ym: string, dia: number): string {
  return `${ym}-${pad(Math.min(Math.max(1, Math.trunc(dia)), ultimoDiaDoMes(ym)))}`
}
