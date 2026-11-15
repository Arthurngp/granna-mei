/**
 * Servidor da Granninha.
 * POST /webhook   recebe as mensagens do gateway (assinadas), responde 200 na hora e processa em seguida
 *                 (o gateway espera no máximo 10 s e não reenvia).
 * GET  /saude     situação do serviço e do número, para o admin e o monitoramento.
 */
import { createServer, type IncomingMessage } from 'node:http'
import './env.ts'
import { sb } from './banco.ts'
import { assinaturaValida, enviarTexto, statusSessao } from './gateway.ts'
import { processar, type EventoGateway } from './granninha.ts'

const PORTA = Number(process.env.PORT ?? 3000)
let ultimaMensagem: string | null = null
let erros = 0

// Uma fila por número: duas mensagens seguidas do mesmo cliente são tratadas na ordem em que chegaram.
const filas = new Map<string, Promise<void>>()
function enfileirar(chave: string, tarefa: () => Promise<void>) {
  const anterior = filas.get(chave) ?? Promise.resolve()
  const proxima = anterior.then(tarefa, tarefa).finally(() => {
    if (filas.get(chave) === proxima) filas.delete(chave)
  })
  filas.set(chave, proxima)
}

function corpo(req: IncomingMessage, limite = 2_000_000): Promise<string> {
  return new Promise((ok, falha) => {
    let t = ''
    req.on('data', (c) => {
      t += c
      if (t.length > limite) {
        falha(new Error('corpo grande demais'))
        req.destroy()
      }
    })
    req.on('end', () => ok(t))
    req.on('error', falha)
  })
}

export function iniciar(porta = PORTA) {
  const srv = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      if (req.method === 'POST' && url.pathname === '/webhook') {
        const bruto = await corpo(req)
        if (!assinaturaValida(bruto, req.headers['x-webhook-signature'] as string | undefined)) {
          res.writeHead(401).end()
          return
        }
        const ev = JSON.parse(bruto) as EventoGateway
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
        const chave = (ev.data?.from ?? ev.data?.key?.remoteJid ?? 'x').split('@')[0]
        enfileirar(chave, async () => {
          try {
            const r = await processar(ev)
            if (r.status !== 'ignorada' || r.resposta) ultimaMensagem = new Date().toISOString()
            if (r.para && r.resposta) await enviarTexto(r.para, r.resposta)
          } catch (e) {
            erros++
            console.error('[webhook]', (e as Error).message)
          }
        })
        return
      }
      if (req.method === 'GET' && url.pathname === '/saude') {
        const desde = new Date(Date.now() - 86400_000).toISOString()
        const [wa, hoje, falhas] = await Promise.all([
          statusSessao().catch((e) => ({ estado: 'gateway fora: ' + (e as Error).message, numero: null })),
          sb.from('mensagens').select('id', { count: 'exact', head: true }).gte('criado_em', desde),
          sb.from('mensagens').select('id', { count: 'exact', head: true }).gte('criado_em', desde).eq('status', 'erro'),
        ])
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ ok: true, whatsapp: wa, mensagens_24h: hoje.count ?? null, erros_24h: falhas.count ?? null, erros_envio_desde_inicio: erros, ultima_mensagem: ultimaMensagem, fila: filas.size }),
        )
        return
      }
      res.writeHead(404).end()
    } catch (e) {
      console.error('[http]', (e as Error).message)
      if (!res.headersSent) res.writeHead(400).end()
    }
  })
  srv.listen(porta, () => console.log(`Granninha ouvindo na porta ${porta}`))
  return srv
}

if (process.argv[1] && /index\.ts$/.test(process.argv[1])) iniciar()
