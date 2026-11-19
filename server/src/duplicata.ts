/**
 * Trava contra lançamento em dobro quando a pessoa queria CORRIGIR o último.
 *
 * Caso de origem (2026-11-18): "recebi 290" caiu em "Outras entradas"; depois "esse recebimento foi de prestação de
 * serviço" virou um SEGUNDO recebimento de 290 em vez de mudar o primeiro. A IA decide se a frase é correção ou registro
 * novo, e ela erra às vezes. Esta trava não depende dela: se o que ia ser gravado é igual ao último lançamento (mesmo
 * tipo e valor, poucos minutos antes) e a frase soa como correção, NADA é gravado antes de a pessoa responder 1 ou 2.
 */
import type { Acao, Contexto } from './interpretar.ts'

/** Janela em que um lançamento igual ao último ainda pode ser "o mesmo". */
export const JANELA_MIN = 15

export interface LancAntigo {
  id: string
  tipo: string
  valor: number
  categoria_id: string | null
  carteira_id: string
  pessoal: boolean
  descricao?: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const cent = (n: number) => Math.round(n * 100) / 100
const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A frase soa como "isso que acabei de lançar": "não, esse foi de...", "na verdade", "esses 290 foram de...". */
export function temPistaDeCorrecao(texto: string): boolean {
  const t = norm(texto)
  return /^(nao|na verdade|errei|corrig|opa|ops)\b/.test(t)
    || /\b(esse|essa|esses|essas|este|esta|isso|aquele|aquela|o ultimo|a ultima|o de agora|acabei de)\b/.test(t)
    || /\b(foi|foram|era|eram)\s+(de|da|do|na|no|um|uma|pra|para|com)\b/.test(t)
}

/** É a mesma mensagem mandada de novo (sem nenhuma palavra a mais)? */
export const mesmoTexto = (a: string, b: string) => norm(a) === norm(b) && norm(a).length > 0

const direcao = (tipo: string) => (tipo === 'entrada' ? 'entrada' : tipo === 'saida' || tipo === 'compra_cartao' ? 'saida' : null)

/**
 * O que ia ser gravado é igual ao último lançamento (mesmo sentido e mesmo valor)? Só vale quando as duas coisas são UMA
 * ação cada: mensagem com várias ações nunca dispara a trava.
 */
export function pareceMesmoLancamento(antigos: LancAntigo[], novas: Acao[]): LancAntigo | null {
  if (antigos.length !== 1 || novas.length !== 1) return null
  const a = antigos[0]
  const n = novas[0]
  if (n.tipo_acao !== 'lancamento' || n.valor == null) return null
  const d = direcao(a.tipo)
  if (!d || d !== n.movimento) return null
  return cent(a.valor) === cent(n.valor) ? a : null
}

/** Deve perguntar? Só com pista de correção ou com a mesma mensagem repetida: dois cortes iguais seguidos são venda legítima. */
export function devePerguntar(textoNovo: string, textoAntigo: string): boolean {
  return temPistaDeCorrecao(textoNovo) || mesmoTexto(textoNovo, textoAntigo)
}

const MIDIA = new Set(['audio', 'foto', 'pdf'])

/**
 * Reenvio da MESMA mídia. Áudio e foto demoram alguns segundos para virar lançamento; a pessoa acha
 * que travou e manda de novo, e aí o mesmo gasto entra duas vezes.
 *
 * Em texto isso não vale (dois cortes de R$ 40 seguidos são duas vendas de verdade, e a mesma frase
 * repetida já cai em `devePerguntar`). Em mídia, mandar duas vezes o mesmo valor em poucos minutos é
 * quase sempre reenvio — mas não dá para descartar calado, então a Granninha pergunta.
 */
export function pareceReenvio(origemNova: string, origemAntiga: string | null | undefined, antigos: LancAntigo[], novas: Acao[]): LancAntigo | null {
  if (!MIDIA.has(origemNova) || !origemAntiga || !MIDIA.has(origemAntiga)) return null
  return pareceMesmoLancamento(antigos, novas)
}

export function perguntaReenvio(a: LancAntigo, ctx: Contexto, minutos: number): string {
  const quando = minutos < 1 ? 'agora mesmo' : `há ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`
  return `Já anotei ${quando}: ${descreverAntigo(a, ctx)}. É o mesmo?\n\n1. Sim, é o mesmo (não anoto de novo)\n2. Não, é outro lançamento\n\nResponda com o número.`
}

const nomeCat = (ctx: Contexto, id: string | null) => ctx.categorias.find((c) => c.id === id)?.nome ?? 'Sem categoria'
const nomeCart = (ctx: Contexto, id: string) => ctx.carteiras.find((c) => c.id === id)?.nome ?? 'carteira'

export function descreverAntigo(a: LancAntigo, ctx: Contexto): string {
  return `${brl(a.valor)} · ${a.descricao ? a.descricao + ' · ' : ''}${a.pessoal ? 'retirada' : nomeCat(ctx, a.categoria_id)} · ${nomeCart(ctx, a.carteira_id)}`
}
export function descreverNovo(n: Acao, ctx: Contexto): string {
  return `${brl(n.valor ?? 0)} · ${n.descricao ? n.descricao + ' · ' : ''}${n.pessoal ? 'retirada' : nomeCat(ctx, n.categoria_id)} · ${nomeCart(ctx, n.carteira_id)}`
}

export function perguntaDuplicata(a: LancAntigo, ctx: Contexto): string {
  return `Você acabou de lançar ${descreverAntigo(a, ctx)}. Esse novo é o mesmo?\n\n1. Sim, corrigir o anterior\n2. Não, é outro lançamento\n\nResponda com o número.`
}

/** Linhas "Antes / Agora" que mostram exatamente o que mudou numa correção. Vazio se não for um para um. */
export function antesEAgora(antigos: LancAntigo[], novas: Acao[], ctx: Contexto): string {
  if (antigos.length !== 1 || novas.length !== 1) return ''
  return `Antes: ${descreverAntigo(antigos[0], ctx)}\nAgora: ${descreverNovo(novas[0], ctx)}`
}

/** 1/sim ou 2/não, para as perguntas de confirmação (mesmas palavras aceitas). */
export function respostaSimNao(texto: string): 'sim' | 'nao' | null {
  const r = respostaDuplicata(texto)
  return r === 'corrigir' ? 'sim' : r === 'novo' ? 'nao' : null
}

/** Resposta do cliente à pergunta 1 ou 2. null = não é resposta (é outra mensagem). */
export function respostaDuplicata(texto: string): 'corrigir' | 'novo' | null {
  const t = norm(texto).replace(/[.!)]+$/, '')
  if (/^(1|sim|s|o mesmo|mesmo|corrigir|corrige|isso|e o mesmo)$/.test(t)) return 'corrigir'
  if (/^(2|nao|n|outro|e outro|novo|outro lancamento)$/.test(t)) return 'novo'
  return null
}
