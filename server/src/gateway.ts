/**
 * Cliente do gateway WA-AKG próprio do Granna Mei (nunca o do NGP Space nem o do Mattilha).
 * Formato conferido no código do WA-AKG, commit 936b26b:
 * - envio: POST /api/messages/{sessao}/{jid}/send com { message: { text } } (texto puro dá 500);
 * - mídia recebida: GET /api/media/{arquivo}, com a chave da API.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env.ts'

function cabecalhos(): Record<string, string> {
  const h: Record<string, string> = { 'x-api-key': env('WA_GATEWAY_API_KEY'), 'Content-Type': 'application/json' }
  const basic = process.env.WA_GATEWAY_BASIC
  if (basic) h.Authorization = 'Basic ' + Buffer.from(basic).toString('base64')
  return h
}
const base = () => env('WA_GATEWAY_URL').replace(/\/+$/, '')
const sessao = () => env('WA_SESSAO', 'granninha')

/** Manda texto para um número ("5581987654321" ou JID). */
export async function enviarTexto(para: string, texto: string): Promise<void> {
  const jid = para.includes('@') ? para : `${para.replace(/\D/g, '')}@s.whatsapp.net`
  const r = await fetch(`${base()}/api/messages/${sessao()}/${encodeURIComponent(jid)}/send`, {
    method: 'POST',
    headers: cabecalhos(),
    body: JSON.stringify({ message: { text: texto } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`gateway envio ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

/** Baixa a mídia que o gateway guardou ("/api/media/arquivo.ogg"). Limite de 15 MB. */
export async function baixarMidia(fileUrl: string): Promise<{ buffer: Buffer; mime: string }> {
  if (!/^\/api\/media\/[A-Za-z0-9_.-]+$/.test(fileUrl)) throw new Error('caminho de mídia inválido')
  const r = await fetch(base() + fileUrl, { headers: cabecalhos(), signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`gateway mídia ${r.status}`)
  const buffer = Buffer.from(await r.arrayBuffer())
  if (buffer.length > 15 * 1024 * 1024) throw new Error('mídia grande demais')
  return { buffer, mime: r.headers.get('content-type') ?? 'application/octet-stream' }
}

export async function statusSessao(): Promise<{ estado: string; numero: string | null }> {
  const r = await fetch(`${base()}/api/sessions/${sessao()}`, { headers: cabecalhos(), signal: AbortSignal.timeout(10_000) })
  if (!r.ok) return { estado: `HTTP ${r.status}`, numero: null }
  const j = (await r.json()) as { data?: { status?: string; me?: { id?: string } } }
  return { estado: String(j.data?.status ?? 'DESCONHECIDO'), numero: j.data?.me?.id?.split('@')[0].split(':')[0] ?? null }
}

/** Confere a assinatura HMAC que o gateway põe em X-Webhook-Signature ("sha256=<hex>"). */
export function assinaturaValida(corpo: string, cabecalho: string | undefined): boolean {
  const segredo = env('WA_WEBHOOK_SECRET')
  if (!cabecalho?.startsWith('sha256=')) return false
  const esperado = createHmac('sha256', segredo).update(corpo).digest('hex')
  const veio = cabecalho.slice(7)
  return veio.length === esperado.length && timingSafeEqual(Buffer.from(veio), Buffer.from(esperado))
}
