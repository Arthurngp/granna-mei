/**
 * Envio manual pedido pelo admin: o botão do admin só grava um pedido na fila (tabela envios_manuais); quem envia é este ciclo, que passa
 * pelas MESMAS proteções do número que os lembretes automáticos (ver retencao.ts), mais a espera de 5 minutos que o Arthur pediu em 2026-11-23.
 *
 * Por que a fila mora no servidor e não no navegador: o intervalo precisa valer com a aba fechada, com duas abas abertas e depois de um
 * reinício. Por isso a espera é medida NO BANCO, desde o último envio automático ou manual de qualquer tipo (saem pelo mesmo chip).
 *
 * - Um envio por ciclo, o pedido mais antigo primeiro. Dois cliques em menos de 5 minutos: o segundo espera na fila e sai sozinho.
 * - Só dentro da janela das 9h às 19h (São Paulo), só com o WhatsApp em CONNECTED, e para depois de 3 falhas seguidas por 30 minutos.
 * - Teto de 15 por dia só de manuais. O teto dos automáticos (15) é contado à parte.
 * - EM DÚVIDA, NÃO ENVIA: qualquer erro de leitura encerra o ciclo sem enviar. Um pedido que falha NÃO é refeito sozinho (a mensagem pode ter
 *   saído): o admin vê "falhou" e decide.
 * - Antes de enviar, confere DE NOVO se a pessoa pode receber (pode ter respondido SAIR esperando na fila). Recusado vira "falhou" com o motivo.
 *   Contato frio (quem nunca escreveu para o número atual) só sai se o admin autorizou AQUELE pedido (contato_frio); o automático nunca o faz.
 * - A linha do SAIR é acrescentada aqui, sempre (montarTextoRetencao), e cada envio é gravado em `avisos` (tipo retencao_manual) para os
 *   lembretes automáticos enxergarem: contam na espera de 3 minutos e no intervalo de 48 horas por pessoa.
 */
import { horaSP } from './avisos.ts'
import { inicioDoDiaSP, montarTextoRetencao, naJanelaDeEnvio } from './retencao.ts'
import { erroSeguro } from './seguranca.ts'

export const ESPERA_MANUAL_MINUTOS = 5
export const TETO_MANUAL_POR_DIA = 15
export const FALHAS_MANUAIS_PARA_PARAR = 3
export const PAUSA_MANUAL_MS = 30 * 60_000

export interface PedidoManual {
  id: string
  user_id: string
  texto: string
  /** O admin autorizou, de propósito, o envio para quem nunca escreveu para o número atual. A autorização vale só para este pedido. */
  contato_frio?: boolean
}
export interface AlvoManual {
  telefone: string | null
  nome: string
  /** Preenchido quando a pessoa NÃO pode receber agora (SAIR, exclusão, nunca escreveu para o número atual...). */
  recusa: string | null
}
export type Resultado = { ok: true } | { ok: false; erro: string }

export interface DepsManual {
  /** Põe como "falhou" o que ficou "enviando" de um processo que caiu no meio. Nunca reenvia. */
  liberarPresos: () => Promise<void>
  /** O pedido mais antigo da fila, ou null. Lança se não conseguir ler (inclusive migration não aplicada). */
  proximo: () => Promise<PedidoManual | null>
  /** `forcar`: repete a autorização que o admin deu ao pedir (só libera o contato frio; SAIR, exclusão e o resto continuam recusando). */
  apto: (userId: string, forcar: boolean) => Promise<AlvoManual>
  gatewayConectado: () => Promise<boolean>
  /** O envio mais recente de QUALQUER tipo e quantos manuais já saíram desde `inicioDoDia`. */
  movimento: (inicioDoDia: string) => Promise<{ ultimoEnvioEm: string | null; manuaisHoje: number }>
  /** Passa o pedido de "fila" para "enviando" e grava a reserva em avisos. `true` só se ESTA chamada ganhou. */
  reservar: (p: PedidoManual, telefone: string) => Promise<boolean>
  concluir: (p: PedidoManual, r: Resultado) => Promise<void>
  enviar: (telefone: string, texto: string) => Promise<void>
  /** Outro ciclo que fala pelo mesmo chip está no meio: este minuto não envia. */
  outroCicloAndando: () => boolean
}

export const estadoManual = {
  rodando: false,
  ultimoCiclo: null as string | null,
  enviados: 0,
  falhas: 0,
  falhasSeguidas: 0,
  pausaAte: 0,
  ultimoErro: null as string | null,
  ultimoEnvioMs: 0,
}
export function zerarEstadoManual() {
  estadoManual.rodando = false
  estadoManual.ultimoCiclo = null
  estadoManual.enviados = 0
  estadoManual.falhas = 0
  estadoManual.falhasSeguidas = 0
  estadoManual.pausaAte = 0
  estadoManual.ultimoErro = null
  estadoManual.ultimoEnvioMs = 0
}

const mascarar = (tel: string) => `${tel.slice(0, 2)}${'*'.repeat(Math.max(0, tel.length - 6))}${tel.slice(-4)}`

export async function rodarEnvioManual(d: DepsManual, agora = new Date()): Promise<string[]> {
  if (estadoManual.rodando) return ['ciclo manual anterior ainda em andamento, pulei este']
  estadoManual.rodando = true
  const log: string[] = []
  try {
    await d.liberarPresos()
    const pedido = await d.proximo()
    if (!pedido) return log // fila vazia: o caso de quase todo minuto
    estadoManual.ultimoCiclo = agora.toISOString()

    // Condições do momento. Qualquer uma que falhe deixa o pedido na fila para o próximo minuto.
    if (d.outroCicloAndando()) return log
    if (!naJanelaDeEnvio(horaSP(agora))) return log
    if (agora.getTime() < estadoManual.pausaAte) return log
    if (!(await d.gatewayConectado())) {
      log.push('WhatsApp fora de CONNECTED: o pedido continua na fila')
      return log
    }
    const mov = await d.movimento(inicioDoDiaSP(agora))
    if (mov.manuaisHoje >= TETO_MANUAL_POR_DIA) {
      log.push(`teto do dia atingido (${mov.manuaisHoje} de ${TETO_MANUAL_POR_DIA}): o resto fica para amanhã`)
      return log
    }
    const noBanco = mov.ultimoEnvioEm ? Date.parse(mov.ultimoEnvioEm) : 0
    if (Number.isNaN(noBanco)) {
      log.push('data do último envio ilegível: nada enviado')
      return log
    }
    if (agora.getTime() - Math.max(noBanco, estadoManual.ultimoEnvioMs) < ESPERA_MANUAL_MINUTOS * 60_000) return log

    // Confere DE NOVO se a pessoa pode receber: ela pode ter respondido SAIR enquanto esperava.
    const alvo = await d.apto(pedido.user_id, !!pedido.contato_frio)
    if (alvo.recusa || !alvo.telefone) {
      const motivo = alvo.recusa ?? 'sem telefone para responder'
      await d.concluir(pedido, { ok: false, erro: `não enviado: ${motivo}` })
      log.push(`pedido recusado na hora de enviar (${motivo})`)
      return log
    }
    if (!(await d.reservar(pedido, alvo.telefone))) return log

    try {
      await d.enviar(alvo.telefone, montarTextoRetencao(pedido.texto, alvo.nome))
      await d.concluir(pedido, { ok: true })
      estadoManual.enviados++
      estadoManual.falhasSeguidas = 0
      estadoManual.ultimoEnvioMs = agora.getTime()
      log.push(`manual: enviado a ${mascarar(alvo.telefone)}${pedido.contato_frio ? ' (contato frio, autorizado pelo admin)' : ''}`)
    } catch (e) {
      const msg = erroSeguro((e as Error).message)
      await d.concluir(pedido, { ok: false, erro: msg }).catch((e2) => log.push(`não consegui registrar a falha: ${(e2 as Error).message}`))
      estadoManual.falhas++
      estadoManual.falhasSeguidas++
      estadoManual.ultimoErro = msg
      log.push(`manual: falha ao enviar a ${mascarar(alvo.telefone)}: ${msg}`)
      if (estadoManual.falhasSeguidas >= FALHAS_MANUAIS_PARA_PARAR) {
        estadoManual.pausaAte = agora.getTime() + PAUSA_MANUAL_MS
        log.push(`${estadoManual.falhasSeguidas} falhas seguidas: envio manual parado por ${PAUSA_MANUAL_MS / 60_000} minutos`)
      }
    }
  } catch (e) {
    estadoManual.ultimoErro = erroSeguro((e as Error).message)
    log.push(`erro no ciclo manual, nada enviado depois dele: ${estadoManual.ultimoErro}`)
  } finally {
    estadoManual.rodando = false
  }
  return log
}

