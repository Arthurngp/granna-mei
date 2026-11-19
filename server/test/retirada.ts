/**
 * Quando a Granninha decide sozinha que o gasto foi SEU, ela diz isso e aceita a correção num toque.
 *
 * Caso de origem (2026-11-19): "paguei a luz" virou retirada do dono sem nenhuma pergunta, e noutra
 * rodada do mesmo dia ela perguntou. Retirada não conta como despesa do negócio, então a decisão mexe
 * no lucro do relatório em silêncio.
 *   npx tsx test/retirada.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, fim, ia, lancsU1, msg } from './_falsos.ts'

const { ehDoNegocio, avisoDeRetirada, categoriaDeNegocio } = await import('../src/retirada.ts')

const CTX = {
  hoje: '2026-11-19',
  categorias: [
    { id: 'material', nome: 'Material', tipo: 'saida' as const },
    { id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida' as const },
    { id: 'casa', nome: 'Casa e família', tipo: 'saida' as const, pessoal: true },
    { id: 'vendas', nome: 'Vendas', tipo: 'entrada' as const },
  ],
  carteiras: [],
  contasAbertas: [],
} as unknown as Parameters<typeof avisoDeRetirada>[1]

const gasto = (x: Record<string, unknown> = {}) => ({ tipo_acao: 'lancamento', movimento: 'saida', pessoal: true, descricao: 'Conta de luz', ...x }) as unknown as Parameters<typeof avisoDeRetirada>[0][number]

/* ---------------- reconhecer a correção ---------------- */

await caso('"negócio" e variações são entendidos; frase comum não', async () => {
  for (const t of ['negócio', 'NEGOCIO', 'do negócio', 'é do negócio', 'foi do negócio', 'empresa', 'da empresa', 'trabalho', 'negócio.']) {
    assert.equal(ehDoNegocio(t), true, t)
  }
  for (const t of ['paguei 50 de material do negócio', 'negócio fechado', 'meu negócio vai bem', '']) {
    assert.equal(ehDoNegocio(t), false, t)
  }
})

/* ---------------- quando avisar ---------------- */

await caso('ela decidiu sozinha: avisa', async () => {
  const r = avisoDeRetirada([gasto()], { ...CTX, lembrancaPessoal: {} } as never)
  assert.match(r, /retirada sua, não como gasto do negócio/)
  assert.match(r, /responda NEGÓCIO/)
})

await caso('a pessoa escolheu agora: NÃO avisa', async () => {
  assert.equal(avisoDeRetirada([gasto()], { ...CTX, lembrancaPessoal: {} } as never, true), '', 'ela acabou de dizer que é pessoal')
  assert.equal(avisoDeRetirada([gasto({ pessoal: false })], { ...CTX, lembrancaPessoal: {} } as never, false), '')
})

await caso('o histórico dela já dizia que é pessoal: NÃO avisa', async () => {
  const r = avisoDeRetirada([gasto({ descricao: 'Conta de luz' })], { ...CTX, lembrancaPessoal: { luz: true } } as never)
  assert.equal(r, '', 'avisar de novo sobre o que ela já decidiu vira ruído')
})

await caso('o histórico dizia negócio e a IA decidiu pessoal: avisa', async () => {
  const r = avisoDeRetirada([gasto({ descricao: 'Conta de luz' })], { ...CTX, lembrancaPessoal: { luz: false } } as never)
  assert.match(r, /responda NEGÓCIO/, 'é justamente o caso em que ela contrariou o histórico')
})

await caso('gasto do negócio e entrada não geram aviso', async () => {
  assert.equal(avisoDeRetirada([gasto({ pessoal: false })], { ...CTX, lembrancaPessoal: {} } as never), '')
  assert.equal(avisoDeRetirada([gasto({ movimento: 'entrada' })], { ...CTX, lembrancaPessoal: {} } as never), '')
})

/* ---------------- a categoria ao virar ---------------- */

await caso('ao virar para o negócio, categoria pessoal vira "Outros gastos"', async () => {
  assert.equal(categoriaDeNegocio(CTX as never, 'casa'), 'outras-saidas', 'categoria de gasto pessoal não serve')
  assert.equal(categoriaDeNegocio(CTX as never, 'material'), 'material', 'categoria de negócio é mantida')
  assert.equal(categoriaDeNegocio(CTX as never, null), 'outras-saidas')
  assert.equal(categoriaDeNegocio(CTX as never, 'vendas'), 'outras-saidas', 'categoria de entrada não serve para gasto')
})

/* ---------------- de ponta a ponta ---------------- */

await caso('a confirmação avisa, e "NEGÓCIO" conserta o lançamento', async () => {
  ia.regras = [[/luz/, acoes(acao({ valor: 89, descricao: 'Conta de luz', pessoal: true, categoria_id: null }))]]
  const r1 = await msg('paguei a luz 89')
  assert.match(r1, /retirada/, 'ela anotou como retirada: ' + r1)
  assert.match(r1, /responda NEGÓCIO/, 'e avisou que decidiu isso')
  assert.equal(lancsU1().length, 1)
  assert.equal(lancsU1()[0].pessoal, true)

  const r2 = await msg('negócio')
  assert.match(r2, /mudei/)
  assert.match(r2, /Conta de luz/)
  assert.equal(lancsU1().length, 1, 'conserta o que existe, não cria outro')
  assert.equal(lancsU1()[0].pessoal, false, 'virou gasto do negócio')
})

await caso('"NEGÓCIO" sem nada para consertar não quebra nem mente', async () => {
  const r = await msg('negócio')
  assert.doesNotMatch(r, /mudei/, 'não diz que mudou o que não existe: ' + r)
})

await caso('"NEGÓCIO" depois de um gasto que JÁ era do negócio não mexe em nada', async () => {
  ia.regras = [[/material/, acoes(acao({ valor: 30, descricao: 'Material', pessoal: false }))]]
  await msg('paguei 30 de material')
  assert.equal(lancsU1()[0].pessoal, false)
  const r = await msg('negócio')
  assert.doesNotMatch(r, /mudei/)
  assert.equal(lancsU1().length, 1)
})

fim()
