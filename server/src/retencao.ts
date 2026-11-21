/**
 * Lembretes de retenção: a Granninha chama quem confirmou o WhatsApp e nunca mandou nada (24 h depois), e quem parou de usar
 * (48 h depois). Pedido do Arthur em 2026-11-21, nos limites que ele aprovou: no máximo 15 por dia, 3 minutos entre um envio e
 * outro, só das 9h às 19h.
 *
 * Este é o ciclo que mais pode custar caro: sai pelo número que o Arthur tem medo de ver bloqueado, para gente que não pediu.
 * Por isso cada trava existe, e todas são FIXAS aqui no código (o admin muda modo, atraso e texto, nunca a proteção):
 * - EM DÚVIDA, NÃO ENVIA. Qualquer erro ao ler a configuração, os elegíveis, o estado do WhatsApp ou a contagem do dia encerra o
 *   ciclo sem enviar. Sem a migration (sem a tabela de configuração) as regras valem como desligadas. É o oposto do limite
 *   mensal, que cai para 300 e segue atendendo: aqui errar é mandar mensagem a mais.
 * - Um envio por ciclo, e a espera de 3 minutos é medida no BANCO, desde o último envio automático de QUALQUER tipo (vencimento,
 *   fim do teste ou retenção saem pelo mesmo chip). Não dorme: reinício do serviço não zera a espera.
 * - O teto do dia também é contado no banco. Janela das 9h às 19h (São Paulo). Nunca com o WhatsApp fora de CONNECTED.
 * - Só para quem escreveu para o número ATUAL (o filtro mora na função SQL retencao_elegiveis): contato frio é o que derruba
 *   número não oficial. Uma mensagem por pessoa por regra, para sempre (a reserva é um insert que só um processo ganha).
 * - Falhou o envio: solta a reserva e conta a falha. 3 falhas seguidas (qualquer pessoa) param os lembretes por 30 minutos.
 * - Toda mensagem termina com a linha do SAIR, que o admin não consegue tirar (ver `montarTextoRetencao`).
 * - Desligado por padrão. `ensaio` só escreve no log quem receberia. `piloto` manda ao Arthur UM exemplo por regra por dia, com o
 *   texto exato e para quem seria, sem reservar a chave do cliente. `todos` envia de verdade.
 *
 * Função pura mais executor com dependências injetadas (como avisos.ts): o teste roda a seco, com relógio e gateway falsos.
 */
import { dataSP, horaSP } from './avisos.ts'
import { limparSaida } from './seguranca.ts'

export type RegraRetencao = 'nunca_mandou' | 'parou_de_usar'
export type ModoRetencao = 'desligado' | 'ensaio' | 'piloto' | 'todos'

/* ---------- a proteção do número: fixa no código ---------- */
export const TETO_POR_DIA = 15
export const ESPERA_MINUTOS = 3
export const JANELA_DE = '09:00'
export const JANELA_ATE = '19:00'
export const FALHAS_SEGUIDAS_PARA_PARAR = 3
export const PAUSA_APOS_FALHAS_MS = 30 * 60_000
export const MAX_FALHAS_POR_PESSOA_DIA = 3
/** Quem está em ensaio não vê o mesmo nome repetido no log a cada minuto. */
export const SILENCIO_ENSAIO_MS = 10 * 60_000
export const RODAPE_SAIR = 'Para não receber mais lembretes meus, responda SAIR.'
const MAX_TEXTO = 700

export const REGRAS: RegraRetencao[] = ['nunca_mandou', 'parou_de_usar']
export const TIPO_AVISO: Record<RegraRetencao, 'retencao_nunca' | 'retencao_parou'> = { nunca_mandou: 'retencao_nunca', parou_de_usar: 'retencao_parou' }
export const chaveRetencao = (regra: RegraRetencao, userId: string) => `ret:${regra}:${userId}`

export interface ConfigRegra {
  regra: RegraRetencao
  modo: ModoRetencao
  atraso_horas: number
  texto: string
}

export interface Elegivel {
  user_id: string
  nome: string
  /** O número em que a pessoa escreveu por último: é o que o WhatsApp aceita (às vezes sem o nono dígito). */
  telefone: string | null
  whats: string
  horas: number
}

export interface DepsRetencao {
  /** Lança se não conseguir ler (inclusive migration ainda não rodada): o ciclo termina sem enviar. */
  configs: () => Promise<ConfigRegra[]>
  elegiveis: (regra: RegraRetencao, atrasoHoras: number) => Promise<Elegivel[]>
  gatewayConectado: () => Promise<boolean>
  /** O envio automático mais recente de QUALQUER tipo, e quantos lembretes de retenção já saíram desde `inicioDoDia`. */
  movimento: (inicioDoDia: string) => Promise<{ ultimoEnvioEm: string | null; retencaoHoje: number }>
  /** Insere a chave e devolve `true` só se ESTA chamada inseriu: quem reserva primeiro é quem envia. */
  reservar: (userId: string, regra: RegraRetencao, telefone: string) => Promise<boolean>
  /** `true` marca como enviado. `false` solta a reserva. */
  concluir: (userId: string, regra: RegraRetencao, enviado: boolean) => Promise<void>
  enviar: (telefone: string, texto: string) => Promise<void>
  /** Um aviso de vencimento ou de fim do teste está no meio do ciclo: este minuto não envia. */
  outroCicloAndando: () => boolean
  /** Números (qualquer formato) que recebem o exemplo no modo piloto. */
  piloto: string[]
  /** Grava para o admin ver: quando o ciclo rodou e o último erro. Falha aqui nunca derruba o ciclo. */
  registrarCiclo?: (infos: { em: string; erro: string | null }) => Promise<void>
}

/* ---------- texto ---------- */

const primeiroNome = (nome: string) => (nome ?? '').trim().split(/\s+/)[0] ?? ''

/**
 * O texto que sai. `{nome}` vira o primeiro nome (sem nome, a vírgula some: "Oi, !" vira "Oi!"). Travessão vira vírgula e link
 * que não é nosso é apagado, por garantia (o admin já não consegue gravar nenhum dos dois). A linha do SAIR é SEMPRE a última,
 * e é o servidor que a escreve.
 */
export function montarTextoRetencao(texto: string, nome: string): string {
  let t = texto.replace(/\{nome\}/gi, primeiroNome(nome))
  t = t.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*([!.,?])/g, '$1').replace(/\s+([!.,?])/g, '$1')
  t = limparSaida(t, MAX_TEXTO - RODAPE_SAIR.length - 2).texto
  return `${t}\n\n${RODAPE_SAIR}`
}

const ACENTOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')
/** "sair", "SAIR", "Sair.", "sáir!" ... a palavra sozinha, sem diferença de acento, maiúscula ou pontuação. Nada de "quero sair do plano". */
export function ehSair(texto: string): boolean {
  const t = (texto ?? '').replace(/[.!?,;:]+/g, '').trim()
  return /^\S+$/.test(t) && t.normalize('NFD').replace(ACENTOS, '').toLowerCase() === 'sair'
}
export const TEXTO_SAIR =
  'Pronto. Não vou mais te mandar lembretes para usar a Granninha. Os avisos de conta vencendo, que você configurou nos Ajustes, continuam. Quando quiser anotar algo, é só me chamar.'

/* ---------- relógio ---------- */

const minutos = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1
}
/** Entre 09:00 (inclusive) e 19:00 (exclusive), pelo relógio de São Paulo. */
export function naJanelaDeEnvio(hhmm: string): boolean {
  const m = minutos(hhmm)
  return m >= minutos(JANELA_DE) && m < minutos(JANELA_ATE)
}
/** Meia-noite de São Paulo (sem horário de verão desde 2019, UTC-3), como instante. */
export const inicioDoDiaSP = (agora: Date) => `${dataSP(agora)}T00:00:00-03:00`

const mascarar = (tel: string) => `${tel.slice(0, 2)}${'*'.repeat(Math.max(0, tel.length - 6))}${tel.slice(-4)}`

/* ---------- estado do processo (para o /saude e para os testes) ---------- */

export const estado = {
  rodando: false,
  ultimoCiclo: null as string | null,
  enviados: 0,
  falhas: 0,
  falhasSeguidas: 0,
  pausaAte: 0,
  ultimoErro: null as string | null,
  ultimoEnvioMs: 0,
  falhasPorPessoa: new Map<string, { dia: string; n: number }>(),
  ensaioVistoEm: new Map<string, number>(),
  pilotoDia: new Map<RegraRetencao, string>(),
}
export function zerarEstado() {
  estado.rodando = false
  estado.ultimoCiclo = null
  estado.enviados = 0
  estado.falhas = 0
  estado.falhasSeguidas = 0
  estado.pausaAte = 0
  estado.ultimoErro = null
  estado.ultimoEnvioMs = 0
  estado.falhasPorPessoa.clear()
  estado.ensaioVistoEm.clear()
  estado.pilotoDia.clear()
}

/* ---------- o ciclo ---------- */

export async function rodarRetencao(d: DepsRetencao, agora = new Date()): Promise<string[]> {
  if (estado.rodando) return ['ciclo anterior ainda em andamento, pulei este']
  estado.rodando = true
  const log: string[] = []
  let erro: string | null = null
  let ativo = false
  try {
    // 1) Configuração. Sem ler, não envia: sem a tabela (migration não rodou) as regras valem como desligadas.
    const ativas = (await d.configs()).filter((c) => c.modo !== 'desligado')
    if (!ativas.length) return log
    ativo = true
    estado.ultimoCiclo = agora.toISOString()

    // 2) Condições do momento. Qualquer uma que falhe encerra o ciclo em silêncio, sem enviar.
    if (d.outroCicloAndando()) return log
    if (!naJanelaDeEnvio(horaSP(agora))) return log
    if (agora.getTime() < estado.pausaAte) return log
    if (!(await d.gatewayConectado())) {
      log.push('WhatsApp fora de CONNECTED: nenhum lembrete enviado')
      return log
    }
    const mov = await d.movimento(inicioDoDiaSP(agora))
    if (mov.retencaoHoje >= TETO_POR_DIA) {
      log.push(`teto do dia atingido (${mov.retencaoHoje} de ${TETO_POR_DIA}): o resto fica para amanhã`)
      return log
    }
    const noBanco = mov.ultimoEnvioEm ? Date.parse(mov.ultimoEnvioEm) : 0
    if (Number.isNaN(noBanco)) {
      log.push('data do último envio ilegível: nenhum lembrete enviado')
      return log
    }
    if (agora.getTime() - Math.max(noBanco, estado.ultimoEnvioMs) < ESPERA_MINUTOS * 60_000) return log

    // 3) Escolhe UM lembrete (o do cliente que espera há mais tempo) e envia.
    const hoje = dataSP(agora)
    for (const cfg of ativas) {
      const lista = await d.elegiveis(cfg.regra, cfg.atraso_horas)
      const candidatos = lista.filter((c) => {
        const f = estado.falhasPorPessoa.get(c.user_id)
        return !!c.telefone && !(f && f.dia === hoje && f.n >= MAX_FALHAS_POR_PESSOA_DIA)
      })

      if (cfg.modo === 'ensaio') {
        for (const c of candidatos) {
          const k = `${cfg.regra}:${c.user_id}`
          if ((estado.ensaioVistoEm.get(k) ?? 0) > agora.getTime()) continue
          estado.ensaioVistoEm.set(k, agora.getTime() + SILENCIO_ENSAIO_MS)
          log.push(`ensaio (${cfg.regra}): enviaria a ${mascarar(c.telefone!)} (${primeiroNome(c.nome) || 'sem nome'}, ${c.horas} h)`)
        }
        continue
      }

      if (cfg.modo === 'piloto') {
        if (estado.pilotoDia.get(cfg.regra) === hoje) continue
        const alvo = candidatos[0]
        const para = d.piloto.map((p) => p.replace(/\D/g, '')).find((p) => p.length >= 10)
        if (!alvo || !para) {
          if (alvo && !para) log.push(`piloto (${cfg.regra}): sem número do piloto configurado, nada enviado`)
          continue
        }
        const exemplo = `[PILOTO] Este lembrete iria para ${primeiroNome(alvo.nome) || 'um cliente'} (${alvo.horas} h sem mensagem). Nada foi enviado a ele. O texto exato:\n\n${montarTextoRetencao(cfg.texto, alvo.nome)}`
        await d.enviar(para, exemplo)
        estado.pilotoDia.set(cfg.regra, hoje)
        estado.ultimoEnvioMs = agora.getTime()
        estado.enviados++
        log.push(`piloto (${cfg.regra}): exemplo enviado a ${mascarar(para)}`)
        return log // um envio por ciclo
      }

      // todos
      for (const c of candidatos) {
        const tel = c.telefone!
        if (!(await d.reservar(c.user_id, cfg.regra, tel))) continue
        try {
          await d.enviar(tel, montarTextoRetencao(cfg.texto, c.nome))
          await d.concluir(c.user_id, cfg.regra, true)
          estado.enviados++
          estado.falhasSeguidas = 0
          estado.ultimoEnvioMs = agora.getTime()
          log.push(`${cfg.regra}: enviado a ${mascarar(tel)}`)
        } catch (e) {
          await d.concluir(c.user_id, cfg.regra, false).catch((e2) => log.push(`não consegui soltar a reserva: ${(e2 as Error).message}`))
          estado.falhas++
          estado.falhasSeguidas++
          estado.ultimoErro = (e as Error).message.slice(0, 200)
          erro = estado.ultimoErro
          const antes = estado.falhasPorPessoa.get(c.user_id)
          estado.falhasPorPessoa.set(c.user_id, { dia: hoje, n: antes && antes.dia === hoje ? antes.n + 1 : 1 })
          log.push(`falha ao enviar a ${mascarar(tel)}: ${estado.ultimoErro}`)
          if (estado.falhasSeguidas >= FALHAS_SEGUIDAS_PARA_PARAR) {
            estado.pausaAte = agora.getTime() + PAUSA_APOS_FALHAS_MS
            log.push(`${estado.falhasSeguidas} falhas seguidas: lembretes parados por ${PAUSA_APOS_FALHAS_MS / 60_000} minutos`)
          }
        }
        return log // um envio por ciclo, deu certo ou não
      }
    }
  } catch (e) {
    erro = (e as Error).message.slice(0, 200)
    estado.ultimoErro = erro
    log.push(`erro no ciclo, nada enviado depois dele: ${erro}`)
  } finally {
    estado.rodando = false
    if (ativo && d.registrarCiclo) await d.registrarCiclo({ em: agora.toISOString(), erro }).catch(() => undefined)
  }
  return log
}
