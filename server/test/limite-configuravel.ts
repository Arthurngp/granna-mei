/**
 * O limite mensal de lançamentos é configurável no admin: um PADRÃO para todos e um valor PRÓPRIO por cliente.
 * Aqui se prova a ordem (próprio, padrão, ambiente), que valor quebrado nunca vira zero, que uma falha de leitura não derruba o
 * atendimento e que o fluxo da mensagem usa o limite DO CLIENTE (não o de fábrica). Sem banco e sem IA reais.
 * Rodar: npx tsx test/limite-configuravel.ts
 */
import assert from 'node:assert/strict'

delete process.env.LIMITE_LANCAMENTOS
const { acao, acoes, caso, E, fim, ia, msg, pedidos, U1, U2 } = await import('./_falsos.ts')
const { limiteDoCliente, limiteDoAmbiente, limiteValido, limparCacheDoLimite, LIMITE_DE_FABRICA } = await import('../src/limite.ts')

/** Cada caso começa sem cache e sem variável de ambiente, como um processo recém-iniciado. */
const novo = (nome: string, fn: () => Promise<void>) =>
  caso(nome, async () => {
    limparCacheDoLimite()
    delete process.env.LIMITE_LANCAMENTOS
    await fn()
  })

const padrao = (n: unknown) => (E.tabelas.config_limite = [{ id: true, lancamentos: n }])
const proprio = (user: string, n: unknown) => (E.tabelas.limite_cliente = [...(E.tabelas.limite_cliente ?? []), { user_id: user, lancamentos: n, motivo: 'teste' }])
const gets = (tabela: string) => pedidos.filter((p) => p === `GET ${tabela}`).length

function semearUso(lancamentos: number) {
  const agora = new Date().toISOString()
  E.tabelas.mensagens ??= []
  for (let i = 0; i < lancamentos; i++) E.tabelas.mensagens.push({ id: `uso-${i}`, user_id: U1, telefone: '5581988887777', texto: `t${i}`, resposta: 'r', status: 'ok', tipo: 'texto', criado_em: agora })
}
const LUZ = acoes(acao({ valor: 89, descricao: 'Luz' }))

await novo('banco sem nenhuma linha: vale o de fábrica (300), ou a variável de ambiente', async () => {
  assert.deepEqual(await limiteDoCliente(U1), { limite: LIMITE_DE_FABRICA, fonte: 'ambiente' })
  process.env.LIMITE_LANCAMENTOS = '10'
  assert.deepEqual(await limiteDoCliente(U1), { limite: 10, fonte: 'ambiente' })
})

await novo('variável de ambiente vazia, zero, negativa ou quebrada NUNCA vira limite zero', async () => {
  for (const v of ['', ' ', '0', '-5', 'abc', '1.5', '100001', 'NaN']) {
    process.env.LIMITE_LANCAMENTOS = v
    assert.equal(limiteDoAmbiente(), LIMITE_DE_FABRICA, `variável ${JSON.stringify(v)}`)
  }
  assert.equal(limiteValido(0), null)
  assert.equal(limiteValido(-1), null)
  assert.equal(limiteValido(2.5), null)
  assert.equal(limiteValido(null), null)
  assert.equal(limiteValido('7'), 7)
})

await novo('o padrão do banco vale para todos os clientes e vence o ambiente', async () => {
  process.env.LIMITE_LANCAMENTOS = '10'
  padrao(4)
  assert.deepEqual(await limiteDoCliente(U1), { limite: 4, fonte: 'padrao' })
  assert.deepEqual(await limiteDoCliente(U2), { limite: 4, fonte: 'padrao' })
})

await novo('o limite próprio vence o padrão, e só para aquele cliente', async () => {
  padrao(4)
  proprio(U1, 2)
  assert.deepEqual(await limiteDoCliente(U1), { limite: 2, fonte: 'cliente' })
  assert.deepEqual(await limiteDoCliente(U2), { limite: 4, fonte: 'padrao' }, 'o outro segue o padrão')
})

await novo('valor quebrado no banco é ignorado e cai no nível de baixo (nunca zero)', async () => {
  process.env.LIMITE_LANCAMENTOS = '10'
  padrao(7)
  proprio(U1, 0)
  assert.deepEqual(await limiteDoCliente(U1), { limite: 7, fonte: 'padrao' }, 'próprio 0 não vale: segue o padrão')
  limparCacheDoLimite()
  padrao(-3)
  assert.deepEqual(await limiteDoCliente(U1), { limite: 10, fonte: 'ambiente' }, 'padrão negativo também não vale')
})

await novo('o banco falha: usa o de fábrica e a Granninha segue anotando (não vira erro)', async () => {
  process.env.LIMITE_LANCAMENTOS = '10'
  E.falharTabela = 'limite_cliente'
  assert.deepEqual(await limiteDoCliente(U1), { limite: 10, fonte: 'ambiente' })
  ia.regras = [[/luz/, LUZ]]
  const r = await msg('paguei 89 de luz')
  assert.match(r, /89/, `anotou normalmente: ${r}`)
  assert.equal(E.tabelas.lancamentos.filter((l) => l.user_id === U1 && l.descricao === 'Luz').length, 1)
})

await novo('depois de uma falha não insiste por um minuto, e volta a ler quando o cache é limpo', async () => {
  padrao(4)
  E.falharTabela = 'limite_cliente'
  await limiteDoCliente(U1)
  const antes = gets('limite_cliente')
  await limiteDoCliente(U1)
  await limiteDoCliente(U1)
  assert.equal(gets('limite_cliente'), antes, 'não bateu no banco de novo durante a pausa')
  E.falharTabela = null
  limparCacheDoLimite()
  assert.deepEqual(await limiteDoCliente(U1), { limite: 4, fonte: 'padrao' }, 'voltou a ler')
})

await novo('o padrão fica em cache: uma consulta só, e a mudança vale quando o cache vence', async () => {
  padrao(4)
  const antes = gets('config_limite')
  assert.equal((await limiteDoCliente(U1)).limite, 4)
  assert.equal((await limiteDoCliente(U2)).limite, 4)
  assert.equal(gets('config_limite') - antes, 1, 'duas mensagens, uma leitura do padrão')
  E.tabelas.config_limite[0].lancamentos = 9
  assert.equal((await limiteDoCliente(U1)).limite, 4, 'ainda o do cache')
  limparCacheDoLimite()
  assert.equal((await limiteDoCliente(U1)).limite, 9, 'valeu a mudança')
})

await novo('no fluxo da mensagem: o limite PRÓPRIO barra o cliente mesmo com o padrão folgado', async () => {
  padrao(50)
  proprio(U1, 2)
  semearUso(2)
  ia.regras = [[/luz/, LUZ]]
  const r = await msg('paguei 89 de luz')
  assert.match(r, /limite de uso deste mês/, `barrou: ${r}`)
  assert.equal(E.tabelas.lancamentos.filter((l) => l.user_id === U1 && l.descricao === 'Luz').length, 0, 'e não anotou')
})

await novo('no fluxo da mensagem: sem limite próprio, o mesmo uso passa pelo padrão folgado', async () => {
  padrao(50)
  semearUso(2)
  ia.regras = [[/luz/, LUZ]]
  assert.match(await msg('paguei 89 de luz'), /89/)
})

await novo('no fluxo da mensagem: baixar o padrão barra quem já passou, e o limite próprio mantém o cliente liberado', async () => {
  padrao(3)
  semearUso(3)
  ia.regras = [[/luz/, LUZ]]
  assert.match(await msg('paguei 89 de luz'), /limite de uso deste mês/, 'padrão 3 e uso 3: barrado')
  limparCacheDoLimite()
  proprio(U1, 100)
  assert.match(await msg('paguei 89 de luz'), /89/, 'com limite próprio de 100, segue anotando')
})

await novo('o aviso de "perto do limite" sai a 80% do limite DO CLIENTE, não do de fábrica', async () => {
  padrao(300)
  proprio(U1, 5) // 80% de 5 = 4: o lançamento que fecha 4 leva o aviso
  semearUso(3)
  ia.regras = [[/luz/, LUZ]]
  const r = await msg('paguei 89 de luz')
  assert.match(r, /89/)
  assert.match(r, /Só um aviso: você tá chegando perto do limite/, `traz o aviso: ${r}`)
})

fim()
