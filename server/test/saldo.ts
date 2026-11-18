/**
 * Prova a conta de saldo e as consultas de dinheiro, sem banco nem IA.
 *   npx tsx test/saldo.ts
 *
 * Caso de origem (2026-11-18): o Arthur lançou R$ 6 e o saldo não desceu. Aqui o saldo é provado número a número.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { MovCartao } from '../src/cartao.ts'
import {
  disponivelDaBase, ehPerguntaClara, linhasDeSaldoDepois, periodoDe, reconhecer, resumoDoPeriodo, responderConsulta, responderDireto, saldosDaBase,
  textoFixas, textoPeriodo, textoProximos, textoSaldo, type Base,
} from '../src/consultas.ts'
import { saldosDas } from '../src/saldo.ts'

// perguntas.ts abre o cliente do banco ao carregar; aqui nunca se conecta (tudo é função pura sobre dados em memória).
process.env.SUPABASE_URL ??= 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'falsa'
const { resumoDaBase } = await import('../src/perguntas.ts')

let n = 0
const caso = (nome: string, fn: () => void) => {
  fn()
  n++
  console.log('  ok', nome)
}

const HOJE = '2026-11-18' // quarta-feira
const mov = (id: string, tipo: MovCartao['tipo'], valor: number, data: string, carteiraId: string, extra: Partial<MovCartao> = {}): MovCartao => ({ id, tipo, valor, data, descricao: id, carteiraId, ...extra })

function base(): Base {
  return {
    carteiras: [
      { id: 'nubank', nome: 'Nubank', tipo: 'banco', saldoInicial: 1000 },
      { id: 'dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', saldoInicial: 50 },
      { id: 'cartao', nome: 'Cartão Inter', tipo: 'cartao', saldoInicial: 0, fechamento: 3, vencimento: 10 },
      { id: 'xp', nome: 'XP', tipo: 'investimento', saldoInicial: 500 },
    ],
    lancs: [
      mov('l1', 'entrada', 200, '2026-11-16', 'nubank', { categoriaId: 'vendas' }),
      mov('l2', 'saida', 6, '2026-11-18', 'nubank', { categoriaId: 'material' }),
      mov('l3', 'saida', 40, '2026-11-17', 'dinheiro', { categoriaId: 'material' }),
      mov('l4', 'compra_cartao', 100, '2026-11-10', 'cartao', { categoriaId: 'material', fatura: '2026-12' }),
      mov('l5', 'saida', 30, '2026-11-18', 'nubank', { pessoal: true }),
      mov('l6', 'entrada', 500, '2026-11-03', 'nubank', { categoriaId: 'vendas' }),
      mov('l7', 'saida', 80, '2026-10-28', 'nubank', { categoriaId: 'material' }),
    ],
    categorias: [{ id: 'vendas', nome: 'Vendas' }, { id: 'material', nome: 'Material' }],
    fixas: [{ descricao: 'Aluguel', valor: 900, dia: 10 }, { descricao: 'Internet', valor: 100, dia: 20 }, { descricao: 'DAS', valor: 75.9, dia: 20 }],
    contas: [
      { descricao: 'DAS atrasado', valor: 70, vencimento: '2026-11-15', tipo: 'pagar' },
      { descricao: 'Joana', valor: 300, vencimento: '2026-11-19', tipo: 'receber' },
      { descricao: 'Luz', valor: 150, vencimento: '2026-11-20', tipo: 'pagar' },
      { descricao: 'Internet', valor: 100, vencimento: '2026-11-20', tipo: 'pagar' },
      { descricao: 'Aluguel', valor: 900, vencimento: '2026-12-10', tipo: 'pagar' },
    ],
  }
}

/* ---------- a conta de saldo ---------- */

caso('as duas cópias do módulo de saldo são idênticas (painel e servidor)', () => {
  const a = readFileSync(new URL('../src/saldo.ts', import.meta.url), 'utf8')
  const b = readFileSync(new URL('../../src/lib/saldo.ts', import.meta.url), 'utf8')
  assert.equal(a, b)
})

caso('saldo de cada carteira bate com a conta feita à mão', () => {
  const s = saldosDaBase(base())
  assert.equal(s.nubank, 1584) // 1000 + 200 + 500 - 6 - 30 - 80
  assert.equal(s.dinheiro, 10) // 50 - 40
  assert.equal(s.cartao, -100) // compra no cartão é dívida
  assert.equal(s.xp, 500)
})

caso('disponível não conta cartão (dívida) nem investimento (guardado)', () => {
  assert.equal(disponivelDaBase(base()), 1594)
})

caso('CASO DOS R$ 6: lançar uma saída de 6 desce exatamente 6 na carteira e 6 no disponível', () => {
  const antes = base()
  const depois = base()
  depois.lancs.push(mov('novo', 'saida', 6, HOJE, 'nubank'))
  assert.equal(saldosDaBase(depois).nubank, saldosDaBase(antes).nubank - 6)
  assert.equal(disponivelDaBase(depois), disponivelDaBase(antes) - 6)
  assert.equal(saldosDaBase(depois).dinheiro, saldosDaBase(antes).dinheiro, 'a outra conta não mexe')
})

caso('lançar na conta ERRADA não mexe na conta certa (o que o Arthur pode ter vivido)', () => {
  const b = base()
  const antes = saldosDaBase(b).nubank
  b.lancs.push(mov('novo', 'saida', 6, HOJE, 'dinheiro'))
  assert.equal(saldosDaBase(b).nubank, antes)
  assert.equal(saldosDaBase(b).dinheiro, 4)
})

caso('entrada sobe o saldo', () => {
  const b = base()
  b.lancs.push(mov('e', 'entrada', 150, HOJE, 'nubank'))
  assert.equal(saldosDaBase(b).nubank, 1734)
})

caso('transferência entre contas muda onde está o dinheiro, não quanto há', () => {
  const b = base()
  const antes = disponivelDaBase(b)
  b.lancs.push(mov('t', 'transferencia', 100, HOJE, 'nubank', { carteiraDestinoId: 'dinheiro' }))
  const s = saldosDaBase(b)
  assert.equal(s.nubank, 1484)
  assert.equal(s.dinheiro, 110)
  assert.equal(disponivelDaBase(b), antes)
})

caso('guardar na XP tira do disponível, mas o dinheiro continua seu', () => {
  const b = base()
  b.lancs.push(mov('t', 'transferencia', 200, HOJE, 'nubank', { carteiraDestinoId: 'xp' }))
  assert.equal(disponivelDaBase(b), 1394)
  assert.equal(saldosDaBase(b).xp, 700)
})

caso('pagar a fatura tira do banco, zera a dívida do cartão e só então vira gasto', () => {
  const b = base()
  assert.equal(resumoDoPeriodo(b, '2026-11-01', '2026-11-30').saiu, 46, 'antes de pagar: compra do cartão não é gasto')
  b.lancs.push(mov('p', 'transferencia', 100, HOJE, 'nubank', { carteiraDestinoId: 'cartao' }))
  const s = saldosDaBase(b)
  assert.equal(s.cartao, 0)
  assert.equal(s.nubank, 1484)
  assert.equal(disponivelDaBase(b), 1494)
  assert.equal(resumoDoPeriodo(b, '2026-11-01', '2026-11-30').saiu, 146, 'depois de pagar: entra no gasto')
})

caso('centavos não vazam: 0,10 + 0,20 é 0,30 e não 0,30000000000000004', () => {
  const s = saldosDas([{ id: 'a', saldoInicial: 0 }], [
    { tipo: 'entrada', valor: 0.1, carteiraId: 'a' },
    { tipo: 'entrada', valor: 0.2, carteiraId: 'a' },
  ])
  assert.equal(s.a, 0.3)
})

caso('lançamento numa carteira que não existe mais não quebra a conta', () => {
  const s = saldosDas([{ id: 'a', saldoInicial: 10 }], [{ tipo: 'saida', valor: 3, carteiraId: 'sumiu' }])
  assert.equal(s.a, 10)
})

caso('a conta única bate com a soma feita à mão em 200 carteiras aleatórias', () => {
  // Gerador com semente fixa: o teste repete igual todo dia.
  let x = 12345
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const tipos = ['entrada', 'saida', 'transferencia', 'compra_cartao']
  for (let rodada = 0; rodada < 200; rodada++) {
    const cs = ['a', 'b', 'c'].map((id) => ({ id, saldoInicial: Math.round(rnd() * 100000) / 100 }))
    const ms = Array.from({ length: 30 }, () => ({
      tipo: tipos[Math.floor(rnd() * 4)],
      valor: Math.round(rnd() * 50000) / 100 + 0.01,
      carteiraId: ['a', 'b', 'c'][Math.floor(rnd() * 3)],
      carteiraDestinoId: ['a', 'b', 'c'][Math.floor(rnd() * 3)],
    }))
    // Conta direta, sem o módulo: a soma que qualquer pessoa faria à mão.
    const mao: Record<string, number> = Object.fromEntries(cs.map((c) => [c.id, c.saldoInicial]))
    for (const m of ms) {
      if (m.tipo === 'entrada') mao[m.carteiraId] += m.valor
      else if (m.tipo === 'saida') mao[m.carteiraId] -= m.valor
      else {
        mao[m.carteiraId] -= m.valor
        if (m.tipo === 'transferencia') mao[m.carteiraDestinoId] += m.valor
      }
    }
    // compra_cartao não tem destino: o módulo só põe no destino se vier carteiraDestinoId; aqui ele existe em todos, então não vale
    const msCerto = ms.map((m) => (m.tipo === 'transferencia' ? m : { ...m, carteiraDestinoId: undefined }))
    const s = saldosDas(cs, msCerto)
    for (const c of cs) assert.ok(Math.abs(s[c.id] - mao[c.id]) < 0.005, `rodada ${rodada} carteira ${c.id}: ${s[c.id]} x ${mao[c.id]}`)
  }
})

/* ---------- confirmação depois de lançar ---------- */

caso('confirmação de saída: mostra o saldo da conta tocada e o disponível', () => {
  const b = base()
  b.lancs.push(mov('novo', 'saida', 6, HOJE, 'nubank'))
  assert.equal(linhasDeSaldoDepois(b, ['nubank']), 'Saldo Nubank: R$ 1.578,00\nDisponível no total: R$ 1.588,00')
})

caso('confirmação sem repetir: conta única mostra só uma linha', () => {
  const b = base()
  b.carteiras = [b.carteiras[0]]
  b.lancs = []
  assert.equal(linhasDeSaldoDepois(b, ['nubank']), 'Saldo Nubank: R$ 1.000,00')
})

caso('confirmação de transferência mostra as duas contas', () => {
  const b = base()
  b.lancs.push(mov('t', 'transferencia', 100, HOJE, 'nubank', { carteiraDestinoId: 'dinheiro' }))
  const t = linhasDeSaldoDepois(b, ['nubank', 'dinheiro'])
  assert.match(t, /Saldo Nubank: R\$ 1\.484,00/)
  assert.match(t, /Saldo Dinheiro: R\$ 110,00/)
  assert.match(t, /Disponível no total: R\$ 1\.594,00/)
})

caso('confirmação de compra no cartão fala da fatura, não de saldo', () => {
  const t = linhasDeSaldoDepois(base(), ['cartao'])
  assert.match(t, /Cartão Inter: fatura em aberto de R\$ 100,00/)
  assert.match(t, /Disponível no total: R\$ 1\.594,00/)
})

caso('carteira repetida e vazia não duplica linha nem quebra', () => {
  assert.equal(linhasDeSaldoDepois(base(), ['nubank', 'nubank', '', null, undefined]).split('\n').length, 2)
  assert.equal(linhasDeSaldoDepois(base(), []), '')
  assert.equal(linhasDeSaldoDepois(base(), ['nao-existe']), '')
})

/* ---------- consulta de saldo ---------- */

caso('"qual meu saldo" lista cada conta, o total, a dívida do cartão e o investimento à parte', () => {
  const t = textoSaldo(base())
  assert.match(t, /Nubank: R\$ 1\.584,00/)
  assert.match(t, /Dinheiro: R\$ 10,00/)
  assert.match(t, /Disponível no total: R\$ 1\.594,00/)
  assert.match(t, /Cartão Inter: fatura em aberto de R\$ 100,00/)
  assert.match(t, /XP: R\$ 500,00 guardado/)
})

caso('saldo negativo aparece com sinal', () => {
  const b = base()
  b.lancs.push(mov('g', 'saida', 5000, HOJE, 'nubank'))
  assert.match(textoSaldo(b), /Nubank: -R\$ 3\.416,00/)
})

/* ---------- períodos ---------- */

caso('períodos: hoje, ontem, semana (segunda a hoje), mês e mês passado', () => {
  assert.deepEqual(periodoDe(HOJE, 'hoje'), { de: HOJE, ate: HOJE, rotulo: 'Hoje (18/11)' })
  assert.equal(periodoDe(HOJE, 'ontem').de, '2026-11-17')
  assert.equal(periodoDe(HOJE, 'semana').de, '2026-11-16')
  assert.equal(periodoDe('2026-11-22', 'semana').de, '2026-11-16', 'domingo ainda é da semana que começou na segunda')
  assert.equal(periodoDe('2026-11-16', 'semana').de, '2026-11-16', 'na segunda a semana tem 1 dia')
  assert.equal(periodoDe(HOJE, 'mes').de, '2026-11-01')
  assert.deepEqual([periodoDe(HOJE, 'mes_passado').de, periodoDe(HOJE, 'mes_passado').ate], ['2026-10-01', '2026-10-31'])
  assert.deepEqual([periodoDe('2026-01-15', 'mes_passado').de, periodoDe('2026-01-15', 'mes_passado').ate], ['2025-12-01', '2025-12-31'], 'virada de ano')
  assert.equal(periodoDe('2026-03-02', '7dias').de, '2026-02-24')
})

caso('entrou e saiu: hoje, semana, mês, mês passado batem com a conta à mão', () => {
  const b = base()
  const r = (de: string, ate: string) => {
    const x = resumoDoPeriodo(b, de, ate)
    return [x.entrou, x.saiu, x.retiradas]
  }
  assert.deepEqual(r(HOJE, HOJE), [0, 6, 30])
  assert.deepEqual(r('2026-11-16', HOJE), [200, 46, 30])
  assert.deepEqual(r('2026-11-01', HOJE), [700, 46, 30])
  assert.deepEqual(r('2026-10-01', '2026-10-31'), [0, 80, 0])
})

caso('retirada do dono não entra no "saiu" do negócio, mas é dita', () => {
  const t = textoPeriodo(base(), periodoDe(HOJE, 'hoje'), 'saida', false)
  assert.match(t, /saiu R\$ 6,00/)
  assert.match(t, /Retiradas do dono: R\$ 30,00/)
})

caso('fatura aberta do cartão é avisada ao falar de gasto (valor real, não ilusão)', () => {
  const t = textoPeriodo(base(), periodoDe(HOJE, 'mes'), 'saida', false)
  assert.match(t, /No cartão há R\$ 100,00 em fatura aberta/)
})

caso('só entrada não fala de gasto', () => {
  const t = textoPeriodo(base(), periodoDe(HOJE, 'mes'), 'entrada', false)
  assert.match(t, /entrou R\$ 700,00/)
  assert.ok(!/saiu|Retiradas|cartão/.test(t))
})

caso('"ambos" traz o que sobrou', () => {
  assert.match(textoPeriodo(base(), periodoDe(HOJE, 'mes'), 'ambos', false), /Sobrou R\$ 654,00/)
})

caso('por dia: um dia por linha, com dia da semana, e o total fecha', () => {
  const t = textoPeriodo(base(), periodoDe(HOJE, 'semana'), 'saida', true)
  assert.match(t, /ter 17\/11: saiu R\$ 40,00/)
  assert.match(t, /qua 18\/11: saiu R\$ 6,00/)
  assert.ok(!/seg 16\/11/.test(t), 'dia sem gasto não aparece')
  assert.match(t, /Total: saiu R\$ 46,00/)
})

caso('período vazio diz que não há nada, sem inventar zero bonito', () => {
  const b = base()
  b.lancs = []
  assert.match(textoPeriodo(b, periodoDe(HOJE, 'hoje'), 'ambos', false), /nada anotado/)
})

/* ---------- fixas e vencimentos ---------- */

caso('contas fixas: lista por dia, soma e o que ainda falta no mês', () => {
  const t = textoFixas(base(), HOJE)
  assert.match(t, /Dia 10: Aluguel R\$ 900,00 \(já passou neste mês\)/)
  assert.match(t, /Dia 20: Internet R\$ 100,00\n/)
  assert.match(t, /Total por mês: R\$ 1\.075,90/)
  assert.match(t, /Ainda falta pagar neste mês: R\$ 175,90/)
})

caso('sem conta fixa: ensina a cadastrar', () => {
  const b = base()
  b.fixas = []
  assert.match(textoFixas(b, HOJE), /aluguel de 1200 todo dia 5/)
})

caso('próximos 7 dias: atrasadas à parte, dia a dia, a receber marcado, fatura do cartão entra quando vence na janela', () => {
  const t = textoProximos(base(), HOJE, 7)
  assert.match(t, /Atrasadas:\n15\/11: DAS atrasado R\$ 70,00/)
  assert.match(t, /qui 19\/11: Joana R\$ 300,00 \(a receber\)/)
  assert.match(t, /sex 20\/11: Luz R\$ 150,00 \+ Internet R\$ 100,00/)
  assert.ok(!/Aluguel/.test(t), 'fora da janela não entra')
  assert.match(t, /Total: a pagar R\$ 320,00, a receber R\$ 300,00/)
})

caso('fatura do cartão que vence dentro da janela aparece com o que falta', () => {
  const t = textoProximos(base(), '2026-12-05', 7)
  assert.match(t, /Fatura Cartão Inter R\$ 100,00/)
})

caso('nada vencendo: diz até que dia olhou', () => {
  const b = base()
  b.contas = []
  b.lancs = []
  assert.match(textoProximos(b, HOJE, 7), /até 25\/11/)
})

/* ---------- entender o pedido ---------- */

const PEDIDOS: [string, unknown][] = [
  ['qual meu saldo', { tipo: 'saldo' }],
  ['saldo', { tipo: 'saldo' }],
  ['Qual é o meu saldo agora?', { tipo: 'saldo' }],
  ['quanto eu tenho?', { tipo: 'saldo' }],
  ['quanto tenho na conta', { tipo: 'saldo' }],
  ['quanto tem no caixa? dinheiro disponível', { tipo: 'saldo' }],
  ['quanto entrou hoje', { tipo: 'periodo', periodo: 'hoje', direcao: 'entrada', porDia: false }],
  ['quanto recebi ontem?', { tipo: 'periodo', periodo: 'ontem', direcao: 'entrada', porDia: false }],
  ['quanto saiu essa semana', { tipo: 'periodo', periodo: 'semana', direcao: 'saida', porDia: false }],
  ['meus gastos de hoje', { tipo: 'periodo', periodo: 'hoje', direcao: 'saida', porDia: false }],
  ['gastos do dia', { tipo: 'periodo', periodo: 'hoje', direcao: 'saida', porDia: false }],
  ['quanto gastei esse mês', { tipo: 'periodo', periodo: 'mes', direcao: 'saida', porDia: false }],
  ['quanto gastei no mês passado', { tipo: 'periodo', periodo: 'mes_passado', direcao: 'saida', porDia: false }],
  ['meus gastos', { tipo: 'periodo', periodo: 'mes', direcao: 'saida', porDia: false }],
  ['minhas despesas', { tipo: 'periodo', periodo: 'mes', direcao: 'saida', porDia: false }],
  ['gastos por dia', { tipo: 'periodo', periodo: '7dias', direcao: 'saida', porDia: true }],
  ['gastos por dia dessa semana', { tipo: 'periodo', periodo: 'semana', direcao: 'saida', porDia: true }],
  ['quanto entrou e saiu esse mês', { tipo: 'periodo', periodo: 'mes', direcao: 'ambos', porDia: false }],
  ['quanto sobrou esse mês?', { tipo: 'periodo', periodo: 'mes', direcao: 'ambos', porDia: false }],
  ['saldo do mês', { tipo: 'periodo', periodo: 'mes', direcao: 'ambos', porDia: false }],
  ['resumo da semana', { tipo: 'periodo', periodo: 'semana', direcao: 'ambos', porDia: false }],
  ['meus gastos fixos', { tipo: 'fixas' }],
  ['quais são minhas contas fixas?', { tipo: 'fixas' }],
  ['o que vence nos próximos dias', { tipo: 'proximos', dias: 7 }],
  ['contas a pagar nos próximos 15 dias', { tipo: 'proximos', dias: 15 }],
  ['o que eu tenho a pagar', { tipo: 'proximos', dias: 7 }],
]
for (const [frase, esperado] of PEDIDOS) {
  caso(`entende "${frase}"`, () => assert.deepEqual(reconhecer(frase), esperado))
}

// O que NÃO pode virar consulta: lançamento, assunto específico, conversa.
const NAO_CONSULTA = [
  'paguei 50 de luz',
  'gastei 6 reais no mercado',
  'recebi 150 da Juliana no pix',
  'quanto gastei com material?',
  'quanto entrou de pix esse mês',
  'quanto recebi da Juliana',
  'oi',
  'bom dia',
  'desfazer',
  'aluguel 900 todo dia 10',
  'gastei 12,50 hoje',
]
for (const frase of NAO_CONSULTA) {
  caso(`NÃO trata como consulta: "${frase}"`, () => assert.equal(reconhecer(frase), null))
}

caso('pergunta clara pula a IA; lançamento nunca', () => {
  for (const q of ['qual meu saldo', 'quanto entrou hoje?', 'saldo', 'me mostra os gastos de hoje', 'resumo da semana']) assert.ok(ehPerguntaClara(q), q)
  for (const q of ['meus gastos de hoje', 'gastos por dia', 'meus gastos fixos', 'o que vence nos próximos dias', 'contas a pagar', 'gastos do mês']) assert.ok(ehPerguntaClara(q), q)
  for (const q of ['gastei hoje', 'recebi hoje', 'paguei o mês todo', 'saiu o aluguel hoje', 'gastei 6 reais', 'paguei a luz', 'recebi do João', 'quanto vale 50 + 30', 'uma frase bem longa que não é pergunta nenhuma, só conversa de quem está explicando o que aconteceu com o caixa hoje de manhã']) assert.ok(!ehPerguntaClara(q), q)
})

caso('responderDireto devolve null para o que é da IA, e texto para o que é do código', () => {
  assert.equal(responderDireto('quanto gastei com material?', base(), HOJE), null)
  assert.match(responderDireto('qual meu saldo', base(), HOJE) ?? '', /Disponível no total: R\$ 1\.594,00/)
})

caso('toda resposta de código sai limpa: sem markdown, sem emoji, sem travessão', () => {
  const b = base()
  for (const [frase] of PEDIDOS) {
    const c = reconhecer(frase)!
    const t = responderConsulta(c, b, HOJE)
    assert.ok(!/[*_#`—–]/.test(t), `${frase}: ${t}`)
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${frase}: emoji`)
    assert.ok(t.trim().length > 0)
  }
})

/* ---------- resumo da IA ---------- */

caso('o resumo da IA traz o saldo real pronto e os períodos calculados', () => {
  const r = resumoDaBase(base(), HOJE)
  assert.equal(r.disponivel, 1594)
  assert.deepEqual(r.periodos.hoje, { de: HOJE, ate: HOJE, entrou: 0, saiu: 6, retiradas: 30, sobrou: -6 })
  assert.equal(r.periodos.semana_atual.entrou, 200)
  assert.equal(r.periodos.mes_atual.saiu, 46)
  assert.equal(r.contas_fixas.length, 3)
  assert.equal(r.carteiras.find((c) => c.nome === 'Nubank')?.saldo, 1584)
})

console.log(`\n${n} casos ok`)
