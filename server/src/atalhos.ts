/**
 * Atalhos de código para mensagens que não precisam de IA e que a IA costuma errar. Decididos por regex, antes da
 * interpretação: custam zero e têm resposta certa.
 *
 *  - "apaga tudo": pedido destrutivo. A Granninha só desfaz o ÚLTIMO registro, então diz isso e aponta o painel,
 *    em vez de responder "não tem nada para desfazer" ou, pior, desfazer o último sem a pessoa ter pedido só isso.
 *  - número sozinho ("150", "R$ 1.250,50"): é o valor de alguma coisa. Vai perguntar "de quê? entrou ou saiu?", e
 *    não responder "isso eu não sei te ajudar".
 */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

const VERBO_APAGAR = '(apaga|apague|apagar|limpa|limpe|limpar|zera|zere|zerar|deleta|delete|deletar|exclui|exclua|excluir|remove|remova|remover)'

/** "apaga tudo", "limpa todos os lançamentos", "zera tudo": pedido de apagar mais do que o último registro. */
export function ehApagarTudo(texto: string): boolean {
  if (texto.length > 70) return false
  const t = norm(texto)
  const re = new RegExp(`^${VERBO_APAGAR} (tudo|tudo isso|geral|todos|todas|todos os (meus )?(lancamentos|registros)|(meus|os) (lancamentos|registros)|tudo que (eu )?(lancei|anotei|registrei))( por favor| pf)?$`)
  return re.test(t)
}

/** Resposta à pergunta "dar baixa na conta ou anotar como outro gasto?": 1 dá baixa, 2 anota à parte. */
export function respostaBaixa(texto: string): 'baixa' | 'novo' | null {
  const t = norm(texto)
  if (/^(1|sim|s|dar baixa|baixa|pode|a conta|e a conta)$/.test(t)) return 'baixa'
  if (/^(2|nao|n|outro|outro gasto|outro recebimento|novo|deixa aberta|deixa a conta aberta)$/.test(t)) return 'novo'
  return null
}

/** Mensagem que é só um valor ("150", "R$ 1.250,50", "20 reais", "50 conto"): devolve o número, ou null. */
export function valorSozinho(texto: string): number | null {
  const t = texto.trim().toLowerCase().replace(/\s+/g, ' ')
  const m = /^(?:r\$\s?)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:reais|real|conto|contos|pila|pilas)?$/.exec(t)
  if (!m) return null
  const v = Number(m[1].replace(/\./g, '') + (m[2] ? `.${m[2]}` : ''))
  // "1", "2", "3" soltos são quase sempre resposta de uma lista de opções: só viram valor com "reais" ou "R$", ou a partir de 10.
  const comMoeda = /r\$|reais|real|conto|pila/.test(t)
  if (!comMoeda && !m[2] && v < 10) return null
  return v > 0 && v < 10_000_000 ? v : null
}
