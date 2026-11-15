import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Em desenvolvimento, lê server/.env.local. Em produção as variáveis vêm do Coolify.
const arq = fileURLToPath(new URL('../.env.local', import.meta.url))
if (existsSync(arq)) {
  for (const linha of readFileSync(arq, 'utf8').split('\n')) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

export function env(nome: string, padrao?: string): string {
  const v = process.env[nome] ?? padrao
  if (v === undefined || v === '') throw new Error(`Variável ${nome} não definida`)
  return v
}
