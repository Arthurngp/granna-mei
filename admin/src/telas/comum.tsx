import { LoaderCircle, TriangleAlert } from 'lucide-react'

export const NOME_SITUACAO: Record<string, string> = {
  trial: 'Em teste',
  teste_vencido: 'Teste vencido',
  ativa: 'Em dia',
  atrasada: 'Em atraso',
  bloqueada: 'Bloqueada',
  cortesia: 'Cortesia',
}

export const dataHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : 'nunca'
export const dataBR = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '-')

export function Carregando() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
      <LoaderCircle className="gira" size={26} color="var(--indigo-3)" />
    </div>
  )
}

export function Falha({ texto }: { texto: string }) {
  return (
    <div className="vaviso ruim" role="alert">
      <TriangleAlert size={20} style={{ flex: 'none' }} />
      <span>{texto}</span>
    </div>
  )
}
