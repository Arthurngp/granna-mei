/**
 * Correção sem lançamento em dobro, de ponta a ponta (banco e IA falsos em memória). A IA falsa ERRA de propósito:
 * trata "esse recebimento foi de X" como recebimento novo. A trava do código tem que pegar mesmo assim.
 *   npx tsx test/correcao-fluxo.ts
 *
 * Caso de origem (2026-11-18): "recebi 290" caiu em Outras entradas; "esse recebimento foi de prestação de serviço"
 * virou um segundo recebimento de 290 em vez de mudar o primeiro.
 */
import assert from 'node:assert/strict'
import { descreverNovo, devePerguntar, pareceMesmoLancamento, respostaDuplicata, temPistaDeCorrecao } from '../src/duplicata.ts'
import type { Acao, Contexto } from '../src/interpretar.ts'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, saldoNoBanco, SEM_ACAO, U1 } from './_falsos.ts'

/* ---------- partes puras ---------- */

const puro = (nome: string, fn: () => void) => {
  fn()
  console.log('  ok   ', nome)
}

puro('frases que soam como "isso que acabei de lançar" disparam a pista', () => {
  for (const f of [
    'não, esse recebimento foi de prestação de serviço',
    'na verdade foi serviço',
    'esses 290 foram de prestação de serviço',
    'isso era da casa',
    'foi de prestação de serviço',
    'Não! era no Nubank',
    'o último foi no débito',
  ]) assert.ok(temPistaDeCorrecao(f), f)
})

puro('registro novo não dispara a pista (dois cortes iguais seguidos são venda legítima)', () => {
  for (const f of ['recebi 290 do João no pix', 'corte 50 pix', 'paguei 89 de luz', 'gastei 6 no mercado', 'escova 55', 'recebi 290 da Maria']) assert.ok(!temPistaDeCorrecao(f), f)
})

puro('só pergunta com pista OU com a mesma mensagem repetida', () => {
  assert.ok(devePerguntar('não, esses 290 foram de serviço', 'recebi 290 no pix'))
  assert.ok(devePerguntar('corte 50 pix', 'corte 50 pix'))
  assert.ok(devePerguntar('Corte 50  PIX', 'corte 50 pix'), 'caixa e espaço não enganam')
  assert.ok(!devePerguntar('escova 50 pix', 'corte 50 pix'))
})

puro('respostas 1 e 2 em vários jeitos; qualquer outra coisa não é resposta', () => {
  for (const r of ['1', ' 1 ', 'sim', 'Sim.', 'o mesmo', 'corrigir']) assert.equal(respostaDuplicata(r), 'corrigir', r)
  for (const r of ['2', 'não', 'Nao', 'outro', 'é outro']) assert.equal(respostaDuplicata(r), 'novo', r)
  for (const r of ['qual meu saldo', 'recebi 50', '3', 'talvez', '']) assert.equal(respostaDuplicata(r), null, r)
})

const CTX = { categorias: [{ id: 'servicos', nome: 'Prestação de serviço' }], carteiras: [{ id: 'nubank', nome: 'Nubank' }] } as unknown as Contexto
const nova = (x: Partial<Acao>) => ({ ...acao({ valor: 290, movimento: 'entrada' }), ...x }) as unknown as Acao
const velha = { id: 'l', tipo: 'entrada', valor: 290, categoria_id: 'outras-entradas', carteira_id: 'nubank', pessoal: false }

puro('mesmo lançamento = uma ação, mesmo sentido, mesmo valor; mais de uma ação nunca dispara', () => {
  assert.ok(pareceMesmoLancamento([velha], [nova({})]))
  assert.equal(pareceMesmoLancamento([velha], [nova({ valor: 300 })]), null, 'valor diferente')
  assert.equal(pareceMesmoLancamento([velha], [nova({ movimento: 'saida' })]), null, 'sentido diferente')
  assert.equal(pareceMesmoLancamento([velha], [nova({}), nova({})]), null, 'duas ações')
  assert.equal(pareceMesmoLancamento([velha, velha], [nova({})]), null, 'dois lançamentos antigos')
  assert.equal(pareceMesmoLancamento([velha], [nova({ tipo_acao: 'conta' })]), null, 'conta a pagar não é lançamento')
  assert.equal(pareceMesmoLancamento([], [nova({})]), null)
  assert.ok(pareceMesmoLancamento([{ ...velha, tipo: 'compra_cartao' }], [nova({ movimento: 'saida' })]), 'compra no cartão conta como saída')
  assert.ok(pareceMesmoLancamento([{ ...velha, valor: 0.1 + 0.2 }], [nova({ valor: 0.3 })]), 'centavos não enganam')
})

puro('o texto do "Agora" mostra categoria e conta pelo nome', () => {
  assert.match(descreverNovo(nova({ categoria_id: 'servicos', carteira_id: 'nubank', descricao: '' }), CTX), /R\$ 290,00 · Prestação de serviço · Nubank/)
})

/* ---------- ponta a ponta ---------- */

const servico = () => E.tabelas.categorias.push({ user_id: U1, id: 'servicos', nome: 'Prestação de serviço', tipo: 'entrada', pessoal: false })
/** A IA falsa erra: lê a correção como recebimento NOVO de 290, já com a categoria certa. */
const iaErra = () => {
  ia.regras = [
    [/esses 290 foram de presta/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'servicos', descricao: 'Prestação de serviço', meio: 'pix' }))],
    [/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'outras-entradas', descricao: 'Recebimento', meio: 'pix' }))],
    [/desfazer/i, { ...SEM_ACAO, intencao: 'desfazer' }],
  ]
}
const CORRECAO = 'não, esses 290 foram de prestação de serviço'

await caso('CASO DOS R$ 290: a IA erra e lê a correção como recebimento novo; a trava pergunta e NADA é gravado antes da resposta', async () => {
  servico()
  iaErra()
  const r1 = await msg('recebi 290 no pix')
  assert.match(r1, /Outras entradas|Recebimento/)
  const r2 = await msg(CORRECAO)
  assert.match(r2, /acabou de lançar R\$ 290,00/)
  assert.match(r2, /1\. Sim, corrigir o anterior/)
  assert.equal(lancsU1().length, 1, 'continua um só lançamento enquanto não responde')
  assert.equal(saldoNoBanco('nubank'), 1290)
})

await caso('resposta 1: corrige o anterior no lugar, mostra Antes e Agora, e o saldo conta UM recebimento', async () => {
  servico()
  iaErra()
  await msg('recebi 290 no pix')
  await msg(CORRECAO)
  const r = await msg('1')
  assert.match(r, /Corrigido/)
  assert.match(r, /Antes: R\$ 290,00 · .*Outras entradas · Nubank/)
  assert.match(r, /Agora: R\$ 290,00 · .*Prestação de serviço · Nubank/)
  assert.match(r, /Saldo Nubank: R\$ 1\.290,00/)
  assert.equal(lancsU1().length, 1)
  assert.equal(lancsU1()[0].categoria_id, 'servicos')
  assert.equal(saldoNoBanco('nubank'), 1290)
})

await caso('resposta 2: era outro recebimento mesmo, entram os dois', async () => {
  servico()
  iaErra()
  await msg('recebi 290 no pix')
  await msg(CORRECAO)
  const r = await msg('2')
  assert.match(r, /Anotado: entrada de R\$ 290,00/)
  assert.match(r, /Saldo Nubank: R\$ 1\.580,00/)
  assert.equal(lancsU1().length, 2)
})

await caso('DESFAZER depois da correção tira o lançamento corrigido e o saldo volta', async () => {
  servico()
  iaErra()
  await msg('recebi 290 no pix')
  await msg(CORRECAO)
  await msg('1')
  const r = await msg('desfazer')
  assert.match(r, /Pronto, desfiz/)
  assert.equal(lancsU1().length, 0)
  assert.equal(saldoNoBanco('nubank'), 1000)
})

await caso('dois cortes de 50 seguidos, descrições diferentes e sem pista: lança os dois SEM perguntar', async () => {
  ia.regras = [
    [/corte 50/, acoes(acao({ valor: 50, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Corte', meio: 'pix' }))],
    [/escova 50/, acoes(acao({ valor: 50, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Escova', meio: 'pix' }))],
  ]
  await msg('corte 50 pix')
  const r = await msg('escova 50 pix')
  assert.match(r, /Anotado: entrada de R\$ 50,00/)
  assert.ok(!/mesmo/.test(r))
  assert.equal(lancsU1().length, 2)
})

await caso('a MESMA mensagem repetida logo em seguida pergunta antes de lançar em dobro', async () => {
  ia.regras = [[/corte 50/, acoes(acao({ valor: 50, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Corte', meio: 'pix' }))]]
  await msg('corte 50 pix')
  const r = await msg('corte 50 pix')
  assert.match(r, /Esse novo é o mesmo/)
  assert.equal(lancsU1().length, 1)
  await msg('2')
  assert.equal(lancsU1().length, 2)
})

await caso('passou da janela de 15 minutos: não pergunta, é lançamento novo', async () => {
  servico()
  iaErra()
  await msg('recebi 290 no pix')
  for (const m of E.tabelas.mensagens) m.criado_em = new Date(Date.now() - 20 * 60_000).toISOString()
  const r = await msg(CORRECAO)
  assert.match(r, /Anotado: entrada de R\$ 290,00/)
  assert.equal(lancsU1().length, 2)
})

await caso('valor diferente não dispara a trava (é outro lançamento)', async () => {
  servico()
  ia.regras = [
    [/foi 300/, acoes(acao({ valor: 300, movimento: 'entrada', categoria_id: 'servicos', descricao: 'Serviço', meio: 'pix' }))],
    [/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'outras-entradas', descricao: 'Recebimento', meio: 'pix' }))],
  ]
  await msg('recebi 290 no pix')
  const r = await msg('não, foi 300 de serviço')
  assert.match(r, /Anotado: entrada de R\$ 300,00/)
  assert.equal(lancsU1().length, 2)
})

await caso('quando a IA acerta e classifica como "corrigir", muda o anterior e mostra Antes e Agora', async () => {
  servico()
  ia.regras = [
    [/Correção:/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'servicos', descricao: 'Prestação de serviço', meio: 'pix' }))],
    [/esse recebimento foi/, { ...SEM_ACAO, intencao: 'corrigir', correcao: 'foi de prestação de serviço' }],
    [/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'outras-entradas', descricao: 'Recebimento', meio: 'pix' }))],
  ]
  await msg('recebi 290 no pix')
  const r = await msg('esse recebimento foi de serviço')
  assert.match(r, /Corrigido/)
  assert.match(r, /Antes: .*Outras entradas/)
  assert.match(r, /Agora: .*Prestação de serviço/)
  assert.equal(lancsU1().length, 1)
  assert.equal(saldoNoBanco('nubank'), 1290)
})

await caso('outra mensagem no lugar da resposta: a pergunta é deixada de lado e nada é gravado às cegas', async () => {
  servico()
  iaErra()
  await msg('recebi 290 no pix')
  await msg(CORRECAO)
  const saldo = await msg('qual meu saldo')
  assert.match(saldo, /Nubank: R\$ 1\.290,00/)
  const r = await msg('1')
  assert.ok(!/Corrigido/.test(r), 'a pergunta antiga já foi descartada')
  assert.equal(lancsU1().length, 1)
})

await caso('se o anterior foi desfeito no meio, responder 1 não mexe em nada', async () => {
  servico()
  iaErra()
  await msg('recebi 290 no pix')
  await msg(CORRECAO)
  for (const m of E.tabelas.mensagens) m.desfeita = true
  const r = await msg('1')
  assert.match(r, /Não achei mais aquele lançamento/)
  assert.equal(lancsU1().length, 1)
})

fim()
