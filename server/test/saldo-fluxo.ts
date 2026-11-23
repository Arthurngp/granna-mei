/**
 * O fluxo REAL de uma mensagem do WhatsApp (processar), de ponta a ponta, com banco e IA falsos em memória:
 * lança, confere o saldo na própria confirmação, consulta, desfaz. Prova que o saldo que a Granninha fala
 * é o saldo que está no banco. Sem rede, sem chave, sem custo.
 *   npx tsx test/saldo-fluxo.ts
 *
 * Caso de origem (2026-11-18): o Arthur lançou R$ 6 e o saldo não desceu.
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, HOJE, ia, lancsU1, msg, saldoNoBanco, SEM_ACAO, somaDias, U1 } from './_falsos.ts'

/* ---------------- casos ---------------- */

await caso('CASO DOS R$ 6: gastar 6 no pix mostra o saldo novo na própria confirmação e o saldo do banco desce 6', async () => {
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6 }))]]
  const r = await msg('gastei 6 no mercado no pix')
  assert.match(r, /saiu R\$ 6,00/)
  assert.match(r, /Saldo Nubank: R\$ 994,00/)
  assert.match(r, /Disponível no total: R\$ 1\.044,00/)
  assert.equal(lancsU1().length, 1)
  assert.equal(saldoNoBanco('nubank'), 994)
})

await caso('depois de lançar, "qual meu saldo" responde o mesmo número, SEM chamar a IA', async () => {
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6 }))]]
  await msg('gastei 6 no mercado no pix')
  const antes = ia.chamadas.interpretacao
  const r = await msg('qual meu saldo')
  assert.match(r, /Nubank: R\$ 994,00/)
  assert.match(r, /Dinheiro: R\$ 50,00/)
  assert.match(r, /Disponível no total: R\$ 1\.044,00/)
  assert.equal(ia.chamadas.interpretacao, antes, 'pergunta clara não gasta IA de interpretação')
  assert.equal(ia.chamadas.resposta, 0, 'e nunca a IA de resposta: o número sai do código')
})

await caso('o saldo do painel (soma do banco) e o da Granninha são o mesmo, lançamento a lançamento', async () => {
  ia.regras = [
    [/gastei 6/, acoes(acao({ valor: 6 }))],
    [/gastei 10/, acoes(acao({ valor: 10, carteira_id: 'dinheiro', meio: null }))],
    [/recebi 150/, acoes(acao({ valor: 150, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Venda' }))],
  ]
  for (const frase of ['gastei 6 no pix', 'gastei 10 no dinheiro', 'recebi 150 no pix', 'gastei 6 de novo no pix']) {
    ia.regras.push([new RegExp(frase.replace(/ de novo/, '')), ia.regras[0][1]])
    await msg(frase)
    const r = await msg('qual meu saldo')
    const nub = saldoNoBanco('nubank').toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    const din = saldoNoBanco('dinheiro').toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    assert.match(r, new RegExp(`Nubank: R\\$ ${nub.replace(/\./g, '\\.')}`), `${frase}: ${r}`)
    assert.match(r, new RegExp(`Dinheiro: R\\$ ${din.replace(/\./g, '\\.')}`), `${frase}: ${r}`)
  }
})

await caso('conta citada pelo nome: desce na conta certa e a outra não mexe', async () => {
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6, carteira_id: 'dinheiro', meio: null }))]]
  const r = await msg('gastei 6 no dinheiro')
  assert.match(r, /Saldo Dinheiro: R\$ 44,00/)
  assert.match(r, /Disponível no total: R\$ 1\.044,00/)
  assert.equal(saldoNoBanco('nubank'), 1000)
})

await caso('duas saídas seguidas acumulam (lê do banco, não de memória)', async () => {
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6 }))], [/gastei 10/, acoes(acao({ valor: 10 }))]]
  await msg('gastei 6 no pix')
  const r = await msg('gastei 10 no pix')
  assert.match(r, /Saldo Nubank: R\$ 984,00/)
})

await caso('entrada sobe o saldo e mostra', async () => {
  ia.regras = [[/recebi 150/, acoes(acao({ valor: 150, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Venda' }))]]
  const r = await msg('recebi 150 no pix')
  assert.match(r, /entrou R\$ 150,00/)
  assert.match(r, /Saldo Nubank: R\$ 1\.150,00/)
})

await caso('sem dizer o meio e com mais de uma conta, a Granninha PERGUNTA em vez de chutar a conta', async () => {
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6, meio: null }))]]
  const r = await msg('gastei 6 no mercado')
  assert.match(r, /saiu de qual conta\?/)
  assert.equal(lancsU1().length, 0, 'nada gravado antes de saber a conta')
  const r2 = await msg('1')
  assert.match(r2, /saiu R\$ 6,00/)
  assert.match(r2, /Saldo/)
  assert.equal(lancsU1().length, 1)
})

await caso('compra no cartão: não desce o disponível, mostra a fatura aberta', async () => {
  ia.regras = [[/gastei 100/, acoes(acao({ valor: 100, meio: 'credito' }))]]
  const r = await msg('gastei 100 no crédito')
  assert.match(r, /Cartão Inter: fatura em aberto de R\$ 100,00/)
  assert.match(r, /Disponível no total: R\$ 1\.050,00/)
  const saldo = await msg('qual meu saldo')
  assert.match(saldo, /Disponível no total: R\$ 1\.050,00/)
  assert.match(saldo, /Cartão Inter: fatura em aberto de R\$ 100,00/)
})

await caso('transferência entre contas mostra as duas e o total não muda', async () => {
  ia.regras = [[/passei 100/, acoes(acao({ tipo_acao: 'transferencia', movimento: null, valor: 100, carteira_id: 'nubank', carteira_destino_id: 'dinheiro', meio: null, categoria_id: null, descricao: 'Transferência' }))]]
  const r = await msg('passei 100 do nubank pro dinheiro')
  assert.match(r, /Saldo Nubank: R\$ 900,00/)
  assert.match(r, /Saldo Dinheiro: R\$ 150,00/)
  assert.match(r, /Disponível no total: R\$ 1\.050,00/)
})

await caso('DESFAZER devolve o saldo e mostra o saldo de volta', async () => {
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6 }))], [/desfazer/i, { ...SEM_ACAO, intencao: 'desfazer' }]]
  await msg('gastei 6 no pix')
  assert.equal(saldoNoBanco('nubank'), 994)
  const r = await msg('desfazer')
  assert.match(r, /Pronto, desfiz/)
  assert.match(r, /Saldo Nubank: R\$ 1\.000,00/)
  assert.equal(lancsU1().length, 0)
})

await caso('o dinheiro de OUTRO cliente nunca entra no saldo (filtro por usuário)', async () => {
  const r = await msg('qual meu saldo')
  assert.match(r, /Nubank: R\$ 1\.000,00/)
  assert.ok(!/99\.999|104\.999|5\.000,00/.test(r))
})

await caso('mais de mil lançamentos: o saldo não é cortado pela página do banco', async () => {
  for (let i = 0; i < 1500; i++) E.tabelas.lancamentos.push({ user_id: U1, id: `m${i}`, tipo: 'entrada', valor: 1, data: somaDias(HOJE, -(i % 300)), carteira_id: 'nubank', descricao: 'x', pessoal: false })
  const r = await msg('qual meu saldo')
  assert.match(r, /Nubank: R\$ 2\.500,00/)
})

await caso('a IA fora do ar não impede de consultar o saldo (é código, não IA)', async () => {
  ia.queda = true
  const r = await msg('qual meu saldo')
  assert.match(r, /Nubank: R\$ 1\.000,00/)
  assert.match(r, /Disponível no total: R\$ 1\.050,00/)
})

await caso('falha ao calcular o saldo depois de gravar NÃO desfaz nem esconde o lançamento', async () => {
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6 }))]]
  E.falharTabela = 'fixas' // só a consulta de saldo lê fixas: o registro em si não depende disso
  const r = await msg('gastei 6 no pix')
  assert.match(r, /saiu R\$ 6,00/)
  assert.ok(!/Saldo Nubank/.test(r), 'sem saldo inventado quando não deu para calcular')
  assert.equal(lancsU1().length, 1, 'o lançamento ficou gravado')
})

await caso('entrou hoje, saiu hoje e resumo, direto do banco', async () => {
  E.tabelas.lancamentos.push(
    { user_id: U1, id: 'a', tipo: 'entrada', valor: 200, data: HOJE, carteira_id: 'nubank', descricao: 'Venda', categoria_id: 'vendas', pessoal: false },
    { user_id: U1, id: 'b', tipo: 'saida', valor: 40, data: HOJE, carteira_id: 'nubank', descricao: 'Material', categoria_id: 'material', pessoal: false },
    { user_id: U1, id: 'v', tipo: 'saida', valor: 999, data: somaDias(HOJE, -400), carteira_id: 'nubank', descricao: 'Velho', categoria_id: 'material', pessoal: false },
  )
  assert.match(await msg('quanto entrou hoje'), /entrou R\$ 200,00/)
  assert.match(await msg('meus gastos de hoje'), /saiu R\$ 40,00/)
  assert.match(await msg('quanto saiu essa semana'), /saiu R\$ 40,00/)
  const mes = await msg('quanto sobrou esse mês?')
  assert.match(mes, /entrou R\$ 200,00, saiu R\$ 40,00/)
  assert.match(mes, /Sobrou R\$ 160,00/)
  assert.equal(ia.chamadas.resposta, 0)
})

await caso('gastos por dia, contas fixas e próximos dias saem do banco', async () => {
  E.tabelas.lancamentos.push({ user_id: U1, id: 'b', tipo: 'saida', valor: 40, data: HOJE, carteira_id: 'nubank', descricao: 'Material', categoria_id: 'material', pessoal: false })
  const dia = await msg('gastos por dia')
  assert.match(dia, /dia a dia/)
  assert.match(dia, /saiu R\$ 40,00/)
  const fixas = await msg('meus gastos fixos')
  assert.match(fixas, /Aluguel R\$ 900,00/)
  assert.match(fixas, /Total por mês: R\$ 1\.000,00/)
  const prox = await msg('o que vence nos próximos dias')
  assert.match(prox, /Boleto velho R\$ 70,00/)
  assert.match(prox, /Joana R\$ 300,00 \(a receber\)/)
  assert.match(prox, /Luz R\$ 150,00/)
  assert.match(prox, /Total: a pagar R\$ 220,00, a receber R\$ 300,00/)
})

await caso('pergunta com assunto ("com material") vai para a IA, que recebe o resumo com saldo real pronto', async () => {
  ia.regras = [[/com material/, { ...SEM_ACAO, intencao: 'pergunta', pergunta: 'quanto gastei com material' }]]
  E.tabelas.lancamentos.push({ user_id: U1, id: 'b', tipo: 'saida', valor: 40, data: HOJE, carteira_id: 'nubank', descricao: 'Material', categoria_id: 'material', pessoal: false })
  const r = await msg('quanto gastei com material?')
  assert.equal(r, 'RESPOSTA-DA-IA')
  assert.equal(ia.chamadas.resposta, 1)
  assert.equal(ia.ultimoResumo?.disponivel, 1010)
  assert.equal(ia.ultimoResumo?.periodos.hoje.saiu, 40)
  assert.equal(ia.ultimoResumo?.contas_fixas.length, 2)
})

await caso('lançamento com número NUNCA é tratado como consulta, mesmo falando em "gastos"', async () => {
  ia.regras = [[/gastei 12/, acoes(acao({ valor: 12 }))]]
  const r = await msg('gastei 12 hoje')
  assert.match(r, /saiu R\$ 12,00/)
  assert.equal(lancsU1().length, 1)
})

await caso('cliente sem nenhuma conta cadastrada recebe orientação, não erro', async () => {
  E.tabelas.carteiras = E.tabelas.carteiras.filter((c) => c.user_id !== U1)
  const r = await msg('qual meu saldo')
  assert.match(r, /Cadastre em Ajustes/)
})

fim()
