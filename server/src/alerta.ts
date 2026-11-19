/**
 * Aviso no WhatsApp do dono quando a Granninha para de funcionar.
 *
 * Existe por causa de 2026-11-19: a chave da OpenAI ficou sem cota, a Granninha respondeu "tive um
 * problema para anotar agora" para todos os clientes por horas, e ninguém foi avisado — o Arthur só
 * soube porque eu estava rodando um teste por outro motivo.
 *
 * LIMITE QUE ESTE ARQUIVO NÃO RESOLVE: o aviso sai pelo mesmo WhatsApp que pode estar quebrado. Se o
 * gateway cair ou o número for banido, não há como avisar por aqui — por isso o problema é registrado
 * de qualquer jeito (o admin mostra) e existe um olho de fora batendo no /saude.
 */
export interface ConfigAlerta {
  /** Número que recebe o aviso. Vazio = alerta desligado. */
  alerta_whats: string
  alerta_ligado: boolean
  /** Último problema avisado, para não repetir a cada minuto. */
  alerta_tipo: string | null
  alerta_em: string | null
}

export interface Sintomas {
  iaOk: boolean
  iaProblema: string | null
  iaDesde: string | null
  whatsappEstado: string | null
  /** Mensagens com erro nas últimas 24h, se o chamador souber. */
  erros24h?: number | null
}

export interface Aviso {
  tipo: string
  texto: string
  /** Dá para entregar? O aviso de WhatsApp caído não sai pelo WhatsApp. */
  entregavel: boolean
}

/** Quanto tempo ficar calado sobre o MESMO problema. */
export const SILENCIO_MS = Number(process.env.ALERTA_SILENCIO_MS ?? 6 * 60 * 60_000)

const NOMES: Record<string, string> = {
  sem_cota: 'a IA está sem crédito',
  sem_chave: 'a chave da IA não está sendo aceita',
  limite: 'a IA está recusando por excesso de chamadas',
  fora: 'a IA está fora do ar',
  outro: 'a IA está recusando as mensagens',
}

/** Qual é o problema agora? null = está tudo de pé. */
export function problemaDe(s: Sintomas): Aviso | null {
  if (!s.iaOk) {
    const nome = NOMES[s.iaProblema ?? 'outro'] ?? NOMES.outro
    const desde = s.iaDesde ? ` desde ${hora(s.iaDesde)}` : ''
    return {
      tipo: `ia:${s.iaProblema ?? 'outro'}`,
      texto: `Atenção: ${nome}${desde}. Enquanto isso eu não consigo anotar nada do que os clientes mandarem.`,
      entregavel: s.whatsappEstado === 'CONNECTED',
    }
  }
  if (s.whatsappEstado && s.whatsappEstado !== 'CONNECTED') {
    return {
      tipo: `whatsapp:${s.whatsappEstado}`,
      // Fica registrado mesmo sem poder sair: é o que o admin mostra e o que o olho de fora pega.
      texto: `Atenção: o WhatsApp da Granninha está "${s.whatsappEstado}". Nenhum cliente consegue falar com ela.`,
      entregavel: false,
    }
  }
  return null
}

/** Texto de quando volta ao normal. Só sai se houve um aviso de problema antes. */
export function textoVoltou(tipoAnterior: string): string {
  const oQue = tipoAnterior.startsWith('ia:') ? 'A IA voltou' : 'O WhatsApp voltou'
  return `${oQue}. Já estou anotando normalmente, e o que ficou pendurado volta sozinho em alguns minutos.`
}

/**
 * O que fazer agora. Avisa quando o problema é novo, quando ele MUDA de tipo, quando passa do silêncio,
 * e uma vez quando volta ao normal. Entre isso, fica quieto — alerta que repete a cada minuto vira
 * ruído e deixa de ser lido.
 */
export function decidirAviso(c: ConfigAlerta, s: Sintomas, agora = Date.now()): { acao: 'nada' | 'avisar' | 'voltou'; aviso?: Aviso; motivo: string } {
  if (!c.alerta_ligado || !c.alerta_whats.trim()) return { acao: 'nada', motivo: 'alerta desligado ou sem número' }
  const p = problemaDe(s)
  if (!p) {
    if (c.alerta_tipo) return { acao: 'voltou', motivo: 'o problema passou' }
    return { acao: 'nada', motivo: 'tudo de pé' }
  }
  if (c.alerta_tipo !== p.tipo) return { acao: 'avisar', aviso: p, motivo: 'problema novo' }
  const desde = c.alerta_em ? agora - new Date(c.alerta_em).getTime() : Infinity
  if (desde >= SILENCIO_MS) return { acao: 'avisar', aviso: p, motivo: 'mesmo problema, passou do silêncio' }
  return { acao: 'nada', aviso: p, motivo: 'já avisei há pouco' }
}

function hora(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  } catch {
    return iso.slice(0, 16)
  }
}

/** Normaliza o número que o admin digitou. Devolve '' se não der para usar. */
export function numeroDeAviso(bruto: string): string {
  const d = String(bruto || '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 13) return ''
  return d.length <= 11 ? '55' + d : d
}
