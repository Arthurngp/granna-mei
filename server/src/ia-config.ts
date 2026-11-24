/**
 * Configuração da IA escolhida pelo dono no admin (aba Configurações): qual MODELO responde cada tarefa, para todos ou só para um cliente, e qual CHAVE de API
 * o servidor usa. Tudo é lido na hora de cada mensagem (cache de 60 s) e tem uma regra de ouro:
 *
 *   QUALQUER falha ao ler a configuração, valor inválido ou tabela ainda inexistente = o comportamento de antes (modelo de fábrica e chave do ambiente).
 *   A Granninha nunca para por causa de configuração.
 *
 * Ordem do modelo: o do CLIENTE (se houver) > o de TODOS (se houver) > o de fábrica (OPENAI_MODELO, hoje gpt-5.4-mini).
 * Provedor: sai do NOME do modelo. "claude-..." vai para a Anthropic, qualquer outro para a OpenAI. Áudio é sempre OpenAI (a Anthropic não transcreve).
 * Se o caminho da Anthropic falhar por qualquer motivo (sem chave, chave ou modelo recusados, fora do ar), a conversa cai no modelo de fábrica da OpenAI.
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
export type Provedor = 'openai' | 'anthropic'
export const PROVEDORES: Provedor[] = ['openai', 'anthropic']
export const provedorDoModelo = (modelo: string): Provedor => (/^claude/i.test(modelo) ? 'anthropic' : 'openai')
/** Modelo barato da Anthropic usado só para TESTAR uma chave nova (a chamada mínima de teste). */
export const MODELO_TESTE_ANTHROPIC = process.env.ANTHROPIC_MODELO_TESTE ?? 'claude-haiku-5-5'
export const fabricaDe = (t: Tarefa) => (t === 'audio' ? MODELO_AUDIO_FABRICA : MODELO_FABRICA)

/** Nome do esquema JSON pedido à IA → tarefa. Qualquer nome desconhecido é tratado como "entender a mensagem". */
export const tarefaDeEsquema = (nome: string): Tarefa => (nome === 'documento' ? 'documento' : nome === 'ajuda' ? 'ajuda' : nome === 'resposta' ? 'resposta' : 'interpretacao')

/** Nome de modelo aceitável (nunca vira comando: só letras, números e . _ : / -). */
export const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$/

/** Quem está sendo atendido agora: assim cada chamada de IA sabe de qual cliente é, sem passar o id por todas as funções. */
export const contextoIA = new AsyncLocalStorage<{ userId: string }>()

/* ---------------- cifra da chave ---------------- */

/**
 * Segredos que cifram as chaves, em ordem de preferência:
 *  1. IA_SEGREDO (se o dono definir na Coolify, 16+ caracteres);
 *  2. derivado de SUPABASE_SERVICE_ROLE_KEY, que o servidor já tem: assim a aba Configurações funciona sem nenhuma etapa extra.
 * Em AMBOS os casos o segredo vive só no ambiente do servidor, nunca no banco: uma cópia do banco sozinha não abre nenhuma chave.
 * Cifra-se com o primeiro; decifra-se tentando todos, então definir IA_SEGREDO depois não perde chave já guardada.
 * Se a chave de serviço for trocada (rotação), as chaves guardadas deixam de abrir: a Granninha usa a do ambiente e o dono cadastra de novo.
 */
function segredos(): string[] {
  const lista: string[] = []
  const a = process.env.IA_SEGREDO
  if (a && a.length >= 16) lista.push(a)
  const b = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (b && b.length >= 16) lista.push('chave-de-servico:' + b)
  return lista
}
const derivadas = new Map<string, Buffer>()
function derivar(segredo: string): Buffer {
  let k = derivadas.get(segredo)
  if (!k) {
    k = scryptSync(segredo, 'granninha-ia-chaves-v1', 32)
    derivadas.set(segredo, k)
  }
  return k
}
export const segredoConfigurado = () => segredos().length > 0

export function cifrar(texto: string): string {
  const [segredo] = segredos()
  if (!segredo) throw new Error('O servidor não tem como cifrar a chave (defina IA_SEGREDO com 16+ caracteres na Coolify): sem isso a chave não pode ser guardada.')
  const k = derivar(segredo)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decifrar(cifrado: string): string {
  const lista = segredos()
  if (!lista.length) throw new Error('IA_SEGREDO ausente (e não há chave de serviço para derivar o segredo)')
  const [v, iv, tag, ct] = cifrado.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('formato de chave cifrada desconhecido')
  let ultimo: unknown
  for (const segredo of lista) {
    try {
      const d = createDecipheriv('aes-256-gcm', derivar(segredo), Buffer.from(iv, 'base64'))
      d.setAuthTag(Buffer.from(tag, 'base64'))
      return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
    } catch (e) {
      ultimo = e // este segredo não abre: tenta o próximo (IA_SEGREDO definido depois, ou chave de serviço trocada)
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error('não consegui abrir a chave guardada')
}

/* ---------------- leitura (com cache e sem nunca lançar) ---------------- */

interface Config {
  global: Partial<Record<Tarefa, string>>
  cliente: Map<string, Partial<Record<Tarefa, string>>>
  chaves: Partial<Record<Provedor, { id: string; cifrada: string }>>
}
const VAZIA: Config = { global: {}, cliente: new Map(), chaves: {} }
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
    sb.from('ia_chaves').select('id,provedor,chave_cifrada').eq('ativa', true).order('atualizado_em', { ascending: false }).limit(8),
  ])
  const cfg: Config = { global: {}, cliente: new Map(), chaves: {} }
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
  else
    for (const l of k.data ?? []) {
      const prov = (l.provedor ?? 'openai') as Provedor // linhas antigas (antes da coluna ser usada) são da OpenAI
      if (PROVEDORES.includes(prov) && !cfg.chaves[prov]) cfg.chaves[prov] = { id: l.id, cifrada: l.chave_cifrada } // a mais recente de cada provedor
    }
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
  const m = (uid && cfg.cliente.get(uid)?.[tarefa]) || cfg.global[tarefa] || fabricaDe(tarefa)
  // Áudio só existe na OpenAI: um modelo Claude gravado para áudio é ignorado (nunca chega a uma chamada que não pode funcionar).
  return tarefa === 'audio' && provedorDoModelo(m) === 'anthropic' ? fabricaDe(tarefa) : m
}

/** A chave de API a usar: a cadastrada e ativa na tela (decifrada) ou, se não houver ou der qualquer problema, a do ambiente. */
export async function chaveDaIA(): Promise<{ chave: string; origem: 'banco' | 'ambiente' }> {
  const cfg = await configuracao()
  if (cfg.chaves.openai) {
    try {
      return { chave: decifrar(cfg.chaves.openai.cifrada), origem: 'banco' }
    } catch (e) {
      avisar('a chave cadastrada (uso a do ambiente)', e as Error)
    }
  }
  return { chave: env('OPENAI_API_KEY'), origem: 'ambiente' }
}

/** A chave da Anthropic: a cadastrada e ativa na tela (decifrada) ou ANTHROPIC_API_KEY do ambiente. Sem nenhuma das duas, null (o chamador cai na OpenAI). */
export async function chaveDaAnthropic(): Promise<{ chave: string; origem: 'banco' | 'ambiente' } | null> {
  const cfg = await configuracao()
  if (cfg.chaves.anthropic) {
    try {
      return { chave: decifrar(cfg.chaves.anthropic.cifrada), origem: 'banco' }
    } catch (e) {
      avisar('a chave da Anthropic cadastrada (uso a do ambiente, se houver)', e as Error)
    }
  }
  return process.env.ANTHROPIC_API_KEY ? { chave: process.env.ANTHROPIC_API_KEY, origem: 'ambiente' } : null
}
