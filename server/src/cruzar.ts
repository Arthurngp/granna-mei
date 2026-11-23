/**
 * Cruza o banco de ORIGEM e o de DESTINO de um comprovante com as carteiras do cliente, no código (a IA só lê o documento).
 *
 * Pedido do Arthur (23/11/2026): "só mandar o comprovante, ele identifica de qual banco saiu e, se conseguir, para qual foi, e entende se o Pix
 * entre bancos foi entrada, saída ou só dinheiro mudando de conta".
 *
 *  - origem é conta do cliente e destino também: TRANSFERÊNCIA entre contas dele (não é entrada nem saída, o total não muda);
 *  - só a origem é conta dele: SAÍDA dessa conta;
 *  - só o destino é conta dele: ENTRADA nessa conta;
 *  - nenhuma reconhecida: não decide, o fluxo segue como antes (pergunta de qual conta, se houver mais de uma).
 *
 * Só reconhece uma conta como DO CLIENTE quando (1) o nome do banco bate com UMA carteira de tipo banco dele e (2) o titular do comprovante é ele ou o
 * negócio dele (ou o comprovante não mostra titular). O Pix que ele RECEBEU de alguém que também usa Nubank não vira saída só porque ele tem Nubank.
 * Duas carteiras do mesmo banco (ex.: Nubank PF e PJ) são ambíguas: não decide, pergunta.
 */

export interface CarteiraBanco {
  id: string
  nome: string
  tipo: string
}

const tira = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Bancos e carteiras digitais conhecidos: a chave é o banco, o padrão é como ele aparece em comprovante ou no nome que o cliente deu à carteira. */
const BANCOS: [string, RegExp][] = [
  ['nubank', /\bnu\b|nubank|nu pagamentos|nu financeira|nu invest/],
  ['bradesco', /bradesco/],
  ['itau', /\bita[uú]\b|itau unibanco|banco itau/],
  ['inter', /banco inter\b|\binter\b|inter medium/],
  ['santander', /santander/],
  ['caixa', /caixa economica|\bcef\b|\bcaixa\b/],
  ['bb', /banco do brasil|\bbb\b/],
  ['c6', /\bc6\b/],
  ['mercadopago', /mercado pago|mercadopago|mercado livre/],
  ['picpay', /picpay|pic pay/],
  ['cora', /\bcora\b/],
  ['sicoob', /sicoob/],
  ['sicredi', /sicredi/],
  ['pagbank', /pagbank|pagseguro|pag seguro/],
  ['neon', /\bneon\b/],
  ['original', /banco original|\boriginal\b/],
  ['safra', /safra/],
  ['btg', /\bbtg\b/],
  ['xp', /\bxp\b/],
  ['will', /will bank|willbank/],
  ['next', /\bnext\b/],
  ['infinitepay', /infinitepay|infinite pay/],
  ['stone', /\bstone\b/],
  ['asaas', /asaas/],
  ['banrisul', /banrisul/],
  ['brb', /\bbrb\b/],
  ['bnb', /banco do nordeste|\bbnb\b/],
]

/** O banco a que um texto (nome de instituição de comprovante, nome de carteira) se refere, ou null se não for um banco conhecido. */
export function chaveBanco(texto: string | null | undefined): string | null {
  if (!texto) return null
  const t = tira(texto)
  if (!t) return null
  for (const [chave, re] of BANCOS) if (re.test(t)) return chave
  return null
}

/** O titular do comprovante é o dono (nome da pessoa ou do negócio)? Pelo menos 2 palavras em comum, ou 1 se o nome tem uma só. */
export function titularEhDono(titular: string | null | undefined, donos: (string | null | undefined)[]): boolean {
  const pal = (s: string) => tira(s).split(' ').filter((p) => p.length >= 3 && !['ltda', 'eireli', 'cia', 'servicos', 'comercio', 'mei'].includes(p))
  const t = new Set(pal(titular ?? ''))
  if (!t.size) return false
  for (const d of donos) {
    const pd = pal(d ?? '')
    if (!pd.length) continue
    const comuns = pd.filter((p) => t.has(p)).length
    if (comuns >= Math.min(2, pd.length)) return true
  }
  return false
}

export interface DadosBanco {
  banco_origem?: string | null
  titular_origem?: string | null
  banco_destino?: string | null
  titular_destino?: string | null
}

export type Cruzamento =
  | { tipo: 'transferencia'; de: CarteiraBanco; para: CarteiraBanco }
  | { tipo: 'saida'; carteira: CarteiraBanco }
  | { tipo: 'entrada'; carteira: CarteiraBanco }

/** A carteira do cliente a que esse lado do comprovante corresponde, ou null (banco desconhecido, sem carteira, ambíguo ou titular de outra pessoa). */
function ladoDoCliente(banco: string | null | undefined, titular: string | null | undefined, carteiras: CarteiraBanco[], donos: (string | null | undefined)[]): CarteiraBanco | null {
  const chave = chaveBanco(banco)
  if (!chave) return null
  // Titular escrito e que não é o dono: é a conta de outra pessoa, mesmo que seja do mesmo banco.
  if (titular && titular.trim() && !titularEhDono(titular, donos)) return null
  const iguais = carteiras.filter((c) => c.tipo === 'banco' && chaveBanco(c.nome) === chave)
  return iguais.length === 1 ? iguais[0] : null
}

export function cruzarComprovante(l: DadosBanco, carteiras: CarteiraBanco[], donos: (string | null | undefined)[]): Cruzamento | null {
  const o = ladoDoCliente(l.banco_origem, l.titular_origem, carteiras, donos)
  const d = ladoDoCliente(l.banco_destino, l.titular_destino, carteiras, donos)
  if (o && d) return o.id !== d.id ? { tipo: 'transferencia', de: o, para: d } : null
  if (o) return { tipo: 'saida', carteira: o }
  if (d) return { tipo: 'entrada', carteira: d }
  return null
}
