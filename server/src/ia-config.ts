/**
 * Configuração da IA escolhida pelo dono no admin (aba Configurações): qual MODELO responde cada tarefa, para todos ou só para um cliente, e qual CHAVE de API
 * o servidor usa. Tudo é lido na hora de cada mensagem (cache de 60 s) e tem uma regra de ouro:
 *
 *   QUALQUER falha ao ler a configuração, valor inválido ou tabela ainda inexistente = o comportamento de antes (modelo de fábrica e chave do ambiente).
 *   A Granninha nunca para por causa de configuração.
 *
 * Ordem do modelo: o do CLIENTE (se houver) > o de TODOS (se houver) > o de fábrica (OPENAI_MODELO, hoje gpt-5.4-mini).
 * A chave cadastrada pela tela fica CIFRADA no banco (AES-256-GCM, segredo em IA_SEGREDO no ambiente do servidor); sem o segredo, ou se não decifrar,
 * vale a chave do ambiente. Chave e texto cifrado nunca saem do servidor.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { env } from './env.ts'

export type Tarefa = 'interpretacao' | 'documento' | 'ajuda' | 'resposta' | 'audio'
export const TAREFAS: { id: Tarefa; rotulo: string; detalhe: string }[] = [
  { id: 'interpretacao', rotulo: 'Entender a mensagem', detalhe: 'Lê o que a pessoa escreveu e monta o registro (a tarefa mais importante).' },
  { id: 'documento', rotulo: 'Ler comprovante, foto e PDF', detalhe: 'Precisa enxergar imagem.' },
  { id: 'ajuda', rotulo: 'Responder dúvidas de uso', detalhe: 'O que a Granninha faz e como usar.' },
  { id: 'resposta', rotulo: 'Responder perguntas sobre os números', detalhe: 'Quanto sobrou, o que vence, resumo.' },
  { id: 'audio', rotulo: 'Transcrever áudio', detalhe: 'Modelo de transcrição, não de chat.' },
]
export const TAREFAS_IDS = TAREFAS.map((t) => t.id)

export const MODELO_FABRICA = process.env.OPENAI_MODELO ?? 'gpt-5.4-mini'
export const MODELO_AUDIO_FABRICA = process.env.OPENAI_MODELO_AUDIO ?? 'gpt-4o-mini-transcribe'
export const fabricaDe = (t: Tarefa) => (t === 'audio' ? MODELO_AUDIO_FABRICA : MODELO_FABRICA)

/** Nome do esquema JSON pedido à IA → tarefa. Qualquer nome desconhecido é tratado como "entender a mensagem". */
export const tarefaDeEsquema = (nome: string): Tarefa => (nome === 'documento' ? 'documento' : nome === 'ajuda' ? 'ajuda' : nome === 'resposta' ? 'resposta' : 'interpretacao')

/** Nome de modelo aceitável (nunca vira comando: só letras, números e . _ : / -). */
export const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$/

/** Quem está sendo atendido agora: assim cada chamada de IA sabe de qual cliente é, sem passar o id por todas as funções. */
export const contextoIA = new AsyncLocalStorage<{ userId: string }>()

/* ---------------- cifra da chave ---------------- */

let chaveDerivada: { segredo: string; chave: Buffer } | null = null
function chaveDaCifra(): Buffer | null {
  const segredo = process.env.IA_SEGREDO
  if (!segredo || segredo.length < 16) return null
  if (chaveDerivada?.segredo !== segredo) chaveDerivada = { segredo, chave: scryptSync(segredo, 'granninha-ia-chaves-v1', 32) }
  return chaveDerivada.chave
}
export const segredoConfigurado = () => chaveDaCifra() !== null

export function cifrar(texto: string): string {
  const k = chaveDaCifra()
  if (!k) throw new Error('IA_SEGREDO não está configurado no servidor (mínimo de 16 caracteres): sem ele a chave não pode ser guardada.')
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decifrar(cifrado: string): string {
  const k = chaveDaCifra()
  if (!k) throw new Error('IA_SEGREDO ausente')
  const [v, iv, tag, ct] = cifrado.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('formato de chave cifrada desconhecido')
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

/* ---------------- leitura (com cache e sem nunca lançar) ---------------- */

interface Config {
  global: Partial<Record<Tarefa, string>>
  cliente: Map<string, Partial<Record<Tarefa, string>>>
  chave: { id: string; cifrada: string } | null
}
const VAZIA: Config = { global: {}, cliente: new Map(), chave: null }
const TTL_MS = 60_000
let cache: { ate: number; cfg: Config } | null = null
let avisouEm = 0

export const limparCacheIA = () => {
  cache = null
}

function avisar(onde: string, e: { message: string }) {
  // No máximo um aviso por minuto no log: configuração quebrada não pode inundar o servidor nem a conversa.
  if (Date.now() - avisouEm > 60_000) {
    avisouEm = Date.now()
    console.error(`[ia-config] não consegui ler ${onde} (sigo com o padrão): ${e.message}`)
  }
}

async function ler(): Promise<Config> {
  // Carregado só aqui (e não no topo do arquivo): o banco exige variáveis de ambiente já na importação, e quem só usa a IA (a sonda, os testes) não pode depender disso.
  const { sb } = await import('./banco.ts')
  const [g, c, k] = await Promise.all([
    sb.from('config_ia_modelo').select('tarefa,modelo'),
    sb.from('ia_modelo_cliente').select('user_id,tarefa,modelo'),
    sb.from('ia_chaves').select('id,chave_cifrada').eq('ativa', true).order('atualizado_em', { ascending: false }).limit(1),
  ])
  const cfg: Config = { global: {}, cliente: new Map(), chave: null }
  if (g.error) avisar('config_ia_modelo', g.error)
  else for (const l of g.data ?? []) if (TAREFAS_IDS.includes(l.tarefa as Tarefa) && MODELO_VALIDO.test(l.modelo)) cfg.global[l.tarefa as Tarefa] = l.modelo
  if (c.error) avisar('ia_modelo_cliente', c.error)
  else
    for (const l of c.data ?? []) {
      if (!TAREFAS_IDS.includes(l.tarefa as Tarefa) || !MODELO_VALIDO.test(l.modelo)) continue
      const m = cfg.cliente.get(l.user_id) ?? {}
      m[l.tarefa as Tarefa] = l.modelo
      cfg.cliente.set(l.user_id, m)
    }
  if (k.error) avisar('ia_chaves', k.error)
  else if (k.data?.[0]) cfg.chave = { id: k.data[0].id, cifrada: k.data[0].chave_cifrada }
  return cfg
}

export async function configuracao(): Promise<Config> {
  if (cache && cache.ate > Date.now()) return cache.cfg
  let cfg = VAZIA
  try {
    cfg = await ler()
  } catch (e) {
    avisar('a configuração da IA', e as Error)
  }
  cache = { ate: Date.now() + TTL_MS, cfg }
  return cfg
}

/** O modelo desta tarefa para o cliente que está sendo atendido agora: cliente > todos > fábrica. */
export async function modeloDe(tarefa: Tarefa): Promise<string> {
  const cfg = await configuracao()
  const uid = contextoIA.getStore()?.userId
  return (uid && cfg.cliente.get(uid)?.[tarefa]) || cfg.global[tarefa] || fabricaDe(tarefa)
}

/** A chave de API a usar: a cadastrada e ativa na tela (decifrada) ou, se não houver ou der qualquer problema, a do ambiente. */
export async function chaveDaIA(): Promise<{ chave: string; origem: 'banco' | 'ambiente' }> {
  const cfg = await configuracao()
  if (cfg.chave) {
    try {
      return { chave: decifrar(cfg.chave.cifrada), origem: 'banco' }
    } catch (e) {
      avisar('a chave cadastrada (uso a do ambiente)', e as Error)
    }
  }
  return { chave: env('OPENAI_API_KEY'), origem: 'ambiente' }
}
