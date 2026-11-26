/**
 * Cliente do gateway WA-AKG próprio da Granninha (nunca o do NGP Space nem o do Mattilha).
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

export const TENTATIVAS_ENVIO = Number(process.env.ENVIO_TENTATIVAS ?? 3)
const ESPERA_ENVIO_MS = Number(process.env.ENVIO_ESPERA_MS ?? 1000)

/**
 * Manda texto para um número ("5581987654321" ou JID).
 * Tenta de novo quando a falha pode ser passageira (gateway reiniciando, rede, 5xx, 429): a cliente
 * que não recebe resposta acha que não foi anotado e manda de novo, e aí sim vira lançamento em dobro.
 * 4xx de pedido inválido não se repete, porque daria exatamente o mesmo erro.
 */
export async function enviarTexto(para: string, texto: string, tentativas = TENTATIVAS_ENVIO): Promise<void> {
  const jid = para.includes('@') ? para : `${para.replace(/\D/g, '')}@s.whatsapp.net`
  let ultimo = ''
  for (let i = 0; i < Math.max(1, tentativas); i++) {
    if (i) await new Promise((ok) => setTimeout(ok, ESPERA_ENVIO_MS * 2 ** (i - 1)))
    let st = 0
    try {
      const r = await fetch(`${base()}/api/messages/${sessao()}/${encodeURIComponent(jid)}/send`, {
        method: 'POST',
        headers: cabecalhos(),
        body: JSON.stringify({ message: { text: texto } }),
        signal: AbortSignal.timeout(15_000),
      })
      if (r.ok) return
      st = r.status
      ultimo = `gateway envio ${r.status}: ${(await r.text()).slice(0, 200)}`
    } catch (e) {
      ultimo = `gateway envio: ${(e as Error).message}`
    }
    if (st >= 400 && st < 500 && st !== 408 && st !== 429) break
  }
  throw new Error(ultimo || 'gateway envio: falhou')
}

/**
 * Pergunta ao WhatsApp se um número existe e qual é o endereço real dele (rota lida no código do WA-AKG, commit 936b26b:
 * POST /api/chat/{sessao}/check com { numbers: [...] } devolve data.results[{ number, exists, jid }]).
 * Serve para número que ninguém confirmou: no Brasil o endereço real muitas vezes não tem o nono dígito. Qualquer resposta que não seja clara LANÇA,
 * e quem chama trata como "não envia".
 */
export async function conferirNumero(telefone: string): Promise<{ existe: boolean; jid: string | null }> {
  const numero = telefone.replace(/\D/g, '')
  if (numero.length < 12) throw new Error('gateway conferir número: número curto demais')
  const r = await fetch(`${base()}/api/chat/${sessao()}/check`, { method: 'POST', headers: cabecalhos(), body: JSON.stringify({ numbers: [numero] }), signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`gateway conferir número ${r.status}`)
  const j = (await r.json()) as { status?: boolean; data?: { results?: { exists?: boolean; jid?: string | null; error?: string }[] } }
  const l = j.data?.results?.[0]
  if (j.status !== true || !l || l.error) throw new Error('gateway conferir número: resposta sem resultado')
  const jid = typeof l.jid === 'string' && /^\d{10,15}@s\.whatsapp\.net$/.test(l.jid) ? l.jid : null
  return { existe: l.exists === true && !!jid, jid }
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

/** Cria a sessão do número da Granninha se ainda não existir, com o robô automático do gateway desligado. */
export async function garantirSessao(): Promise<void> {
  const r = await fetch(`${base()}/api/sessions/${sessao()}`, { headers: cabecalhos(), signal: AbortSignal.timeout(10_000) })
  if (r.ok) return
  if (r.status !== 404) throw new Error(`gateway sessão ${r.status}`)
  const c = await fetch(`${base()}/api/sessions`, { method: 'POST', headers: cabecalhos(), body: JSON.stringify({ name: 'Granninha', sessionId: sessao() }), signal: AbortSignal.timeout(15_000) })
  if (!c.ok) throw new Error(`gateway criar sessão ${c.status}: ${(await c.text()).slice(0, 200)}`)
  await neutralizarRobo()
}

/** O WA-AKG tem um robô de comandos e respostas automáticas. A Granninha responde sozinha; o robô dele fica mudo. */
export async function neutralizarRobo(): Promise<void> {
  const r = await fetch(`${base()}/api/sessions/${sessao()}/bot-config`, {
    method: 'POST',
    headers: cabecalhos(),
    body: JSON.stringify({ enabled: false, botMode: 'SPECIFIC', botAllowedJids: [], autoReplyMode: 'SPECIFIC', autoReplyAllowedJids: [], enableSticker: false, enableVideoSticker: false, enablePing: false, enableUptime: false }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) throw new Error(`gateway robô ${r.status}`)
}

/**
 * Desvincula o aparelho da sessão (logout do WhatsApp). É o primeiro passo para trocar o número: depois dele a sessão fica
 * LOGGED_OUT e um novo `start` gera um QR para o chip novo. O WA-AKG não tem rota para apagar sessão (só start, stop, restart,
 * logout e pair), conferido no código do commit 936b26b: sem instância rodando, ele só marca LOGGED_OUT no banco.
 * Quem chama TEM que ter passado pela confirmação em duas etapas (trocar-whatsapp.ts): isto derruba o atendimento de todos.
 */
export async function desvincularSessao(): Promise<void> {
  const r = await fetch(`${base()}/api/sessions/${sessao()}/logout`, { method: 'POST', headers: cabecalhos(), body: '{}', signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`gateway logout ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

/** QR para parear o chip. Sem QR quando já está conectado. */
export async function qrDaSessao(): Promise<{ conectado: boolean; imagem: string | null; estado: string; numero: string | null }> {
  const st = await statusSessao()
  if (st.estado === 'CONNECTED') return { conectado: true, imagem: null, estado: st.estado, numero: st.numero }
  // A sessão existe no banco do gateway, mas pode não estar iniciada (depois de um reinício, por exemplo): inicia e espera o QR.
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${base()}/api/sessions/${sessao()}/qr`, { headers: cabecalhos(), signal: AbortSignal.timeout(15_000) })
    const j = (await r.json().catch(() => ({}))) as { base64?: string; data?: { base64?: string } }
    const imagem = j.data?.base64 ?? j.base64 ?? null
    if (imagem) return { conectado: false, imagem, estado: (await statusSessao()).estado, numero: null }
    if (i === 0) await fetch(`${base()}/api/sessions/${sessao()}/start`, { method: 'POST', headers: cabecalhos(), signal: AbortSignal.timeout(15_000) })
    await new Promise((ok) => setTimeout(ok, 3000))
  }
  return { conectado: false, imagem: null, estado: (await statusSessao()).estado, numero: null }
}

/**
 * Sinais de conversa (pedido do Arthur em 2026-11-26: "mostrar que está digitando" e "reagir à mensagem", para a conversa ficar fluida).
 * Rotas lidas no código do WA-AKG, commit 936b26b:
 * - POST /api/chat/{sessao}/{jid}/presence { presence: 'composing' | 'paused' }  (o "digitando..." some sozinho depois de uns segundos no WhatsApp)
 * - PUT  /api/chat/{sessao}/{jid}/read     { messageIds: [...] }                (os dois tiques azuis)
 * - POST /api/messages/{sessao}/{jid}/{id}/react { emoji }                      (reação na mensagem da pessoa)
 * Tudo é MELHOR ESFORÇO: uma tentativa, prazo curto, e falha nunca impede a resposta (só fica no log, no máximo uma vez por minuto).
 */
let avisouSinalEm = 0
async function sinal(caminho: string, metodo: 'POST' | 'PUT', corpo: unknown): Promise<boolean> {
  try {
    const r = await fetch(`${base()}${caminho}`, { method: metodo, headers: cabecalhos(), body: JSON.stringify(corpo), signal: AbortSignal.timeout(5_000) })
    if (r.ok) return true
    throw new Error(`HTTP ${r.status}`)
  } catch (e) {
    if (Date.now() - avisouSinalEm > 60_000) {
      avisouSinalEm = Date.now()
      console.error('[sinal] o gateway não aceitou', caminho.split('/').pop(), (e as Error).message)
    }
    return false
  }
}
/**
 * O jid e o id da mensagem vêm do webhook, e o id é escolhido pelo aparelho de quem envia (um cliente modificado manda qualquer texto). Antes de
 * irem para a URL do gateway, só passam no formato do WhatsApp: "." ou ".." virariam outra rota do gateway, com a nossa credencial.
 */
export const JID_VALIDO = /^\d{8,15}(:\d{1,3})?@(s\.whatsapp\.net|lid)$/
export const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/
const jidDe = (para: string): string | null => {
  const j = para.includes('@') ? para : `${para.replace(/\D/g, '')}@s.whatsapp.net`
  return JID_VALIDO.test(j) ? j : null
}
const nada = Promise.resolve(false)

export const digitando = (para: string, ligado: boolean) => {
  const j = jidDe(para)
  return j ? sinal(`/api/chat/${sessao()}/${encodeURIComponent(j)}/presence`, 'POST', { presence: ligado ? 'composing' : 'paused' }) : nada
}
export const marcarLidas = (para: string, ids: string[]) => {
  const j = jidDe(para)
  const validos = ids.filter((i) => ID_VALIDO.test(i))
  return j && validos.length ? sinal(`/api/chat/${sessao()}/${encodeURIComponent(j)}/read`, 'PUT', { messageIds: validos }) : nada
}
export const reagir = (para: string, msgId: string, emoji: string) => {
  const j = jidDe(para)
  return j && ID_VALIDO.test(msgId) ? sinal(`/api/messages/${sessao()}/${encodeURIComponent(j)}/${encodeURIComponent(msgId)}/react`, 'POST', { emoji }) : nada
}
