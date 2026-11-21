import { useEffect, useState } from 'react'
import { rpc } from '../../sb'

export interface Painel {
  clientes: number
  por_situacao: Record<string, number>
  novos_7d: number
  numeros_confirmados: number
  onboarding: Record<string, number>
  mensagens_hoje: number
  respondidas_hoje: number
  erros_24h: number
  ultimos_erros: { criado_em: string; tipo: string; erro: string }[]
  ultima_mensagem: string | null
  tokens_hoje: number
  tokens_mes: number
  midias_mes: number
  mensagens_por_dia: { dia: string; n: number; tokens: number }[]
  maiores_consumidores: { nome: string; negocio: string; mensagens: number; tokens: number }[]
  saude: { whatsapp_estado: string | null; whatsapp_numero: string | null; fila: number | null; atualizado_em: string } | null
}

export function usePainel() {
  const [p, setP] = useState<Painel | null>(null)
  const [erro, setErro] = useState('')
  const recarregar = () => rpc<Painel>('admin_painel').then(setP).catch((e: Error) => setErro(e.message))
  useEffect(() => {
    void recarregar()
    const t = setInterval(recarregar, 60_000)
    return () => clearInterval(t)
  }, [])
  return { p, erro, recarregar }
}
