/**
 * Mensagens que ficaram pela metade, com status 'recebida'.
 *
 * O gateway responde "recebi" e não reenvia, e todo merge na main republica os 4 apps: a mensagem que
 * estava na fila ou no meio da IA morria em silêncio. Agora a chegada é gravada antes do 200, e esta
 * varredura olha o que ficou para trás. Duas situações, tratadas de formas opostas:
 *
 * - `erro` nulo: NUNCA começou a ser processada. Nada foi gravado, então dá para processar de novo.
 * - `erro` = 'processando': começou e o processo morreu no meio. NUNCA é reprocessada, porque pode ter
 *   gravado, revertido ou corrigido um lançamento sem chegar a registrar. Reprocessar um DESFAZER
 *   desfaria um segundo lançamento, e reprocessar uma correção corrigiria o lançamento errado. Nesse
 *   caso a cliente recebe um aviso para mandar de novo, e a mensagem fica como erro para o admin ver.
 */
import type { EventoGateway } from './granninha.ts'
import { PROCESSANDO } from './granninha.ts'

/** Acima do pior caso de processamento (transcrição + IA, 25 s por chamada e até 3 tentativas). */
export const PISO_MS = Number(process.env.PRESAS_PISO_MS ?? 180_000)
/** Depois disso a cliente já desistiu e provavelmente mandou de novo: reprocessar viraria dobro. */
export const TETO_MS = Number(process.env.PRESAS_TETO_MS ?? 900_000)

export const AVISO_INTERROMPIDA = 'Recebi sua mensagem, mas tive um problema e não consegui terminar de anotar. Pode mandar de novo?'

export interface Presa {
  id: string
  telefone: string
  tipo: string
  texto: string | null
  erro: string | null
  criado_em: string
  evento: EventoGateway | null
}

export type Decisao =
  | { acao: 'esperar' }
  | { acao: 'reprocessar'; ev: EventoGateway }
  | { acao: 'avisar'; motivo: string }
  | { acao: 'arquivar'; motivo: string }

/** Evento reconstruído de uma mensagem de texto gravada antes da migration da coluna `evento`. */
function eventoDeTexto(p: Presa): EventoGateway {
  const jid = `${p.telefone}@s.whatsapp.net`
  return {
    event: 'message.received',
    data: { key: { id: p.id, remoteJid: jid, fromMe: false }, from: jid, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: p.texto ?? '' },
  }
}

export function decidir(p: Presa, agora = Date.now()): Decisao {
  const idade = agora - new Date(p.criado_em).getTime()
  if (idade < PISO_MS) return { acao: 'esperar' } // pode estar rodando agora
  if (p.erro === PROCESSANDO) return { acao: 'avisar', motivo: 'interrompida no meio do processamento' }
  if (p.erro) return { acao: 'arquivar', motivo: p.erro }
  if (idade > TETO_MS) return { acao: 'arquivar', motivo: 'não processada (fora da janela de retomada)' }
  if (p.evento?.data) return { acao: 'reprocessar', ev: p.evento }
  if (p.tipo === 'texto') return { acao: 'reprocessar', ev: eventoDeTexto(p) }
  // Áudio, foto ou PDF sem o evento guardado: o fileUrl não existe mais, não há o que reprocessar.
  return { acao: 'avisar', motivo: 'mídia sem o evento guardado (antes da migration)' }
}

export interface DepsVarredura {
  /** Mensagens 'recebida' mais velhas que o piso, mais novas primeiro. */
  buscar: (desde: string) => Promise<Presa[]>
  /** Tira a linha de 'recebida'. Devolve false se outro processo já tirou. */
  fechar: (id: string, erro: string) => Promise<boolean>
  /** Põe a mensagem na fila do telefone dela, como o webhook faria. */
  enfileirar: (telefone: string, tarefa: () => Promise<void>) => void
  processar: (ev: EventoGateway, opts: { jaRegistrada: boolean }) => Promise<{ status: string; para?: string; resposta?: string }>
  enviar: (para: string, texto: string) => Promise<void>
  /** O número é de uma conta ativa? A Granninha fica muda para quem não é cliente. */
  ehCliente: (telefone: string) => Promise<boolean>
  /** Ids que este processo está tratando agora (não mexer neles). */
  emVoo: () => Set<string>
}

/** Roda a cada minuto junto do batimento. Devolve as linhas do log, para o teste conferir. */
export async function varrerPresas(d: DepsVarredura, agora = Date.now()): Promise<string[]> {
  const log: string[] = []
  const presas = await d.buscar(new Date(agora - TETO_MS * 4).toISOString())
  for (const p of presas) {
    if (d.emVoo().has(p.id)) continue
    const dec = decidir(p, agora)
    if (dec.acao === 'esperar') continue
    if (dec.acao === 'reprocessar') {
      log.push(`retomando ${p.id} (${p.tipo})`)
      d.enfileirar(p.telefone, async () => {
        try {
          const r = await d.processar(dec.ev, { jaRegistrada: true })
          if (r.para && r.resposta) await d.enviar(r.para, r.resposta)
        } catch (e) {
          console.error('[presas] retomar', p.id, (e as Error).message)
        }
      })
      continue
    }
    // Fecha ANTES de avisar: se não fechar, outro processo já tratou e ninguém avisa duas vezes.
    if (!(await d.fechar(p.id, dec.acao === 'avisar' ? 'interrompida: ' + dec.motivo : dec.motivo))) continue
    log.push(`${dec.acao} ${p.id}: ${dec.motivo}`)
    if (dec.acao !== 'avisar') continue
    try {
      if (await d.ehCliente(p.telefone)) await d.enviar(p.telefone, AVISO_INTERROMPIDA)
      else log.push(`sem aviso para ${p.telefone}: não é cliente`)
    } catch (e) {
      console.error('[presas] avisar', p.id, (e as Error).message)
    }
  }
  return log
}
