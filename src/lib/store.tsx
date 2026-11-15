import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAviso } from '../components/ui'
import { hoje, somaDias, somaMeses } from './format'
import { carregar, enviar } from './remoto'
import { categoriasPadrao, estadoDemo, estadoVazio, VERSAO } from './seed'
import { supabase, temBanco } from './supabase'
import type { Conta, Estado, Lancamento, StatusAssinatura } from './tipos'

/**
 * Dois modos:
 * - conta de verdade: os dados vêm do banco e cada mudança é gravada lá;
 * - demonstração: a conta de exemplo, que vive só no navegador e nunca toca o banco.
 */
const CHAVE = 'granna-mei:demo'

function carregarDemo(): Estado | null {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (bruto) {
      const e = JSON.parse(bruto) as Estado
      if (e && e.versao === VERSAO && e.sessao?.demo) return e
    }
  } catch {
    /* armazenamento indisponível: segue sem a demonstração salva */
  }
  return null
}

export const novoId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function traduz(msg: string) {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'E-mail ou senha não conferem.'
  if (m.includes('already registered') || m.includes('already been registered')) return 'Já existe uma conta com este e-mail. Tente entrar.'
  if (m.includes('password')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com o servidor. Confira sua internet.'
  return 'Não deu certo agora. Tente de novo em instantes.'
}

interface Ctx {
  s: Estado
  /** true enquanto a sessão salva está sendo conferida e os dados carregados */
  carregando: boolean
  temBanco: boolean
  mut: (fn: (s: Estado) => Estado) => void
  /** Devolvem a mensagem de erro, ou null se deu certo. */
  entrar: (email: string, senha: string) => Promise<string | null>
  criarConta: (nome: string, email: string, senha: string) => Promise<string | null>
  recuperarSenha: (email: string) => Promise<string | null>
  entrarDemo: () => void
  sair: () => void
  pagarConta: (id: string, carteiraId?: string) => void
  reabrirConta: (id: string) => void
  excluirLancamento: (id: string) => void
  simularStatus: (st: StatusAssinatura) => void
  carregarExemplo: () => void
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const avisar = useAviso()
  const [s, setS] = useState<Estado>(() => carregarDemo() ?? estadoVazio())
  const [carregando, setCarregando] = useState(temBanco && !s.sessao.demo)
  const userId = useRef<string | null>(null)
  /** Último estado que o banco já conhece. A diferença para o estado atual é o que falta gravar. */
  const gravado = useRef<Estado | null>(null)
  const fila = useRef<Promise<void>>(Promise.resolve())

  const abrirConta = useCallback(async (id: string, email: string) => {
    userId.current = id
    const e = await carregar(email)
    gravado.current = e
    setS(e)
  }, [])

  // Sessão salva: ao abrir o app, e sempre que o login mudar em outra aba.
  useEffect(() => {
    if (!supabase) return
    let vivo = true
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user
      if (u && vivo && !carregarDemo()) {
        try {
          await abrirConta(u.id, u.email ?? '')
        } catch {
          avisar('Não consegui carregar seus dados. Confira a internet e abra de novo.')
        }
      }
      if (vivo) setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && userId.current) {
        userId.current = null
        gravado.current = null
        setS(estadoVazio())
      }
    })
    return () => {
      vivo = false
      sub.subscription.unsubscribe()
    }
  }, [abrirConta, avisar])

  // Toda mudança de estado: a demonstração vai para o navegador; a conta de verdade vai para o banco.
  useEffect(() => {
    if (s.sessao.demo) {
      try {
        localStorage.setItem(CHAVE, JSON.stringify(s))
      } catch {
        /* sem espaço ou modo privado: a demonstração segue em memória */
      }
      return
    }
    const id = userId.current
    const antes = gravado.current
    if (!id || !antes || antes === s || !s.sessao.logado) return
    gravado.current = s
    fila.current = fila.current
      .then(() => enviar(antes, s, id))
      .catch(async () => {
        // O banco recusou (sem internet, sessão vencida ou acesso bloqueado): volta ao que está salvo de verdade.
        avisar('Não consegui salvar a última mudança. Recarreguei seus dados.')
        try {
          const e = await carregar(s.usuario.email)
          gravado.current = e
          setS(e)
        } catch {
          /* se nem recarregar deu, mantém a tela como está */
        }
      })
  }, [s, avisar])

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

    const limparDemo = () => {
      try {
        localStorage.removeItem(CHAVE)
      } catch {
        /* nada a limpar */
      }
    }

    return {
      s,
      carregando,
      temBanco,
      mut,
      entrar: async (email, senha) => {
        if (!supabase) return 'O login ainda não está ligado neste endereço. Use a demonstração.'
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error || !data.user) return traduz(error?.message ?? '')
        limparDemo()
        try {
          await abrirConta(data.user.id, data.user.email ?? email)
        } catch {
          return 'Entrou, mas não consegui carregar seus dados. Tente de novo.'
        }
        return null
      },
      criarConta: async (nome, email, senha) => {
        if (!supabase) {
          // Sem banco (desenvolvimento local): cria uma conta que vive só no navegador.
          const v = estadoVazio()
          setS({ ...v, sessao: { logado: true, onboarding: false, demo: true, passo: 0 }, usuario: { ...v.usuario, nome, email } })
          return null
        }
        const { data, error } = await supabase.auth.signUp({ email, password: senha, options: { data: { nome } } })
        if (error) return traduz(error.message)
        if (!data.session || !data.user) return 'Conta criada. Confirme pelo link que mandamos no seu e-mail e depois entre.'
        limparDemo()
        try {
          await abrirConta(data.user.id, email)
        } catch {
          return 'Conta criada, mas não consegui abrir. Tente entrar.'
        }
        return null
      },
      recuperarSenha: async (email) => {
        if (!supabase) return 'A troca de senha ainda não está ligada neste endereço.'
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        return error ? 'O envio de e-mail ainda não está ligado. Fale com a gente para trocar a senha.' : null
      },
      entrarDemo: () => {
        userId.current = null
        gravado.current = null
        setS(estadoDemo())
      },
      sair: () => {
        const eraDemo = s.sessao.demo
        limparDemo()
        userId.current = null
        gravado.current = null
        setS(estadoVazio())
        if (!eraDemo) void supabase?.auth.signOut()
      },
      pagarConta,
      reabrirConta,
      excluirLancamento: (id) =>
        mut((a) => ({
          ...a,
          lancamentos: a.lancamentos.filter((l) => l.id !== id),
          contas: a.contas.map((c): Conta => (c.lancId === id ? { ...c, status: 'aberta', pagoEm: undefined, lancId: undefined } : c)),
        })),
      // Só existe na demonstração: na conta de verdade quem muda a assinatura é o pagamento.
      simularStatus: (st) =>
        mut((a) => {
          if (!a.sessao.demo) return a
          const h = hoje()
          const base = { ...a.assinatura, status: st }
          if (st === 'trial') return { ...a, assinatura: { ...base, trialFim: somaDias(h, 5), proxCobranca: somaDias(h, 5) } }
          if (st === 'ativa') return { ...a, assinatura: { ...base, proxCobranca: `${somaMeses(h.slice(0, 7), 1)}-15` } }
          return { ...a, assinatura: { ...base, proxCobranca: somaDias(h, st === 'atrasada' ? 0 : -2) } }
        }),
      carregarExemplo: () =>
        mut((a) => {
          if (!a.sessao.demo) return a
          const d = estadoDemo()
          return { ...d, usuario: { ...d.usuario, ...a.usuario, ramo: 'beleza' }, prefs: a.prefs, assinatura: a.assinatura, categorias: categoriasPadrao('beleza') }
        }),
    }
  }, [s, carregando, mut, abrirConta])

  return <AppCtx.Provider value={ctx}>{children}</AppCtx.Provider>
}

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp fora do AppProvider')
  return c
}
