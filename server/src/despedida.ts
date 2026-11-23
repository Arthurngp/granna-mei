/**
 * Despedida, agradecimento e "ok": mensagens que NÃO são cumprimento nem pedido. Caso de origem (2026-11-18): o dono
 * mandou um áudio "tá bom, beleza, volto mais tarde" e a Granninha recomeçou do zero com "Oi, me manda o que entrou".
 *
 * Reconhecido por código, antes da IA: custa zero e nunca vira lançamento. Frase com número, pergunta ou palavra de
 * dinheiro nunca entra aqui ("ok, recebi 50", "valeu, quanto tenho?"): essas seguem o fluxo normal.
 */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s?$]/gu, ' ').replace(/\s+/g, ' ').trim()

export type Despedida = 'silencio' | 'agradecimento' | 'despedida'

const DINHEIRO = /(recebi|gastei|paguei|pagar|receber|entrou|saiu|saldo|quanto|valor|reais|real|r\$|pix|vendi|comprei|gasto|conta|fatura|boleto|lanc|anota|registr|desfaz|corrig)/
const SO_EMOJI = /^[\s\p{Extended_Pictographic}‍️\p{Emoji_Modifier}]+$/u

const ACK = /^(ok|okay|okk|blz|beleza|belezinha|show|top|certo|certinho|entendi|entendido|combinado|fechado|fechou|perfeito|otimo|massa|joia|de boa|tranquilo|ta bom|ta certo|ta|tudo bem|tudo certo|sim|isso|isso mesmo|uhum|aham|pode ser|tmj|tamo junto|tamo ai|pode crer|pode cre|firmeza|suave|sussa|maravilha|positivo|boa|show de bola|top demais|demais|da hora|dahora|legal|bacana|gostei|gostei demais|gostei muito)( (ok|blz|beleza|show|top|certo|entendi|combinado|fechado|tudo bem|pode ser|tmj|pode crer|pode cre))*$/
const OBRIGADO = /\b(obrigad[oa]s?|brigad[oa]|valeu|vlw|agradec\w*|grat[oa])\b/
const ADEUS = /\b(volto|voltei? mais tarde|ate (mais|logo|amanha|depois|ja)|tchau|falou|flw|fui|boa noite|boa tarde ate|depois (eu )?(volto|falo|mando)|mais tarde (eu )?(volto|falo|mando)|qualquer coisa eu (chamo|falo))\b/

/**
 * Devolve o que fazer com a mensagem, ou null se é outra coisa.
 * 'silencio' = não responde nada (confirmação seca: "ok", "beleza", só emoji).
 */
export function despedidaDe(texto: string): Despedida | null {
  const bruto = texto.trim()
  if (!bruto || bruto.length > 70) return null
  if (SO_EMOJI.test(bruto)) return 'silencio'
  const t = norm(bruto)
  if (!t || /\d/.test(t) || t.includes('?') || DINHEIRO.test(t)) return null
  if (ADEUS.test(t)) return 'despedida'
  if (OBRIGADO.test(t)) return 'agradecimento'
  // Só vale se a frase INTEIRA é confirmação: "tá bom, beleza" sim; "beleza, e a fatura" não.
  if (ACK.test(t.replace(/\s+(e|ai|entao)\s*$/, ''))) return 'silencio'
  return null
}

export const RESPOSTA_DESPEDIDA: Record<Exclude<Despedida, 'silencio'>, string> = {
  despedida: 'Fechado! Quando voltar é só me mandar o que entrou ou saiu.',
  agradecimento: 'Por nada! Qualquer coisa é só mandar.',
}
