/**
 * Exclusão de conta: o cliente volta a ser um desconhecido.
 * Some o login (e-mail), o perfil (CNPJ, WhatsApp, contador), lançamentos, contas, mensagens,
 * assinatura e os arquivos (comprovantes e foto). Depois disso o mesmo e-mail, CNPJ e telefone
 * podem criar uma conta nova do zero, sem conflito.
 *
 * Quase tudo cai sozinho pelo "on delete cascade" de auth.users. O que NÃO cai sozinho e é feito aqui:
 * arquivos do storage e mensagens/conversas sem dono (user_id nulo) ligadas ao telefone.
 *
 * Dois caminhos chegam aqui:
 *  - o admin, pelo painel, apagando na hora (`excluirContaDefinitivo`);
 *  - o prazo do próprio cliente, 30 dias depois do pedido (`excluirVencidas`).
 * Enquanto o prazo corre, `soltarNumerosDeExcluidas` tira o número da conta para ele parar de
 * responder no WhatsApp e ficar livre para outra conta.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { cancelarAssinaturaDe } from './cobranca-stripe.ts'

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

/** "(81) 98765-4321" -> "5581%87654321", o jeito de achar mensagem solta daquele telefone. */
function padraoDoTelefone(whats: string): string | null {
  const dig = (whats ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,})/, '')
  return dig.length >= 10 ? `55${dig.slice(0, 2)}%${dig.slice(-8)}` : null
}

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

/** O trabalho sujo, igual para o admin e para o prazo: arquivos, mensagens soltas, login, conferência. */
async function apagarTudo(sb: SupabaseClient, alvoId: string, whats: string): Promise<ResultadoExclusao> {
  // Primeiro cancela a assinatura na Stripe: se não der, a exclusão para aqui e ninguém fica pagando por conta apagada.
  await cancelarAssinaturaDe(sb, alvoId)

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
  const pad = padraoDoTelefone(whats)
  if (pad) {
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
  return { excluido: true, arquivos_apagados: arquivos, mensagens_soltas_apagadas: soltas, conferencia }
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

  const p = await sb.from('perfis').select('papel, nome, negocio, whats, whats_verificado').eq('id', alvoId).maybeSingle()
  if (p.error) throw new Error(`ler perfil: ${p.error.message}`)
  if (p.data?.papel === 'admin') throw new ErroExclusao(400, 'Conta de admin não se exclui por aqui. Tire o papel de admin antes.')

  const [lanc, msgs] = await Promise.all([
    sb.from('lancamentos').select('id', { count: 'exact', head: true }).eq('user_id', alvoId),
    sb.from('mensagens').select('id', { count: 'exact', head: true }).eq('user_id', alvoId),
  ])

  // Só o número CONFIRMADO apaga mensagens soltas: o campo é editável pelo cliente, e com o número de outra pessoa ele apagaria o histórico dela.
  const r = await apagarTudo(sb, alvoId, p.data?.whats_verificado ? (p.data?.whats ?? '') : '')

  // Auditoria só depois de confirmar que apagou. O vínculo com o cliente vira nulo na exclusão, então o que foi apagado fica no texto.
  await registrar(sb, adminId, {
    motivo: motivo.trim(),
    cliente: [p.data?.nome, p.data?.negocio].filter(Boolean).join(' · ') || '(sem nome)',
    email,
    lancamentos: lanc.count ?? 0,
    mensagens: msgs.count ?? 0,
  })
  return r
}

async function registrar(sb: SupabaseClient, adminId: string | null, detalhes: Record<string, unknown>) {
  const aud = await sb.from('admin_auditoria').insert({ admin_id: adminId, acao: 'excluir_conta_definitivo', detalhes })
  // Nunca derruba a exclusão: a conta já foi apagada, o registro é o que pode faltar.
  if (aud.error) console.error('[excluir] conta apagada, mas a auditoria falhou:', aud.error.message)
}

/**
 * Quem pediu para excluir a conta perde o WhatsApp na hora: o número sai da conta (volta a ficar
 * livre para outra) e a pergunta em aberto daquele telefone é apagada, para não cair na conta nova.
 * Roda no batimento, então também arruma quem já tinha pedido antes desta versão.
 */
export async function soltarNumerosDeExcluidas(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.from('perfis').select('id, whats, exclusao_em').not('exclusao_em', 'is', null).eq('whats_verificado', true)
  if (error) throw new Error(`procurar excluídas: ${error.message}`)
  let soltos = 0
  for (const p of (data ?? []) as { id: string; whats: string; exclusao_em: string | null }[]) {
    // Confere de novo aqui: se o filtro do banco falhasse, isto rodando a cada minuto tiraria
    // TODOS os clientes do WhatsApp em silêncio. Sem data de exclusão, não se mexe.
    if (!p.exclusao_em) continue
    const up = await sb.from('perfis').update({ whats_verificado: false }).eq('id', p.id)
    if (up.error) {
      console.error('[excluir] não soltei o número de', p.id, up.error.message)
      continue
    }
    const pad = padraoDoTelefone(p.whats)
    if (pad) await sb.from('conversas').delete().like('telefone', pad)
    soltos++
  }
  return soltos
}

export interface Vencida {
  id: string
  cliente: string
  exclusao_em: string
  apagada: boolean
  erro?: string
}

/**
 * Apaga de vez quem pediu exclusão e já passou do prazo. Com `apagar: false` só devolve a lista,
 * sem tocar em nada: é assim que entra em produção, para o Arthur ver o que sairia antes de ligar.
 * Conta de admin nunca é apagada aqui.
 */
export async function excluirVencidas(sb: SupabaseClient, hoje: string, apagar: boolean): Promise<Vencida[]> {
  const { data, error } = await sb.from('perfis').select('id, nome, negocio, whats, whats_verificado, papel, exclusao_em').lte('exclusao_em', hoje)
  if (error) throw new Error(`procurar vencidas: ${error.message}`)
  const fora: Vencida[] = []
  for (const p of (data ?? []) as { id: string; nome: string; negocio: string; whats: string; whats_verificado: boolean; papel: string; exclusao_em: string }[]) {
    const cliente = [p.nome, p.negocio].filter(Boolean).join(' · ') || '(sem nome)'
    // Trava contra catástrofe: isto apaga conta de verdade, sozinho. Se o filtro do banco
    // falhasse, apagaria quem nunca pediu. A data é conferida de novo, uma a uma, aqui.
    if (!p.exclusao_em || p.exclusao_em > hoje) continue
    if (p.papel === 'admin') {
      fora.push({ id: p.id, cliente, exclusao_em: p.exclusao_em, apagada: false, erro: 'conta de admin, não apaguei' })
      continue
    }
    if (!apagar) {
      fora.push({ id: p.id, cliente, exclusao_em: p.exclusao_em, apagada: false, erro: 'só listando (EXCLUSAO_AUTOMATICA desligada)' })
      continue
    }
    try {
      await apagarTudo(sb, p.id, p.whats_verificado ? p.whats : '')
      await registrar(sb, null, { motivo: 'prazo de 30 dias pedido pelo cliente', cliente, exclusao_em: p.exclusao_em })
      fora.push({ id: p.id, cliente, exclusao_em: p.exclusao_em, apagada: true })
    } catch (e) {
      // Uma conta com problema não pode impedir as outras de serem apagadas.
      fora.push({ id: p.id, cliente, exclusao_em: p.exclusao_em, apagada: false, erro: (e as Error).message })
    }
  }
  return fora
}
