/**
 * Espera antes de responder (pedido do Arthur em 2026-11-25).
 *
 * Quem escreve no WhatsApp quebra a frase em várias mensagens: "oi", "lança isso", "10 reais". Antes a Granninha respondia cada uma na
 * hora, e a conversa virava três respostas desencontradas. Agora ela espera ESPERA_MS depois da última mensagem; se chega outra nesse
 * tempo, o relógio volta do zero. Quando a pessoa para, a rajada inteira é atendida de uma vez.
 *
 * O que é juntado e o que fica sozinho (função pura, testada em test/rajada.ts):
 * - Texto comum é juntado com o texto vizinho, na ordem em que chegou, numa mensagem só.
 * - Foto e PDF levam junto o texto que veio com eles: o que veio antes da primeira mídia e o que veio depois de cada uma, até a próxima.
 *   "Quais desses já foram lançados?" depois do print do extrato vira a legenda do print.
 * - Áudio leva junto o texto da mesma forma (vai como complemento da transcrição).
 * - Duas mídias nunca viram uma: cinco comprovantes seguidos continuam cinco registros (a fila de perguntas cuida deles).
 * - Fica SOZINHA, na ordem, toda mensagem que já é um comando ou uma resposta inteira: o código lê essas frases pela mensagem toda,
 *   e juntar estragaria a leitura. "sim", "não", "2", "pronto", "pular", "SAIR", "DESFAZER", o código de 6 números da confirmação,
 *   "já paguei". Ex.: "sim" e depois "anota 50 de gás" continuam duas mensagens, para o "sim" não importar o extrato E engolir o gás.
 * - Sticker, reação e tipo que a Granninha não lê ficam sozinhos (são ignorados ou recebem a ajuda, como antes).
 * - Rajada com mídia: texto com valor próprio ("gastei 20 de pão") fica sozinho, para não virar legenda do comprovante e sumir.
 */
import type { EventoGateway } from './granninha.ts'
import { ehNao, ehPronto, ehPular, ehSim } from './config-whats.ts'
import { respostaDuplicata } from './duplicata.ts'
import { naoParaAnotar, simParaAnotar } from './extrato.ts'
import { temNumeroDeValor } from './numeros.ts'
import { respostaGancho } from './gancho.ts'
import { ehSair } from './retencao.ts'

/** Quanto esperar depois da última mensagem. 0 desliga a espera (testes, ou se precisar voltar ao jeito antigo sem deploy de código). */
export const esperaMs = () => {
  const v = Number(process.env.GRANNINHA_ESPERA_MS ?? 10_000)
  return Number.isFinite(v) && v >= 0 ? v : 10_000
}
/** Teto da espera desde a primeira mensagem da rajada: quem manda uma mensagem a cada 9 s não fica sem resposta para sempre. */
export const ESPERA_MAX_MS = 60_000
/** Teto de mensagens numa rajada. Passou disso, atende o que tem. */
export const RAJADA_MAX = 15

export interface Unidade {
  /** O evento que será processado (o id dele é o que fica com a resposta). */
  ev: EventoGateway
  /** Ids das outras mensagens que foram juntadas nesta e não serão processadas sozinhas. */
  juntadas: string[]
  /** As mensagens como chegaram, na ordem: se não der para marcar as juntadas, cada uma é atendida sozinha. */
  originais: EventoGateway[]
}

const tipo = (ev: EventoGateway): 'texto' | 'midia' | 'outro' => {
  const t = (ev.data?.type ?? '').toUpperCase()
  if (t === 'TEXT') return 'texto'
  if (t === 'AUDIO' || t === 'IMAGE' || t === 'DOCUMENT') return 'midia'
  return 'outro'
}

const textoDe = (ev: EventoGateway) => (ev.data?.content ?? '').trim()

/** A mensagem é um comando ou uma resposta inteira, que o código lê pela frase toda? Então não pode ser juntada com nada. */
export function ehSozinha(texto: string): boolean {
  const t = texto.trim()
  if (!t) return false
  if (/^\d{1,2}$/.test(t)) return true // opção de uma pergunta ("2")
  if (/\b\d{6}\b/.test(t) && t.length <= 60) return true // código de confirmação do número
  if (/^desfa[zç]/i.test(t)) return true
  if (ehSair(t)) return true
  return ehSim(t) || ehNao(t) || ehPronto(t) || ehPular(t) || simParaAnotar(t) || naoParaAnotar(t) || respostaDuplicata(t) !== null || respostaGancho(t) !== null
}

const comTexto = (ev: EventoGateway, campo: 'content' | 'caption', valor: string): EventoGateway => ({ ...ev, data: { ...ev.data, [campo]: valor } })
const juntar = (partes: string[]) => partes.map((p) => p.trim()).filter(Boolean).join('\n')

/** Um trecho sem comandos no meio: texto comum e mídias. */
function trecho(evs: EventoGateway[]): Unidade[] {
  const midias = evs.map((e, i) => (tipo(e) === 'midia' ? i : -1)).filter((i) => i >= 0)
  const id = (e: EventoGateway) => e.data?.key?.id ?? ''
  if (!midias.length) {
    if (evs.length === 1) return [{ ev: evs[0], juntadas: [], originais: evs }]
    // A mensagem processada é a última: a resposta sai depois de tudo que a pessoa mandou.
    const ultima = evs[evs.length - 1]
    return [{ ev: comTexto(ultima, 'content', juntar(evs.map(textoDe))), juntadas: evs.slice(0, -1).map(id), originais: evs }]
  }
  const out: Unidade[] = []
  midias.forEach((mi, k) => {
    const antes = k === 0 ? evs.slice(0, mi) : []
    const fim = k + 1 < midias.length ? midias[k + 1] : evs.length
    const depois = evs.slice(mi + 1, fim)
    const m = evs[mi]
    const textos = [...antes, ...depois]
    if (!textos.length) {
      out.push({ ev: m, juntadas: [], originais: [m] })
      return
    }
    // O texto vira a legenda da mídia. Foto e PDF: a leitura do documento e a pergunta feita sobre ele usam a legenda.
    // Áudio: a legenda entra como complemento da transcrição (conversar() junta as duas).
    const legenda = juntar([...antes.map(textoDe), m.data?.caption ?? '', ...depois.map(textoDe)])
    out.push({ ev: comTexto(m, 'caption', legenda), juntadas: textos.map(id), originais: [...antes, m, ...depois] })
  })
  return out
}

/** Divide a rajada (na ordem de chegada) no que será processado, cada unidade com as mensagens que ela absorveu. */
export function agrupar(evs: EventoGateway[]): Unidade[] {
  const out: Unidade[] = []
  let atual: EventoGateway[] = []
  const temMidia = evs.some((e) => tipo(e) === 'midia')
  const fecha = () => {
    if (atual.length) out.push(...trecho(atual))
    atual = []
  }
  for (const ev of evs) {
    const t = tipo(ev)
    // Com mídia na rajada, texto com valor próprio ("gastei 20 de pão") é outro registro: virar legenda do comprovante o faria sumir.
    if (t === 'outro' || (t === 'texto' && (ehSozinha(textoDe(ev)) || (temMidia && temNumeroDeValor(textoDe(ev)))))) {
      fecha()
      out.push({ ev, juntadas: [], originais: [ev] })
    } else if (t === 'texto' && !textoDe(ev)) {
      // texto vazio: não soma nada, mas também não pode sumir sem passar pelo processar (que o tira de 'recebida').
      fecha()
      out.push({ ev, juntadas: [], originais: [ev] })
    } else atual.push(ev)
  }
  fecha()
  return out
}
