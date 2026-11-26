import { createClient } from '@supabase/supabase-js'

/** Só em desenvolvimento (`VITE_ADMIN_MOCK=1 npm run dev:admin`): troca o banco por dados de exemplo, para olhar as telas sem login. */
export const MOCK = import.meta.env.VITE_ADMIN_MOCK === '1'

const url = MOCK ? 'http://mock.invalid' : (import.meta.env.VITE_SUPABASE_URL as string | undefined)
const anon = MOCK ? 'mock' : (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
if (!url || !anon) throw new Error('Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY')

// Sessão guardada com outra chave: entrar no admin não mexe na sessão do painel do cliente.
// E na sessionStorage, não no localStorage: o painel e o site carregam um script de rastreio de terceiros no MESMO domínio, e o localStorage é
// compartilhado por todas as páginas do domínio. Na sessionStorage a sessão do admin só existe na aba do admin (fecha a aba, sai).
export const sb = createClient(url, anon, { auth: { storageKey: 'granna-mei-admin', storage: MOCK ? undefined : window.sessionStorage } })

/** Endereço do serviço da Granninha (QR do WhatsApp e link de acesso). */
export const API = ((import.meta.env.VITE_GRANNINHA_API as string | undefined) ?? 'https://api-grannamei.amplasoft.me').replace(/\/+$/, '')

/** Chama uma função do banco. Erro de permissão vira mensagem, nunca expulsa da tela. */
export async function rpc<T>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  if (MOCK) return (await import('./mock')).mockRpc(nome, args) as T
  const { data, error } = await sb.rpc(nome, args)
  if (error) throw new Error(error.message.includes('acesso negado') ? 'Sem permissão. Entre de novo com o código do autenticador.' : error.message)
  return data as T
}

export async function api<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  if (MOCK) return (await import('./mock')).mockApi(caminho, init) as T
  const { data } = await sb.auth.getSession()
  const r = await fetch(API + caminho, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}`, ...(init.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as { erro?: string }).erro ?? `Serviço respondeu ${r.status}`)
  return j as T
}
