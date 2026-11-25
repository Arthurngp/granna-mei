/**
 * Print da tela do banco: saldo e extrato.
 *
 * O onboarding pelo WhatsApp (pedido do Arthur em 24/11) vai pedir para a pessoa mandar prints do banco. Até aqui, a tela de saldo do app virava
 * "isso não parece um comprovante", e o print de extrato perguntava de qual conta era mesmo quando o próprio print dizia o banco.
 *
 * Regras:
 * - Print de saldo NUNCA vira lançamento (a leitura já descarta transações; aqui só se conversa sobre ele).
 * - Fora da configuração, o saldo do print NUNCA muda o saldo anotado em silêncio: a Granninha compara e, se não bate, sugere mandar o extrato,
 *   que é o que explica a diferença. Mexer no saldo à mão é no painel.
 * - Extrato com o banco escrito: se ele bate com UMA conta de banco da pessoa, é dessa conta, sem perguntar qual.
 *
 * Funções puras: quem lê e grava é o granninha.ts.
 */
import { chaveBanco } from './cruzar.ts'

export interface CarteiraSimples {
  id: string
  nome: string
  tipo: string
}

/** A conta de banco da pessoa a que o nome do banco do print se refere, se for UMA só (duas do mesmo banco: não decide). */
export function carteiraDoBanco<T extends CarteiraSimples>(banco: string | null | undefined, carteiras: T[]): T | null {
  const chave = chaveBanco(banco)
  if (!chave) return null
  const iguais = carteiras.filter((c) => c.tipo === 'banco' && chaveBanco(c.nome) === chave)
  return iguais.length === 1 ? iguais[0] : null
}

const real = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** O nome do banco do jeito que se fala (o print às vezes traz "NU PAGAMENTOS - IP"). */
const nomeDoBanco = (banco: string | null | undefined, carteira: CarteiraSimples | null) => carteira?.nome ?? (banco ?? '').trim()

/** O que dizer quando chega um print de saldo, fora da configuração. Sem emoji e sem travessão. */
export function textoSaldoLido(banco: string | null | undefined, saldo: number | null | undefined, carteira: CarteiraSimples | null, anotado: number | null): string {
  if (typeof saldo !== 'number') return 'Vi a tela do seu banco, mas não deu pra ler o saldo. Se quiser, me diz quanto tem nessa conta.'
  const nome = nomeDoBanco(banco, carteira)
  if (!carteira || anotado === null) {
    return `Vi o saldo de ${real(saldo)}${nome ? ` no ${nome}` : ''}, mas não tenho essa conta entre as suas. Dá pra cadastrar no painel, em Ajustes, e aí eu acompanho ela também.`
  }
  const diferenca = Math.round((saldo - anotado) * 100) / 100
  if (Math.abs(diferenca) < 0.01) return `Conferi: no ${nome} aqui também está ${real(saldo)}. Tudo batendo.`
  return `Vi ${real(saldo)} de saldo no ${nome}, e aqui eu tenho ${real(anotado)} anotado. A diferença de ${real(Math.abs(diferenca))} costuma ser algo que ${diferenca > 0 ? 'entrou' : 'saiu'} e não me contou. Se quiser, me manda o extrato desses dias que eu confiro e anoto o que falta.`
}
