/**
 * O fluxo de uma mensagem que chega no WhatsApp da Granninha.
 * Ordem: registra (sem duplicar) → reconhece o cliente pelo número verificado → confere acesso e uso →
 * transforma áudio, foto ou PDF em texto → entende → grava → responde.
 */
import { acessoDe, chaveDoNumero, clientePorNumero, contextoDe, falhou, formatarNumero, sb, usoDoMes } from './banco.ts'
import { executar, reverter, ultimaComEfeito, type Efeitos, type Origem } from './executar.ts'
import { baixarMidia } from './gateway.ts'
import { conferir, interpretar, type Acao, type Contexto } from './interpretar.ts'
import { lerDocumento, textoDoDocumento, type Transacao } from './midia.ts'
import { transcrever } from './openai.ts'
import { responderPergunta } from './perguntas.ts'

export const LIMITE_LANCAMENTOS = Number(process.env.LIMITE_LANCAMENTOS ?? 300)
export const LIMITE_MIDIAS = Number(process.env.LIMITE_MIDIAS ?? 100)
const PAINEL = () => (process.env.PAINEL_URL ?? 'https://grannamei.amplasoft.me').replace(/\/+$/, '')

export interface EventoGateway {
  event: string
  sessionId?: string
  data: {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean }
    from?: string
    isGroup?: boolean
    chatType?: string
    type?: string
    content?: string
    caption?: string
    fileUrl?: string | null
    pushName?: string
  }
}

export interface Saida {
  status: string
  para?: string
  resposta?: string
}

type Status = 'ok' | 'pergunta' | 'ignorada' | 'bloqueada' | 'erro' | 'limite'

export function hojeSP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function tipoDaMensagem(d: EventoGateway['data']): Origem | 'outro' {
  const t = (d.type ?? '').toUpperCase()
  if (t === 'TEXT') return 'texto'
  if (t === 'AUDIO') return 'audio'
  if (t === 'IMAGE') return 'foto'
  if (t === 'DOCUMENT' && /\.pdf$/i.test(`${d.fileUrl ?? ''} ${d.content ?? ''}`.trim().split(' ')[0] || '') ) return 'pdf'
  if (t === 'DOCUMENT' && /pdf/i.test(`${d.fileUrl ?? ''}${d.content ?? ''}`)) return 'pdf'
  return 'outro'
}

const AJUDA = `É só me mandar do seu jeito:
"recebi 150 da Juliana no pix"
"paguei 89 de luz"
"aluguel 900 todo dia 10"
"comprei 1.200 de material em 4x"
Também entendo áudio, foto do comprovante e PDF. E você pode perguntar: "quanto sobrou esse mês?"`

export async function processar(ev: EventoGateway): Promise<Saida> {
  if (ev.event !== 'message.received') return { status: 'ignorada' }
  const d = ev.data ?? {}
  if (d.key?.fromMe || d.isGroup || (d.chatType && d.chatType !== 'PERSONAL')) return { status: 'ignorada' }
  const msgId = d.key?.id
  const de = d.from || d.key?.remoteJid || ''
  const telefone = de.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (!msgId || !telefone || !chaveDoNumero(de)) return { status: 'ignorada' }

  const tipo = tipoDaMensagem(d)
  const t0 = Date.now()
  let tokens = 0

  // Registro com o id do WhatsApp: se a mesma mensagem chegar de novo, para aqui.
  const ins = await sb.from('mensagens').insert({ id: msgId, telefone, tipo: tipo === 'outro' ? 'outro' : tipo, texto: (d.content ?? d.caption ?? '').slice(0, 2000) })
  if (ins.error?.code === '23505') return { status: 'duplicada' }
  falhou(ins.error, 'registrar mensagem')

  let userId: string | null = null
  let status: Status = 'ok'
  let resposta = ''
  let efeitos: Efeitos = {}
  let intencao: string | null = null
  let textoFinal = d.content ?? ''
  let erro: string | null = null

  try {
    const cliente = await clientePorNumero(de)
    if (!cliente) {
      ;({ status, resposta, userId } = await numeroDesconhecido(telefone, de, d.content ?? ''))
    } else {
      userId = cliente.id
      const hoje = hojeSP()
      const acesso = await acessoDe(cliente.id, hoje)
      const uso = await usoDoMes(cliente.id, hoje.slice(0, 8) + '01T00:00:00-03:00')
      if (acesso.acesso === 'bloqueado') {
        status = 'bloqueada'
        resposta = `Seu acesso está pausado e por isso não consigo anotar agora. Seus dados estão guardados. Para voltar, é só regularizar em ${PAINEL()}/ajustes/assinatura`
      } else if (uso.lancamentos >= LIMITE_LANCAMENTOS || (tipo !== 'texto' && tipo !== 'outro' && uso.midias >= LIMITE_MIDIAS)) {
        status = 'limite'
        resposta = uso.lancamentos >= LIMITE_LANCAMENTOS
          ? `Você chegou ao limite de ${LIMITE_LANCAMENTOS} lançamentos deste mês. No dia 1 o contador zera. Se precisar de mais, fala com a gente pelo painel.`
          : `Você chegou ao limite de ${LIMITE_MIDIAS} áudios, fotos e PDFs deste mês. Texto continua funcionando normal, e no dia 1 o contador zera.`
      } else if (tipo === 'outro') {
        status = 'ignorada'
        resposta = 'Por aqui eu entendo texto, áudio, foto de comprovante e PDF. Me manda de um desses jeitos?'
      } else {
        const r = await conversar(cliente, hoje, tipo, d, msgId, telefone)
        ;({ status, resposta, efeitos, intencao } = r)
        textoFinal = r.texto
        tokens = r.tokens
        // Aviso de 80% do limite, uma vez, junto da resposta.
        if (status === 'ok' && uso.lancamentos + 1 === Math.floor(LIMITE_LANCAMENTOS * 0.8)) {
          resposta += `\n\nAviso: você já usou 80% dos ${LIMITE_LANCAMENTOS} lançamentos do mês.`
        }
      }
    }
  } catch (e) {
    status = 'erro'
    erro = (e as Error).message.slice(0, 500)
    resposta = 'Tive um problema para anotar agora. Pode mandar de novo daqui a pouco?'
    console.error('[granninha]', msgId, erro)
  }

  const up = await sb.from('mensagens').update({ user_id: userId, intencao, status, resposta, efeitos, erro, texto: textoFinal.slice(0, 2000), ms: Date.now() - t0, tokens }).eq('id', msgId)
  if (up.error) console.error('[granninha] atualizar mensagem', up.error.message)
  return { status, para: telefone, resposta }
}

/** Número que não é de nenhum cliente verificado: ou está mandando o código de confirmação, ou recebe o link de cadastro. */
async function numeroDesconhecido(telefone: string, jid: string, texto: string): Promise<{ status: Status; resposta: string; userId: string | null }> {
  const codigo = texto.match(/\b(\d{6})\b/)?.[1]
  if (codigo) {
    const { data: v, error } = await sb.from('verificacoes').select('user_id').eq('codigo', codigo).gt('expira_em', new Date().toISOString()).maybeSingle()
    falhou(error, 'verificação')
    if (v) {
      const up = await sb.from('perfis').update({ whats: formatarNumero(jid), whats_verificado: true }).eq('id', v.user_id).select('nome').single()
      if (up.error?.code === '23505') return { status: 'ignorada', resposta: 'Este número já está ligado a outra conta do Granna Mei. Se for engano, fala com a gente pelo painel.', userId: v.user_id }
      falhou(up.error, 'confirmar número')
      await sb.from('verificacoes').delete().eq('user_id', v.user_id)
      const nome = (up.data?.nome ?? '').split(' ')[0]
      return {
        status: 'ok',
        resposta: `Pronto${nome ? `, ${nome}` : ''}! Seu número está confirmado. Agora é só me mandar o que entrou ou saiu que eu anoto.\n\nExemplo: "recebi 150 no pix" ou "paguei 89 de luz".`,
        userId: v.user_id,
      }
    }
  }
  // Responde o link no máximo uma vez por dia para o mesmo número: sem gastar IA e sem virar conversa infinita.
  const { data: c } = await sb.from('conversas').select('pendente,atualizado_em').eq('telefone', telefone).maybeSingle()
  const ultimo = (c?.pendente as { link_em?: string } | null)?.link_em
  if (ultimo && Date.now() - new Date(ultimo).getTime() < 86400_000) return { status: 'ignorada', resposta: '', userId: null }
  await sb.from('conversas').upsert({ telefone, pendente: { link_em: new Date().toISOString() }, atualizado_em: new Date().toISOString() })
  return {
    status: 'ignorada',
    resposta: codigo
      ? `Esse código não confere ou já venceu. Gere um novo no painel em ${PAINEL()} e me mande de novo.`
      : `Oi! Eu sou a Granninha, do Granna Mei. Eu organizo o dinheiro do seu MEI aqui pelo WhatsApp.\n\nPara começar, crie sua conta (7 dias grátis): ${PAINEL()}/criar-conta`,
    userId: null,
  }
}

interface Conversa {
  status: Status
  resposta: string
  efeitos: Efeitos
  intencao: string | null
  texto: string
  tokens: number
}

async function conversar(cliente: { id: string; nome: string }, hoje: string, tipo: Origem, d: EventoGateway['data'], msgId: string, telefone: string): Promise<Conversa> {
  let tokens = 0
  let texto = (d.content ?? '').trim()
  let anexo: string | null = null
  const nome = cliente.nome.split(' ')[0]

  // Pergunta em aberto (ex.: "qual foi o valor?") ou importação de extrato esperando um sim.
  const { data: conv } = await sb.from('conversas').select('pendente,atualizado_em').eq('telefone', telefone).maybeSingle()
  const pend = conv?.pendente as { tipo?: string; texto?: string; pergunta?: string; transacoes?: Transacao[] } | null
  const fresco = conv && Date.now() - new Date(conv.atualizado_em).getTime() < 30 * 60_000
  if (pend?.tipo) await sb.from('conversas').update({ pendente: null, atualizado_em: new Date().toISOString() }).eq('telefone', telefone)

  if (tipo === 'audio') {
    const m = await baixarMidia(d.fileUrl ?? '')
    texto = await transcrever(m.buffer, m.mime)
  } else if (tipo === 'foto' || tipo === 'pdf') {
    const m = await baixarMidia(d.fileUrl ?? '')
    const ext = tipo === 'pdf' ? 'pdf' : m.mime.includes('png') ? 'png' : 'jpg'
    anexo = `${cliente.id}/${msgId.replace(/[^A-Za-z0-9_-]/g, '')}.${ext}`
    const upl = await sb.storage.from('comprovantes').upload(anexo, m.buffer, { contentType: tipo === 'pdf' ? 'application/pdf' : m.mime, upsert: true })
    falhou(upl.error, 'guardar comprovante')
    const { leitura, uso } = await lerDocumento(m.buffer, tipo === 'pdf' ? 'application/pdf' : m.mime, d.caption ?? '')
    tokens += uso.entrada + uso.saida
    if (!leitura.transacoes.length) {
      return { status: 'pergunta', resposta: 'Não consegui ver um valor nesse arquivo. Me diz o que foi e o valor?', efeitos: {}, intencao: 'documento', texto: leitura.resumo, tokens }
    }
    if (leitura.tipo === 'extrato' && leitura.transacoes.length > 1) {
      const ent = leitura.transacoes.filter((t) => t.movimento === 'entrada').reduce((a, t) => a + t.valor, 0)
      const sai = leitura.transacoes.filter((t) => t.movimento === 'saida').reduce((a, t) => a + t.valor, 0)
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: { tipo: 'importar', transacoes: leitura.transacoes, anexo }, atualizado_em: new Date().toISOString() })
      return {
        status: 'pergunta',
        resposta: `Achei ${leitura.transacoes.length} lançamentos nesse extrato: ${brl(ent)} de entradas e ${brl(sai)} de saídas.\n\nQuer que eu importe? Responda SIM ou NÃO.`,
        efeitos: {}, intencao: 'extrato', texto: leitura.resumo, tokens,
      }
    }
    texto = textoDoDocumento(leitura, d.caption ?? '')
  }

  const ctx = await contextoDe(cliente.id, hoje)

  if (pend?.tipo === 'importar' && fresco) {
    if (/^\s*(sim|s|pode|importa|ok|isso|manda)\b/i.test(texto)) return importar(cliente.id, ctx, pend.transacoes ?? [], tipo, (pend as { anexo?: string }).anexo ?? null, tokens)
    if (/^\s*(n[ãa]o|nao|n)\b/i.test(texto)) return { status: 'ok', resposta: 'Tudo bem, não importei nada.', efeitos: {}, intencao: 'extrato', texto, tokens }
  }
  if (pend?.tipo === 'pergunta' && fresco && pend.texto) texto = `${pend.texto}\n(resposta para "${pend.pergunta}"): ${texto}`

  const it = await interpretar(texto, ctx)
  tokens += it.uso.entrada + it.uso.saida

  if (it.intencao === 'acoes') {
    if (it.perguntar) {
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: { tipo: 'pergunta', texto, pergunta: it.perguntar }, atualizado_em: new Date().toISOString() })
      return { status: 'pergunta', resposta: it.perguntar, efeitos: {}, intencao: 'acoes', texto, tokens }
    }
    const r = await executar(cliente.id, ctx, it.acoes, tipo, anexo)
    return { status: 'ok', resposta: `${r.linhas.join('\n\n')}\n\nErrou? Responda DESFAZER.`, efeitos: r.efeitos, intencao: 'acoes', texto, tokens }
  }
  if (it.intencao === 'desfazer') {
    const ult = await ultimaComEfeito(cliente.id)
    if (!ult) return { status: 'ok', resposta: 'Não achei nada recente para desfazer.', efeitos: {}, intencao: 'desfazer', texto, tokens }
    await reverter(cliente.id, ult.efeitos)
    await sb.from('mensagens').update({ desfeita: true }).eq('id', ult.id).eq('user_id', cliente.id)
    return { status: 'ok', resposta: `Pronto, desfiz: "${ult.texto.slice(0, 120)}"`, efeitos: {}, intencao: 'desfazer', texto, tokens }
  }
  if (it.intencao === 'corrigir') {
    const ult = await ultimaComEfeito(cliente.id)
    if (!ult) return { status: 'ok', resposta: 'Não achei o lançamento para corrigir. Me manda de novo do jeito certo?', efeitos: {}, intencao: 'corrigir', texto, tokens }
    const novo = `${ult.texto}\nCorreção: ${it.correcao ?? texto}`
    const it2 = await interpretar(novo, ctx)
    tokens += it2.uso.entrada + it2.uso.saida
    if (it2.intencao !== 'acoes' || it2.perguntar || !it2.acoes.length) {
      return { status: 'pergunta', resposta: it2.perguntar ?? 'Não entendi a correção. Responda DESFAZER e me mande de novo do jeito certo.', efeitos: {}, intencao: 'corrigir', texto, tokens }
    }
    await reverter(cliente.id, ult.efeitos)
    await sb.from('mensagens').update({ desfeita: true }).eq('id', ult.id).eq('user_id', cliente.id)
    const r = await executar(cliente.id, await contextoDe(cliente.id, hoje), it2.acoes, tipo, anexo)
    return { status: 'ok', resposta: `Corrigido.\n\n${r.linhas.join('\n\n')}\n\nErrou? Responda DESFAZER.`, efeitos: r.efeitos, intencao: 'corrigir', texto: novo, tokens }
  }
  if (it.intencao === 'pergunta') {
    const p = await responderPergunta(cliente.id, hoje, it.pergunta ?? texto)
    return { status: 'ok', resposta: p.texto, efeitos: {}, intencao: 'pergunta', texto, tokens: tokens + p.uso.entrada + p.uso.saida }
  }
  if (it.intencao === 'saudacao') return { status: 'ok', resposta: `Oi${nome ? `, ${nome}` : ''}! Me manda o que entrou ou saiu que eu anoto. Pode ser texto, áudio ou foto do comprovante.`, efeitos: {}, intencao: 'saudacao', texto, tokens }
  if (it.intencao === 'ajuda') return { status: 'ok', resposta: AJUDA, efeitos: {}, intencao: 'ajuda', texto, tokens }
  return { status: 'ok', resposta: `Eu cuido do dinheiro do seu negócio. Me conta o que entrou ou saiu, ou pergunte como estão as contas.\n\n${AJUDA}`, efeitos: {}, intencao: 'outro', texto, tokens }
}

/** Importa as transações de um extrato depois do SIM. Pula as que já existem (mesmo dia, valor e direção). */
async function importar(userId: string, ctx: Contexto, ts: Transacao[], tipo: Origem, anexo: string | null, tokens: number): Promise<Conversa> {
  const { data: ja, error } = await sb.from('lancamentos').select('data,valor,tipo').eq('user_id', userId).gte('data', ts.map((t) => t.data ?? ctx.hoje).sort()[0])
  falhou(error, 'extrato: duplicados')
  const existe = new Set((ja ?? []).map((l) => `${l.data}|${Number(l.valor).toFixed(2)}|${l.tipo}`))
  const padrao = ctx.carteiras.find((c) => c.padrao)?.id ?? ctx.carteiras[0]?.id ?? ''
  const acoes: Acao[] = []
  let pulou = 0
  for (const t of ts) {
    const data = t.data && /^\d{4}-\d{2}-\d{2}$/.test(t.data) && t.data <= ctx.hoje ? t.data : ctx.hoje
    if (existe.has(`${data}|${t.valor.toFixed(2)}|${t.movimento}`)) {
      pulou++
      continue
    }
    const base = conferir(`${t.valor.toFixed(2).replace('.', ',')}`, ctx, {
      intencao: 'acoes', pergunta: null, correcao: null, falta: null,
      acoes: [{ tipo_acao: 'lancamento', movimento: t.movimento, valor: t.valor, descricao: t.descricao, categoria_id: null, carteira_id: padrao, carteira_destino_id: null, data, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null, conta_id: null }],
    })
    acoes.push(...base.acoes)
  }
  if (!acoes.length) return { status: 'ok', resposta: `Todos os ${ts.length} lançamentos desse extrato já estavam anotados.`, efeitos: {}, intencao: 'extrato', texto: 'importar extrato', tokens }
  const r = await executar(userId, ctx, acoes, tipo, anexo)
  return {
    status: 'ok',
    resposta: `Importei ${acoes.length} lançamentos${pulou ? ` (${pulou} já existiam e pulei)` : ''}. Confira as categorias no painel.\n\nErrou? Responda DESFAZER.`,
    efeitos: r.efeitos, intencao: 'extrato', texto: 'importar extrato', tokens,
  }
}
