/**
 * Rotas do painel admin que precisam do servidor (gateway de WhatsApp e links de acesso).
 * Só para quem tem papel admin E entrou com a segunda etapa (aal2): conferido no token a cada chamada.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { falhou, sb } from './banco.ts'
import { garantirSessao, qrDaSessao } from './gateway.ts'

const ORIGENS = (process.env.ADMIN_ORIGENS ?? 'https://grannamei.amplasoft.me').split(',').map((s) => s.trim())

function cors(req: IncomingMessage, res: ServerResponse) {
  const o = req.headers.origin
  if (o && ORIGENS.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
}

function aal(token: string): string | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).aal ?? null
  } catch {
    return null
  }
}

/** Devolve o id do admin ou null. Assinatura do token conferida pelo próprio Supabase (getUser). */
async function adminDo(req: IncomingMessage): Promise<string | null> {
  const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!t || aal(t) !== 'aal2') return null
  const { data, error } = await sb.auth.getUser(t)
  if (error || !data.user) return null
  const p = await sb.from('perfis').select('papel').eq('id', data.user.id).maybeSingle()
  return p.data?.papel === 'admin' ? data.user.id : null
}

const json = (res: ServerResponse, st: number, corpo: unknown) => res.writeHead(st, { 'Content-Type': 'application/json' }).end(JSON.stringify(corpo))

export async function rotaAdmin(req: IncomingMessage, res: ServerResponse, caminho: string, corpo: () => Promise<string>): Promise<boolean> {
  if (!caminho.startsWith('/admin/')) return false
  cors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return true
  }
  const admin = await adminDo(req)
  // 403 (e não 401): o painel admin não desloga quem recebe 403, só mostra a mensagem.
  if (!admin) {
    json(res, 403, { erro: 'Sem permissão de admin ou sem a segunda etapa.' })
    return true
  }
  if (req.method === 'GET' && caminho === '/admin/qr') {
    await garantirSessao()
    json(res, 200, await qrDaSessao())
    return true
  }
  if (req.method === 'POST' && caminho === '/admin/link-acesso') {
    const { user_id } = JSON.parse((await corpo()) || '{}') as { user_id?: string }
    if (!user_id) return json(res, 400, { erro: 'user_id obrigatório' }), true
    const u = await sb.auth.admin.getUserById(user_id)
    if (u.error || !u.data.user?.email) return json(res, 404, { erro: 'Cliente não encontrado.' }), true
    const painel = (process.env.PAINEL_URL ?? 'https://grannamei.amplasoft.me/painel').replace(/\/+$/, '')
    const l = await sb.auth.admin.generateLink({ type: 'magiclink', email: u.data.user.email, options: { redirectTo: painel + '/' } })
    falhou(l.error, 'gerar link')
    await sb.from('admin_auditoria').insert({ admin_id: admin, acao: 'link_acesso', alvo_user_id: user_id, detalhes: { motivo: 'link de acesso gerado pelo admin' } })
    json(res, 200, { link: l.data.properties?.action_link })
    return true
  }
  json(res, 404, { erro: 'rota desconhecida' })
  return true
}
