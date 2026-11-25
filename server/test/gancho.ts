/**
 * O gancho da conta (itens at-02 e at-03 do backlog): a confirmação do número fala de uma conta que a pessoa cadastrou e,
 * se ela vence por agora, pergunta "já pagou?"; o aviso de vencimento de uma conta deixa a mesma pergunta em aberto.
 * SIM dá baixa por código, sem IA. NÃO deixa em aberto. Outra coisa segue o fluxo normal.
 *
 * Caso de origem (leitura de produção em 24/11): 5 de 9 pessoas confirmaram o WhatsApp e nunca mandaram mais nada, com
 * 62 contas a pagar cadastradas. A confirmação pedia "me manda o que entrou ou saiu" com um exemplo genérico.
 *
 * Banco e IA falsos, processar() de verdade.
 *   npx tsx test/gancho.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, HOJE, ia, msg, NUM, processar, SEM_ACAO, somaDias, U1 } from './_falsos.ts'

const G = await import('../src/gancho.ts')
const A = await import('../src/avisos.ts')
const { depsAvisosDoBanco } = await import('../src/avisos-banco.ts')
const { sb } = await import('../src/banco.ts')
const { MSG } = await import('../src/voz.ts')
type Conta = import('../src/gancho.ts').ContaGancho

const conta = (id: string, descricao: string, valor: number, vencimento: string): Conta => ({ id, descricao, valor, vencimento })
const SEM_ENFEITE = /[—–]|\p{Extended_Pictographic}/u

/* ---------------- cenário da confirmação: uma pessoa nova, com o número ainda por confirmar ---------------- */

const NOVA = 'u-nova'
const NUM_NOVA = '5581977776666' // chave 8177776666
const CODIGO = '482913'

/** Pessoa que terminou o cadastro e ainda não confirmou o WhatsApp, com uma conta de banco só e as contas que o onboarding criou. */
function semearNova(contas: { id: string; descricao: string; valor: number; vencimento: string; tipo?: string; status?: string }[], extra: { ocultar?: boolean; duasCarteiras?: boolean } = {}) {
  E.tabelas.perfis.push({ id: NOVA, nome: 'Bia Lima', negocio: 'Doces da Bia', ramo: 'alimentacao', whats_chave: '8177776666', whats_verificado: false, exclusao_em: null, ocultar: !!extra.ocultar })
  E.tabelas.assinaturas.push({ user_id: NOVA, status: 'trial', trial_fim: '2099-12-31' })
  E.tabelas.verificacoes = [{ user_id: NOVA, codigo: CODIGO, expira_em: '2099-01-01T00:00:00Z' }]
  E.tabelas.categorias.push(
    { user_id: NOVA, id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida', pessoal: false },
    { user_id: NOVA, id: 'outras-entradas', nome: 'Outras entradas', tipo: 'entrada', pessoal: false },
  )
  E.tabelas.carteiras.push({ user_id: NOVA, id: 'inter', nome: 'Inter', tipo: 'banco', saldo_inicial: 500, padrao: true, fechamento: null, vencimento: null, conta_pagamento_id: null })
  if (extra.duasCarteiras) E.tabelas.carteiras.push({ user_id: NOVA, id: 'caixa', nome: 'Dinheiro', tipo: 'dinheiro', saldo_inicial: 0, padrao: false, fechamento: null, vencimento: null, conta_pagamento_id: null })
  for (const c of contas) E.tabelas.contas.push({ user_id: NOVA, tipo: 'pagar', status: 'aberta', ...c })
}

let seq = 0
const de = async (numero: string, texto: string) => {
  const r = await processar({
    event: 'message.received',
    data: { key: { id: `G${Date.now()}${++seq}`, remoteJid: `${numero}@s.whatsapp.net`, fromMe: false }, from: `${numero}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: texto },
  } as Parameters<typeof processar>[0])
  return { resposta: r.resposta ?? '', status: r.status }
}
const audioDe = async (numero: string) => {
  const r = await processar({
    event: 'message.received',
    data: { key: { id: `GA${Date.now()}${++seq}`, remoteJid: `${numero}@s.whatsapp.net`, fromMe: false }, from: `${numero}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'AUDIO', fileUrl: '/api/media/a1.ogg', caption: '' },
  } as Parameters<typeof processar>[0])
  return { resposta: r.resposta ?? '', status: r.status }
}
const pendenteDe = (numero: string) => (E.tabelas.conversas ?? []).find((c) => c.telefone === numero)?.pendente as { tipo?: string; conta?: Conta; de?: string; pergunta?: string } | null | undefined
const contaNoBanco = (user: string, id: string) => E.tabelas.contas.find((c) => c.user_id === user && c.id === id)!
const lancsDe = (user: string) => E.tabelas.lancamentos.filter((l) => l.user_id === user)
const perfil = (id: string) => E.tabelas.perfis.find((p) => p.id === id)!
/** Deixa a pergunta em aberto como o aviso de vencimento deixaria, para o cliente já confirmado U1 (duas contas de dinheiro e um cartão). */
const abrirGancho = (c: Conta, quando = new Date().toISOString()) => {
  E.tabelas.conversas = [{ telefone: NUM, user_id: U1, pendente: { tipo: 'baixa_conta', conta: c, de: 'aviso' }, atualizado_em: quando }]
}
const ENERGIA = () => conta('c1', 'Energia', 150, somaDias(HOJE, 2))

/* ===================== funções puras ===================== */

await caso('escolha da conta: a que vence por agora vira pergunta; a mais antiga primeiro; longe demais não é citada', async () => {
  const d = (n: number) => somaDias(HOJE, n)
  assert.deepEqual(G.escolherGancho([conta('a', 'Aluguel', 900, d(1)), conta('b', 'Luz', 80, d(20))], HOJE), { modo: 'pagou', conta: conta('a', 'Aluguel', 900, d(1)) })
  assert.equal(G.escolherGancho([conta('b', 'Luz', 80, d(2)), conta('a', 'DAS', 86.05, d(-4))], HOJE)?.conta.id, 'a', 'a mais antiga dentro da janela vem primeiro')
  // Limites da janela do "já pagou?": 10 dias atrás entra, 11 não; 3 dias à frente pergunta, 4 só cita.
  assert.equal(G.escolherGancho([conta('a', 'A', 1, d(-G.DIAS_ATRAS))], HOJE)?.modo, 'pagou')
  assert.equal(G.escolherGancho([conta('a', 'A', 1, d(-G.DIAS_ATRAS - 1))], HOJE), null, 'conta vencida há muito tempo não vira pergunta nem citação')
  assert.equal(G.escolherGancho([conta('a', 'A', 1, d(G.DIAS_FRENTE))], HOJE)?.modo, 'pagou')
  assert.equal(G.escolherGancho([conta('a', 'A', 1, d(G.DIAS_FRENTE + 1))], HOJE)?.modo, 'proxima')
  assert.equal(G.escolherGancho([conta('a', 'A', 1, d(G.DIAS_PROXIMA))], HOJE)?.modo, 'proxima')
  assert.equal(G.escolherGancho([conta('a', 'A', 1, d(G.DIAS_PROXIMA + 1))], HOJE), null)
  assert.equal(G.escolherGancho([], HOJE), null)
  // Linha estragada do banco não derruba nem vira pergunta.
  assert.equal(G.escolherGancho([conta('a', '   ', 1, d(1)), { id: 'b', descricao: 'X', valor: Number.NaN, vencimento: d(1) }, conta('c', 'Y', 1, 'amanhã')], HOJE), null)
})

await caso('texto da confirmação: voz da moedinha, sem emoji nem travessão, valor some para quem escolheu ocultar', async () => {
  const pagou = { modo: 'pagou' as const, conta: conta('a', 'Aluguel', 900, somaDias(HOJE, 1)) }
  const prox = { modo: 'proxima' as const, conta: conta('a', 'Mensalidade do aluguel do ponto comercial', 1200, somaDias(HOJE, 20)) }
  const t1 = G.textoConfirmacao('Bia', pagou, false, HOJE)
  assert.match(t1, /^Pronto, Bia, seu número tá confirmado/)
  assert.match(t1, /Aluguel, R\$ 900,00, vence amanhã\./)
  assert.ok(t1.endsWith(G.PERGUNTA_PAGOU), t1)
  const t2 = G.textoConfirmacao('Bia', pagou, true, HOJE)
  assert.doesNotMatch(t2, /R\$|900/, 'quem oculta valores não recebe valor por WhatsApp')
  assert.match(t2, /Aluguel, vence amanhã\./)
  const t3 = G.textoConfirmacao('', prox, false, HOJE)
  assert.match(t3, /^Pronto, seu número/)
  assert.doesNotMatch(t3, /Já pagou\?/, 'conta longe não vira pergunta de pagamento')
  assert.match(t3, /"paguei a conta"/, 'nome comprido não é repetido no exemplo')
  assert.match(t3, /qual foi o último dinheiro que entrou ou saiu hoje\?/)
  for (const t of [t1, t2, t3, G.textoNaoPagou(pagou.conta), G.TEXTO_JA_BAIXADA, G.PERGUNTA_PAGOU]) assert.doesNotMatch(t, SEM_ENFEITE, t)
  assert.equal(G.quandoVence(somaDias(HOJE, -2), HOJE), `venceu dia ${somaDias(HOJE, -2).slice(8, 10)}/${somaDias(HOJE, -2).slice(5, 7)}`)
  assert.equal(G.quandoVence(HOJE, HOJE), 'vence hoje')
})

await caso('resposta ao "já pagou?": só a resposta inteira conta; frase com mais coisa segue o fluxo normal', async () => {
  for (const s of ['sim', 'Sim!', 'SIM', 's', 'já', 'Já paguei', 'paguei', 'paguei sim', 'tá pago', 'já tá paga', 'pode dar baixa']) assert.equal(G.respostaGancho(s), 'sim', s)
  for (const n of ['não', 'Nao', 'n', 'ainda não', 'Ainda não paguei.', 'depois', 'vou pagar']) assert.equal(G.respostaGancho(n), 'nao', n)
  // A pergunta não oferece números: "1", "2" e "isso" soltos, horas depois, não podem dar baixa em conta nenhuma.
  for (const o of ['1', '2', 'isso', 'ok', 'paguei 50 de luz', 'paguei ontem no nubank', 'sim, mas foi 880', 'recebi 150 no pix', 'saldo', '', '150', 'oi', 'não sei do que você tá falando, quem é?']) assert.equal(G.respostaGancho(o), null, o)
})

/* ===================== confirmação do número ===================== */

await caso('confirmou com conta vencendo: cita a conta, pergunta "já pagou?" e o SIM dá baixa SEM IA', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1) }, { id: 'n2', descricao: 'Internet', valor: 99.9, vencimento: somaDias(HOJE, 20) }])
  const r = await de(NUM_NOVA, `Meu código Granninha: ${CODIGO}`)
  assert.equal(r.status, 'ok')
  assert.equal(perfil(NOVA).whats_verificado, true, 'o número foi confirmado')
  assert.match(r.resposta, /^Pronto, Bia, seu número tá confirmado/)
  assert.match(r.resposta, /Aluguel, R\$ 900,00, vence amanhã/)
  assert.match(r.resposta, /Já pagou\?/)
  assert.doesNotMatch(r.resposta, /recebi 150 no pix/, 'saiu o exemplo genérico no lugar do gancho')
  assert.deepEqual({ tipo: pendenteDe(NUM_NOVA)?.tipo, conta: pendenteDe(NUM_NOVA)?.conta?.id, de: pendenteDe(NUM_NOVA)?.de }, { tipo: 'baixa_conta', conta: 'n1', de: 'confirmacao' })

  const sim = await de(NUM_NOVA, 'Sim')
  assert.equal(sim.status, 'ok', sim.resposta)
  assert.match(sim.resposta, /Conta paga: R\$ 900,00/)
  assert.match(sim.resposta, /Aluguel · Inter/)
  assert.match(sim.resposta, /DESFAZER/)
  assert.equal(contaNoBanco(NOVA, 'n1').status, 'paga')
  assert.equal(contaNoBanco(NOVA, 'n2').status, 'aberta', 'só a conta da pergunta recebe baixa')
  assert.equal(lancsDe(NOVA).length, 1)
  assert.equal(Number(lancsDe(NOVA)[0].valor), 900)
  assert.equal(lancsDe(NOVA)[0].carteira_id, 'inter')
  assert.equal(ia.chamadas.interpretacao, 0, 'a baixa do SIM não pode depender da IA')
  assert.ok(!pendenteDe(NUM_NOVA)?.tipo, 'a pergunta saiu do caminho depois da resposta')
})

await caso('confirmou sem conta nenhuma: a mensagem de sempre, sem pergunta em aberto', async () => {
  semearNova([])
  const r = await de(NUM_NOVA, CODIGO)
  assert.equal(r.resposta, MSG.numeroConfirmado('Bia'))
  assert.ok(!pendenteDe(NUM_NOVA)?.tipo)
})

await caso('confirmou com a próxima conta longe: cita a conta e convida ao primeiro registro, sem perguntar se pagou', async () => {
  semearNova([{ id: 'n1', descricao: 'DAS', valor: 86.05, vencimento: somaDias(HOJE, 25) }])
  const r = await de(NUM_NOVA, CODIGO)
  assert.match(r.resposta, /A próxima é DAS, R\$ 86,05, vence dia \d{2}\/\d{2}\./)
  assert.match(r.resposta, /"paguei das"/)
  assert.doesNotMatch(r.resposta, /Já pagou\?/)
  assert.ok(!pendenteDe(NUM_NOVA)?.tipo, 'sem pergunta, nada fica em aberto: um "sim" solto não pode dar baixa em nada')
  const sim = await de(NUM_NOVA, 'sim')
  assert.equal(contaNoBanco(NOVA, 'n1').status, 'aberta', sim.resposta)
})

await caso('conta a receber e conta já paga não viram gancho', async () => {
  semearNova([
    { id: 'n1', descricao: 'Cliente Joana', valor: 300, vencimento: somaDias(HOJE, 1), tipo: 'receber' },
    { id: 'n2', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1), status: 'paga' },
  ])
  const r = await de(NUM_NOVA, CODIGO)
  assert.equal(r.resposta, MSG.numeroConfirmado('Bia'))
})

await caso('quem escolheu ocultar valores não recebe o valor da conta na confirmação', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: HOJE }], { ocultar: true })
  const r = await de(NUM_NOVA, CODIGO)
  assert.match(r.resposta, /Aluguel, vence hoje\./)
  assert.doesNotMatch(r.resposta, /R\$|900/)
})

await caso('não conseguiu guardar a pergunta: confirma o número com a mensagem de sempre, sem perguntar o que não vai ouvir', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1) }])
  E.falharEscritaEm = 'conversas'
  const r = await de(NUM_NOVA, CODIGO)
  E.falharEscritaEm = null
  assert.equal(perfil(NOVA).whats_verificado, true, 'a confirmação do número nunca depende do gancho')
  assert.equal(r.resposta, MSG.numeroConfirmado('Bia'))
})

await caso('não conseguiu ler as contas: confirma o número com a mensagem de sempre', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1) }])
  E.falharTabela = 'contas'
  const r = await de(NUM_NOVA, CODIGO)
  E.falharTabela = null
  assert.equal(perfil(NOVA).whats_verificado, true)
  assert.equal(r.resposta, MSG.numeroConfirmado('Bia'))
})

/* ===================== a resposta ===================== */

await caso('NÃO: a conta fica aberta, nada é anotado e a conversa segue', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1) }])
  await de(NUM_NOVA, CODIGO)
  const r = await de(NUM_NOVA, 'ainda não')
  assert.equal(r.status, 'ok')
  assert.match(r.resposta, /^Beleza, deixei em aberto\./)
  assert.match(r.resposta, /"paguei aluguel"/)
  assert.equal(contaNoBanco(NOVA, 'n1').status, 'aberta')
  assert.equal(lancsDe(NOVA).length, 0)
  assert.equal(ia.chamadas.interpretacao, 0)
  assert.ok(!pendenteDe(NUM_NOVA)?.tipo, 'um "sim" mais tarde não pode dar baixa depois do NÃO')
})

await caso('outra coisa no lugar da resposta: vale como mensagem nova, a conta não recebe baixa e a pergunta sai', async () => {
  abrirGancho(ENERGIA())
  ia.regras = [[/gasolina/, acoes(acao({ valor: 50, descricao: 'Gasolina', carteira_id: 'nubank' }))]]
  const r = await msg('paguei 50 de gasolina no nubank')
  assert.match(r, /R\$ 50,00/)
  assert.equal(contaNoBanco(U1, 'c1').status, 'aberta')
  assert.ok(!pendenteDe(NUM)?.tipo)
  ia.regras = [[/^sim$/i, SEM_ACAO]]
  await msg('sim')
  assert.equal(contaNoBanco(U1, 'c1').status, 'aberta', 'o SIM depois de outro assunto não é mais resposta ao gancho')
})

await caso('SIM com mais de uma conta de dinheiro: pergunta de onde saiu e a resposta fecha a baixa na conta certa', async () => {
  abrirGancho(ENERGIA())
  const r = await msg('já paguei')
  assert.match(r, /saiu de qual conta\?/)
  assert.equal(pendenteDe(NUM)?.tipo, 'baixa_conta', 'o segundo passo continua sendo do gancho')
  assert.equal(contaNoBanco(U1, 'c1').status, 'aberta', 'nada é gravado antes de saber de onde saiu')
  // Número fora da lista: repete a pergunta e não perde o fio.
  const fora = await msg('9')
  assert.match(fora, /^Não achei essa opção\. .*saiu de qual conta\?/s)
  assert.equal(pendenteDe(NUM)?.tipo, 'baixa_conta')
  const fim2 = await msg('2')
  assert.match(fim2, /Conta paga: R\$ 150,00/)
  assert.match(fim2, /Energia · Dinheiro/)
  assert.equal(contaNoBanco(U1, 'c1').status, 'paga')
  assert.equal(E.tabelas.lancamentos.find((l) => l.user_id === U1)?.carteira_id, 'dinheiro')
  assert.equal(ia.chamadas.interpretacao, 0, 'nem o SIM nem a escolha da conta dependem da IA')
  assert.ok(!pendenteDe(NUM)?.tipo)
})

await caso('segundo passo: responder pelo nome da conta também fecha; outra mensagem vale sozinha e a conta fica aberta', async () => {
  abrirGancho(ENERGIA())
  await msg('sim')
  const r = await msg('Nubank')
  assert.match(r, /Energia · Nubank/)
  assert.equal(contaNoBanco(U1, 'c1').status, 'paga')

  abrirGancho(conta('c3', 'Boleto velho', 70, somaDias(HOJE, -3)))
  await msg('sim')
  ia.regras = [[/gasolina/, acoes(acao({ valor: 50, descricao: 'Gasolina', carteira_id: 'nubank' }))]]
  const outra = await msg('paguei 50 de gasolina no nubank')
  assert.match(outra, /R\$ 50,00/)
  assert.equal(contaNoBanco(U1, 'c3').status, 'aberta')
  assert.ok(!pendenteDe(NUM)?.tipo)
})

await caso('segundo passo vale meia hora, como toda pergunta com opções: "2" no dia seguinte não dá baixa', async () => {
  abrirGancho(ENERGIA())
  await msg('sim')
  E.tabelas.conversas.find((c) => c.telefone === NUM)!.atualizado_em = new Date(Date.now() - 31 * 60_000).toISOString()
  ia.regras = [[/^2$/, SEM_ACAO]]
  await msg('2')
  assert.equal(contaNoBanco(U1, 'c1').status, 'aberta')
  assert.equal(E.tabelas.lancamentos.filter((l) => l.user_id === U1).length, 0)
})

await caso('SIM por áudio também dá baixa', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1) }])
  await de(NUM_NOVA, CODIGO)
  ia.transcricao = 'Já paguei.'
  const r = await audioDe(NUM_NOVA)
  assert.match(r.resposta, /Conta paga: R\$ 900,00/)
  assert.equal(contaNoBanco(NOVA, 'n1').status, 'paga')
})

await caso('SIM depois de 24 h: a pergunta já não vale, nenhuma conta recebe baixa', async () => {
  // Uma conta de dinheiro só: se a pergunta ainda valesse, o SIM daria baixa direto, sem perguntar de onde saiu.
  E.tabelas.carteiras = E.tabelas.carteiras.filter((c) => !(c.user_id === U1 && c.id !== 'nubank'))
  abrirGancho(ENERGIA(), new Date(Date.now() - G.VALE_MS - 60_000).toISOString())
  ia.regras = [[/^sim$/i, SEM_ACAO]]
  const r = await msg('sim')
  assert.doesNotMatch(r, /Conta paga|saiu de qual conta/, r)
  assert.equal(contaNoBanco(U1, 'c1').status, 'aberta')
  assert.equal(E.tabelas.lancamentos.filter((l) => l.user_id === U1).length, 0)
})

await caso('SIM horas depois (dentro das 24 h) ainda vale: o aviso sai de manhã e a resposta vem à noite', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1) }])
  await de(NUM_NOVA, CODIGO)
  E.tabelas.conversas.find((c) => c.telefone === NUM_NOVA)!.atualizado_em = new Date(Date.now() - 10 * 60 * 60_000).toISOString()
  const r = await de(NUM_NOVA, 'paguei')
  assert.match(r.resposta, /Conta paga: R\$ 900,00/)
})

await caso('SIM quando a conta já não está aberta (deu baixa pelo painel): não anota nada em dobro', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1) }])
  await de(NUM_NOVA, CODIGO)
  contaNoBanco(NOVA, 'n1').status = 'paga'
  const r = await de(NUM_NOVA, 'sim')
  assert.equal(r.resposta, G.TEXTO_JA_BAIXADA)
  assert.equal(lancsDe(NOVA).length, 0)
})

await caso('SIM usa o valor e o nome que estão no banco AGORA, não os da hora da pergunta', async () => {
  semearNova([{ id: 'n1', descricao: 'Aluguel', valor: 900, vencimento: somaDias(HOJE, 1) }])
  await de(NUM_NOVA, CODIGO)
  contaNoBanco(NOVA, 'n1').valor = 950 // a pessoa corrigiu o valor no painel antes de responder
  const r = await de(NUM_NOVA, 'sim')
  assert.match(r.resposta, /Conta paga: R\$ 950,00/)
  assert.equal(Number(lancsDe(NOVA)[0].valor), 950)
})

await caso('duas contas de mesmo nome em aberto (uma por mês): o SIM dá baixa na da pergunta, não na outra', async () => {
  semearNova([{ id: 'dez', descricao: 'Internet', valor: 100, vencimento: somaDias(HOJE, 31) }, { id: 'nov', descricao: 'Internet', valor: 100, vencimento: somaDias(HOJE, 1) }])
  const c = await de(NUM_NOVA, CODIGO)
  assert.equal(pendenteDe(NUM_NOVA)?.conta?.id, 'nov', c.resposta)
  await de(NUM_NOVA, 'sim')
  assert.equal(contaNoBanco(NOVA, 'nov').status, 'paga')
  assert.equal(contaNoBanco(NOVA, 'dez').status, 'aberta')
})

await caso('a pergunta do gancho nunca é de outro cliente: o SIM só olha as contas de quem respondeu', async () => {
  // Pergunta gravada com o id de uma conta que é de OUTRA pessoa (dado estragado): não pode dar baixa em nada.
  E.tabelas.contas.push({ user_id: 'u-2', id: 'alheia', tipo: 'pagar', descricao: 'Aluguel', valor: 500, vencimento: somaDias(HOJE, 1), status: 'aberta' })
  abrirGancho(conta('alheia', 'Aluguel', 500, somaDias(HOJE, 1)))
  const r = await msg('sim')
  assert.equal(r, G.TEXTO_JA_BAIXADA)
  assert.equal(contaNoBanco('u-2', 'alheia').status, 'aberta')
})

/* ===================== aviso de vencimento ===================== */

type Deps = import('../src/avisos.ts').DepsAvisos
const CFG = () => ({ modo: 'todos' as const, piloto: [] as string[], janelaMin: 180, maxPorCiclo: 15, espacoMs: 0 })
const DIA = '2026-11-20'
const em = (hhmm: string) => new Date(`${DIA}T${hhmm}:00-03:00`)
function fakeAviso(contas: Conta[], opt: { abrir?: boolean | 'erro'; falharEnvio?: boolean; semDeps?: boolean } = {}) {
  const enviados: string[] = []
  const abertas: string[] = []
  const fechadas: string[] = []
  const ledger = new Set<string>()
  const deps: Deps = {
    perfis: async () => [{ id: 'u1', nome: 'Arthur Teste', whats: '', whats_chave: '8188887777', lembrete_hora: '09:00', antecedencia: 1, ocultar: false, exclusao_em: null, assinatura: { status: 'ativa', trial_fim: null } }],
    contas: async () => contas,
    telefoneDe: async () => NUM,
    jaAvisadas: async (_u, ch) => new Set(ch.filter((c) => ledger.has(c))),
    reservar: async (_u, _t, itens) => itens.filter((i) => !ledger.has(i.chave)).map((i) => (ledger.add(i.chave), i.chave)),
    concluir: async (_u, ch, ok) => void (ok || ch.forEach((c) => ledger.delete(c))),
    enviar: async (_t, texto) => {
      if (opt.falharEnvio) throw new Error('gateway 500: provocado')
      enviados.push(texto)
    },
    esperar: async () => {},
    ...(opt.semDeps ? {} : {
      abrirPergunta: async (_u: string, _t: string, c: Conta) => {
        if (opt.abrir === 'erro') throw new Error('banco fora')
        if (opt.abrir === false) return false
        abertas.push(c.id)
        return true
      },
      fecharPergunta: async (_t: string, id: string) => void fechadas.push(id),
    }),
  }
  return { deps, enviados, abertas, fechadas }
}

await caso('aviso de UMA conta: termina em "Já pagou?" e a pergunta fica em aberto para essa conta', async () => {
  A.zerarEstado()
  const f = fakeAviso([conta('c1', 'Aluguel', 900, DIA)])
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.equal(f.enviados.length, 1)
  assert.ok(f.enviados[0].endsWith(G.PERGUNTA_PAGOU), f.enviados[0])
  assert.doesNotMatch(f.enviados[0], /Quando pagar, me avisa/)
  assert.deepEqual(f.abertas, ['c1'])
  assert.doesNotMatch(f.enviados[0], SEM_ENFEITE)
})

await caso('aviso de DUAS contas: texto de sempre, sem pergunta em aberto (um SIM não diria qual)', async () => {
  A.zerarEstado()
  const f = fakeAviso([conta('c1', 'Aluguel', 900, DIA), conta('c2', 'Luz', 80, DIA)])
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.match(f.enviados[0], /Quando pagar, me avisa/)
  assert.doesNotMatch(f.enviados[0], /Já pagou\?/)
  assert.deepEqual(f.abertas, [])
})

await caso('não deu para abrir a pergunta (recusou, deu erro ou a dependência não existe): o aviso sai do mesmo jeito, com o texto sem pergunta', async () => {
  for (const opt of [{ abrir: false as const }, { abrir: 'erro' as const }, { semDeps: true }]) {
    A.zerarEstado()
    const f = fakeAviso([conta('c1', 'Aluguel', 900, DIA)], opt)
    await A.rodarAvisos(f.deps, CFG(), em('09:00'))
    assert.equal(f.enviados.length, 1, JSON.stringify(opt))
    assert.match(f.enviados[0], /Quando pagar, me avisa/, JSON.stringify(opt))
    assert.doesNotMatch(f.enviados[0], /Já pagou\?/, 'perguntou sem ter como ouvir a resposta')
  }
})

await caso('envio falhou depois de abrir a pergunta: a pergunta sai do caminho', async () => {
  A.zerarEstado()
  const f = fakeAviso([conta('c1', 'Aluguel', 900, DIA)], { falharEnvio: true })
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.deepEqual(f.abertas, ['c1'])
  assert.deepEqual(f.fechadas, ['c1'], 'ficou uma pergunta sobre uma conta de que a pessoa nunca ouviu falar')
})

await caso('texto do aviso sem a pergunta continua igual ao de antes', async () => {
  const uma = [conta('c1', 'Aluguel', 900, DIA)]
  assert.match(A.montarTexto({ nome: 'Ana', ocultar: false }, uma, DIA), /Quando pagar, me avisa\. Por exemplo: "paguei aluguel"\.$/)
  // Pedir a pergunta com mais de uma conta não muda nada: ela só existe para uma.
  const duas = [...uma, conta('c2', 'Luz', 80, DIA)]
  assert.equal(A.montarTexto({ nome: 'Ana', ocultar: false }, duas, DIA, true), A.montarTexto({ nome: 'Ana', ocultar: false }, duas, DIA))
})

/* ---------------- as consultas de verdade contra o banco falso ---------------- */

const banco = () => depsAvisosDoBanco(sb, async () => {})

await caso('banco: só abre a pergunta para quem já escreveu deste número, e não passa por cima de outra pergunta viva', async () => {
  const d = banco()
  const c = conta('c1', 'Energia', 150, somaDias(HOJE, 2))
  assert.equal(await d.abrirPergunta!(U1, NUM, c), false, 'nunca escreveu deste número: a resposta chegaria por outra chave')
  assert.ok(!pendenteDe(NUM)?.tipo)

  E.tabelas.mensagens = [{ id: 'm0', user_id: U1, telefone: NUM, status: 'ok', criado_em: new Date().toISOString() }]
  assert.equal(await d.abrirPergunta!(U1, NUM, c), true)
  assert.deepEqual({ tipo: pendenteDe(NUM)?.tipo, conta: pendenteDe(NUM)?.conta?.id, de: pendenteDe(NUM)?.de }, { tipo: 'baixa_conta', conta: 'c1', de: 'aviso' })

  // Pergunta de outro assunto feita agora há pouco: o aviso não a apaga.
  E.tabelas.conversas = [{ telefone: NUM, user_id: U1, pendente: { tipo: 'pergunta', texto: 'paguei 12 de pão', pergunta: 'Saiu de qual conta?' }, atualizado_em: new Date().toISOString() }]
  assert.equal(await d.abrirPergunta!(U1, NUM, c), false)
  assert.equal(pendenteDe(NUM)?.tipo, 'pergunta', 'a pergunta que estava viva foi apagada pelo aviso')

  // A mesma pergunta, velha (mais de meia hora): já não vale, o aviso pode ocupar o lugar.
  E.tabelas.conversas[0].atualizado_em = new Date(Date.now() - 31 * 60_000).toISOString()
  assert.equal(await d.abrirPergunta!(U1, NUM, c), true)
  assert.equal(pendenteDe(NUM)?.tipo, 'baixa_conta')
})

await caso('banco: fechar a pergunta só tira a DESTE aviso', async () => {
  const d = banco()
  abrirGancho(ENERGIA())
  await d.fecharPergunta!(NUM, 'outra-conta')
  assert.equal(pendenteDe(NUM)?.tipo, 'baixa_conta', 'tirou a pergunta de outra conta')
  await d.fecharPergunta!(NUM, 'c1')
  assert.ok(!pendenteDe(NUM)?.tipo)
  // Outra pergunta no lugar (a pessoa escreveu no meio): não é nossa.
  E.tabelas.conversas = [{ telefone: NUM, user_id: U1, pendente: { tipo: 'pergunta', texto: 'x', pergunta: 'y' }, atualizado_em: new Date().toISOString() }]
  await d.fecharPergunta!(NUM, 'c1')
  assert.equal(pendenteDe(NUM)?.tipo, 'pergunta')
})

await caso('ponta a ponta do aviso: pergunta aberta pelo banco de verdade, SIM dá baixa na conta do aviso', async () => {
  // Uma conta de dinheiro só, para a baixa fechar sem perguntar de onde saiu.
  E.tabelas.carteiras = E.tabelas.carteiras.filter((c) => !(c.user_id === U1 && c.id !== 'nubank'))
  E.tabelas.mensagens = [{ id: 'm0', user_id: U1, telefone: NUM, status: 'ok', criado_em: new Date(Date.now() - 86400_000).toISOString() }]
  assert.equal(await banco().abrirPergunta!(U1, NUM, ENERGIA()), true)
  const r = await msg('sim')
  assert.match(r, /Conta paga: R\$ 150,00/)
  assert.match(r, /Energia · Nubank/)
  assert.equal(contaNoBanco(U1, 'c1').status, 'paga')
  assert.equal(ia.chamadas.interpretacao, 0)
})

fim()
