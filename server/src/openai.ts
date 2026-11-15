import { env } from './env.ts'

export const MODELO = process.env.OPENAI_MODELO ?? 'gpt-5.4-mini'
export const MODELO_AUDIO = process.env.OPENAI_MODELO_AUDIO ?? 'gpt-4o-mini-transcribe'

const BASE = 'https://api.openai.com/v1'

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
      throw e
    }
    if (r.ok) return r
    // Limite de taxa ou instabilidade do lado deles: espera e tenta de novo. Erro nosso (400) não adianta repetir.
    if (i + 1 < tentativas && (r.status === 429 || r.status >= 500)) {
      await new Promise((ok) => setTimeout(ok, 800 * 2 ** i))
      continue
    }
    throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`)
  }
}

export interface Uso {
  entrada: number
  saida: number
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

/** Transcreve um áudio (ogg/opus do WhatsApp). */
export async function transcrever(audio: Buffer, mime = 'audio/ogg'): Promise<string> {
  const form = new FormData()
  form.append('model', MODELO_AUDIO)
  form.append('language', 'pt')
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), mime.includes('mpeg') ? 'audio.mp3' : 'audio.ogg')
  const r = await pedir('/audio/transcriptions', { method: 'POST', body: form })
  const j = (await r.json()) as { text: string }
  return j.text.trim()
}
