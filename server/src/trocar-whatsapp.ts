/**
 * Troca do número do WhatsApp da Granninha, pelo painel admin, com confirmação em DUAS etapas EXIGIDA PELO SERVIDOR.
 *
 * Desconectar o número derruba o atendimento de todos os clientes até o chip novo ser lido no QR. Por isso a tela não
 * basta como proteção (um clique perdido, uma chamada solta, um script): a regra vive aqui.
 *   1. pedir:     emite um código de uso único, que vale 2 minutos e é preso ao admin que pediu;
 *   2. confirmar: só executa com esse código E com a frase TROCAR digitada. Três erros invalidam o código.
 * Sem passar pela etapa 1 não existe caminho para desconectar. Número, QR e auditoria saem daqui; o gateway entra por injeção.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'

export const VALIDADE_MS = 2 * 60_000
export const MAX_ERROS = 3
export const FRASE = 'TROCAR'
const ESPERA_MS = 1000
const TENTATIVAS_DESCONECTAR = 20

export interface EstadoWhats {
  estado: string
  numero: string | null
}
export interface QrWhats extends EstadoWhats {
  conectado: boolean
  imagem: string | null
}
export interface DepsTroca {
  status(): Promise<EstadoWhats>
  desvincular(): Promise<void>
  qr(): Promise<QrWhats>
  /** Falha aqui não pode impedir o admin de terminar a troca: é registrada no log e o fluxo segue. */
  auditar(adminId: string, acao: string, detalhes: Record<string, unknown>): Promise<void>
  agora(): number
  sorteio(): string
  esperar(ms: number): Promise<void>
}

export class ErroTroca extends Error {
  constructor(
    public status: number,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

const ultimos4 = (n: string | null) => (n ?? '').replace(/\D/g, '').slice(-4) || null
const igual = (a: string, b: string) => a.length === b.length && a.length > 0 && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function depsReais(
  gateway: { status: DepsTroca['status']; desvincular: DepsTroca['desvincular']; qr: DepsTroca['qr'] },
  auditar: DepsTroca['auditar'],
): DepsTroca {
  return { ...gateway, auditar, agora: Date.now, sorteio: () => randomBytes(16).toString('hex'), esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)) }
}

export function criarTroca(d: DepsTroca) {
  const pendentes = new Map<string, { codigo: string; expira: number; erros: number }>()
  let emAndamento = false

  /** Etapa 1: libera a confirmação. Não mexe em nada no WhatsApp. Um novo pedido substitui o anterior. */
  async function pedir(adminId: string) {
    const st = await d.status()
    const codigo = d.sorteio()
    pendentes.set(adminId, { codigo, expira: d.agora() + VALIDADE_MS, erros: 0 })
    return { codigo, validade_s: VALIDADE_MS / 1000, conectado: st.estado === 'CONNECTED', numero_final: ultimos4(st.numero) }
  }

  /** Etapa 2: desconecta o número atual (se estiver conectado) e devolve o QR do chip novo. */
  async function confirmar(adminId: string, codigo: string, frase: string): Promise<QrWhats & { desconectou: boolean }> {
    if (emAndamento) throw new ErroTroca(409, 'Já tem uma troca em andamento. Aguarde terminar.')
    const p = pendentes.get(adminId)
    if (!p) throw new ErroTroca(400, 'Comece pela primeira etapa: ela é que libera a confirmação.')
    if (d.agora() > p.expira) {
      pendentes.delete(adminId)
      throw new ErroTroca(410, 'A confirmação venceu (vale 2 minutos). Comece de novo.')
    }
    const fraseOk = frase.trim().toUpperCase() === FRASE
    const codigoOk = igual(codigo, p.codigo)
    if (!codigoOk || !fraseOk) {
      p.erros++
      if (p.erros >= MAX_ERROS) {
        pendentes.delete(adminId)
        throw new ErroTroca(429, 'Muitas tentativas erradas. Comece de novo.')
      }
      throw new ErroTroca(400, codigoOk ? `Digite ${FRASE} para confirmar.` : 'Confirmação inválida. Comece de novo.')
    }
    pendentes.delete(adminId) // uso único: repetir a mesma chamada não desconecta de novo
    emAndamento = true
    try {
      const antes = await d.status()
      const estavaConectado = antes.estado === 'CONNECTED'
      if (estavaConectado) {
        try {
          await d.desvincular()
        } catch (e) {
          throw new ErroTroca(502, `Não consegui desconectar o número atual: ${(e as Error).message}`)
        }
        let saiu = false
        for (let i = 0; i < TENTATIVAS_DESCONECTAR; i++) {
          if ((await d.status()).estado !== 'CONNECTED') {
            saiu = true
            break
          }
          await d.esperar(ESPERA_MS)
        }
        if (!saiu) throw new ErroTroca(502, 'O gateway não confirmou a desconexão. O número continua conectado; tente de novo em alguns segundos.')
        // Só o final do número fica na auditoria: o número inteiro não precisa morar em outra tabela.
        await d.auditar(adminId, 'whatsapp_desconectar', { numero_final: ultimos4(antes.numero), estado_antes: antes.estado }).catch((e) => console.error('[admin] auditoria da troca de número falhou:', (e as Error).message))
        console.log(`[admin] WhatsApp da Granninha desconectado para troca de número (final ${ultimos4(antes.numero) ?? '?'}) por ${adminId}`)
      }
      let q: QrWhats
      try {
        q = await d.qr()
      } catch (e) {
        throw new ErroTroca(502, `O número foi desconectado, mas o QR não saiu: ${(e as Error).message}. Use "Mostrar QR para conectar".`)
      }
      return { ...q, desconectou: estavaConectado }
    } finally {
      emAndamento = false
    }
  }

  return { pedir, confirmar }
}

/** Liga as duas rotas ao servidor HTTP. Devolve null se o caminho não for destas rotas. Nunca responde 401 (o admin não pode ser deslogado por aqui). */
export async function tratarTroca(
  troca: ReturnType<typeof criarTroca>,
  adminId: string,
  metodo: string,
  caminho: string,
  corpo: () => Promise<string>,
): Promise<{ status: number; json: unknown } | null> {
  if (!caminho.startsWith('/admin/whatsapp/trocar/')) return null
  if (metodo !== 'POST') return { status: 405, json: { erro: 'Use POST.' } }
  try {
    if (caminho === '/admin/whatsapp/trocar/pedir') return { status: 200, json: await troca.pedir(adminId) }
    if (caminho === '/admin/whatsapp/trocar/confirmar') {
      let b: { codigo?: unknown; frase?: unknown }
      try {
        b = JSON.parse((await corpo()) || '{}')
      } catch {
        throw new ErroTroca(400, 'Corpo inválido.')
      }
      return { status: 200, json: await troca.confirmar(adminId, typeof b.codigo === 'string' ? b.codigo : '', typeof b.frase === 'string' ? b.frase : '') }
    }
    return { status: 404, json: { erro: 'Rota não encontrada.' } }
  } catch (e) {
    if (e instanceof ErroTroca) return { status: e.status, json: { erro: e.message } }
    return { status: 500, json: { erro: `Não foi possível trocar o número: ${(e as Error).message}` } }
  }
}
