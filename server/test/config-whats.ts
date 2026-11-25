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
  assert.match(r0, /^Pronto, Bia, seu número tá confirmado/)
  assert.match(r0, /uma de cada vez\. Se não quiser responder alguma, é só mandar PULAR\./)
  assert.match(r0, /o que você faz\? Responde com o número:\n1\. Beleza e estética/)
  assert.equal(estado()?.etapa, 'ramo')

  const r1 = await fala('4')
  assert.match(r1, /^Anotado: Serviços\.\n\nOnde cai o dinheiro do seu negócio\?/)
  assert.equal(perfil().ramo, 'servicos')
  assert.equal(E.tabelas.categorias.find((c) => c.user_id === NOVA && c.id === 'material')?.nome, 'Material de trabalho')

  const r2 = await fala('nubank')
  assert.match(r2, /^E quanto tem no Nubank hoje\?/)
  assert.ok(carteira('Nubank') && !carteira('Conta do banco'), 'a conta genérica virou Nubank')

  const r3 = await fala('1.250,00')
  assert.match(r3, /^Anotado: R\$ 1\.250,00 no Nubank\.\n\nUsa mais algum banco, ou guarda dinheiro em espécie\?/)
  assert.equal(saldoDe('banco'), 1250)

  const r4 = await fala('dinheiro')
  assert.match(r4, /^E quanto tem no Dinheiro hoje\?/)
  assert.equal(carteira('Dinheiro')?.tipo, 'dinheiro')
  await fala('200')
  assert.equal(saldoDe(carteira('Dinheiro')!.id), 200)
  const r5 = await fala('não')
  assert.match(r5, /^Usa cartão de crédito\?/)

  const r6 = await fala('Nubank dia 10')
  assert.match(r6, /^Anotei o Cartão Nubank, com a fatura vencendo todo dia 10\. Considerei que ela fecha 7 dias antes/)
  assert.match(r6, /Tem outro cartão\?/)
  const k = carteira('Cartão Nubank')!
  assert.deepEqual([k.tipo, k.vencimento, k.fechamento, k.conta_pagamento_id], ['cartao', 10, 3, 'banco'])
  const r7 = await fala('não')
  assert.match(r7, /^Quer que eu já guarde o DAS do MEI, de R\$ 86,05, todo dia 20\?/)

  const r8 = await fala('sim')
  assert.match(r8, /^Guardei o DAS: R\$ 86,05 todo dia 20\.\n\nÚltima: quais contas chegam todo mês\?/)
  const das = E.tabelas.fixas.find((f) => f.user_id === NOVA && f.das)
  assert.ok(das, 'o DAS não virou conta fixa')
  const contasDas = E.tabelas.contas.filter((c) => c.user_id === NOVA && c.fixa_id === das!.id)
  assert.ok(contasDas.length >= 2 && contasDas.every((c) => c.das && c.tipo === 'pagar' && String(c.vencimento) >= HOJE), 'as contas do DAS não nasceram')

  // Conta fixa pelo caminho normal (leitor de mensagens): a configuração só pergunta se tem mais.
  ia.regras = [[/aluguel/, acoes(acao({ tipo_acao: 'recorrente', valor: 900, descricao: 'Aluguel', categoria_id: 'aluguel', dia_do_mes: 10, meio: null }))]]
  const r9 = await fala('aluguel 900 dia 10')
  assert.match(r9, /Anotei a conta fixa: Aluguel de R\$ 900,00 todo dia 10/)
  assert.match(r9, /Mais alguma conta de todo mês\? Me manda do mesmo jeito, ou PRONTO\.$/)
  const r10 = await fala('pronto')
  assert.equal(r10, C.TEXTO_FIM)
  assert.equal(estado()?.etapa, 'fim')
  assert.equal(perfil().onboarding_feito, true)

  // Terminou: a conversa volta ao normal, sem pergunta de configuração no fim.
  ia.regras = [[/pão/, acoes(acao({ valor: 12, descricao: 'Pão', carteira_id: 'banco' }))]]
  const r11 = await fala('paguei 12 de pão no nubank')
  assert.match(r11, /R\$ 12,00/)
  assert.doesNotMatch(r11, /Última|Usa cartão|Onde cai|PRONTO/)
  assert.equal(ia.chamadas.interpretacao, 2, 'só o aluguel e o pão passaram pela IA; as respostas da configuração são por código')
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
  assert.match(r, /^Não achei essa opção\. Primeiro: o que você faz\?/)
  assert.match(await fala('8'), /^E qual é a sua ocupação\?/)
  assert.match(await fala('fotógrafa'), /^Onde cai o dinheiro/)
  assert.deepEqual([perfil().ramo, perfil().ocupacao], ['outro', 'fotógrafa'])
})

await caso('um gasto no meio da configuração: é anotado, e a pergunta da configuração volta no fim (até 2 vezes; depois a etapa é pulada)', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  ia.regras = [[/gás/, acoes(acao({ valor: 30, descricao: 'Gás', carteira_id: 'banco', categoria_id: null }))]]
  const r1 = await fala('paguei 30 de gás no pix')
  assert.match(r1, /R\$ 30,00/)
  assert.match(r1, /\n\nOnde cai o dinheiro do seu negócio\?/)
  assert.equal(lancs().length, 1)
  const r2 = await fala('paguei 30 de gás no pix de novo')
  assert.match(r2, /Onde cai o dinheiro/)
  // Terceira vez ignorada: a etapa do banco é pulada e vem a próxima.
  const r3 = await fala('paguei 30 de gás no pix mais uma')
  assert.doesNotMatch(r3, /Onde cai o dinheiro/)
  assert.match(r3, /E quanto tem nessa conta hoje\?/)
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
  assert.doesNotMatch(p, /Onde cai o dinheiro/, 'duas perguntas na mesma mensagem')
  // "Dinheiro" aqui é a resposta da pergunta em aberto ("saiu de qual conta?"), não a resposta da configuração (que criaria uma conta Dinheiro
  // e perguntaria o saldo dela, deixando a marmita sem anotar).
  const r = await fala('Dinheiro')
  assert.match(r, /R\$ 18,00/, r)
  assert.equal(lancs().find((l) => Number(l.valor) === 18)?.carteira_id, 'din')
  assert.match(r, /\n\nOnde cai o dinheiro do seu negócio\?/)
  assert.equal(carteiras().filter((c) => c.tipo === 'dinheiro').length, 1, 'a configuração criou outra conta Dinheiro')
  assert.equal(estado()?.etapa, 'banco')
})

await caso('print da tela de saldo na etapa do banco: põe o banco e o saldo de uma vez, e nunca vira lançamento', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  ia.documento = { tipo: 'saldo', meio: null, vencimento: null, resumo: 'Tela de saldo', banco: 'NU PAGAMENTOS - IP', saldo: 1237.45, transacoes: [] }
  const r = await foto()
  assert.match(r, /^Li o print: Nubank, com R\$ 1\.237,45 de saldo\. Anotado\.\n\nUsa mais algum banco/)
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
  assert.match(e, /Achei 2 lançamentos nesse extrato do Nubank/)
  const s = await fala('sim')
  assert.match(s, /Importei 2 lançamentos/)
  assert.equal(lancs().length, 2)
  assert.equal(saldoDe('banco'), 1000, 'o histórico do extrato somou em cima do saldo de hoje')
  assert.match(s, /Usa mais algum banco/, 'a configuração segue depois do extrato')
})

await caso('saldo não é posto em conta que já tem lançamento (o painel ajusta)', async () => {
  semearNova()
  await confirmar()
  await fala('4')
  await fala('nubank')
  E.tabelas.lancamentos.push({ user_id: NOVA, id: 'l1', tipo: 'saida', valor: 10, carteira_id: 'banco', data: HOJE, descricao: 'x', pessoal: false })
  const r = await fala('500')
  assert.match(r, /^O Nubank já tem lançamento, então não mexi no saldo\./)
  assert.equal(Number(carteiras().find((c) => c.id === 'banco')!.saldo_inicial), 0)
})

await caso('cartão sem o dia: pergunta o dia antes de gravar', async () => {
  semearNova()
  await confirmar()
  for (const t of ['pular', 'pular', 'pular', 'pular']) await fala(t)
  assert.equal(estado()?.etapa, 'cartao')
  assert.match(await fala('Inter'), /^Que dia vence a fatura do Inter\?/)
  assert.equal(carteiras().filter((c) => c.tipo === 'cartao').length, 0)
  assert.match(await fala('15'), /^Anotei o Cartão Inter, com a fatura vencendo todo dia 15/)
  assert.equal(carteira('Cartão Inter')?.vencimento, 15)
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
