/**
 * Número que PODE ser valor em dinheiro, separado de dígito que faz parte de um nome.
 *
 * Caso de origem (Matheus, cliente real, 16/11/2026): depois de desfazer um lançamento ele escreveu
 * "foi compra no cartão de débito dentro do cartão C6 Bank". O "6" do C6 fez a trava de conferência de
 * valor disparar, a Granninha respondeu "só para conferir: o valor é quanto?", ele repetiu a frase,
 * recebeu a mesma pergunta e desistiu. O gasto dele nunca foi registrado.
 *   npx tsx test/numeros.ts
 */
export {} // módulo: o import dinâmico abaixo precisa disso

process.env.SUPABASE_URL ??= 'http://127.0.0.1:1'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'falsa'
process.env.OPENAI_API_KEY ??= 'falsa'
const { temNumeroDeValor, numerosDoTexto, valorConfere } = await import('../src/numeros.ts')

let falhou = 0
function caso(nome: string, fn: () => void) {
  try {
    fn()
    console.log('  ok  ', nome)
  } catch (e) {
    falhou++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 200))
  }
}
const igual = (veio: unknown, esperado: unknown, o_que: string) => {
  if (veio !== esperado) throw new Error(`${o_que}: veio ${JSON.stringify(veio)}, esperado ${JSON.stringify(esperado)}`)
}

caso('dígito que é parte de nome NÃO é valor', () => {
  for (const t of [
    'foi compra no cartão de débito dentro do cartão C6 Bank', // a frase exata do caso real
    'C6 Bank',
    'paguei no 99app',
    'comprei na Loja2',
    'em 4x',
    'foi no crédito',
  ]) igual(temNumeroDeValor(t), false, t)
})

caso('número de dinheiro é valor, do jeito que o MEI escreve', () => {
  for (const t of [
    'paguei 50 de gasolina',
    '33,58',
    'R$ 89,90 de luz',
    'comprei 1.200 de material em 4x',
    'comprei 1.5k de material',
    'recebi 2 mil hoje',
    'paguei 1.200,50',
    'gastei 50 conto',
    'loja 2 cobrou 80',
  ]) igual(temNumeroDeValor(t), true, t)
})

caso('a trava de valor continua pegando valor que não está na frase', () => {
  // É para isto que a trava existe: a IA não pode inventar um valor que a pessoa não disse.
  igual(temNumeroDeValor('paguei 50 de gasolina') && !valorConfere('paguei 50 de gasolina', 500), true, 'valor diferente do dito')
  igual(valorConfere('paguei 50 de gasolina', 50), true, 'valor que está na frase')
  igual(valorConfere('comprei 1.200 de material em 4x', 1200), true, 'total escrito')
  igual(valorConfere('3 cortes de 50', 150), true, 'quantidade vezes preço')
  igual(valorConfere('120 de luz mais 30 de multa', 150), true, 'soma')
})

caso('a leitura dos números em si não mudou', () => {
  igual(numerosDoTexto('R$ 1.200,50').join(), '1200.5', '1.200,50')
  igual(numerosDoTexto('2 mil').join(), '2000', '2 mil')
  igual(numerosDoTexto('1.5k').join(), '1500', '1.5k')
  igual(numerosDoTexto('89,90').join(), '89.9', '89,90')
})

console.log(falhou ? `\n${falhou} falha(s)` : '\n4 casos ok')
process.exit(falhou ? 1 : 0)
