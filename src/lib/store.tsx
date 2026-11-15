import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { hoje, somaDias, somaMeses } from './format'
import { categoriasPadrao, estadoDemo, estadoVazio, VERSAO } from './seed'
import type { Conta, Estado, Lancamento, StatusAssinatura } from './tipos'

const CHAVE = 'granna-mei:estado'

function carregar(): Estado {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (bruto) {
      const e = JSON.parse(bruto) as Estado
      if (e && e.versao === VERSAO) return e
    }
  } catch {
    /* armazenamento indisponível: segue com o estado em memória */
  }
  return estadoVazio()
}

export const novoId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

interface Ctx {
  s: Estado
  mut: (fn: (s: Estado) => Estado) => void
  entrarDemo: () => void
  criarConta: (nome: string, email: string) => void
  sair: () => void
  pagarConta: (id: string, carteiraId?: string) => void
  reabrirConta: (id: string) => void
  excluirLancamento: (id: string) => void
  simularStatus: (st: StatusAssinatura) => void
  carregarExemplo: () => void
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Estado>(carregar)

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(s))
    } catch {
      /* sem espaço ou modo privado: o app segue funcionando sem persistir */
    }
  }, [s])

  const mut = useCallback((fn: (s: Estado) => Estado) => setS((a) => fn(a)), [])

  const ctx = useMemo<Ctx>(() => {
    const pagarConta = (id: string, carteiraId?: string) =>
      mut((a) => {
        const c = a.contas.find((x) => x.id === id)
        if (!c || c.status === 'paga') return a
        const carteira = carteiraId ?? a.carteiras.find((w) => w.padrao)?.id ?? a.carteiras[0]?.id
        if (!carteira) return a
        const agora = new Date()
        const l: Lancamento = {
          id: novoId('l'),
          tipo: c.tipo === 'pagar' ? 'saida' : 'entrada',
          valor: c.valor,
          descricao: c.parcela ? `${c.descricao} (${c.parcela.n}/${c.parcela.total})` : c.descricao,
          categoriaId: c.categoriaId,
          carteiraId: carteira,
          data: hoje(),
          hora: `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`,
          origem: 'painel',
        }
        const contas = a.contas.map((x): Conta => (x.id === id ? { ...x, status: 'paga', pagoEm: hoje(), lancId: l.id } : x))
        return { ...a, contas, lancamentos: [l, ...a.lancamentos] }
      })

    const reabrirConta = (id: string) =>
      mut((a) => {
        const c = a.contas.find((x) => x.id === id)
        if (!c || c.status !== 'paga') return a
        return {
          ...a,
          contas: a.contas.map((x): Conta => (x.id === id ? { ...x, status: 'aberta', pagoEm: undefined, lancId: undefined } : x)),
          lancamentos: a.lancamentos.filter((l) => l.id !== c.lancId),
        }
      })

    return {
      s,
      mut,
      entrarDemo: () => setS(estadoDemo()),
      criarConta: (nome, email) =>
        setS(() => {
          const v = estadoVazio()
          return { ...v, sessao: { logado: true, onboarding: false, demo: false }, usuario: { ...v.usuario, nome, email } }
        }),
      sair: () => setS(estadoVazio()),
      pagarConta,
      reabrirConta,
      excluirLancamento: (id) =>
        mut((a) => ({
          ...a,
          lancamentos: a.lancamentos.filter((l) => l.id !== id),
          contas: a.contas.map((c): Conta => (c.lancId === id ? { ...c, status: 'aberta', pagoEm: undefined, lancId: undefined } : c)),
        })),
      simularStatus: (st) =>
        mut((a) => {
          const h = hoje()
          const base = { ...a.assinatura, status: st }
          if (st === 'trial') return { ...a, assinatura: { ...base, trialFim: somaDias(h, 5), proxCobranca: somaDias(h, 5) } }
          if (st === 'ativa') return { ...a, assinatura: { ...base, proxCobranca: `${somaMeses(h.slice(0, 7), 1)}-15` } }
          return { ...a, assinatura: { ...base, proxCobranca: somaDias(h, st === 'atrasada' ? 0 : -2) } }
        }),
      carregarExemplo: () =>
        mut((a) => {
          const d = estadoDemo()
          return { ...d, sessao: { ...d.sessao, demo: true }, usuario: { ...d.usuario, ...a.usuario, ramo: 'beleza' }, prefs: a.prefs, assinatura: a.assinatura, categorias: categoriasPadrao('beleza') }
        }),
    }
  }, [s, mut])

  return <AppCtx.Provider value={ctx}>{children}</AppCtx.Provider>
}

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp fora do AppProvider')
  return c
}
