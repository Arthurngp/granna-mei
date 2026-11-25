/**
 * O gancho da conta: uma pergunta de uma palavra sobre uma conta que a pessoa mesma cadastrou.
 *
 * Por que existe (leitura de produção em 24/11): 5 de 9 pessoas confirmaram o WhatsApp e nunca mandaram mais nada, mesmo com
 * várias contas cadastradas no onboarding. A confirmação pedia "me manda o que entrou ou saiu" com um exemplo genérico, muitas
 * vezes de noite, sem gasto nenhum para anotar naquela hora. E o aviso de conta vencendo dizia "quando pagar, me avisa" sem
 * guardar de qual conta falava: um "paguei" sozinho dependia de a IA adivinhar.
 *
 * Dois usos, a mesma mecânica:
 * - na confirmação do número, se há conta vencendo por agora, a Granninha pergunta "já pagou?";
 * - no aviso de vencimento de UMA conta, a mesma pergunta fica em aberto.
 * A resposta "sim" dá baixa por código (sem IA), "não" deixa a conta aberta, e qualquer outra coisa segue o fluxo normal.
 *
 * Tudo aqui é função pura: quem lê e grava no banco é o granninha.ts e o avisos-banco.ts.
 */
import { brl, somaDias } from './consultas.ts'
import type { RespostaIA } from './interpretar.ts'

export interface ContaGancho {
  id: string
  descricao: string
  valor: number
  vencimento: string
}

/** A pergunta em aberto gravada em `conversas.pendente`. */
export interface PendenteBaixa {
  tipo: 'baixa_conta'
  conta: ContaGancho
  /** De onde veio a pergunta: só para leitura de dados depois. */
  de: 'confirmacao' | 'aviso'
  /** Segundo passo: a pessoa já disse SIM e falta dizer de qual conta saiu. Aí a resposta esperada é uma destas opções. */
  opcoes?: { id: string; nome: string }[]
  /** O texto da pergunta do segundo passo, para repetir se a resposta não for uma das opções. */
  pergunta?: string
}

/** Por quanto tempo a pergunta do gancho vale. Mais que os 30 min das outras: o aviso sai de manhã e a pessoa responde à noite. */
export const VALE_MS = 24 * 60 * 60_000
/** A pergunta "já pagou?" só cabe para conta que venceu há pouco ou vence já. */
export const DIAS_ATRAS = 10
export const DIAS_FRENTE = 3
/** Conta mais longe que isso nem é citada: falar em dezembro de uma conta de fevereiro não ajuda. */
export const DIAS_PROXIMA = 45

export type Gancho = { modo: 'pagou' | 'proxima'; conta: ContaGancho }

/** Janela de vencimento que interessa ao gancho da confirmação. */
export const janelaDoGancho = (hoje: string) => ({ de: somaDias(hoje, -DIAS_ATRAS), ate: somaDias(hoje, DIAS_PROXIMA) })

/**
 * Qual conta citar na confirmação. Recebe as contas A PAGAR, abertas. Com uma vencendo por agora, pergunta se já pagou
 * (a mais antiga primeiro); senão cita a próxima, sem perguntar; sem nenhuma por perto, não há gancho.
 */
export function escolherGancho(contas: ContaGancho[], hoje: string): Gancho | null {
  const validas = contas
    .filter((c) => c && typeof c.descricao === 'string' && c.descricao.trim() && /^\d{4}-\d{2}-\d{2}$/.test(c.vencimento ?? '') && Number.isFinite(c.valor))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao))
  const agora = validas.find((c) => c.vencimento >= somaDias(hoje, -DIAS_ATRAS) && c.vencimento <= somaDias(hoje, DIAS_FRENTE))
  if (agora) return { modo: 'pagou', conta: agora }
  const proxima = validas.find((c) => c.vencimento > somaDias(hoje, DIAS_FRENTE) && c.vencimento <= somaDias(hoje, DIAS_PROXIMA))
  return proxima ? { modo: 'proxima', conta: proxima } : null
}

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** "venceu dia 20/11", "vence hoje", "vence amanhã", "vence dia 27/11". */
export function quandoVence(vencimento: string, hoje: string): string {
  if (vencimento < hoje) return `venceu dia ${ddmm(vencimento)}`
  if (vencimento === hoje) return 'vence hoje'
  if (vencimento === somaDias(hoje, 1)) return 'vence amanhã'
  return `vence dia ${ddmm(vencimento)}`
}

/** Nome da conta do jeito que cabe numa frase de exemplo. Nome comprido vira "a conta", como no aviso de vencimento. */
const nomeCurto = (descricao: string) => {
  const d = descricao.trim()
  return d.length <= 28 ? d : null
}

/** A conta numa linha: nome, valor (se a pessoa não escolheu ocultar) e quando vence. */
const linhaDaConta = (c: ContaGancho, ocultar: boolean, hoje: string) => `${c.descricao.trim()}${ocultar ? '' : `, ${brl(c.valor)}`}, ${quandoVence(c.vencimento, hoje)}`

/** A pergunta de uma palavra. É a mesma na confirmação e no aviso, para a resposta ser lida do mesmo jeito. */
export const PERGUNTA_PAGOU = 'Já pagou? Responde SIM que eu dou baixa, ou NÃO que eu deixo em aberto.'

/** A mensagem de confirmação do número, com o gancho. Sem emoji e sem travessão, na voz da moedinha. */
export function textoConfirmacao(nome: string, g: Gancho, ocultar: boolean, hoje: string): string {
  const abre = `Pronto${nome ? `, ${nome}` : ''}, seu número tá confirmado e agora a gente tá conectado!`
  if (g.modo === 'pagou') {
    return `${abre}\n\nJá vi as contas que você cadastrou. Tem esta aqui: ${linhaDaConta(g.conta, ocultar, hoje)}.\n\n${PERGUNTA_PAGOU}`
  }
  const curto = nomeCurto(g.conta.descricao)
  return `${abre}\n\nJá guardei as contas que você cadastrou. A próxima é ${linhaDaConta(g.conta, ocultar, hoje)}. Quando pagar, é só me dizer "paguei ${curto ? curto.toLowerCase() : 'a conta'}".\n\nPra começar, me conta: qual foi o último dinheiro que entrou ou saiu hoje? Pode ser assim: "recebi 150 no pix".`
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.!,?]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A resposta à pergunta "já pagou?". Só frases que são a resposta inteira: qualquer coisa além disso ("paguei 50 de luz",
 * "paguei ontem no nubank") devolve null e segue o fluxo normal, que entende o resto.
 */
export function respostaGancho(texto: string): 'sim' | 'nao' | null {
  const t = norm(texto)
  if (!t || t.length > 40) return null
  if (/^(ainda nao|nao|n|nao paguei|ainda nao paguei|nao paguei ainda|nao ainda|depois|depois eu pago|vou pagar|ainda vou pagar|falta pagar|amanha|pago amanha)$/.test(t)) return 'nao'
  if (/^(sim|s|ss|ja|ja sim|sim ja|paguei|ja paguei|paguei sim|sim paguei|paguei ja|pago|paga|ta pago|ta paga|ja ta pago|ja ta paga|esta pago|esta paga|ja esta pago|ja esta paga|ja foi|ja foi pago|ja foi paga|pode dar baixa|da baixa|pode baixar)$/.test(t)) return 'sim'
  return null
}

/** O texto que fica registrado como a mensagem da pessoa quando ela responde SIM. Cita a data: com várias contas de mesmo nome em aberto, é ela que escolhe a certa. */
export const fraseDeBaixa = (c: ContaGancho) => `paguei ${c.descricao.trim()} de ${ddmm(c.vencimento)}`

/** A baixa pronta, no formato que a conferência (interpretar.conferir) recebe da IA. Sem valor: usa o valor da conta. */
export function baixaPronta(c: ContaGancho): RespostaIA {
  return {
    intencao: 'acoes',
    pergunta: null,
    correcao: null,
    falta: null,
    acoes: [{
      tipo_acao: 'baixar_conta', movimento: 'saida', valor: null, descricao: c.descricao, categoria_id: null, carteira_id: null, carteira_destino_id: null,
      meio: null, data: null, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null, conta_id: c.id, talvez_pessoal: false,
    }],
  }
}

/** Resposta ao NÃO: a conta fica aberta e a conversa não morre ali. */
export function textoNaoPagou(c: ContaGancho): string {
  const curto = nomeCurto(c.descricao)
  return `Beleza, deixei em aberto. Quando pagar, é só me dizer "paguei ${curto ? curto.toLowerCase() : 'a conta'}".\n\nEnquanto isso, me manda o que entrou ou saiu hoje que eu anoto.`
}

/** A conta já não está em aberto (deu baixa pelo painel, ou apagou) quando o SIM chegou. */
export const TEXTO_JA_BAIXADA = 'Essa conta já não está mais em aberto aqui, então não mexi em nada. Se pagou outra, me diz qual.'

/** Pendente válido? Lido do banco, então confere a forma antes de confiar. */
export function pendenteValido(p: unknown): p is PendenteBaixa {
  const x = p as PendenteBaixa | null
  return !!x && x.tipo === 'baixa_conta' && !!x.conta && typeof x.conta.id === 'string' && typeof x.conta.descricao === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.conta.vencimento ?? '')
}
