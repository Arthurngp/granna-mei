import { env } from './env.ts'
import { classificarFalhaIA, ErroIA, registrarFalhaIA, registrarOkIA, valeTentarDeNovoIA } from './ia-estado.ts'

export const MODELO = process.env.OPENAI_MODELO ?? 'gpt-5.4-mini'
export const MODELO_AUDIO = process.env.OPENAI_MODELO_AUDIO ?? 'gpt-4o-mini-transcribe'

// OPENAI_BASE_URL existe para os testes apontarem para uma IA falsa local. Em produção fica sem definir.
const BASE = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'

async function pedir(caminho: string, init: RequestInit, tentativas = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    let r: Response
    try {
      r = await fetch(BASE + caminho, { ...init, headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25_000) })
    } catch (e) {
      // Sem resposta a tempo ou queda de rede: tenta de novo.
      if (i + 1 < tentativas) {
        await new Promise((ok) => setTimeout(ok, 800 * 2 ** i))
        continue
      }
      registrarFalhaIA('fora', (e as Error).message)
      throw new ErroIA('fora', `OpenAI fora: ${(e as Error).message}`)
    }
    if (r.ok) {
      registrarOkIA()
      return r
    }
    const corpo = (await r.text()).slice(0, 300)
    const tipo = classificarFalhaIA(r.status, corpo)
    // Insistir só quando insistir resolve. Cota esgotada e chave inválida não passam em 2 segundos:
    // repetir três vezes fazia a cliente esperar mais para receber exatamente o mesmo erro.
    if (i + 1 < tentativas && valeTentarDeNovoIA(tipo)) {
      await new Promise((ok) => setTimeout(ok, 800 * 2 ** i))
      continue
    }
    registrarFalhaIA(tipo, corpo)
    throw new ErroIA(tipo, `OpenAI ${r.status} (${tipo}): ${corpo}`, r.status)
  }
}

export interface Uso {
  entrada: number
  saida: number
  /** Tokens de áudio da transcrição (cobrados à parte) */
  audio?: number
  /** Duração do áudio, quando a API devolve em segundos */
  audioSeg?: number
}

/** Chamada com resposta em JSON validado por esquema. */
export async function jsonEstruturado<T>(sistema: string, usuario: string | { type: string; [k: string]: unknown }[], nome: string, esquema: object): Promise<{ dados: T; uso: Uso }> {
  const r = await pedir('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: usuario },
      ],
      response_format: { type: 'json_schema', json_schema: { name: nome, strict: true, schema: esquema } },
    }),
  })
  const j = (await r.json()) as { choices: { message: { content: string; refusal?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } }
  const msg = j.choices[0].message
  if (msg.refusal) throw new Error('Recusa do modelo: ' + msg.refusal)
  return { dados: JSON.parse(msg.content) as T, uso: { entrada: j.usage?.prompt_tokens ?? 0, saida: j.usage?.completion_tokens ?? 0 } }
}

/** Transcreve um áudio (ogg/opus do WhatsApp) e devolve o consumo, para o custo no admin. */
export async function transcrever(audio: Buffer, mime = 'audio/ogg'): Promise<{ texto: string; uso: Uso }> {
  const form = new FormData()
  form.append('model', MODELO_AUDIO)
  form.append('language', 'pt')
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), mime.includes('mpeg') ? 'audio.mp3' : 'audio.ogg')
  const r = await pedir('/audio/transcriptions', { method: 'POST', body: form })
  const j = (await r.json()) as {
    text: string
    usage?: { type?: string; seconds?: number; input_tokens?: number; output_tokens?: number; input_token_details?: { audio_tokens?: number; text_tokens?: number } }
  }
  const u = j.usage
  const uso: Uso = { entrada: u?.input_token_details?.text_tokens ?? 0, saida: u?.output_tokens ?? 0 }
  if (u?.type === 'duration' && u.seconds) uso.audioSeg = u.seconds
  else if (u) uso.audio = u.input_token_details?.audio_tokens ?? u.input_tokens ?? 0
  return { texto: j.text.trim(), uso }
}
