/**
 * Rotas do painel admin que precisam do servidor (gateway de WhatsApp e links de acesso).
 * Só para quem tem papel admin E entrou com a segunda etapa (aal2): conferido no token a cada chamada.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { falhou, sb } from './banco.ts'
import { garantirSessao, qrDaSessao } from './gateway.ts'
import { ErroExclusao, excluirContaDefinitivo } from './excluir.ts'
import { numeroDeAviso } from './alerta.ts'

// Os dois domínios valem sempre, além do que vier em ADMIN_ORIGENS: trocar o domínio não pode derrubar o admin.
const ORIGENS = [...new Set([...(process.env.ADMIN_ORIGENS ?? '').split(','), 'https://granninha.amplasoft.me', 'https://grannamei.amplasoft.me'].map((s) => s.trim()).filter(Boolean))]

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
  // Para quem avisar quando a Granninha parar. O número fica no banco (não em variável) porque é o
  // Arthur que troca, pelo painel, sem precisar de deploy.
  if (req.method === 'GET' && caminho === '/admin/alerta') {
    const r = await sb.from('granninha_saude').select('alerta_whats,alerta_ligado,alerta_tipo,alerta_em').eq('id', 1).maybeSingle()
    falhou(r.error, 'ler config de alerta')
    json(res, 200, r.data ?? { alerta_whats: '', alerta_ligado: false, alerta_tipo: null, alerta_em: null })
    return true
  }
  if (req.method === 'POST' && caminho === '/admin/alerta') {
    const body = JSON.parse((await corpo()) || '{}') as { whats?: string; ligado?: boolean }
    const numero = numeroDeAviso(body.whats ?? '')
    const ligado = body.ligado === true
    if (ligado && !numero) {
      json(res, 400, { erro: 'Número inválido. Use DDD + número, por exemplo 81999998888.' })
      return true
    }
    // Trocar o número zera o que já foi avisado: o aviso do problema atual tem que chegar no destino novo.
    const up = await sb.from('granninha_saude').upsert({ id: 1, alerta_whats: numero, alerta_ligado: ligado, alerta_tipo: null, alerta_em: null })
    falhou(up.error, 'gravar config de alerta')
    await sb.from('admin_auditoria').insert({ admin_id: admin, acao: 'alerta', detalhe: ligado ? `ligado para …${numero.slice(-4)}` : 'desligado' })
    json(res, 200, { ok: true, alerta_whats: numero, alerta_ligado: ligado })
    return true
  }
  if (req.method === 'GET' && caminho === '/admin/qr') {
    await garantirSessao()
    json(res, 200, await qrDaSessao())
    return true
  }
  if (req.method === 'POST' && caminho === '/admin/link-acesso') {
    // tipo 'senha' leva o cliente para criar uma senha nova; sem isso ele entra sem saber nenhuma senha.
    const { user_id, tipo } = JSON.parse((await corpo()) || '{}') as { user_id?: string; tipo?: string }
    if (!user_id) return json(res, 400, { erro: 'user_id obrigatório' }), true
    const u = await sb.auth.admin.getUserById(user_id)
    if (u.error || !u.data.user?.email) return json(res, 404, { erro: 'Cliente não encontrado.' }), true
    const painel = (process.env.PAINEL_URL ?? 'https://grannamei.amplasoft.me/painel').replace(/\/+$/, '')
    const senha = tipo === 'senha'
    const l = await sb.auth.admin.generateLink({
      type: senha ? 'recovery' : 'magiclink',
      email: u.data.user.email,
      options: { redirectTo: painel + (senha ? '/nova-senha' : '/') },
    })
    falhou(l.error, 'gerar link')
    await sb.from('admin_auditoria').insert({
      admin_id: admin,
      acao: senha ? 'link_nova_senha' : 'link_acesso',
      alvo_user_id: user_id,
      detalhes: { motivo: senha ? 'link para o cliente criar senha nova' : 'link de acesso gerado pelo admin' },
    })
    json(res, 200, { link: l.data.properties?.action_link })
    return true
  }
  if (req.method === 'POST' && caminho === '/admin/excluir-conta') {
    const b = JSON.parse((await corpo()) || '{}') as { user_id?: string; email?: string; motivo?: string }
    if (!b.user_id) return json(res, 400, { erro: 'user_id obrigatório' }), true
    try {
      json(res, 200, await excluirContaDefinitivo(sb, admin, b.user_id, b.email ?? '', b.motivo ?? ''))
    } catch (e) {
      if (e instanceof ErroExclusao) json(res, e.status, { erro: e.message })
      else json(res, 500, { erro: `Não foi possível excluir: ${(e as Error).message}` })
    }
    return true
  }
  json(res, 404, { erro: 'rota desconhecida' })
  return true
}
