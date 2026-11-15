/**
 * Foto de comprovante e PDF viram texto para o mesmo leitor das mensagens.
 * A IA descreve o que está no documento; quem decide o lançamento continua sendo o leitor + conferidor.
 */
import { jsonEstruturado, type Uso } from './openai.ts'

export interface Transacao {
  descricao: string
  valor: number
  movimento: 'entrada' | 'saida'
  data: string | null
}
export interface Leitura {
  tipo: 'comprovante' | 'extrato' | 'boleto' | 'nota' | 'outro'
  transacoes: Transacao[]
  vencimento: string | null
  resumo: string
}

const SISTEMA = `Você lê imagens e PDFs que um microempreendedor manda para registrar dinheiro.
Diga o tipo do documento e liste as transações que estão nele, com valor exatamente como aparece.
- comprovante (Pix, transferência, pagamento, recibo de venda): uma transação.
- boleto ou conta ainda não paga: tipo "boleto", uma transação de saída, e "vencimento" (AAAA-MM-DD).
- extrato: todas as transações que aparecem, cada uma com data (AAAA-MM-DD) quando houver.
- nota fiscal ou cupom: o total como uma transação.
- se não for documento de dinheiro: tipo "outro" e nenhuma transação.
Direção: "entrada" quando o dinheiro chegou para o dono (Pix recebido, venda), "saida" quando ele pagou.
"resumo": uma frase curta em português dizendo o que é, com o valor no formato 1234,56 (ex.: "Pix enviado de 89,90 para CEMIG em 14/11/2026").`

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tipo: { type: 'string', enum: ['comprovante', 'extrato', 'boleto', 'nota', 'outro'] },
    transacoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          descricao: { type: 'string' },
          valor: { type: 'number' },
          movimento: { type: 'string', enum: ['entrada', 'saida'] },
          data: { type: ['string', 'null'] },
        },
        required: ['descricao', 'valor', 'movimento', 'data'],
      },
    },
    vencimento: { type: ['string', 'null'] },
    resumo: { type: 'string' },
  },
  required: ['tipo', 'transacoes', 'vencimento', 'resumo'],
}

export async function lerDocumento(buffer: Buffer, mime: string, legenda: string): Promise<{ leitura: Leitura; uso: Uso }> {
  const b64 = buffer.toString('base64')
  const anexo = mime.includes('pdf')
    ? { type: 'file', file: { filename: 'documento.pdf', file_data: `data:application/pdf;base64,${b64}` } }
    : { type: 'image_url', image_url: { url: `data:${mime.startsWith('image/') ? mime : 'image/jpeg'};base64,${b64}` } }
  const texto = { type: 'text', text: legenda ? `Mensagem que veio junto: "${legenda}"` : 'Sem mensagem junto.' }
  const { dados, uso } = await jsonEstruturado<Leitura>(SISTEMA, [texto, anexo], 'documento', ESQUEMA)
  dados.transacoes = dados.transacoes.filter((t) => t.valor > 0)
  return { leitura: dados, uso }
}

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Texto que o leitor de mensagens entende, montado a partir do documento. */
export function textoDoDocumento(l: Leitura, legenda: string): string {
  if (l.tipo === 'boleto' && l.transacoes[0]) {
    const t = l.transacoes[0]
    return `${legenda} boleto de ${t.descricao} de ${brl(t.valor)} ${l.vencimento ? `vence dia ${l.vencimento.split('-').reverse().join('/')}` : ''}`.trim()
  }
  const t = l.transacoes[0]
  if (!t) return legenda
  const verbo = t.movimento === 'entrada' ? 'recebi' : 'paguei'
  const quando = t.data ? ` em ${t.data.split('-').reverse().join('/')}` : ''
  return `${legenda ? legenda + '. ' : ''}${verbo} ${brl(t.valor)} de ${t.descricao}${quando} (comprovante)`
}
