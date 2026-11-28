/**
 * Configuração da conta pela conversa do WhatsApp (itens at-12 e at-13 do backlog).
 *
 * Decisão do Arthur em 24/11: o site pede só o WhatsApp, manda confirmar no WhatsApp, e "completa por lá tudo". O que o onboarding do site
 * perguntava em 7 telas (ramo, onde fica o dinheiro, cartão, contas fixas) passa a ser perguntado aqui, uma pergunta por mensagem, sempre com
 * PULAR. O nome já vem do cadastro ("Como podemos te chamar?"), e CPF/CNPJ saiu.
 *
 * Etapas: ramo (e ocupação, se "outro") → banco → saldo → mais um banco ou dinheiro → cartão → DAS → contas de todo mês → fim.
 * - Cada resposta é lida por código, sem IA. A exceção são as contas de todo mês, que passam pelo leitor normal de mensagens ("aluguel 900 dia 10"
 *   já vira conta fixa lá), e prints e extratos, que passam pela leitura de documentos.
 * - Mensagem que não é resposta (um gasto, uma pergunta) é atendida normalmente, e a pergunta da configuração volta no fim (no máximo 2 vezes por
 *   etapa; depois a etapa é pulada). Se a mensagem normal deixou pergunta própria em aberto, a da configuração espera a vez.
 * - O estado mora em `perfis.config_whats` (jsonb, só o servidor grava). Só entra quem veio pelo cadastro novo (`perfis.onboarding_via = 'whats'`)
 *   e com a chave ONBOARDING_WHATS ligada no servidor. Sem a migration, nada disto roda e a conta segue o caminho de sempre.
 * - Saldo: o saldo de uma conta só é posto se ela ainda não tem lançamento. Saldo posto aqui fica "fixado": extrato importado depois na mesma
 *   conta, durante a configuração, não pode somar de novo o que o saldo já contém (o saldo inicial é corrigido pelo que entrou e saiu no extrato).
 */
import { chaveBanco } from './cruzar.ts'

export type Etapa = 'ramo' | 'ocupacao' | 'banco' | 'banco_confirma' | 'saldo' | 'mais_banco' | 'cartao' | 'cartao_dia' | 'das' | 'fixas' | 'fim'

export interface EstadoConfig {
  etapa: Etapa
  /** Quando a pergunta atual foi feita (ISO). */
  em: string
  /** Quantas vezes a pergunta desta etapa já voltou depois de ignorada. */
  voltas?: number
  /** Etapa saldo: de qual conta é o saldo que está sendo pedido. */
  carteira?: string
  /** Etapa cartao_dia: o nome do cartão que falta o dia. */
  cartao?: string
  /** Etapa banco_confirma: o nome de banco que não é conhecido, esperando a confirmação, e de qual etapa ele veio. */
  bancoNome?: string
  voltaPara?: 'banco' | 'mais_banco'
  /** Etapa banco_confirma: o nome é a correção de um banco escrito errado ("nubak" → Nubank), e a pergunta é "Você quis dizer...?". */
  sugestao?: boolean
  /** Etapa banco_confirma: o saldo que veio junto com o nome ("nubak 450"), para não perguntar de novo depois da confirmação. */
  saldoDito?: number
  /** Contas ditas de uma vez ("Nubank e Inter") que ainda esperam o saldo: a etapa do saldo pergunta uma por uma. */
  pendentes?: string[]
  /** Contas cujo saldo foi posto aqui (id → valor): extrato importado depois não soma em dobro. */
  saldoFixado?: Record<string, number>
  /** Quantos bancos e cartões já foram cadastrados aqui (teto contra laço). */
  bancos?: number
  cartoes?: number
  inicio?: string
}

export const RAMOS: { id: string; nome: string }[] = [
  { id: 'beleza', nome: 'Beleza e estética' },
  { id: 'alimentacao', nome: 'Alimentação' },
  { id: 'comercio', nome: 'Comércio' },
  { id: 'servicos', nome: 'Serviços' },
  { id: 'obras', nome: 'Construção e reformas' },
  { id: 'transporte', nome: 'Transporte e entregas' },
  { id: 'moda', nome: 'Moda e artesanato' },
  { id: 'outro', nome: 'Outro' },
]
/** O mesmo do painel (src/lib/config.ts): o nome da categoria de material muda com o ramo. */
export const MATERIAL_POR_RAMO: Record<string, string> = {
  beleza: 'Produtos e material', alimentacao: 'Ingredientes e embalagens', comercio: 'Mercadoria para revenda', servicos: 'Material de trabalho',
  obras: 'Material de obra', transporte: 'Combustível e manutenção', moda: 'Tecidos e material', outro: 'Material',
}
/** Categorias de quem nasce pelo cadastro novo (as mesmas do painel, src/lib/seed.ts, com o material do ramo). */
export function categoriasPadrao(ramo: string) {
  return [
    { id: 'servicos', nome: 'Serviços prestados', tipo: 'entrada', cor: '#12915A', natureza: 'servico' },
    { id: 'vendas', nome: 'Vendas de produtos', tipo: 'entrada', cor: '#5BBF8A', natureza: 'comercio' },
    { id: 'outras-entradas', nome: 'Outros recebimentos', tipo: 'entrada', cor: '#9AD9B8' },
    { id: 'material', nome: MATERIAL_POR_RAMO[ramo] ?? 'Material', tipo: 'saida', cor: '#454C83' },
    { id: 'aluguel', nome: 'Aluguel', tipo: 'saida', cor: '#747EAD' },
    { id: 'contas-casa', nome: 'Luz, água e internet', tipo: 'saida', cor: '#2F9E8F' },
    { id: 'transporte', nome: 'Transporte', tipo: 'saida', cor: '#E0A03B' },
    { id: 'alimentacao', nome: 'Alimentação', tipo: 'saida', cor: '#D96C4F' },
    { id: 'impostos', nome: 'Impostos (DAS)', tipo: 'saida', cor: '#8B5FBF' },
    { id: 'equipamentos', nome: 'Ferramentas e equipamentos', tipo: 'saida', cor: '#3B82C4' },
    { id: 'marketing', nome: 'Divulgação', tipo: 'saida', cor: '#C2528B' },
    { id: 'taxas', nome: 'Taxas e tarifas', tipo: 'saida', cor: '#8A8FA8' },
    { id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida', cor: '#A3A8BF' },
    { id: 'retirada', nome: 'Retirada do dono', tipo: 'saida', cor: '#B1B9D8', pessoal: true },
  ]
}

export const DAS = { descricao: 'DAS do MEI', valor: 86.05, dia: 20 }
/** Depois disso sem terminar, a configuração para de perguntar (a pessoa sumiu ou não quis). */
export const ABANDONO_MS = 7 * 24 * 3600_000
export const MAX_VOLTAS = 2
export const MAX_BANCOS = 4
export const MAX_CARTOES = 3

/*
 * ---------------- textos ----------------
 * Pedido do Arthur em 2026-11-28, depois de testar no chip: "a Granninha é a amiguinha, não um robô". Mensagem curta, uma pergunta aberta por
 * vez, sem lista numerada e sem instrução de comando (PULAR, NÃO, PRONTO continuam funcionando, só não são ensinados como comando).
 * Voz da moedinha: sem emoji e sem travessão.
 */

const real = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "no Nubank", "na Caixinha Nubank", "em dinheiro": o jeito de falar de cada conta numa frase. */
export function naConta(nome: string): string {
  if (/^dinheiro$/i.test(nome.trim())) return 'em dinheiro'
  return /^(caixinha|poupan[cç]a|reserva|conta|cooperativa|caixa)\b/i.test(nome.trim()) ? `na ${nome}` : `no ${nome}`
}

export function boasVindas(nome: string): string {
  return `Pronto${nome ? `, ${nome}` : ''}! Número confirmado, agora a gente tá junto.\n\nPra eu deixar tudo do seu jeito: você trabalha com o quê?`
}

/** A pergunta de cada etapa. `nomeConta` é o nome da conta da etapa de saldo. */
export function pergunta(e: EstadoConfig, nomeConta?: string): string {
  switch (e.etapa) {
    case 'ramo': return 'Me conta: você trabalha com o quê? Pode ser do seu jeito, tipo manicure, lanchonete ou videomaker.'
    case 'ocupacao': return 'E o que você faz, exatamente? Tipo fotógrafa, tatuador, mecânico.'
    case 'banco': return 'E o dinheiro do trabalho cai em qual banco?'
    case 'saldo': return nomeConta ? `Quanto tem ${naConta(nomeConta)} hoje, mais ou menos?` : 'Quanto tem nessa conta hoje, mais ou menos?'
    case 'mais_banco': return 'Tem mais alguma conta, caixinha ou dinheiro guardado em casa?'
    case 'cartao': return 'Usa cartão de crédito? Se usa, me diz de qual banco e o dia que a fatura vence.'
    case 'cartao_dia': return `E a fatura do ${e.cartao ?? 'cartão'} vence que dia?`
    case 'banco_confirma': return e.sugestao ? `Você quis dizer ${e.bancoNome}?` : `${e.bancoNome ?? 'Esse'} é o nome do seu banco, né?`
    case 'das': return `Quer que eu te lembre do DAS do MEI (${real(DAS.valor)}) todo dia ${DAS.dia}?`
    case 'fixas': return 'Última coisa: quais contas chegam todo mês? Me manda uma por vez, tipo "aluguel 900 dia 10". Quando acabar, me fala que é só isso.'
    case 'fim': return ''
  }
}

export const TEXTO_FIM = 'Prontinho, tá tudo configurado! Agora é só me mandar o que entrar ou sair, do seu jeito: texto, áudio ou foto do comprovante. E eu te aviso um dia antes de cada conta vencer.'
export const MAIS_FIXA = 'Tem mais alguma conta de todo mês?'

/* ---------------- leitura das respostas (por código) ---------------- */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.!,?;:]+/g, ' ').replace(/\s+/g, ' ').trim()

export const ehPular = (t: string) => /^(pular|pula|pulo|depois|agora nao|nao quero|prefiro nao|deixa pra la|deixa)$/.test(norm(t))
export const ehNao = (t: string) => /^(nao|n|nao uso|nao tenho|nenhum|nenhuma|so isso|nao obrigado|nao obrigada|nem)$/.test(norm(t))
export const ehSim = (t: string) => /^(sim|s|ss|pode|pode sim|quero|claro|isso|ok|beleza|bora|manda|guarda|pode guardar|sim pode|sim quero)$/.test(norm(t))
export const ehPronto = (t: string) => /^(pronto|acabou|acabei|so isso|so|nao|n|nenhuma|nenhum|nada|terminei|fim|e isso|era isso|pronto obrigado|pronto obrigada)$/.test(norm(t))

/** "1" a "8" ou o nome (ou o começo do nome) do ramo. */
export function lerRamo(texto: string): string | null {
  const t = norm(texto)
  const n = /^(\d{1,2})$/.exec(t)
  if (n) return RAMOS[Number(n[1]) - 1]?.id ?? null
  if (t.length < 3) return null
  const achado = RAMOS.find((r) => norm(r.nome).startsWith(t) || norm(r.nome).split(' ')[0] === t.split(' ')[0])
  return achado?.id ?? null
}

/** Ocupação dita: 3 a 60 caracteres, com letras e sem número. */
export function lerOcupacao(texto: string): string | null {
  const t = texto.trim().replace(/\s+/g, ' ')
  if (t.length < 3 || t.length > 60 || /\d|https?:|www\./i.test(t) || !/[a-záéíóúâêôãõç]{3}/i.test(t)) return null
  return t
}

/** O nome dito é de um banco conhecido (Nubank, Itaú...)? Nome desconhecido pede confirmação antes de virar conta: "certo" e "show" não são banco. */
export const bancoConhecido = (texto: string) => !!chaveBanco(texto)

/** Nome de exibição de cada banco conhecido (chave de cruzar.ts). */
const NOME_BANCO: Record<string, string> = {
  nubank: 'Nubank', bradesco: 'Bradesco', itau: 'Itaú', inter: 'Inter', santander: 'Santander', caixa: 'Caixa', bb: 'Banco do Brasil', c6: 'C6 Bank',
  mercadopago: 'Mercado Pago', picpay: 'PicPay', cora: 'Cora', sicoob: 'Sicoob', sicredi: 'Sicredi', pagbank: 'PagBank', neon: 'Neon', original: 'Original',
  safra: 'Safra', btg: 'BTG', xp: 'XP', will: 'Will Bank', next: 'Next', infinitepay: 'InfinitePay', stone: 'Stone', asaas: 'Asaas', banrisul: 'Banrisul',
  brb: 'BRB', bnb: 'Banco do Nordeste',
}

/** Dinheiro em espécie em vez de banco ("dinheiro", "em casa", "na gaveta", "em mãos"). */
const EM_MAOS = /\b(especie|gaveta|carteira fisica|em maos|vivo|em casa|guardo em casa)\b/
export const ehEspecie = (t: string) => (/\bdinheiro\b/.test(norm(t)) || EM_MAOS.test(norm(t))) && !chaveBanco(t)

/**
 * O nome de um banco dito na conversa. Banco conhecido vira o nome de exibição ("nu" → "Nubank"); outro nome curto, sem número, é aceito como
 * está ("Caixa Tem", "Cooperativa X"). Frase comprida ou com número não é nome de banco.
 */
export function lerBanco(texto: string): string | null {
  const t = texto.trim().replace(/\s+/g, ' ').replace(/^(no|na|o|a|banco do|banco da|banco)\s+/i, (m) => (/^banco/i.test(m) ? m : ''))
  const chave = chaveBanco(t)
  if (chave) return NOME_BANCO[chave] ?? t
  // Nome que não é de banco conhecido só vale se parece nome: curto, sem número, e sem palavra de quem está contando um gasto ou perguntando algo
  // ("paguei a luz", "quanto tenho?" não podem virar uma conta chamada assim).
  if (t.length < 2 || t.length > 30 || /\d|https?:|www\.|[?!]/i.test(t) || t.split(' ').length > 3 || NAO_E_BANCO.test(norm(t))) return null
  // Inicial maiúscula em cada palavra, menos nas pequenas do meio ("Cooperativa do Vale", não "Do Vale").
  return t.split(' ').map((w, i) => (i > 0 && /^(de|do|da|dos|das|e)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
}
const NAO_E_BANCO = /\b(paguei|pago|pagar|paga|recebi|receber|recebe|comprei|compra|gastei|gasto|vendi|venda|saldo|quanto|quanta|como|qual|quais|onde|quando|porque|ajuda|oi|ola|opa|bom|boa|obrigad\w*|valeu|reais|real|pix|luz|agua|aluguel|internet|conta|contas|fatura|sim|nao|pular|pronto|ok|beleza|tchau|cartao|credito|debito|caixinha|cofrinho|porquinho|poupanca|reserva|investimento|investimentos|cdb|tesouro)\b/

/** O nome de exibição do banco conhecido citado no texto ("nu" → "Nubank"), ou null. */
export const nomeDoBanco = (texto: string | null | undefined): string | null => {
  const k = chaveBanco(texto)
  return k ? NOME_BANCO[k] ?? null : null
}
/** Os nomes de banco que a IA pode devolver (o que vier fora disto não é nome canônico). */
export const NOMES_BANCOS = Object.values(NOME_BANCO)

/**
 * Dinheiro guardado que não é a conta do dia a dia: a "caixinha" (popularizada pelo Nubank), cofrinho, poupança, reserva, investimento. Vira conta
 * do tipo investimento, que fica fora do disponível. Vem ANTES do banco: "caixinha do nubank" é uma caixinha, não um segundo Nubank.
 */
const RESERVA = /\b(caixinhas?|cofrinhos?|porquinho|poupanca|reserva|investimentos?|cdb|tesouro)\b/
export function lerReserva(texto: string): string | null {
  const t = norm(texto)
  const m = RESERVA.exec(t)
  // "cofrinho em casa" é dinheiro em espécie, não conta guardada no banco.
  if (!m || NAO_E_RESERVA.test(t) || EM_MAOS.test(t)) return null
  const tipo = m[1].startsWith('caixinha') ? 'Caixinha' : m[1].startsWith('cofrinho') || m[1] === 'porquinho' ? 'Cofrinho' : m[1] === 'poupanca' ? 'Poupança' : m[1] === 'reserva' ? 'Reserva' : 'Investimentos'
  const banco = nomeDoBanco(texto)
  return banco ? `${tipo} ${banco}` : tipo
}
const NAO_E_RESERVA = /\b(paguei|gastei|comprei|recebi|vendi|transferi|tirei|saquei)\b/

/** Distância de edição (letras trocadas, faltando ou sobrando). */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
/** Nomes que aceitam correção de digitação. Os curtos (nu, bb, xp, c6, inter, neon, next) ficam de fora: um erro neles cai em outro banco. */
const CORRIGIVEIS: [string, string][] = [
  ['nubank', 'Nubank'], ['bradesco', 'Bradesco'], ['santander', 'Santander'], ['banco do brasil', 'Banco do Brasil'], ['mercado pago', 'Mercado Pago'],
  ['mercadopago', 'Mercado Pago'], ['picpay', 'PicPay'], ['sicoob', 'Sicoob'], ['sicredi', 'Sicredi'], ['pagbank', 'PagBank'], ['pagseguro', 'PagBank'],
  ['original', 'Original'], ['banrisul', 'Banrisul'], ['infinitepay', 'InfinitePay'], ['caixa economica', 'Caixa'], ['banco inter', 'Inter'], ['itau unibanco', 'Itaú'],
]
/**
 * Banco escrito errado ("nubak", "bradeco", "santader"): o nome certo mais parecido, para perguntar "Você quis dizer...?". Só para nome curto
 * (até 3 palavras), sem número, que não é banco conhecido como está. Até 1 letra de diferença em nomes de 5 a 6 letras, até 2 nos maiores.
 */
export function sugerirBanco(texto: string): string | null {
  if (chaveBanco(texto)) return null
  const t = norm(texto).replace(/^(no|na|o|a|meu|minha)\s+/, '').replace(/^banco\s+(?!do brasil)/, '')
  if (t.length < 5 || /\d/.test(t) || t.split(' ').length > 3) return null
  let melhor: { nome: string; d: number } | null = null
  for (const [alvo, nome] of CORRIGIVEIS) {
    const limite = alvo.length <= 6 ? 1 : 2
    const d = distancia(t, alvo)
    if (d > 0 && d <= limite && (!melhor || d < melhor.d)) melhor = { nome, d }
  }
  return melhor?.nome ?? null
}

/**
 * O valor solto numa frase de saldo ("tenho 450 lá", "nubank 1.200", "uns 300"): o único número com cara de dinheiro, ou null se houver mais de um
 * ou nenhum. Número de dia ("dia 10") não conta.
 */
export function valorNaFrase(texto: string): number | null {
  const sem = texto.toLowerCase().replace(/\bdia\s+\d{1,2}\b/g, ' ')
  const achados = [...sem.matchAll(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(?:\s*(?:reais|real|conto|contos))?/g)].map((m) => m[1])
  if (achados.length !== 1) return null
  return lerValor(achados[0])
}

/** Frase de quem está contando um movimento de dinheiro ("paguei 50 de luz", "recebi 200 no pix"): é lançamento, não resposta da configuração. */
export const pareceLancamento = (texto: string) =>
  /\b(paguei|pago|gastei|gasto|recebi|recebo|vendi|comprei|transferi|mandei|caiu|entrou|saiu|devolvi|emprestei|saquei|depositei|fiz um pix|pix de|pix pra|pix para)\b/.test(norm(texto))

/** Pergunta da pessoa ("quanto custa?", "como funciona"): vai para a conversa normal, e a pergunta da configuração volta depois. */
export const pareceDuvida = (texto: string) =>
  /\?\s*$/.test(texto.trim()) || /^(como|quanto|quanta|qual|quais|onde|quando|porque|por que|o que e|pra que|serve)\b/.test(norm(texto))

/** Um valor de saldo: "1.250,00", "1250", "R$ 300", "300 reais", "zero". Nunca negativo. O ponto é separador de milhar, como se escreve no Brasil. */
export function lerValor(texto: string): number | null {
  const t = texto.trim().toLowerCase().replace(/^r\$\s*/, '').replace(/\s*(reais|real|conto|contos)$/, '').replace(/\s+/g, '')
  if (/^(zero|nada|0|0,00)$/.test(t)) return 0
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t)
  if (!m) return null
  const v = Number(m[1].replace(/\./g, '') + (m[2] ? `.${m[2].padEnd(2, '0')}` : ''))
  return Number.isFinite(v) && v >= 0 && v <= 100_000_000 ? v : null
}

/** "Nubank dia 10", "nubank 10", "cartão do itaú, vence dia 5". Banco e dia (1 a 31); o dia pode faltar (a conversa pergunta). */
export function lerCartao(texto: string): { banco: string | null; dia: number | null } | null {
  const t = texto.trim()
  if (t.length > 60) return null
  const nums = [...t.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]))
  if (nums.length > 1 || /\d{3,}/.test(t)) return null
  const dia = nums.length && nums[0] >= 1 && nums[0] <= 31 ? nums[0] : null
  if (nums.length && dia === null) return null
  const resto = t
    .replace(/\b\d{1,2}\b/g, ' ')
    .replace(/\b(a\s+)?fatura\b|\bque\b|\bvence\b|\bvencimento\b|\bno\s+dia\b|\btodo\s+dia\b|\bdia\b|\bcart[aã]o\b|\bde\s+cr[eé]dito\b|\bdo\b|\bda\b|\bde\b|\bo\b|[,.;:]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const banco = resto ? lerBanco(resto) : null
  if (!banco) return null
  // Emissor que não é banco conhecido (Riachuelo, C&A) só vale com o dia ou com a palavra cartão: "show" e "certo" não são cartão.
  if (!chaveBanco(resto) && dia === null && !/cart[aã]o/i.test(t)) return null
  return { banco, dia }
}

/** Fechamento padrão do cartão: 7 dias antes do vencimento (o painel deixa ajustar). */
export function fechamentoDe(vencimento: number): number {
  const f = vencimento - 7
  return f >= 1 ? f : f + 30
}

/** Abandonou? (pergunta feita há mais de 7 dias, sem terminar) */
export const abandonou = (e: EstadoConfig, agora: number) => agora - new Date(e.inicio ?? e.em).getTime() > ABANDONO_MS
