/**
 * Servidor da Granninha.
 * POST /webhook   recebe as mensagens do gateway (assinadas), responde 200 na hora e processa em seguida
 *                 (o gateway espera no máximo 10 s e não reenvia).
 * GET  /saude     diz só que está de pé. O detalhe (número, volume, fila) sai com a chave
 *                 SAUDE_CHAVE, no cabeçalho Authorization ou em ?chave=, para o monitoramento.
 */
import { createServer, type IncomingMessage } from 'node:http'
import './env.ts'
import { sb } from './banco.ts'
import { rotaAdmin } from './admin.ts'
import { bloquearAtrasadas, rotaCobranca } from './cobranca.ts'
import { assinaturaValida, conferirNumero, digitando, enviarTexto, marcarLidas, reagir, statusSessao } from './gateway.ts'
import { excluirVencidas, soltarNumerosDeExcluidas } from './excluir.ts'
import { agrupar, ESPERA_MAX_MS, esperaMs, RAJADA_MAX } from './rajada.ts'
import { hojeSP, marcarColunaEventoFaltando, NA_FILA, processar, registrarChegada, semColunaEvento, type EventoGateway } from './granninha.ts'
import { clientePorNumero } from './banco.ts'
import { PISO_MS, varrerPresas, varrerRetomarIA, type Presa } from './presas.ts'
import { estadoIA, MARCA_RETOMAR } from './ia-estado.ts'
import { decidirAviso, textoVoltou, type ConfigAlerta } from './alerta.ts'
import { estado as estadoAvisos, estadoTeste, lerConfig as lerConfigAvisos, lerConfigTeste, rodarAvisos, rodarAvisosTeste } from './avisos.ts'
import { depsAvisosDoBanco } from './avisos-banco.ts'
import { rodarRetencao, estado as estadoRetencao } from './retencao.ts'
import { depsRetencaoDoBanco } from './retencao-banco.ts'
import { rodarEnvioManual } from './envio-manual.ts'
import { depsEnvioManualDoBanco } from './envio-manual-banco.ts'
import { sincronizarCobrancaDasExclusoes } from './exclusao-cobranca.ts'
import { estadoResumo, lerConfigResumo, rodarResumo } from './resumo-diario.ts'
import { estadoReposicao, lerModoRepor, reporContasFixas } from './fixas-repor.ts'
import { depsReporDoBanco } from './fixas-repor-banco.ts'
import { depsResumoDoBanco } from './resumo-diario-banco.ts'
import { estadoSonda, sondarIA } from './ia-sonda.ts'

const PORTA = Number(process.env.PORT ?? 3000)
let ultimaMensagem: string | null = null
let erros = 0
/** Ids que este processo está tratando agora: a varredura não encosta neles. */
const emVoo = new Set<string>()

// Uma fila por número: duas mensagens seguidas do mesmo cliente são tratadas na ordem em que chegaram.
const filas = new Map<string, Promise<void>>()
function enfileirar(chave: string, tarefa: () => Promise<void>) {
  const anterior = filas.get(chave) ?? Promise.resolve()
  const proxima = anterior.then(tarefa, tarefa).finally(() => {
    if (filas.get(chave) === proxima) filas.delete(chave)
  })
  filas.set(chave, proxima)
}

/**
 * Rajadas em espera, uma por número (rajada.ts). Cada mensagem nova reinicia o relógio; quando a pessoa para de escrever por
 * esperaMs(), a rajada vai para a fila do número e é atendida de uma vez. As linhas seguem gravadas como 'na fila' no banco e
 * protegidas pelo emVoo: se o processo morrer no meio da espera, a varredura (presas.ts) atende cada uma sozinha, nenhuma se perde.
 */
type Relogio = ReturnType<typeof setTimeout>
const rajadas = new Map<string, { eventos: EventoGateway[]; timer: Relogio; desde: number; jid: string; timerDigitar?: Relogio; cliente: Promise<boolean> }>()

/**
 * Sinais de conversa (pedido do Arthur em 2026-11-26): os tiques azuis ~1 s depois de chegar, e o "digitando..." DIGITAR_MS depois da ÚLTIMA
 * mensagem, mantido enquanto a IA pensa e desligado quando a resposta sai. Mensagem nova no meio da espera desliga o digitando e o relógio
 * dele volta do zero, como uma pessoa que para de digitar para ler. Só para quem é cliente: número desconhecido recebe silêncio, e ver
 * "lida" e "digitando" sem resposta seria pior que nada. GRANNINHA_SINAIS=off desliga os três (lida, digitando, reação).
 */
const sinaisLigados = () => (process.env.GRANNINHA_SINAIS ?? 'on') !== 'off'
const digitarMs = () => Number(process.env.GRANNINHA_DIGITAR_MS ?? 3000)
const lidaMs = () => Number(process.env.GRANNINHA_LIDA_MS ?? 1000)
/** WhatsApp apaga o "digitando..." sozinho depois de uns segundos: renova enquanto a resposta não sai. */
const RENOVA_DIGITANDO_MS = 8000
const digitandoEm = new Map<string, ReturnType<typeof setInterval>>()
/** Quantas unidades de cada número estão sendo processadas agora (mensagem nova não apaga o digitando de quem já está pensando). */
const ocupados = new Map<string, number>()
function ligarDigitando(chave: string, jid: string) {
  if (!sinaisLigados()) return
  void digitando(jid, true)
  if (digitandoEm.has(chave)) return
  digitandoEm.set(chave, setInterval(() => void digitando(jid, true), RENOVA_DIGITANDO_MS))
}
function desligarDigitando(chave: string, jid: string, avisar = true) {
  const i = digitandoEm.get(chave)
  if (!i) return
  clearInterval(i)
  digitandoEm.delete(chave)
  if (avisar && sinaisLigados()) void digitando(jid, false)
}
const cacheCliente = new Map<string, { ok: boolean; em: number }>()
async function ehClienteParaSinais(jid: string): Promise<boolean> {
  if (!sinaisLigados()) return false
  const k = jid.split('@')[0]
  const c = cacheCliente.get(k)
  if (c && Date.now() - c.em < 5 * 60_000) return c.ok
  try {
    const ok = !!(await clientePorNumero(jid))
    cacheCliente.set(k, { ok, em: Date.now() })
    return ok
  } catch {
    return false
  }
}

function esperarRajada(chave: string, ev: EventoGateway) {
  const jid = ev.data?.from ?? ev.data?.key?.remoteJid ?? chave
  const r = rajadas.get(chave) ?? { eventos: [], timer: undefined as unknown as Relogio, desde: Date.now(), jid, cliente: ehClienteParaSinais(jid) }
  clearTimeout(r.timer)
  clearTimeout(r.timerDigitar)
  r.eventos.push(ev)
  rajadas.set(chave, r)
  const id = ev.data?.key?.id
  // Leu: os tiques azuis saem pouco depois de chegar. Escreveu de novo: quem estava "digitando" para (se não está pensando em outra).
  void r.cliente.then((ok) => {
    if (!ok) return
    if (id) setTimeout(() => void marcarLidas(r.jid, [id]), lidaMs())
    if (!(ocupados.get(chave) ?? 0)) desligarDigitando(chave, r.jid)
  })
  const espera = Math.min(esperaMs(), Math.max(0, r.desde + ESPERA_MAX_MS - Date.now()))
  if (r.eventos.length >= RAJADA_MAX || espera === 0) return soltarRajada(chave)
  if (digitarMs() < espera) r.timerDigitar = setTimeout(() => void r.cliente.then((ok) => ok && rajadas.get(chave) === r && ligarDigitando(chave, r.jid)), digitarMs())
  r.timer = setTimeout(() => soltarRajada(chave), espera)
}
function soltarRajada(chave: string) {
  const r = rajadas.get(chave)
  if (!r) return
  clearTimeout(r.timer)
  clearTimeout(r.timerDigitar)
  rajadas.delete(chave)
  const unidades = agrupar(r.eventos)
  ocupados.set(chave, (ocupados.get(chave) ?? 0) + unidades.length)
  for (const u of unidades) {
    enfileirar(chave, async () => {
      const ids = [u.ev.data?.key?.id, ...u.juntadas].filter(Boolean) as string[]
      const cliente = await r.cliente
      // Pensando: o digitando fica ligado até a resposta sair.
      if (cliente) ligarDigitando(chave, r.jid)
      try {
        // As mensagens juntadas saem de 'recebida' antes de a principal começar: a varredura nunca as atende sozinhas depois.
        // Se a marcação falhar (ou pegar menos linhas), atende cada mensagem sozinha, como antes da espera: juntar sem marcar deixaria as
        // outras 'na fila', e a varredura as atenderia de novo minutos depois (lançamento em dobro).
        let fila: EventoGateway[] = [u.ev]
        if (u.juntadas.length) {
          const j = await sb.from('mensagens').update({ status: 'ignorada', erro: `juntada em ${u.ev.data?.key?.id ?? '?'}`, resposta: '' })
            .in('id', u.juntadas).eq('status', 'recebida').eq('erro', NA_FILA).select('id')
          if (j.error || (j.data?.length ?? 0) !== u.juntadas.length) {
            console.error('[rajada] não marquei as juntadas, atendendo uma a uma:', j.error?.message ?? `${j.data?.length ?? 0} de ${u.juntadas.length}`)
            // As que chegaram a ser marcadas voltam para 'na fila', senão o processar não as pega e elas sumiriam.
            const marcadas = (j.data ?? []).map((x) => x.id as string)
            if (marcadas.length) await sb.from('mensagens').update({ status: 'recebida', erro: NA_FILA }).in('id', marcadas)
            fila = u.originais
          }
        }
        for (const ev of fila) {
          const res = await processar(ev, { jaRegistrada: true })
          if (res.status !== 'ignorada' || res.resposta) ultimaMensagem = new Date().toISOString()
          // A reação vem antes da resposta, como quem acena e depois fala. Na mensagem que foi processada (a última da rajada).
          if (cliente && res.reacao && res.msgId) await reagir(r.jid, res.msgId, res.reacao)
          if (res.para && res.resposta) {
            // A resposta enviada já apaga o "digitando" no WhatsApp: só para a renovação, sem mandar "parou".
            desligarDigitando(chave, r.jid, false)
            await entregar(res.para, res.resposta, res.msgId)
          }
        }
      } catch (e) {
        erros++
        console.error('[webhook]', (e as Error).message)
      } finally {
        for (const id of ids) emVoo.delete(id)
        const resta = (ocupados.get(chave) ?? 1) - 1
        if (resta > 0) ocupados.set(chave, resta)
        else {
          ocupados.delete(chave)
          // Acabou tudo (inclusive o caso de não ter resposta, ex.: "ok" que fica em silêncio): o digitando não pode ficar pendurado.
          desligarDigitando(chave, r.jid)
        }
      }
    })
  }
}

/**
 * Entrega a resposta e, se não conseguir depois das tentativas, deixa registro na mensagem.
 * O status fica como está de propósito: o lançamento foi gravado e o DESFAZER precisa continuar
 * achando essa mensagem (ele procura status 'ok'). O que muda é o campo `erro`, que o admin mostra.
 */
async function entregar(para: string, texto: string, msgId?: string): Promise<void> {
  try {
    await enviarTexto(para, texto)
  } catch (e) {
    erros++
    const motivo = ('resposta não entregue: ' + (e as Error).message).slice(0, 500)
    console.error('[envio]', msgId ?? '-', motivo)
    if (msgId) {
      const up = await sb.from('mensagens').update({ erro: motivo }).eq('id', msgId)
      if (up.error) console.error('[envio] registrar falha', up.error.message)
    }
  }
}

function corpo(req: IncomingMessage, limite = 2_000_000): Promise<string> {
  return new Promise((ok, falha) => {
    let t = ''
    req.on('data', (c) => {
      t += c
      if (t.length > limite) {
        falha(new Error('corpo grande demais'))
        req.destroy()
      }
    })
    req.on('end', () => ok(t))
    req.on('error', falha)
  })
}

/** De onde a varredura tira o que precisa. Exportado para o teste exercitar as peças de verdade. */
/**
 * Avisa o dono no WhatsApp quando a Granninha para. Roda junto do batimento, uma vez por minuto.
 * O aviso de WhatsApp caído NÃO sai (é o próprio canal que está quebrado), mas fica registrado para o
 * admin e para o olho de fora que bate no /saude.
 */
async function avisarDono(whatsappEstado: string | null) {
  const cfg = await sb.from('granninha_saude').select('alerta_whats,alerta_ligado,alerta_tipo,alerta_em').eq('id', 1).maybeSingle()
  if (cfg.error || !cfg.data) return
  const c = cfg.data as ConfigAlerta
  const ia = estadoIA()
  const d = decidirAviso(c, { iaOk: ia.ok, iaProblema: ia.problema, iaDesde: ia.desde, whatsappEstado })
  if (d.acao === 'nada') return
  const agora = new Date().toISOString()
  if (d.acao === 'avisar' && !d.aviso!.entregavel) {
    console.error('[alerta] problema sem como avisar por WhatsApp:', d.aviso!.tipo)
    await sb.from('granninha_saude').update({ alerta_tipo: d.aviso!.tipo, alerta_em: agora }).eq('id', 1)
    return
  }
  const texto = d.acao === 'voltou' ? textoVoltou(c.alerta_tipo ?? '') : d.aviso!.texto
  try {
    await enviarTexto(c.alerta_whats, texto)
    console.log('[alerta]', d.acao, '·', d.motivo, '· para …' + c.alerta_whats.slice(-4))
    await sb.from('granninha_saude').update({
      alerta_tipo: d.acao === 'voltou' ? null : d.aviso!.tipo,
      alerta_em: d.acao === 'voltou' ? null : agora,
    }).eq('id', 1)
  } catch (e) {
    console.error('[alerta] não consegui avisar:', (e as Error).message)
  }
}

export const varredura = {
  buscar: async (desde: string): Promise<Presa[]> => {
    const ate = new Date(Date.now() - PISO_MS).toISOString()
    const campos = 'id,telefone,tipo,texto,erro,criado_em'
    for (let i = 0; i < 2; i++) {
      // A ausência da coluna vale por um tempo, não para sempre: a migration pode rodar com o app no ar.
      const semColuna = semColunaEvento()
      const r = await sb.from('mensagens').select(semColuna ? campos : campos + ',evento')
        .eq('status', 'recebida').gte('criado_em', desde).lte('criado_em', ate).order('criado_em', { ascending: false }).limit(50)
      if (!r.error) return (r.data ?? []).map((m) => ({ ...(m as unknown as Presa), evento: (m as unknown as Presa).evento ?? null }))
      if (!semColuna && (r.error.code === 'PGRST204' || r.error.code === '42703')) {
        marcarColunaEventoFaltando()
        continue
      }
      throw new Error(r.error.message)
    }
    return []
  },
  fechar: async (id: string, erro: string): Promise<boolean> => {
    const r = await sb.from('mensagens').update({ status: 'erro', erro: erro.slice(0, 500) }).eq('id', id).eq('status', 'recebida').select('id')
    if (r.error) throw new Error(r.error.message)
    return Boolean(r.data?.length)
  },
  enfileirar,
  processar,
  enviar: entregar,
  iaOk: () => estadoIA().ok,
  desistir: async (id: string, motivo: string): Promise<boolean> => {
    // Tira a marca de retomada, mantendo o registro do que aconteceu para o admin.
    const r = await sb.from('mensagens').update({ erro: motivo.slice(0, 500) }).eq('id', id).eq('status', 'erro').like('erro', `${MARCA_RETOMAR}%`).select('id')
    if (r.error) throw new Error(r.error.message)
    return Boolean(r.data?.length)
  },
  buscarRetomarIA: async (desde: string): Promise<Presa[]> => {
    const campos = 'id,telefone,tipo,texto,erro,criado_em'
    for (let i = 0; i < 2; i++) {
      const semColuna = semColunaEvento()
      const r = await sb.from('mensagens').select(semColuna ? campos : campos + ',evento')
        .eq('status', 'erro').like('erro', `${MARCA_RETOMAR}%`).gte('criado_em', desde).order('criado_em', { ascending: true }).limit(50)
      if (!r.error) return (r.data ?? []).map((m) => ({ ...(m as unknown as Presa), evento: (m as unknown as Presa).evento ?? null }))
      if (!semColuna && (r.error.code === 'PGRST204' || r.error.code === '42703')) {
        marcarColunaEventoFaltando()
        continue
      }
      throw new Error(r.error.message)
    }
    return []
  },
  ehCliente: async (telefone: string) => Boolean(await clientePorNumero(telefone)),
  emVoo: () => emVoo,
}

export function iniciar(porta = PORTA) {
  const srv = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      if (await rotaAdmin(req, res, url.pathname, () => corpo(req))) return
      if (await rotaCobranca(req, res, url.pathname)) return
      if (req.method === 'POST' && url.pathname === '/webhook') {
        const bruto = await corpo(req)
        if (!assinaturaValida(bruto, req.headers['x-webhook-signature'] as string | undefined)) {
          res.writeHead(401).end()
          return
        }
        const ev = JSON.parse(bruto) as EventoGateway
        // A chegada é gravada ANTES do 200: o gateway não reenvia, então mensagem que só existe na
        // memória deste processo desaparece no próximo deploy. Se o banco estiver fora, é melhor
        // devolver erro (fica no log do gateway) do que engolir a mensagem calado.
        let chegada: 'nova' | 'duplicada' | 'ignorar'
        try {
          chegada = await registrarChegada(ev)
        } catch (e) {
          erros++
          console.error('[webhook] não deu para registrar a chegada:', (e as Error).message)
          res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"ok":false}')
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
        if (chegada !== 'nova') return
        const chave = (ev.data?.from ?? ev.data?.key?.remoteJid ?? 'x').split('@')[0]
        const idEmVoo = ev.data?.key?.id
        if (idEmVoo) emVoo.add(idEmVoo)
        esperarRajada(chave, ev)
        return
      }
      if (req.method === 'GET' && url.pathname === '/saude') {
        // Sem a chave certa, só diz que está de pé: o número da Granninha e o volume de mensagens
        // não são para qualquer um na internet. Sem SAUDE_CHAVE definida, ninguém vê o detalhe.
        const chave = process.env.SAUDE_CHAVE ?? ''
        const veio = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || (url.searchParams.get('chave') ?? '')
        if (!chave || veio !== chave) {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }))
          return
        }
        const desde = new Date(Date.now() - 86400_000).toISOString()
        const [wa, hoje, falhas] = await Promise.all([
          statusSessao().catch((e) => ({ estado: 'gateway fora: ' + (e as Error).message, numero: null })),
          sb.from('mensagens').select('id', { count: 'exact', head: true }).gte('criado_em', desde),
          sb.from('mensagens').select('id', { count: 'exact', head: true }).gte('criado_em', desde).eq('status', 'erro'),
        ])
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ ok: true, whatsapp: wa, ia: { ...estadoIA(), sonda: estadoSonda() }, mensagens_24h: hoje.count ?? null, erros_24h: falhas.count ?? null, erros_envio_desde_inicio: erros, ultima_mensagem: ultimaMensagem, fila: filas.size,
            avisos: { modo: estadoAvisos.modo, ultimo_ciclo: estadoAvisos.ultimoCiclo, enviados_desde_inicio: estadoAvisos.enviados, falhas_desde_inicio: estadoAvisos.falhas, ultimo_erro: estadoAvisos.ultimoErro,
              reposicao_fixas: { modo: estadoReposicao.modo, ultimo_ciclo: estadoReposicao.ultimoCiclo, fixas_lidas: estadoReposicao.fixasLidas, criadas_desde_inicio: estadoReposicao.criadasDesdeInicio, ultimo_erro: estadoReposicao.ultimoErro },
              resumo_diario: { modo: estadoResumo.modo, ultimo_ciclo: estadoResumo.ultimoCiclo, enviados_desde_inicio: estadoResumo.enviados, falhas_desde_inicio: estadoResumo.falhas, ultimo_erro: estadoResumo.ultimoErro },
              fim_do_teste: { modo: estadoTeste.modo, ultimo_ciclo: estadoTeste.ultimoCiclo, enviados_desde_inicio: estadoTeste.enviados, falhas_desde_inicio: estadoTeste.falhas, ultimo_erro: estadoTeste.ultimoErro },
              retencao: { ultimo_ciclo: estadoRetencao.ultimoCiclo, enviados_desde_inicio: estadoRetencao.enviados, falhas_desde_inicio: estadoRetencao.falhas, parado_ate: estadoRetencao.pausaAte > Date.now() ? new Date(estadoRetencao.pausaAte).toISOString() : null, ultimo_erro: estadoRetencao.ultimoErro } } }),
        )
        return
      }
      res.writeHead(404).end()
    } catch (e) {
      console.error('[http]', (e as Error).message)
      if (!res.headersSent) res.writeHead(400).end()
    }
  })
  srv.listen(porta, () => console.log(`Granninha ouvindo na porta ${porta}`))
  // Aviso de conta vencendo (fase f4). Corre à parte do batimento porque dorme entre um envio e outro, e isso
  // não pode atrasar o resto. Desligado por padrão: AVISOS=ensaio | piloto | todos (ver avisos.ts).
  const depsAvisos = depsAvisosDoBanco(sb, enviarTexto)
  const depsResumo = depsResumoDoBanco(sb, enviarTexto)
  const depsRepor = depsReporDoBanco(sb)
  // Lembretes de retenção (quem nunca mandou nada e quem parou de usar). Desligados até o Arthur ligar no admin; ver retencao.ts.
  const depsRetencao = depsRetencaoDoBanco(sb, enviarTexto, async () => (await statusSessao()).estado === 'CONNECTED', () => lerConfigAvisos().piloto)
  // Envio manual pedido pelo admin (botão "enviar" na visão geral): só sai o que o Arthur aprovou, um a cada 5 minutos; ver envio-manual.ts.
  const depsManual = depsEnvioManualDoBanco(sb, enviarTexto, async () => (await statusSessao()).estado === 'CONNECTED', conferirNumero)
  const avisar = async () => {
    try {
      for (const linha of await rodarAvisos(depsAvisos, lerConfigAvisos())) console.log('[avisos]', linha)
    } catch (e) {
      console.error('[avisos]', (e as Error).message)
    }
    // Fim do teste grátis: roda sozinho (AVISOS_TESTE=off desliga). Cada ciclo tem a sua trava, então um não segura o outro.
    try {
      for (const linha of await rodarAvisosTeste(depsAvisos, lerConfigTeste())) console.log('[avisos]', linha)
    } catch (e) {
      console.error('[avisos] fim do teste:', (e as Error).message)
    }
    // Resumo diário de contas: recurso de plano superior, liberado cliente a cliente pelo admin. Interruptor PRÓPRIO (AVISOS_RESUMO, desligado por padrão).
    try {
      for (const linha of await rodarResumo(depsResumo, lerConfigResumo())) console.log('[resumo]', linha)
    } catch (e) {
      console.error('[resumo]', (e as Error).message)
    }
    // Envio manual pedido no admin: antes dos lembretes automáticos, porque alguém clicou e está esperando. Fila vazia não faz nada.
    try {
      for (const linha of await rodarEnvioManual(depsManual)) console.log('[envio-manual]', linha)
    } catch (e) {
      console.error('[envio-manual]', (e as Error).message)
    }
    // Lembretes de retenção: por último, e só depois de os dois acima terminarem (saem pelo mesmo chip).
    try {
      for (const linha of await rodarRetencao(depsRetencao)) console.log('[retencao]', linha)
    } catch (e) {
      console.error('[retencao]', (e as Error).message)
    }
  }
  // Batimento: a cada minuto grava o estado do número para o painel admin (e para o alerta de "parou").
  const bater = async () => {
    try {
      const wa = await statusSessao().catch((e) => ({ estado: 'gateway fora: ' + (e as Error).message.slice(0, 80), numero: null }))
      await sb.from('granninha_saude').upsert({ id: 1, whatsapp_estado: wa.estado, whatsapp_numero: wa.numero, fila: filas.size, atualizado_em: new Date().toISOString() })
      // Antes do alerta, para ele já enxergar o que a sonda descobriu neste minuto (IA sem crédito sem ninguém ter escrito).
      try {
        const s = await sondarIA()
        if (s !== 'pulou' && s !== 'dispensada' && s !== 'ok') console.error('[ia] sonda:', s)
      } catch (e) {
        console.error('[ia] sonda:', (e as Error).message)
      }
      await avisarDono(wa.estado)
    } catch (e) {
      console.error('[saude]', (e as Error).message)
    }
    // Quem pediu para excluir a conta para de ser atendido na hora e o número volta a ficar livre.
    try {
      const soltos = await soltarNumerosDeExcluidas(sb)
      if (soltos) console.log('[excluir] números soltos de contas em exclusão:', soltos)
    } catch (e) {
      console.error('[excluir] soltar números:', (e as Error).message)
    }
    // Quem pediu a exclusão não segue sendo cobrado nos 30 dias (a cobrança para no fim do período); quem desistiu volta a renovar.
    try {
      const c = await sincronizarCobrancaDasExclusoes(sb)
      if (c.paradas || c.religadas) console.log(`[excluir] cobrança: ${c.paradas} parada(s) no fim do período, ${c.religadas} religada(s) por desistência`)
      for (const e of c.erros) console.error('[excluir] cobrança:', e)
    } catch (e) {
      console.error('[excluir] cobrança:', (e as Error).message)
    }
    try {
      for (const linha of await varrerPresas(varredura)) console.log('[presas]', linha)
    } catch (e) {
      console.error('[presas] varrer:', (e as Error).message)
    }
    // O que a IA deixou cair volta sozinho quando ela voltar.
    try {
      for (const linha of await varrerRetomarIA({ ...varredura, buscar: varredura.buscarRetomarIA })) console.log('[ia]', linha)
    } catch (e) {
      console.error('[ia] retomar:', (e as Error).message)
    }
    // Pagamento que falhou e passou da carência perde o acesso (a Stripe segue tentando; se cair, o webhook reabre).
    try {
      const n = await bloquearAtrasadas()
      if (n) console.log('[cobranca] contas bloqueadas por atraso além da carência:', n)
    } catch (e) {
      console.error('[cobranca] bloquear atrasadas:', (e as Error).message)
    }
    await varrerVencidas()
    await reporFixasDoDia()
    void avisar()
  }

  // Uma vez por dia: apaga de vez quem passou dos 30 dias. Sai listando, sem apagar, até
  // EXCLUSAO_AUTOMATICA=1 (assim o Arthur vê no log o que sairia antes de ligar de verdade).
  let diaVarrido: string | null = null
  const varrerVencidas = async () => {
    const hoje = hojeSP()
    if (diaVarrido === hoje) return
    diaVarrido = hoje
    try {
      const apagar = process.env.EXCLUSAO_AUTOMATICA === '1'
      const lista = await excluirVencidas(sb, hoje, apagar)
      for (const v of lista) console.log(`[excluir] prazo vencido ${v.exclusao_em} · ${v.cliente} · ${v.apagada ? 'APAGADA' : 'não apagada: ' + v.erro}`)
      if (!lista.length) console.log('[excluir] nenhuma conta com prazo vencido hoje.')
    } catch (e) {
      diaVarrido = null // deu erro: tenta de novo no próximo minuto
      console.error('[excluir] varrer vencidas:', (e as Error).message)
    }
  }
  // Uma vez por dia: repõe as próximas ocorrências das contas fixas (o cadastro só cria as 3 primeiras). Idempotente, sem passado, sem preencher buraco
  // (ver fixas-repor.ts). REPOR_FIXAS=off desliga e =ensaio só calcula. Com erro, espera 10 minutos antes de tentar de novo.
  let diaReposto: string | null = null
  let reporDepoisDe = 0
  const reporFixasDoDia = async () => {
    const hoje = hojeSP()
    if (diaReposto === hoje || Date.now() < reporDepoisDe) return
    const modo = lerModoRepor()
    const r = await reporContasFixas(depsRepor, hoje, modo)
    if (r.erros.length) {
      reporDepoisDe = Date.now() + 10 * 60_000
      for (const e of r.erros) console.error('[fixas] repor:', e)
      return
    }
    diaReposto = hoje
    if (modo !== 'off') console.log(`[fixas] modo ${modo}: ${r.fixas} fixas, ${r.semOcorrencia} sem ocorrência, ${r.aCriar} a criar, ${r.criadas} criadas${r.limitado ? ' (parou no teto da volta, o resto fica para a próxima)' : ''}`)
  }
  if (process.env.SEM_BATIMENTO !== '1') {
    void bater()
    const t = setInterval(bater, 60_000)
    srv.on('close', () => clearInterval(t))
  }
  return srv
}

if (process.argv[1] && /index\.ts$/.test(process.argv[1])) iniciar()
