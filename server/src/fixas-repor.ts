/**
 * Reposição das contas fixas (item f4-fixas-repor).
 *
 * Uma conta fixa ("aluguel todo dia 10") só cria as 3 primeiras ocorrências quando é cadastrada, pelo painel, pelo onboarding ou pelo WhatsApp, e
 * nada criava as seguintes: depois de uns 3 meses o aluguel parava de aparecer em Contas, no "o que vence" e no resumo diário, sem aviso.
 * Este passo, uma vez por dia, mantém as ocorrências até o mês atual + 2 (os mesmos 3 meses do cadastro).
 *
 * As regras abaixo existem porque este passo ESCREVE dado de todos os clientes:
 *  - repõe só os meses DEPOIS da última ocorrência da fixa. Nunca preenche buraco: se a pessoa apagou o mês de dezembro para pular, ele não volta.
 *    (Consequência conhecida: apagar a ocorrência mais recente a faz voltar no dia seguinte. Resolver isso pede uma coluna nova por fixa.);
 *  - NUNCA cria vencimento no passado. Uma conta fixa abandonada, com a última ocorrência em agosto, não vira "atrasada" de setembro e outubro:
 *    só entram os meses que ainda não venceram;
 *  - fixa sem nenhuma ocorrência é pulada: a pessoa apagou todas, de propósito;
 *  - o molde (tipo pagar ou receber, categoria, DAS) vem da última ocorrência, porque a tabela de fixas não guarda o tipo; descrição, valor e dia
 *    vêm da fixa, que o painel mantém em dia;
 *  - o id é determinístico (`rep-<fixa>-<AAAA-MM>`) e a gravação ignora duplicados: rodar de novo, reiniciar o serviço ou dois processos ao mesmo
 *    tempo nunca criam a mesma conta duas vezes;
 *  - no máximo 3 por fixa e 500 por volta; conta que pediu exclusão e conta de admin ficam de fora;
 *  - o painel grava por DIFERENÇA (o que mudou e o que sumiu da lista dele), então as linhas criadas aqui não são apagadas por um painel aberto.
 *
 * REPOR_FIXAS=off desliga; =ensaio só calcula e conta, sem gravar; padrão: todos.
 * Função pura mais um executor com dependências injetadas, como avisos.ts: o teste roda a seco.
 */
import { somaMeses, vencimentoNoMes } from './datas.ts'
import { erroSeguro } from './seguranca.ts'

export type ModoRepor = 'off' | 'ensaio' | 'todos'
export function lerModoRepor(e: Record<string, string | undefined> = process.env): ModoRepor {
  const m = (e.REPOR_FIXAS ?? 'todos').trim().toLowerCase()
  return m === 'off' || m === 'ensaio' ? m : 'todos'
}

/** Mês atual + 2: os mesmos 3 meses que o cadastro cria. */
export const HORIZONTE_MESES = 2
export const MAX_POR_FIXA = 3
export const MAX_POR_VOLTA = 500
/** Quantos clientes por consulta de ocorrências. */
const LOTE_CLIENTES = 20

export interface FixaRep {
  user_id: string
  id: string
  descricao: string
  valor: number
  dia: number
}
export interface OcorrenciaRep {
  user_id: string
  fixa_id: string
  vencimento: string
  tipo: 'pagar' | 'receber'
  categoria_id: string | null
  das: boolean
}
export interface NovaConta {
  user_id: string
  id: string
  tipo: 'pagar' | 'receber'
  descricao: string
  valor: number
  vencimento: string
  status: 'aberta'
  categoria_id: string | null
  fixa_id: string
  das: boolean
}

export const idReposto = (fixaId: string, ym: string) => `rep-${fixaId}-${ym}`

/** As contas que faltam para UMA fixa. `ocorrencias` são todas as dela, de qualquer status. Vazio se não há o que repor. */
export function reporFixa(fixa: FixaRep, ocorrencias: OcorrenciaRep[], hoje: string): NovaConta[] {
  if (!ocorrencias.length) return []
  if (!Number.isInteger(fixa.dia) || fixa.dia < 1 || fixa.dia > 31 || !(fixa.valor > 0) || !fixa.descricao?.trim()) return []
  const ultima = ocorrencias.reduce((a, b) => (b.vencimento > a.vencimento ? b : a))
  const ate = somaMeses(hoje.slice(0, 7), HORIZONTE_MESES)
  const out: NovaConta[] = []
  for (let ym = somaMeses(ultima.vencimento.slice(0, 7), 1); ym <= ate; ym = somaMeses(ym, 1)) {
    const vencimento = vencimentoNoMes(ym, fixa.dia)
    if (vencimento < hoje) continue // nunca cria vencimento no passado
    out.push({
      user_id: fixa.user_id, id: idReposto(fixa.id, ym), tipo: ultima.tipo, descricao: fixa.descricao.trim(), valor: fixa.valor, vencimento, status: 'aberta',
      categoria_id: ultima.categoria_id, fixa_id: fixa.id, das: ultima.das,
    })
    if (out.length >= MAX_POR_FIXA) break
  }
  return out
}

export interface DepsRepor {
  /** Fixas de contas de cliente que NÃO pediram exclusão. */
  fixas: () => Promise<FixaRep[]>
  /** Todas as ocorrências (contas com fixa_id) destes clientes, de qualquer status. */
  ocorrencias: (userIds: string[]) => Promise<OcorrenciaRep[]>
  /** Grava ignorando duplicados e devolve quantas linhas ESTA chamada criou. */
  gravar: (linhas: NovaConta[]) => Promise<number>
}

export interface ResultadoRepor {
  modo: ModoRepor
  fixas: number
  semOcorrencia: number
  aCriar: number
  criadas: number
  limitado: boolean
  amostra: NovaConta[]
  erros: string[]
}

export const estadoReposicao = {
  modo: 'todos' as ModoRepor,
  ultimoCiclo: null as string | null,
  fixasLidas: 0,
  criadasDesdeInicio: 0,
  ultimoErro: null as string | null,
}
export function zerarEstadoReposicao() {
  estadoReposicao.modo = 'todos'
  estadoReposicao.ultimoCiclo = null
  estadoReposicao.fixasLidas = 0
  estadoReposicao.criadasDesdeInicio = 0
  estadoReposicao.ultimoErro = null
}

export async function reporContasFixas(d: DepsRepor, hoje: string, modo: ModoRepor): Promise<ResultadoRepor> {
  const r: ResultadoRepor = { modo, fixas: 0, semOcorrencia: 0, aCriar: 0, criadas: 0, limitado: false, amostra: [], erros: [] }
  estadoReposicao.modo = modo
  if (modo === 'off') return r
  estadoReposicao.ultimoCiclo = new Date().toISOString()
  try {
    const fixas = await d.fixas()
    r.fixas = fixas.length
    estadoReposicao.fixasLidas = fixas.length
    const porCliente = new Map<string, FixaRep[]>()
    for (const f of fixas) porCliente.set(f.user_id, [...(porCliente.get(f.user_id) ?? []), f])
    const clientes = [...porCliente.keys()]
    const novas: NovaConta[] = []
    for (let i = 0; i < clientes.length && !r.limitado; i += LOTE_CLIENTES) {
      const lote = clientes.slice(i, i + LOTE_CLIENTES)
      // A chave inclui o cliente: o id de uma fixa ("fx-aluguel") se repete entre clientes diferentes.
      const porFixa = new Map<string, OcorrenciaRep[]>()
      for (const o of await d.ocorrencias(lote)) {
        const k = `${o.user_id}|${o.fixa_id}`
        porFixa.set(k, [...(porFixa.get(k) ?? []), o])
      }
      for (const uid of lote) {
        for (const f of porCliente.get(uid) ?? []) {
          const ocs = porFixa.get(`${f.user_id}|${f.id}`) ?? []
          if (!ocs.length) {
            r.semOcorrencia++
            continue
          }
          novas.push(...reporFixa(f, ocs, hoje))
          if (novas.length >= MAX_POR_VOLTA) {
            r.limitado = true
            break
          }
        }
        if (r.limitado) break
      }
    }
    const alvo = novas.slice(0, MAX_POR_VOLTA)
    r.aCriar = alvo.length
    r.amostra = alvo.slice(0, 5)
    if (modo === 'todos' && alvo.length) {
      r.criadas = await d.gravar(alvo)
      estadoReposicao.criadasDesdeInicio += r.criadas
    }
    estadoReposicao.ultimoErro = null
  } catch (e) {
    r.erros.push(erroSeguro((e as Error).message))
    estadoReposicao.ultimoErro = r.erros[0]
  }
  return r
}
