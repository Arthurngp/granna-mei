/**
 * Adaptador da Anthropic (Messages API). Só é usado quando o modelo escolhido na aba Configurações começa com "claude" (ver provedorDoModelo em ia-config.ts).
 *
 * Fala o mesmo "idioma" que o resto do servidor espera de jsonEstruturado: recebe sistema + usuário (texto ou blocos de texto/imagem/PDF no formato da OpenAI)
 * e devolve { dados, uso }. A saída em JSON vem por uma ferramenta forçada (tool_choice), que a API obriga a seguir o esquema.
 *
 * Regras:
 *  - Sem tentativas repetidas aqui: quem chama (openai.ts) cai no modelo de fábrica da OpenAI em qualquer falha, e isso é mais rápido e mais seguro que insistir.
 *  - NÃO mexe no estado de saúde da IA (registrarFalhaIA/OkIA): esse estado e o alerta ao dono são da OpenAI, que é o caminho que sustenta a Granninha.
 *  - Nenhum erro devolvido contém a chave.
 */
import { chaveDaAnthropic } from './ia-config.ts'
import { classificarFalhaIA, ErroIA, type TipoFalhaIA } from './ia-estado.ts'
import type { Uso } from './openai.ts'

// ANTHROPIC_BASE_URL existe para os testes apontarem para uma IA falsa local. Em produção fica sem definir.
const BASE = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1'
const VERSAO = '2023-06-01'
const MAX_SAIDA = 4096

type Bloco = { type: string; [k: string]: unknown }

/** Blocos no formato da OpenAI (texto, image_url data:, file pdf) → blocos da Anthropic (texto, image, document). */
export function paraBlocosAnthropic(usuario: string | Bloco[]): string | Bloco[] {
  if (typeof usuario === 'string') return usuario
  return usuario.map((b): Bloco => {
    if (b.type === 'text') return { type: 'text', text: String(b.text ?? '') }
    if (b.type === 'image_url') {
      const url = String((b.image_url as { url?: string } | undefined)?.url ?? '')
      const m = /^data:([^;]+);base64,(.+)$/s.exec(url)
      return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : { type: 'image', source: { type: 'url', url } }
    }
    if (b.type === 'file') {
      const dados = String((b.file as { file_data?: string } | undefined)?.file_data ?? '')
      const m = /^data:([^;]+);base64,(.+)$/s.exec(dados)
      if (m) return { type: 'document', source: { type: 'base64', media_type: m[1], data: m[2] } }
    }
    throw new Error('Bloco de conteúdo sem equivalente na Anthropic: ' + b.type)
  })
}

async function chamar(modelo: string, chave: string, corpo: object, ms: number): Promise<Response> {
  return fetch(BASE + '/messages', {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': VERSAO, 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, ...corpo }),
    signal: AbortSignal.timeout(ms),
  })
}

const sem = (texto: string, chave: string) => texto.split(chave).join('•••')

/** Resposta em JSON validado pelo esquema, usando o modelo Claude escolhido. Qualquer problema vira ErroIA (e o chamador cai na OpenAI). */
export async function jsonAnthropic<T>(modelo: string, sistema: string, usuario: string | Bloco[], nome: string, esquema: object): Promise<{ dados: T; uso: Uso }> {
  const cred = await chaveDaAnthropic()
  if (!cred) throw new ErroIA('sem_chave', 'Anthropic: nenhuma chave cadastrada nem ANTHROPIC_API_KEY no ambiente')
  let r: Response
  try {
    r = await chamar(
      modelo,
      cred.chave,
      {
        max_tokens: MAX_SAIDA,
        system: sistema,
        messages: [{ role: 'user', content: paraBlocosAnthropic(usuario) }],
        tools: [{ name: nome, description: 'Devolva a resposta exatamente neste formato.', input_schema: esquema }],
        tool_choice: { type: 'tool', name: nome },
      },
      15_000, // curto de propósito: se a Anthropic travar, a pessoa não espera mais que isso antes de a conversa cair na OpenAI
    )
  } catch (e) {
    throw new ErroIA('fora', `Anthropic fora: ${sem((e as Error).message, cred.chave)}`)
  }
  if (!r.ok) {
    const corpo = sem((await r.text()).slice(0, 300), cred.chave)
    throw new ErroIA(classificarFalhaIA(r.status, corpo), `Anthropic ${r.status}: ${corpo}`, r.status)
  }
  const j = (await r.json()) as { content?: { type: string; name?: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } }
  const uso = j.content?.find((c) => c.type === 'tool_use' && c.name === nome)
  if (!uso || typeof uso.input !== 'object' || uso.input === null) throw new ErroIA('outro', 'Anthropic não devolveu a resposta no formato pedido')
  return { dados: uso.input as T, uso: { entrada: j.usage?.input_tokens ?? 0, saida: j.usage?.output_tokens ?? 0 } }
}

/** Chamada mínima só para saber se uma chave (e, se informado, o modelo) da Anthropic funciona. Mesmo contrato de chamadaMinimaIA. */
export async function chamadaMinimaAnthropic(modelo: string, chaveInformada?: string): Promise<{ ok: true; uso: Uso } | { ok: false; tipo: TipoFalhaIA; detalhe: string }> {
  const chave = chaveInformada ?? (await chaveDaAnthropic())?.chave
  if (!chave) return { ok: false, tipo: 'sem_chave', detalhe: 'Nenhuma chave da Anthropic cadastrada. Cadastre uma em "Chave de API" antes de escolher um modelo Claude.' }
  try {
    const r = await chamar(modelo, chave, { max_tokens: 16, messages: [{ role: 'user', content: 'ok' }] }, 20_000)
    if (r.ok) {
      const j = (await r.json()) as { usage?: { input_tokens?: number; output_tokens?: number } }
      return { ok: true, uso: { entrada: j.usage?.input_tokens ?? 0, saida: j.usage?.output_tokens ?? 0 } }
    }
    const corpo = sem((await r.text()).slice(0, 300), chave)
    return { ok: false, tipo: classificarFalhaIA(r.status, corpo), detalhe: `Anthropic ${r.status}: ${corpo}` }
  } catch (e) {
    return { ok: false, tipo: 'fora', detalhe: sem((e as Error).message, chave) }
  }
}
