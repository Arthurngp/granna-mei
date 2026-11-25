import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Mascote } from './components/ui'
import { useApp } from './lib/store'
import Ajustes from './pages/Ajustes'
import Assinatura from './pages/Assinatura'
import { CriarConta, Entrar, NovaSenha } from './pages/Auth'
import Bloqueado from './pages/Bloqueado'
import Contas from './pages/Contas'
import Inicio from './pages/Inicio'
import Lancamentos from './pages/Lancamentos'
import Manutencao from './pages/Manutencao'
import { MANUTENCAO } from './lib/config'
import MeuMei from './pages/MeuMei'
import Onboarding from './pages/Onboarding'
import Relatorios from './pages/Relatorios'

function SobeAoTrocar() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

export default function App() {
  const { s, carregando } = useApp()
  const { logado, onboarding } = s.sessao

  if (MANUTENCAO) return <Manutencao />

  if (carregando) {
    return (
      <div className="bloq" role="status" aria-label="Carregando">
        <div>
          <Mascote pose="hero" tam={120} anim="flutua" />
          <p>Abrindo suas contas...</p>
        </div>
      </div>
    )
  }

  let rotas
  if (!logado) {
    rotas = (
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/criar-conta" element={<CriarConta />} />
        <Route path="/nova-senha" element={<NovaSenha />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    )
  } else if (!onboarding) {
    rotas = (
      <Routes>
        <Route path="/comecar" element={<Onboarding />} />
        <Route path="/nova-senha" element={<NovaSenha />} />
        <Route path="*" element={<Navigate to="/comecar" replace />} />
      </Routes>
    )
  } else if (s.assinatura.status === 'bloqueada') {
    // Conta bloqueada por falta de pagamento: nada do painel abre, só a tela de regularizar e baixar os dados.
    rotas = (
      <Routes>
        <Route path="/bloqueado" element={<Bloqueado />} />
        <Route path="/nova-senha" element={<NovaSenha />} />
        <Route path="*" element={<Navigate to="/bloqueado" replace />} />
      </Routes>
    )
  } else {
    rotas = (
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Inicio />} />
          <Route path="/lancamentos" element={<Lancamentos />} />
          <Route path="/contas" element={<Contas />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/mei" element={<MeuMei />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="/ajustes/assinatura" element={<Assinatura />} />
        </Route>
        <Route path="/nova-senha" element={<NovaSenha />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }
  return (
    <>
      <SobeAoTrocar />
      {rotas}
    </>
  )
}
