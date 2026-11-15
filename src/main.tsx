import '@fontsource-variable/figtree'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AvisoProvider } from './components/ui'
import { AppProvider } from './lib/store'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AvisoProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AvisoProvider>
    </BrowserRouter>
  </StrictMode>,
)
