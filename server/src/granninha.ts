/**
 * O fluxo de uma mensagem que chega no WhatsApp da Granninha.
 * Ordem: registra (sem duplicar) → reconhece o cliente pelo número verificado → confere acesso e uso →
 * transforma áudio, foto ou PDF em texto → entende → grava → responde.
 */
import { acessoDe, chaveDoNumero, clientePorNumero, contextoDe, falhou, formatarNumero, sb, usoDoMes } from './banco.ts'
import { faturaDe } from './cartao.ts'
import { executar, reverter, ultimaComEfeito, type Efeitos, type Origem } from './executar.ts'
import { baixarMidia } from './gateway.ts'
import { BOLETO, conferir, interpretar, NEGOCIO, opcaoEscolhida, PESSOAL, type Acao, type Contexto, type Opcao } from './interpretar.ts'
import { lerDocumento, textoDoDocumento, type Transacao } from './midia.ts'
import { transcrever, type Uso } from './openai.ts'
import { responderPergunta } from './perguntas.ts'
import { carregarBase } from './base.ts'
import { ehPerguntaClara, linhasDeSaldoDepois, reconhecer, responderConsulta } from './consultas.ts'
import { foraDoDisponivel } from './cartao.ts'

export const LIMITE_LANCAMENTOS = Number(process.env.LIMITE_LANCAMENTOS ?? 300)
export const LIMITE_MIDIAS = Number(process.env.LIMITE_MIDIAS ?? 100)
const PAINEL = () => (process.env.PAINEL_URL ?? 'https://granninha.amplasoft.me/painel').replace(/\/+$/, '')

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

  // Modo teste: com WA_SOMENTE_NUMEROS preenchido, só esses números conversam. O resto é ignorado em silêncio
  // (sem resposta, sem IA, sem gravar nada além do registro de que chegou).
  const liberados = (process.env.WA_SOMENTE_NUMEROS ?? '').split(',').map((n) => chaveDoNumero(n.trim())).filter(Boolean)
  if (liberados.length && !liberados.includes(chaveDoNumero(de))) {
    await sb.from('mensagens').insert({ id: msgId, telefone, tipo: 'outro', texto: '', status: 'ignorada', resposta: null, erro: 'fora da lista de números liberados' })
    return { status: 'ignorada' }
  }

  const tipo = tipoDaMensagem(d)
  const t0 = Date.now()
  let tokens: Uso = { entrada: 0, saida: 0, audio: 0 }

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
      } else if (await codigoDeOutraConta(cliente.id, d.content ?? '')) {
        // Abriu outra conta e tentou confirmar com o mesmo número: o número já é desta conta, então
        // sem isto o código viraria uma conversa comum aqui e a conta nova ficaria esperando para sempre.
        status = 'ignorada'
        resposta = `Esse número já está confirmado nesta conta, então não dá para usá-lo em outra ao mesmo tempo. Se quiser levá-lo para a conta nova, troque o número aqui em ${PAINEL()}/ajustes (ou peça a exclusão desta conta) e confirme lá.`
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

  const up = await sb.from('mensagens').update({
    user_id: userId, intencao, status, resposta, efeitos, erro, texto: textoFinal.slice(0, 2000), ms: Date.now() - t0,
    tokens: tokens.entrada + tokens.saida, tokens_entrada: tokens.entrada, tokens_saida: tokens.saida, audio_tokens: tokens.audio || null, audio_seg: tokens.audioSeg ?? null,
  }).eq('id', msgId)
  if (up.error) console.error('[granninha] atualizar mensagem', up.error.message)
  return { status, para: telefone, resposta }
}

/**
 * A mensagem é um código de confirmação de OUTRA conta? Acontece quando a pessoa abre uma conta nova
 * e tenta confirmar com o número que já é de uma conta existente dela.
 */
async function codigoDeOutraConta(clienteId: string, texto: string): Promise<boolean> {
  const codigo = texto.trim().match(/^\D{0,30}\b(\d{6})\b\D{0,30}$/)?.[1]
  if (!codigo) return false
  const { data } = await sb.from('verificacoes').select('user_id').eq('codigo', codigo).gt('expira_em', new Date().toISOString()).limit(2)
  return (data ?? []).some((v) => (v as { user_id: string }).user_id !== clienteId)
}

/** Quantos códigos errados o mesmo número pode tentar antes de a Granninha parar de responder, e por quanto tempo. */
const LIMITE_CODIGOS = 5
const JANELA_CODIGOS = 60 * 60 * 1000

/** Lê as tentativas de código daquele telefone, zerando sozinho quando a janela passa. */
async function tentativasDe(telefone: string): Promise<{ n: number; desde: string | null; link_em?: string }> {
  const { data } = await sb.from('conversas').select('pendente').eq('telefone', telefone).maybeSingle()
  const p = (data?.pendente ?? {}) as { codigo_tentativas?: number; codigo_desde?: string; link_em?: string }
  const dentro = p.codigo_desde ? Date.now() - new Date(p.codigo_desde).getTime() < JANELA_CODIGOS : false
  return { n: dentro ? (p.codigo_tentativas ?? 0) : 0, desde: dentro ? (p.codigo_desde ?? null) : null, link_em: p.link_em }
}

async function marcarTentativa(telefone: string, atual: { n: number; desde: string | null; link_em?: string }) {
  const agora = new Date().toISOString()
  await sb.from('conversas').upsert({
    telefone,
    pendente: { codigo_tentativas: atual.n + 1, codigo_desde: atual.desde ?? agora, ...(atual.link_em ? { link_em: atual.link_em } : {}) },
    atualizado_em: agora,
  })
}

/**
 * Número que não é de nenhum cliente verificado. Se mandar o código de confirmação certo, liga o
 * número à conta; fora isso, silêncio (ou o convite de cadastro, com GRANNINHA_CONVIDAR=1).
 *
 * O código vale para UM número: ele só confirma se o remetente for o número que a pessoa digitou no
 * painel. Sem isso, qualquer um mandando números de 6 dígitos ao acaso acabaria ligando o próprio
 * telefone à conta de um cliente (e lendo o financeiro dele). Por isso também existe teto de
 * tentativas por telefone: estourou, a Granninha cala, e aí nem serve para adivinhar código.
 */
async function numeroDesconhecido(telefone: string, jid: string, texto: string): Promise<{ status: Status; resposta: string; userId: string | null }> {
  const codigo = texto.match(/\b(\d{6})\b/)?.[1]
  const mudo = { status: 'ignorada' as Status, resposta: '', userId: null }
  if (codigo) {
    const tent = await tentativasDe(telefone)
    if (tent.n >= LIMITE_CODIGOS) {
      // Estourou o teto. Avisa UMA vez e depois cala: quem é cliente de verdade e errou demais precisa
      // saber que é só esperar, e quem está tentando adivinhar código não ganha pista nenhuma com isso.
      if (tent.n === LIMITE_CODIGOS) {
        await marcarTentativa(telefone, tent)
        return { status: 'ignorada', resposta: 'Foram muitas tentativas seguidas. Espere alguns minutos, gere um código novo no painel e me mande de novo.', userId: null }
      }
      return mudo
    }
    const agora = new Date().toISOString()
    // limit(2) para enxergar a colisão: dois clientes com o mesmo código vivo não podem quebrar a confirmação.
    const { data: vs, error } = await sb.from('verificacoes').select('user_id').eq('codigo', codigo).gt('expira_em', agora).limit(2)
    falhou(error, 'verificação')
    const achados = vs ?? []
    if (achados.length > 1) {
      return { status: 'ignorada', resposta: `Não consegui confirmar agora. Gere um código novo no painel em ${PAINEL()} e me mande de novo.`, userId: null }
    }
    const v = achados[0]
    if (v) {
      // O código é de quem digitou aquele número no painel: confere antes de ligar.
      const dono = await sb.from('perfis').select('nome, whats_chave').eq('id', v.user_id).maybeSingle()
      falhou(dono.error, 'dono do código')
      const esperado = dono.data?.whats_chave as string | null
      if (esperado && esperado !== chaveDoNumero(jid)) {
        await marcarTentativa(telefone, tent)
        return {
          status: 'ignorada',
          resposta: `Esse código foi gerado para outro número de WhatsApp. Confira o número em ${PAINEL()}/ajustes e gere um código novo.`,
          userId: null,
        }
      }
      const up = await sb.from('perfis').update({ whats: formatarNumero(jid), whats_verificado: true }).eq('id', v.user_id).select('nome').single()
      if (up.error?.code === '23505') {
        return {
          status: 'ignorada',
          resposta: `Este número já está ligado a outra conta da Granninha. Entre naquela conta em ${PAINEL()} e troque o número em Ajustes, ou peça a exclusão dela.`,
          userId: v.user_id,
        }
      }
      falhou(up.error, 'confirmar número')
      await sb.from('verificacoes').delete().eq('user_id', v.user_id)
      // Confirmou: a contagem de tentativas daquele telefone sai do caminho.
      await sb.from('conversas').delete().eq('telefone', telefone)
      const nome = (up.data?.nome ?? '').split(' ')[0]
      return {
        status: 'ok',
        resposta: `Pronto${nome ? `, ${nome}` : ''}! Seu número está confirmado. Agora é só me mandar o que entrou ou saiu que eu anoto.\n\nExemplo: "recebi 150 no pix" ou "paguei 89 de luz".`,
        userId: v.user_id,
      }
    }
    // Código errado ou vencido: quem está tentando confirmar precisa saber disso, senão fica
    // esperando para sempre achando que a Granninha não funciona. Vale mesmo com o convite desligado.
    await marcarTentativa(telefone, tent)
    return { status: 'ignorada', resposta: `Esse código não confere ou já venceu. Gere um novo no painel em ${PAINEL()} e me mande de novo.`, userId: null }
  }
  // Sem código, a Granninha fica em silêncio para quem não é cliente: sem convite, sem link
  // (pedido do Arthur em 2026-11-16: "inativo para os externos"). GRANNINHA_CONVIDAR=1 religa o convite abaixo.
  if (process.env.GRANNINHA_CONVIDAR !== '1') return mudo
  // Responde o link no máximo uma vez por dia para o mesmo número: sem gastar IA e sem virar conversa infinita.
  const tent = await tentativasDe(telefone)
  if (tent.link_em && Date.now() - new Date(tent.link_em).getTime() < 86400_000) return mudo
  const agora = new Date().toISOString()
  // Guarda a contagem de tentativas de código junto: um "oi" no meio não pode zerar o teto.
  await sb.from('conversas').upsert({
    telefone,
    pendente: { link_em: agora, ...(tent.n ? { codigo_tentativas: tent.n, codigo_desde: tent.desde } : {}) },
    atualizado_em: agora,
  })
  return {
    status: 'ignorada',
    resposta: `Oi! Eu sou a Granninha. Eu organizo o dinheiro do seu MEI aqui pelo WhatsApp.\n\nPara começar, crie sua conta (${hojeSP() <= '2026-12-31' ? 'grátis até 31 de dezembro' : '7 dias grátis'}): ${PAINEL()}/criar-conta`,
    userId: null,
  }
}

interface Conversa {
  status: Status
  resposta: string
  efeitos: Efeitos
  intencao: string | null
  texto: string
  tokens: Uso
}

async function conversar(cliente: { id: string; nome: string }, hoje: string, tipo: Origem, d: EventoGateway['data'], msgId: string, telefone: string): Promise<Conversa> {
  const tokens: Uso = { entrada: 0, saida: 0, audio: 0 }
  const soma = (u: Uso) => {
    tokens.entrada += u.entrada
    tokens.saida += u.saida
    tokens.audio = (tokens.audio ?? 0) + (u.audio ?? 0)
    if (u.audioSeg) tokens.audioSeg = (tokens.audioSeg ?? 0) + u.audioSeg
  }
  let texto = (d.content ?? '').trim()
  let anexo: string | null = null
  let documento: { valor: number; movimento: 'entrada' | 'saida' } | undefined
  const nome = cliente.nome.split(' ')[0]

  // Pergunta em aberto (ex.: "qual foi o valor?") ou importação de extrato esperando um sim.
  const { data: conv } = await sb.from('conversas').select('pendente,atualizado_em').eq('telefone', telefone).maybeSingle()
  const pend = conv?.pendente as { tipo?: string; texto?: string; pergunta?: string; transacoes?: Transacao[]; opcoes?: Opcao[]; anexo?: string; forcar?: { carteira?: string; pessoal?: boolean }; documento?: { valor: number; movimento: 'entrada' | 'saida' }; origem?: Origem } | null
  const fresco = conv && Date.now() - new Date(conv.atualizado_em).getTime() < 30 * 60_000
  if (pend?.tipo) await sb.from('conversas').update({ pendente: null, atualizado_em: new Date().toISOString() }).eq('telefone', telefone)

  if (tipo === 'audio') {
    const m = await baixarMidia(d.fileUrl ?? '')
    const tr = await transcrever(m.buffer, m.mime)
    texto = tr.texto
    soma(tr.uso)
  } else if (tipo === 'foto' || tipo === 'pdf') {
    const m = await baixarMidia(d.fileUrl ?? '')
    const ext = tipo === 'pdf' ? 'pdf' : m.mime.includes('png') ? 'png' : 'jpg'
    anexo = `${cliente.id}/${msgId.replace(/[^A-Za-z0-9_-]/g, '')}.${ext}`
    const upl = await sb.storage.from('comprovantes').upload(anexo, m.buffer, { contentType: tipo === 'pdf' ? 'application/pdf' : m.mime, upsert: true })
    falhou(upl.error, 'guardar comprovante')
    const { leitura, uso } = await lerDocumento(m.buffer, tipo === 'pdf' ? 'application/pdf' : m.mime, d.caption ?? '')
    soma(uso)
    if (!leitura.transacoes.length) {
      return { status: 'pergunta', resposta: 'Não consegui ver um valor nesse arquivo. Me diz o que foi e o valor?', efeitos: {}, intencao: 'documento', texto: leitura.resumo, tokens }
    }
    if (leitura.tipo === 'fatura_cartao' && leitura.transacoes.length) {
      // Fatura do cartão: as compras entram no cartão escolhido, na fatura que o documento diz.
      const cartoes = (await contextoDe(cliente.id, hoje)).carteiras.filter((c) => c.tipo === 'cartao')
      if (!cartoes.length) {
        return { status: 'ok', resposta: `Essa é uma fatura de cartão. Para eu importar as compras, cadastre o cartão em ${PAINEL()}/ajustes (Carteiras) e me mande de novo.`, efeitos: {}, intencao: 'fatura', texto: leitura.resumo, tokens }
      }
      const total = leitura.transacoes.reduce((a, t) => a + t.valor, 0)
      const opcoes = cartoes.map((c) => ({ id: c.id, nome: c.nome }))
      const venc = leitura.vencimento && /^\d{4}-\d{2}-\d{2}$/.test(leitura.vencimento) ? leitura.vencimento : null
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: { tipo: 'importar_fatura', transacoes: leitura.transacoes, anexo, opcoes, vencimento: venc }, atualizado_em: new Date().toISOString() })
      return {
        status: 'pergunta',
        resposta: `Achei ${leitura.transacoes.length} compras nessa fatura, somando ${brl(total)}${venc ? ` (vence ${venc.split('-').reverse().slice(0, 2).join('/')})` : ''}.\n\nQuer que eu importe? Responda com o número do cartão, ou NÃO:\n${opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}`,
        efeitos: {}, intencao: 'fatura', texto: leitura.resumo, tokens,
      }
    }
    if (leitura.tipo === 'extrato' && leitura.transacoes.length > 1) {
      const ent = leitura.transacoes.filter((t) => t.movimento === 'entrada').reduce((a, t) => a + t.valor, 0)
      const sai = leitura.transacoes.filter((t) => t.movimento === 'saida').reduce((a, t) => a + t.valor, 0)
      const bancos = (await contextoDe(cliente.id, hoje)).carteiras.filter((c) => c.tipo === 'banco')
      const opcoes = bancos.length > 1 ? bancos.map((c) => ({ id: c.id, nome: c.nome })) : undefined
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: { tipo: 'importar', transacoes: leitura.transacoes, anexo, opcoes }, atualizado_em: new Date().toISOString() })
      return {
        status: 'pergunta',
        resposta: `Achei ${leitura.transacoes.length} lançamentos nesse extrato: ${brl(ent)} de entradas e ${brl(sai)} de saídas.\n\n` + (opcoes
          ? `Quer que eu importe? Responda com o número da conta deste extrato, ou NÃO:\n${opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}`
          : 'Quer que eu importe? Responda SIM ou NÃO.'),
        efeitos: {}, intencao: 'extrato', texto: leitura.resumo, tokens,
      }
    }
    texto = textoDoDocumento(leitura, d.caption ?? '')
    documento = { valor: leitura.transacoes[0].valor, movimento: leitura.transacoes[0].movimento }
  }

  const ctx = await contextoDe(cliente.id, hoje)

  if (pend?.tipo === 'importar_fatura' && fresco) {
    if (/^\s*(n[ãa]o|nao|n)\b/i.test(texto)) return { status: 'ok', resposta: 'Tudo bem, não importei a fatura.', efeitos: {}, intencao: 'fatura', texto, tokens }
    const esc = opcaoEscolhida(texto, pend.opcoes ?? [])
    if (esc) return importarFatura(cliente.id, ctx, pend.transacoes ?? [], esc.id, (pend as { vencimento?: string | null }).vencimento ?? null, tipo, pend.anexo ?? null, tokens)
    if (/^\s*(sim|s|pode|importa|ok|isso|manda|\d+)\b/i.test(texto)) {
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: pend, atualizado_em: new Date().toISOString() })
      return { status: 'pergunta', resposta: `Em qual cartão? Responda com o número:\n${(pend.opcoes ?? []).map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}`, efeitos: {}, intencao: 'fatura', texto, tokens }
    }
  }
  if (pend?.tipo === 'importar' && fresco) {
    if (/^\s*(n[ãa]o|nao|n)\b/i.test(texto)) return { status: 'ok', resposta: 'Tudo bem, não importei nada.', efeitos: {}, intencao: 'extrato', texto, tokens }
    if (pend.opcoes?.length) {
      const esc = opcaoEscolhida(texto, pend.opcoes)
      if (esc) return importar(cliente.id, ctx, pend.transacoes ?? [], tipo, pend.anexo ?? null, tokens, esc.id)
      if (/^\s*(sim|s|pode|importa|ok|isso|manda|\d+)\b/i.test(texto)) {
        await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: pend, atualizado_em: new Date().toISOString() })
        return { status: 'pergunta', resposta: `De qual conta é esse extrato? Responda com o número:\n${pend.opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}`, efeitos: {}, intencao: 'extrato', texto, tokens }
      }
    } else if (/^\s*(sim|s|pode|importa|ok|isso|manda)\b/i.test(texto)) return importar(cliente.id, ctx, pend.transacoes ?? [], tipo, pend.anexo ?? null, tokens)
  }
  // Resposta a uma pergunta com opções: o número (ou o nome) decide no código, sem depender da IA.
  // As respostas se acumulam (ex.: "do negócio" e depois "Nubank") até o lançamento fechar.
  // Se a pergunta tinha opções e a pessoa mandou outra coisa (outro lançamento, uma pergunta), a pergunta antiga
  // é deixada de lado e a mensagem nova vale sozinha: nada de repetir a mesma pergunta para sempre.
  const escolha = pend?.tipo === 'pergunta' && fresco && pend.opcoes?.length ? opcaoEscolhida(texto, pend.opcoes) : null
  const continua = pend?.tipo === 'pergunta' && fresco && !!pend.texto && (!pend.opcoes?.length || !!escolha || /^\s*\d{1,2}\s*$/.test(texto))
  const forcar: { carteira?: string; pessoal?: boolean } = continua ? { ...(pend!.forcar ?? {}) } : {}
  if (continua && pend!.documento && !documento) documento = pend!.documento
  // O lançamento guarda de onde veio a primeira mensagem (áudio, foto, PDF) e o comprovante, mesmo depois das perguntas.
  const origemFinal: Origem = continua && pend!.origem ? pend!.origem : tipo
  if (continua && pend!.anexo && !anexo) anexo = pend!.anexo
  if (continua && pend?.texto) {
    const esc = escolha
    if (pend.opcoes?.length && !esc) {
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: pend, atualizado_em: new Date().toISOString() })
      return { status: 'pergunta', resposta: `Não achei essa opção. ${pend.pergunta}`, efeitos: {}, intencao: 'acoes', texto, tokens }
    }
    if (esc?.id === NEGOCIO || esc?.id === PESSOAL) forcar.pessoal = esc.id === PESSOAL
    else if (esc) forcar.carteira = esc.id
    texto = `${pend.texto}\n(resposta para "${(pend.pergunta ?? '').split('\n')[0]}"): ${esc ? (esc.id === BOLETO ? 'no boleto ou carnê' : esc.id === NEGOCIO ? 'é do negócio' : esc.id === PESSOAL ? 'é pessoal, da casa' : esc.nome) : texto}`
  }

  // Pergunta de número ("qual meu saldo?", "quanto entrou hoje?"): responde por código, sem IA. O número é o mesmo do painel.
  if (!continua && !documento && !anexo && ehPerguntaClara(texto)) {
    const consulta = reconhecer(texto)
    if (consulta) {
      const direta = responderConsulta(consulta, await carregarBase(cliente.id), hoje)
      return { status: 'ok', resposta: direta, efeitos: {}, intencao: 'pergunta', texto, tokens }
    }
  }

  const it = await interpretar(texto, ctx, { forcarCarteira: forcar.carteira, forcarPessoal: forcar.pessoal, documento })
  soma(it.uso)

  if (it.intencao === 'acoes') {
    if (it.perguntar) {
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: { tipo: 'pergunta', texto, pergunta: it.perguntar, opcoes: it.opcoes, forcar, documento, origem: origemFinal, anexo }, atualizado_em: new Date().toISOString() })
      return { status: 'pergunta', resposta: it.perguntar, efeitos: {}, intencao: 'acoes', texto, tokens }
    }
    const anteriores = it.acoes.some((a) => a.tipo_acao === 'criar_categoria') ? (await ultimaComEfeito(cliente.id))?.efeitos : undefined
    const r = await executar(cliente.id, ctx, it.acoes, origemFinal, anexo, anteriores)
    return { status: 'ok', resposta: `${r.linhas.join('\n\n')}${await saldoDepois(cliente.id, it.acoes)}\n\nErrou? Responda DESFAZER.`, efeitos: r.efeitos, intencao: 'acoes', texto, tokens }
  }
  if (it.intencao === 'desfazer') {
    const ult = await ultimaComEfeito(cliente.id)
    if (!ult) return { status: 'ok', resposta: 'Não achei nada recente para desfazer.', efeitos: {}, intencao: 'desfazer', texto, tokens }
    await reverter(cliente.id, ult.efeitos)
    await sb.from('mensagens').update({ desfeita: true }).eq('id', ult.id).eq('user_id', cliente.id)
    return { status: 'ok', resposta: `Pronto, desfiz: "${ult.texto.slice(0, 120)}"${await saldoDepois(cliente.id, null)}`, efeitos: {}, intencao: 'desfazer', texto, tokens }
  }
  if (it.intencao === 'corrigir') {
    const ult = await ultimaComEfeito(cliente.id)
    if (!ult) return { status: 'ok', resposta: 'Não achei o lançamento para corrigir. Me manda de novo do jeito certo?', efeitos: {}, intencao: 'corrigir', texto, tokens }
    const novo = `${ult.texto}\nCorreção: ${it.correcao ?? texto}`
    const it2 = await interpretar(novo, ctx)
    soma(it2.uso)
    if (it2.intencao !== 'acoes' || it2.perguntar || !it2.acoes.length) {
      return { status: 'pergunta', resposta: it2.perguntar ?? 'Não entendi a correção. Responda DESFAZER e me mande de novo do jeito certo.', efeitos: {}, intencao: 'corrigir', texto, tokens }
    }
    await reverter(cliente.id, ult.efeitos)
    await sb.from('mensagens').update({ desfeita: true }).eq('id', ult.id).eq('user_id', cliente.id)
    const r = await executar(cliente.id, await contextoDe(cliente.id, hoje), it2.acoes, tipo, anexo)
    return { status: 'ok', resposta: `Corrigido.\n\n${r.linhas.join('\n\n')}${await saldoDepois(cliente.id, it2.acoes)}\n\nErrou? Responda DESFAZER.`, efeitos: r.efeitos, intencao: 'corrigir', texto: novo, tokens }
  }
  if (it.intencao === 'pergunta') {
    // A IA entendeu que é pergunta; se o pedido é um dos conhecidos, o número sai do código, não da IA.
    const consulta = reconhecer(texto) ?? (it.pergunta ? reconhecer(it.pergunta) : null)
    if (consulta) return { status: 'ok', resposta: responderConsulta(consulta, await carregarBase(cliente.id), hoje), efeitos: {}, intencao: 'pergunta', texto, tokens }
    const p = await responderPergunta(cliente.id, hoje, it.pergunta ?? texto)
    soma(p.uso)
    return { status: 'ok', resposta: p.texto, efeitos: {}, intencao: 'pergunta', texto, tokens }
  }
  if (it.intencao === 'saudacao') return { status: 'ok', resposta: `Oi${nome ? `, ${nome}` : ''}! Me manda o que entrou ou saiu que eu anoto. Pode ser texto, áudio ou foto do comprovante.`, efeitos: {}, intencao: 'saudacao', texto, tokens }
  if (it.intencao === 'ajuda') return { status: 'ok', resposta: AJUDA, efeitos: {}, intencao: 'ajuda', texto, tokens }
  return { status: 'ok', resposta: `Eu cuido do dinheiro do seu negócio. Me conta o que entrou ou saiu, ou pergunte como estão as contas.\n\n${AJUDA}`, efeitos: {}, intencao: 'outro', texto, tokens }
}

/**
 * Importa as compras de uma fatura de cartão no cartão escolhido. A fatura vem do vencimento do documento
 * (ou, sem ele, do dia de fechamento do cartão). Pula compra que já está anotada (mesmo cartão, dia e valor).
 */
async function importarFatura(userId: string, ctx: Contexto, ts: Transacao[], cartaoId: string, vencimento: string | null, tipo: Origem, anexo: string | null, tokens: Uso): Promise<Conversa> {
  const cartao = ctx.carteiras.find((c) => c.id === cartaoId && c.tipo === 'cartao')
  if (!cartao) return { status: 'ok', resposta: 'Não achei esse cartão. Confira em Ajustes > Carteiras.', efeitos: {}, intencao: 'fatura', texto: 'importar fatura', tokens }
  const { data: ja, error } = await sb.from('lancamentos').select('data,valor').eq('user_id', userId).eq('tipo', 'compra_cartao').eq('carteira_id', cartaoId)
  falhou(error, 'fatura: duplicados')
  const existe = new Set((ja ?? []).map((l) => `${l.data}|${Number(l.valor).toFixed(2)}`))
  const acoes: Acao[] = []
  let pulou = 0
  for (const t of ts) {
    const data = t.data && /^\d{4}-\d{2}-\d{2}$/.test(t.data) && t.data <= ctx.hoje ? t.data : ctx.hoje
    if (existe.has(`${data}|${t.valor.toFixed(2)}`)) {
      pulou++
      continue
    }
    const base = conferir(t.valor.toFixed(2).replace('.', ','), ctx, {
      intencao: 'acoes', pergunta: null, correcao: null, falta: null,
      acoes: [{ tipo_acao: 'lancamento', movimento: 'saida', valor: t.valor, descricao: t.descricao, categoria_id: null, carteira_id: cartaoId, carteira_destino_id: null, meio: 'credito', data, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null, conta_id: null, talvez_pessoal: false }],
    }, { perguntarMeio: false })
    for (const a of base.acoes) acoes.push({ ...a, noCartao: true, fatura: vencimento ? vencimento.slice(0, 7) : faturaDe(data, cartao.fechamento ?? 1, cartao.vencimento ?? 10) })
  }
  if (!acoes.length) return { status: 'ok', resposta: `Todas as ${ts.length} compras dessa fatura já estavam anotadas.`, efeitos: {}, intencao: 'fatura', texto: 'importar fatura', tokens }
  const r = await executar(userId, ctx, acoes, tipo, anexo)
  const total = acoes.reduce((a, x) => a + (x.valor ?? 0), 0)
  return {
    status: 'ok',
    resposta: `Importei ${acoes.length} compras no ${cartao.nome}, somando ${brl(total)}${pulou ? ` (${pulou} já existiam e pulei)` : ''}. Elas entram nos gastos quando você pagar a fatura. Confira as categorias no painel.${await saldoDepois(userId, acoes)}\n\nErrou? Responda DESFAZER.`,
    efeitos: r.efeitos, intencao: 'fatura', texto: 'importar fatura', tokens,
  }
}

/** Importa as transações de um extrato depois do SIM. Pula as que já existem (mesmo dia, valor e direção). */
async function importar(userId: string, ctx: Contexto, ts: Transacao[], tipo: Origem, anexo: string | null, tokens: Uso, carteira?: string): Promise<Conversa> {
  const { data: ja, error } = await sb.from('lancamentos').select('data,valor,tipo').eq('user_id', userId).gte('data', ts.map((t) => t.data ?? ctx.hoje).sort()[0])
  falhou(error, 'extrato: duplicados')
  const existe = new Set((ja ?? []).map((l) => `${l.data}|${Number(l.valor).toFixed(2)}|${l.tipo}`))
  const padrao = carteira ?? ctx.carteiras.find((c) => c.tipo === 'banco' && c.padrao)?.id ?? ctx.carteiras.find((c) => c.tipo === 'banco')?.id ?? ctx.carteiras.find((c) => c.padrao)?.id ?? ctx.carteiras[0]?.id ?? ''
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
      acoes: [{ tipo_acao: 'lancamento', movimento: t.movimento, valor: t.valor, descricao: t.descricao, categoria_id: null, carteira_id: padrao, carteira_destino_id: null, meio: null, data, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null, conta_id: null, talvez_pessoal: false }],
    }, { perguntarMeio: false })
    acoes.push(...base.acoes)
  }
  if (!acoes.length) return { status: 'ok', resposta: `Todos os ${ts.length} lançamentos desse extrato já estavam anotados.`, efeitos: {}, intencao: 'extrato', texto: 'importar extrato', tokens }
  const r = await executar(userId, ctx, acoes, tipo, anexo)
  return {
    status: 'ok',
    resposta: `Importei ${acoes.length} lançamentos${pulou ? ` (${pulou} já existiam e pulei)` : ''}. Confira as categorias no painel.${await saldoDepois(userId, acoes)}\n\nErrou? Responda DESFAZER.`,
    efeitos: r.efeitos, intencao: 'extrato', texto: 'importar extrato', tokens,
  }
}

/** Tipos de ação que mexem no saldo de uma carteira. Conta a pagar, conta fixa e categoria nova não mexem. */
const MEXE_NO_SALDO = new Set(['lancamento', 'transferencia', 'pagar_fatura', 'baixar_conta'])

/**
 * Fecha a confirmação com o saldo REAL, calculado do banco depois de gravar: em qual carteira caiu e quanto há disponível.
 * Sem `acoes` (desfazer) mostra todas as contas. Se a consulta falhar, o lançamento já está salvo e a confirmação sai sem a linha:
 * saldo nunca derruba o registro.
 */
async function saldoDepois(userId: string, acoes: Acao[] | null): Promise<string> {
  try {
    const b = await carregarBase(userId)
    const ids = acoes
      ? acoes.filter((a) => MEXE_NO_SALDO.has(a.tipo_acao) || (a.tipo_acao === 'parcelado' && a.noCartao)).flatMap((a) => [a.carteira_id, a.carteira_destino_id])
      : b.carteiras.filter((c) => !foraDoDisponivel(c.tipo)).map((c) => c.id)
    const linhas = linhasDeSaldoDepois(b, ids)
    return linhas ? `\n\n${linhas}` : ''
  } catch (e) {
    console.error('[saldo] não consegui calcular o saldo depois de gravar:', (e as Error).message)
    return ''
  }
}
