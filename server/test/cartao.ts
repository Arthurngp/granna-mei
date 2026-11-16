/** Prova a regra do cartão no regime de caixa, sem banco nem IA. Rodar: npx tsx test/cartao.ts */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { efetivos, faturaDe, faturas, type MovCartao } from '../src/cartao.ts'

let n = 0
const caso = (nome: string, fn: () => void) => {
  fn()
  n++
  console.log('  ok', nome)
}

const CARTS = [
  { id: 'itau', tipo: 'banco' },
  { id: 'nu', tipo: 'cartao', fechamento: 3, vencimento: 10 },
]
const compra = (id: string, valor: number, data: string, fatura: string, categoriaId = 'alimentacao'): MovCartao => ({ id, tipo: 'compra_cartao', valor, data, descricao: id, carteiraId: 'nu', categoriaId, fatura })
const paga = (id: string, valor: number, data: string): MovCartao => ({ id, tipo: 'transferencia', valor, data, descricao: 'Fatura', carteiraId: 'itau', carteiraDestinoId: 'nu' })

/** Mesma conta que o painel e o resumo do servidor fazem. */
function mes(ls: MovCartao[], ym: string) {
  const ef = efetivos(ls, CARTS).filter((l) => l.data.startsWith(ym))
  return {
    saiu: Math.round(ef.filter((l) => l.tipo === 'saida').reduce((a, l) => a + l.valor, 0) * 100) / 100,
    porCat: ef.filter((l) => l.tipo === 'saida').reduce<Record<string, number>>((a, l) => ({ ...a, [l.categoriaId!]: Math.round(((a[l.categoriaId!] ?? 0) + l.valor) * 100) / 100 }), {}),
  }
}
/** Saldo como o painel calcula: compra no cartão tira do cartão, pagamento tira do banco e põe no cartão. */
function saldo(ls: MovCartao[]) {
  const s: Record<string, number> = { itau: 0, nu: 0 }
  for (const l of ls) {
    if (l.tipo === 'entrada') s[l.carteiraId] += l.valor
    else if (l.tipo === 'saida') s[l.carteiraId] -= l.valor
    else {
      s[l.carteiraId] -= l.valor
      if (l.carteiraDestinoId) s[l.carteiraDestinoId] += l.valor
    }
  }
  return s
}

caso('as duas cópias do módulo são idênticas (painel e servidor)', () => {
  const a = readFileSync(new URL('../src/cartao.ts', import.meta.url), 'utf8')
  const b = readFileSync(new URL('../../src/lib/cartao.ts', import.meta.url), 'utf8')
  assert.equal(a, b)
})

caso('compra de 100 em novembro, fatura paga em dezembro: nov 0, dez 100 na categoria, banco -100, cartão zerado', () => {
  const ls = [compra('almoco', 100, '2026-11-20', '2026-12'), paga('p1', 100, '2026-12-10')]
  assert.equal(mes(ls, '2026-11').saiu, 0)
  assert.equal(mes(ls, '2026-12').saiu, 100)
  assert.deepEqual(mes(ls, '2026-12').porCat, { alimentacao: 100 })
  assert.deepEqual(saldo(ls), { itau: -100, nu: 0 })
})

caso('fatura ainda não paga não conta em mês nenhum, mas aparece como dívida no cartão', () => {
  const ls = [compra('almoco', 100, '2026-11-20', '2026-12')]
  assert.equal(mes(ls, '2026-11').saiu + mes(ls, '2026-12').saiu, 0)
  assert.equal(saldo(ls).nu, -100)
  assert.equal(faturas(ls, CARTS)[0].falta, 100)
})

caso('pagamento parcial conta só o que saiu do banco, dividido entre as categorias', () => {
  const ls = [compra('almoco', 300, '2026-11-20', '2026-12'), compra('gasolina', 100, '2026-11-21', '2026-12', 'transporte'), paga('p1', 200, '2026-12-10')]
  assert.equal(mes(ls, '2026-12').saiu, 200)
  assert.deepEqual(mes(ls, '2026-12').porCat, { alimentacao: 150, transporte: 50 })
  const f = faturas(ls, CARTS)[0]
  assert.equal(f.pago, 200)
  assert.equal(f.falta, 200)
})

caso('fatura paga em duas vezes, em meses diferentes, soma o total certo', () => {
  const ls = [compra('a', 400, '2026-11-20', '2026-12'), paga('p1', 150, '2026-12-10'), paga('p2', 250, '2027-01-05')]
  assert.equal(mes(ls, '2026-12').saiu, 150)
  assert.equal(mes(ls, '2027-01').saiu, 250)
})

caso('pagamento cobre a fatura mais antiga primeiro', () => {
  const ls = [compra('nov', 100, '2026-10-20', '2026-11'), compra('dez', 50, '2026-11-20', '2026-12'), paga('p1', 120, '2026-12-01')]
  const f = faturas(ls, CARTS)
  assert.equal(f.find((x) => x.fatura === '2026-11')!.falta, 0)
  assert.equal(f.find((x) => x.fatura === '2026-12')!.falta, 30)
  assert.equal(mes(ls, '2026-12').saiu, 120)
})

caso('pagamento acima do devido não vira gasto', () => {
  const ls = [compra('a', 100, '2026-11-20', '2026-12'), paga('p1', 150, '2026-12-10')]
  assert.equal(mes(ls, '2026-12').saiu, 100)
})

caso('parcelado 3x em faturas seguidas: cada mês conta só a parcela paga', () => {
  const ls = [
    compra('mat-1', 400, '2026-11-20', '2026-12', 'material'),
    compra('mat-2', 400, '2026-11-20', '2027-01', 'material'),
    compra('mat-3', 400, '2026-11-20', '2027-02', 'material'),
    paga('p1', 400, '2026-12-10'),
  ]
  assert.equal(mes(ls, '2026-12').saiu, 400)
  assert.equal(faturas(ls, CARTS).filter((f) => f.falta > 0).length, 2)
})

caso('fatura certa pela data: fecha dia 3, vence dia 10', () => {
  assert.equal(faturaDe('2026-11-02', 3, 10), '2026-11') // antes do fechamento: fatura que vence dia 10 deste mês
  assert.equal(faturaDe('2026-11-03', 3, 10), '2026-12') // no dia do fechamento: vai para a próxima
  assert.equal(faturaDe('2026-11-20', 3, 10), '2026-12')
})

caso('fatura certa quando o vencimento é antes do fechamento (fecha 25, vence 5)', () => {
  assert.equal(faturaDe('2026-11-10', 25, 5), '2026-12')
  assert.equal(faturaDe('2026-11-26', 25, 5), '2027-01')
})

caso('fechamento 31 em mês de 30 dias usa o último dia', () => {
  assert.equal(faturaDe('2026-11-30', 31, 8), '2027-01')
  assert.equal(faturaDe('2026-11-29', 31, 8), '2026-12')
})

caso('entradas, saídas comuns e transferências entre bancos passam iguais', () => {
  const ls: MovCartao[] = [
    { id: 'e', tipo: 'entrada', valor: 500, data: '2026-11-05', descricao: 'Corte', carteiraId: 'itau' },
    { id: 's', tipo: 'saida', valor: 80, data: '2026-11-06', descricao: 'Luz', carteiraId: 'itau' },
  ]
  assert.deepEqual(efetivos(ls, CARTS), ls)
})

console.log(`\n${n} casos ok`)
