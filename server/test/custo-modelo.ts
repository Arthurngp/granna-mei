/**
 * Custo pelo modelo que RODOU (precos.ts). Pedido do Arthur em 2026-11-25: "eu quero que seja real e aplicado a escolha de llm, não pode ficar errado".
 * Prova que cada mensagem grava o modelo que respondeu, marca quando o escolhido falhou e o de fábrica respondeu, e calcula o custo pelo preço dele.
 * Banco e IA falsos, processar() de verdade.
 *   npx tsx test/custo-modelo.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, msg, semear } from './_falsos.ts'

const cfg = await import('../src/ia-config.ts')
const P = await import('../src/precos.ts')
const { limparCacheIA, MODELO_FABRICA } = cfg

const ultima = () => [...(E.tabelas.mensagens ?? [])].pop() as Record<string, any>
const global = (tarefa: string, modelo: string) => (E.tabelas.config_ia_modelo = [...(E.tabelas.config_ia_modelo ?? []), { tarefa, modelo }])
function novo() {
  semear()
  limparCacheIA()
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6 }))]]
}

await caso('pura: preço de cada modelo, com desconto do cache', async () => {
  const c = { tarefa: 'interpretacao', modelo: 'gpt-4.1-mini', entrada: 3000, saida: 200, cache: 1000 }
  // 2000 x 0,40 + 1000 x 0,10 + 200 x 1,60 = 800 + 100 + 320 = 1220 por milhão
  assert.equal(P.custoUsd([c]), 0.00122)
  assert.equal(P.custoUsd([{ tarefa: 'interpretacao', modelo: 'claude-haiku-5-5', entrada: 3000, saida: 200 }]), 0.0004)
  assert.equal(P.custoUsd([{ tarefa: 'audio', modelo: 'whisper-1', entrada: 0, saida: 0, audioSeg: 30 }]), 0.003)
})

await caso('pura: modelo fora da tabela é contado pelo mais caro do provedor e marcado', async () => {
  const c: any = { tarefa: 'interpretacao', modelo: 'gpt-9-turbo', entrada: 1000, saida: 0 }
  P.custoUsd([c])
  assert.equal(c.sem_preco, true)
  assert.equal(P.precoDe('gpt-9-turbo').preco.saida, 30, 'deveria usar o mais caro da OpenAI (gpt-5.5)')
})

await caso('a mensagem grava o modelo que rodou e o custo pelo preço dele (não pelo do gpt-5.4-mini)', async () => {
  novo()
  global('interpretacao', 'gpt-4.1-mini')
  await msg('gastei 6 no pix')
  const m = ultima()
  assert.ok(Array.isArray(m.ia_chamadas) && m.ia_chamadas.length >= 1, 'não gravou as chamadas: ' + JSON.stringify(m))
  assert.equal(m.ia_chamadas[0].modelo, 'gpt-4.1-mini')
  assert.equal(m.ia_chamadas[0].pedido, undefined)
  const esperado = P.custoUsd(m.ia_chamadas.map((x: any) => ({ ...x })))
  assert.equal(Number(m.custo_usd), esperado)
  const comoMini = P.custoUsd(m.ia_chamadas.map((x: any) => ({ ...x, modelo: 'gpt-5.4-mini' })))
  assert.ok(Number(m.custo_usd) < comoMini, 'o custo saiu igual ao do gpt-5.4-mini')
})

await caso('modelo escolhido recusado (ex.: gpt-4.1-nano, desligado): grava que o de fábrica respondeu NO LUGAR dele, e cobra o de fábrica', async () => {
  novo()
  global('interpretacao', 'gpt-4.1-nano')
  ia.recusarModelos.add('gpt-4.1-nano')
  await msg('gastei 6 no pix')
  const c = ultima().ia_chamadas[0]
  assert.equal(c.modelo, MODELO_FABRICA)
  assert.equal(c.pedido, 'gpt-4.1-nano')
  ia.recusarModelos.delete('gpt-4.1-nano')
})

await caso('banco sem a migration (coluna não existe): a mensagem é gravada como antes, sem quebrar', async () => {
  novo()
  E.recusarColuna = 'custo_usd'
  const r = await msg('gastei 6 no pix')
  assert.match(r, /R\$ 6,00/)
  const m = ultima()
  assert.equal(m.status, 'ok')
  assert.ok(m.tokens_entrada > 0, 'perdeu os tokens')
  assert.equal(m.custo_usd, undefined)
  E.recusarColuna = null
})

fim()
