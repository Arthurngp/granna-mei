/**
 * Configuração da conta pela conversa do WhatsApp (itens at-12 e at-13). Uma conta nova, que entrou pelo cadastro só com o WhatsApp, confirma o
 * número e configura tudo por mensagem: ramo, banco e saldo (dito ou por print), outro banco ou dinheiro, cartão, DAS e contas de todo mês.
 * Banco e IA falsos, processar() de verdade.
 *   npx tsx test/config-whats.ts
 */
import assert from 'node:assert/strict'
process.env.ONBOARDING_WHATS = 'on'
const { acao, acoes, caso, E, fim, HOJE, ia, processar, SEM_ACAO } = await import('./_falsos.ts')
const C = await import('../src/config-whats.ts')
const F = await import('../src/config-whats-fluxo.ts')

const NOVA = 'u-nova'
const NUM = '5581977776666'
const CODIGO = '482913'
const SEM_ENFEITE = /[—–]|\p{Extended_Pictographic}/u

/** Conta que terminou o cadastro novo (só o WhatsApp) e ainda não confirmou: o site gravou a conta de banco genérica e as categorias. */
function semearNova(extra: { via?: string | null } = {}) {
  E.tabelas.perfis.push({ id: NOVA, nome: 'Bia Lima', negocio: '', ramo: '', whats_chave: '8177776666', whats_verificado: false, exclusao_em: null, onboarding_via: extra.via === undefined ? 'whats' : extra.via, onboarding_passo: 6, onboarding_feito: false })
  E.tabelas.assinaturas.push({ user_id: NOVA, status: 'trial', trial_fim: '2099-12-31' })
  E.tabelas.verificacoes = [{ user_id: NOVA, codigo: CODIGO, expira_em: '2099-01-01T00:00:00Z' }]
  E.tabelas.carteiras.push({ user_id: NOVA, id: 'banco', nome: 'Conta do banco', tipo: 'banco', saldo_inicial: 0, padrao: true, fechamento: null, vencimento: null, conta_pagamento_id: null })
  for (const c of C.categoriasPadrao('outro')) E.tabelas.categorias.push({ user_id: NOVA, ...c })
}
let seq = 0
const ev = (tipo: string, extra: Record<string, unknown>) => ({
  event: 'message.received',
  data: { key: { id: `C${Date.now()}${++seq}`, remoteJid: `${NUM}@s.whatsapp.net`, fromMe: false }, from: `${NUM}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: tipo, ...extra },
})
const fala = async (texto: string) => (await processar(ev('TEXT', { content: texto }) as Parameters<typeof processar>[0])).resposta ?? ''
const foto = async (arquivo = 'p.jpg') => (await processar(ev('IMAGE', { fileUrl: `/api/media/${arquivo}`, caption: '' }) as Parameters<typeof processar>[0])).resposta ?? ''
const perfil = () => E.tabelas.perfis.find((p) => p.id === NOVA)! as Record<string, any>
const estado = () => perfil().config_whats as Record<string, any> | null | undefined
const carteiras = () => E.tabelas.carteiras.filter((c) => c.user_id === NOVA) as Record<string, any>[]
const carteira = (nome: string) => carteiras().find((c) => c.nome === nome)
const lancs = () => E.tabelas.lancamentos.filter((l) => l.user_id === NOVA) as Record<string, any>[]
const saldoDe = (id: string) => {
  const c = carteiras().find((x) => x.id === id)!
  let s = Number(c.saldo_inicial)
  for (const l of lancs()) if (l.carteira_id === id) s += l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor)
  return Math.round(s * 100) / 100
}
const confirmar = async () => fala(`Meu código Granninha: ${CODIGO}`)

/* ===================== leitura das respostas, funções puras ===================== */

await caso('pura: ramo, banco, valor e cartão lidos por código; frase de gasto nunca vira nome de banco', async () => {
  assert.equal(C.lerRamo('4'), 'servicos')
  assert.equal(C.lerRamo('beleza'), 'beleza')
  assert.equal(C.lerRamo('9'), null)
  assert.equal(C.lerRamo('paguei 50 de luz'), null)
  for (const [dito, nome] of [['nubank', 'Nubank'], ['nu', 'Nubank'], ['no Nubank', 'Nubank'], ['itau', 'Itaú'], ['Banco do Brasil', 'Banco do Brasil'], ['caixa tem', 'Caixa'], ['Cooperativa Rural', 'Cooperativa Rural']]) {
    assert.equal(C.lerBanco(dito), nome, dito)
  }
  for (const nao of ['paguei a luz', 'quanto tenho?', 'recebi 150 no pix', 'oi', 'sim', 'pronto', 'conta corrente da empresa do meu marido', 'banco 123']) assert.equal(C.lerBanco(nao), null, nao)
  for (const [dito, v] of [['1.250,00', 1250], ['1250', 1250], ['R$ 300', 300], ['300 reais', 300], ['0', 0], ['zero', 0], ['89,9', 89.9]] as const) assert.equal(C.lerValor(dito), v, dito)
  for (const nao of ['mil', 'uns 300', '-50', '1,2,3']) assert.equal(C.lerValor(nao), null, nao)
  assert.deepEqual(C.lerCartao('Nubank dia 10'), { banco: 'Nubank', dia: 10 })
  assert.deepEqual(C.lerCartao('nubank 10'), { banco: 'Nubank', dia: 10 })
  assert.deepEqual(C.lerCartao('cartão do itaú, vence dia 5'), { banco: 'Itaú', dia: 5 })
  assert.deepEqual(C.lerCartao('Inter'), { banco: 'Inter', dia: null })
  for (const nao of ['paguei 50 de luz', 'paguei a luz', 'nubank dia 45', 'dia 10 e dia 20 no nubank']) assert.equal(C.lerCartao(nao), null, nao)
  assert.equal(C.fechamentoDe(10), 3)
  assert.equal(C.fechamentoDe(5), 28)
  assert.equal(C.ehEspecie('dinheiro'), true)
  assert.equal(C.ehEspecie('Nubank'), false)
  for (const t of [C.boasVindas('Bia'), C.TEXTO_FIM, C.MAIS_FIXA, ...(['ramo', 'ocupacao', 'banco', 'saldo', 'mais_banco', 'cartao', 'cartao_dia', 'das', 'fixas'] as const).map((etapa) => C.pergunta({ etapa, em: '' }, 'Nubank'))]) {
    assert.doesNotMatch(t, SEM_ENFEITE, t)
  }
})

/* ===================== a conversa inteira ===================== */

await caso('ponta a ponta: confirma o número e configura tudo pela conversa, uma pergunta por vez', async () => {
  semearNova()
  const r0 = await confirmar()
  assert.equal(perfil().whats_verificado, true)
  assert.match(r0, /^Pronto, Bia! Número confirmado/)
  assert.match(r0, /você trabalha com o quê\?$/)
  // Pedido do Arthur (28/11): curta, amiga, sem lista numerada e sem ensinar comando.
  assert.doesNotMatch(r0, /\n\d\.|PULAR/)
  assert.ok(r0.length < 140, `primeira mensagem longa demais (${r0.length})`)
  assert.equal(estado()?.etapa, 'ramo')

  const r1 = await fala('4')
  assert.match(r1, /^Anotado!\n\nE o dinheiro do trabalho cai em qual banco\?/)
  assert.equal(perfil().ramo, 'servicos')
  assert.equal(E.tabelas.categorias.find((c) => c.user_id === NOVA && c.id === 'material')?.nome, 'Material de trabalho')

  const r2 = await fala('nubank')
  assert.match(r2, /^Quanto tem no Nubank hoje, mais ou menos\?/)
  assert.ok(carteira('Nubank') && !carteira('Conta do banco'), 'a conta genérica virou Nubank')

  const r3 = await fala('1.250,00')
  assert.match(r3, /^Anotei R\$ 1\.250,00 no Nubank\.\n\nTem mais alguma conta, caixinha ou dinheiro guardado em casa\?/)
  assert.equal(saldoDe('banco'), 1250)

  const r4 = await fala('dinheiro')
  assert.match(r4, /^Quanto tem em dinheiro hoje/)
  assert.equal(carteira('Dinheiro')?.tipo, 'dinheiro')
  await fala('200')
  assert.equal(saldoDe(carteira('Dinheiro')!.id), 200)
  const r5 = await fala('não')
  assert.match(r5, /^Usa cartão de crédito\?/)

  const r6 = await fala('Nubank dia 10')
  assert.match(r6, /^Anotei o Cartão Nubank, com a fatura vencendo todo dia 10\./)
  assert.match(r6, /Tem outro cartão\?/)
  const k = carteira('Cartão Nubank')!
  assert.deepEqual([k.tipo, k.vencimento, k.fechamento, k.conta_pagamento_id], ['cartao', 10, 3, 'banco'])
  const r7 = await fala('não')
  assert.match(r7, /^Quer que eu te lembre do DAS do MEI \(R\$ 86,05\) todo dia 20\?/)

  const r8 = await fala('sim')
  assert.match(r8, /^Combinado, te lembro do DAS todo dia 20\.\n\nÚltima coisa: quais contas chegam todo mês\?/)
  const das = E.tabelas.fixas.find((f) => f.user_id === NOVA && f.das)
  assert.ok(das, 'o DAS não virou conta fixa')
  const contasDas = E.tabelas.contas.filter((c) => c.user_id === NOVA && c.fixa_id === das!.id)
  assert.ok(contasDas.length >= 2 && contasDas.every((c) => c.das && c.tipo === 'pagar' && String(c.vencimento) >= HOJE), 'as contas do DAS não nasceram')

  // Conta fixa pelo caminho normal (leitor de mensagens): a configuração só pergunta se tem mais.
  ia.regras = [[/aluguel/, acoes(acao({ tipo_acao: 'recorrente', valor: 900, descricao: 'Aluguel', categoria_id: 'aluguel', dia_do_mes: 10, meio: null }))]]
  const r9 = await fala('aluguel 900 dia 10')
  assert.match(r9, /Anotei a conta fixa: Aluguel de R\$ 900,00 todo dia 10/)
  assert.match(r9, /Tem mais alguma conta de todo mês\?$/)
  const r10 = await fala('pronto')
  assert.equal(r10, C.TEXTO_FIM)
  assert.equal(estado()?.etapa, 'fim')
  assert.equal(perfil().onboarding_feito, true)

  // Terminou: a conversa volta ao normal, sem pergunta de configuração no fim.
  ia.regras = [[/pão/, acoes(acao({ valor: 12, descricao: 'Pão', carteira_id: 'banco' }))]]
  const r11 = await fala('paguei 12 de pão no nubank')
  assert.match(r11, /R\$ 12,00/)
  assert.doesNotMatch(r11, /Última coisa|Usa cartão|cai em qual banco/)
  assert.equal(ia.chamadas.interpretacao, 2, 'só o aluguel e o pão passaram pela IA; as respostas da configuração são por código')
  assert.equal(ia.chamadas.configuracao, 0, 'resposta que o código lê não gasta a IA da configuração')
})

await caso('PULAR em todas as etapas: termina sem gravar nada além do mínimo', async () => {
  semearNova()
  await confirmar()
  const respostas = []
  for (let i = 0; i < 7 && estado()?.etapa !== 'fim'; i++) respostas.push(await fala('pular'))
  assert.equal(estado()?.etapa, 'fim', JSON.stringify(respostas))
  assert.equal(respostas.at(-1), C.TEXTO_FIM)
  assert.equal(perfil().ramo, '')
  assert.deepEqual(carteiras().map((c) => c.nome), ['Conta do banco'])
  assert.equal(E.tabelas.fixas.filter((f) => f.user_id === NOVA).length, 0)
})

await caso('"outro" ramo pergunta a ocupação; número fora da lista repete a pergunta', async () => {
  semearNova()
  await confirmar()
  const r = await fala('12')
  assert.match(r, /^Não entendi esse número\. Me conta: você trabalha com o quê\?/)
  assert.match(await fala('8'), /^E o que você faz, exatamente\?/)
  assert.match(await fala('fotógrafa'), /^Boa, fotógrafa! Anotado\.\n\nE o dinheiro do trabalho cai em qual banco\?/)
  assert.deepEqual([perfil().ramo, perfil().ocupacao], ['outro', 'fotógrafa'])
})

await caso('um gasto no meio da configuração: é anotado, e a pergunta da configuração volta no fim (até 2 vezes; depois a etapa é pulada)', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  ia.regras = [[/gás/, acoes(acao({ valor: 30, descricao: 'Gás', carteira_id: 'banco', categoria_id: null }))]]
  const r1 = await fala('paguei 30 de gás no pix')
  assert.match(r1, /R\$ 30,00/)
  assert.match(r1, /\n\nE o dinheiro do trabalho cai em qual banco\?/)
  assert.equal(lancs().length, 1)
  assert.equal(ia.chamadas.configuracao, 0, 'lançamento no meio da configuração não passa pela IA da configuração')
  const r2 = await fala('paguei 30 de gás no pix de novo')
  assert.match(r2, /cai em qual banco/)
  // Terceira vez ignorada: a etapa do banco é pulada e vem a próxima.
  const r3 = await fala('paguei 30 de gás no pix mais uma')
  assert.doesNotMatch(r3, /cai em qual banco/)
  assert.match(r3, /Quanto tem nessa conta hoje/)
  assert.equal(estado()?.etapa, 'saldo')
})

await caso('pergunta própria da conversa vem primeiro: a da configuração espera a vez', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  E.tabelas.carteiras.push({ user_id: NOVA, id: 'din', nome: 'Dinheiro', tipo: 'dinheiro', saldo_inicial: 0, padrao: false, fechamento: null, vencimento: null, conta_pagamento_id: null })
  ia.regras = [[/marmita/, acoes(acao({ valor: 18, descricao: 'Marmita', meio: null, carteira_id: null, categoria_id: null }))]]
  const p = await fala('comprei uma marmita de 18')
  assert.match(p, /saiu de qual conta\?/)
  assert.doesNotMatch(p, /cai em qual banco/, 'duas perguntas na mesma mensagem')
  // "Dinheiro" aqui é a resposta da pergunta em aberto ("saiu de qual conta?"), não a resposta da configuração (que criaria uma conta Dinheiro
  // e perguntaria o saldo dela, deixando a marmita sem anotar).
  const r = await fala('Dinheiro')
  assert.match(r, /R\$ 18,00/, r)
  assert.equal(lancs().find((l) => Number(l.valor) === 18)?.carteira_id, 'din')
  assert.match(r, /\n\nE o dinheiro do trabalho cai em qual banco\?/)
  assert.equal(carteiras().filter((c) => c.tipo === 'dinheiro').length, 1, 'a configuração criou outra conta Dinheiro')
  assert.equal(estado()?.etapa, 'banco')
})

await caso('print da tela de saldo na etapa do banco: põe o banco e o saldo de uma vez, e nunca vira lançamento', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  ia.documento = { tipo: 'saldo', meio: null, vencimento: null, resumo: 'Tela de saldo', banco: 'NU PAGAMENTOS - IP', saldo: 1237.45, transacoes: [] }
  const r = await foto()
  assert.match(r, /^Li o print: Nubank, com R\$ 1\.237,45 de saldo\. Anotado\.\n\nTem mais alguma conta/)
  assert.equal(saldoDe('banco'), 1237.45)
  assert.equal(carteiras().find((c) => c.id === 'banco')?.nome, 'Nubank')
  assert.equal(lancs().length, 0)
})

await caso('extrato importado depois do saldo, na mesma conta: o saldo de hoje continua o lido (não soma em dobro)', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  await fala('nubank')
  await fala('1.000')
  assert.equal(saldoDe('banco'), 1000)
  ia.documento = {
    tipo: 'extrato', meio: null, vencimento: null, resumo: 'Extrato', banco: 'Nubank', saldo: 1000,
    transacoes: [{ descricao: 'Cliente Ana', valor: 300, movimento: 'entrada', data: HOJE }, { descricao: 'Mercado', valor: 80, movimento: 'saida', data: HOJE }],
  }
  const e = await foto('extrato.jpg')
  assert.match(e, /Conferi o extrato do Nubank: 2 movimentos/)
  const s = await fala('sim')
  assert.match(s, /anotei os 2 que faltavam/)
  assert.equal(lancs().length, 2)
  assert.equal(saldoDe('banco'), 1000, 'o histórico do extrato somou em cima do saldo de hoje')
  assert.match(s, /Tem mais alguma conta/, 'a configuração segue depois do extrato')
})

await caso('saldo não é posto em conta que já tem lançamento (o painel ajusta)', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  await fala('nubank')
  E.tabelas.lancamentos.push({ user_id: NOVA, id: 'l1', tipo: 'saida', valor: 10, carteira_id: 'banco', data: HOJE, descricao: 'x', pessoal: false })
  const r = await fala('500')
  assert.match(r, /^No Nubank já tem lançamento, então não mexi no saldo\./)
  assert.equal(Number(carteiras().find((c) => c.id === 'banco')!.saldo_inicial), 0)
})

await caso('cartão sem o dia: pergunta o dia antes de gravar', async () => {
  semearNova()
  await confirmar()
  for (const t of ['pular', 'pular', 'pular', 'pular']) await fala(t)
  assert.equal(estado()?.etapa, 'cartao')
  assert.match(await fala('Inter'), /^E a fatura do Inter vence que dia\?/)
  assert.equal(carteiras().filter((c) => c.tipo === 'cartao').length, 0)
  assert.match(await fala('15'), /^Anotei o Cartão Inter, com a fatura vencendo todo dia 15/)
  assert.equal(carteira('Cartão Inter')?.vencimento, 15)
})

await caso('reação ("certo", "show", "kkkk") nas etapas de banco e cartão não vira nome de conta', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  for (const t of ['certo', 'show', 'kkkk', 'blz', 'massa', 'top', 'entendi']) {
    await fala(t)
    assert.equal(carteiras().find((c) => c.id === 'banco')?.nome, 'Conta do banco', t)
    assert.ok(!estado()?.bancoNome, `"${t}" foi pedido como nome de banco`)
  }
  for (const t of ['show', 'certo', 'top']) assert.equal(C.lerCartao(t), null, t)
  assert.deepEqual(C.lerCartao('Riachuelo dia 10'), { banco: 'Riachuelo', dia: 10 }, 'cartão de loja com o dia vale')
  assert.deepEqual(C.lerCartao('cartão Riachuelo'), { banco: 'Riachuelo', dia: null }, 'com a palavra cartão também')
})

await caso('banco que não é conhecido: confirma antes de virar conta; SIM cria, outro nome confirma de novo, banco conhecido entra direto', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  // Nome que o código não conhece passa pela IA da configuração (pode ser banco escrito errado); aqui ela diz que é um banco fora da lista.
  const banco = (nome: string) => ({ eh_resposta: true, contas: [{ tipo: 'banco', banco: null, nome_dito: nome, saldo: null }] })
  ia.regrasConfig = [[/Cooperativa Rural/, banco('Cooperativa Rural')], [/Cooperativa do Vale/, banco('Cooperativa do Vale')]]
  assert.match(await fala('Cooperativa Rural'), /^Cooperativa Rural é o nome do seu banco, né\?/)
  assert.equal(carteiras().find((c) => c.id === 'banco')?.nome, 'Conta do banco', 'virou conta antes de confirmar')
  assert.match(await fala('Coop Sertão'), /^Coop Sertão é o nome do seu banco, né\?/)
  assert.match(await fala('sim'), /^Quanto tem no Coop Sertão hoje/)
  assert.equal(carteiras().find((c) => c.id === 'banco')?.nome, 'Coop Sertão')
  // Outra conta: banco conhecido dito na confirmação entra direto.
  await fala('100')
  assert.match(await fala('Cooperativa do Vale'), /^Cooperativa do Vale é o nome do seu banco, né\?/)
  assert.match(await fala('é o nubank'), /^Quanto tem no Nubank hoje/)
  assert.ok(carteira('Nubank'))
})

await caso('extrato ANTES do saldo (na etapa do banco): o saldo de hoje vem do extrato, a conta ganha o nome do banco e a configuração segue', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  ia.documento = {
    tipo: 'extrato', meio: null, vencimento: null, resumo: 'Extrato', banco: 'Banco Inter', saldo: 842.3,
    transacoes: [{ descricao: 'Cliente Ana', valor: 180, movimento: 'entrada', data: HOJE }, { descricao: 'Atacadão', valor: 96.4, movimento: 'saida', data: HOJE }],
  }
  const e = await foto('extrato.jpg')
  assert.match(e, /Conferi o extrato.*: 2 movimentos/)
  const s = await fala('sim')
  assert.match(s, /anotei os 2 que faltavam/)
  assert.equal(saldoDe('banco'), 842.3, 'o saldo de hoje não é o do extrato')
  assert.equal(carteiras().find((c) => c.id === 'banco')?.nome, 'Inter')
  assert.equal(estado()?.etapa, 'mais_banco')
  assert.match(s, /Tem mais alguma conta/, 'a configuração não seguiu para a etapa certa: ' + s)
})

await caso('extrato numa conta que já tinha lançamento antes: o saldo dela não é trocado pelo do extrato', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  E.tabelas.lancamentos.push({ user_id: NOVA, id: 'l-antes', tipo: 'saida', valor: 10, carteira_id: 'banco', data: HOJE, descricao: 'Pão', pessoal: false })
  ia.documento = {
    tipo: 'extrato', meio: null, vencimento: null, resumo: 'Extrato', banco: 'Banco Inter', saldo: 842.3,
    transacoes: [{ descricao: 'Cliente Ana', valor: 180, movimento: 'entrada', data: HOJE }, { descricao: 'Atacadão', valor: 96.4, movimento: 'saida', data: HOJE }],
  }
  await foto('extrato.jpg')
  await fala('sim')
  assert.equal(Number(carteiras().find((c) => c.id === 'banco')!.saldo_inicial), 0, 'trocou o saldo de uma conta que já tinha história')
  assert.equal(saldoDe('banco'), 73.6)
})

await caso('extrato na etapa do saldo e depois o valor dito: vale o do extrato, e a Granninha diz qual ficou', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  await fala('nubank')
  ia.documento = {
    tipo: 'extrato', meio: null, vencimento: null, resumo: 'Extrato', banco: 'Nubank', saldo: 500,
    transacoes: [{ descricao: 'Mercado', valor: 50, movimento: 'saida', data: HOJE }, { descricao: 'Cliente Rui', valor: 120, movimento: 'entrada', data: HOJE }],
  }
  const fx = await foto('extrato.jpg')
  assert.match(fx, /Conferi o extrato do Nubank: 2 movimentos/)
  await fala('sim')
  assert.equal(saldoDe('banco'), 500)
  // Já foi para "mais algum banco?"; se mesmo assim disser um valor, nada muda (é resposta de outra coisa) e o saldo segue o do extrato.
  assert.equal(estado()?.etapa, 'mais_banco')
})

/* ===================== a conversa do Arthur no chip (28/11): o que tinha que dar certo ===================== */

const servicoVideomaker = { eh_resposta: true, ramo: 'servicos', ocupacao: 'videomaker' }
const ultimaMsg = () => E.tabelas.mensagens.at(-1) as Record<string, any>

await caso('"Sou videomaker": resposta livre é entendida (ramo e ocupação), e o custo da IA entra na mensagem', async () => {
  semearNova()
  await confirmar()
  ia.regrasConfig = [[/videomaker/i, servicoVideomaker]]
  const r = await fala('Sou videomaker')
  assert.match(r, /^Boa, videomaker! Anotado\.\n\nE o dinheiro do trabalho cai em qual banco\?$/)
  assert.deepEqual([perfil().ramo, perfil().ocupacao], ['servicos', 'videomaker'])
  assert.equal(E.tabelas.categorias.find((c) => c.user_id === NOVA && c.id === 'material')?.nome, 'Material de trabalho')
  assert.equal(ia.chamadas.configuracao, 1)
  assert.equal(ia.chamadas.interpretacao, 0, 'caiu na conversa comum ("não sei te ajudar")')
  assert.ok((ultimaMsg().ia_chamadas ?? []).length >= 1, 'o custo da IA da configuração não entrou na mensagem')
})

await caso('IA fora do ar: "Sou videomaker" ainda é aceito como ocupação, e a configuração não trava', async () => {
  semearNova()
  await confirmar()
  ia.queda = true
  try {
    const r = await fala('Sou videomaker')
    assert.match(r, /^Boa, videomaker! Anotado\.\n\nE o dinheiro do trabalho cai em qual banco\?/)
    assert.deepEqual([perfil().ramo, perfil().ocupacao], ['outro', 'videomaker'])
    assert.equal(estado()?.etapa, 'banco')
  } finally {
    ia.queda = false
  }
})

await caso('banco escrito errado: "Você quis dizer Nubank?", sem gastar IA; com o valor junto, o saldo não é perguntado de novo', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  for (const [errado, certo] of [['nubak', 'Nubank'], ['bradeco', 'Bradesco'], ['santader', 'Santander'], ['nubnk', 'Nubank']]) assert.equal(C.sugerirBanco(errado), certo, errado)
  for (const curto of ['nu', 'bb', 'itau', 'inter', 'neon', 'next', 'xp', 'c6', 'show', 'certo']) assert.equal(C.sugerirBanco(curto), null, curto)
  assert.match(await fala('nubak'), /^Você quis dizer Nubank\?$/)
  assert.equal(carteiras().find((c) => c.id === 'banco')?.nome, 'Conta do banco', 'virou conta antes de confirmar')
  assert.match(await fala('sim'), /^Quanto tem no Nubank hoje/)
  assert.equal(carteiras().find((c) => c.id === 'banco')?.nome, 'Nubank')
  await fala('450')
  // Outro banco escrito errado, já com o valor: confirma e anota o saldo dito, sem perguntar de novo.
  assert.match(await fala('bradeco 300'), /^Você quis dizer Bradesco\?$/)
  assert.match(await fala('isso'), /^Anotei R\$ 300,00 no Bradesco\.\n\nTem mais alguma conta/)
  assert.equal(saldoDe(carteira('Bradesco')!.id), 300)
  // Não era: pede o nome de novo e não cria nada.
  assert.match(await fala('santader'), /^Você quis dizer Santander\?$/)
  assert.match(await fala('não'), /^Ah, tá\. Então me escreve o nome do banco/)
  assert.ok(!carteira('Santander'))
  assert.equal(ia.chamadas.configuracao, 0)
})

await caso('"Nubank, tenho 450": banco e saldo de uma vez; dito de novo depois, não pergunta o saldo outra vez', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  assert.match(await fala('Nubank, tenho 450 lá'), /^Anotei R\$ 450,00 no Nubank\.\n\nTem mais alguma conta, caixinha ou dinheiro guardado em casa\?$/)
  assert.equal(saldoDe('banco'), 450)
  const r = await fala('nubank')
  assert.match(r, /^No Nubank já tá anotado: R\$ 450,00\.\n\nTem mais alguma conta/)
  assert.equal(carteiras().filter((c) => c.tipo === 'banco').length, 1, 'criou um segundo Nubank')
  assert.equal(ia.chamadas.configuracao, 0)
})

await caso('caixinha é dinheiro guardado (fora do disponível), não banco; "caixinha do nubank" não vira um segundo Nubank', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  await fala('nubank 450')
  assert.match(await fala('caixinha'), /^Quanto tem na Caixinha Nubank hoje/)
  const cx = carteira('Caixinha Nubank')!
  assert.deepEqual([cx.tipo, cx.padrao], ['investimento', false])
  assert.match(await fala('uns 1.200'), /^Anotei R\$ 1\.200,00 na Caixinha Nubank\./)
  assert.equal(saldoDe(cx.id), 1200)
  assert.equal(carteiras().filter((c) => c.tipo === 'banco').length, 1)
  assert.equal(C.lerReserva('caixinha do nubank'), 'Caixinha Nubank')
  assert.equal(C.lerReserva('cofrinho em casa'), null, 'cofrinho em casa é dinheiro em espécie')
  assert.equal(C.ehEspecie('guardo em casa'), true)
  assert.equal(C.lerReserva('paguei 50 da caixinha'), null)
  assert.equal(ia.chamadas.configuracao, 0)
})

await caso('lançamento no meio da configuração continua lançamento (nem a IA da configuração é chamada); a pergunta volta no fim', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  await fala('nubank 450')
  ia.regras = [[/gasolina/, acoes(acao({ valor: 50, descricao: 'Gasolina', carteira_id: 'banco', categoria_id: null }))]]
  const r = await fala('paguei 50 de gasolina')
  assert.match(r, /R\$ 50,00/)
  assert.match(r, /\n\nTem mais alguma conta/)
  assert.equal(lancs().length, 1)
  assert.equal(ia.chamadas.configuracao, 0)
  assert.equal(estado()?.etapa, 'mais_banco')
})

await caso('respostas que só a IA entende: "uso o nubank e o inter" pergunta o saldo de cada um; "tenho não" no cartão segue', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  ia.regrasConfig = [
    [/nubank e o inter/, { eh_resposta: true, contas: [{ tipo: 'banco', banco: 'Nubank', nome_dito: 'nubank', saldo: 300 }, { tipo: 'banco', banco: 'Inter', nome_dito: 'inter', saldo: null }] }],
    [/tenho não/, { eh_resposta: true, sim_nao: 'nao' }],
    [/banco inventado/, { eh_resposta: true, contas: [{ tipo: 'banco', banco: 'Banco Que Nao Existe', nome_dito: 'x', saldo: 999999999999 }] }],
  ]
  const r = await fala('uso o nubank e o inter, no nubank tem 300')
  assert.match(r, /^Anotei R\$ 300,00 no Nubank\.\n\nQuanto tem no Inter hoje/)
  assert.match(await fala('80'), /^Anotei R\$ 80,00 no Inter\.\n\nTem mais alguma conta/)
  assert.match(await fala('não'), /^Usa cartão de crédito\?/)
  assert.match(await fala('tenho não'), /^Quer que eu te lembre do DAS/)
  // O que a IA devolve é conferido: banco fora da lista não vira nome, valor absurdo não vira saldo.
  const { validar } = await import('../src/config-entender.ts')
  const v = validar({ eh_resposta: true, ramo: 'astronauta', ocupacao: 'quanto custa?', contas: [{ tipo: 'banco', banco: 'Banco Que Nao Existe', nome_dito: 'x', saldo: 1e12 }], cartao_dia: 45 } as never)
  assert.deepEqual([v.ramo, v.ocupacao, v.contas[0].banco, v.contas[0].saldo, v.cartao_dia], [null, null, null, null, null])
})

/* ===================== quem fica de fora ===================== */

await caso('conta do cadastro antigo (sem a marca) confirma como sempre, sem configuração', async () => {
  semearNova({ via: null })
  const r = await confirmar()
  assert.doesNotMatch(r, /perguntas rápidas/)
  assert.ok(!estado())
  ia.regras = [[/^4$/, SEM_ACAO]]
  await fala('4')
  assert.equal(perfil().ramo, '')
})

await caso('chave ONBOARDING_WHATS desligada: ninguém entra na configuração', async () => {
  process.env.ONBOARDING_WHATS = 'off'
  try {
    semearNova()
    const r = await confirmar()
    assert.doesNotMatch(r, /perguntas rápidas/)
    assert.ok(!estado())
  } finally {
    process.env.ONBOARDING_WHATS = 'on'
  }
})

await caso('banco sem a migration (colunas não existem): confirma como sempre e nada quebra', async () => {
  semearNova()
  E.recusarColuna = 'onboarding_via'
  try {
    const r = await confirmar()
    assert.equal(perfil().whats_verificado, true)
    assert.doesNotMatch(r, /perguntas rápidas/)
    ia.regras = [[/pão/, acoes(acao({ valor: 12, descricao: 'Pão', carteira_id: 'banco' }))]]
    assert.match(await fala('paguei 12 de pão'), /R\$ 12,00/)
  } finally {
    E.recusarColuna = null
    F.esquecerColunaFaltando()
  }
})

await caso('configuração abandonada há mais de 7 dias: para de perguntar', async () => {
  semearNova()
  await confirmar()
  const velho = new Date(Date.now() - 8 * 24 * 3600_000).toISOString()
  perfil().config_whats = { ...estado(), em: velho, inicio: velho }
  ia.regras = [[/pão/, acoes(acao({ valor: 12, descricao: 'Pão', carteira_id: 'banco' }))]]
  const r = await fala('paguei 12 de pão')
  assert.doesNotMatch(r, /o que você faz/, r)
  assert.equal(estado()?.etapa, 'fim', JSON.stringify(perfil()))
})

fim()
