/**
 * Mudar o valor de uma conta fixa pelo WhatsApp ("a internet agora é 109"), de ponta a ponta (banco e IA falsos em memória).
 * Caso de origem (23/11/2026): a conta Internet estava em R$ 120 e o Arthur não conseguia passar para R$ 109 nem pelo WhatsApp nem pelo painel.
 * Antes: "a internet agora é 109 todo mês" virava OUTRA conta fixa (duas Internet, contas em dobro), e a ficha da conta mandava mudar
 * "pelo WhatsApp", que não fazia isso.
 * Regras travadas aqui: a conta fixa é a fonte (leva as contas em aberto dela, inclusive a vencida; as pagas ficam); a conta tem que estar na frase;
 * o valor tem que estar na frase; nunca mexe em conta de outro cliente; DESFAZER e correção devolvem o valor de antes (de cada conta, não um só);
 * falha no meio desfaz tudo; pagar ("paguei 109 de internet") continua sendo pagamento.
 * Os resultados esperados são escritos à mão (não vêm do código testado).
 *   npx tsx test/fixa-whatsapp.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, HOJE, ia, lancsU1, msg, semear, somaDias, SEM_ACAO, U1, U2 } from './_falsos.ts'

const { executar } = await import('../src/executar.ts')

const ajuste = (x: Partial<Parameters<typeof acao>[0]> = {}) => acao({ tipo_acao: 'ajustar_fixa', movimento: null, descricao: 'Internet', fixa_id: 'f2', valor: 109, categoria_id: null, meio: null, ...x })
const DESFAZER: [RegExp, unknown] = [/<mensagem_do_cliente>\ndesfazer\n/i, { ...SEM_ACAO, intencao: 'desfazer' }]

/** Internet (f2, R$ 100, dia 20) com 3 contas em aberto (uma vencida, uma com valor diferente de propósito) e 1 já paga. */
function semearInternet() {
  semear()
  E.tabelas.contas.push(
    { user_id: U1, id: 'n-paga', tipo: 'pagar', descricao: 'Internet', valor: 100, vencimento: somaDias(HOJE, -40), status: 'paga', fixa_id: 'f2', pago_em: somaDias(HOJE, -40) },
    { user_id: U1, id: 'n-venc', tipo: 'pagar', descricao: 'Internet', valor: 100, vencimento: somaDias(HOJE, -3), status: 'aberta', fixa_id: 'f2' },
    { user_id: U1, id: 'n-1', tipo: 'pagar', descricao: 'Internet', valor: 95, vencimento: somaDias(HOJE, 27), status: 'aberta', fixa_id: 'f2' },
    { user_id: U1, id: 'n-2', tipo: 'pagar', descricao: 'Internet', valor: 100, vencimento: somaDias(HOJE, 57), status: 'aberta', fixa_id: 'f2' },
  )
  E.tabelas.fixas.push({ user_id: U2, id: 'fx-u2', descricao: 'Internet', valor: 500, dia: 1 })
  E.tabelas.contas.push({ user_id: U2, id: 'u2-c', tipo: 'pagar', descricao: 'Internet', valor: 500, vencimento: somaDias(HOJE, 5), status: 'aberta', fixa_id: 'fx-u2' })
}
const fixa = (id: string, u = U1) => E.tabelas.fixas.find((f) => f.id === id && f.user_id === u)!
const conta = (id: string) => E.tabelas.contas.find((c) => c.id === id)!
const fixasU1 = () => E.tabelas.fixas.filter((f) => f.user_id === U1)

await caso('"a internet agora é 109": muda a fixa e as 3 contas em aberto, inclusive a vencida; a paga e o resto ficam', async () => {
  semearInternet()
  ia.regras = [[/internet agora/, acoes(ajuste())]]
  const r = await msg('a internet agora é 109')
  assert.match(r, /Internet agora é R\$ 109,00 todo mês/)
  assert.match(r, /Ajustei as 3 contas em aberto/)
  assert.equal(fixa('f2').valor, 109)
  for (const id of ['n-venc', 'n-1', 'n-2']) assert.equal(conta(id).valor, 109, id)
  assert.equal(conta('n-paga').valor, 100, 'a paga não muda: o dinheiro já saiu')
  assert.equal(fixa('f1').valor, 900, 'o aluguel não muda')
  assert.equal(fixasU1().length, 2, 'não criou outra conta fixa')
  assert.equal(lancsU1().length, 0, 'não lançou nada (não é pagamento)')
  assert.equal(fixa('fx-u2', U2).valor, 500, 'conta fixa de outro cliente intacta')
  assert.equal(conta('u2-c').valor, 500)
})

await caso('o prompt mostra as contas fixas do cliente (id, nome, valor e dia) e nenhuma de outro', async () => {
  semearInternet()
  ia.regras = [[/internet agora/, acoes(ajuste())]]
  await msg('a internet agora é 109')
  assert.match(ia.ultimoSistema, /CONTAS FIXAS\n- f1: "Aluguel" R\$ 900\.00 todo dia 10\n- f2: "Internet" R\$ 100\.00 todo dia 20/)
  assert.ok(!ia.ultimoSistema.includes('fx-u2'), 'a conta fixa de outro cliente não entra no prompt')
  assert.match(ia.ultimoSistema, /"ajustar_fixa"/)
})

await caso('DESFAZER devolve o valor de ANTES de cada conta (a de 95 volta a 95, não a 100)', async () => {
  semearInternet()
  ia.regras = [[/internet agora/, acoes(ajuste())], DESFAZER]
  await msg('a internet agora é 109')
  const r = await msg('desfazer')
  assert.match(r, /Pronto, desfiz/)
  assert.equal(fixa('f2').valor, 100)
  assert.deepEqual(['n-venc', 'n-1', 'n-2', 'n-paga'].map((id) => conta(id).valor), [100, 95, 100, 100])
})

await caso('DESFAZER não mexe em conta que foi paga depois do ajuste', async () => {
  semearInternet()
  ia.regras = [[/internet agora/, acoes(ajuste())], DESFAZER]
  await msg('a internet agora é 109')
  Object.assign(conta('n-venc'), { status: 'paga', pago_em: HOJE }) // ela pagou a vencida por 109 entre um e outro
  await msg('desfazer')
  assert.equal(conta('n-venc').valor, 109, 'paga continua com o valor pago')
  assert.equal(conta('n-1').valor, 95)
  assert.equal(fixa('f2').valor, 100)
})

await caso('correção "não foi 109, foi 119": devolve e aplica de novo, sem sobrar 109 em lugar nenhum', async () => {
  semearInternet()
  ia.regras = [
    [/Correção:/, acoes(ajuste({ valor: 119 }))],
    [/<mensagem_do_cliente>\nnão foi 109/, { ...SEM_ACAO, intencao: 'corrigir', correcao: 'foi 119' }],
    [/internet agora/, acoes(ajuste())],
  ]
  await msg('a internet agora é 109')
  const r = await msg('não foi 109, foi 119')
  assert.match(r, /119,00/)
  assert.equal(fixa('f2').valor, 119)
  assert.deepEqual(['n-venc', 'n-1', 'n-2'].map((id) => conta(id).valor), [119, 119, 119])
  assert.equal(conta('n-paga').valor, 100)
  assert.equal(fixasU1().length, 2)
})

await caso('a conta não está na frase: pergunta e não muda nada ("muda pra 109" com a IA chutando o aluguel)', async () => {
  semearInternet()
  ia.regras = [[/muda pra 109/, acoes(ajuste({ fixa_id: 'f1', descricao: 'Aluguel' }))]]
  const r = await msg('muda pra 109')
  assert.match(r, /Você quer mudar a conta fixa "Aluguel"\?/)
  assert.equal(fixa('f1').valor, 900)
  assert.equal(conta('n-1').valor, 95)
})

await caso('o valor não está na frase: "só para conferir", e nada muda', async () => {
  semearInternet()
  ia.regras = [[/internet agora/, acoes(ajuste({ valor: 109 }))]]
  const r = await msg('a internet agora é 99')
  assert.match(r, /Só para conferir: o valor novo de "Internet" é quanto\?/)
  assert.equal(fixa('f2').valor, 100)
})

await caso('mesmo valor que já está: avisa que não mudou nada', async () => {
  semearInternet()
  ia.regras = [[/internet/, acoes(ajuste({ valor: 100 }))]]
  const r = await msg('a internet é 100')
  assert.match(r, /"Internet" já está em R\$ 100,00 todo dia 20\. Não mudei nada\./)
  assert.equal(conta('n-1').valor, 95, 'nenhuma conta foi mexida')
})

await caso('duas contas com a mesma palavra: se a frase não traz o nome inteiro da escolhida, pergunta qual', async () => {
  semearInternet()
  E.tabelas.fixas.push({ user_id: U1, id: 'f3', descricao: 'Internet da loja', valor: 200, dia: 5 })
  ia.regras = [[/internet/, acoes(ajuste({ fixa_id: 'f3', descricao: 'Internet da loja', valor: 109 }))]]
  const r = await msg('internet agora é 109')
  assert.match(r, /Qual delas: "Internet da loja" ou "Internet"\?/)
  assert.equal(fixa('f3').valor, 200)
  assert.equal(fixa('f2').valor, 100)
})

await caso('duas contas com a mesma palavra: a frase com o nome inteiro da escolhida segue', async () => {
  semearInternet()
  E.tabelas.fixas.push({ user_id: U1, id: 'f3', descricao: 'Internet da loja', valor: 200, dia: 5 })
  ia.regras = [[/internet da loja/, acoes(ajuste({ fixa_id: 'f3', descricao: 'Internet da loja', valor: 180 }))]]
  const r = await msg('a internet da loja agora é 180')
  assert.match(r, /Internet da loja agora é R\$ 180,00 todo mês/)
  assert.equal(fixa('f3').valor, 180)
  assert.equal(fixa('f2').valor, 100, 'a outra Internet não muda')
})

await caso('a IA devolve a conta fixa de OUTRO cliente: não está na lista dele, pergunta e não toca em nada', async () => {
  semearInternet()
  ia.regras = [[/internet agora/, acoes(ajuste({ fixa_id: 'fx-u2' }))]]
  const r = await msg('a internet agora é 109')
  assert.match(r, /Qual conta fixa mudou\? Você tem: Aluguel, Internet\./)
  assert.equal(fixa('fx-u2', U2).valor, 500)
  assert.equal(conta('u2-c').valor, 500)
})

await caso('segunda linha de defesa: o executor, forçado com a fixa de outro cliente, não grava em lugar nenhum', async () => {
  semearInternet()
  const forjada = { ...ajuste({ fixa_id: 'fx-u2' }), carteira_id: '', data: HOJE, fatura: null, noCartao: false }
  await assert.rejects(executar(U1, { hoje: HOJE, categorias: [], carteiras: [], contasAbertas: [] } as never, [forjada as never], 'texto', null), /não existe mais/)
  assert.equal(fixa('fx-u2', U2).valor, 500)
  assert.equal(conta('u2-c').valor, 500)
})

await caso('"internet 109 todo dia 20" com a Internet de dia 20 já cadastrada: é o valor novo da MESMA conta, não uma segunda', async () => {
  semearInternet()
  ia.regras = [[/internet 109/, acoes(acao({ tipo_acao: 'recorrente', movimento: 'saida', descricao: 'Internet', valor: 109, dia_do_mes: 20, categoria_id: null, meio: null }))]]
  const r = await msg('internet 109 todo dia 20')
  assert.match(r, /Internet agora é R\$ 109,00 todo mês/)
  assert.equal(fixa('f2').valor, 109)
  assert.equal(fixasU1().length, 2, 'não criou a segunda Internet')
})

await caso('mesmo nome mas OUTRO dia dito: segue sendo conta fixa nova (a pessoa pediu outro dia de propósito)', async () => {
  semearInternet()
  ia.regras = [[/internet 109/, acoes(acao({ tipo_acao: 'recorrente', movimento: 'saida', descricao: 'Internet', valor: 109, dia_do_mes: 25, categoria_id: null, meio: null }))]]
  await msg('internet 109 todo dia 25')
  assert.equal(fixasU1().length, 3, 'criou a nova')
  assert.equal(fixa('f2').valor, 100)
})

await caso('nome parecido mas não igual ("Aluguel da loja" x "Aluguel"): nunca une, cria a nova', async () => {
  semearInternet()
  ia.regras = [[/aluguel da loja/, acoes(acao({ tipo_acao: 'recorrente', movimento: 'saida', descricao: 'Aluguel da loja', valor: 700, dia_do_mes: 10, categoria_id: null, meio: null }))]]
  await msg('aluguel da loja 700 todo dia 10')
  assert.equal(fixasU1().length, 3)
  assert.equal(fixa('f1').valor, 900, 'o Aluguel de antes não muda')
})

await caso('pagar continua sendo pagamento: "paguei 109 de internet" não muda a conta fixa', async () => {
  semearInternet()
  ia.regras = [[/paguei 109 de internet/, acoes(acao({ tipo_acao: 'lancamento', movimento: 'saida', descricao: 'Internet', valor: 109, categoria_id: null }))]]
  await msg('paguei 109 de internet')
  assert.equal(fixa('f2').valor, 100, 'a fixa não mudou')
})

await caso('falha na leitura das contas fixas: avisa e não muda nada; o resto do WhatsApp segue (registrar um gasto)', async () => {
  semearInternet()
  ia.regras = [[/<mensagem_do_cliente>\ngastei 6/, acoes(acao({ valor: 6 }))], [/internet agora/, acoes(ajuste())]]
  E.falharTabela = 'fixas'
  assert.match(await msg('gastei 6 no pix'), /saiu R\$ 6,00/)
  assert.match(await msg('a internet agora é 109'), /Não consegui ver suas contas fixas agora/)
  E.falharTabela = null
  assert.equal(fixa('f2').valor, 100)
  assert.equal(lancsU1().length, 1)
})

await caso('falha no meio da mensagem desfaz tudo: o ajuste da fixa e das contas volta ao que era', async () => {
  semearInternet()
  ia.regras = [[/internet e mercado/, acoes(ajuste(), acao({ valor: 6 }))]]
  E.falharEscritaEm = 'lancamentos' // o 2º item (gasto) é recusado depois de o 1º já ter gravado
  const r = await msg('a internet e mercado: internet agora é 109 e gastei 6 no pix')
  assert.match(r, /problema|não consegui|nada que você fez/i)
  E.falharEscritaEm = null
  assert.equal(fixa('f2').valor, 100, 'a fixa voltou')
  assert.deepEqual(['n-venc', 'n-1', 'n-2'].map((id) => conta(id).valor), [100, 95, 100], 'cada conta voltou ao seu valor')
  assert.equal(lancsU1().length, 0)
})

await caso('conta fixa sem conta em aberto: muda a fixa e diz que as próximas já saem com o valor novo', async () => {
  semear() // f2 sem nenhuma conta ligada
  ia.regras = [[/internet agora/, acoes(ajuste())]]
  const r = await msg('a internet agora é 109')
  assert.match(r, /Não tinha conta em aberto para ajustar\. As próximas já saem com o valor e o dia novos\./)
  assert.equal(fixa('f2').valor, 109)
})

await caso('cliente sem nenhuma conta fixa: explica como cadastrar, não inventa', async () => {
  semear()
  E.tabelas.fixas = []
  ia.regras = [[/internet agora/, acoes(ajuste())]]
  assert.match(await msg('a internet agora é 109'), /Você não tem conta fixa cadastrada/)
})

/* ---------- dia, conta avulsa, encerrar, fixa a receber (pedido do Arthur, 23/11: tudo do painel dentro do WhatsApp) ---------- */

const contasF2 = () => E.tabelas.contas.filter((c) => c.fixa_id === 'f2')
const dataDia = (ym: string, dia: number) => `${ym}-${String(dia).padStart(2, '0')}`

await caso('"a internet agora vence dia 25": muda o dia da fixa e o vencimento das contas em aberto, no mês de cada uma; a paga e o valor ficam', async () => {
  semearInternet()
  ia.regras = [[/vence dia 25/, acoes(ajuste({ valor: null, dia_do_mes: 25 }))]]
  const r = await msg('a internet agora vence dia 25')
  assert.match(r, /Internet agora vence todo dia 25/)
  assert.equal(fixa('f2').dia, 25)
  assert.equal(fixa('f2').valor, 100, 'o valor não mudou')
  for (const id of ['n-venc', 'n-1', 'n-2']) assert.equal(String(conta(id).vencimento).slice(8, 10), '25', id)
  const mes = (id: string) => String(conta(id).vencimento).slice(0, 7)
  assert.equal(conta('n-venc').vencimento, dataDia(mes('n-venc'), 25), 'continua no mesmo mês')
  assert.equal(String(conta('n-paga').vencimento).slice(8, 10) === '25', false, 'a paga não muda de dia')
  assert.deepEqual(['n-venc', 'n-1', 'n-2'].map((id) => conta(id).valor), [100, 95, 100], 'valores intactos')
})

await caso('valor e dia na mesma frase: muda os dois', async () => {
  semearInternet()
  ia.regras = [[/109 e dia 25/, acoes(ajuste({ valor: 109, dia_do_mes: 25 }))]]
  const r = await msg('a internet agora é 109 e dia 25')
  assert.match(r, /Internet agora é R\$ 109,00 todo mês e vence todo dia 25/)
  assert.equal(fixa('f2').valor, 109)
  assert.equal(fixa('f2').dia, 25)
})

await caso('DESFAZER do ajuste de dia devolve o dia da fixa e o vencimento exato de cada conta', async () => {
  semearInternet()
  const antes = contasF2().map((c) => [c.id, c.vencimento, c.valor])
  ia.regras = [[/vence dia 25/, acoes(ajuste({ valor: null, dia_do_mes: 25 }))], DESFAZER]
  await msg('a internet agora vence dia 25')
  await msg('desfazer')
  assert.equal(fixa('f2').dia, 20)
  assert.deepEqual(contasF2().map((c) => [c.id, c.vencimento, c.valor]), antes)
})

await caso('o dia não está na frase: a IA chutou, pergunta e não muda nada', async () => {
  semearInternet()
  ia.regras = [[/internet/, acoes(ajuste({ valor: null, dia_do_mes: 25 }))]]
  const r = await msg('mudei a internet de dia')
  assert.match(r, /Em que dia do mês vence "Internet"\?/)
  assert.equal(fixa('f2').dia, 20)
})

await caso('ajustar_conta: "a internet desse mês vence dia 28" muda SÓ a conta mais próxima; a fixa e as outras ficam', async () => {
  semearInternet()
  const alvo = conta('n-1') // a de 95, próxima não vencida
  const nova = somaDias(HOJE, 40)
  ia.regras = [[/desse mês vence/, acoes(acao({ tipo_acao: 'ajustar_conta', movimento: null, conta_id: 'n-venc', descricao: 'Internet', valor: null, vencimento: nova, categoria_id: null, meio: null }))]]
  const r = await msg('a internet desse mês vence dia 28')
  assert.match(r, /Mudei só essa conta/)
  assert.equal(conta('n-venc').vencimento, nova)
  assert.equal(fixa('f2').dia, 20, 'a conta fixa não mudou')
  assert.equal(alvo.valor, 95)
  assert.equal(conta('n-2').vencimento, somaDias(HOJE, 57))
  void alvo
})

await caso('ajustar_conta: valor novo de uma conta avulsa ("a luz veio 180 e não 150")', async () => {
  semearInternet()
  ia.regras = [[/energia veio 180/, acoes(acao({ tipo_acao: 'ajustar_conta', movimento: null, conta_id: 'c1', descricao: 'Energia', valor: 180, vencimento: null, categoria_id: null, meio: null }))]]
  const r = await msg('a energia veio 180 e não 150')
  assert.match(r, /Energia agora é R\$ 180,00/)
  assert.equal(conta('c1').valor, 180)
  assert.equal(conta('c3').valor, 70, 'as outras contas não mudam')
})

await caso('ajustar_conta: DESFAZER devolve valor e data', async () => {
  semearInternet()
  const antes = [conta('c1').valor, conta('c1').vencimento]
  ia.regras = [[/energia veio/, acoes(acao({ tipo_acao: 'ajustar_conta', movimento: null, conta_id: 'c1', descricao: 'Energia', valor: 180, vencimento: somaDias(HOJE, 9), categoria_id: null, meio: null }))], DESFAZER]
  await msg('a energia veio 180 e vence mais tarde')
  assert.equal(conta('c1').valor, 180)
  await msg('desfazer')
  assert.deepEqual([conta('c1').valor, conta('c1').vencimento], antes)
})

await caso('ajustar_conta: conta paga não é mexida, conta que não está na frase pergunta, data inválida pergunta', async () => {
  semearInternet()
  ia.regras = [[/chute/, acoes(acao({ tipo_acao: 'ajustar_conta', movimento: null, conta_id: 'c2', descricao: 'Joana', valor: 10, categoria_id: null, meio: null }))]]
  assert.match(await msg('chute 10'), /Você quer mudar a conta "Joana"\?/)
  ia.regras = [[/energia vence/, acoes(acao({ tipo_acao: 'ajustar_conta', movimento: null, conta_id: 'c1', descricao: 'Energia', valor: null, vencimento: '2026-02-31', categoria_id: null, meio: null }))]]
  assert.match(await msg('a energia vence 31 de fevereiro'), /O que mudou na conta "Energia"/)
  assert.equal(conta('c1').valor, 150)
  assert.equal(conta('c2').valor, 300)
})

await caso('ajustar_conta: três contas Internet em aberto e a IA pegou a mais distante sem a frase citar a data: pergunta qual', async () => {
  semearInternet()
  ia.regras = [[/internet vence/, acoes(acao({ tipo_acao: 'ajustar_conta', movimento: null, conta_id: 'n-2', descricao: 'Internet', valor: null, vencimento: somaDias(HOJE, 80), categoria_id: null, meio: null }))]]
  const r = await msg('a internet vence dia 28')
  assert.match(r, /mais de uma conta "Internet" em aberto/)
  assert.equal(conta('n-2').vencimento, somaDias(HOJE, 57))
})

await caso('encerrar_fixa: "cancelei a internet" tira a fixa e as contas em aberto; a paga fica no histórico', async () => {
  semearInternet()
  ia.regras = [[/cancelei a internet/, acoes(acao({ tipo_acao: 'encerrar_fixa', movimento: null, fixa_id: 'f2', descricao: 'Internet', valor: null, categoria_id: null, meio: null }))]]
  const r = await msg('cancelei a internet')
  assert.match(r, /Tirei Internet das contas fixas e as 3 contas em aberto dela/)
  assert.match(r, /DESFAZER/)
  assert.equal(fixasU1().some((f) => f.id === 'f2'), false)
  assert.deepEqual(contasF2().map((c) => c.id), ['n-paga'], 'só a paga sobrou')
  assert.equal(fixa('f1').valor, 900, 'o aluguel segue')
  assert.equal(fixa('fx-u2', U2).valor, 500, 'a fixa de outro cliente segue')
  assert.equal(conta('u2-c').valor, 500)
})

await caso('encerrar_fixa + DESFAZER: a fixa e as contas voltam idênticas (valor, vencimento, ligação)', async () => {
  semearInternet()
  const sem = (o: Record<string, unknown>) => JSON.stringify({ ...o, criado_em: undefined }) // o banco falso carimba criado_em ao reinserir
  const fixaAntes = sem(fixa('f2'))
  const contasAntes = JSON.stringify(contasF2().sort((a, b) => String(a.id).localeCompare(String(b.id))).map((c) => JSON.parse(sem(c))))
  ia.regras = [[/cancelei a internet/, acoes(acao({ tipo_acao: 'encerrar_fixa', movimento: null, fixa_id: 'f2', descricao: 'Internet', valor: null, categoria_id: null, meio: null }))], DESFAZER]
  await msg('cancelei a internet')
  const r = await msg('desfazer')
  assert.match(r, /Pronto, desfiz/)
  assert.equal(sem(fixa('f2')), fixaAntes)
  assert.equal(JSON.stringify(contasF2().sort((a, b) => String(a.id).localeCompare(String(b.id))).map((c) => JSON.parse(sem(c)))), contasAntes)
})

await caso('encerrar_fixa: conta que não está na frase ou fixa de outro cliente: pergunta e não apaga nada', async () => {
  semearInternet()
  ia.regras = [[/acabou/, acoes(acao({ tipo_acao: 'encerrar_fixa', movimento: null, fixa_id: 'f1', descricao: 'Aluguel', valor: null, categoria_id: null, meio: null }))]]
  assert.match(await msg('acabou aquilo'), /Você quer encerrar a conta fixa "Aluguel"\?/)
  ia.regras = [[/internet acabou/, acoes(acao({ tipo_acao: 'encerrar_fixa', movimento: null, fixa_id: 'fx-u2', descricao: 'Internet', valor: null, categoria_id: null, meio: null }))]]
  assert.match(await msg('a internet acabou'), /Qual conta fixa acabou\?/)
  assert.equal(fixasU1().length, 2)
  assert.equal(fixa('fx-u2', U2).valor, 500)
})

await caso('falha ao encerrar no meio: a fixa e as contas voltam (nada some pela metade)', async () => {
  semearInternet()
  const antes = JSON.stringify(contasF2().sort((a, b) => String(a.id).localeCompare(String(b.id))))
  ia.regras = [[/cancelei e gastei/, acoes(acao({ tipo_acao: 'encerrar_fixa', movimento: null, fixa_id: 'f2', descricao: 'Internet', valor: null, categoria_id: null, meio: null }), acao({ valor: 6 }))]]
  E.falharEscritaEm = 'lancamentos'
  await msg('cancelei e gastei 6 no pix')
  E.falharEscritaEm = null
  assert.ok(fixasU1().some((f) => f.id === 'f2'), 'a fixa voltou')
  assert.equal(JSON.stringify(contasF2().sort((a, b) => String(a.id).localeCompare(String(b.id)))), antes)
})

await caso('fixa a RECEBER: "a Joana me paga 300 todo dia 5" cria a fixa e as contas a receber', async () => {
  semear()
  ia.regras = [[/Joana me paga/, acoes(acao({ tipo_acao: 'recorrente', movimento: 'entrada', descricao: 'Joana', valor: 300, dia_do_mes: 5, categoria_id: 'vendas', meio: null }))]]
  const r = await msg('a Joana me paga 300 todo dia 5')
  assert.match(r, /Anotei a conta fixa: Joana de R\$ 300,00 todo dia 5/)
  const nova = fixasU1().find((f) => f.descricao === 'Joana')!
  assert.equal(Number(nova.valor), 300)
  const cs = E.tabelas.contas.filter((c) => c.fixa_id === nova.id)
  assert.equal(cs.length, 3)
  assert.ok(cs.every((c) => c.tipo === 'receber'), 'todas a receber')
})

fim()
