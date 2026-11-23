/**
 * Conversa sem atrito: o que a auditoria de 2026-11-22 achou, travado em teste (IA falsa, banco falso).
 *
 *  - a conta habitual do cliente por descrição (2 a 3 vezes seguidas na mesma conta) dispensa a pergunta "de qual conta?";
 *  - as perguntas dizem o valor ("Luz de R$ 89,00: saiu de qual conta?") e não carregam um rodapé longo;
 *  - "qual foi meu maior gasto?" não é o total do mês; resultado negativo não vira "Sobrou -R$";
 *  - a IA de perguntas recebe os números por palavra ("gasolina"), já somados;
 *  - "não foi 200, foi 250" com a pergunta aberta corrige o que está esperando, em vez de se perder;
 *  - "apaga tudo", número sozinho, preço e "exclui minha conta" têm resposta certa;
 *  - saudação varia, acompanha a hora e só dá a dica a quem está começando; risada fica em silêncio.
 *   npx tsx test/conversa.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, HOJE, ia, lancsU1, msg, msgFoto, msgPdf, NUM, SEM_ACAO, somaDias, U1 } from './_falsos.ts'

const { construirHabitos, habitoDeCarteira } = await import('../src/interpretar.ts')
const { reconhecer } = await import('../src/consultas.ts')
const { ehApagarTudo, valorSozinho } = await import('../src/atalhos.ts')
const { ehAssuntoDaConta, MANUAL } = await import('../src/ajuda.ts')
const { despedidaDe } = await import('../src/despedida.ts')
const { MSG, ABRE_SAUDACAO, confirma } = await import('../src/voz.ts')
const { limparNomeDeDocumento } = await import('../src/midia.ts')

let k = 0
const hist = (tipo: 'entrada' | 'saida', descricao: string, carteira_id: string, dias: number, categoria_id = 'material', valor = 50) =>
  E.tabelas.lancamentos.push({ user_id: U1, id: `h${++k}`, tipo, valor, data: somaDias(HOJE, -dias), carteira_id, descricao, categoria_id, pessoal: false })
const pendenteDe = () => (E.tabelas.conversas ?? []).find((c) => c.telefone === NUM)?.pendente as { tipo?: string; texto?: string } | undefined

/* ---------- conta habitual ---------- */

await caso('puro: o hábito só nasce com 2 ou 3 vezes seguidas na mesma conta', async () => {
  const h = construirHabitos([
    { descricao: 'Conta de luz', tipo: 'saida', carteira_id: 'nubank' }, { descricao: 'Luz', tipo: 'saida', carteira_id: 'nubank' },
    { descricao: 'Gasolina', tipo: 'saida', carteira_id: 'dinheiro' }, { descricao: 'Gasolina', tipo: 'saida', carteira_id: 'nubank' },
    { descricao: 'Corte Juliana', tipo: 'entrada', carteira_id: 'nubank' },
  ])
  assert.equal(h['saida:luz'], 'nubank', 'duas vezes na mesma conta: hábito')
  assert.equal(h['saida:gasolina'], undefined, 'duas contas diferentes: sem hábito')
  assert.equal(h['entrada:juliana'], undefined, 'uma vez só não basta')
  assert.equal(habitoDeCarteira('Luz do ponto', 'saida', h), 'nubank', 'acha pela palavra que identifica a coisa')
  assert.equal(habitoDeCarteira('Luz', 'entrada', h), undefined, 'entrada e saída não se misturam')
})

await caso('quem sempre paga a luz no Nubank não é perguntado: anota direto e diz a conta usada', async () => {
  hist('saida', 'Conta de luz', 'nubank', 10); hist('saida', 'Luz', 'nubank', 40); hist('saida', 'Conta de luz', 'nubank', 70)
  ia.regras = [[/luz/, acoes(acao({ valor: 89, descricao: 'Luz', meio: null, carteira_id: null }))]]
  const r = await msg('paguei 89 de luz')
  assert.match(r, /saiu R\$ 89,00/, r)
  assert.match(r, /Usei o Nubank, como das outras vezes\. Se foi em outra conta, é só me dizer\./)
  const nova = lancsU1().filter((l) => l.valor === 89)
  assert.equal(nova.length, 1, 'gravou')
  assert.equal(nova[0].carteira_id, 'nubank')
})

await caso('sem hábito (contas misturadas ou uma vez só), continua perguntando', async () => {
  hist('saida', 'Gasolina', 'dinheiro', 10); hist('saida', 'Gasolina', 'nubank', 40)
  ia.regras = [[/gasolina/, acoes(acao({ valor: 40, descricao: 'Gasolina', meio: null, carteira_id: null }))]]
  const r = await msg('gastei 40 de gasolina')
  assert.match(r, /Gasolina de R\$ 40,00: saiu de qual conta\?/, r)
})

await caso('quem diz o meio manda mais que o hábito: pix vai para banco, não para o dinheiro', async () => {
  hist('saida', 'Lanche', 'dinheiro', 5); hist('saida', 'Lanche', 'dinheiro', 20)
  ia.regras = [[/lanche/, acoes(acao({ valor: 30, descricao: 'Lanche', meio: 'pix', carteira_id: null }))]]
  const r = await msg('lanche 30 no pix')
  assert.match(r, /Nubank/, 'pix só pode ser banco')
  assert.doesNotMatch(r, /como das outras vezes/)
})

await caso('o hábito vale para entrada também', async () => {
  hist('entrada', 'Corte Juliana', 'dinheiro', 3, 'vendas', 35); hist('entrada', 'Juliana', 'dinheiro', 20, 'vendas', 35)
  ia.regras = [[/Juliana/, acoes(acao({ valor: 35, descricao: 'Corte Juliana', movimento: 'entrada', categoria_id: 'vendas', meio: null, carteira_id: null }))]]
  const r = await msg('recebi 35 da Juliana')
  assert.match(r, /entrou R\$ 35,00/, r)
  assert.match(r, /Usei o Dinheiro, como das outras vezes/)
})

/* ---------- perguntas mais claras ---------- */

await caso('a pergunta de conta diz o valor e tem um rodapé curto', async () => {
  ia.regras = [[/aluguel/, acoes(acao({ valor: 900, descricao: 'Aluguel do ponto', meio: null, carteira_id: null }))], [/serviço/, acoes(acao({ valor: 300, descricao: 'Serviço', movimento: 'entrada', categoria_id: 'vendas', meio: null, carteira_id: null }))]]
  const a = await msg('paguei o aluguel 900')
  assert.match(a, /^Aluguel do ponto de R\$ 900,00: saiu de qual conta\?\n1\. Nubank\n2\. Dinheiro\n3\. Cartão Inter\n\nOutra conta\? Cadastre em .*\/ajustes e me mande de novo\.$/, a)
  const e = await msg('recebi 300 de serviço')
  assert.match(e, /^Serviço de R\$ 300,00: caiu em qual conta\?/, e)
})

await caso('a pergunta "negócio ou casa" diz o valor e o que acontece depois, sem "Depois eu lembro"', async () => {
  ia.regras = [[/internet/, acoes(acao({ valor: 100, descricao: 'Internet', meio: 'pix', talvez_pessoal: true }))]]
  const r = await msg('internet 100')
  assert.match(r, /^Internet de R\$ 100,00: é gasto do negócio ou da casa\?\n1\. Do negócio\n2\. Pessoal \(da casa\)\nDa próxima vez eu já sei\.$/, r)
})

/* ---------- consultas ---------- */

await caso('pergunta de ranking e comparação não vira o total do mês', async () => {
  for (const f of ['qual foi meu maior gasto?', 'o que mais saiu esse mês?', 'compara esse mês com o mês passado', 'qual a média de gastos por mês?', 'qual meu menor gasto?']) assert.equal(reconhecer(f), null, f)
  for (const f of ['quanto sobrou esse mês?', 'qual meu saldo?', 'quanto entrou hoje?', 'o que vence essa semana?']) assert.notEqual(reconhecer(f), null, f)
})

await caso('mês no vermelho (consulta direta): "Ficou R$ X abaixo", nunca "Sobrou -R$"', async () => {
  hist('entrada', 'Serviço', 'nubank', 2, 'vendas', 1000); hist('saida', 'Material', 'nubank', 3, 'material', 1500)
  const r = await msg('quanto sobrou esse mês?')
  assert.match(r, /Ficou R\$ 500,00 abaixo: saiu mais do que entrou\./, r)
  assert.doesNotMatch(r, /Sobrou -/)
})

await caso('a IA de perguntas recebe os números por palavra, já somados, e a regra de não vazar jargão', async () => {
  hist('saida', 'Gasolina', 'dinheiro', 2, 'outras-saidas', 40); hist('saida', 'Gasolina moto', 'dinheiro', 6, 'outras-saidas', 25); hist('entrada', 'Corte Juliana', 'nubank', 1, 'vendas', 90)
  ia.regras = [[/de gasolina/, { ...SEM_ACAO, intencao: 'pergunta', pergunta: 'quanto gastei de gasolina' }]]
  await msg('quanto gastei de gasolina esse mês?')
  assert.equal(ia.chamadas.resposta, 1)
  assert.equal(ia.ultimoResumo?.por_palavra.mes_atual.saidas.gasolina, 65, 'as duas gasolinas já somadas')
  assert.equal(ia.ultimoResumo?.por_palavra.mes_atual.entradas.juliana, 90)
  assert.ok(Array.isArray(ia.ultimoResumo?.por_descricao.mes_atual.saidas), 'e por descrição, para "quem mais me pagou"')
  assert.match(ia.ultimoSistemaPergunta, /Nunca diga a palavra "resumo"/)
  assert.match(ia.ultimoSistemaPergunta, /nunca "não tenho"/)
  assert.match(ia.ultimoSistemaPergunta, /Nunca diga "anotei"/)
})

/* ---------- correção com pergunta aberta ---------- */

await caso('"não foi 200, foi 250" com a pergunta aberta corrige o registro que espera, e a pergunta segue', async () => {
  E.tabelas.conversas = [{ telefone: NUM, user_id: U1, pendente: { tipo: 'pergunta', texto: 'recebi 200 do João', pergunta: 'x', opcoes: [{ id: 'nubank', nome: 'Nubank' }, { id: 'dinheiro', nome: 'Dinheiro' }], forcar: {}, origem: 'texto' }, atualizado_em: new Date().toISOString() }]
  ia.regras = [
    [/não foi 200, foi 250/, { ...SEM_ACAO, intencao: 'corrigir', correcao: 'foi 250' }],
    [/Correção: foi 250/, acoes(acao({ valor: 250, descricao: 'João', movimento: 'entrada', categoria_id: 'vendas', meio: null, carteira_id: null }))],
  ]
  const r = await msg('não foi 200, foi 250')
  assert.doesNotMatch(r, /Não achei o lançamento/, r)
  assert.match(r, /João de R\$ 250,00: caiu em qual conta\?/, r)
  assert.match(pendenteDe()?.texto ?? '', /Correção: foi 250/, 'a pergunta guardada já carrega a correção')
  assert.equal(lancsU1().length, 0, 'nada gravado até ela dizer a conta')
})

/* ---------- atalhos ---------- */

await caso('puro: "apaga tudo" e número sozinho', async () => {
  for (const f of ['apaga tudo', 'Apague tudo', 'limpa todos os lançamentos', 'zera tudo', 'apaga todos os meus registros', 'deleta tudo por favor']) assert.equal(ehApagarTudo(f), true, f)
  for (const f of ['apaga o último', 'apaga isso', 'desfazer', 'recebi tudo', 'quanto sobrou']) assert.equal(ehApagarTudo(f), false, f)
  assert.equal(valorSozinho('150'), 150); assert.equal(valorSozinho('R$ 1.250,50'), 1250.5); assert.equal(valorSozinho('20 reais'), 20); assert.equal(valorSozinho('50 conto'), 50)
  for (const f of ['1', '2', '7', 'pix 50', 'recebi 150', '150 de luz', '', '0']) assert.equal(valorSozinho(f), null, `"${f}" não é valor sozinho`)
})

await caso('"apaga tudo": diz o que ela faz de verdade, sem IA e sem desfazer nada', async () => {
  ia.regras = [[/luz/, acoes(acao({ valor: 89, descricao: 'Luz' }))]]
  await msg('paguei 89 de luz')
  const antes = ia.chamadas.interpretacao
  const r = await msg('apaga tudo')
  assert.equal(r, MSG.apagarTudo)
  assert.match(r, /só desfaço o último registro/)
  assert.equal(ia.chamadas.interpretacao, antes, 'não gastou IA')
  assert.equal(lancsU1().length, 1, 'e não apagou nada')
})

await caso('número sozinho: pergunta "de quê?", guarda a pergunta e fecha o registro na resposta', async () => {
  const r = await msg('150')
  assert.equal(r, 'R$ 150,00 de quê? Entrou ou saiu?')
  assert.equal(pendenteDe()?.tipo, 'pergunta')
  assert.equal(ia.chamadas.interpretacao, 0)
  ia.regras = [[/da Juliana/, acoes(acao({ valor: 150, descricao: 'Juliana', movimento: 'entrada', categoria_id: 'vendas', meio: 'pix' }))]]
  const r2 = await msg('recebi da Juliana no pix')
  assert.match(r2, /entrou R\$ 150,00/, r2)
  assert.equal(lancsU1().length, 1)
})

await caso('"1" solto não vira pergunta de valor (é resposta de lista)', async () => {
  ia.regras = [[/^.*$/, SEM_ACAO]]
  const r = await msg('1')
  assert.doesNotMatch(r, /de quê\?/)
})

await caso('puro: assunto da conta e da assinatura vai para a ajuda, e registro com a mesma palavra não', async () => {
  for (const f of ['como cancelo minha assinatura?', 'exclui minha conta', 'quero cancelar a conta', 'quanto custa isso?', 'quanto você cobra de comissão?', 'qual o preço do plano da granninha', 'esqueci minha senha', 'quero trocar meu número', 'é grátis?', 'tem período de teste?']) assert.equal(ehAssuntoDaConta(f), true, f)
  for (const f of ['paguei a mensalidade da academia', 'recebi a assinatura do cliente', 'quanto eu pago de luz', 'assinatura netflix', 'quanto custa o material?', 'recebi 50', 'quanto sobrou']) assert.equal(ehAssuntoDaConta(f), false, f)
})

await caso('"exclui minha conta" e "quanto custa isso?" vão para a ajuda (sem a IA de classificação)', async () => {
  const a = await msg('exclui minha conta')
  assert.equal(ia.chamadas.ajuda, 1)
  assert.equal(ia.chamadas.interpretacao, 0)
  assert.ok(a.length > 0)
  await msg('quanto custa isso?')
  assert.equal(ia.chamadas.ajuda, 2)
  assert.equal(ia.chamadas.interpretacao, 0)
  assert.match(MANUAL, /Excluir minha conta/)
  assert.match(MANUAL, /Cancelar assinatura/)
  assert.match(ia.ultimaAjuda.sistema, /NUNCA invente uma resposta/)
})

/* ---------- saudação e risada ---------- */

await caso('saudação acompanha a hora, varia e dá a dica de ajuda só a quem está começando', async () => {
  ia.regras = [[/oi|bom dia|boa tarde/, { ...SEM_ACAO, intencao: 'saudacao' }]]
  const novo = await msg('bom dia')
  assert.match(novo, /^Bom dia, Arthur! /)
  assert.match(novo, /pedir ajuda/, 'quem está começando recebe a dica')
  for (let i = 0; i < 6; i++) hist('saida', `Gasto ${i}`, 'nubank', i + 1)
  const veterano = await msg('boa tarde')
  assert.match(veterano, /^Boa tarde, Arthur! /)
  assert.doesNotMatch(veterano, /pedir ajuda/, 'quem já usa não ouve a dica de novo')
  const oi = await msg('oi')
  assert.match(oi, new RegExp(`^(${ABRE_SAUDACAO.join('|')}), Arthur! `))
  assert.ok(oi.length < 60, 'curta')
})

await caso('risada fica em silêncio, sem IA e sem resposta', async () => {
  for (const f of ['kkkkk', 'kkk', 'KKKKKKK', 'haha', 'hahaha', 'rsrs', 'kk', 'ahahah']) assert.equal(despedidaDe(f), 'silencio', f)
  const r = await msg('kkkkkkk')
  assert.equal(r, '')
  assert.equal(ia.chamadas.interpretacao + ia.chamadas.ajuda, 0)
  assert.equal(despedidaDe('kkk, paguei a luz'), null, 'risada com pedido segue o fluxo')
})

/* ---------- dica de categoria ---------- */

await caso('a dica de "Outros" usa o nome do que foi anotado, só para quem está começando e nunca em conta fixa', async () => {
  ia.regras = [
    [/barbante/, acoes(acao({ valor: 12, descricao: 'Barbante', categoria_id: null }))],
    [/aluguel/, acoes(acao({ tipo_acao: 'recorrente', valor: 900, descricao: 'Aluguel', dia_do_mes: 10, categoria_id: null, meio: null }))],
  ]
  const a = await msg('barbante 12 no pix')
  assert.match(a, /Ficou em "Outros"\. Quer uma categoria só pra Barbante\? É só responder: criar categoria Barbante/, a)
  assert.doesNotMatch(a, /Combustível/, 'sem o exemplo que não tem a ver')
  const f = await msg('aluguel 900 todo dia 10')
  assert.doesNotMatch(f, /Ficou em "Outros"/, 'conta fixa não leva a dica')
  for (let i = 0; i < 6; i++) hist('saida', `Gasto ${i}`, 'nubank', i + 1)
  const b = await msg('barbante 12 no pix')
  assert.doesNotMatch(b, /Ficou em "Outros"/, 'quem já usa não é cutucado')
})

/* ---------- fatura em PDF ---------- */

const FATURA = { tipo: 'fatura_cartao', meio: null, vencimento: '2026-12-10', resumo: 'Fatura do cartão', transacoes: [
  { descricao: 'Posto Shell', valor: 180, movimento: 'saida', data: '2026-11-05' }, { descricao: 'Papelaria Central', valor: 64.7, movimento: 'saida', data: '2026-11-12' },
  { descricao: 'Distribuidora Silva', valor: 245, movimento: 'saida', data: '2026-11-18' },
] }

await caso('fatura com UM cartão: uma pergunta só, e o "sim" já importa nesse cartão', async () => {
  ia.documento = FATURA
  const a = await msgPdf('fatura.pdf')
  assert.equal(a.status, 'pergunta')
  assert.match(a.resposta, /Achei 3 compras nessa fatura, somando R\$ 489,70 \(vence 10\/12\)\./)
  assert.match(a.resposta, /Quer que eu importe no Cartão Inter\? Responda SIM ou NÃO\./)
  assert.doesNotMatch(a.resposta, /número do cartão/, 'com um cartão só não pede número')
  const b = await msg('sim')
  assert.match(b, /Importei 3 compras no Cartão Inter, somando R\$ 489,70/, b)
  assert.doesNotMatch(b, /Em qual cartão/)
  assert.equal(lancsU1().filter((l) => l.tipo === 'compra_cartao').length, 3)
})

await caso('fatura com um cartão: "não" não importa nada, e o número "1" também continua valendo', async () => {
  ia.documento = FATURA
  await msgPdf('fatura.pdf')
  assert.match(await msg('não'), /Tudo bem, não importei a fatura/)
  assert.equal(lancsU1().length, 0)
  await msgPdf('fatura.pdf')
  assert.match(await msg('1'), /Importei 3 compras no Cartão Inter/)
})

await caso('fatura com DOIS cartões: pergunta o número, e o "sim" ainda pergunta qual', async () => {
  E.tabelas.carteiras.push({ user_id: U1, id: 'cartao2', nome: 'Nubank Cartão', tipo: 'cartao', saldo_inicial: 0, padrao: false, fechamento: 5, vencimento: 12, conta_pagamento_id: 'nubank' })
  ia.documento = FATURA
  const a = await msgPdf('fatura.pdf')
  assert.match(a.resposta, /Responda com o número do cartão, ou NÃO:\n1\. Cartão Inter\n2\. Nubank Cartão/, a.resposta)
  const b = await msg('sim')
  assert.match(b, /Em qual cartão\? Responda com o número:\n1\. Cartão Inter\n2\. Nubank Cartão/, b)
  const c = await msg('2')
  assert.match(c, /Importei 3 compras no Nubank Cartão/, c)
  assert.equal(lancsU1().filter((l) => l.carteira_id === 'cartao2').length, 3)
})

/* ---------- nome de comprovante ---------- */

await caso('puro: nome de comprovante sem LTDA/SA e sem GRITAR, e nome normal fica como está', async () => {
  assert.equal(limparNomeDeDocumento('CEMIG DISTRIBUICAO SA'), 'Cemig Distribuicao')
  assert.equal(limparNomeDeDocumento('DISTRIBUIDORA SILVA LTDA'), 'Distribuidora Silva')
  assert.equal(limparNomeDeDocumento('PADARIA DA ESQUINA ME'), 'Padaria da Esquina')
  assert.equal(limparNomeDeDocumento('COMERCIAL JOSE E FILHOS S/A'), 'Comercial Jose e Filhos')
  assert.equal(limparNomeDeDocumento('TARIFA PACOTE SERVICOS'), 'Tarifa Pacote Servicos')
  assert.equal(limparNomeDeDocumento('CEMIG'), 'Cemig', 'sigla longa em maiúsculas também ganha caixa normal')
  for (const ok of ['Juliana Souza', 'iFood *Restaurante Sabor', 'Posto Shell', 'Amazon Marketplace 2/4', 'Casa', 'BB']) assert.equal(limparNomeDeDocumento(ok), ok, `"${ok}" não é mexido`)
})

await caso('a dica de categoria não repete razão social: nome longo vira "esse tipo de gasto"', async () => {
  assert.match(confirma.dicaCategoria('Barbante'), /Quer uma categoria só pra Barbante\? É só responder: criar categoria Barbante/)
  const longa = confirma.dicaCategoria('Cemig Distribuicao Energia')
  assert.match(longa, /categoria própria pra esse tipo de gasto/)
  assert.doesNotMatch(longa, /Cemig/)
})

await caso('foto de boleto da CEMIG: o cartão mostra "Cemig Distribuicao", não a razão social em maiúsculas', async () => {
  ia.documento = { tipo: 'comprovante', meio: 'boleto', vencimento: null, resumo: 'Boleto pago', transacoes: [{ descricao: 'CEMIG DISTRIBUICAO SA', valor: 189.9, movimento: 'saida', data: null }] }
  // A regra só casa se o texto que chegou na IA de interpretação já tem o nome limpo.
  ia.regras = [[/de Cemig Distribuicao /, acoes(acao({ valor: 189.9, descricao: 'Cemig Distribuicao', categoria_id: null, meio: 'boleto', carteira_id: 'nubank' }))]]
  const r = await msgFoto('cemig.png')
  assert.match(r.resposta, /saiu R\$ 189,90/, r.resposta)
  assert.match(r.resposta, /Cemig Distribuicao · /, r.resposta)
  assert.doesNotMatch(r.resposta, /CEMIG DISTRIBUICAO SA/)
  assert.match(r.resposta, /Quer uma categoria só pra Cemig Distribuicao\?/, 'a dica usa o nome limpo (curto o bastante)')
  assert.doesNotMatch(r.resposta, /CEMIG|SA\?/, 'nenhum rastro da razão social em maiúsculas')
})

fim()
