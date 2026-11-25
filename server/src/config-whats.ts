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

/* ---------------- textos (voz da moedinha: sem emoji, sem travessão) ---------------- */

const listaRamos = () => RAMOS.map((r, i) => `${i + 1}. ${r.nome}`).join('\n')
const real = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function boasVindas(nome: string): string {
  return `Pronto${nome ? `, ${nome}` : ''}, seu número tá confirmado e agora a gente tá conectado!\n\nAgora vou te fazer umas perguntas rápidas pra deixar tudo do seu jeito, uma de cada vez. Se não quiser responder alguma, é só mandar PULAR.\n\n${pergunta({ etapa: 'ramo', em: '' })}`
}

/** A pergunta de cada etapa. `nomeConta` é o nome da conta da etapa de saldo. */
export function pergunta(e: EstadoConfig, nomeConta?: string): string {
  switch (e.etapa) {
    case 'ramo': return `Primeiro: o que você faz? Responde com o número:\n${listaRamos()}`
    case 'ocupacao': return 'E qual é a sua ocupação? Me diz em poucas palavras, tipo: fotógrafa, tatuador, mecânico.'
    case 'banco': return 'Onde cai o dinheiro do seu negócio? Me diz o nome do banco, tipo Nubank. Se preferir, manda um print da tela do app com o saldo que eu leio.'
    case 'saldo': return `E quanto tem ${nomeConta ? `no ${nomeConta}` : 'nessa conta'} hoje? Me manda o valor, tipo 1.250,00, ou o print da tela com o saldo.`
    case 'mais_banco': return 'Usa mais algum banco, ou guarda dinheiro em espécie? Me diz qual, ou NÃO.'
    case 'cartao': return 'Usa cartão de crédito? Me diz de qual banco e o dia que a fatura vence, tipo: Nubank dia 10. Se não usa, responde NÃO.'
    case 'cartao_dia': return `Que dia vence a fatura do ${e.cartao ?? 'cartão'}? Me manda só o número do dia, tipo 10.`
    case 'banco_confirma': return `Seu banco se chama ${e.bancoNome ?? 'assim'}? Responde SIM, ou me diz o nome certo.`
    case 'das': return `Quer que eu já guarde o DAS do MEI, de ${real(DAS.valor)}, todo dia ${DAS.dia}? Responde SIM ou NÃO.`
    case 'fixas': return 'Última: quais contas chegam todo mês? Me manda uma de cada vez, tipo: aluguel 900 dia 10. Quando acabar, responde PRONTO.'
    case 'fim': return ''
  }
}

export const TEXTO_FIM = 'Prontinho, tudo configurado! Eu te aviso no WhatsApp um dia antes de cada conta vencer, às 9h. Agora é só me mandar o que entrou ou saiu, do seu jeito: texto, áudio, foto do comprovante ou print do extrato.'
export const MAIS_FIXA = 'Mais alguma conta de todo mês? Me manda do mesmo jeito, ou PRONTO.'

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

/** Dinheiro em espécie em vez de banco. */
export const ehEspecie = (t: string) => /\b(dinheiro|especie|gaveta|carteira fisica|em maos|vivo)\b/.test(norm(t)) && !chaveBanco(t)

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
const NAO_E_BANCO = /\b(paguei|pago|pagar|paga|recebi|receber|recebe|comprei|compra|gastei|gasto|vendi|venda|saldo|quanto|quanta|como|qual|quais|onde|quando|porque|ajuda|oi|ola|opa|bom|boa|obrigad\w*|valeu|reais|real|pix|luz|agua|aluguel|internet|conta|contas|fatura|sim|nao|pular|pronto|ok|beleza|tchau|cartao|credito|debito)\b/

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
