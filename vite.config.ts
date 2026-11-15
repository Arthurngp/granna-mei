import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O painel do cliente mora em grannamei.amplasoft.me/painel (a raiz é o site do produto).
export default defineConfig({ base: '/painel/', plugins: [react()], server: { port: 5199 } })
