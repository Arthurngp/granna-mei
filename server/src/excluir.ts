/**
 * Exclusão DEFINITIVA de conta, feita pelo admin: o cliente volta a ser um desconhecido.
 * Some o login (e-mail), o perfil (CNPJ, WhatsApp, contador), lançamentos, contas, mensagens,
 * assinatura e os arquivos (comprovantes e foto). Depois disso o mesmo e-mail, CNPJ e telefone
 * podem criar uma conta nova do zero, sem conflito.
 *
 * Quase tudo cai sozinho pelo "on delete cascade" de auth.users. O que NÃO cai sozinho e é feito aqui:
 * arquivos do storage e mensagens/conversas sem dono (user_id nulo) ligadas ao telefone.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export class ErroExclusao extends Error {
  constructor(
    public status: number,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

export interface ResultadoExclusao {
  excluido: true
  arquivos_apagados: number
  mensagens_soltas_apagadas: number
  conferencia: { login: boolean; perfil: boolean; lancamentos: number; mensagens: number }
}

const BUCKETS = ['comprovantes', 'avatares']

/** Lista todos os arquivos da pasta do usuário (entra em subpastas). */
async function arquivosDe(sb: SupabaseClient, bucket: string, pasta: string): Promise<string[]> {
  const achados: string[] = []
  const fila = [pasta]
  while (fila.length) {
    const atual = fila.pop()!
    for (let de = 0; ; de += 100) {
      const { data, error } = await sb.storage.from(bucket).list(atual, { limit: 100, offset: de })
      if (error) throw new Error(`listar ${bucket}: ${error.message}`)
      for (const x of data ?? []) (x.id ? achados.push(`${atual}/${x.name}`) : fila.push(`${atual}/${x.name}`))
      if ((data?.length ?? 0) < 100) break
    }
  }
  return achados
}

export async function excluirContaDefinitivo(
  sb: SupabaseClient,
  adminId: string,
  alvoId: string,
  emailConfirmado: string,
  motivo: string,
): Promise<ResultadoExclusao> {
  if (motivo.trim().length < 3) throw new ErroExclusao(400, 'Escreva o motivo (pelo menos 3 letras).')
  if (alvoId === adminId) throw new ErroExclusao(400, 'Você não pode excluir a própria conta por aqui.')

  const u = await sb.auth.admin.getUserById(alvoId)
  if (u.error || !u.data.user) throw new ErroExclusao(404, 'Cliente não encontrado.')
  const email = (u.data.user.email ?? '').trim().toLowerCase()
  // Digitar o e-mail do cliente é a trava contra clicar na conta errada.
  if (!email || emailConfirmado.trim().toLowerCase() !== email) throw new ErroExclusao(400, 'O e-mail digitado não confere com o da conta.')

  const p = await sb.from('perfis').select('papel, nome, negocio, whats').eq('id', alvoId).maybeSingle()
  if (p.error) throw new Error(`ler perfil: ${p.error.message}`)
  if (p.data?.papel === 'admin') throw new ErroExclusao(400, 'Conta de admin não se exclui por aqui. Tire o papel de admin antes.')

  const [lanc, msgs] = await Promise.all([
    sb.from('lancamentos').select('id', { count: 'exact', head: true }).eq('user_id', alvoId),
    sb.from('mensagens').select('id', { count: 'exact', head: true }).eq('user_id', alvoId),
  ])

  // Arquivos primeiro: depois que a conta some, ninguém mais sabe de quem eram.
  let arquivos = 0
  for (const b of BUCKETS) {
    const lista = await arquivosDe(sb, b, alvoId)
    for (let i = 0; i < lista.length; i += 100) {
      const r = await sb.storage.from(b).remove(lista.slice(i, i + 100))
      if (r.error) throw new Error(`apagar arquivos de ${b}: ${r.error.message}`)
    }
    arquivos += lista.length
  }

  // Mensagens e conversas sem dono ligadas ao telefone dele (ex.: de antes de confirmar o número).
  let soltas = 0
  const dig = (p.data?.whats ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,})/, '')
  if (dig.length >= 10) {
    const pad = `55${dig.slice(0, 2)}%${dig.slice(-8)}`
    const m = await sb.from('mensagens').delete({ count: 'exact' }).is('user_id', null).like('telefone', pad)
    if (m.error) throw new Error(`apagar mensagens soltas: ${m.error.message}`)
    const c = await sb.from('conversas').delete({ count: 'exact' }).is('user_id', null).like('telefone', pad)
    if (c.error) throw new Error(`apagar conversas soltas: ${c.error.message}`)
    soltas = (m.count ?? 0) + (c.count ?? 0)
  }

  // O login: daqui cascateiam perfil, assinatura, lançamentos, contas, fixas, categorias, mensagens, conversas, verificação.
  const del = await sb.auth.admin.deleteUser(alvoId)
  if (del.error) throw new Error(`apagar o login: ${del.error.message}`)

  // Conferência real: nada pode ter ficado para trás.
  const [login, perfil, l2, m2] = await Promise.all([
    sb.auth.admin.getUserById(alvoId),
    sb.from('perfis').select('id', { count: 'exact', head: true }).eq('id', alvoId),
    sb.from('lancamentos').select('id', { count: 'exact', head: true }).eq('user_id', alvoId),
    sb.from('mensagens').select('id', { count: 'exact', head: true }).eq('user_id', alvoId),
  ])
  const conferencia = { login: !login.error && !!login.data.user, perfil: (perfil.count ?? 0) > 0, lancamentos: l2.count ?? 0, mensagens: m2.count ?? 0 }
  if (conferencia.login || conferencia.perfil || conferencia.lancamentos || conferencia.mensagens) {
    throw new Error(`exclusão incompleta: ${JSON.stringify(conferencia)}`)
  }
  // Auditoria só depois de confirmar que apagou. O vínculo com o cliente vira nulo na exclusão, então o que foi apagado fica no texto.
  const aud = await sb.from('admin_auditoria').insert({
    admin_id: adminId,
    acao: 'excluir_conta_definitivo',
    detalhes: {
      motivo: motivo.trim(),
      cliente: [p.data?.nome, p.data?.negocio].filter(Boolean).join(' · ') || '(sem nome)',
      email,
      lancamentos: lanc.count ?? 0,
      mensagens: msgs.count ?? 0,
    },
  })
  if (aud.error) console.error('[excluir] conta apagada, mas a auditoria falhou:', aud.error.message)
  return { excluido: true, arquivos_apagados: arquivos, mensagens_soltas_apagadas: soltas, conferencia }
}
