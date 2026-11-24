/**
 * Ligar um pagamento (lançamento) à conta em aberto que ele pagou, e desligar sem perder dinheiro.
 *
 * Caso de origem (24/11/2026, Arthur): a Internet era R$ 120 e foi paga R$ 109. O lançamento de 109 não deu baixa na conta de 120 (deu baixa em
 * outra conta de mesmo nome que valia 109) e a de 120 ficou atrasada, com o gasto aparecendo em dobro. Faltava uma forma de dizer "este pagamento é
 * DESTA conta".
 *
 * Regras:
 *  - Uma conta só liga a um lançamento de saída (conta a pagar) ou de entrada (conta a receber), e um lançamento só liga a UMA conta.
 *  - Ao ligar, a conta passa a valer o que foi realmente pago e a data do pagamento: o histórico mostra o que saiu, não o previsto.
 *  - Desligar NUNCA apaga o lançamento a não ser que a pessoa peça: o dinheiro que saiu continua lançado.
 */
import type { Conta, Estado, Lancamento } from './tipos'

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const palavras = (t: string) => semAcento(t).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !['conta', 'pagamento', 'parcela', 'boleto', 'pix'].includes(p))
const dias = (a: string, b: string) => Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86_400_000

/** Que tipo de lançamento paga que tipo de conta. */
const tipoDoLancamento = (c: Conta): Lancamento['tipo'] => (c.tipo === 'pagar' ? 'saida' : 'entrada')

/** O lançamento já está ligado a alguma conta? */
export const contaDoLancamento = (a: Estado, lancId: string): Conta | undefined => a.contas.find((c) => c.lancId === lancId && c.status === 'paga')

/** Quanto o nome do lançamento parece com o da conta (0 a 2) e quão perto está o valor (0 a 1). */
function pontos(descConta: string, valorConta: number, descLanc: string, valorLanc: number) {
  const a = new Set(palavras(descConta))
  const mesmoNome = palavras(descLanc).some((p) => a.has(p)) ? 2 : 0
  const perto = valorConta > 0 && Math.abs(valorConta - valorLanc) / valorConta <= 0.25 ? 1 : 0
  return mesmoNome + perto
}

/** Um lançamento oferecido para pagar uma conta. `ocupada`: a conta que ele já paga hoje (aparece marcado; escolher passa o pagamento para esta conta). */
export interface Opcao {
  l: Lancamento
  ocupada?: Conta
}

/**
 * Lançamentos que PODEM ser o pagamento desta conta, do mais provável para o menos.
 * Sem busca: os últimos 60 dias em torno do vencimento, até 8. Com busca (nome ou valor): TODOS os lançamentos do tipo certo que combinam, até 30,
 * sem limite de data (a pessoa sabe o que procura). Quem já paga outra conta NÃO some: vem marcado em `ocupada`, porque muitas vezes é o pagamento certo
 * ligado à conta errada (caso do Arthur em 24/11: o pagamento de 109 estava ligado à conta de dezembro e a lista não o mostrava).
 */
export function candidatosParaConta(a: Estado, conta: Conta, hoje: string, busca = ''): Opcao[] {
  if (conta.status !== 'aberta') return []
  const q = semAcento(busca).trim()
  const qNum = q.replace(',', '.')
  return a.lancamentos
    .filter((l) => {
      if (l.tipo !== tipoDoLancamento(conta) || l.data > hoje) return false
      if (!q) return dias(l.data, conta.vencimento) <= 60
      return semAcento(l.descricao).includes(q) || l.valor.toFixed(2).includes(qNum) || l.valor.toFixed(2).replace('.', ',').includes(q)
    })
    .map((l) => ({ l, p: pontos(conta.descricao, conta.valor, l.descricao, l.valor), ocupada: contaDoLancamento(a, l.id) }))
    .sort((x, y) => y.p - x.p || dias(x.l.data, conta.vencimento) - dias(y.l.data, conta.vencimento))
    .slice(0, q ? 30 : 8)
    .map((x) => ({ l: x.l, ocupada: x.ocupada }))
}

/** Contas em aberto que este lançamento PODE ter pago, da mais provável para a menos (até 8). */
export function candidatasParaLancamento(a: Estado, l: Lancamento): Conta[] {
  if (l.tipo !== 'saida' && l.tipo !== 'entrada') return []
  if (contaDoLancamento(a, l.id)) return []
  return a.contas
    .filter((c) => c.status === 'aberta' && tipoDoLancamento(c) === l.tipo)
    .map((c) => ({ c, p: pontos(c.descricao, c.valor, l.descricao, l.valor) }))
    .sort((x, y) => y.p - x.p || dias(x.c.vencimento, l.data) - dias(y.c.vencimento, l.data))
    .slice(0, 8)
    .map((x) => x.c)
}

/** Liga o pagamento à conta: a conta fica paga, com a data e o valor do que foi realmente pago. Recusa (devolve o mesmo estado) o que não fecha. */
export function vincular(a: Estado, contaId: string, lancId: string): Estado {
  const c = a.contas.find((x) => x.id === contaId)
  const l = a.lancamentos.find((x) => x.id === lancId)
  if (!c || !l || c.status !== 'aberta') return a
  if (l.tipo !== tipoDoLancamento(c)) return a
  if (contaDoLancamento(a, lancId)) return a // já paga outra conta: ligar em duas contaria o mesmo dinheiro duas vezes
  return { ...a, contas: a.contas.map((x): Conta => (x.id === contaId ? { ...x, status: 'paga', pagoEm: l.data, lancId: l.id, valor: Math.round(l.valor * 100) / 100 } : x)) }
}

/**
 * Volta a conta para em aberto. Com `apagarPagamento` falso (o padrão) o lançamento FICA: o dinheiro que saiu continua lançado, só deixa de pagar esta conta.
 * O valor da conta não muda (quem ligou um pagamento de outro valor pode ajustar na própria ficha): nada é sobrescrito sem a pessoa saber.
 */
export function soltar(a: Estado, contaId: string, apagarPagamento = false): Estado {
  const c = a.contas.find((x) => x.id === contaId)
  if (!c || c.status !== 'paga') return a
  return {
    ...a,
    contas: a.contas.map((x): Conta => (x.id === contaId ? { ...x, status: 'aberta', pagoEm: undefined, lancId: undefined } : x)),
    lancamentos: apagarPagamento && c.lancId ? a.lancamentos.filter((l) => l.id !== c.lancId) : a.lancamentos,
  }
}

/**
 * Passa um pagamento de uma conta para outra: a conta que ele pagava volta a ficar em aberto (o lançamento FICA) e a nova fica paga com ele.
 * Se o pagamento não estava ligado a nada, é o mesmo que `vincular`. Recusa (devolve o mesmo estado) o que não fecha, sem desligar nada pela metade.
 */
export function religar(a: Estado, contaId: string, lancId: string): Estado {
  const c = a.contas.find((x) => x.id === contaId)
  const l = a.lancamentos.find((x) => x.id === lancId)
  if (!c || !l || c.status !== 'aberta' || l.tipo !== tipoDoLancamento(c)) return a
  const antiga = contaDoLancamento(a, lancId)
  if (!antiga) return vincular(a, contaId, lancId)
  return vincular(soltar(a, antiga.id, false), contaId, lancId)
}
