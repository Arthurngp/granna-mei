/**
 * O que a aba Configurações do admin faz no servidor (as rotas em admin.ts só chamam isto). Regras:
 *  - Nada é salvo sem TESTAR antes: modelo e chave passam por uma chamada mínima real; se falhar, nada muda e a tela diz o motivo.
 *  - Chave de API: guardada CIFRADA, nasce DESLIGADA, só vira a usada se ativada de propósito (e testada de novo ao ativar). A listagem NUNCA devolve a chave,
 *    nem o texto cifrado, só os 4 últimos caracteres. Nenhum erro devolvido a quem chama contém a chave.
 *  - Toda mudança vai para a auditoria (quem, o quê, antes e depois) sem a chave.
 *  - Depois de qualquer mudança o cache de 60 s é limpo: vale já na próxima mensagem.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chamadaMinimaIA } from './openai.ts'
import { cifrar, decifrar, fabricaDe, limparCacheIA, MODELO_VALIDO, segredoConfigurado, TAREFAS, TAREFAS_IDS, type Tarefa } from './ia-config.ts'

export class ErroConfig extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

export interface Deps {
  sb: SupabaseClient
  /** Chamada mínima de verdade com o modelo (e, se informada, a chave). */
  testar: (modelo: string, chave?: string) => Promise<{ ok: boolean; detalhe: string }>
  auditar: (adminId: string, acao: string, detalhes: Record<string, unknown>, alvo?: string) => Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHAVE_VALIDA = /^[\x21-\x7e]{20,400}$/

export const depsReais = (sb: SupabaseClient, auditar: Deps['auditar']): Deps => ({
  sb,
  auditar,
  testar: async (modelo, chave) => {
    const r = await chamadaMinimaIA(modelo, chave)
    return r.ok ? { ok: true, detalhe: 'respondeu' } : { ok: false, detalhe: r.detalhe }
  },
})

/** Tira a chave de qualquer texto que vá voltar para a tela. */
const sem = (texto: string, chave?: string) => (chave ? texto.split(chave).join('•••') : texto).slice(0, 220)

function tarefaValida(t: unknown): Tarefa {
  if (typeof t !== 'string' || !TAREFAS_IDS.includes(t as Tarefa)) throw new ErroConfig(400, 'Tarefa desconhecida.')
  return t as Tarefa
}
function modeloValido(m: unknown): string {
  const v = typeof m === 'string' ? m.trim() : ''
  if (!MODELO_VALIDO.test(v)) throw new ErroConfig(400, 'Nome de modelo inválido. Use só letras, números e . _ : / - (por exemplo gpt-5.4-mini).')
  return v
}

export async function listar(d: Deps) {
  const g = await d.sb.from('config_ia_modelo').select('tarefa,modelo,atualizado_em')
  // Sem a migration as tabelas não existem: a tela avisa e o servidor segue com o padrão.
  if (g.error) return { pronto: false, segredo: segredoConfigurado(), fabrica: Object.fromEntries(TAREFAS_IDS.map((t) => [t, fabricaDe(t)])), tarefas: [], chaves: [], clientes: [], chave_em_uso: 'ambiente' as const }
  const [c, k] = await Promise.all([
    d.sb.from('ia_modelo_cliente').select('user_id,tarefa,modelo,atualizado_em').order('atualizado_em', { ascending: false }),
    d.sb.from('ia_chaves').select('id,provedor,nome,ultimos4,ativa,testada_em,criado_em').order('criado_em', { ascending: false }),
  ])
  const ids = [...new Set((c.data ?? []).map((x) => x.user_id as string))]
  const nomes = ids.length ? (await d.sb.from('perfis').select('id,nome,negocio').in('id', ids)).data ?? [] : []
  const nome = (id: string) => nomes.find((p) => p.id === id)
  const globais = new Map((g.data ?? []).map((x) => [x.tarefa as string, x]))
  const ativa = (k.data ?? []).find((x) => x.ativa)
  return {
    pronto: true,
    segredo: segredoConfigurado(),
    fabrica: Object.fromEntries(TAREFAS_IDS.map((t) => [t, fabricaDe(t)])),
    tarefas: TAREFAS.map((t) => ({ ...t, global: (globais.get(t.id)?.modelo as string | undefined) ?? null })),
    chaves: (k.data ?? []).map((x) => ({ id: x.id, provedor: x.provedor, nome: x.nome, ultimos4: x.ultimos4, ativa: x.ativa, testada_em: x.testada_em, criado_em: x.criado_em })),
    clientes: (c.data ?? []).map((x) => ({ user_id: x.user_id, nome: nome(x.user_id)?.nome ?? '', negocio: nome(x.user_id)?.negocio ?? '', tarefa: x.tarefa, modelo: x.modelo })),
    chave_em_uso: ativa ? ('banco' as const) : ('ambiente' as const),
    chave_em_uso_nome: ativa?.nome ?? null,
  }
}

async function testarOuRecusar(d: Deps, tarefa: Tarefa, modelo: string) {
  // Transcrição de áudio não é modelo de chat: a chamada mínima de chat não serve de teste. Só o formato do nome é conferido (e o servidor volta ao de fábrica
  // sozinho se a OpenAI recusar o nome na hora de transcrever).
  if (tarefa === 'audio') return
  const t = await d.testar(modelo)
  if (!t.ok) throw new ErroConfig(400, `O modelo "${modelo}" não respondeu (${sem(t.detalhe)}). Nada foi alterado.`)
}

/** Modelo para TODOS os clientes numa tarefa. `modelo: null` volta ao de fábrica. */
export async function salvarModelo(d: Deps, admin: string, corpo: { tarefa?: unknown; modelo?: unknown }) {
  const tarefa = tarefaValida(corpo.tarefa)
  const antes = (await d.sb.from('config_ia_modelo').select('modelo').eq('tarefa', tarefa).maybeSingle()).data?.modelo ?? null
  if (corpo.modelo === null || corpo.modelo === '') {
    const r = await d.sb.from('config_ia_modelo').delete().eq('tarefa', tarefa)
    if (r.error) throw new Error(r.error.message)
    await d.auditar(admin, 'ia_modelo', { tarefa, antes, depois: null, escopo: 'todos' })
    limparCacheIA()
    return { ok: true, tarefa, modelo: null, vale: fabricaDe(tarefa) }
  }
  const modelo = modeloValido(corpo.modelo)
  await testarOuRecusar(d, tarefa, modelo)
  const r = await d.sb.from('config_ia_modelo').upsert({ tarefa, modelo, atualizado_por: admin, atualizado_em: new Date().toISOString() }, { onConflict: 'tarefa' })
  if (r.error) throw new Error(r.error.message)
  await d.auditar(admin, 'ia_modelo', { tarefa, antes, depois: modelo, escopo: 'todos' })
  limparCacheIA()
  return { ok: true, tarefa, modelo, vale: modelo }
}

/** Modelo só para UM cliente numa tarefa (vence o de todos). `modelo: null` tira o individual. */
export async function salvarModeloCliente(d: Deps, admin: string, corpo: { user_id?: unknown; tarefa?: unknown; modelo?: unknown }) {
  const tarefa = tarefaValida(corpo.tarefa)
  const uid = typeof corpo.user_id === 'string' && UUID.test(corpo.user_id) ? corpo.user_id : ''
  if (!uid) throw new ErroConfig(400, 'Cliente inválido.')
  const p = await d.sb.from('perfis').select('id,papel').eq('id', uid).maybeSingle()
  if (!p.data || p.data.papel !== 'cliente') throw new ErroConfig(404, 'Cliente não encontrado.')
  const antes = (await d.sb.from('ia_modelo_cliente').select('modelo').eq('user_id', uid).eq('tarefa', tarefa).maybeSingle()).data?.modelo ?? null
  if (corpo.modelo === null || corpo.modelo === '') {
    const r = await d.sb.from('ia_modelo_cliente').delete().eq('user_id', uid).eq('tarefa', tarefa)
    if (r.error) throw new Error(r.error.message)
    await d.auditar(admin, 'ia_modelo', { tarefa, antes, depois: null, escopo: 'cliente' }, uid)
    limparCacheIA()
    return { ok: true, tarefa, modelo: null }
  }
  const modelo = modeloValido(corpo.modelo)
  await testarOuRecusar(d, tarefa, modelo)
  const r = await d.sb.from('ia_modelo_cliente').upsert({ user_id: uid, tarefa, modelo, atualizado_por: admin, atualizado_em: new Date().toISOString() }, { onConflict: 'user_id,tarefa' })
  if (r.error) throw new Error(r.error.message)
  await d.auditar(admin, 'ia_modelo', { tarefa, antes, depois: modelo, escopo: 'cliente' }, uid)
  limparCacheIA()
  return { ok: true, tarefa, modelo }
}

/** Cadastra uma chave de API: testa, cifra e guarda DESLIGADA. */
export async function adicionarChave(d: Deps, admin: string, corpo: { nome?: unknown; chave?: unknown }) {
  if (!segredoConfigurado()) throw new ErroConfig(400, 'O servidor ainda não tem o segredo para cifrar chaves (variável IA_SEGREDO na Coolify). Sem ele a chave não pode ser guardada com segurança.')
  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : ''
  if (nome.length < 1 || nome.length > 60) throw new ErroConfig(400, 'Dê um nome à chave (até 60 letras).')
  const chave = typeof corpo.chave === 'string' ? corpo.chave.trim() : ''
  if (!CHAVE_VALIDA.test(chave)) throw new ErroConfig(400, 'A chave parece incompleta ou tem espaço. Cole a chave inteira.')
  const t = await d.testar(fabricaDe('interpretacao'), chave)
  if (!t.ok) throw new ErroConfig(400, `Essa chave não funcionou (${sem(t.detalhe, chave)}). Nada foi guardado.`)
  const r = await d.sb.from('ia_chaves').insert({ provedor: 'openai', nome, chave_cifrada: cifrar(chave), ultimos4: chave.slice(-4), ativa: false, testada_em: new Date().toISOString(), criado_por: admin }).select('id').single()
  if (r.error) throw new Error(sem(r.error.message, chave))
  await d.auditar(admin, 'ia_chave_adicionar', { nome, ultimos4: chave.slice(-4) })
  limparCacheIA()
  return { ok: true, id: r.data.id }
}

/** Liga ou desliga uma chave. Ligar testa de novo e desliga a que estava ligada (só uma por vez). Desligar volta à chave do ambiente. */
export async function definirChaveAtiva(d: Deps, admin: string, corpo: { id?: unknown; ativa?: unknown }) {
  const id = typeof corpo.id === 'string' && UUID.test(corpo.id) ? corpo.id : ''
  if (!id) throw new ErroConfig(400, 'Chave inválida.')
  const k = await d.sb.from('ia_chaves').select('id,nome,ultimos4,chave_cifrada,ativa').eq('id', id).maybeSingle()
  if (!k.data) throw new ErroConfig(404, 'Chave não encontrada.')
  if (corpo.ativa !== true) {
    const r = await d.sb.from('ia_chaves').update({ ativa: false, atualizado_em: new Date().toISOString() }).eq('id', id)
    if (r.error) throw new Error(r.error.message)
    await d.auditar(admin, 'ia_chave_desativar', { nome: k.data.nome, ultimos4: k.data.ultimos4 })
    limparCacheIA()
    return { ok: true, ativa: false }
  }
  let chave: string
  try {
    chave = decifrar(k.data.chave_cifrada)
  } catch {
    throw new ErroConfig(400, 'Não consegui abrir esta chave (o segredo do servidor mudou?). Cadastre-a de novo.')
  }
  const t = await d.testar(fabricaDe('interpretacao'), chave)
  if (!t.ok) throw new ErroConfig(400, `Esta chave não funcionou agora (${sem(t.detalhe, chave)}). Continua valendo a que já estava em uso.`)
  // Uma por vez: desliga as outras ANTES de ligar esta (o banco também impede duas ligadas).
  const off = await d.sb.from('ia_chaves').update({ ativa: false, atualizado_em: new Date().toISOString() }).neq('id', id).eq('ativa', true)
  if (off.error) throw new Error(off.error.message)
  const on = await d.sb.from('ia_chaves').update({ ativa: true, testada_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', id)
  if (on.error) throw new Error(on.error.message)
  await d.auditar(admin, 'ia_chave_ativar', { nome: k.data.nome, ultimos4: k.data.ultimos4 })
  limparCacheIA()
  return { ok: true, ativa: true }
}

export async function removerChave(d: Deps, admin: string, corpo: { id?: unknown }) {
  const id = typeof corpo.id === 'string' && UUID.test(corpo.id) ? corpo.id : ''
  if (!id) throw new ErroConfig(400, 'Chave inválida.')
  const k = await d.sb.from('ia_chaves').select('id,nome,ultimos4,ativa').eq('id', id).maybeSingle()
  if (!k.data) throw new ErroConfig(404, 'Chave não encontrada.')
  const r = await d.sb.from('ia_chaves').delete().eq('id', id)
  if (r.error) throw new Error(r.error.message)
  await d.auditar(admin, 'ia_chave_remover', { nome: k.data.nome, ultimos4: k.data.ultimos4, estava_ativa: k.data.ativa })
  limparCacheIA()
  return { ok: true }
}

