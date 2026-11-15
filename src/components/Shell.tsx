import {
  ArrowLeftRight, Banknote, Briefcase, CalendarClock, Car, ChartPie, CreditCard, House, Landmark, List, Megaphone, MessageCircle, Package, Percent,
  PlusCircle, Settings, ShoppingBag, Store, Tag, User, Utensils, Wallet, Wrench, Zap, Home,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { linkWhats } from '../lib/config'
import { difDias, hoje, primeiroNome } from '../lib/format'
import { useApp } from '../lib/store'
import type { Categoria, Lancamento, TipoCarteira } from '../lib/tipos'
import { Folha, Mascote } from './ui'

const NAV = [
  { para: '/', rotulo: 'Início', I: House },
  { para: '/lancamentos', rotulo: 'Lançamentos', I: List },
  { para: '/contas', rotulo: 'Contas', I: CalendarClock },
  { para: '/relatorios', rotulo: 'Relatórios', I: ChartPie },
  { para: '/mei', rotulo: 'Meu MEI', I: Store },
]

export function Shell() {
  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca-topo">
          <img src="/logo-96.png" alt="" />
          Granna Mei
        </div>
        {NAV.map(({ para, rotulo, I }) => (
          <NavLink key={para} to={para} end={para === '/'} className={({ isActive }) => `item ${isActive ? 'ativo' : ''}`}>
            <I size={20} />
            {rotulo}
          </NavLink>
        ))}
        <NavLink to="/ajustes" className={({ isActive }) => `item ${isActive ? 'ativo' : ''}`}>
          <Settings size={20} />
          Ajustes
        </NavLink>
        <div className="fim">
          <div className="ajuda">
            <div className="disco">
              <Mascote pose="hero" tam={70} />
            </div>
            Lançar, perguntar e corrigir é tudo pelo WhatsApp.
            <a className="btn btn-wa btn-p btn-bloco" href={linkWhats()} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={17} />
              Falar com a Granninha
            </a>
          </div>
        </div>
      </aside>
      <main className="conteudo">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Principal">
        {NAV.map(({ para, rotulo, I }) => (
          <NavLink key={para} to={para} end={para === '/'} className={({ isActive }) => (isActive ? 'ativo' : '')}>
            <div className="pilula">
              <I size={21} />
            </div>
            <span>{rotulo}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function Topo({ titulo, sub, children }: { titulo: string; sub?: string; children?: ReactNode }) {
  const { s } = useApp()
  return (
    <header className="topo">
      <div className="cresce">
        <h1>{titulo}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children}
      <Link to="/ajustes" className="avatar so-mobile" aria-label="Ajustes da conta">
        {(primeiroNome(s.usuario.nome)[0] ?? 'G').toUpperCase()}
      </Link>
    </header>
  )
}

/** Aviso de teste grátis acabando ou de pagamento em atraso, no alto de cada tela. */
export function FaixaAssinatura() {
  const { s } = useApp()
  const a = s.assinatura
  if (a.status === 'trial') {
    const d = Math.max(0, difDias(a.trialFim, hoje()))
    return (
      <div className="faixa trial nao-imprime">
        <span className="cresce">{d === 0 ? 'Seu teste grátis termina hoje.' : d === 1 ? 'Falta 1 dia do seu teste grátis.' : `Faltam ${d} dias do seu teste grátis.`}</span>
        <Link to="/ajustes/assinatura">Assinar</Link>
      </div>
    )
  }
  if (a.status === 'atrasada') {
    return (
      <div className="faixa atraso nao-imprime" role="alert">
        <span className="cresce">Não recebemos o pagamento. Sem ele, o acesso é bloqueado em 24 horas.</span>
        <Link to="/ajustes/assinatura">Pagar agora</Link>
      </div>
    )
  }
  return null
}

const EXEMPLOS = ['Recebi 150 da Juliana no pix', 'Paguei 89 de luz', 'Comprei 1.200 de material em 4x', 'Aluguel de 900 todo dia 10', 'Quanto entrou essa semana?', 'O que vence até sexta?']

/** Botão flutuante: o lançamento é feito na conversa, então ele ensina e leva para lá. */
export function BotaoZap() {
  const [aberta, setAberta] = useState(false)
  return (
    <>
      <button type="button" className="fab nao-imprime" onClick={() => setAberta(true)}>
        <MessageCircle size={22} />
        Lançar
      </button>
      <Folha
        aberta={aberta}
        onFechar={() => setAberta(false)}
        titulo="Lance pelo WhatsApp"
        pe={
          <a className="btn btn-wa btn-bloco" href={linkWhats()} target="_blank" rel="noopener noreferrer" onClick={() => setAberta(false)}>
            <MessageCircle size={19} />
            Abrir conversa com a Granninha
          </a>
        }
      >
        <div className="recado" style={{ marginBottom: 14 }}>
          <Mascote pose="hero" tam={84} anim="flutua" />
          <div className="balao">
            Me manda do seu jeito: <b>texto, áudio, foto do comprovante ou PDF</b>. Eu anoto na hora e te mostro aqui.
          </div>
        </div>
        <div className="rotulo">Toque num exemplo para abrir a conversa com ele pronto</div>
        <div className="lista">
          {EXEMPLOS.map((e) => (
            <a key={e} className="linha" href={linkWhats(e)} target="_blank" rel="noopener noreferrer">
              <div className="meio">
                <div className="tit" style={{ fontWeight: 550 }}>
                  “{e}”
                </div>
              </div>
              <MessageCircle size={18} className="seta" />
            </a>
          ))}
        </div>
      </Folha>
    </>
  )
}

const ICONE_CAT: Record<string, typeof Tag> = {
  servicos: Briefcase, vendas: ShoppingBag, 'outras-entradas': PlusCircle, material: Package, aluguel: Home, 'contas-casa': Zap, transporte: Car,
  alimentacao: Utensils, impostos: Landmark, equipamentos: Wrench, marketing: Megaphone, taxas: Percent, retirada: User,
}

export function SeloCategoria({ cat, tipo }: { cat?: Categoria; tipo?: Lancamento['tipo'] }) {
  if (tipo === 'transferencia') {
    return (
      <div className="selo" style={{ background: '#E7EAF5', color: '#454C83' }}>
        <ArrowLeftRight size={19} />
      </div>
    )
  }
  const I = (cat && ICONE_CAT[cat.id]) || Tag
  const cor = cat?.cor ?? '#747EAD'
  return (
    <div className="selo" style={{ background: `${cor}22`, color: cat?.pessoal ? '#5B6288' : cor }}>
      <I size={19} />
    </div>
  )
}

const ICONE_CARTEIRA: Record<TipoCarteira, typeof Wallet> = { banco: Landmark, dinheiro: Banknote, maquininha: CreditCard, outro: Wallet }
export function IconeCarteira({ tipo, size = 16 }: { tipo: TipoCarteira; size?: number }) {
  const I = ICONE_CARTEIRA[tipo]
  return <I size={size} />
}
