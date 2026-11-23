import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { rpc } from '../../sb'

/** O banco ainda não tem a função (migration não aplicada). Aparece como página avisando, nunca como tela em branco. */
const FUNCAO_AUSENTE = /could not find the function|schema cache|does not exist|PGRST202/i

export interface Leitura<T> {
  dados: T | null
  erro: string
  /** A função existe no código mas ainda não foi aplicada no banco. */
  ausente: boolean
  /** Buscando agora. Com `dados` já preenchido, é uma atualização por cima do que está na tela. */
  carregando: boolean
}

/** Lê uma função do banco, repete a cada `cadaMs` (0 = só quando os argumentos mudam). */
export function useRpc<T>(nome: string, args: Record<string, unknown> = {}, cadaMs = 0): Leitura<T> {
  const chave = JSON.stringify(args)
  const [r, setR] = useState<Leitura<T>>({ dados: null, erro: '', ausente: false, carregando: true })
  useEffect(() => {
    let vivo = true
    setR((x) => ({ ...x, carregando: true }))
    const ler = () =>
      rpc<T>(nome, JSON.parse(chave) as Record<string, unknown>)
        .then((d) => vivo && setR({ dados: d, erro: '', ausente: false, carregando: false }))
        .catch((e: Error) => vivo && setR({ dados: null, erro: e.message, ausente: FUNCAO_AUSENTE.test(e.message), carregando: false }))
    void ler()
    const t = cadaMs ? setInterval(ler, cadaMs) : undefined
    return () => {
      vivo = false
      if (t) clearInterval(t)
    }
  }, [nome, chave, cadaMs])
  return r
}

/** Em qual migration cada função do admin nasce, para o aviso apontar o arquivo certo. */
const MIGRATION_DA_FUNCAO: Record<string, string> = {
  admin_acoes: '20261121150000_admin_acoes_retencao_publico.sql',
  admin_retencao: '20261121150000_admin_acoes_retencao_publico.sql',
  admin_publico: '20261121150000_admin_acoes_retencao_publico.sql',
  admin_custo_periodo: '20261121140000_admin_visao_geral.sql',
  admin_ativacao: '20261121140000_admin_visao_geral.sql',
  admin_receita: '20261121140000_admin_visao_geral.sql',
  admin_origens: '20261116210000_admin_origens.sql',
  admin_midias_mes: '20261116200000_admin_midias.sql',
  admin_custo_ia: '20261116093000_admin_custo.sql',
  admin_retencao_config: '20261121210000_retencao.sql',
  admin_retencao_previa: '20261121210000_retencao.sql',
  admin_retencao_definir: '20261121210000_retencao.sql',
  admin_retencao_acompanhar: '20261122120000_retencao_acompanhar.sql',
}

export function Ausente({ nome }: { nome: string }) {
  return (
    <div className="vaviso" role="alert">
      <TriangleAlert size={20} style={{ flex: 'none' }} />
      <span>
        Esta página usa a função <b>{nome}</b>, que ainda não foi aplicada no banco. Falta rodar a migration <b>{MIGRATION_DA_FUNCAO[nome] ?? 'do admin'}</b>.
      </span>
    </div>
  )
}

export const n = (x: number) => x.toLocaleString('pt-BR')
export const pct = (parte: number, todo: number) => (todo > 0 ? `${Math.round((parte / todo) * 100)}%` : '–')

/** Reais para valor de eixo: curto e sem perder os centavos quando o valor é pequeno. */
export const reaisCurto = (x: number) =>
  x >= 1000 ? `R$ ${(x / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : x >= 100 ? `R$ ${Math.round(x)}` : `R$ ${x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
/** "2026-11" → "Novembro de 2026" */
export function mesRotulo(ym: string) {
  const [a, m] = ym.split('-').map(Number)
  const nome = MESES[m - 1] ?? ym
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${a}`
}

/** Hoje em São Paulo, "AAAA-MM-DD". */
export const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

/** Seleção do filtro de período → datas. "30d" = últimos 30 dias; "AAAA-MM" = o mês inteiro. */
export function periodoDe(sel: string): { inicio: string; fim: string } {
  const hoje = hojeSP()
  if (sel === '30d') {
    const d = new Date(`${hoje}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 29)
    return { inicio: d.toISOString().slice(0, 10), fim: hoje }
  }
  const [a, m] = sel.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { inicio: `${sel}-01`, fim: `${sel}-${String(ultimo).padStart(2, '0')}` }
}

export const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
export const diaLongo = (d: string) => `${new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })}, ${diaCurto(d)}`

export function mediana(v: number[]) {
  if (!v.length) return 0
  const o = [...v].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

/** Nome de cada passo das boas-vindas (o número é o passo em que a pessoa está ou parou). */
export const NOME_PASSO = ['Dados do negócio', 'Ramo', 'Contas', 'Cartões', 'Contas fixas', 'Horários', 'Confirmar WhatsApp', 'Terminou']
