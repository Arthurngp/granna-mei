/**
 * Números que aparecem numa mensagem, do jeito que o MEI escreve:
 * "120", "1.200", "1200,50", "R$ 89,90", "1,2 mil", "2 mil", "1.5k", "3k", "50 conto".
 * Serve para conferir que o valor que a IA leu está mesmo na frase.
 */
export function numerosDoTexto(texto: string): number[] {
  const t = texto.toLowerCase().replace(/r\$\s*/g, ' ')
  const r: number[] = []
  const re = /(\d{1,3}(?:\.\d{3})+|\d+)(?:([.,])(\d{1,2}))?(?:\s*(mil|k)\b)?/g
  for (const m of t.matchAll(re)) {
    const inteiro = m[1].replace(/\./g, '')
    const sep = m[2]
    const dec = m[3]
    const mult = m[4] ? 1000 : 1
    let n: number
    if (dec !== undefined && mult === 1000) n = Number(`${inteiro}.${dec}`) * 1000 // 1,2 mil / 1.5k
    else if (dec !== undefined && sep === ',') n = Number(`${inteiro}.${dec}`) // 89,90
    else if (dec !== undefined && sep === '.' && dec.length === 2) n = Number(`${inteiro}.${dec}`) // 89.90 (teclado em inglês)
    else n = Number(inteiro) * mult
    if (Number.isFinite(n) && n > 0) r.push(Math.round(n * 100) / 100)
  }
  return r
}

export const temDigito = (t: string) => /\d/.test(t)

/**
 * O texto tem algum número que PODE ser um valor em dinheiro?
 *
 * Nome de conta e de produto costuma ter dígito ("C6 Bank", "99app", "Loja 2"), e isso não é valor.
 * A diferença é a fronteira: número de valor não vem colado a letra (só às unidades "mil" e "k").
 *
 * Caso real (Matheus, 16/11/2026): depois de desfazer um lançamento ele escreveu "foi compra no cartão
 * de débito dentro do cartão C6 Bank". O "6" do C6 fez a trava de conferência de valor disparar, e a
 * Granninha respondeu "só para conferir: o valor é quanto?" em vez de anotar. Ele repetiu a frase,
 * recebeu a mesma pergunta e desistiu — o gasto nunca foi registrado.
 */
export function temNumeroDeValor(t: string): boolean {
  // Número não precedido por letra/dígito e não seguido por letra, exceto "mil" e "k".
  return /(?<![\p{L}\d])\d[\d.,]*(?:\s*(?:mil|k)\b)?(?![\p{L}\d])/u.test(t.toLowerCase())
}

/** O valor lido bate com algum número da frase (ou é o total de N parcelas de um número da frase)? */
export function valorConfere(texto: string, valor: number, parcelas?: number | null): boolean {
  const ns = numerosDoTexto(texto)
  const perto = (a: number, b: number) => Math.abs(a - b) < 0.011
  if (ns.some((n) => perto(n, valor))) return true
  if (parcelas && parcelas > 1 && ns.some((n) => perto(n * parcelas, valor))) return true
  // Soma ("120 de luz mais 30 de multa") ou quantidade vezes preço ("3 cortes de 50").
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) if (perto(ns[i] + ns[j], valor) || (Math.min(ns[i], ns[j]) <= 50 && perto(ns[i] * ns[j], valor))) return true
  return false
}
