/**
 * Aviso de conta vencendo, no dia e na hora que o cliente escolheu nos Ajustes ("Hora dos lembretes" e
 * "Só no dia / 1 dia antes / 3 dias antes"). É a fase f4 do backlog: até 2026-11-20 essas preferências eram
 * gravadas e nada as lia, então a Granninha prometia um aviso que nunca saía.
 *
 * Como funciona, e por que cada trava existe:
 * - Roda a cada minuto, junto do batimento. Quem escolheu 09:00 recebe entre 09:00 e 12:00 (AVISOS_JANELA_MIN):
 *   cobre um reinício do serviço, mas passou da janela o aviso do dia se perde em vez de chegar à tarde falando
 *   de "hoje". Nunca depois das 21:30.
 * - Avisa as contas A PAGAR abertas que vencem de hoje até hoje + antecedência. Quem anota uma conta depois do
 *   dia do lembrete ainda é avisado uma vez, se ela não venceu.
 * - Cada conta é avisada UMA vez (por conta e vencimento). O registro vive na tabela `avisos`: reservar é um
 *   insert que só um processo ganha, então reinício, dois processos ou dois minutos seguidos nunca mandam em
 *   dobro. Sem a tabela (migration não rodou) NADA é enviado: sem o registro, o risco é mandar em dobro.
 * - Uma mensagem por pessoa por ciclo, com tudo que vence. Envios espaçados e com teto por ciclo: número não
 *   oficial que dispara demais é banido (item f4-ritmo do backlog).
 * - Falhou o envio: a reserva é solta e o minuto seguinte tenta de novo, no máximo 3 vezes por pessoa por dia.
 *   Nunca fica "enviado" sem ter saído.
 * - Desligado por padrão. AVISOS=ensaio só escreve no log o que enviaria; piloto envia só para os números (ou
 *   ids) de AVISOS_PILOTO; todos envia para todo cliente elegível.
 *
 * Tudo aqui é função pura mais um executor com dependências injetadas (como presas.ts): o teste roda a seco,
 * com relógio e gateway falsos.
 */
import { brl, somaDias } from './consultas.ts'

export type Modo = 'off' | 'ensaio' | 'piloto' | 'todos'

export interface ConfigAvisos {
  modo: Modo
  /** Números (qualquer formato) ou ids de conta liberados no modo piloto. */
  piloto: string[]
  janelaMin: number
  maxPorCiclo: number
  espacoMs: number
}

const num = (v: string | undefined, padrao: number) => {
  const n = Number(v)
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : padrao
}

export function lerConfig(e: Record<string, string | undefined> = process.env): ConfigAvisos {
  const m = (e.AVISOS ?? 'off').trim().toLowerCase()
  return {
    modo: m === 'ensaio' || m === 'piloto' || m === 'todos' ? m : 'off',
    piloto: (e.AVISOS_PILOTO ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    janelaMin: num(e.AVISOS_JANELA_MIN, 180),
    maxPorCiclo: num(e.AVISOS_MAX_POR_CICLO, 15),
    espacoMs: num(e.AVISOS_ESPACO_MS, 5000),
  }
}

export interface PerfilAviso {
  id: string
  nome: string
  whats: string
  whats_chave: string | null
  lembrete_hora: string
  antecedencia: number
  ocultar: boolean
  exclusao_em: string | null
  assinatura: { status: string; trial_fim: string | null } | null
}

export interface ContaAviso {
  id: string
  descricao: string
  valor: number
  vencimento: string
}

export interface Reserva {
  chave: string
  referencia: string
}

export interface DepsAvisos {
  /** Clientes com número verificado cujo horário de lembrete já chegou (`lembrete_hora` <= hhmm). */
  perfis: (hhmm: string) => Promise<PerfilAviso[]>
  /** Contas a pagar, abertas, com vencimento entre `de` e `ate` (inclusive). */
  contas: (userId: string, de: string, ate: string) => Promise<ContaAviso[]>
  /** Para onde mandar: o número exato em que a pessoa escreveu por último (o WhatsApp às vezes omite o nono dígito). */
  telefoneDe: (p: PerfilAviso) => Promise<string | null>
  jaAvisadas: (userId: string, chaves: string[]) => Promise<Set<string>>
  /** Insere as chaves e devolve só as que ESTA chamada inseriu: quem reserva primeiro é quem envia. */
  reservar: (userId: string, telefone: string, itens: Reserva[]) => Promise<string[]>
  /** `true` marca como enviadas. `false` solta a reserva, para o minuto seguinte tentar de novo. */
  concluir: (userId: string, chaves: string[], enviado: boolean) => Promise<void>
  enviar: (telefone: string, texto: string) => Promise<void>
  esperar: (ms: number) => Promise<void>
}

/* ---------- relógio de São Paulo ---------- */

const FUSO = 'America/Sao_Paulo'
export const dataSP = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: FUSO })
export const horaSP = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
const minutos = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
export const LIMITE_NOITE_MIN = 21 * 60 + 30
const HORA_PADRAO = '09:00'

/** Agora está entre a hora escolhida e a hora escolhida + janela, e ainda não é noite? */
export function naJanela(agoraHHMM: string, horaEscolhida: string, janelaMin: number): boolean {
  const agora = minutos(agoraHHMM)
  const pref = minutos(horaEscolhida) ?? minutos(HORA_PADRAO)!
  if (agora === null || agora > LIMITE_NOITE_MIN) return false
  return agora >= pref && agora <= pref + janelaMin
}

/** Mesma regra de public.acesso_liberado(): em dia, em atraso (24h de carência) ou teste dentro do prazo. */
export function acessoLiberado(a: PerfilAviso['assinatura'], hoje: string): boolean {
  if (!a) return false
  return a.status === 'ativa' || a.status === 'atrasada' || (a.status === 'trial' && !!a.trial_fim && a.trial_fim >= hoje)
}

/** Mesma regra de banco.chaveDoNumero (um teste confere que as duas não se afastam): DDD + 8 últimos dígitos. */
export function chaveDoTelefone(entrada: string): string | null {
  let d = entrada.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length < 10) return null
  return d.slice(0, 2) + d.slice(-8)
}

export function noPiloto(p: Pick<PerfilAviso, 'id' | 'whats_chave'>, piloto: string[]): boolean {
  return piloto.some((x) => x === p.id || (/^[\d\s()+-]+$/.test(x) && !!p.whats_chave && chaveDoTelefone(x) === p.whats_chave))
}

export const chaveDoAviso = (userId: string, c: Pick<ContaAviso, 'id' | 'vencimento'>) => `venc:${userId}:${c.id}:${c.vencimento}`

const mascarar = (tel: string) => `${tel.slice(0, 2)}${'*'.repeat(Math.max(0, tel.length - 6))}${tel.slice(-4)}`

/* ---------- texto ---------- */

const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
function rotuloDia(d: string, hoje: string): string {
  if (d === hoje) return 'Hoje'
  if (d === somaDias(hoje, 1)) return 'Amanhã'
  const w = NOMES_DIA[new Date(d + 'T12:00:00Z').getUTCDay()]
  return `${w[0].toUpperCase()}${w.slice(1)}, ${d.slice(8, 10)}/${d.slice(5, 7)}`
}

export const MAX_LINHAS = 8

/** A mensagem do aviso. Sem emoji, sem travessão, e sem valores quando a pessoa escolheu ocultar. */
export function montarTexto(p: Pick<PerfilAviso, 'nome' | 'ocultar'>, contas: ContaAviso[], hoje: string): string {
  const ordenadas = [...contas].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao))
  const nome = (p.nome ?? '').trim().split(/\s+/)[0]
  const linhas: string[] = [`${nome ? `Oi, ${nome}.` : 'Oi.'} ${ordenadas.length === 1 ? 'Tem uma conta vencendo:' : 'Estas contas estão vencendo:'}`]
  const mostradas = ordenadas.slice(0, MAX_LINHAS)
  let dia = ''
  for (const c of mostradas) {
    if (c.vencimento !== dia) {
      dia = c.vencimento
      linhas.push('', rotuloDia(dia, hoje))
    }
    linhas.push(p.ocultar ? `- ${c.descricao}` : `- ${c.descricao}, ${brl(c.valor)}`)
  }
  const resto = ordenadas.length - mostradas.length
  if (resto > 0) linhas.push('', `E mais ${resto}. Veja no painel.`)
  if (!p.ocultar && ordenadas.length > 1) linhas.push('', `Total: ${brl(ordenadas.reduce((s, c) => s + c.valor, 0))}`)
  const exemplo = ordenadas[0].descricao.trim().toLowerCase()
  linhas.push('', `Quando pagar, me avisa. Por exemplo: "paguei ${exemplo.length <= 28 ? exemplo : 'a conta'}".`)
  return linhas.join('\n')
}

/* ---------- estado do processo (para o /saude e para os testes) ---------- */

export const MAX_FALHAS_DIA = 3
/** Quem não tinha nada novo para avisar não é consultado de novo a cada minuto. */
export const SILENCIO_MS = 5 * 60_000

export const estado = {
  rodando: false,
  modo: 'off' as Modo,
  ultimoCiclo: null as string | null,
  enviados: 0,
  falhas: 0,
  ultimoErro: null as string | null,
  falhasPorPessoa: new Map<string, { dia: string; n: number }>(),
  semNovidadeAte: new Map<string, number>(),
}
export function zerarEstado() {
  estado.rodando = false
  estado.modo = 'off'
  estado.ultimoCiclo = null
  estado.enviados = 0
  estado.falhas = 0
  estado.ultimoErro = null
  estado.falhasPorPessoa.clear()
  estado.semNovidadeAte.clear()
}

/* ---------- o ciclo ---------- */

export async function rodarAvisos(d: DepsAvisos, cfg: ConfigAvisos, agora = new Date()): Promise<string[]> {
  estado.modo = cfg.modo
  if (cfg.modo === 'off') return []
  if (estado.rodando) return ['ciclo anterior ainda em andamento, pulei este']
  estado.rodando = true
  const log: string[] = []
  try {
    const hoje = dataSP(agora)
    const hhmm = horaSP(agora)
    estado.ultimoCiclo = agora.toISOString()
    if ((minutos(hhmm) ?? 0) > LIMITE_NOITE_MIN) return log
    const perfis = await d.perfis(hhmm)
    let usados = 0
    for (const p of perfis) {
      if (p.exclusao_em || !acessoLiberado(p.assinatura, hoje)) continue
      if (cfg.modo === 'piloto' && !noPiloto(p, cfg.piloto)) continue
      if (!naJanela(hhmm, p.lembrete_hora, cfg.janelaMin)) continue
      const f = estado.falhasPorPessoa.get(p.id)
      if (f && f.dia === hoje && f.n >= MAX_FALHAS_DIA) continue
      if ((estado.semNovidadeAte.get(p.id) ?? 0) > agora.getTime()) continue
      if (usados >= cfg.maxPorCiclo) {
        log.push('teto de envios por ciclo atingido: o resto fica para o minuto seguinte')
        break
      }

      const antecedencia = Math.min(7, Math.max(0, Math.trunc(Number(p.antecedencia) || 0)))
      const contas = await d.contas(p.id, hoje, somaDias(hoje, antecedencia))
      const todas = contas.map((c) => ({ c, chave: chaveDoAviso(p.id, c) }))
      const ja = todas.length ? await d.jaAvisadas(p.id, todas.map((x) => x.chave)) : new Set<string>()
      const novas = todas.filter((x) => !ja.has(x.chave))
      if (!novas.length) {
        estado.semNovidadeAte.set(p.id, agora.getTime() + SILENCIO_MS)
        continue
      }
      const tel = await d.telefoneDe(p)
      if (!tel) {
        log.push(`sem número para avisar a conta ${p.id}`)
        continue
      }
      if (cfg.modo === 'ensaio') {
        log.push(`ensaio: enviaria a ${mascarar(tel)} (${novas.length} conta${novas.length > 1 ? 's' : ''})`)
        estado.semNovidadeAte.set(p.id, agora.getTime() + SILENCIO_MS) // sem isso o mesmo cliente se repetiria no log a cada minuto
        continue
      }

      // Espera ANTES de reservar: se o processo morrer dormindo, nada fica reservado sem ter saído.
      if (usados > 0) await d.esperar(cfg.espacoMs + Math.floor(Math.random() * 3000))
      const ganhas = new Set(await d.reservar(p.id, tel, novas.map((x) => ({ chave: x.chave, referencia: x.c.vencimento }))))
      const meus = novas.filter((x) => ganhas.has(x.chave))
      if (!meus.length) continue
      usados++
      try {
        await d.enviar(tel, montarTexto(p, meus.map((x) => x.c), hoje))
        await d.concluir(p.id, meus.map((x) => x.chave), true)
        estado.enviados++
        log.push(`enviado a ${mascarar(tel)} (${meus.length} conta${meus.length > 1 ? 's' : ''})`)
      } catch (e) {
        await d.concluir(p.id, meus.map((x) => x.chave), false).catch((e2) => log.push(`não consegui soltar a reserva: ${(e2 as Error).message}`))
        estado.falhas++
        estado.ultimoErro = (e as Error).message.slice(0, 200)
        const antes = estado.falhasPorPessoa.get(p.id)
        estado.falhasPorPessoa.set(p.id, { dia: hoje, n: antes && antes.dia === hoje ? antes.n + 1 : 1 })
        log.push(`falha ao enviar a ${mascarar(tel)}: ${estado.ultimoErro}`)
      }
    }
  } catch (e) {
    estado.ultimoErro = (e as Error).message.slice(0, 200)
    log.push(`erro no ciclo, nada enviado depois dele: ${estado.ultimoErro}`)
  } finally {
    estado.rodando = false
  }
  return log
}
