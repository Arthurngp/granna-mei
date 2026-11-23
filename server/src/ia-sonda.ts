/**
 * Sonda da IA (item seg-ia-sonda): descobre a IA parada ANTES de um cliente ser atingido.
 *
 * Até aqui o estado da IA (ia-estado.ts) só mudava quando uma chamada real falhava. Se o crédito acabasse de madrugada e ninguém escrevesse,
 * o /saude seguia dizendo "ok" até o primeiro cliente levar o erro, e só então o alerta no WhatsApp, o monitor de fora e a vigilância da Amora
 * enxergavam. Foi o caso de 2026-11-19. A sonda é uma chamada mínima (1 mensagem curta, poucas dezenas de tokens) feita pelo batimento, que alimenta
 * o MESMO estado: então o alerta, o /saude, a retomada das mensagens presas e a Amora ganham a detecção de graça.
 *
 * Regras (cada uma evita um alarme falso ou um gasto à toa):
 *  - só sonda se nenhuma chamada REAL deu certo há poucos minutos (tráfego normal já prova que a IA responde);
 *  - cota esgotada e chave inválida viram problema na hora: não são ambíguas;
 *  - limite de taxa e instabilidade só viram problema depois de DUAS falhas seguidas (a segunda logo em seguida), senão o alerta ficaria
 *    oscilando entre "parou" e "voltou";
 *  - erro 400 (a chamada da sonda mal formada, defeito nosso) fica registrado mas NÃO derruba o estado da IA: a IA não está parada;
 *  - com a IA já em problema sonda com mais frequência, para a volta ser percebida logo (e a retomada das mensagens presas começar);
 *  - os tokens da sonda NÃO entram no custo por cliente do admin (a sonda não passa pelo registro de uso), só aparecem aqui, medidos.
 */
import { chamadaMinimaIA } from './openai.ts'
import { estadoIA, registrarFalhaIA, registrarOkSonda, type TipoFalhaIA } from './ia-estado.ts'

/** Entre uma sonda e outra com a IA bem. */
export const SONDA_INTERVALO_MS = 10 * 60_000
/** Entre uma sonda e outra com a IA em problema: a volta precisa ser percebida logo. */
export const SONDA_INTERVALO_FORA_MS = 2 * 60_000
/** Uma chamada real que deu certo há menos que isto dispensa a sonda. */
export const SONDA_FRESCO_MS = 10 * 60_000
/** Espera antes da segunda tentativa, nas falhas que podem ser passageiras. */
export const SONDA_CONFIRMAR_MS = 5_000

export type ResultadoSonda = 'ok' | TipoFalhaIA
type Chamada = Awaited<ReturnType<typeof chamadaMinimaIA>>

const sonda = {
  ultima: null as string | null,
  resultado: null as ResultadoSonda | null,
  ultimoOk: null as string | null,
  entrada: null as number | null,
  saida: null as number | null,
  chamadas: 0,
  detalhe: null as string | null,
}
let proxima = 0
let emAndamento = false

export function estadoSonda() {
  return {
    ultima: sonda.ultima,
    resultado: sonda.resultado,
    ultimo_ok: sonda.ultimoOk,
    tokens_entrada: sonda.entrada,
    tokens_saida: sonda.saida,
    chamadas: sonda.chamadas,
    detalhe: sonda.detalhe,
  }
}

/** Só para o teste. */
export function zerarSonda() {
  sonda.ultima = sonda.resultado = sonda.ultimoOk = sonda.entrada = sonda.saida = sonda.detalhe = null
  sonda.chamadas = 0
  proxima = 0
  emAndamento = false
}

/** Cota e chave não dependem de sorte: se a OpenAI disse, é verdade. Limite de taxa e queda de rede podem ser um soluço. */
const definitiva = (t: TipoFalhaIA) => t === 'sem_cota' || t === 'sem_chave'

export interface OpcoesSonda {
  agora?: number
  chamar?: () => Promise<Chamada>
  esperar?: (ms: number) => Promise<void>
}

/** Devolve o que fez: 'pulou' (não é a hora), 'dispensada' (tráfego real recente), ou o resultado da chamada. */
export async function sondarIA(o: OpcoesSonda = {}): Promise<'pulou' | 'dispensada' | ResultadoSonda> {
  const agora = o.agora ?? Date.now()
  const chamar = o.chamar ?? chamadaMinimaIA
  const esperar = o.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)))
  if (agora < proxima) return 'pulou'

  const e = estadoIA()
  if (e.ok && e.ultimo_ok && agora - Date.parse(e.ultimo_ok) < SONDA_FRESCO_MS) return 'dispensada'
  if (emAndamento) return 'pulou'
  emAndamento = true
  try {
    let r = await chamar()
    sonda.chamadas++
    if (!r.ok && !definitiva(r.tipo) && r.tipo !== 'outro') {
      // Pode ser um soluço: confere uma vez antes de dar o problema como real.
      await esperar(SONDA_CONFIRMAR_MS)
      r = await chamar()
      sonda.chamadas++
    }

    sonda.ultima = new Date(agora).toISOString()
    if (r.ok) {
      sonda.resultado = 'ok'
      sonda.ultimoOk = sonda.ultima
      sonda.entrada = r.uso.entrada
      sonda.saida = r.uso.saida
      sonda.detalhe = null
      registrarOkSonda()
    } else {
      sonda.resultado = r.tipo
      sonda.detalhe = r.detalhe.slice(0, 200)
      // Erro 400 é a chamada da sonda mal formada: defeito nosso, a IA não está parada. Fica no /saude, mas não vira alerta de IA fora.
      if (r.tipo !== 'outro') registrarFalhaIA(r.tipo, r.detalhe)
    }
    // O intervalo da próxima depende do estado DEPOIS desta chamada: a sonda que descobre o problema já agenda a próxima para daqui a 2 minutos.
    proxima = agora + (estadoIA().ok ? SONDA_INTERVALO_MS : SONDA_INTERVALO_FORA_MS)
    return r.ok ? 'ok' : r.tipo
  } finally {
    emAndamento = false
  }
}
