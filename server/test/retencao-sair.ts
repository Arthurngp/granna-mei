/**
 * SAIR: quem responde SAIR a um lembrete nunca mais recebe lembrete de uso. É um pedido que se honra SEMPRE: antes de bloqueio,
 * limite, pendência e IA, e nunca com "pronto" sem ter gravado. Fluxo completo da mensagem, com banco e IA falsos.
 *   npx tsx test/retencao-sair.ts
 */
import assert from 'node:assert/strict'

// Antes de importar o fluxo: o limite é lido na hora, mas deixa o teste de limite estourado barato.
process.env.LIMITE_LANCAMENTOS = '3'
const { acao, acoes, caso, E, fim, ia, msg, msgCompleta, U1 } = await import('./_falsos.ts')
const { TEXTO_SAIR } = await import('../src/retencao.ts')

const perfil = () => E.tabelas.perfis.find((p) => p.id === U1)!
const chamadasIA = () => Object.values(ia.chamadas).reduce((s, n) => s + n, 0)

function semearUso(n: number) {
  const agora = new Date().toISOString()
  E.tabelas.mensagens ??= []
  for (let i = 0; i < n; i++) E.tabelas.mensagens.push({ id: `uso-${i}`, user_id: U1, telefone: '5581988887777', texto: `t${i}`, resposta: 'r', status: 'ok', tipo: 'texto', criado_em: agora })
}

await caso('SAIR: grava o pedido, responde dizendo o que para e o que continua, e não chama a IA', async () => {
  assert.notEqual(perfil().avisos_off, true)
  const r = await msgCompleta('SAIR')
  assert.equal(r.resposta, TEXTO_SAIR)
  assert.equal(perfil().avisos_off, true, 'gravou no perfil')
  assert.equal(chamadasIA(), 0, 'nenhuma chamada de IA: é um comando, não uma conversa')
  assert.match(r.resposta, /não vou mais te mandar lembretes/i)
  assert.match(r.resposta, /avisos de conta vencendo.*continuam/i)
})

await caso('SAIR em minúscula, com acento e com pontuação também vale', async () => {
  for (const texto of ['sair', 'Sair.', ' SAIR! ', 'sáir']) {
    E.tabelas.perfis.find((p) => p.id === U1)!.avisos_off = false
    const r = await msg(texto)
    assert.equal(r, TEXTO_SAIR, JSON.stringify(texto))
    assert.equal(perfil().avisos_off, true, JSON.stringify(texto))
  }
})

await caso('SAIR vale mesmo com a conta bloqueada (pedido se honra sempre)', async () => {
  E.tabelas.assinaturas.find((a) => a.user_id === U1)!.status = 'bloqueada'
  const r = await msg('SAIR')
  assert.equal(r, TEXTO_SAIR)
  assert.equal(perfil().avisos_off, true)
})

await caso('SAIR vale mesmo com o limite do mês estourado', async () => {
  semearUso(3)
  const r = await msg('SAIR')
  assert.equal(r, TEXTO_SAIR)
  assert.equal(perfil().avisos_off, true)
})

await caso('a resposta do SAIR não conta como lançamento no limite do mês', async () => {
  await msg('SAIR')
  const linhas = E.tabelas.mensagens.filter((m) => m.user_id === U1)
  assert.ok(linhas.length >= 1)
  assert.ok(linhas.every((m) => m.status !== 'ok'), 'status "pergunta", não "ok" (que contaria como lançamento)')
})

await caso('frase que só contém a palavra NÃO é SAIR: "quero sair do plano" segue para a conversa e não silencia nada', async () => {
  ia.regras = []
  for (const texto of ['quero sair do plano', 'sair e voltar', 'não quero sair']) {
    await msg(texto)
    assert.notEqual(perfil().avisos_off, true, JSON.stringify(texto))
  }
})

await caso('se não conseguir gravar, NUNCA responde "pronto": vira erro, e o pedido não fica marcado como feito', async () => {
  E.falharEscritaEm = 'perfis'
  const r = await msgCompleta('SAIR')
  assert.equal(r.status, 'erro')
  assert.notEqual(r.resposta, TEXTO_SAIR)
  assert.doesNotMatch(r.resposta, /não vou mais te mandar lembretes/i)
  assert.notEqual(perfil().avisos_off, true)
})

await caso('depois do SAIR a conversa normal continua funcionando', async () => {
  await msg('SAIR')
  ia.regras = [[/luz/, acoes(acao({ valor: 89, descricao: 'Luz' }))]]
  const r = await msg('paguei 89 de luz')
  assert.match(r, /89/)
})

fim()
