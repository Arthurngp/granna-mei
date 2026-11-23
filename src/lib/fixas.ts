/**
 * Mudar uma conta fixa (valor, nome, dia) ou o valor de uma conta em aberto.
 *
 * Regras que valem para o painel inteiro (Ajustes e ficha da conta):
 *  - A conta fixa é a fonte: mudar o valor dela leva junto TODAS as contas em aberto que ela gerou, inclusive a vencida.
 *    Contas já pagas nunca mudam (o dinheiro já saiu).
 *  - Só o que mudou é tocado: trocar o valor não mexe no vencimento, trocar o nome não mexe no valor.
 *  - Valor zero ou negativo é recusado aqui, antes de chegar ao banco. O banco exige `valor > 0` em `fixas` e em `contas`, e uma gravação
 *    recusada faz a tela voltar ao que estava salvo: era assim que apagar "120,00" para digitar "109" desfazia a edição.
 */
import { vencimentoNoMes } from './format'
import type { Conta, Estado, Fixa } from './tipos'

const valorValido = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0
const centavos = (n: number) => Math.round(n * 100) / 100

export function mudarFixa(a: Estado, id: string, p: Partial<Pick<Fixa, 'descricao' | 'valor' | 'dia'>>): Estado {
  if (p.valor !== undefined && !valorValido(p.valor)) return a
  const atual = a.fixas.find((f) => f.id === id)
  if (!atual) return a
  const novo: Fixa = { ...atual, ...p, ...(p.valor !== undefined ? { valor: centavos(p.valor) } : {}) }
  const fixas = a.fixas.map((f) => (f.id === id ? novo : f))
  const contas = a.contas.map((c): Conta => {
    if (c.fixaId !== id || c.status !== 'aberta') return c
    return {
      ...c,
      ...(p.valor !== undefined ? { valor: novo.valor } : {}),
      ...(p.descricao !== undefined ? { descricao: novo.descricao } : {}),
      ...(p.dia !== undefined ? { vencimento: vencimentoNoMes(c.vencimento.slice(0, 7), novo.dia) } : {}),
    }
  })
  return { ...a, fixas, contas }
}

/** Valor de UMA conta em aberto que não vem de conta fixa. Conta paga e valor inválido ficam como estão. */
export function mudarValorConta(a: Estado, id: string, valor: number): Estado {
  if (!valorValido(valor)) return a
  const c = a.contas.find((x) => x.id === id)
  if (!c || c.status !== 'aberta') return a
  return { ...a, contas: a.contas.map((x) => (x.id === id ? { ...x, valor: centavos(valor) } : x)) }
}
