/**
 * Extrato no WhatsApp: conferir com o que já está anotado e conversar sobre isso (pedido do Arthur em 2026-11-25).
 *
 * Antes, o print do extrato com a pergunta "quais desses já foram lançados?" recebia "Achei 6 lançamentos nesse extrato: R$ X de entradas e
 * R$ Y de saídas. Quer que eu importe? Responda SIM ou NÃO." A pergunta dele era ignorada e o tom era de formulário. Agora a Granninha confere
 * cada movimento do extrato com o que já está anotado, diz o que já tem e o que falta, e oferece anotar só o que falta.
 *
 * A conferência é a MESMA que a importação usa (`cruzar`), um a um: dois Pix de R$ 10 no mesmo dia, com um só anotado, contam como um anotado
 * e um faltando. Antes a importação usava um conjunto e pulava os dois. Se a resposta diz "faltam 2", a importação anota 2.
 * Regra de igualdade (a de sempre): mesma data, mesmo valor, mesmo sentido. Transferência anotada casa com saída ou entrada do extrato.
 */
import type { Transacao } from './midia.ts'
import { temNumeroDeValor } from './numeros.ts'

export interface Anotado {
  data: string
  valor: number | string
  tipo: string
}

const cent = (n: number | string) => Math.round(Number(n) * 100)
const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ddmm = (d: string) => d.split('-').reverse().slice(0, 2).join('/')

/** A data que o movimento vai ter ao ser anotado (sem data, ou no futuro, vira hoje). */
export const dataDe = (t: Transacao, hoje: string) => (t.data && /^\d{4}-\d{2}-\d{2}$/.test(t.data) && t.data <= hoje ? t.data : hoje)

/** Separa o extrato em já anotados e faltando, consumindo cada anotado uma vez só. */
export function cruzar(ts: Transacao[], ja: Anotado[], hoje: string): { anotadas: Transacao[]; faltam: Transacao[] } {
  const sobra = new Map<string, number>()
  for (const l of ja) {
    const k = `${l.data}|${cent(l.valor)}|${l.tipo}`
    sobra.set(k, (sobra.get(k) ?? 0) + 1)
  }
  const anotadas: Transacao[] = []
  const faltam: Transacao[] = []
  for (const t of ts) {
    // Transferência entre contas aparece no extrato como saída (de uma) ou entrada (da outra): também é "já anotado".
    const k = [`${dataDe(t, hoje)}|${cent(t.valor)}|${t.movimento}`, `${dataDe(t, hoje)}|${cent(t.valor)}|transferencia`].find((x) => (sobra.get(x) ?? 0) > 0)
    if (k) {
      sobra.set(k, sobra.get(k)! - 1)
      anotadas.push(t)
    } else faltam.push(t)
  }
  return { anotadas, faltam }
}

/**
 * A pessoa quer saber o que já está anotado ou o que falta ("quais desses já foram lançados?", "tem algum faltando?").
 * Só PERGUNTA conta (tem "?" ou começa como pergunta): "anotado", "não, já anotei" e "paguei 120 de luz, tá anotado?" são outra coisa. Texto com
 * valor próprio só conta se fala "desses/deles" ("quais desses 3 já foram?"): "já anotei o aluguel, agora anota 50 de luz" é um lançamento.
 */
export function perguntaSobreAnotados(texto: string): boolean {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const doExtrato = /\b(desses|dessas|deles|delas|disso|daqui|extrato|esse print|nesse print)\b/.test(t)
  if (temNumeroDeValor(t) && !doExtrato) return false
  const ehPergunta = t.includes('?') || /^(quais|qual|quantos|quantas|tem|algum|alguma|confere|confira|ve|ver|verifica|sera|o que|oque|ja (foi|foram|ta|tem|esta))\b/.test(t)
  if (!ehPergunta) return false
  if (/\b(lancad|lancou|lancei|anotad|anotou|anotei|registrad|cadastrad)/.test(t)) return true
  if (/\bja (foi|foram|ta|esta|estao|tem) (tudo|todos|todas)\b/.test(t)) return true
  // "quais", "falta", "confere" só contam quando falam DESTE extrato ("desses", "algum"): "quais contas vencem?" e "quanto falta pro limite?" são outra conversa.
  return (doExtrato || /\b(algum|alguma)\b/.test(t)) && /\b(falta|faltando|faltam|quais|qual|confer\w*|ja (tem|ta|esta|estao|foi|foram|entrou|entraram)|todos|tudo)\b/.test(t)
}

const MAX_LINHAS = 8
/** Uma linha por movimento, sem marcador: "24/11, saiu R$ 50,00 (Pix João)". */
export function linhas(ts: Transacao[], hoje: string): string {
  const l = ts.slice(0, MAX_LINHAS).map((t) => `${ddmm(dataDe(t, hoje))}, ${t.movimento === 'entrada' ? 'entrou' : 'saiu'} ${brl(t.valor)}${t.descricao ? ` (${t.descricao.trim().slice(0, 40)})` : ''}`)
  if (ts.length > MAX_LINHAS) l.push(`e mais ${ts.length - MAX_LINHAS}`)
  return l.join('\n')
}

const mov = (n: number) => (n === 1 ? '1 movimento' : `${n} movimentos`)

/**
 * O que a Granninha diz sobre o extrato. Devolve o texto e se ficou algo para anotar (só então há pergunta em aberto).
 * `opcoes`: a conta do extrato não foi reconhecida e a pessoa tem mais de uma; a escolha é pelo número.
 */
export function falarDoExtrato(p: { ts: Transacao[]; anotadas: Transacao[]; faltam: Transacao[]; banco?: string; perguntou: boolean; opcoes?: { nome: string }[]; hoje: string }): { texto: string; pergunta: boolean } {
  const { ts, anotadas, faltam, hoje } = p
  const doBanco = p.banco ? ` do ${p.banco}` : ''
  if (!faltam.length) {
    const ver = p.perguntou ? `\n\n${linhas(anotadas, hoje)}` : ''
    return { texto: `Conferi o extrato${doBanco}: ${ts.length === 1 ? 'o movimento já tá anotado' : `os ${ts.length} movimentos já tão anotados`} aqui, não falta nada.${ver}`, pergunta: false }
  }
  const partes: string[] = []
  if (!anotadas.length) {
    const ent = ts.filter((t) => t.movimento === 'entrada').reduce((a, t) => a + t.valor, 0)
    const sai = ts.filter((t) => t.movimento === 'saida').reduce((a, t) => a + t.valor, 0)
    const resumo = [ent ? `${brl(ent)} entrando` : '', sai ? `${brl(sai)} saindo` : ''].filter(Boolean).join(' e ')
    partes.push(`Conferi o extrato${doBanco}: ${mov(ts.length)}${resumo ? `, ${resumo}` : ''}. ${ts.length === 1 ? 'Ainda não tá anotado' : 'Nenhum deles tá anotado ainda'}:\n${linhas(faltam, hoje)}`)
  } else {
    const ja = anotadas.length === 1 ? '1 já tá anotado' : `${anotadas.length} já tão anotados`
    partes.push(`Conferi o extrato${doBanco}: ${mov(ts.length)}, e ${ja} aqui${p.perguntou ? `:\n${linhas(anotadas, hoje)}` : '.'}`)
    partes.push(`${faltam.length === 1 ? 'Falta 1' : `Faltam ${faltam.length}`}:\n${linhas(faltam, hoje)}`)
  }
  const quais = faltam.length === 1 ? 'esse' : anotadas.length ? `esses ${faltam.length}` : faltam.length === 2 ? 'os dois' : `os ${faltam.length}`
  partes.push(p.opcoes?.length ? `Quer que eu anote ${quais}? Só me diz de qual conta é esse extrato:\n${p.opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n')}` : `Quer que eu anote ${quais}?`)
  return { texto: partes.join('\n\n'), pergunta: true }
}

/** Sem acento, sem emoji, sem pontuação, minúsculo: "Sim 👍!" vira "sim". */
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Palavras de quem só está dizendo sim, sem trazer assunto novo. "anota o gás" tem "gás": não é sim. */
const VOCAB_SIM = new Set(('sim s ss pode podes anota anote anotar anotai lanca lance lancar importa importe importar quero bora beleza blz ok okay isso mesmo exato manda mandar ver claro fechou ' +
  'faz fazer vai ai tudo todos todas esses essas eles elas os as pra mim por favor pfv obrigado obrigada valeu perfeito certo e la sim pode tambem com certeza agora').split(' '))
const COMECA_SIM = /^(si+m+|s+|pode|anota|anote|anotar|lanca|lance|importa|importe|quero|bora|beleza|blz|ok|okay|isso|manda|claro|fechou|faz|vai|perfeito|certo|exato)$/
const VOCAB_NAO = new Set(('nao n deixa pra la agora precisa esquece quero obrigado obrigada valeu por enquanto nem ja anotei anotado tenho fiz isso tudo bem nada nao').split(' '))
const COMECA_NAO = /^(na+o+|n|deixa|esquece|nem|agora)$/

/** "Sim" para anotar o extrato ou a fatura, do jeito que se fala ("Sim 👍", "sim, pode importar", "pode anotar todos por favor"). Sem número, sem assunto novo. */
export function simParaAnotar(texto: string): boolean {
  const t = norm(texto)
  if (!t || /\d/.test(t)) return false
  const p = t.split(' ')
  return p.length <= 8 && COMECA_SIM.test(p[0]) && !p.includes('nao') && p.every((w) => VOCAB_SIM.has(w) || /^si+m+$/.test(w))
}

/** "Não" para o extrato ou a fatura ("não precisa não", "Não 👎", "não, já anotei", "agora não"). */
export function naoParaAnotar(texto: string): boolean {
  const t = norm(texto)
  if (!t || /\d/.test(t)) return false
  const p = t.split(' ')
  if (p.length > 8 || !COMECA_NAO.test(p[0]) || !p.every((w) => VOCAB_NAO.has(w) || /^na+o+$/.test(w))) return false
  // "agora" sozinho ou "agora sim" não é não.
  return p[0] !== 'agora' || p.includes('nao')
}
