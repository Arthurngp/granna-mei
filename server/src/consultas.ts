/**
 * Consultas do dinheiro respondidas por CÓDIGO, nunca pela IA: saldo, quanto entrou e saiu, gastos por dia,
 * contas fixas e o que vence nos próximos dias. A IA entende o pedido; o número vem daqui e é o mesmo do painel
 * (saldo.ts e cartao.ts são os mesmos arquivos nos dois lados).
 *
 * Tudo aqui é função pura sobre uma `Base` já carregada: sem banco, sem IA, testável a seco.
 */
import { efetivos, faturas, foraDoDisponivel, type CartaoInfo, type MovCartao } from './cartao.ts'
import { temPistaDeCorrecao } from './duplicata.ts'
import { centavosDe, saldosDas } from './saldo.ts'

export interface CarteiraBase {
  id: string
  nome: string
  tipo: string
  saldoInicial: number
  fechamento?: number
  vencimento?: number
}
export interface FixaBase {
  descricao: string
  valor: number
  dia: number
}
export interface ContaBase {
  descricao: string
  valor: number
  vencimento: string
  tipo: 'pagar' | 'receber'
}
export interface Base {
  carteiras: CarteiraBase[]
  lancs: MovCartao[]
  categorias: { id: string; nome: string }[]
  fixas: FixaBase[]
  contas: ContaBase[]
}

/* ---------- formatação ---------- */

export const brl = (n: number) => {
  const v = centavosDe(n)
  const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-R$ ${s}` : `R$ ${s}`
}
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const diaSemana = (d: string) => `${DIAS_SEMANA[new Date(d + 'T12:00:00Z').getUTCDay()]} ${diaMes(d)}`
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const somaDias = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const primeiroDoMes = (d: string) => d.slice(0, 8) + '01'
const ultimoDoMes = (d: string) => {
  const x = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0, 12))
  return x.toISOString().slice(0, 10)
}

/* ---------- saldo ---------- */

const cartoesDe = (b: Base): CartaoInfo[] => b.carteiras.map((c) => ({ id: c.id, tipo: c.tipo, fechamento: c.fechamento, vencimento: c.vencimento }))

export function saldosDaBase(b: Base): Record<string, number> {
  return saldosDas(b.carteiras, b.lancs)
}

/** Dinheiro disponível: contas e dinheiro em mãos. Cartão é dívida e investimento é guardado, então ficam de fora. */
export function disponivelDaBase(b: Base, sal = saldosDaBase(b)): number {
  return centavosDe(b.carteiras.filter((c) => !foraDoDisponivel(c.tipo)).reduce((a, c) => a + (sal[c.id] ?? 0), 0))
}

/** Resposta completa a "qual meu saldo?": cada conta, o total disponível, e à parte cartão e investimento. */
export function textoSaldo(b: Base): string {
  const sal = saldosDaBase(b)
  const contas = b.carteiras.filter((c) => !foraDoDisponivel(c.tipo))
  if (!contas.length) return 'Você ainda não tem conta cadastrada. Cadastre em Ajustes > Carteiras no painel e eu passo a mostrar o saldo.'
  const linhas = ['Seu saldo agora:', ...contas.map((c) => `${c.nome}: ${brl(sal[c.id] ?? 0)}`)]
  if (contas.length > 1) linhas.push(`Disponível no total: ${brl(disponivelDaBase(b, sal))}`)
  for (const c of b.carteiras.filter((x) => x.tipo === 'cartao')) {
    const s = sal[c.id] ?? 0
    linhas.push(s < 0 ? `${c.nome}: fatura em aberto de ${brl(-s)} (fora do disponível)` : `${c.nome}: sem fatura em aberto`)
  }
  for (const c of b.carteiras.filter((x) => x.tipo === 'investimento')) linhas.push(`${c.nome}: ${brl(sal[c.id] ?? 0)} guardado (fora do disponível)`)
  return linhas.join('\n')
}

/** As linhas que fecham a confirmação de um lançamento: onde ficou o saldo e quanto há disponível. */
export function linhasDeSaldoDepois(b: Base, carteiraIds: (string | null | undefined)[]): string {
  const sal = saldosDaBase(b)
  const ids = [...new Set(carteiraIds.filter((x): x is string => !!x))]
  const tocadas = ids.map((id) => b.carteiras.find((c) => c.id === id)).filter((c): c is CarteiraBase => !!c)
  if (!tocadas.length) return ''
  const linhas = tocadas.map((c) => {
    const s = sal[c.id] ?? 0
    if (c.tipo === 'cartao') return s < 0 ? `${c.nome}: fatura em aberto de ${brl(-s)}` : `${c.nome}: sem fatura em aberto`
    if (c.tipo === 'investimento') return `${c.nome}: ${brl(s)} guardado`
    return `Saldo ${c.nome}: ${brl(s)}`
  })
  const contas = b.carteiras.filter((c) => !foraDoDisponivel(c.tipo))
  const soUmaConta = contas.length === 1 && tocadas.length === 1 && tocadas[0].id === contas[0].id
  if (contas.length && !soUmaConta) linhas.push(`Disponível no total: ${brl(disponivelDaBase(b, sal))}`)
  return linhas.join('\n')
}

/* ---------- períodos ---------- */

export type QualPeriodo = 'hoje' | 'ontem' | 'semana' | '7dias' | 'mes' | 'mes_passado' | 'ano'
export interface Periodo {
  de: string
  ate: string
  rotulo: string
}

export function periodoDe(hoje: string, qual: QualPeriodo): Periodo {
  const dow = new Date(hoje + 'T12:00:00Z').getUTCDay()
  switch (qual) {
    case 'hoje':
      return { de: hoje, ate: hoje, rotulo: `Hoje (${diaMes(hoje)})` }
    case 'ontem': {
      const o = somaDias(hoje, -1)
      return { de: o, ate: o, rotulo: `Ontem (${diaMes(o)})` }
    }
    case 'semana': {
      const seg = somaDias(hoje, -((dow + 6) % 7))
      return { de: seg, ate: hoje, rotulo: `Esta semana (de ${diaMes(seg)} a ${diaMes(hoje)})` }
    }
    case '7dias':
      return { de: somaDias(hoje, -6), ate: hoje, rotulo: `Últimos 7 dias (de ${diaMes(somaDias(hoje, -6))} a ${diaMes(hoje)})` }
    case 'mes_passado': {
      const ult = somaDias(primeiroDoMes(hoje), -1)
      return { de: primeiroDoMes(ult), ate: ult, rotulo: `${MESES[Number(ult.slice(5, 7)) - 1][0].toUpperCase()}${MESES[Number(ult.slice(5, 7)) - 1].slice(1)}` }
    }
    case 'ano':
      return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje, rotulo: `Ano de ${hoje.slice(0, 4)}` }
    default:
      return { de: primeiroDoMes(hoje), ate: hoje, rotulo: `Este mês (${MESES[Number(hoje.slice(5, 7)) - 1]})` }
  }
}

export interface ResumoPeriodo {
  entrou: number
  saiu: number
  retiradas: number
  porDia: { dia: string; entrou: number; saiu: number }[]
  categoriasSaida: { nome: string; valor: number }[]
  categoriasEntrada: { nome: string; valor: number }[]
}

/** Como o painel conta: entrou e saiu do CAIXA (compra no cartão só vira gasto quando a fatura é paga); retirada do dono à parte. */
export function resumoDoPeriodo(b: Base, de: string, ate: string): ResumoPeriodo {
  const ef = efetivos(b.lancs, cartoesDe(b)).filter((l) => l.data >= de && l.data <= ate && l.tipo !== 'transferencia')
  const nome = (id?: string) => b.categorias.find((c) => c.id === id)?.nome ?? 'Sem categoria'
  const dias = new Map<string, { entrou: number; saiu: number }>()
  const cs = new Map<string, number>()
  const ce = new Map<string, number>()
  let entrou = 0
  let saiu = 0
  let retiradas = 0
  for (const l of ef) {
    const d = dias.get(l.data) ?? { entrou: 0, saiu: 0 }
    if (l.tipo === 'entrada') {
      entrou += l.valor
      d.entrou += l.valor
      ce.set(nome(l.categoriaId), (ce.get(nome(l.categoriaId)) ?? 0) + l.valor)
    } else if (l.pessoal) retiradas += l.valor
    else {
      saiu += l.valor
      d.saiu += l.valor
      cs.set(nome(l.categoriaId), (cs.get(nome(l.categoriaId)) ?? 0) + l.valor)
    }
    dias.set(l.data, d)
  }
  const ordena = (m: Map<string, number>) => [...m.entries()].map(([n, v]) => ({ nome: n, valor: centavosDe(v) })).sort((a, c) => c.valor - a.valor)
  return {
    entrou: centavosDe(entrou),
    saiu: centavosDe(saiu),
    retiradas: centavosDe(retiradas),
    porDia: [...dias.entries()].sort().map(([dia, v]) => ({ dia, entrou: centavosDe(v.entrou), saiu: centavosDe(v.saiu) })),
    categoriasSaida: ordena(cs),
    categoriasEntrada: ordena(ce),
  }
}

/** Quanto há em faturas de cartão ainda não pagas (compra feita, dinheiro ainda não saiu). */
export function faturasEmAberto(b: Base): number {
  return centavosDe(faturas(b.lancs, cartoesDe(b)).reduce((a, f) => a + f.falta, 0))
}

export type Direcao = 'entrada' | 'saida' | 'ambos'

export function textoPeriodo(b: Base, p: Periodo, direcao: Direcao, porDia: boolean): string {
  const r = resumoDoPeriodo(b, p.de, p.ate)
  const quer = (d: 'entrada' | 'saida') => direcao === 'ambos' || direcao === d
  const linhas: string[] = []
  if (porDia) {
    linhas.push(`${p.rotulo}, dia a dia:`)
    // Dia sem movimento do tipo pedido não aparece: a lista mostra onde o dinheiro mexeu.
    const dias = r.porDia.filter((d) => (quer('entrada') && d.entrou > 0) || (quer('saida') && d.saiu > 0))
    if (!dias.length) linhas.push('Nada anotado nesse período.')
    for (const d of dias) {
      const partes: string[] = []
      if (quer('entrada') && d.entrou > 0) partes.push(`entrou ${brl(d.entrou)}`)
      if (quer('saida') && d.saiu > 0) partes.push(`saiu ${brl(d.saiu)}`)
      linhas.push(`${diaSemana(d.dia)}: ${partes.join(', ')}`)
    }
    const tot: string[] = []
    if (quer('entrada')) tot.push(`entrou ${brl(r.entrou)}`)
    if (quer('saida')) tot.push(`saiu ${brl(r.saiu)}`)
    linhas.push(`Total: ${tot.join(', ')}`)
  } else {
    const nada = r.entrou === 0 && r.saiu === 0 && r.retiradas === 0
    if (nada) linhas.push(`${p.rotulo}: nada anotado.`)
    else {
      const partes: string[] = []
      if (quer('entrada')) partes.push(`entrou ${brl(r.entrou)}`)
      if (quer('saida')) partes.push(`saiu ${brl(r.saiu)}`)
      linhas.push(`${p.rotulo}: ${partes.join(', ')}.`)
      // Resultado negativo não vira "sobrou -R$": diz com palavras de gente que saiu mais do que entrou.
      if (direcao === 'ambos') linhas.push(r.entrou - r.saiu >= 0 ? `Sobrou ${brl(r.entrou - r.saiu)}.` : `Ficou ${brl(r.saiu - r.entrou)} abaixo: saiu mais do que entrou.`)
      if (quer('saida') && r.categoriasSaida.length) linhas.push(`Onde mais saiu: ${r.categoriasSaida.slice(0, 3).map((c) => `${c.nome} ${brl(c.valor)}`).join(', ')}.`)
      if (direcao === 'entrada' && r.categoriasEntrada.length > 1) linhas.push(`Mais entrou por: ${r.categoriasEntrada.slice(0, 3).map((c) => `${c.nome} ${brl(c.valor)}`).join(', ')}.`)
    }
  }
  if (quer('saida') && r.retiradas > 0) linhas.push(`Retiradas do dono: ${brl(r.retiradas)} (ficam fora do resultado do negócio).`)
  const aberto = faturasEmAberto(b)
  if (quer('saida') && aberto > 0) linhas.push(`No cartão há ${brl(aberto)} em fatura aberta: só vira gasto quando você pagar.`)
  return linhas.join('\n')
}

/* ---------- contas fixas e vencimentos ---------- */

export function textoFixas(b: Base, hoje: string): string {
  if (!b.fixas.length) return 'Você não tem conta fixa cadastrada. Para cadastrar, me diga: "aluguel de 1200 todo dia 5".'
  const fixas = [...b.fixas].sort((a, c) => a.dia - c.dia)
  const total = centavosDe(fixas.reduce((a, f) => a + f.valor, 0))
  const diaHoje = Number(hoje.slice(8, 10))
  const linhas = ['Suas contas fixas:', ...fixas.map((f) => `Dia ${String(f.dia).padStart(2, '0')}: ${f.descricao} ${brl(f.valor)}${f.dia >= diaHoje ? '' : ' (já passou neste mês)'}`)]
  linhas.push(`Total por mês: ${brl(total)}`)
  const faltam = centavosDe(fixas.filter((f) => f.dia >= diaHoje).reduce((a, f) => a + f.valor, 0))
  if (faltam > 0 && faltam < total) linhas.push(`Ainda falta pagar neste mês: ${brl(faltam)}`)
  return linhas.join('\n')
}

export function textoProximos(b: Base, hoje: string, dias: number): string {
  const fim = somaDias(hoje, dias)
  const itens: { dia: string; texto: string; valor: number; tipo: 'pagar' | 'receber' }[] = []
  for (const c of b.contas) {
    if (c.vencimento > fim) continue
    itens.push({ dia: c.vencimento, texto: c.descricao, valor: c.valor, tipo: c.tipo })
  }
  const nomeCart = (id: string) => b.carteiras.find((c) => c.id === id)?.nome ?? 'cartão'
  for (const f of faturas(b.lancs, cartoesDe(b))) {
    if (f.falta > 0 && f.vence <= fim) itens.push({ dia: f.vence, texto: `Fatura ${nomeCart(f.cartaoId)}`, valor: f.falta, tipo: 'pagar' })
  }
  if (!itens.length) return `Não há conta a pagar nem a receber vencendo até ${diaMes(fim)}.`
  const atrasadas = itens.filter((i) => i.dia < hoje)
  const proximas = itens.filter((i) => i.dia >= hoje)
  const linhas: string[] = []
  const linha = (i: (typeof itens)[number]) => `${i.texto} ${brl(i.valor)}${i.tipo === 'receber' ? ' (a receber)' : ''}`
  if (atrasadas.length) {
    linhas.push('Atrasadas:')
    for (const i of atrasadas.sort((a, c) => (a.dia < c.dia ? -1 : 1))) linhas.push(`${diaMes(i.dia)}: ${linha(i)}`)
  }
  if (proximas.length) {
    linhas.push(`Próximos ${dias} dias, dia a dia:`)
    const porDia = new Map<string, typeof itens>()
    for (const i of proximas) porDia.set(i.dia, [...(porDia.get(i.dia) ?? []), i])
    for (const [d, xs] of [...porDia.entries()].sort()) linhas.push(`${diaSemana(d)}: ${xs.map(linha).join(' + ')}`)
  }
  const pagar = centavosDe(itens.filter((i) => i.tipo === 'pagar').reduce((a, i) => a + i.valor, 0))
  const receber = centavosDe(itens.filter((i) => i.tipo === 'receber').reduce((a, i) => a + i.valor, 0))
  const tot: string[] = []
  if (pagar > 0) tot.push(`a pagar ${brl(pagar)}`)
  if (receber > 0) tot.push(`a receber ${brl(receber)}`)
  linhas.push(`Total: ${tot.join(', ')}`)
  return linhas.join('\n')
}

/* ---------- entendimento do pedido (sem IA) ---------- */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const PALAVRA_DE_PERIODO = new Set(['hoje', 'ontem', 'mes', 'semana', 'ano', 'dia', 'dias', 'essa', 'esse', 'este', 'esta', 'desse', 'dessa', 'deste', 'desta', 'ultimos', 'passado', 'periodo', 'mensal'])

export type Consulta =
  | { tipo: 'saldo' }
  | { tipo: 'fixas' }
  | { tipo: 'proximos'; dias: number }
  | { tipo: 'periodo'; periodo: QualPeriodo; direcao: Direcao; porDia: boolean }

/**
 * Reconhece os pedidos de número que o cliente mais faz. Devolve null quando não tem certeza:
 * aí a pergunta segue para a IA (que responde só com o resumo calculado aqui). Errar para null é seguro; errar para
 * outra consulta não é, então os padrões são fechados.
 */
/** Números escritos em palavra. Em áudio o valor vem sempre assim: a transcrição não tem dígito. */
const EXTENSO =
  '(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil|milhao|milhoes)'
const VALOR_EXTENSO = new RegExp(`\\b${EXTENSO}(\\s+e\\s+${EXTENSO})*\\s+(reais?|real|conto|contos|pila|mango|mangos)\\b`)
const REGISTRO_EXTENSO = new RegExp(
  `\\b(gastei|paguei|comprei|recebi|vendi|ganhei|faturei|transferi|depositei|saquei|cobrei)\\s+((uns?|umas?|mais|cerca|quase|tipo|la)\\s+(de\\s+)?)?${EXTENSO}\\b`,
)

/**
 * A frase diz um VALOR por extenso ("gastei cinquenta reais de gasolina hoje")? Então é lançamento,
 * não consulta.
 *
 * Achado pelo fluxo.ts com IA real em 2026-11-19: a guarda só olhava dígito, e áudio nunca tem
 * dígito. Resultado em produção: o gasto ditado era respondido com um relatório do dia e NUNCA era
 * anotado — a pessoa achava que estava registrado. Áudio é o jeito mais natural de usar a Granninha.
 */
export function temValorPorExtenso(texto: string): boolean {
  const t = norm(texto)
  return VALOR_EXTENSO.test(t) || REGISTRO_EXTENSO.test(t)
}

export function reconhecer(texto: string): Consulta | null {
  const t = norm(texto)
  // Com número solto na frase ("paguei 50 de luz") é lançamento, não consulta. Só "7 dias", "15 dias" são pedido de período.
  if (/\d/.test(t.replace(/\d{1,2}\s+dias/g, ''))) return null
  if (temValorPorExtenso(t)) return null
  // Pergunta de ranking, comparação ou "qual o maior" não é o total do período: quem sabe responder é a IA, com os números prontos.
  if (/\b(maior|maiores|menor|menores|mais|menos|principal|principais|pesou|pesa|pesaram|compar\w*|media|top|ranking|melhor|pior)\b/.test(t)) return null
  if (/\b(fixo|fixos|fixa|fixas)\b/.test(t) && /(gasto|despesa|conta|custo|quanto|quais|lista|mostr)/.test(t)) return { tipo: 'fixas' }
  const periodo: QualPeriodo | null = /\bontem\b/.test(t)
    ? 'ontem'
    : /\b(hoje|do dia|de hoje|dia de hoje)\b/.test(t)
      ? 'hoje'
      : /(mes passado|mes anterior|ultimo mes)/.test(t)
        ? 'mes_passado'
        : /(ultimos 7 dias|ultimos sete dias|7 dias atras)/.test(t)
          ? '7dias'
          : /(semana|semanal)/.test(t)
            ? 'semana'
            : /\b(neste ano|nesse ano|esse ano|este ano|no ano|do ano)\b/.test(t)
              ? 'ano'
              : /(\bmes\b|mensal)/.test(t)
                ? 'mes'
                : null
  const porDia = /(por dia|dia a dia|dia por dia|cada dia|diari[oa]|por dias)/.test(t)
  const proximos = /(proximos|proximas|proximo)\s+(\d{1,2}\s+)?dias|\bvenc(e|em|endo|imento|imentos)\b|contas? a (pagar|receber)|o que (eu )?(tenho|falta|preciso)( a| que| de)? pagar|agenda financeira/.test(t)
  if (proximos) {
    const n = /(\d{1,2})\s+dias/.exec(t)
    return { tipo: 'proximos', dias: n ? Math.min(60, Math.max(1, Number(n[1]))) : 7 }
  }
  const palavraSaldo = /\bsaldo\b|quanto (eu )?(tenho|tem)\b|quanto (ha|tem) (na|no|em)\b|dinheiro (disponivel|em caixa|na conta|que tenho)|quanto (eu )?(ainda )?(tenho|posso gastar)/.test(t)
  const entrou = /(entrou|entrada|entradas|recebi|recebimento|recebimentos|faturei|faturamento|ganhei|receita)/.test(t)
  const saiu = /(saiu|saida|saidas|gastei|gasto|gastos|despesa|despesas|paguei|pagamentos?)/.test(t)
  const resumo = /(sobrou|resumo|movimento|movimentacao|balanco|como (estou|to|estao)|como (anda|vai))/.test(t)
  // "saldo" sozinho é o que tem na conta agora. "Saldo do mês" ou "da semana" é o resultado do período.
  if (palavraSaldo && !periodo && !entrou && !saiu) return { tipo: 'saldo' }
  if (/^\s*(quanto (eu )?(tenho|tem))\??\s*$/.test(t)) return { tipo: 'saldo' }
  if (entrou || saiu || resumo || (palavraSaldo && periodo)) {
    // "Quanto gastei COM MATERIAL" tem assunto: não é o total do período. Quem sabe responder por categoria é a IA, com o resumo.
    const assunto = /\b(gastei|gasto|gastos|saiu|saida|saidas|paguei|despesas?|entrou|entrada|entradas|recebi|recebimentos?|faturei|ganhei)\s+(com|de|em|no|na|nos|nas|para|pra|do|da|dos|das)\s+([a-z0-9]+)/.exec(t)
    if (assunto && !PALAVRA_DE_PERIODO.has(assunto[3])) return null
    const direcao: Direcao = entrou && !saiu && !resumo ? 'entrada' : saiu && !entrou && !resumo ? 'saida' : 'ambos'
    // Sem período dito: mês corrente; "por dia" sem período mostra os últimos 7 dias, para a lista caber numa tela.
    return { tipo: 'periodo', periodo: periodo ?? (porDia ? '7dias' : 'mes'), direcao, porDia }
  }
  return null
}

export function responderConsulta(c: Consulta, b: Base, hoje: string): string {
  if (c.tipo === 'saldo') return textoSaldo(b)
  if (c.tipo === 'fixas') return textoFixas(b, hoje)
  if (c.tipo === 'proximos') return textoProximos(b, hoje, c.dias)
  return textoPeriodo(b, periodoDe(hoje, c.periodo), c.direcao, c.porDia)
}

/** Atalho: devolve o texto pronto se o pedido é uma consulta conhecida, senão null. */
export function responderDireto(texto: string, b: Base, hoje: string): string | null {
  const c = reconhecer(texto)
  return c ? responderConsulta(c, b, hoje) : null
}

/**
 * Esta mensagem é claramente uma PERGUNTA (e não um lançamento)? Só aí o pedido pode pular a IA de interpretação.
 * Mensagem com número nunca é pergunta ("gastei 6 no mercado"). Na dúvida, false: a IA decide.
 */
export function ehPerguntaClara(texto: string): boolean {
  const t = norm(texto).trim()
  if (/\d/.test(t) || t.length > 80) return false
  if (/^(qual|quais|quanto|quantos|me (mostra|mostre|manda|mande|diz|diga|fala|fale)|mostra|mostre|resumo|saldo|extrato|como (estou|to|anda|vai|estao))\b/.test(t) || t.endsWith('?')) return true
  // "meus gastos de hoje", "gastos por dia", "o que vence": pedido sem pergunta, mas é um dos que o código sabe responder.
  // Frase que começa contando algo que o dono FEZ ("gastei", "recebi") é lançamento, não pedido.
  // "esse recebimento foi de serviço" fala do último lançamento (é correção), mesmo tendo a palavra "recebimento".
  // A saudação sai antes: em áudio a frase quase sempre começa com "oi Granninha, gastei...", e com ela
  // no caminho o FEZ_ALGO (ancorado no início) não reconhecia o lançamento.
  return !FEZ_ALGO.test(semSaudacao(t)) && !temPistaDeCorrecao(texto) && t.length <= 60 && reconhecer(texto) !== null
}

const SAUDACAO = /^(oi+|ola+|opa|e ai|eai|fala|bom dia|boa tarde|boa noite|granninha|granina|grannamei|granna)\b[\s,.!]*/
function semSaudacao(t: string): string {
  let s = t.trim()
  for (let i = 0; i < 3 && SAUDACAO.test(s); i++) s = s.replace(SAUDACAO, '').trim()
  return s
}
const FEZ_ALGO = /^(gastei|paguei|recebi|comprei|vendi|ganhei|passei|transferi|depositei|saquei|tirei|cobrei|fiz|entrou|saiu|caiu|anota|anotar|registra|registrar|lanca|lancar|coloca|adiciona)\b/

export { ultimoDoMes }
