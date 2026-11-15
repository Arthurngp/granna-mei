/**
 * Entende a mensagem do MEI e devolve o que fazer.
 * A IA só propõe; o código confere: valor que não está na frase vira pergunta (nunca zero nem chute),
 * carteira e categoria só valem se forem do cliente, e data sem menção vira hoje.
 */
import { valorConfere, temDigito } from './numeros.ts'
import { jsonEstruturado, type Uso } from './openai.ts'

export interface Contexto {
  hoje: string // AAAA-MM-DD
  /** Ramo do negócio, para saber o que é serviço dele (entrada) */
  ramo?: string
  categorias: { id: string; nome: string; tipo: 'entrada' | 'saida'; pessoal?: boolean }[]
  carteiras: { id: string; nome: string; tipo: string; padrao: boolean }[]
  /** Contas em aberto, para "paguei a luz" achar a conta certa */
  contasAbertas: { id: string; descricao: string; valor: number; vencimento: string; tipo: 'pagar' | 'receber' }[]
}

export type TipoAcao = 'lancamento' | 'conta' | 'recorrente' | 'parcelado' | 'baixar_conta' | 'transferencia'
export type Intencao = 'acoes' | 'pergunta' | 'desfazer' | 'corrigir' | 'saudacao' | 'ajuda' | 'outro'

export interface AcaoIA {
  tipo_acao: TipoAcao
  movimento: 'entrada' | 'saida' | null
  valor: number | null
  descricao: string
  categoria_id: string | null
  carteira_id: string | null
  carteira_destino_id: string | null
  data: string | null
  pessoal: boolean
  vencimento: string | null
  dia_do_mes: number | null
  parcelas: number | null
  conta_id: string | null
}

export interface RespostaIA {
  intencao: Intencao
  acoes: AcaoIA[]
  pergunta: string | null
  correcao: string | null
  falta: string | null
}

/** Ação já conferida, pronta para gravar. */
export interface Acao extends AcaoIA {
  movimento: 'entrada' | 'saida' | null
  carteira_id: string
  data: string
}

export interface Interpretacao {
  intencao: Intencao
  acoes: Acao[]
  pergunta: string | null
  correcao: string | null
  /** Se preenchido, não grava nada e devolve esta pergunta ao cliente. */
  perguntar: string | null
  uso: Uso
  ms: number
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function sistema(c: Contexto) {
  const d = new Date(c.hoje + 'T12:00:00')
  const cats = c.categorias.map((x) => `- ${x.id} (${x.tipo}): ${x.nome}${x.pessoal ? ' [gasto pessoal do dono]' : ''}`).join('\n')
  const carts = c.carteiras.map((x) => `- ${x.id}: ${x.nome} (${x.tipo})${x.padrao ? ' [principal]' : ''}`).join('\n')
  const contas = c.contasAbertas.length
    ? c.contasAbertas.slice(0, 40).map((x) => `- ${x.id}: ${x.tipo === 'pagar' ? 'a pagar' : 'a receber'} "${x.descricao}" R$ ${x.valor.toFixed(2)} vence ${x.vencimento}`).join('\n')
    : '(nenhuma)'
  return `Você lê mensagens que um microempreendedor (MEI) manda no WhatsApp para registrar o dinheiro do negócio.
Hoje é ${DIAS[d.getDay()]}, ${c.hoje}.${c.ramo ? ` O negócio é do ramo: ${c.ramo}.` : ''} Responda só no formato pedido.

INTENÇÃO
- "acoes": a mensagem registra dinheiro (uma ou mais ações).
- "pergunta": quer saber algo dos próprios números ou do MEI dele ("quanto gastei", "o que vence", "quanto sobrou", "quanto falta pro limite do MEI", "quando vence o DAS"). Reescreva a pergunta clara em "pergunta".
- "desfazer": quer anular o último registro ("desfazer", "apaga o último", "cancela isso", "errei, apaga").
- "corrigir": quer mudar o último registro ("não foi 50, foi 60", "era dinheiro, não pix"). Descreva a correção em "correcao".
- "saudacao": só cumprimento ou agradecimento. "ajuda": pergunta como usar. "outro": nada a ver com dinheiro.

TIPOS DE AÇÃO
- "lancamento": dinheiro que JÁ entrou ou saiu. movimento entrada/saida.
- "conta": dinheiro que VAI entrar ou sair numa data (boleto, fiado, "me deve", "vou receber", "vence dia"). movimento entrada = a receber, saida = a pagar. Preencha "vencimento".
- "recorrente": conta que se repete todo mês ("aluguel 900 todo dia 10"). Preencha "dia_do_mes".
- "parcelado": compra ou venda em parcelas ("em 4x", "4 vezes de 300"). "valor" = TOTAL; "parcelas" = quantidade.
- "baixar_conta": pagou ou recebeu uma conta que JÁ está na lista abaixo e que a pessoa NOMEOU ("paguei a água", "a Mariana pagou"). Preencha "conta_id"; "valor" só se a pessoa disse um valor. Se nenhuma conta da lista tem o nome do que a pessoa disse, NÃO é baixa: é lançamento (e se faltar o valor, pergunte). Se o valor dito é diferente do valor da conta, é lançamento novo, não baixa. Baixa de conta sem valor dito NÃO precisa perguntar o valor: usa o valor da conta.
- "transferencia": dinheiro passando de uma carteira do próprio dono para outra ("depositei o dinheiro do caixa no banco", "a maquininha caiu no banco"). Use carteira_id (origem) e carteira_destino_id.

REGRAS
- "valor" é exatamente o que a pessoa disse. NUNCA invente valor. Se não disse valor e ele é necessário, use null e preencha "falta" com uma pergunta curta ("Qual foi o valor da luz?").
- "50 conto", "30 pila", "2k", "1,2 mil" são valores. "4x" é número de parcelas, não valor.
- "data": só se a pessoa disse quando (ontem, sexta, dia 3). Senão null. Datas no formato AAAA-MM-DD; dia da semana sem "que vem" é o mais recente que já passou (ou hoje).
- "vencimento": para conta; "dia 20" é o próximo dia 20; "sexta" é a próxima sexta.
- categoria_id: escolha a mais adequada da lista, ou null se nenhuma servir. Gasto da casa ou da família (mercado de casa, escola dos filhos, conta de casa, presente) é "pessoal": true e categoria do tipo gasto pessoal.
- Almoço, lanche e café durante o trabalho são gasto do negócio (alimentação), não pessoal.
- carteira_id: "pix", "transferência", "débito", "boleto" → banco; "dinheiro", "em espécie", "na mão" → dinheiro; "cartão", "crédito", "maquininha" → maquininha. Sem pista → null.
- descricao: curta, do jeito que a pessoa diria ("Conta de luz", "Corte · Juliana"). Sem valor na descrição.
- Várias coisas na mesma mensagem viram várias ações. Mas quantidade vezes preço ("3 cortes de 50", "2 escovas de 60") é UMA ação com o total.
- Quando a pessoa cita um serviço ou produto que o negócio dela vende, com valor, é dinheiro que ENTROU (ex.: "corte masc 35 pix", "escova 55").
- Se a mensagem tem o texto original seguido de uma linha "Correção: ...", aplique a correção ao texto original e devolva intencao "acoes" com as ações JÁ CORRIGIDAS (é um registro novo, não outro pedido de correção).
- "semana que vem" sem dia: vencimento é hoje mais 7 dias. "mês que vem" sem dia: mesmo dia do mês seguinte.

CATEGORIAS DO CLIENTE
${cats}

CARTEIRAS DO CLIENTE
${carts}

CONTAS EM ABERTO
${contas}`
}

function esquema(c: Contexto) {
  const nulo = (t: string) => ({ type: [t, 'null'] })
  const enumNulo = (vals: string[]) => ({ type: ['string', 'null'], enum: [...vals, null] })
  const acao = {
    type: 'object',
    additionalProperties: false,
    properties: {
      tipo_acao: { type: 'string', enum: ['lancamento', 'conta', 'recorrente', 'parcelado', 'baixar_conta', 'transferencia'] },
      movimento: enumNulo(['entrada', 'saida']),
      valor: nulo('number'),
      descricao: { type: 'string' },
      categoria_id: enumNulo(c.categorias.map((x) => x.id)),
      carteira_id: enumNulo(c.carteiras.map((x) => x.id)),
      carteira_destino_id: enumNulo(c.carteiras.map((x) => x.id)),
      data: nulo('string'),
      pessoal: { type: 'boolean' },
      vencimento: nulo('string'),
      dia_do_mes: nulo('integer'),
      parcelas: nulo('integer'),
      conta_id: c.contasAbertas.length ? enumNulo(c.contasAbertas.map((x) => x.id)) : { type: 'null' },
    },
    required: ['tipo_acao', 'movimento', 'valor', 'descricao', 'categoria_id', 'carteira_id', 'carteira_destino_id', 'data', 'pessoal', 'vencimento', 'dia_do_mes', 'parcelas', 'conta_id'],
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      intencao: { type: 'string', enum: ['acoes', 'pergunta', 'desfazer', 'corrigir', 'saudacao', 'ajuda', 'outro'] },
      acoes: { type: 'array', items: acao },
      pergunta: nulo('string'),
      correcao: nulo('string'),
      falta: nulo('string'),
    },
    required: ['intencao', 'acoes', 'pergunta', 'correcao', 'falta'],
  }
}

const tira = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const VAZIAS = new Set(['conta', 'contas', 'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'pacote', 'parcela'])
/** A frase cita a conta? Alguma palavra significativa da descrição aparece na mensagem. */
function nomeada(texto: string, descricao: string) {
  const t = tira(texto)
  return tira(descricao).split(/[^a-z0-9]+/).some((p) => p.length >= 3 && !VAZIAS.has(p) && t.includes(p))
}

const dataValida = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T12:00:00').getTime())

/** Confere cada ação. Devolve a pergunta a fazer, se algo não fecha. */
export function conferir(texto: string, c: Contexto, r: RespostaIA): { acoes: Acao[]; perguntar: string | null } {
  if (r.intencao !== 'acoes') return { acoes: [], perguntar: r.falta }
  if (r.falta) return { acoes: [], perguntar: r.falta }
  if (!r.acoes.length) return { acoes: [], perguntar: 'Não entendi o que registrar. Me conta de novo, com o valor?' }
  const padrao = c.carteiras.find((x) => x.padrao)?.id ?? c.carteiras[0]?.id ?? ''
  const cat = (id: string | null) => c.categorias.find((x) => x.id === id)
  const out: Acao[] = []
  for (const a of r.acoes) {
    const precisaValor = a.tipo_acao !== 'baixar_conta'
    if (precisaValor && (a.valor === null || !(a.valor > 0))) return { acoes: [], perguntar: `Qual foi o valor${a.descricao ? ` de "${a.descricao}"` : ''}?` }
    if (a.valor !== null && temDigito(texto) && !valorConfere(texto, a.valor, a.parcelas)) {
      return { acoes: [], perguntar: `Só para conferir: o valor de "${a.descricao}" é quanto?` }
    }
    const conta = c.contasAbertas.find((x) => x.id === a.conta_id)
    if (a.tipo_acao === 'baixar_conta' && (!conta || !nomeada(texto, conta.descricao) || (a.valor !== null && Math.abs(a.valor - conta.valor) > 0.01))) {
      // Conta não nomeada ou valor diferente: não dá baixa em conta errada. Com valor, vira lançamento; sem valor, pergunta.
      if (a.valor !== null && a.valor > 0 && conta) {
        a.tipo_acao = 'lancamento'
        a.movimento = conta.tipo === 'receber' ? 'entrada' : 'saida'
        a.conta_id = null
      } else return { acoes: [], perguntar: `Não achei essa conta em aberto. Qual conta você ${a.movimento === 'entrada' ? 'recebeu' : 'pagou'}, e de quanto?` }
    }
    if (a.tipo_acao === 'baixar_conta' && !conta) {
      return { acoes: [], perguntar: `Não achei essa conta em aberto. Qual conta você ${a.movimento === 'entrada' ? 'recebeu' : 'pagou'}, e de quanto?` }
    }
    if (a.tipo_acao === 'transferencia' && (!a.carteira_destino_id || a.carteira_destino_id === (a.carteira_id ?? padrao))) {
      return { acoes: [], perguntar: 'De qual carteira para qual? Ex.: "do dinheiro para o banco".' }
    }
    if (a.tipo_acao !== 'transferencia' && a.tipo_acao !== 'baixar_conta' && !a.movimento) {
      return { acoes: [], perguntar: `"${a.descricao}" foi dinheiro que entrou ou que saiu?` }
    }
    if (a.tipo_acao === 'parcelado' && !(a.parcelas && a.parcelas >= 2 && a.parcelas <= 48)) return { acoes: [], perguntar: 'Em quantas parcelas?' }
    if (a.tipo_acao === 'recorrente' && !(a.dia_do_mes && a.dia_do_mes >= 1 && a.dia_do_mes <= 31)) return { acoes: [], perguntar: `Que dia do mês vence "${a.descricao}"?` }
    if (a.tipo_acao === 'conta' && !dataValida(a.vencimento)) return { acoes: [], perguntar: `Para quando é "${a.descricao}"?` }

    // Categoria só vale se for do cliente e do mesmo tipo do movimento.
    let categoria = a.categoria_id
    const ct = cat(categoria)
    if (!ct || (a.movimento && ct.tipo !== a.movimento)) categoria = null
    let pessoal = a.pessoal && a.movimento === 'saida'
    if (cat(categoria)?.pessoal) pessoal = true
    if (pessoal) categoria = c.categorias.find((x) => x.pessoal)?.id ?? categoria
    if (!categoria && a.movimento) categoria = a.movimento === 'entrada' ? c.categorias.find((x) => x.id === 'outras-entradas')?.id ?? null : null

    const data = dataValida(a.data) && a.data! <= c.hoje ? a.data! : c.hoje
    out.push({
      ...a,
      descricao: a.descricao.trim().slice(0, 120) || (a.movimento === 'entrada' ? 'Entrada' : 'Saída'),
      categoria_id: a.tipo_acao === 'transferencia' ? null : categoria,
      carteira_id: a.carteira_id ?? padrao,
      pessoal,
      data,
      dia_do_mes: a.dia_do_mes ? Math.min(28, a.dia_do_mes) : null,
    })
  }
  return { acoes: out, perguntar: null }
}

export async function interpretar(texto: string, c: Contexto): Promise<Interpretacao> {
  const t0 = Date.now()
  const { dados, uso } = await jsonEstruturado<RespostaIA>(sistema(c), texto.slice(0, 2000), 'interpretacao', esquema(c))
  const { acoes, perguntar } = conferir(texto, c, dados)
  return { intencao: dados.intencao, acoes, pergunta: dados.pergunta, correcao: dados.correcao, perguntar, uso, ms: Date.now() - t0 }
}
