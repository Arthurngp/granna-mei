/**
 * Por que a IA parou e desde quando.
 *
 * Existe por causa de 2026-11-19: a chave da OpenAI ficou SEM COTA e ninguém foi avisado. A Granninha
 * respondia "tive um problema para anotar agora" para todo mundo, nenhum lançamento entrava, e isso só
 * apareceu porque eu estava rodando o teste de fluxo — com o Instagram publicando nove peças por dia
 * levando gente nova para um produto que não respondia.
 *
 * Agora o /saude conta o que está acontecendo, para o monitoramento acordar alguém, e o admin registra
 * o motivo em vez de um erro genérico.
 */
export type TipoFalhaIA = 'sem_cota' | 'sem_chave' | 'limite' | 'fora' | 'outro'

export class ErroIA extends Error {
  constructor(readonly tipo: TipoFalhaIA, mensagem: string, readonly status?: number) {
    super(mensagem)
    this.name = 'ErroIA'
  }
}

/** O que a OpenAI está dizendo, em uma palavra que serve para decidir o que fazer. */
export function classificarFalhaIA(status: number, corpo: string): TipoFalhaIA {
  const t = (corpo || '').toLowerCase()
  if (/insufficient_quota|exceeded your current quota|billing|check your plan/.test(t)) return 'sem_cota'
  if (status === 429) return 'limite'
  if (status === 401 || status === 403) return 'sem_chave'
  if (status >= 500 || status === 0) return 'fora'
  return 'outro'
}

/**
 * Vale insistir? Limite de taxa passa em segundos e instabilidade também. Cota e chave inválida NÃO:
 * repetir três vezes só faz a cliente esperar mais para receber o mesmo erro.
 */
export const valeTentarDeNovoIA = (tipo: TipoFalhaIA) => tipo === 'limite' || tipo === 'fora'

/**
 * Marca no campo `erro` de mensagens que podem ser retomadas quando a IA voltar.
 *
 * Só vale para falha EXTERNA e temporária. A premissa de segurança é que uma falha de IA acontece
 * sempre ANTES de gravar qualquer coisa: as chamadas de IA (transcrever, ler documento, interpretar)
 * vêm todas antes do executar(), e nenhum caminho que grava chama IA depois. `test/ia-fora.ts` prova
 * isso caminho por caminho — se alguém mover uma chamada de IA para depois do executar, o teste cai.
 */
export const MARCA_RETOMAR = 'IA_RETOMAR'

/** Dá para tentar essa mensagem de novo quando a IA voltar? Erro nosso (400) não melhora com o tempo. */
export const valeRetomarIA = (tipo: TipoFalhaIA) => tipo === 'sem_cota' || tipo === 'limite' || tipo === 'fora'

/** Mensagem para a cliente. Nunca promete atendimento que não existe. */
export function recadoDaFalhaIA(tipo: TipoFalhaIA): string {
  if (tipo === 'limite') return 'Estou recebendo muita coisa ao mesmo tempo e não consegui anotar essa. Me manda de novo em um minuto?'
  return 'Não consegui anotar agora: é um problema técnico aqui do meu lado, não é nada com você. Me manda de novo mais tarde que eu anoto.'
}

const estado = {
  tipo: null as TipoFalhaIA | null,
  desde: null as string | null,
  ultimaFalha: null as string | null,
  ultimoOk: null as string | null,
  mensagem: '',
  falhas: 0,
  chamadasOk: 0,
}

export function registrarFalhaIA(tipo: TipoFalhaIA, mensagem: string) {
  const agora = new Date().toISOString()
  // `desde` é quando o problema ATUAL começou: só reinicia quando o tipo muda ou depois de voltar.
  if (estado.tipo !== tipo) estado.desde = agora
  estado.tipo = tipo
  estado.ultimaFalha = agora
  estado.mensagem = mensagem.slice(0, 200)
  estado.falhas++
}

/**
 * A sonda (ia-sonda.ts) viu a IA responder: encerra o problema, mas NÃO conta como chamada real nem muda `ultimo_ok`, que é o que
 * diz se há tráfego de verdade provando que a IA responde (e é por ele que a sonda se dispensa).
 */
export function registrarOkSonda() {
  estado.tipo = null
  estado.desde = null
}

export function registrarOkIA() {
  estado.ultimoOk = new Date().toISOString()
  estado.chamadasOk++
  estado.tipo = null
  estado.desde = null
}

export function estadoIA() {
  return {
    ok: estado.tipo === null,
    problema: estado.tipo,
    desde: estado.desde,
    ultima_falha: estado.ultimaFalha,
    ultimo_ok: estado.ultimoOk,
    falhas: estado.falhas,
    chamadas_ok: estado.chamadasOk,
    detalhe: estado.mensagem || null,
  }
}

/** Só para o teste: volta ao estado inicial. */
export function zerarEstadoIA() {
  estado.tipo = null
  estado.desde = null
  estado.ultimaFalha = null
  estado.ultimoOk = null
  estado.mensagem = ''
  estado.falhas = 0
  estado.chamadasOk = 0
}
