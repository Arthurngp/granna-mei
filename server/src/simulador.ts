/**
 * Simulador de conversa do admin (pedido do Arthur em 2026-11-27): testar a Granninha inteira, do código de confirmação ao lançamento, sem
 * WhatsApp. A mensagem do simulador entra pelo MESMO caminho do webhook (registro, espera de rajada, processar), e o que sairia para o
 * WhatsApp (resposta, tiques azuis, "digitando...", reação, e também avisos e lembretes automáticos) cai na caixa de saída daqui.
 *
 * O desvio vale só para uma lista FIXA de números com DDD 00, que não existe no Brasil: nenhuma pessoa real tem esse número, e o gateway
 * nunca é chamado para ele. Comparação exata, nunca por prefixo: um endereço @lid real pode começar com os mesmos dígitos.
 *
 * Este arquivo não importa nada do resto do servidor (o gateway importa daqui): sem banco, sem IA, sem import circular.
 * Caixa de saída e mídia ficam na memória, com teto. Reiniciar o servidor (deploy) zera as duas; o histórico gravado no banco fica.
 */
import { randomBytes } from 'node:crypto'

/** Os números do simulador. DDD 00 + 9 + 8 dígitos: passa no `chaveDoNumero` e na coluna `whats_chave` (chave 00 + 8 dígitos). */
export const SIM_NUMEROS = ['5500900000001', '5500900000002', '5500900000003', '5500900000004', '5500900000005', '5500900000006'] as const
const SIM = new Set<string>(SIM_NUMEROS)

/**
 * O número do simulador por trás de um destino, ou null. Aceita o número com DDI, o JID `@s.whatsapp.net` e o formato do perfil
 * "(00) 90000-0001". Qualquer outro domínio de JID (@lid, grupo) é sempre null.
 */
export function numeroDoSimulador(para: string): string | null {
  const s = String(para ?? '').trim()
  const arroba = s.indexOf('@')
  if (arroba >= 0 && s.slice(arroba) !== '@s.whatsapp.net') return null
  const d = (arroba >= 0 ? s.slice(0, arroba) : s).split(':')[0].replace(/\D/g, '')
  if (SIM.has(d)) return d
  if (arroba < 0 && SIM.has('55' + d)) return '55' + d
  return null
}
export const ehDoSimulador = (para: string) => numeroDoSimulador(para) !== null

/* ---------------- caixa de saída ---------------- */

export type TipoEventoSim = 'entrada' | 'texto' | 'lida' | 'digitando' | 'parou' | 'reacao'
export interface EventoSim {
  seq: number
  em: string
  tipo: TipoEventoSim
  /** entrada: id da mensagem enviada pelo simulador. reacao: id da mensagem que recebeu a reação. */
  id?: string
  texto?: string
  emoji?: string
  ids?: string[]
  /** entrada com mídia: o que foi mandado (para a tela desenhar o balão). */
  midia?: { tipo: 'audio' | 'foto' | 'pdf'; nome: string }
}

const TETO_POR_NUMERO = 400
const caixas = new Map<string, EventoSim[]>()
let seq = 0

export function registrarNoSimulador(para: string, e: Omit<EventoSim, 'seq' | 'em'>): void {
  const n = numeroDoSimulador(para)
  if (!n) return
  const lista = caixas.get(n) ?? []
  lista.push({ ...e, seq: ++seq, em: new Date().toISOString() })
  if (lista.length > TETO_POR_NUMERO) lista.splice(0, lista.length - TETO_POR_NUMERO)
  caixas.set(n, lista)
}

/** Eventos do número depois do `seq` informado (0 = todos os que estão na memória). */
export function eventosDoSimulador(numero: string, depois = 0): EventoSim[] {
  const n = numeroDoSimulador(numero)
  if (!n) return []
  return (caixas.get(n) ?? []).filter((e) => e.seq > depois)
}

export function limparCaixaDoSimulador(numero: string): void {
  const n = numeroDoSimulador(numero)
  if (n) caixas.delete(n)
}

/* ---------------- mídia ---------------- */

/**
 * Mídia mandada pelo simulador. O `fileUrl` passa no formato que o gateway usa (/api/media/arquivo), com um prefixo e 32 hex aleatórios que
 * o gateway real não gera. Arquivo com esse prefixo que não está aqui (expirou, servidor reiniciou) dá erro: nunca cai no gateway real.
 */
const PREFIXO_MIDIA = '/api/media/simulador-granninha-'
const MIDIA_VALE_MS = 2 * 60 * 60_000
const MIDIA_TETO = 60
export const MIDIA_MAX_BYTES = 8 * 1024 * 1024
const midias = new Map<string, { buffer: Buffer; mime: string; em: number }>()

export function guardarMidiaDoSimulador(buffer: Buffer, mime: string, ext: string): string {
  const agora = Date.now()
  for (const [k, v] of midias) if (agora - v.em > MIDIA_VALE_MS) midias.delete(k)
  while (midias.size >= MIDIA_TETO) midias.delete(midias.keys().next().value as string)
  const url = `${PREFIXO_MIDIA}${randomBytes(16).toString('hex')}.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin'}`
  midias.set(url, { buffer, mime, em: agora })
  return url
}

/** undefined: não é mídia do simulador (segue para o gateway). Lança quando é do simulador e não está mais na memória. */
export function midiaDoSimulador(fileUrl: string): { buffer: Buffer; mime: string } | undefined {
  if (!fileUrl.startsWith(PREFIXO_MIDIA)) return undefined
  const m = midias.get(fileUrl)
  if (!m) throw new Error('mídia do simulador não está mais na memória (expirou ou o servidor reiniciou)')
  return { buffer: m.buffer, mime: m.mime }
}

/* ---------------- evento ---------------- */

export type TipoEnvioSim = 'texto' | 'audio' | 'foto' | 'pdf'

/** O evento que o gateway mandaria para esta mensagem (mesmo formato do webhook do WA-AKG, conferido nos testes do fluxo). */
export function eventoDoSimulador(numero: string, m: { tipo: TipoEnvioSim; texto?: string; fileUrl?: string; nomeArquivo?: string; nome?: string }) {
  const n = numeroDoSimulador(numero)
  if (!n) throw new Error('número fora do simulador')
  const jid = `${n}@s.whatsapp.net`
  const id = `SIM${randomBytes(10).toString('hex').toUpperCase()}`
  const tipo = m.tipo === 'texto' ? 'TEXT' : m.tipo === 'audio' ? 'AUDIO' : m.tipo === 'foto' ? 'IMAGE' : 'DOCUMENT'
  const data: Record<string, unknown> = { key: { id, remoteJid: jid, fromMe: false }, from: jid, isGroup: false, chatType: 'PERSONAL', type: tipo, pushName: m.nome ?? 'Simulador' }
  if (m.tipo === 'texto') data.content = m.texto ?? ''
  else if (m.tipo === 'audio') Object.assign(data, { content: '', fileUrl: m.fileUrl })
  else if (m.tipo === 'foto') Object.assign(data, { content: '', caption: m.texto ?? '', fileUrl: m.fileUrl })
  else Object.assign(data, { content: m.nomeArquivo || 'documento.pdf', caption: m.texto ?? '', fileUrl: m.fileUrl })
  return { id, evento: { event: 'message.received', sessionId: 'simulador', data } }
}
