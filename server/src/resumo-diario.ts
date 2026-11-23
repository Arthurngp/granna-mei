/**
 * Resumo diário de contas: todo dia a Granninha manda no WhatsApp as contas a pagar que vencem HOJE e avisa se há ATRASADAS.
 *
 * É um recurso de PLANO SUPERIOR (não faz parte do plano de R$ 29,90). Decisão do Arthur em 2026-11-23: ele é liberado cliente a
 * cliente pelo ADMIN (tabela recursos_cliente, recurso `resumo_diario_contas`) e NÃO é exposto ao público: nada no painel, no site
 * nem no manual do bot fala dele. Por padrão ninguém tem o recurso.
 *
 * Duas travas independentes, as duas precisam estar abertas para sair uma mensagem:
 *  1) o cliente estar liberado no admin (quem não tem o recurso nunca entra aqui);
 *  2) o interruptor do servidor AVISOS_RESUMO (off | ensaio | piloto | todos), DESLIGADO por padrão. É próprio, e NÃO o AVISOS do aviso de
 *     vencimento: senão liberar um cliente obrigaria a ligar o vencimento para todo mundo, o que o Arthur suspendeu por medo de bloqueio
 *     do número (que não é oficial).
 *
 * Como o aviso de vencimento (avisos.ts), de quem herda as travas: roda no batimento; cada cliente recebe na hora que escolheu nos Ajustes
 * ("Hora dos lembretes"), dentro de uma janela, nunca depois das 21:30; UMA mensagem por pessoa por dia (reserva atômica na tabela `avisos`,
 * chave `dia:<id>:<data>`), então reinício ou dois minutos seguidos nunca mandam em dobro; envios espaçados, com teto por ciclo e no máximo
 * 3 falhas por pessoa por dia; falhou o envio, a reserva é solta. Só manda se houver conta hoje OU atrasada: dia sem nada não gera mensagem.
 *
 * Quem respondeu SAIR (avisos_off), pediu exclusão, ficou sem WhatsApp verificado ou sem acesso nunca recebe, e essas conferências são
 * repetidas aqui no código, de propósito: o recurso é pago e nunca pode ir a quem não está liberado nem a quem pediu para parar.
 *
 * Tudo aqui é função pura mais um executor com dependências injetadas, como avisos.ts: o teste roda a seco, com relógio e gateway falsos.
 */
import { brl, somaDias } from './consultas.ts'
import { acessoLiberado, dataSP, horaSP, lerConfig, MAX_FALHAS_DIA, MAX_LINHAS, naJanela, noPiloto, SILENCIO_MS, type ContaAviso, type DepsAvisos, type PerfilAviso } from './avisos.ts'
import { erroSeguro } from './seguranca.ts'

/** O nome do recurso na tabela recursos_cliente. */
export const RECURSO_RESUMO = 'resumo_diario_contas'

export type ModoResumo = 'off' | 'ensaio' | 'piloto' | 'todos'

export interface ConfigResumo {
  modo: ModoResumo
  /** Números (qualquer formato) ou ids de conta liberados no modo piloto: a mesma lista AVISOS_PILOTO do aviso de vencimento. */
  piloto: string[]
  janelaMin: number
  maxPorCiclo: number
  espacoMs: number
}

export function lerConfigResumo(e: Record<string, string | undefined> = process.env): ConfigResumo {
  const m = (e.AVISOS_RESUMO ?? 'off').trim().toLowerCase()
  const base = lerConfig(e)
  return { modo: m === 'ensaio' || m === 'piloto' || m === 'todos' ? m : 'off', piloto: base.piloto, janelaMin: base.janelaMin, maxPorCiclo: base.maxPorCiclo, espacoMs: base.espacoMs }
}

export interface PerfilResumo extends PerfilAviso {
  /** Respondeu SAIR: nunca mais recebe aviso automático. */
  avisos_off: boolean
}

export interface DepsResumo extends Pick<DepsAvisos, 'contas' | 'telefoneDe' | 'jaAvisadas' | 'reservar' | 'concluir' | 'enviar' | 'esperar'> {
  /**
   * Clientes COM o recurso, com WhatsApp verificado, cujo horário de lembrete já chegou (`lembrete_hora` <= hhmm).
   * Nunca devolve quem não tem o recurso. Tabela ausente (migration não rodou) = ninguém. Qualquer outro erro lança: o ciclo não envia nada.
   */
  liberados: (hhmm: string) => Promise<PerfilResumo[]>
}

export const chaveDoResumo = (userId: string, dia: string) => `dia:${userId}:${dia}`

/* ---------- texto ---------- */

export const MAX_ATRASADAS = 5

const diasDeAtraso = (venc: string, hoje: string) => Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${venc}T12:00:00Z`)) / 86_400_000)
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const mascarar = (tel: string) => `${tel.slice(0, 2)}${'*'.repeat(Math.max(0, tel.length - 6))}${tel.slice(-4)}`

/**
 * A mensagem. Sem emoji e sem travessão; sem valores quando a pessoa escolheu ocultar. Mostra até MAX_LINHAS contas de hoje e até
 * MAX_ATRASADAS atrasadas (as mais antigas primeiro) e diz quantas ficaram de fora. A sugestão é "o que vence", que o bot entende.
 */
export function montarResumo(p: Pick<PerfilAviso, 'nome' | 'ocultar'>, doDia: ContaAviso[], atrasadas: ContaAviso[], hoje: string): string {
  const nome = (p.nome ?? '').trim().split(/\s+/)[0]
  const oi = nome ? `Oi, ${nome}.` : 'Oi.'
  const valor = (c: ContaAviso) => (p.ocultar ? `- ${c.descricao}` : `- ${c.descricao}, ${brl(c.valor)}`)
  const hojeOrdenadas = [...doDia].sort((a, b) => a.descricao.localeCompare(b.descricao))
  const atrasOrdenadas = [...atrasadas].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao))
  const linhas: string[] = []

  if (hojeOrdenadas.length) {
    linhas.push(`${oi} ${hojeOrdenadas.length === 1 ? 'Esta conta vence hoje:' : 'Estas contas vencem hoje:'}`, '')
    for (const c of hojeOrdenadas.slice(0, MAX_LINHAS)) linhas.push(valor(c))
    const resto = hojeOrdenadas.length - MAX_LINHAS
    if (resto > 0) linhas.push(`E mais ${resto}. Veja no painel.`)
    if (!p.ocultar && hojeOrdenadas.length > 1) linhas.push('', `Total de hoje: ${brl(hojeOrdenadas.reduce((s, c) => s + c.valor, 0))}`)
  }

  if (atrasOrdenadas.length) {
    if (hojeOrdenadas.length) linhas.push('')
    linhas.push(hojeOrdenadas.length ? `Atrasadas (${atrasOrdenadas.length}):` : `${oi} Você tem ${atrasOrdenadas.length === 1 ? '1 conta atrasada' : `${atrasOrdenadas.length} contas atrasadas`}:`, '')
    for (const c of atrasOrdenadas.slice(0, MAX_ATRASADAS)) {
      const d = diasDeAtraso(c.vencimento, hoje)
      linhas.push(`${valor(c)}, venceu ${d <= 1 ? 'ontem' : `há ${d} dias`} (${ddmm(c.vencimento)})`)
    }
    const resto = atrasOrdenadas.length - MAX_ATRASADAS
    if (resto > 0) linhas.push(`E mais ${resto} atrasada${resto > 1 ? 's' : ''}. Veja no painel.`)
    if (!p.ocultar && atrasOrdenadas.length > 1) linhas.push('', `Total atrasado: ${brl(atrasOrdenadas.reduce((s, c) => s + c.valor, 0))}`)
  }

  const exemplo = (hojeOrdenadas[0] ?? atrasOrdenadas[0]).descricao.trim().toLowerCase()
  linhas.push('', `Para ver tudo, me pergunte "o que vence". Quando pagar, me avisa. Por exemplo: "paguei ${exemplo.length <= 28 ? exemplo : 'a conta'}".`)
  return linhas.join('\n')
}

/* ---------- estado do processo (para o /saude e para os testes) ---------- */

export const estadoResumo = {
  rodando: false,
  modo: 'off' as ModoResumo,
  ultimoCiclo: null as string | null,
  enviados: 0,
  falhas: 0,
  ultimoErro: null as string | null,
  falhasPorPessoa: new Map<string, { dia: string; n: number }>(),
  semNovidadeAte: new Map<string, number>(),
  /** Quem já foi resolvido hoje (enviado, ou já constava como enviado): não é consultado de novo a cada minuto. */
  resolvidoNoDia: new Map<string, string>(),
}
export function zerarEstadoResumo() {
  estadoResumo.rodando = false
  estadoResumo.modo = 'off'
  estadoResumo.ultimoCiclo = null
  estadoResumo.enviados = 0
  estadoResumo.falhas = 0
  estadoResumo.ultimoErro = null
  estadoResumo.falhasPorPessoa.clear()
  estadoResumo.semNovidadeAte.clear()
  estadoResumo.resolvidoNoDia.clear()
}

/* ---------- o ciclo ---------- */

export async function rodarResumo(d: DepsResumo, cfg: ConfigResumo, agora = new Date()): Promise<string[]> {
  estadoResumo.modo = cfg.modo
  if (cfg.modo === 'off') return []
  if (estadoResumo.rodando) return ['ciclo anterior ainda em andamento, pulei este']
  estadoResumo.rodando = true
  const log: string[] = []
  try {
    const hoje = dataSP(agora)
    const hhmm = horaSP(agora)
    estadoResumo.ultimoCiclo = agora.toISOString()
    const perfis = await d.liberados(hhmm)
    let usados = 0
    for (const p of perfis) {
      // Conferido de novo aqui, de propósito (ver o cabeçalho): SAIR, exclusão e acesso.
      if (p.exclusao_em || p.avisos_off || !acessoLiberado(p.assinatura, hoje)) continue
      if (cfg.modo === 'piloto' && !noPiloto(p, cfg.piloto)) continue
      if (!naJanela(hhmm, p.lembrete_hora, cfg.janelaMin)) continue
      if (estadoResumo.resolvidoNoDia.get(p.id) === hoje) continue
      const f = estadoResumo.falhasPorPessoa.get(p.id)
      if (f && f.dia === hoje && f.n >= MAX_FALHAS_DIA) continue
      if ((estadoResumo.semNovidadeAte.get(p.id) ?? 0) > agora.getTime()) continue

      const chave = chaveDoResumo(p.id, hoje)
      if ((await d.jaAvisadas(p.id, [chave])).has(chave)) {
        estadoResumo.resolvidoNoDia.set(p.id, hoje)
        continue
      }
      const doDia = await d.contas(p.id, hoje, hoje)
      const atrasadas = await d.contas(p.id, '2000-01-01', somaDias(hoje, -1))
      if (!doDia.length && !atrasadas.length) {
        estadoResumo.semNovidadeAte.set(p.id, agora.getTime() + SILENCIO_MS)
        continue
      }
      if (usados >= cfg.maxPorCiclo) {
        log.push('teto de envios por ciclo atingido: o resto fica para o minuto seguinte')
        break
      }
      const tel = await d.telefoneDe(p)
      if (!tel) {
        log.push(`sem número para o resumo da conta ${p.id}`)
        continue
      }
      if (cfg.modo === 'ensaio') {
        log.push(`ensaio: enviaria o resumo a ${mascarar(tel)} (${doDia.length} de hoje, ${atrasadas.length} atrasada${atrasadas.length === 1 ? '' : 's'})`)
        estadoResumo.semNovidadeAte.set(p.id, agora.getTime() + SILENCIO_MS) // sem isso o mesmo cliente se repetiria no log a cada minuto
        continue
      }

      // Espera ANTES de reservar: se o processo morrer dormindo, nada fica reservado sem ter saído.
      if (usados > 0) await d.esperar(cfg.espacoMs + Math.floor(Math.random() * 3000))
      const ganhas = await d.reservar(p.id, tel, [{ chave, referencia: hoje }])
      if (!ganhas.includes(chave)) {
        estadoResumo.resolvidoNoDia.set(p.id, hoje) // outro processo já reservou: não é para mandar de novo
        continue
      }
      usados++
      try {
        await d.enviar(tel, montarResumo(p, doDia, atrasadas, hoje))
        await d.concluir(p.id, [chave], true)
        estadoResumo.enviados++
        estadoResumo.resolvidoNoDia.set(p.id, hoje)
        log.push(`resumo enviado a ${mascarar(tel)} (${doDia.length} de hoje, ${atrasadas.length} atrasada${atrasadas.length === 1 ? '' : 's'})`)
      } catch (e) {
        await d.concluir(p.id, [chave], false).catch((e2) => log.push(`não consegui soltar a reserva: ${(e2 as Error).message}`))
        estadoResumo.falhas++
        estadoResumo.ultimoErro = erroSeguro((e as Error).message)
        const antes = estadoResumo.falhasPorPessoa.get(p.id)
        estadoResumo.falhasPorPessoa.set(p.id, { dia: hoje, n: antes && antes.dia === hoje ? antes.n + 1 : 1 })
        log.push(`falha ao enviar o resumo a ${mascarar(tel)}: ${estadoResumo.ultimoErro}`)
      }
    }
  } catch (e) {
    estadoResumo.ultimoErro = erroSeguro((e as Error).message)
    log.push(`erro no ciclo do resumo, nada enviado depois dele: ${estadoResumo.ultimoErro}`)
  } finally {
    estadoResumo.rodando = false
  }
  return log
}
