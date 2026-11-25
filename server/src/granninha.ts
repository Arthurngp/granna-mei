/**
 * O fluxo de uma mensagem que chega no WhatsApp da Granninha.
 * Ordem: registra (sem duplicar) → reconhece o cliente pelo número verificado → confere acesso e uso →
 * transforma áudio, foto ou PDF em texto → entende → grava → responde.
 */
import { cruzarComprovante } from './cruzar.ts'
import { contextoIA } from './ia-config.ts'
import { temNumeroDeValor, valorConfere } from './numeros.ts'
import { acessoDe, cadastrosPendentesDoNumero, chaveDoNumero, clientePorNumero, contextoDe, falhou, formatarNumero, historicoRecente, sb, silenciarLembretes, usoDoMes } from './banco.ts'
import { ehAssuntoDaConta, ehPedidoDeAjuda, responderAjuda } from './ajuda.ts'
import { ehApagarTudo, respostaBaixa, valorSozinho } from './atalhos.ts'
import { despedidaDe, RESPOSTA_DESPEDIDA } from './despedida.ts'
import { AVISO_PERTO_DO_LIMITE, limiteDeMidias, limiteDoCliente, TEXTO_LIMITE_LANCAMENTOS, TEXTO_LIMITE_MIDIAS } from './limite.ts'
import { ehSair, TEXTO_SAIR } from './retencao.ts'
import { ErroIA, MARCA_RETOMAR, recadoDaFalhaIA, valeRetomarIA } from './ia-estado.ts'
import { avisoDeRetirada, categoriaDeNegocio, ehDoNegocio } from './retirada.ts'
import { faturaDe } from './cartao.ts'
import { executar, reverter, ultimaComEfeito, ultimaMensagem, type Efeitos, type Origem } from './executar.ts'
import { baixarMidia } from './gateway.ts'
import { BOLETO, conferir, interpretar, NEGOCIO, opcaoEscolhida, PESSOAL, type Acao, type Contexto, type Opcao } from './interpretar.ts'
import { lerDocumento, textoDoDocumento, type Transacao } from './midia.ts'
import { transcrever, type Uso } from './openai.ts'
import { responderPergunta } from './perguntas.ts'
import { carregarBase } from './base.ts'
import { antesEAgora, devePerguntar, JANELA_MIN, pareceMesmoLancamento, pareceReenvio, perguntaDuplicata, perguntaReenvio, respostaDuplicata, respostaSimNao, type LancAntigo } from './duplicata.ts'
import { brl as brlComSinal, contasQueFicaramNegativas, ehPerguntaClara, linhasDeSaldoDepois, reconhecer, responderConsulta, saldosDaBase } from './consultas.ts'
import { foraDoDisponivel } from './cartao.ts'
import { confirma, ERROU, MSG } from './voz.ts'
import { carteiraDoBanco, textoSaldoLido } from './print-banco.ts'
import { configAtiva, corrigirSaldoImportado, depoisDaMensagem, iniciar as iniciarConfig, responder as responderConfig, responderPrintSaldo, veioPeloWhats } from './config-whats-fluxo.ts'
import type { EstadoConfig } from './config-whats.ts'
import { comNova, depois as depoisDaFila, valorSoltoDuvidoso, type ItemFila } from './fila.ts'
import { baixaPronta, escolherGancho, fraseDeBaixa, janelaDoGancho, pendenteValido, respostaGancho, TEXTO_JA_BAIXADA, textoConfirmacao, textoNaoPagou, VALE_MS, type ContaGancho, type PendenteBaixa } from './gancho.ts'

const PAINEL = () => (process.env.PAINEL_URL ?? 'https://granninha.com.br/painel').replace(/\/+$/, '')

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
  /** Id da mensagem no WhatsApp, para o servidor registrar se a resposta não foi entregue. */
  msgId?: string
}

/**
 * Marcas no campo `erro` que dizem em que pé está a mensagem (sem precisar de coluna nova):
 * - NA_FILA: gravada pelo código NOVO e ainda não começou. É a única que pode ser reprocessada.
 * - PROCESSANDO: já começou. Nunca é reprocessada, porque pode ter gravado ou revertido algo.
 *
 * Linha 'recebida' SEM nenhuma dessas marcas é legado: foi gravada pelo código antigo, que começava
 * a processar logo depois do insert. No deploy deste próprio PR, o container velho morre no meio e
 * deixa linhas assim, possivelmente com o lançamento já gravado. Reprocessar seria o lançamento em
 * dobro que esta fase existe para matar, então essas só podem ser avisadas.
 */
export const NA_FILA = 'na fila'
export const PROCESSANDO = 'processando'

type Status = 'ok' | 'pergunta' | 'ignorada' | 'bloqueada' | 'erro' | 'limite'

export function hojeSP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Figurinha e reação (o 👍 numa resposta) não são tentativa de registrar nada: respondê-las com
 * "por aqui eu entendo texto, áudio..." faz a Granninha parecer boba e enche a conversa. Elas ficam
 * em silêncio, como "ok" e "beleza" (ver despedida.ts).
 *
 * Vídeo, contato, localização e documento que não é PDF continuam recebendo a mensagem de ajuda,
 * porque ali a pessoa quis mandar alguma coisa de verdade.
 */
function ehRuido(d: EventoGateway['data']): boolean {
  const t = (d.type ?? '').toUpperCase()
  return t.includes('STICKER') || t.includes('REACTION') || t.includes('REACT')
}

function tipoDaMensagem(d: EventoGateway['data']): Origem | 'outro' {
  const t = (d.type ?? '').toUpperCase()
  if (t === 'TEXT') return 'texto'
  if (t === 'AUDIO') return 'audio'
  if (t === 'IMAGE') return 'foto'
  if (t === 'DOCUMENT' && /\.pdf$/i.test(`${d.fileUrl ?? ''} ${d.content ?? ''}`.trim().split(' ')[0] || '') ) return 'pdf'
  if (t === 'DOCUMENT' && /pdf/i.test(`${d.fileUrl ?? ''}${d.content ?? ''}`)) return 'pdf'
  return 'outro'
}


/**
 * Os cortes que valem antes de gravar qualquer coisa: evento que não é mensagem recebida, mensagem
 * que a própria Granninha mandou, grupo, ou falta de id/número. Usado pelo registro e pelo processar.
 */
export function dadosDaChegada(ev: EventoGateway): { msgId: string; telefone: string; de: string; tipo: Origem | 'outro' } | null {
  if (ev.event !== 'message.received') return null
  const d = ev.data ?? {}
  if (d.key?.fromMe || d.isGroup || (d.chatType && d.chatType !== 'PERSONAL')) return null
  const msgId = d.key?.id
  const de = d.from || d.key?.remoteJid || ''
  const telefone = de.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (!msgId || !telefone || !chaveDoNumero(de)) return null
  return { msgId, telefone, de, tipo: tipoDaMensagem(d) }
}

/**
 * Quando descobrimos que a coluna `evento` não existe (banco sem a migration), paramos de tentar —
 * mas só por um tempo. Sem esse prazo, o processo que subiu antes da migration continuaria gravando
 * sem o evento até o próximo deploy, e a retomada de áudio e foto ficaria quebrada em silêncio mesmo
 * depois de a coluna existir. Aconteceu de verdade em 2026-11-19: a migration foi aplicada com o app
 * já rodando.
 */
const retentarColunaMs = () => Number(process.env.RETENTAR_COLUNA_MS ?? 600_000)
let colunaFaltouEm = 0
export const semColunaEvento = () => colunaFaltouEm > 0 && Date.now() - colunaFaltouEm < retentarColunaMs()
export const marcarColunaEventoFaltando = () => {
  colunaFaltouEm = Date.now()
}
/** Só para o teste: volta a tentar gravar a coluna `evento` agora. */
export function tentarColunaEvento() {
  colunaFaltouEm = 0
}

/**
 * Grava a chegada ANTES de o webhook responder 200. O gateway não reenvia: mensagem que só existe
 * na memória do processo desaparece sem rastro no deploy (que republica os 4 apps a cada merge).
 * Guarda o evento inteiro, porque sem o fileUrl não há como retomar áudio nem foto.
 */
export async function registrarChegada(ev: EventoGateway): Promise<'nova' | 'duplicada' | 'ignorar'> {
  const c = dadosDaChegada(ev)
  if (!c) return 'ignorar'
  const d = ev.data ?? {}
  const linha: Record<string, unknown> = {
    id: c.msgId, telefone: c.telefone, tipo: c.tipo === 'outro' ? 'outro' : c.tipo, texto: (d.content ?? d.caption ?? '').slice(0, 2000),
    // A marca é o que diz à varredura que esta linha é do código novo e ainda não começou.
    erro: NA_FILA,
  }
  for (let i = 0; i < 2; i++) {
    const semColuna = semColunaEvento()
    const ins = await sb.from('mensagens').insert(semColuna ? linha : { ...linha, evento: ev })
    if (!ins.error) return 'nova'
    if (ins.error.code === '23505') return 'duplicada'
    // Antes da migration do `evento` a coluna não existe: grava sem ela por um tempo (um insert por
    // mensagem), e volta a tentar depois, porque a migration pode rodar com o app já no ar.
    if (!semColuna && (ins.error.code === 'PGRST204' || ins.error.code === '42703')) {
      marcarColunaEventoFaltando()
      console.error('[mensagens] coluna `evento` não existe: retomada de áudio e foto fica de fora até a migration rodar')
      continue
    }
    falhou(ins.error, 'registrar mensagem')
  }
  return 'nova'
}

export async function processar(ev: EventoGateway, opts: { jaRegistrada?: boolean; retomada?: boolean } = {}): Promise<Saida> {
  const c = dadosDaChegada(ev)
  if (!c) return { status: 'ignorada' }
  const { msgId, telefone, de, tipo } = c
  const d = ev.data ?? {}

  // Quem chama pelo webhook já gravou a chegada antes de responder ao gateway.
  if (!opts.jaRegistrada && (await registrarChegada(ev)) === 'duplicada') return { status: 'duplicada' }

  // Trava de "começou": só um processo trabalha nesta mensagem, e o que já começou nunca é
  // reprocessado. DESFAZER e correção terminam com efeitos vazios, então "não gravou nada" não serve
  // de sinal — retomar um desfazer desfaria um segundo lançamento. Ver presas.ts.
  //
  // Na retomada por IA o ponto de partida é outro: a mensagem terminou com status 'erro' e a marca
  // de retomada. O claim é o mesmo mecanismo (só um processo ganha), sobre esse outro estado.
  const claim = opts.retomada
    ? await sb.from('mensagens').update({ erro: PROCESSANDO }).eq('id', msgId).eq('status', 'erro').like('erro', `${MARCA_RETOMAR}%`).select('id')
    : await sb.from('mensagens').update({ erro: PROCESSANDO }).eq('id', msgId).eq('status', 'recebida').eq('erro', NA_FILA).select('id')
  falhou(claim.error, 'marcar mensagem em processamento')
  if (!claim.data?.length) return { status: 'duplicada', msgId }

  const t0 = Date.now()
  let tokens: Uso = { entrada: 0, saida: 0, audio: 0 }

  let userId: string | null = null
  let status: Status = 'ok'
  let resposta = ''
  let efeitos: Efeitos = {}
  let intencao: string | null = null
  let textoFinal = d.content ?? ''
  let erro: string | null = null
  /** Preenchido pelo conversar() com o `atualizado_em` da pergunta em aberto que ele leu. */
  const consumo: { pendenteLida?: string | null; consumiu?: boolean; config?: EstadoConfig | null } = {}

  // Modo teste: com WA_SOMENTE_NUMEROS preenchido, só esses números conversam. O resto é ignorado em
  // silêncio (sem resposta, sem IA), mas a linha sai de "recebida" para a varredura não voltar nela.
  const liberados = (process.env.WA_SOMENTE_NUMEROS ?? '').split(',').map((n) => chaveDoNumero(n.trim())).filter(Boolean)
  const fora = liberados.length > 0 && !liberados.includes(chaveDoNumero(de))
  if (fora) {
    status = 'ignorada'
    erro = 'fora da lista de números liberados'
    textoFinal = ''
  }

  // Número fora da lista não passa por aqui: nada de banco, nada de IA.
  if (!fora) try {
    const cliente = await clientePorNumero(de)
    if (!cliente) {
      ;({ status, resposta, userId } = await numeroDesconhecido(telefone, de, d.content ?? ''))
    } else {
      userId = cliente.id
      const hoje = hojeSP()
      if (tipo === 'texto' && ehSair(d.content ?? '')) {
        // SAIR: a pessoa pediu para não receber lembretes. Vale antes de bloqueio, limite e IA: é um pedido que se honra sempre.
        // Se não conseguir gravar, lança (vira erro): nunca responder "pronto" sem ter gravado.
        await silenciarLembretes(cliente.id)
        status = 'pergunta'
        resposta = TEXTO_SAIR
      } else {
        // O limite de lançamentos é por cliente (próprio, ou o padrão de todos, definidos no admin): ver limite.ts.
        const [acesso, uso, { limite }] = await Promise.all([acessoDe(cliente.id, hoje), usoDoMes(cliente.id, hoje.slice(0, 8) + '01T00:00:00-03:00'), limiteDoCliente(cliente.id)])
        if (acesso.acesso === 'bloqueado') {
          status = 'bloqueada'
          resposta = `Seu acesso está pausado e por isso não consigo anotar agora. Seus dados estão guardados. Para voltar, é só regularizar em ${PAINEL()}/ajustes/assinatura`
        } else if (uso.lancamentos >= limite || (tipo !== 'texto' && tipo !== 'outro' && uso.midias >= limiteDeMidias())) {
          status = 'limite'
          resposta = uso.lancamentos >= limite ? TEXTO_LIMITE_LANCAMENTOS : TEXTO_LIMITE_MIDIAS
        } else if (tipo === 'outro' && ehRuido(d)) {
          status = 'ignorada'
        } else if (tipo === 'outro') {
          status = 'ignorada'
          resposta = 'Por aqui eu entendo texto, áudio, foto de comprovante e PDF. Me manda de um desses jeitos?'
        } else if (await codigoDeOutraConta(cliente.id, d.content ?? '')) {
          // Abriu outra conta e tentou confirmar com o mesmo número: o número já é desta conta, então
          // sem isto o código viraria uma conversa comum aqui e a conta nova ficaria esperando para sempre.
          status = 'ignorada'
          resposta = `Esse número já está confirmado nesta conta, então não dá para usá-lo em outra ao mesmo tempo. Se quiser levá-lo para a conta nova, troque o número aqui em ${PAINEL()}/ajustes (ou peça a exclusão desta conta) e confirme lá.`
        } else {
          // Configuração pela conversa em andamento (config-whats.ts): falhar ao ler nunca impede de atender a mensagem.
          try {
            consumo.config = await configAtiva(cliente.id)
          } catch (e) {
            console.error('[config] não li a configuração:', (e as Error).message.slice(0, 200))
          }
          // O contexto diz de qual cliente é cada chamada de IA: é assim que o modelo individual (aba Configurações) chega à chamada sem mexer em nenhuma assinatura.
          const r = await contextoIA.run({ userId: cliente.id }, () => conversar(cliente, hoje, tipo, d, msgId, telefone, consumo, opts.retomada === true))
          ;({ status, resposta, efeitos, intencao } = r)
          textoFinal = r.texto
          tokens = r.tokens
          // Aviso de 80% do limite, uma vez, junto da resposta.
          if (status === 'ok' && uso.lancamentos + 1 === Math.floor(limite * 0.8)) {
            resposta += `\n\n${AVISO_PERTO_DO_LIMITE}`
          }
        }
      }
    }
  } catch (e) {
    status = 'erro'
    erro = (e as Error).message.slice(0, 500)
    // Falha da IA tem causa conhecida (cota, limite, chave, instabilidade): o erro gravado diz qual,
    // para o admin não mostrar só "erro", e a resposta à cliente deixa claro que o problema é nosso.
    if (e instanceof ErroIA) {
      // A marca de retomada só entra em falha externa e temporária: a varredura reprocessa essa
      // mensagem quando a IA voltar, e a cliente não precisa mandar de novo.
      // A marca fica mesmo quando é uma retomada que falhou de novo: a mensagem continua esperando, e
      // quem limita a insistência é a janela de tempo (presas.ts), não a perda da marca.
      const marca = valeRetomarIA(e.tipo) ? MARCA_RETOMAR + ' ' : ''
      erro = `${marca}IA ${e.tipo}: ${e.message}`.slice(0, 500)
      resposta = recadoDaFalhaIA(e.tipo)
      console.error('[granninha] IA', e.tipo, msgId, e.message.slice(0, 200))
    } else {
      resposta = MSG.problemaAoAnotar
      console.error('[granninha]', msgId, erro)
    }
  }

  // A pergunta em aberto só sai agora, e só se deu certo: deu erro no meio (IA fora, transcrição),
  // ela continua lá para a resposta seguinte fazer sentido. O filtro por `atualizado_em` é o que
  // impede de apagar uma pergunta NOVA que o próprio processamento acabou de gravar.
  // Pedir ajuda no meio da pergunta não consome a pergunta: ela segue em aberto para a resposta que vem depois.
  // Fila de perguntas (fila.ts): se esta mensagem respondeu a pergunta, a próxima guardada volta junto da resposta; se ignorou, a pergunta volta
  // uma vez; o que passou do prazo sai, avisando o que ficou sem anotar. Mensagem sem resposta (silêncio) só limpa, como antes.
  let filaFalou = false
  if (consumo.pendenteLida && status !== 'erro' && intencao !== 'ajuda') {
    let novo: unknown = null
    let extra = ''
    if (resposta) {
      const cv = await sb.from('conversas').select('pendente, atualizado_em').eq('telefone', telefone).maybeSingle()
      if (cv.error) console.error('[granninha] ler fila de perguntas', cv.error.message)
      else if (cv.data && cv.data.atualizado_em === consumo.pendenteLida) {
        const d = depoisDaFila(cv.data.pendente, !!consumo.consumiu, Date.now(), cv.data.atualizado_em as string)
        novo = d.pendente
        extra = d.texto
      }
    }
    const lim = await sb.from('conversas').update({ pendente: novo, atualizado_em: new Date().toISOString() }).eq('telefone', telefone).eq('atualizado_em', consumo.pendenteLida).select('telefone')
    if (lim.error) console.error('[granninha] limpar pergunta em aberto', lim.error.message)
    // Só diz que ficou algo esperando se a fila foi mesmo gravada (ninguém escreveu por cima no meio).
    else if (extra && lim.data?.length) {
      resposta = `${resposta}\n\n${extra}`
      filaFalou = true
    }
  }

  // Configuração pela conversa: a mensagem não era resposta dela (era um gasto, uma pergunta). Atendida a mensagem, a pergunta da configuração
  // volta no fim, a não ser que a mensagem tenha deixado pergunta própria ou que a fila de perguntas tenha falado: uma pergunta por vez.
  if (consumo.config && userId && intencao !== 'config' && status === 'ok' && resposta && !filaFalou) {
    try {
      const mais = await depoisDaMensagem(userId, consumo.config, (efeitos.fixas?.length ?? 0) > 0)
      if (mais) resposta = `${resposta}\n\n${mais}`
    } catch (e) {
      console.error('[config] não consegui seguir a configuração:', (e as Error).message.slice(0, 200))
    }
  }

  const up = await sb.from('mensagens').update({
    user_id: userId, intencao, status, resposta, efeitos, erro, texto: textoFinal.slice(0, 2000), ms: Date.now() - t0,
    tokens: tokens.entrada + tokens.saida, tokens_entrada: tokens.entrada, tokens_saida: tokens.saida, audio_tokens: tokens.audio || null, audio_seg: tokens.audioSeg ?? null,
  }).eq('id', msgId)
  if (up.error) console.error('[granninha] atualizar mensagem', up.error.message)
  return { status, para: telefone, resposta, msgId }
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
  // SAIR de quem digitou este número no cadastro e não confirmou: o admin pode ter chamado essa pessoa, e a mensagem diz "responda SAIR". Sem isto o
  // pedido cairia no silêncio de quem não é cliente e ela seguiria recebendo. Se não conseguir gravar, lança: nunca responder "pronto" sem ter gravado.
  if (ehSair(texto)) {
    const pend = await cadastrosPendentesDoNumero(jid)
    if (!pend.length) return mudo
    for (const p of pend) await silenciarLembretes(p.id)
    return { status: 'ignorada', resposta: MSG.sairSemConfirmar, userId: null }
  }
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
      const up = await sb.from('perfis').update({ whats: formatarNumero(jid), whats_verificado: true }).eq('id', v.user_id).select('nome, ocultar').single()
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
        resposta: await boasVindasDoNumero(telefone, v.user_id as string, nome, !!(up.data as { ocultar?: boolean } | null)?.ocultar),
        userId: v.user_id,
      }
    }
    // Código errado ou vencido: quem está tentando confirmar precisa saber disso, senão fica
    // esperando para sempre achando que a Granninha não funciona. Vale mesmo com o convite desligado.
    await marcarTentativa(telefone, tent)
    return { status: 'ignorada', resposta: `Esse código não confere ou já venceu. Gere um novo no painel em ${PAINEL()} e me mande de novo.`, userId: null }
  }
  // Quem escreve de um número que alguém digitou num cadastro ainda sem confirmar não é "externo": é quem ficou pelo caminho. Em vez de silêncio,
  // mostra como terminar, no máximo uma vez por dia e sem gastar IA. Só responde a quem escreveu. Quem pediu SAIR segue no silêncio.
  const pendentes = (await cadastrosPendentesDoNumero(jid)).filter((p) => !p.avisos_off)
  if (pendentes.length) {
    const t = await tentativasDe(telefone)
    if (t.link_em && Date.now() - new Date(t.link_em).getTime() < 86400_000) return mudo
    const quando = new Date().toISOString()
    await sb.from('conversas').upsert({
      telefone,
      pendente: { link_em: quando, ...(t.n ? { codigo_tentativas: t.n, codigo_desde: t.desde } : {}) },
      atualizado_em: quando,
    })
    return { status: 'ignorada', resposta: MSG.terminarCadastro((pendentes[0].nome ?? '').split(' ')[0], PAINEL()), userId: null }
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

/**
 * A resposta à confirmação do número. Se a pessoa cadastrou contas no onboarding, fala de uma delas em vez do exemplo genérico; se a conta
 * vence por agora, pergunta "já pagou?" e deixa a pergunta em aberto, para um SIM dar baixa. Qualquer falha aqui cai na mensagem de sempre:
 * a confirmação do número já aconteceu e nunca depende disto. E a pergunta só sai se ficou gravada: perguntar sem poder ouvir a resposta
 * seria pior que não perguntar.
 */
/**
 * A resposta ao código que confirma o número. Quem veio pelo cadastro novo (só o WhatsApp no site) começa a configuração pela conversa; o resto
 * recebe a confirmação com o gancho da conta. Se a configuração falhar ao começar, cai na confirmação de sempre: o número já está confirmado.
 */
async function boasVindasDoNumero(telefone: string, userId: string, nome: string, ocultar: boolean): Promise<string> {
  try {
    if (await veioPeloWhats(userId)) return await iniciarConfig(userId, nome)
  } catch (e) {
    console.error('[config] não comecei a configuração:', (e as Error).message.slice(0, 200))
  }
  return confirmacaoComGancho(telefone, userId, nome, ocultar)
}

async function confirmacaoComGancho(telefone: string, userId: string, nome: string, ocultar: boolean): Promise<string> {
  try {
    const hoje = hojeSP()
    const jan = janelaDoGancho(hoje)
    const cs = await sb.from('contas').select('id, descricao, valor, vencimento').eq('user_id', userId).eq('tipo', 'pagar').eq('status', 'aberta').gte('vencimento', jan.de).lte('vencimento', jan.ate).order('vencimento').limit(50)
    if (cs.error) throw new Error(cs.error.message)
    const contas = ((cs.data ?? []) as { id: string; descricao: string; valor: number | string; vencimento: string }[]).map((c): ContaGancho => ({ id: c.id, descricao: c.descricao, valor: Number(c.valor), vencimento: c.vencimento }))
    const g = escolherGancho(contas, hoje)
    if (!g) return MSG.numeroConfirmado(nome)
    if (g.modo === 'pagou') {
      const pendente: PendenteBaixa = { tipo: 'baixa_conta', conta: g.conta, de: 'confirmacao' }
      const gr = await sb.from('conversas').upsert({ telefone, user_id: userId, pendente, atualizado_em: new Date().toISOString() })
      if (gr.error) throw new Error(gr.error.message)
    }
    return textoConfirmacao(nome, g, ocultar, hoje)
  } catch (e) {
    console.error('[gancho] confirmação sem gancho:', (e as Error).message.slice(0, 200))
    return MSG.numeroConfirmado(nome)
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

async function conversar(cliente: { id: string; nome: string; negocio?: string }, hoje: string, tipo: Origem, d: EventoGateway['data'], msgId: string, telefone: string, saida: { pendenteLida?: string | null; consumiu?: boolean; config?: EstadoConfig | null } = {}, retomada = false): Promise<Conversa> {
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
  /** Conta do cliente que o comprovante revela (banco de origem ou de destino cruzado com as carteiras dele): evita perguntar "de qual conta?". */
  let carteiraDoComprovante: string | undefined
  const nome = cliente.nome.split(' ')[0]

  // Pergunta em aberto (ex.: "qual foi o valor?") ou importação de extrato esperando um sim.
  const { data: conv } = await sb.from('conversas').select('pendente,atualizado_em').eq('telefone', telefone).maybeSingle()
  const pend = conv?.pendente as { tipo?: string; texto?: string; pergunta?: string; transacoes?: Transacao[]; opcoes?: Opcao[]; anexo?: string; forcar?: { carteira?: string; pessoal?: boolean }; documento?: { valor: number; movimento: 'entrada' | 'saida' }; origem?: Origem; acoes?: Acao[]; anteriorMsg?: string } | null
  const fresco = conv && Date.now() - new Date(conv.atualizado_em).getTime() < 30 * 60_000
  // A pergunta em aberto NÃO é apagada aqui. Antes era, e se a transcrição ou a IA falhassem no meio
  // a pergunta sumia: o "2" seguinte chegava sem contexto. Quem apaga é o processar(), só quando
  // deu certo, e só se nada novo tiver sido gravado por cima (`pendenteLida` guarda o atualizado_em).
  saida.pendenteLida = pend?.tipo ? (conv!.atualizado_em as string) : null
  /** Grava uma pergunta NOVA em aberto. A anterior, se ainda valia e não foi respondida por esta mensagem, vai para a fila (fila.ts). */
  const guardar = async (nova: Record<string, unknown>) => {
    const agora = Date.now()
    const pendente = comNova(nova as ItemFila, fresco ? conv?.pendente : null, !!saida.consumiu, agora, (conv?.atualizado_em as string | undefined) ?? null)
    const g = await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente, atualizado_em: new Date(agora).toISOString() })
    if (g.error) console.error('[granninha] guardar pergunta', g.error.message)
  }
  /** Esta mensagem é a resposta da pergunta em aberto: marca, para a fila andar. */
  const respondeu = <T>(x: T): T => ((saida.consumiu = true), x)

  if (tipo === 'audio') {
    const m = await baixarMidia(d.fileUrl ?? '')
    const tr = await transcrever(m.buffer, m.mime)
    texto = tr.texto
    soma(tr.uso)
    // Transcrição vazia (áudio mudo, ruído, gravação de meio segundo): dizer isso, em vez de mandar
    // a lista de exemplos como se a pessoa tivesse escrito algo que não dá para entender.
    if (!texto.replace(/[\s.,!?-]/g, '')) {
      return { status: 'ok', resposta: 'Não consegui entender o áudio. Pode mandar de novo, falando um pouco mais perto?', efeitos: {}, intencao: 'audio_vazio', texto: '', tokens }
    }
  } else if (tipo === 'foto' || tipo === 'pdf') {
    const m = await baixarMidia(d.fileUrl ?? '')
    const ext = tipo === 'pdf' ? 'pdf' : m.mime.includes('png') ? 'png' : 'jpg'
    anexo = `${cliente.id}/${msgId.replace(/[^A-Za-z0-9_-]/g, '')}.${ext}`
    const upl = await sb.storage.from('comprovantes').upload(anexo, m.buffer, { contentType: tipo === 'pdf' ? 'application/pdf' : m.mime, upsert: true })
    falhou(upl.error, 'guardar comprovante')
    const { leitura, uso } = await lerDocumento(m.buffer, tipo === 'pdf' ? 'application/pdf' : m.mime, d.caption ?? '')
    soma(uso)
    // Print da tela de saldo do banco: nunca vira lançamento. Compara com o que está anotado e, se não bate, sugere o extrato (print-banco.ts).
    if (leitura.tipo === 'saldo') {
      // Na configuração (etapas de banco e saldo), o print põe o banco e o saldo de uma vez.
      if (saida.config) {
        const rp = await responderPrintSaldo(cliente.id, saida.config, leitura.banco, leitura.saldo)
        if (rp) return { status: 'ok', resposta: rp.resposta, efeitos: {}, intencao: 'config', texto: leitura.resumo, tokens }
      }
      const cx = await contextoDe(cliente.id, hoje)
      const cart = carteiraDoBanco(leitura.banco, cx.carteiras)
      const anotado = cart ? (saldosDaBase(await carregarBase(cliente.id))[cart.id] ?? null) : null
      return { status: 'ok', resposta: textoSaldoLido(leitura.banco, leitura.saldo, cart, anotado), efeitos: {}, intencao: 'saldo', texto: leitura.resumo, tokens }
    }
    if (!leitura.transacoes.length) {
      return { status: 'pergunta', resposta: MSG.semValorNoArquivo(tipo === 'pdf' ? 'pdf' : 'foto', leitura.tipo === 'outro'), efeitos: {}, intencao: 'documento', texto: leitura.resumo, tokens }
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
      const perguntaFatura = `Achei ${leitura.transacoes.length} compras nessa fatura, somando ${brl(total)}${venc ? ` (vence ${venc.split('-').reverse().slice(0, 2).join('/')})` : ''}.\n\n${opcoes.length === 1 ? `Quer que eu importe no ${opcoes[0].nome}? Responda SIM ou NÃO.` : `Quer que eu importe? Responda com o número do cartão, ou NÃO:\n${opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}`}`
      await guardar({ tipo: 'importar_fatura', transacoes: leitura.transacoes, anexo, opcoes, vencimento: venc, pergunta: perguntaFatura })
      return { status: 'pergunta', resposta: perguntaFatura, efeitos: {}, intencao: 'fatura', texto: leitura.resumo, tokens }
    }
    if (leitura.tipo === 'extrato' && leitura.transacoes.length > 1) {
      const ent = leitura.transacoes.filter((t) => t.movimento === 'entrada').reduce((a, t) => a + t.valor, 0)
      const sai = leitura.transacoes.filter((t) => t.movimento === 'saida').reduce((a, t) => a + t.valor, 0)
      const bancos = (await contextoDe(cliente.id, hoje)).carteiras.filter((c) => c.tipo === 'banco')
      // O extrato diz de que banco é e ele bate com UMA conta da pessoa: é dessa, sem perguntar qual.
      const doBanco = carteiraDoBanco(leitura.banco, bancos)
      const opcoes = !doBanco && bancos.length > 1 ? bancos.map((c) => ({ id: c.id, nome: c.nome })) : undefined
      const perguntaExtrato = `Achei ${leitura.transacoes.length} lançamentos nesse extrato${doBanco ? ` do ${doBanco.nome}` : ''}: ${brl(ent)} de entradas e ${brl(sai)} de saídas.\n\n` + (opcoes
          ? `Quer que eu importe? Responda com o número da conta deste extrato, ou NÃO:\n${opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}`
          : doBanco ? `Quer que eu importe no ${doBanco.nome}? Responda SIM ou NÃO.` : 'Quer que eu importe? Responda SIM ou NÃO.')
      await guardar({ tipo: 'importar', transacoes: leitura.transacoes, anexo, opcoes, carteira: doBanco?.id, pergunta: perguntaExtrato })
      return { status: 'pergunta', resposta: perguntaExtrato, efeitos: {}, intencao: 'extrato', texto: leitura.resumo, tokens }
    }
    // Comprovante: cruza o banco de origem e o de destino com as contas do cliente. Entre duas contas dele é transferência (não é entrada nem saída);
    // só a origem dele é saída dessa conta; só o destino dele é entrada nessa conta. Sem reconhecer nenhuma, segue como antes.
    if (leitura.tipo === 'comprovante') {
      const cx = await contextoDe(cliente.id, hoje)
      const cruz = cruzarComprovante(leitura, cx.carteiras, [cliente.nome, cliente.negocio])
      if (cruz?.tipo === 'transferencia') {
        const t = leitura.transacoes[0]
        const data = t.data && /^\d{4}-\d{2}-\d{2}$/.test(t.data) && t.data <= hoje ? t.data : hoje
        const acao: Acao = {
          tipo_acao: 'transferencia', movimento: null, valor: t.valor, descricao: `Transferência ${cruz.de.nome} para ${cruz.para.nome}`, categoria_id: null,
          carteira_id: cruz.de.id, carteira_destino_id: cruz.para.id, meio: null, data, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null,
          conta_id: null, talvez_pessoal: false, fatura: null, noCartao: false,
        }
        const r = await executar(cliente.id, cx, [acao], tipo, anexo)
        return {
          status: 'ok',
          resposta: `${r.linhas.join('\n\n')}\nNão conta como entrada nem saída: o dinheiro só mudou de conta.${await saldoDepois(cliente.id, [acao])}\n\n${ERROU}`,
          efeitos: r.efeitos, intencao: 'acoes', texto: leitura.resumo, tokens,
        }
      }
      if (cruz) {
        leitura.transacoes[0].movimento = cruz.tipo
        carteiraDoComprovante = cruz.carteira.id
      }
    }
    texto = textoDoDocumento(leitura, d.caption ?? '')
    documento = { valor: leitura.transacoes[0].valor, movimento: leitura.transacoes[0].movimento }
  }

  // Resposta ao "já pagou?" da confirmação do número ou do aviso de vencimento (gancho.ts). Vale 24 h, mais que as outras perguntas: o aviso
  // sai de manhã e a resposta vem à noite. NÃO deixa a conta aberta; SIM dá baixa mais abaixo, por código; outra coisa segue o fluxo normal.
  let baixaDoGancho: PendenteBaixa | null = null
  let carteiraDoGancho: string | undefined
  if (!documento && !anexo && pendenteValido(conv?.pendente)) {
    const pg = conv!.pendente as PendenteBaixa
    if (pg.opcoes?.length) {
      // Segundo passo: ela já disse SIM e a pergunta agora é "saiu de qual conta?". Vale a meia hora de qualquer pergunta com opções.
      // Só a resposta curta conta ("2", "Nubank", "no nubank"). Frase com valor ou comprida ("paguei 50 de gasolina no nubank") é outro assunto,
      // mesmo citando o nome de uma das contas: tratá-la como escolha daria baixa na conta da pergunta por engano.
      const curta = /^\s*\d{1,2}\s*$/.test(texto) || (!/\d/.test(texto) && texto.trim().split(/\s+/).length <= 4)
      const esc = fresco && curta ? opcaoEscolhida(texto, pg.opcoes) : null
      if (esc) {
        saida.consumiu = true
        baixaDoGancho = pg
        carteiraDoGancho = esc.id
      } else if (fresco && /^\s*\d{1,2}\s*$/.test(texto)) {
        saida.consumiu = true
        await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: pg, atualizado_em: new Date().toISOString() })
        return { status: 'pergunta', resposta: `Não achei essa opção. ${pg.pergunta ?? ''}`.trim(), efeitos: {}, intencao: 'acoes', texto, tokens }
      }
    } else if (Date.now() - new Date(conv!.atualizado_em).getTime() < VALE_MS) {
      const rg = respostaGancho(texto)
      if (rg) saida.consumiu = true
      if (rg === 'nao') return { status: 'ok', resposta: textoNaoPagou(pg.conta), efeitos: {}, intencao: 'gancho', texto, tokens }
      if (rg === 'sim') baixaDoGancho = pg
    }
  }

  // Resposta à pergunta da configuração pela conversa (config-whats.ts). Só quando não há pergunta própria em aberto: ela vem primeiro.
  if (saida.config && !documento && !anexo && !(pend?.tipo && fresco) && !baixaDoGancho) {
    const rc = await responderConfig(cliente.id, saida.config, texto)
    if (rc.tratou) return { status: 'ok', resposta: rc.resposta, efeitos: {}, intencao: 'config', texto, tokens }
  }

  // Despedida, agradecimento e "ok" ("tá bom, volto mais tarde"): não é cumprimento nem pedido. Responde curto ou fica em
  // silêncio, sem recomeçar com "Oi, me manda o que entrou", e sem gastar IA. Com pergunta em aberto não entra: a resposta é dela.
  if (!documento && !anexo && !(pend?.tipo && fresco) && !baixaDoGancho) {
    const dp = despedidaDe(texto)
    if (dp === 'silencio') return { status: 'ignorada', resposta: '', efeitos: {}, intencao: 'confirmacao', texto, tokens }
    if (dp) return { status: 'ok', resposta: RESPOSTA_DESPEDIDA[dp], efeitos: {}, intencao: 'despedida', texto, tokens }
  }

  const ctx = await contextoDe(cliente.id, hoje)
  // As últimas trocas ajudam a entender "esse", "aquele", "de novo". Falhar aqui nunca impede de anotar.
  try {
    ctx.historico = await historicoRecente(cliente.id, msgId)
  } catch (e) {
    console.error('[historico] não consegui ler a conversa recente:', (e as Error).message)
  }

  // SIM ao "já pagou?": a baixa é montada aqui e passa pela MESMA conferência de qualquer baixa (qual conta do banco, conta de mesmo nome em outro
  // mês), só que sem IA: a conta já é conhecida. Se a conferência perguntar de onde saiu (quem tem banco e cartão sempre cai aqui), a pergunta
  // fica em aberto como segundo passo do gancho e a resposta também fecha por código.
  if (baixaDoGancho) {
    const pedida = baixaDoGancho.conta
    const alvo = ctx.contasAbertas.find((c) => c.id === pedida.id && c.tipo === 'pagar')
    if (!alvo) return { status: 'ok', resposta: TEXTO_JA_BAIXADA, efeitos: {}, intencao: 'gancho', texto, tokens }
    const frase = fraseDeBaixa({ ...pedida, descricao: alvo.descricao, vencimento: alvo.vencimento })
    const conf = conferir(frase, ctx, baixaPronta({ ...pedida, descricao: alvo.descricao }), carteiraDoGancho ? { forcarCarteira: carteiraDoGancho } : {})
    if (conf.perguntar) {
      const segundoPasso: PendenteBaixa = { tipo: 'baixa_conta', conta: pedida, de: baixaDoGancho.de, opcoes: conf.opcoes, pergunta: conf.perguntar }
      const pendente = conf.opcoes?.length && !carteiraDoGancho
        ? segundoPasso
        : { tipo: 'pergunta', texto: frase, pergunta: conf.perguntar, opcoes: conf.opcoes, forcar: carteiraDoGancho ? { carteira: carteiraDoGancho } : {}, origem: tipo }
      await guardar(pendente as unknown as Record<string, unknown>)
      return { status: 'pergunta', resposta: conf.perguntar, efeitos: {}, intencao: 'acoes', texto: frase, tokens }
    }
    const ex = await executar(cliente.id, ctx, conf.acoes, tipo, null)
    return { status: 'ok', resposta: `${ex.linhas.join('\n\n')}${await saldoDepois(cliente.id, conf.acoes)}\n\n${ERROU}`, efeitos: ex.efeitos, intencao: 'acoes', texto: frase, tokens }
  }

  // Resposta à pergunta "esse é o mesmo lançamento?": 1 corrige o anterior, 2 lança como outro. Outra mensagem qualquer
  // deixa a pergunta de lado (nada foi gravado) e vale sozinha.
  // Valor diferente do da conta em aberto: 1 dá baixa na conta (pagando o valor dito), 2 anota à parte e deixa a conta aberta.
  // Outra coisa que não 1 ou 2 deixa a pergunta de lado (nada foi gravado) e a mensagem vale sozinha.
  if (pend?.tipo === 'baixa_diferente' && fresco && pend.acoes?.length) {
    const r = respostaBaixa(texto)
    if (r) {
      saida.consumiu = true
      const final = pend.acoes.map((a): Acao => {
        if (!a.baixaDiferente) return a
        const { baixaDiferente: _b, ...resto } = a
        return r === 'baixa' ? resto : { ...resto, tipo_acao: 'lancamento', conta_id: null }
      })
      const ex = await executar(cliente.id, ctx, final, pend.origem ?? tipo, pend.anexo ?? null)
      return { status: 'ok', resposta: `${ex.linhas.join('\n\n')}${await saldoDepois(cliente.id, final)}\n\n${ERROU}`, efeitos: ex.efeitos, intencao: 'acoes', texto, tokens }
    }
  }
  if (pend?.tipo === 'duplicata' && fresco && pend.acoes?.length) {
    const r = respostaDuplicata(texto)
    if (r) return respondeu(await resolverDuplicata(cliente.id, ctx, pend.acoes, pend.anteriorMsg ?? '', r, pend.origem ?? tipo, pend.anexo ?? null, texto, tokens))
  }

  // "NEGÓCIO" sozinho conserta a última retirada. A Granninha avisou na confirmação que tinha anotado
  // como gasto seu; isto é a correção de um toque, sem precisar desfazer e lançar de novo. Como a
  // lembrança sai do próprio histórico, da próxima vez ela já acerta sem perguntar.
  if (ehDoNegocio(texto)) {
    const ult = await ultimaComEfeito(cliente.id)
    const ids = ult?.efeitos.lancamentos ?? []
    if (ids.length) {
      const lancs = await lancsDe(cliente.id, ids)
      const pessoais = lancs.filter((l) => l.pessoal)
      if (pessoais.length) {
        for (const l of pessoais) {
          const up = await sb.from('lancamentos').update({ pessoal: false, categoria_id: categoriaDeNegocio(ctx, l.categoria_id) }).eq('user_id', cliente.id).eq('id', l.id)
          falhou(up.error, 'mudar retirada para gasto do negócio')
        }
        const quais = pessoais.map((l) => l.descricao).filter(Boolean).join(', ')
        return {
          status: 'ok',
          resposta: `Pronto, mudei${quais ? ` "${quais}"` : ''} para gasto do negócio. Da próxima vez eu já anoto assim.${await saldoDepois(cliente.id, null)}`,
          efeitos: {}, intencao: 'virar_negocio', texto, tokens,
        }
      }
    }
  }

  // Resposta à pergunta "quer desfazer o anterior também?" depois de dois DESFAZER seguidos.
  if (pend?.tipo === 'desfazer_mais' && fresco && pend.anteriorMsg) {
    const r = respostaSimNao(texto)
    if (r) saida.consumiu = true
    if (r === 'nao') return { status: 'ok', resposta: 'Beleza, parei aí. Nada mais foi desfeito.', efeitos: {}, intencao: 'desfazer', texto, tokens }
    if (r === 'sim') {
      const alvo = await ultimaComEfeito(cliente.id)
      // Só desfaz se continua sendo aquele mesmo: se algo entrou no meio, não mexe em nada.
      if (!alvo || alvo.id !== pend.anteriorMsg) {
        return { status: 'ok', resposta: 'Esse lançamento já não é mais o último, então não mexi em nada. Se quiser, me diz qual apagar.', efeitos: {}, intencao: 'desfazer', texto, tokens }
      }
      await reverter(cliente.id, alvo.efeitos)
      await sb.from('mensagens').update({ desfeita: true }).eq('id', alvo.id).eq('user_id', cliente.id)
      return { status: 'ok', resposta: `Pronto, desfiz também: "${alvo.texto.slice(0, 120)}"${await saldoDepois(cliente.id, null)}`, efeitos: {}, intencao: 'desfazer', texto, tokens }
    }
  }

  // Resposta à pergunta de reenvio ("já anotei isso há 2 minutos, é o mesmo?"): 1 não grava nada,
  // 2 grava como lançamento novo. Nada foi gravado antes, então "1" é só deixar como está.
  if (pend?.tipo === 'reenvio' && fresco && pend.acoes?.length) {
    const r = respostaDuplicata(texto)
    if (r) saida.consumiu = true
    if (r === 'corrigir') {
      return { status: 'ok', resposta: 'Então deixei só o de antes, sem anotar de novo.', efeitos: {}, intencao: 'acoes', texto, tokens }
    }
    if (r === 'novo') {
      const ex = await executar(cliente.id, ctx, pend.acoes, pend.origem ?? tipo, pend.anexo ?? null)
      return { status: 'ok', resposta: `${ex.linhas.join('\n\n')}${await saldoDepois(cliente.id, pend.acoes)}\n\n${ERROU}`, efeitos: ex.efeitos, intencao: 'acoes', texto, tokens }
    }
  }

  if (pend?.tipo === 'importar_fatura' && fresco) {
    if (/^\s*(n[ãa]o|nao|n|sim|s|pode|importa|ok|isso|manda|\d+)\b/i.test(texto) || opcaoEscolhida(texto, pend.opcoes ?? [])) saida.consumiu = true
    if (/^\s*(n[ãa]o|nao|n)\b/i.test(texto)) return { status: 'ok', resposta: 'Tudo bem, não importei a fatura.', efeitos: {}, intencao: 'fatura', texto, tokens }
    const esc = opcaoEscolhida(texto, pend.opcoes ?? [])
    if (esc) return importarFatura(cliente.id, ctx, pend.transacoes ?? [], esc.id, (pend as { vencimento?: string | null }).vencimento ?? null, tipo, pend.anexo ?? null, tokens)
    // Um cartão só: o "sim" já escolhe esse cartão. Perguntar "em qual cartão?" de novo era a mesma pergunta duas vezes.
    if (pend.opcoes?.length === 1 && /^\s*(sim|s|pode|importa|ok|isso|manda)\b/i.test(texto)) {
      return importarFatura(cliente.id, ctx, pend.transacoes ?? [], pend.opcoes[0].id, (pend as { vencimento?: string | null }).vencimento ?? null, tipo, pend.anexo ?? null, tokens)
    }
    if (/^\s*(sim|s|pode|importa|ok|isso|manda|\d+)\b/i.test(texto)) {
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: pend, atualizado_em: new Date().toISOString() })
      return { status: 'pergunta', resposta: `Em qual cartão? Responda com o número:\n${(pend.opcoes ?? []).map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}`, efeitos: {}, intencao: 'fatura', texto, tokens }
    }
  }
  if (pend?.tipo === 'importar' && fresco) {
    if (/^\s*(n[ãa]o|nao|n|sim|s|pode|importa|ok|isso|manda|\d+)\b/i.test(texto) || (pend.opcoes?.length && opcaoEscolhida(texto, pend.opcoes))) saida.consumiu = true
    if (/^\s*(n[ãa]o|nao|n)\b/i.test(texto)) return { status: 'ok', resposta: 'Tudo bem, não importei nada.', efeitos: {}, intencao: 'extrato', texto, tokens }
    if (pend.opcoes?.length) {
      const esc = opcaoEscolhida(texto, pend.opcoes)
      if (esc) return importar(cliente.id, ctx, pend.transacoes ?? [], tipo, pend.anexo ?? null, tokens, esc.id, saida.config)
      if (/^\s*(sim|s|pode|importa|ok|isso|manda|\d+)\b/i.test(texto)) {
        await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: pend, atualizado_em: new Date().toISOString() })
        return { status: 'pergunta', resposta: `De qual conta é esse extrato? Responda com o número:\n${pend.opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}`, efeitos: {}, intencao: 'extrato', texto, tokens }
      }
    } else if (/^\s*(sim|s|pode|importa|ok|isso|manda)\b/i.test(texto)) return importar(cliente.id, ctx, pend.transacoes ?? [], tipo, pend.anexo ?? null, tokens, (pend as { carteira?: string }).carteira, saida.config)
  }
  // Resposta a uma pergunta com opções: o número (ou o nome) decide no código, sem depender da IA.
  // As respostas se acumulam (ex.: "do negócio" e depois "Nubank") até o lançamento fechar.
  // Se a pergunta tinha opções e a pessoa mandou outra coisa (outro lançamento, uma pergunta), a pergunta antiga
  // é deixada de lado e a mensagem nova vale sozinha: nada de repetir a mesma pergunta para sempre.
  // Quem pede ajuda no meio de uma pergunta ("qual foi o valor?") recebe a ajuda: o texto NÃO vira resposta da pergunta,
  // e a pergunta continua em aberto para quando ela responder.
  const pediuAjuda = !documento && !anexo && (ehPedidoDeAjuda(texto) || ehAssuntoDaConta(texto))
  const escolha = pend?.tipo === 'pergunta' && fresco && pend.opcoes?.length ? opcaoEscolhida(texto, pend.opcoes) : null
  // Pergunta aberta sobre um COMPROVANTE ("Li R$ 192,05. O que foi?") e a pessoa manda outra coisa com valor próprio (325,77, 209,85): é um registro novo, não a
  // resposta. Sem isto o comprovante antigo era herdado por toda mensagem seguinte, o valor nunca batia e a Granninha repetia a mesma pergunta para sempre.
  // Escolher uma opção ("1", "2") da pergunta sobre um comprovante não é outro valor: antes o "1" de "Gás de R$ 50,23: do negócio ou da casa?"
  // contava como registro novo, e a pergunta nunca fechava (achado em 24/11 pelo teste da fila).
  const opcaoDeNumero = !!pend?.opcoes?.length && /^\s*\d{1,2}\s*$/.test(texto)
  const outroValor = !!pend?.documento && !documento && !escolha && !opcaoDeNumero && temNumeroDeValor(texto) && !valorConfere(texto, pend.documento.valor, null)
  // Foto ou PDF novo nunca é a resposta da pergunta em aberto: é outro registro (rajada de comprovantes). A pergunta vai para a fila.
  const continua = !pediuAjuda && !outroValor && !anexo && pend?.tipo === 'pergunta' && fresco && !!pend.texto && (!pend.opcoes?.length || !!escolha || /^\s*\d{1,2}\s*$/.test(texto))
  if (continua) saida.consumiu = true
  const forcar: { carteira?: string; pessoal?: boolean } = continua ? { ...(pend!.forcar ?? {}) } : {}
  if (continua && pend!.documento && !documento) documento = pend!.documento
  if (carteiraDoComprovante && !forcar.carteira) forcar.carteira = carteiraDoComprovante
  // O lançamento guarda de onde veio a primeira mensagem (áudio, foto, PDF) e o comprovante, mesmo depois das perguntas.
  const origemFinal: Origem = continua && pend!.origem ? pend!.origem : tipo
  if (continua && pend!.anexo && !anexo) anexo = pend!.anexo
  if (continua && pend?.texto) {
    const esc = escolha
    if (pend.opcoes?.length && !esc) {
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: pend, atualizado_em: new Date().toISOString() })
      return { status: 'pergunta', resposta: `Não achei essa opção. ${pend.pergunta}`, efeitos: {}, intencao: 'acoes', texto, tokens }
    }
    // "2" sozinho para "Qual foi o valor?": quase sempre era a opção de outra pergunta (caso real de 16/11: virou uma saída de R$ 2,00).
    // Confirma antes de anotar. A pergunta continua a mesma.
    const duvida = !pend.opcoes?.length && !pend.documento ? valorSoltoDuvidoso(texto, pend.pergunta) : null
    if (duvida !== null) {
      await sb.from('conversas').upsert({ telefone, user_id: cliente.id, pendente: pend, atualizado_em: new Date().toISOString() })
      return { status: 'pergunta', resposta: `Só ${brl(duvida)}? Pra eu não anotar errado, me manda o valor com o R$, tipo "R$ ${duvida}", ou o valor certo.`, efeitos: {}, intencao: 'acoes', texto, tokens }
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

  // Pedido geral de ajuda ("ajuda", "o que você faz?", "você é um robô?"): decidido por código, sem gastar a classificação da IA.
  if (pediuAjuda) {
    const a = await responderAjuda(texto, nome, ctx.historico)
    if (a.uso) soma(a.uso)
    return { status: 'ok', resposta: a.texto, efeitos: {}, intencao: 'ajuda', texto, tokens }
  }

  // "apaga tudo": a Granninha só desfaz o último registro. Diz isso e aponta o painel, sem IA e sem desfazer nada sem querer.
  if (!continua && !documento && !anexo && ehApagarTudo(texto)) {
    return { status: 'ok', resposta: MSG.apagarTudo, efeitos: {}, intencao: 'ajuda', texto, tokens }
  }
  // Só um valor ("150", "R$ 1.250,50"): é o valor de alguma coisa. Pergunta "de quê? entrou ou saiu?" e guarda a pergunta,
  // para a resposta seguinte ("recebi da Juliana") fechar o registro. Antes caía em "isso eu não sei te ajudar".
  const soValor = !continua && !documento && !anexo ? valorSozinho(texto) : null
  if (soValor !== null) {
    const pergunta = MSG.valorSozinho(brl(soValor))
    await guardar({ tipo: 'pergunta', texto, pergunta, forcar: {}, origem: tipo })
    return { status: 'pergunta', resposta: pergunta, efeitos: {}, intencao: 'acoes', texto, tokens }
  }

  let it = await interpretar(texto, ctx, { forcarCarteira: forcar.carteira, forcarPessoal: forcar.pessoal, documento })
  soma(it.uso)
  // "Não foi 200, foi 250" com a pergunta ainda aberta: corrige o que está esperando resposta, em vez de dizer que não achou nada
  // (e deixar o registro se perder).
  if (it.intencao === 'corrigir' && pend?.tipo === 'pergunta' && fresco && pend.texto && !continua) {
    const novoTexto = `${pend.texto}\nCorreção: ${it.correcao ?? texto}`
    const it2 = await interpretar(novoTexto, ctx, { forcarCarteira: pend.forcar?.carteira, forcarPessoal: pend.forcar?.pessoal, documento: pend.documento })
    soma(it2.uso)
    if (it2.intencao === 'acoes') {
      saida.consumiu = true
      it = it2
      texto = novoTexto
    }
  }

  if (it.intencao === 'acoes') {
    if (it.perguntar) {
      await guardar({ tipo: 'pergunta', texto, pergunta: it.perguntar, opcoes: it.opcoes, forcar, documento, origem: origemFinal, anexo })
      return { status: 'pergunta', resposta: it.perguntar, efeitos: {}, intencao: 'acoes', texto, tokens }
    }
    // O valor dito não bate com a conta em aberto que a frase nomeia: pergunta antes de gravar (nada é gravado ainda).
    const diferente = it.acoes.find((a) => a.baixaDiferente)
    if (diferente?.baixaDiferente) {
      const b = diferente.baixaDiferente
      const venc = b.vencimento.split('-').reverse().slice(0, 2).join('/')
      const pergunta = MSG.baixaDiferente(b.tipo, b.descricao, brlComSinal(b.valorConta), venc, brlComSinal(diferente.valor!))
      await guardar({ tipo: 'baixa_diferente', acoes: it.acoes, origem: origemFinal, anexo, texto, pergunta })
      return { status: 'pergunta', resposta: pergunta, efeitos: {}, intencao: 'acoes', texto, tokens }
    }
    // Travas contra lançar duas vezes a mesma coisa. Nada é gravado antes de a pessoa responder.
    const ultima = await ultimaComEfeito(cliente.id)
    const idade = ultima ? Date.now() - new Date(ultima.criado_em).getTime() : Infinity
    if (ultima && idade < JANELA_MIN * 60_000) {
      const antigos = await lancsDe(cliente.id, ultima.efeitos.lancamentos ?? [])
      // Mídia primeiro: o mesmo áudio ou a mesma foto mandados de novo porque pareceu que travou.
      // (Áudio com transcrição idêntica também cairia na trava de texto abaixo, mas a pergunta certa
      // aqui é "já anotei isso, é o mesmo?", não "quer corrigir o anterior?".)
      const reenvio = pareceReenvio(origemFinal, ultima.tipo, antigos, it.acoes)
      // Numa retomada a cliente não está esperando nada: se o lançamento já existe (ela mandou de
      // novo enquanto a IA estava fora), descarta em silêncio em vez de perguntar do nada.
      if (retomada && (reenvio || pareceMesmoLancamento(antigos, it.acoes))) {
        // 'ignorada' porque é o que de fato aconteceu, e é um dos status que a coluna aceita.
        return { status: 'ignorada', resposta: '', efeitos: {}, intencao: 'retomada_duplicada', texto, tokens }
      }
      if (reenvio) {
        const pergunta = perguntaReenvio(reenvio, ctx, Math.floor(idade / 60_000))
        await guardar({ tipo: 'reenvio', acoes: it.acoes, anteriorMsg: ultima.id, origem: origemFinal, anexo, texto, pergunta })
        return { status: 'pergunta', resposta: pergunta, efeitos: {}, intencao: 'acoes', texto, tokens }
      }
      // Texto: igual ao último e a frase soa como correção ("não, esse foi de...").
      if (!documento && !anexo && devePerguntar(texto, ultima.texto)) {
        const antigo = pareceMesmoLancamento(antigos, it.acoes)
        if (antigo) {
          const pergunta = perguntaDuplicata(antigo, ctx)
          await guardar({ tipo: 'duplicata', acoes: it.acoes, anteriorMsg: ultima.id, origem: origemFinal, anexo, texto, pergunta })
          return { status: 'pergunta', resposta: pergunta, efeitos: {}, intencao: 'acoes', texto, tokens }
        }
      }
    }
    const anteriores = it.acoes.some((a) => a.tipo_acao === 'criar_categoria') ? ultima?.efeitos : undefined
    const r = await executar(cliente.id, ctx, it.acoes, origemFinal, anexo, anteriores)
    // Se ELA decidiu que o gasto foi seu e não do negócio, diz isso e oferece a correção de um toque.
    const aviso = avisoDeRetirada(it.acoes, ctx, forcar.pessoal)
    return { status: 'ok', resposta: `${r.linhas.join('\n\n')}${aviso}${await saldoDepois(cliente.id, it.acoes)}\n\n${ERROU}`, efeitos: r.efeitos, intencao: 'acoes', texto, tokens }
  }
  if (it.intencao === 'desfazer') {
    const ult = await ultimaComEfeito(cliente.id)
    if (!ult) return { status: 'ok', resposta: MSG.nadaParaDesfazer, efeitos: {}, intencao: 'desfazer', texto, tokens }
    // Dois DESFAZER seguidos (a pessoa achou que o primeiro não pegou): o segundo reverteria o
    // lançamento ANTERIOR, que ela não pediu para desfazer. Pergunta antes.
    const anterior = await ultimaMensagem(cliente.id)
    if (anterior?.intencao === 'desfazer' && Date.now() - new Date(anterior.criado_em).getTime() < 10 * 60_000) {
      await guardar({ tipo: 'desfazer_mais', anteriorMsg: ult.id })
      return {
        status: 'pergunta',
        resposta: `Eu já tinha desfeito o último. O anterior é: "${ult.texto.slice(0, 80)}". Quer desfazer esse também?\n\n1. Sim, desfaz\n2. Não, para aí\n\nResponda com o número.`,
        efeitos: {}, intencao: 'desfazer', texto, tokens,
      }
    }
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
    const antes = await lancsDe(cliente.id, ult.efeitos.lancamentos ?? [])
    await reverter(cliente.id, ult.efeitos)
    await sb.from('mensagens').update({ desfeita: true }).eq('id', ult.id).eq('user_id', cliente.id)
    // O lançamento corrigido fica com o comprovante e a origem do original.
    const h = herdarComprovante(antes, anexo, tipo)
    const r = await executar(cliente.id, await contextoDe(cliente.id, hoje), it2.acoes, h.origem, h.anexo)
    const mudou = antesEAgora(antes, it2.acoes, ctx)
    return { status: 'ok', resposta: `${MSG.corrigi}\n\n${r.linhas.join('\n\n')}${mudou ? `\n\n${mudou}` : ''}${await saldoDepois(cliente.id, it2.acoes)}\n\n${ERROU}`, efeitos: r.efeitos, intencao: 'corrigir', texto: novo, tokens }
  }
  if (it.intencao === 'pergunta') {
    // A IA entendeu que é pergunta; se o pedido é um dos conhecidos, o número sai do código, não da IA.
    const consulta = reconhecer(texto) ?? (it.pergunta ? reconhecer(it.pergunta) : null)
    if (consulta) return { status: 'ok', resposta: responderConsulta(consulta, await carregarBase(cliente.id), hoje), efeitos: {}, intencao: 'pergunta', texto, tokens }
    const p = await responderPergunta(cliente.id, hoje, it.pergunta ?? texto)
    soma(p.uso)
    return { status: 'ok', resposta: p.texto, efeitos: {}, intencao: 'pergunta', texto, tokens }
  }
  if (it.intencao === 'saudacao') {
    // A IA às vezes chama "valeu, até mais" de saudação: despedida não recebe "Oi, me manda...".
    const dp = despedidaDe(texto)
    if (dp === 'silencio') return { status: 'ignorada', resposta: '', efeitos: {}, intencao: 'confirmacao', texto, tokens }
    if (dp) return { status: 'ok', resposta: RESPOSTA_DESPEDIDA[dp], efeitos: {}, intencao: 'despedida', texto, tokens }
  }
  if (it.intencao === 'saudacao') return { status: 'ok', resposta: MSG.saudacao(nome, texto, !!ctx.poucosRegistros), efeitos: {}, intencao: 'saudacao', texto, tokens }
  if (it.intencao === 'ajuda') {
    const a = await responderAjuda(texto, nome, ctx.historico)
    if (a.uso) soma(a.uso)
    return { status: 'ok', resposta: a.texto, efeitos: {}, intencao: 'ajuda', texto, tokens }
  }
  return { status: 'ok', resposta: MSG.foraDoAssunto, efeitos: {}, intencao: 'outro', texto, tokens }
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
    resposta: `Importei ${acoes.length} compras no ${cartao.nome}, somando ${brl(total)}${pulou ? ` (${pulou} já existiam e pulei)` : ''}. Elas entram nos gastos quando você pagar a fatura. Confira as categorias no painel.${await saldoDepois(userId, acoes)}\n\n${ERROU}`,
    efeitos: r.efeitos, intencao: 'fatura', texto: 'importar fatura', tokens,
  }
}

/** Importa as transações de um extrato depois do SIM. Pula as que já existem (mesmo dia, valor e direção). */
async function importar(userId: string, ctx: Contexto, ts: Transacao[], tipo: Origem, anexo: string | null, tokens: Uso, carteira?: string, config?: EstadoConfig | null): Promise<Conversa> {
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
  // Na configuração, o saldo posto pelo print ou pelo valor dito já contém o que o extrato trouxe: corrige para não somar em dobro.
  if (config) await corrigirSaldoImportado(userId, config, r.efeitos.lancamentos ?? [])
  return {
    status: 'ok',
    resposta: `Importei ${acoes.length} lançamentos${pulou ? ` (${pulou} já existiam e pulei)` : ''}. Confira as categorias no painel.${await saldoDepois(userId, acoes)}\n\n${ERROU}`,
    efeitos: r.efeitos, intencao: 'extrato', texto: 'importar extrato', tokens,
  }
}

/** Lançamentos do cliente por id (para comparar antes e depois de uma correção). */
async function lancsDe(userId: string, ids: string[]): Promise<LancAntigo[]> {
  if (!ids.length) return []
  const { data, error } = await sb.from('lancamentos').select('id,tipo,valor,categoria_id,carteira_id,pessoal,descricao,anexo_path,origem').eq('user_id', userId).in('id', ids)
  falhou(error, 'lançamentos do último registro')
  return (data ?? []).map((l) => ({ ...l, valor: Number(l.valor), pessoal: !!l.pessoal }))
}

/**
 * De quem a correção herda o comprovante. Foto do comprovante e depois "não, foi 90": o lançamento
 * corrigido nascia sem a foto e marcado como texto, e o arquivo ficava guardado mas solto.
 * Se a própria mensagem de correção trouxer anexo, vale o dela.
 */
function herdarComprovante(antigos: LancAntigo[], anexoAtual: string | null, origemAtual: Origem): { anexo: string | null; origem: Origem } {
  if (anexoAtual) return { anexo: anexoAtual, origem: origemAtual }
  const a = antigos.find((x) => x.anexo_path)
  return a ? { anexo: a.anexo_path ?? null, origem: (a.origem as Origem) ?? origemAtual } : { anexo: null, origem: origemAtual }
}

/** O cliente respondeu 1 (é o mesmo: corrige o anterior) ou 2 (é outro: lança). */
async function resolverDuplicata(userId: string, ctx: Contexto, acoes: Acao[], anteriorMsg: string, escolha: 'corrigir' | 'novo', origem: Origem, anexo: string | null, texto: string, tokens: Uso): Promise<Conversa> {
  if (escolha === 'novo') {
    const r = await executar(userId, ctx, acoes, origem, anexo)
    return { status: 'ok', resposta: `${r.linhas.join('\n\n')}${await saldoDepois(userId, acoes)}\n\n${ERROU}`, efeitos: r.efeitos, intencao: 'acoes', texto, tokens }
  }
  const ult = await ultimaComEfeito(userId)
  // Só corrige se o anterior ainda é o último registro vivo: se foi desfeito ou outra coisa entrou no meio, não mexe em nada.
  if (!ult || ult.id !== anteriorMsg) {
    return { status: 'ok', resposta: 'Não achei mais aquele lançamento para corrigir, então não mexi em nada. Se quiser, me manda de novo do jeito certo.', efeitos: {}, intencao: 'corrigir', texto, tokens }
  }
  const antes = await lancsDe(userId, ult.efeitos.lancamentos ?? [])
  await reverter(userId, ult.efeitos)
  await sb.from('mensagens').update({ desfeita: true }).eq('id', ult.id).eq('user_id', userId)
  const h = herdarComprovante(antes, anexo, origem)
  const r = await executar(userId, ctx, acoes, h.origem, h.anexo)
  const mudou = antesEAgora(antes, acoes, ctx)
  return { status: 'ok', resposta: `${MSG.corrigi}\n\n${r.linhas.join('\n\n')}${mudou ? `\n\n${mudou}` : ''}${await saldoDepois(userId, acoes)}\n\n${ERROU}`, efeitos: r.efeitos, intencao: 'corrigir', texto, tokens }
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
    // Quanto saiu de cada conta de dinheiro nesta mensagem, para avisar se foi ela que deixou a conta negativa.
    const saidas = new Map<string, number>()
    for (const a of acoes ?? []) {
      const v = a.valor ?? 0
      const sai = (a.tipo_acao === 'lancamento' && a.movimento === 'saida' && !a.noCartao) || a.tipo_acao === 'transferencia' || a.tipo_acao === 'pagar_fatura'
      if (sai && v > 0 && a.carteira_id) saidas.set(a.carteira_id, (saidas.get(a.carteira_id) ?? 0) + v)
    }
    const negativas = contasQueFicaramNegativas(b, saidas).map((c) => confirma.contaNegativa(c.nome, brlComSinal(c.saldo)))
    const texto = [linhas, ...negativas].filter(Boolean).join('\n')
    return texto ? `\n\n${texto}` : ''
  } catch (e) {
    console.error('[saldo] não consegui calcular o saldo depois de gravar:', (e as Error).message)
    return ''
  }
}
