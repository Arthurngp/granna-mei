import '@fontsource-variable/figtree'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AvisoProvider } from './components/ui'
import { AppProvider } from './lib/store'
import { fluxoWhats } from './lib/config'
import './styles.css'

// Guarda a escolha do piloto do cadastro novo (?onboarding=whats) já na chegada: a URL muda antes de o cadastro abrir.
fluxoWhats()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Funciona em /painel (endereço definitivo) e também na raiz, enquanto o domínio não muda no Coolify. */}
    <BrowserRouter basename={window.location.pathname.startsWith('/painel') ? '/painel' : ''}>
      <AvisoProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AvisoProvider>
    </BrowserRouter>
  </StrictMode>,
)
