import '@fontsource-variable/figtree'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AvisoProvider } from '../../src/components/ui'
import '../../src/styles.css'
import './admin.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AvisoProvider>
      <App />
    </AvisoProvider>
  </StrictMode>,
)
