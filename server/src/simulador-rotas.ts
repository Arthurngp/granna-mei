/**
 * Rotas do simulador de conversa (aba Simulador do admin). Quem chega aqui já passou pelo rotaAdmin: papel admin E segunda etapa (aal2).
 *
 * Regra de segurança: toda rota confere no SERVIDOR que o número é um dos números fixos do simulador (simulador.ts). Sem isso, um admin (ou um
 * token de admin vazado) escreveria no financeiro de um cliente real se passando pelo número dele.
 *
 * A conta de teste nasce como o cadastro do site de hoje (e-mail, senha e WhatsApp, `onboarding_via = 'whats'`, código de 6 dígitos), e
 * daí em diante tudo acontece pela conversa, igual ao WhatsApp. Ela é uma conta de cliente de verdade no banco: entra na Visão geral e na
 * lista de clientes enquanto existir, e a IA gasta de verdade. O botão "zerar" apaga tudo dela (a exclusão definitiva de sempre).
 */
import { randomBytes, randomInt } from 'node:crypto'
import { falhou, formatarNumero, sb } from './banco.ts'
import { linhaContaPadrao, linhasCategoriasPadrao } from './config-whats-fluxo.ts'
import { excluirContaDefinitivo } from './excluir.ts'
import { esperaMs } from './rajada.ts'
import {
  eventoDoSimulador, eventosDoSimulador, guardarMidiaDoSimulador, limparCaixaDoSimulador, MIDIA_MAX_BYTES, numeroDoSimulador, registrarNoSimulador, SIM_NUMEROS, type TipoEnvioSim,
} from './simulador.ts'

/** Domínio dos e-mails das contas de teste. Sem caixa de entrada de propósito: nenhum e-mail do Supabase chega a ninguém. */
export const DOMINIO_SIM = 'simulador.granninha.com.br'
const ehEmailDoSimulador = (email: string | null | undefined) => (email ?? '').toLowerCase().endsWith('@' + DOMINIO_SIM)

export type Receber = (ev: never) => Promise<'nova' | 'duplicada' | 'ignorar'>
type Resposta = { status: number; json: unknown }
const ok = (json: unknown): Resposta => ({ status: 200, json })
const erro = (status: number, msg: string): Resposta => ({ status, json: { erro: msg } })

const chaveDe = (numero: string) => numero.slice(2, 4) + numero.slice(-8)

async function auditar(admin: string, acao: string, alvo: string | null, detalhes: Record<string, unknown>) {
  const a = await sb.from('admin_auditoria').insert({ admin_id: admin, acao, alvo_user_id: alvo, detalhes })
  if (a.error) console.error('[simulador] auditoria:', a.error.message)
}

/** Mesma conta do `gerar_codigo_whats` do banco (que exige auth.uid() e por isso não serve aqui): 6 dígitos do gerador forte, 30 minutos. */
async function novoCodigo(userId: string): Promise<{ codigo: string; expira_em: string }> {
  for (let i = 0; i < 5; i++) {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const vivo = await sb.from('verificacoes').select('user_id').eq('codigo', codigo).gt('expira_em', new Date().toISOString()).limit(1)
    falhou(vivo.error, 'simulador: código em uso')
    if (vivo.data?.length) continue
    const expira_em = new Date(Date.now() + 30 * 60_000).toISOString()
    const up = await sb.from('verificacoes').upsert({ user_id: userId, codigo, expira_em })
    falhou(up.error, 'simulador: gravar código')
    return { codigo, expira_em }
  }
  throw new Error('não consegui um código livre')
}

interface ContaSim {
  user_id: string
  nome: string
  email: string
  verificado: boolean
  onboarding_via: string | null
  etapa_config: string | null
  assinatura: { status: string; trial_fim: string } | null
  codigo: { codigo: string; expira_em: string } | null
  criado_em: string | null
}

async function contaDoNumero(numero: string): Promise<ContaSim | null> {
  let p = await sb.from('perfis').select('id,nome,whats_verificado,onboarding_via,config_whats,criado_em').eq('whats_chave', chaveDe(numero)).is('exclusao_em', null).limit(1)
  // Banco sem as colunas da configuração pela conversa: lê sem elas.
  if (p.error) p = (await sb.from('perfis').select('id,nome,whats_verificado,criado_em').eq('whats_chave', chaveDe(numero)).is('exclusao_em', null).limit(1)) as typeof p
  falhou(p.error, 'simulador: conta do número')
  const l = p.data?.[0] as { id: string; nome: string | null; whats_verificado: boolean; onboarding_via?: string | null; config_whats?: { etapa?: string } | null; criado_em?: string } | undefined
  if (!l) return null
  const [u, a, v] = await Promise.all([
    sb.auth.admin.getUserById(l.id),
    sb.from('assinaturas').select('status,trial_fim').eq('user_id', l.id).maybeSingle(),
    sb.from('verificacoes').select('codigo,expira_em').eq('user_id', l.id).maybeSingle(),
  ])
  return {
    user_id: l.id,
    nome: l.nome ?? '',
    email: u.data?.user?.email ?? '',
    verificado: !!l.whats_verificado,
    onboarding_via: l.onboarding_via ?? null,
    etapa_config: l.config_whats?.etapa ?? null,
    assinatura: (a.data as ContaSim['assinatura']) ?? null,
    codigo: v.data && new Date(v.data.expira_em as string).getTime() > Date.now() ? (v.data as ContaSim['codigo']) : null,
    criado_em: l.criado_em ?? null,
  }
}

const ambiente = () => ({
  onboarding_whats: (process.env.ONBOARDING_WHATS ?? 'off').trim().toLowerCase() === 'on',
  sinais: (process.env.GRANNINHA_SINAIS ?? 'on') !== 'off',
  espera_ms: esperaMs(),
  digitar_ms: Number(process.env.GRANNINHA_DIGITAR_MS ?? 3000),
  modo_teste: !!(process.env.WA_SOMENTE_NUMEROS ?? '').trim(),
  avisos: process.env.AVISOS ?? 'off',
})

const TIPOS_MIME: Record<Exclude<TipoEnvioSim, 'texto'>, RegExp> = {
  audio: /^audio\/(ogg|mpeg|mp4|webm|wav|x-wav|x-m4a)(;.*)?$/,
  foto: /^image\/(jpeg|png|webp)$/,
  pdf: /^application\/pdf$/,
}
const extDe = (mime: string) => {
  const m = mime.split(';')[0]
  return ({ 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' } as Record<string, string>)[m] ?? 'bin'
}

/**
 * Trata /admin/simulador*. Devolve null quando o caminho não é do simulador.
 * `corpo(limite)` lê o corpo do pedido; a rota de envio aceita até ~12 MB por causa da mídia em base64.
 */
export async function rotaSimulador(metodo: string, caminho: string, busca: URLSearchParams, corpo: (limite?: number) => Promise<string>, admin: string, receber: Receber | null): Promise<Resposta | null> {
  if (caminho !== '/admin/simulador' && !caminho.startsWith('/admin/simulador/')) return null
  const ler = async (limite?: number) => JSON.parse((await corpo(limite)) || '{}') as Record<string, unknown>

  if (metodo === 'GET' && caminho === '/admin/simulador') {
    const numeros = await Promise.all(
      SIM_NUMEROS.map(async (numero) => {
        const [conta, ultima] = await Promise.all([
          contaDoNumero(numero),
          sb.from('mensagens').select('criado_em').eq('telefone', numero).order('criado_em', { ascending: false }).limit(1),
        ])
        return { numero, formatado: formatarNumero(numero), conta, ultima: (ultima.data?.[0]?.criado_em as string) ?? null }
      }),
    )
    return ok({ numeros, ambiente: ambiente(), pronto: !!receber })
  }

  if (metodo === 'GET' && caminho === '/admin/simulador/conversa') {
    const numero = numeroDoSimulador(busca.get('numero') ?? '')
    if (!numero) return erro(400, 'Número fora do simulador.')
    const depois = Number(busca.get('depois') ?? 0) || 0
    const m = await sb.from('mensagens').select('*').eq('telefone', numero).order('criado_em', { ascending: false }).limit(80)
    falhou(m.error, 'simulador: mensagens')
    const mensagens = (m.data ?? []).map((x) => {
      const { evento: _e, ...resto } = x as Record<string, unknown>
      return resto
    })
    return ok({ eventos: eventosDoSimulador(numero, depois), mensagens })
  }

  const b = metodo === 'POST' ? await ler(caminho === '/admin/simulador/enviar' ? 12_000_000 : undefined) : {}
  const numero = numeroDoSimulador(String(b.numero ?? ''))
  if (metodo !== 'POST') return erro(404, 'rota desconhecida')
  if (!numero) return erro(400, 'Número fora do simulador.')

  if (caminho === '/admin/simulador/conta') {
    if (await contaDoNumero(numero)) return erro(409, 'Este número já tem uma conta de teste. Zere antes de criar outra.')
    const nome = String(b.nome ?? '').trim().slice(0, 80)
    const email = `sim${numero.slice(-1)}-${randomBytes(3).toString('hex')}@${DOMINIO_SIM}`
    const c = await sb.auth.admin.createUser({ email, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { nome } })
    if (c.error || !c.data.user) return erro(500, `Não consegui criar a conta: ${c.error?.message ?? 'sem usuário'}`)
    const id = c.data.user.id
    // O que o site grava no cadastro de hoje: o número digitado (sem confirmar) e por onde a conta entrou. O passo 6 é a tela de confirmar.
    let up = await sb.from('perfis').update({ whats: formatarNumero(numero), onboarding_via: 'whats', onboarding_passo: 6 }).eq('id', id)
    if (up.error) up = await sb.from('perfis').update({ whats: formatarNumero(numero), onboarding_passo: 6 }).eq('id', id)
    // E o que o `salvarMinimo` do site grava antes do código: a conta do banco principal e as categorias padrão (as preferências de lembrete e
    // resumo do site são os padrões do banco). Sem isto a conta de teste não seria o clone do cadastro real.
    const extra = up.error ? null : await Promise.all([sb.from('carteiras').insert(linhaContaPadrao(id)), sb.from('categorias').insert(linhasCategoriasPadrao(id))])
    const falhaExtra = extra?.find((r) => r.error)?.error
    if (up.error || falhaExtra) {
      await sb.auth.admin.deleteUser(id)
      return erro(500, `Não consegui preparar a conta: ${(up.error ?? falhaExtra)!.message}`)
    }
    await novoCodigo(id)
    await auditar(admin, 'simulador_conta', id, { numero: `…${numero.slice(-4)}`, motivo: 'conta de teste do simulador' })
    return ok({ conta: await contaDoNumero(numero) })
  }

  if (caminho === '/admin/simulador/codigo') {
    const conta = await contaDoNumero(numero)
    if (!conta) return erro(404, 'Este número não tem conta de teste.')
    await novoCodigo(conta.user_id)
    return ok({ conta: await contaDoNumero(numero) })
  }

  if (caminho === '/admin/simulador/enviar') {
    if (!receber) return erro(503, 'O simulador ainda não está ligado neste servidor.')
    const tipo = String(b.tipo ?? 'texto') as TipoEnvioSim
    if (!['texto', 'audio', 'foto', 'pdf'].includes(tipo)) return erro(400, 'Tipo de mensagem inválido.')
    const texto = String(b.texto ?? '').slice(0, 4000)
    if (tipo === 'texto' && !texto.trim()) return erro(400, 'Mensagem vazia.')
    let fileUrl: string | undefined
    let nomeArquivo: string | undefined
    if (tipo !== 'texto') {
      const mime = String(b.mime ?? '').toLowerCase()
      if (!TIPOS_MIME[tipo].test(mime)) return erro(400, `Arquivo não aceito para ${tipo}: ${mime || 'sem tipo'}.`)
      const buf = Buffer.from(String(b.arquivo ?? ''), 'base64')
      if (!buf.length) return erro(400, 'Arquivo vazio.')
      if (buf.length > MIDIA_MAX_BYTES) return erro(413, 'Arquivo grande demais (máximo 8 MB).')
      fileUrl = guardarMidiaDoSimulador(buf, mime.split(';')[0], extDe(mime))
      nomeArquivo = String(b.nome_arquivo ?? '').replace(/[^\w. -]/g, '').slice(0, 80) || `documento.${extDe(mime)}`
    }
    const { id, evento } = eventoDoSimulador(numero, { tipo, texto, fileUrl, nomeArquivo })
    registrarNoSimulador(numero, { tipo: 'entrada', id, texto, ...(tipo !== 'texto' ? { midia: { tipo, nome: nomeArquivo ?? '' } } : {}) })
    const chegada = await receber(evento as never)
    return ok({ id, chegada })
  }

  if (caminho === '/admin/simulador/zerar') {
    const conta = await contaDoNumero(numero)
    let apagada = false
    if (conta) {
      // Dupla trava: só conta criada pelo simulador (e-mail do domínio dele) se apaga por aqui.
      if (!ehEmailDoSimulador(conta.email)) return erro(409, 'A conta ligada a este número não foi criada pelo simulador. Exclua pela aba Clientes.')
      await excluirContaDefinitivo(sb, admin, conta.user_id, conta.email, 'simulador: zerar a conversa de teste')
      apagada = true
    }
    // O que fica do número sem dono: mensagens de antes da confirmação, contagem de tentativas de código, pergunta em aberto.
    const [m, c] = await Promise.all([sb.from('mensagens').delete().eq('telefone', numero), sb.from('conversas').delete().eq('telefone', numero)])
    falhou(m.error, 'simulador: apagar mensagens')
    falhou(c.error, 'simulador: apagar conversa')
    limparCaixaDoSimulador(numero)
    await auditar(admin, 'simulador_zerar', null, { numero: `…${numero.slice(-4)}`, conta_apagada: apagada })
    return ok({ zerado: true, conta_apagada: apagada })
  }

  return erro(404, 'rota desconhecida')
}
