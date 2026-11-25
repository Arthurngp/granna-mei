/**
 * Fila de perguntas em aberto (item at-04 do backlog).
 *
 * Antes existia UMA pergunta em aberto por pessoa (`conversas.pendente`), e a seguinte apagava a anterior. O lançamento da pergunta apagada
 * não estava gravado em lugar nenhum e sumia sem aviso. Aconteceu com os dois únicos clientes que lançaram em novembro: 5 comprovantes em
 * 30 segundos (2 se perderam) e 5 áudios seguidos (o primeiro se perdeu). Com o onboarding pelo WhatsApp, que pede prints e extratos, a rajada
 * vira o caso comum.
 *
 * Como funciona agora:
 * - A pergunta que a pessoa acabou de ver continua sendo a "atual" (é a ela que o próximo "2" responde).
 * - Se uma pergunta nova chega e a anterior não foi respondida, a anterior vai para a `fila`, dentro do mesmo `pendente` (jsonb, sem migration).
 * - Quando a atual é respondida, a próxima da fila é feita de novo, junto da resposta: "E ficou esse aqui esperando: ...".
 * - Se a pessoa manda outra coisa e ignora a pergunta atual, ela é feita de novo UMA vez; ignorada de novo, sai, avisando o que ficou sem anotar.
 * - Cada pergunta vale 30 minutos desde que foi feita. Passou disso, sai, e a Granninha diz o que ficou sem anotar (nunca some calada).
 * - Só voltam as perguntas que seguram um registro ainda não gravado. "Já pagou?", "quer desfazer o anterior também?" e "é o mesmo lançamento?"
 *   não voltam.
 *
 * Tudo aqui é função pura: quem lê e grava é o granninha.ts.
 */

/** Uma pergunta guardada. É o próprio `pendente` de antes, mais quando foi feita e quantas vezes já voltou. */
export interface ItemFila {
  tipo?: string
  texto?: string
  pergunta?: string
  transacoes?: unknown[]
  opcoes?: { id: string; nome: string }[]
  acoes?: unknown[]
  /** Quando a pergunta foi feita (ISO). */
  em?: string
  /** Quantas vezes ela já voltou depois de ignorada. */
  voltas?: number
  [k: string]: unknown
}

export const PRAZO_MS = 30 * 60_000
/** No máximo quantas perguntas ficam guardadas atrás da atual. */
export const MAX_FILA = 5
/** Quantas vezes uma pergunta ignorada volta antes de sair. */
export const MAX_VOLTAS = 1
/** Pergunta que venceu há mais que isso sai calada: avisar dias depois que "ficou sem anotar" confunde mais do que ajuda. */
export const AVISO_ATE_MS = 24 * 60 * 60_000

/**
 * Perguntas que seguram um registro ainda não gravado: são as únicas que vale a pena guardar e fazer de novo. "É o mesmo lançamento?"
 * (duplicata, reenvio) fica de fora de propósito: quem mandou a mesma coisa duas vezes e seguiu em frente quase sempre repetiu por engano,
 * e perguntar de novo depois só atrapalha.
 */
export const RECUPERAVEIS = new Set(['pergunta', 'baixa_diferente', 'importar', 'importar_fatura'])

export const recuperavel = (p: ItemFila | null | undefined): p is ItemFila => !!p && typeof p.tipo === 'string' && RECUPERAVEIS.has(p.tipo) && !!p.pergunta

/** A pergunta passou do prazo? `quando` é o fallback para pendentes gravados antes desta mudança (sem `em`). */
export function venceu(p: ItemFila, agora: number, quando?: string | null): boolean {
  const t = new Date(p.em ?? quando ?? 0).getTime()
  return !Number.isFinite(t) || agora - t >= PRAZO_MS
}

/** O que ficou sem anotar, numa frase curta: o começo do que a pessoa mandou, sem a cola das respostas anteriores. */
export function resumoDe(p: ItemFila): string {
  if (p.tipo === 'importar' || p.tipo === 'importar_fatura') {
    const n = Array.isArray(p.transacoes) ? p.transacoes.length : 0
    return p.tipo === 'importar' ? `o extrato com ${n} lançamento${n === 1 ? '' : 's'}` : `a fatura com ${n} compra${n === 1 ? '' : 's'}`
  }
  const base = String(p.texto ?? '').split('\n')[0].replace(/\s*\(comprovante\)\s*$/, '').trim()
  if (!base) return 'um registro'
  return `"${base.length > 70 ? base.slice(0, 67).trimEnd() + '...' : base}"`
}

/** Separa o `pendente` lido do banco em atual e fila, cada um no formato de item. */
export function abrir(pendente: unknown): { atual: ItemFila | null; fila: ItemFila[] } {
  if (!pendente || typeof pendente !== 'object') return { atual: null, fila: [] }
  const { fila, ...atual } = pendente as ItemFila & { fila?: unknown }
  const lista = Array.isArray(fila) ? (fila.filter((x) => x && typeof x === 'object') as ItemFila[]) : []
  return { atual: atual.tipo ? (atual as ItemFila) : null, fila: lista }
}

/**
 * O `pendente` a gravar quando uma pergunta NOVA é feita. A anterior entra na fila se ainda valia, segurava um registro e a mensagem desta vez
 * não era a resposta dela (`consumiu`). A fila da anterior vem junto (sem as vencidas).
 */
export function comNova(nova: ItemFila, anterior: unknown, consumiu: boolean, agora: number, quandoAnterior?: string | null): ItemFila & { fila: ItemFila[] } {
  const { atual, fila } = abrir(anterior)
  const resto = fila.filter((x) => recuperavel(x) && !venceu(x, agora))
  if (atual && !consumiu && recuperavel(atual) && !venceu(atual, agora, quandoAnterior) && atual !== nova) {
    resto.unshift({ ...atual, em: atual.em ?? quandoAnterior ?? new Date(agora).toISOString() })
  }
  const { fila: _f, ...limpa } = nova as ItemFila & { fila?: unknown }
  return { ...limpa, em: limpa.em ?? new Date(agora).toISOString(), fila: resto.slice(0, MAX_FILA) }
}

/**
 * Depois de uma mensagem que NÃO deixou pergunta nova: o que fica em aberto e o que dizer a mais.
 * - `consumiu`: a mensagem respondeu a pergunta atual. Ela sai, e a próxima da fila volta.
 * - Senão a atual foi ignorada: volta uma vez (se ainda vale e segura registro); ignorada de novo, sai, avisando.
 * Devolve o pendente novo (ou null para limpar) e o texto a juntar na resposta (vazio = nada a dizer).
 */
export function depois(pendente: unknown, consumiu: boolean, agora: number, quando?: string | null): { pendente: (ItemFila & { fila: ItemFila[] }) | null; texto: string } {
  const { atual, fila } = abrir(pendente)
  const perdidos: ItemFila[] = []
  const candidatos: ItemFila[] = []
  if (atual && !consumiu && recuperavel(atual)) {
    if (venceu(atual, agora, quando) || (atual.voltas ?? 0) >= MAX_VOLTAS) perdidos.push(atual)
    else candidatos.push({ ...atual, voltas: (atual.voltas ?? 0) + 1 })
  }
  for (const x of fila) {
    if (!recuperavel(x)) continue
    if (venceu(x, agora)) perdidos.push(x)
    else candidatos.push(x)
  }
  const proxima = candidatos.shift() ?? null
  const partes: string[] = []
  const recentes = perdidos.filter((x) => agora - new Date(x.em ?? quando ?? 0).getTime() < AVISO_ATE_MS)
  if (recentes.length) {
    partes.push(`Ficou sem anotar, porque a pergunta ficou sem resposta: ${recentes.map(resumoDe).join(', ')}. Se quiser, me manda de novo.`)
  }
  if (proxima) {
    // Quem volta da fila ganha o prazo de novo a partir de agora: a pessoa acabou de ver a pergunta.
    partes.push(`E ficou esse aqui esperando:\n${proxima.pergunta}`)
    return { pendente: { ...proxima, em: new Date(agora).toISOString(), fila: candidatos.slice(0, MAX_FILA) }, texto: partes.join('\n\n') }
  }
  return { pendente: null, texto: partes.join('\n\n') }
}

/** "2" sozinho como resposta a "Qual foi o valor?": quase sempre era a opção de outra pergunta. Pede confirmação em vez de anotar R$ 2,00. */
export function valorSoltoDuvidoso(texto: string, pergunta: string | undefined): number | null {
  const m = /^\s*([1-9])\s*$/.exec(texto)
  if (!m || !pergunta) return null
  return /valor|quanto/i.test(pergunta) ? Number(m[1]) : null
}
