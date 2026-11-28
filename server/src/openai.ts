import { env } from './env.ts'
import { jsonAnthropic } from './anthropic.ts'
import { aceitaRaciocinio, chaveDaIA, fabricaDe, MODELO_AUDIO_FABRICA, MODELO_FABRICA, modeloDe, provedorDoModelo, tarefaDeEsquema } from './ia-config.ts'
import { classificarFalhaIA, ErroIA, registrarFalhaIA, registrarOkIA, valeTentarDeNovoIA, type TipoFalhaIA } from './ia-estado.ts'

/** Modelos de FÁBRICA (o que vale sem nada configurado na aba Configurações do admin). O modelo de cada mensagem é resolvido em ia-config.ts. */
export const MODELO = MODELO_FABRICA
export const MODELO_AUDIO = MODELO_AUDIO_FABRICA

// OPENAI_BASE_URL existe para os testes apontarem para uma IA falsa local. Em produção fica sem definir.
const BASE = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'

async function pedir(caminho: string, init: RequestInit, tentativas = 3): Promise<Response> {
  let cred = await chaveDaIA()
  for (let i = 0; ; i++) {
    let r: Response
    try {
      r = await fetch(BASE + caminho, { ...init, headers: { Authorization: `Bearer ${cred.chave}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25_000) })
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
    // A chave cadastrada na aba Configurações foi recusada (revogada, sem saldo): a Granninha não para por isso. Volta à chave do ambiente e segue.
    if ((tipo === 'sem_chave' || tipo === 'sem_cota') && cred.origem === 'banco') {
      console.error(`[ia-config] a chave cadastrada na tela foi recusada (${tipo}); usei a do ambiente: ${corpo.slice(0, 120)}`)
      cred = { chave: env('OPENAI_API_KEY'), origem: 'ambiente' }
      continue
    }
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

/**
 * Chamada mínima só para saber se a IA responde (sonda, ver ia-sonda.ts). NÃO passa por `pedir`: não mexe no estado da IA (quem decide é a sonda,
 * com confirmação) e não devolve uso para o custo por cliente. Uma mensagem curta e poucos tokens de saída; exige crédito de verdade, ao contrário
 * de listar modelos, que responderia mesmo com a cota zerada.
 */
export async function chamadaMinimaIA(modelo: string = MODELO, chaveInformada?: string): Promise<{ ok: true; uso: Uso } | { ok: false; tipo: TipoFalhaIA; detalhe: string }> {
  let chave: string
  try {
    chave = chaveInformada ?? (await chaveDaIA()).chave
  } catch (e) {
    return { ok: false, tipo: 'sem_chave', detalhe: (e as Error).message }
  }
  try {
    const r = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, ...(aceitaRaciocinio(modelo) ? { reasoning_effort: 'low' } : {}), max_completion_tokens: 32, messages: [{ role: 'user', content: 'ok' }] }),
      signal: AbortSignal.timeout(20_000),
    })
    if (r.ok) {
      const j = (await r.json()) as { usage?: { prompt_tokens: number; completion_tokens: number } }
      return { ok: true, uso: { entrada: j.usage?.prompt_tokens ?? 0, saida: j.usage?.completion_tokens ?? 0 } }
    }
    const corpo = (await r.text()).slice(0, 300)
    // O modelo gastou todo o limite de saída pensando e a OpenAI respondeu 400 "max_tokens or model output limit was reached": a IA ESTÁ de pé (aceitou o
    // pedido e gerou). Visto em produção em 24/11: a sonda marcava "outro" e sujava o /saude sem haver problema nenhum.
    if (r.status === 400 && /output limit was reached|max_tokens or model output limit/i.test(corpo)) return { ok: true, uso: { entrada: 0, saida: 0 } }
    return { ok: false, tipo: classificarFalhaIA(r.status, corpo), detalhe: `OpenAI ${r.status}: ${corpo}` }
  } catch (e) {
    return { ok: false, tipo: 'fora', detalhe: (e as Error).message }
  }
}

export interface Uso {
  entrada: number
  saida: number
  /** Tokens de áudio da transcrição (cobrados à parte) */
  audio?: number
  /** Duração do áudio, quando a API devolve em segundos */
  audioSeg?: number
  /** Parte da entrada que o provedor leu do cache de prompt (mais barata). Já está DENTRO de `entrada`. */
  cache?: number
  /** Parte da entrada que foi ESCRITA no cache (Anthropic, cobrada a 1,25x). Já está DENTRO de `entrada`. */
  cacheEscrita?: number
  /** Cada chamada feita de verdade: o modelo que RODOU (não o configurado), e o pedido quando caiu no reserva. É o que o custo por modelo usa. */
  chamadas?: ChamadaIA[]
}

export interface ChamadaIA {
  tarefa: string
  /** O modelo que respondeu. */
  modelo: string
  /** O modelo configurado, só quando ele falhou e a chamada caiu no de fábrica. */
  pedido?: string
  entrada: number
  saida: number
  cache?: number
  cacheEscrita?: number
  audio?: number
  audioSeg?: number
}

/** Marca no uso qual modelo rodou (e se foi o reserva). */
function comChamada(uso: Uso, tarefa: string, modelo: string, pedido?: string): Uso {
  const c: ChamadaIA = { tarefa, modelo, entrada: uso.entrada, saida: uso.saida }
  if (pedido) c.pedido = pedido
  if (uso.cache) c.cache = uso.cache
  if (uso.cacheEscrita) c.cacheEscrita = uso.cacheEscrita
  if (uso.audio) c.audio = uso.audio
  if (uso.audioSeg) c.audioSeg = uso.audioSeg
  return { ...uso, chamadas: [c] }
}

/** O erro é a OpenAI recusando o MODELO (nome inexistente ou sem acesso), e não cota, chave ou instabilidade? */
function recusouOModelo(e: unknown): boolean {
  return e instanceof ErroIA && (e.status === 400 || e.status === 404) && /model/i.test(e.message)
}

/** Chamada com resposta em JSON validado por esquema. O modelo vem da configuração (cliente > todos > fábrica); se a OpenAI o recusar, repete com o de fábrica. */
export async function jsonEstruturado<T>(sistema: string, usuario: string | { type: string; [k: string]: unknown }[], nome: string, esquema: object): Promise<{ dados: T; uso: Uso }> {
  const tarefa = tarefaDeEsquema(nome)
  const escolhido = await modeloDe(tarefa)
  const chamar = async (modelo: string) => {
    // Modelo Claude: vai para a Anthropic (mesmo contrato de saída). Qualquer falha ali cai no modelo de fábrica da OpenAI, logo abaixo.
    if (provedorDoModelo(modelo) === 'anthropic') return jsonAnthropic<T>(modelo, sistema, usuario as never, nome, esquema)
    const r = await pedir('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo,
        ...(aceitaRaciocinio(modelo) ? { reasoning_effort: 'low' } : {}),
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: usuario },
        ],
        response_format: { type: 'json_schema', json_schema: { name: nome, strict: true, schema: esquema } },
      }),
    })
    const j = (await r.json()) as { choices: { message: { content: string; refusal?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } } }
    const msg = j.choices[0].message
    if (msg.refusal) throw new Error('Recusa do modelo: ' + msg.refusal)
    const cache = j.usage?.prompt_tokens_details?.cached_tokens ?? 0
    return { dados: JSON.parse(msg.content) as T, uso: { entrada: j.usage?.prompt_tokens ?? 0, saida: j.usage?.completion_tokens ?? 0, ...(cache ? { cache } : {}) } }
  }
  try {
    const r = await chamar(escolhido)
    return { ...r, uso: comChamada(r.uso, tarefa, escolhido) }
  } catch (e) {
    const fabrica = fabricaDe(tarefa)
    // Outro provedor (Anthropic) caindo por QUALQUER motivo, ou a OpenAI recusando o nome do modelo: volta ao de fábrica. Cota esgotada na OpenAI não repete (não gasta à toa).
    if (escolhido !== fabrica && (provedorDoModelo(escolhido) === 'anthropic' || recusouOModelo(e))) {
      console.error(`[ia-config] o modelo configurado "${escolhido}" falhou para ${tarefa}; usei o de fábrica "${fabrica}": ${(e as Error).message.slice(0, 160)}`)
      const r = await chamar(fabrica)
      return { ...r, uso: comChamada(r.uso, tarefa, fabrica, escolhido) }
    }
    throw e
  }
}

/** Transcreve um áudio (ogg/opus do WhatsApp) e devolve o consumo, para o custo no admin. */
/**
 * O nome do arquivo diz o formato para a transcrição. O WhatsApp manda sempre ogg; mp3 vem dos testes; webm, m4a e wav vêm do áudio gravado
 * no navegador pelo simulador do admin (Chrome grava webm, Safari grava mp4).
 */
export function nomeDoAudio(mime: string): string {
  if (mime.includes('mpeg')) return 'audio.mp3'
  if (mime.includes('webm')) return 'audio.webm'
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'audio.m4a'
  if (mime.includes('wav')) return 'audio.wav'
  return 'audio.ogg'
}

export async function transcrever(audio: Buffer, mime = 'audio/ogg'): Promise<{ texto: string; uso: Uso }> {
  const escolhido = await modeloDe('audio')
  const enviar = (modelo: string) => {
    const form = new FormData()
    form.append('model', modelo)
    form.append('language', 'pt')
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), nomeDoAudio(mime))
    return pedir('/audio/transcriptions', { method: 'POST', body: form })
  }
  let r: Response
  let rodou = escolhido
  try {
    r = await enviar(escolhido)
  } catch (e) {
    if (escolhido !== MODELO_AUDIO_FABRICA && recusouOModelo(e)) {
      console.error(`[ia-config] o modelo de áudio configurado "${escolhido}" foi recusado; usei o de fábrica "${MODELO_AUDIO_FABRICA}": ${(e as Error).message.slice(0, 160)}`)
      r = await enviar(MODELO_AUDIO_FABRICA)
      rodou = MODELO_AUDIO_FABRICA
    } else throw e
  }
  const j = (await r.json()) as {
    text: string
    usage?: { type?: string; seconds?: number; input_tokens?: number; output_tokens?: number; input_token_details?: { audio_tokens?: number; text_tokens?: number } }
  }
  const u = j.usage
  const uso: Uso = { entrada: u?.input_token_details?.text_tokens ?? 0, saida: u?.output_tokens ?? 0 }
  if (u?.type === 'duration' && u.seconds) uso.audioSeg = u.seconds
  else if (u) uso.audio = u.input_token_details?.audio_tokens ?? u.input_tokens ?? 0
  return { texto: j.text.trim(), uso: comChamada(uso, 'audio', rodou, rodou !== escolhido ? escolhido : undefined) }
}
