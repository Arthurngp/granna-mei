/**
 * Fase "Conversa sem falha", dois itens:
 *
 * - a pergunta em aberto só é apagada depois de dar certo (antes era apagada ANTES de processar: se a
 *   IA caísse nesse instante, o "2" seguinte chegava sem contexto);
 * - a correção herda o comprovante e a origem do lançamento original (antes nascia sem a foto e
 *   marcada como texto, e o arquivo ficava guardado mas solto).
 *   npx tsx test/pendente.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, msgFoto, NUM } from './_falsos.ts'

const pendente = () => (E.tabelas.conversas ?? []).find((c) => c.telefone === NUM)?.pendente as { tipo?: string; pergunta?: string } | null | undefined
// Sem o meio de pagamento e com mais de uma carteira, o próprio código pergunta "Pagou como?".
const PEDE_CONTA = acoes(acao({ valor: 12, descricao: 'Pão', meio: null }))

/* ---------------- pergunta em aberto ---------------- */

await caso('IA fora no meio: a pergunta em aberto NÃO se perde', async () => {
  ia.regras = [[/pão/, PEDE_CONTA]]
  const r = await msg('paguei 12 de pão')
  assert.match(r, /saiu de qual conta\?/)
  assert.equal(pendente()?.tipo, 'pergunta')

  // A IA cai justamente quando a pessoa responde "2".
  ia.queda = true
  const caiu = await msg('2')
  // Desde 19/11 a falha da IA tem recado próprio (a queda é classificada como "fora"); o que este
  // caso prova é que ela AVISA e não engole a pergunta.
  assert.match(caiu, /problema técnico aqui do meu lado|Deu um problema aqui do meu lado/, caiu)
  assert.equal(pendente()?.tipo, 'pergunta', 'a pergunta continua em aberto para a próxima tentativa')

  // Com a IA de volta, o "2" ainda faz sentido: é respondido contra a pergunta que ficou guardada.
  ia.queda = false
  const ok = await msg('2')
  assert.match(ok, /R\$ 12,00/)
  assert.equal(lancsU1().length, 1)
  assert.equal(lancsU1()[0].carteira_id, 'dinheiro', 'a resposta foi aplicada à pergunta certa')
})

await caso('deu certo: a pergunta sai do caminho', async () => {
  ia.regras = [[/pão/, PEDE_CONTA]]
  await msg('paguei 12 de pão')
  await msg('1')
  assert.ok(!pendente()?.tipo, 'não fica pergunta velha para a mensagem seguinte')
  assert.equal(lancsU1().length, 1)
})

await caso('pergunta nova gravada depois não é apagada por engano', async () => {
  ia.regras = [[/pão/, PEDE_CONTA]]
  await msg('paguei 12 de pão')
  await msg('1')
  ia.regras = [[/material/, acoes(acao({ valor: 30, descricao: 'Material', meio: null }))]]
  const r = await msg('comprei 30 de material')
  assert.match(r, /saiu de qual conta\?/)
  assert.equal(pendente()?.tipo, 'pergunta', 'a pergunta nova sobrevive à limpeza da anterior')
})

await caso('erro de verdade (banco de conversas fora) não engole a pergunta', async () => {
  ia.regras = [[/pão/, PEDE_CONTA]]
  await msg('paguei 12 de pão')
  assert.equal(pendente()?.tipo, 'pergunta')
  E.falharTabela = 'lancamentos'
  ia.regras = [[/pão/, acoes(acao({ valor: 12, descricao: 'Pão' }))]]
  const r = await msg('1')
  assert.match(r, /Deu um problema aqui do meu lado/)
  E.falharTabela = null
  assert.equal(pendente()?.tipo, 'pergunta', 'nada foi gravado, então a pergunta fica')
})

/* ---------------- correção mantém o comprovante ---------------- */

await caso('foto do comprovante e depois "não, foi 90": o corrigido mantém a foto', async () => {
  ia.regras = [[/Gasolina/i, acoes(acao({ valor: 50, descricao: 'Gasolina' }))]]
  await msgFoto('comprovante.jpg')
  const lanc = lancsU1()[0]
  assert.ok(lanc.anexo_path, 'o primeiro guardou o comprovante')
  assert.equal(lanc.origem, 'foto')
  const anexoOriginal = lanc.anexo_path

  // A 1a chamada classifica como correção; a 2a recebe "<texto anterior>\nCorreção: ..." e devolve o valor novo.
  ia.regras = [
    // A regra mais específica primeiro: a 2a chamada recebe "...\nCorreção: foi 90".
    [/Correção: foi 90/, acoes(acao({ valor: 90, descricao: 'Gasolina' }))],
    [/foi 90/, { intencao: 'corrigir', acoes: [], pergunta: null, correcao: 'foi 90', falta: null }],
  ]
  const r = await msg('não, foi 90')
  assert.match(r, /R\$ 90,00/)
  const corrigido = lancsU1()[0]
  assert.equal(lancsU1().length, 1, 'continua um lançamento')
  assert.equal(Number(corrigido.valor), 90)
  assert.equal(corrigido.anexo_path, anexoOriginal, 'o comprovante segue junto do lançamento corrigido')
  assert.equal(corrigido.origem, 'foto', 'e não vira "texto"')
})

await caso('correção de lançamento sem foto continua sem foto', async () => {
  ia.regras = [[/pão/, acoes(acao({ valor: 12, descricao: 'Pão' }))]]
  await msg('paguei 12 de pão')
  ia.regras = [
    [/Correção: foi 15/, acoes(acao({ valor: 15, descricao: 'Pão' }))],
    [/foi 15/, { intencao: 'corrigir', acoes: [], pergunta: null, correcao: 'foi 15', falta: null }],
  ]
  await msg('não, foi 15')
  const l = lancsU1()[0]
  assert.equal(Number(l.valor), 15)
  assert.equal(l.anexo_path ?? null, null)
  assert.equal(l.origem, 'texto')
})

/* ---------------- conta que a pessoa usou e não tem cadastrada ---------------- */

await caso('insistir numa conta que não existe não deixa a pessoa sem saída', async () => {
  // O caso do Matheus (cliente real, 16/11/2026): ele pagou com um cartão que não tinha cadastrado,
  // respondeu "foi no cartão de débito dentro do cartão C6 Bank" e recebeu a MESMA pergunta. Insistiu
  // uma vez e desistiu; o gasto dele nunca foi registrado.
  const SEM_CONTA = acoes(acao({ valor: 33.58, descricao: 'Compras mercado', meio: null, carteira_id: null }))
  ia.regras = [[/mercado|C6|debito|débito/i, SEM_CONTA]]

  const primeira = await msg('paguei 33,58 no mercado')
  assert.match(primeira, /saiu de qual conta\?/, 'ela pergunta a conta, porque há mais de uma')
  assert.match(primeira, /Cadastre em .*\/ajustes/, 'e já diz o caminho para quem usou outra conta')

  // A pessoa insiste no nome da conta que ela usa de verdade.
  const segunda = await msg('foi no cartão de débito dentro do cartão C6 Bank')
  assert.match(segunda, /Cadastre em .*\/ajustes/, 'a saída continua à vista quando ela insiste')
  assert.equal(lancsU1().length, 0, 'nada é gravado enquanto a conta não é escolhida')

  // E escolher pelo número continua funcionando.
  const terceira = await msg('2')
  assert.match(terceira, /R\$ 33,58/)
  assert.equal(lancsU1().length, 1)
})

await caso('a saída aparece também quando é entrada de dinheiro', async () => {
  ia.regras = [[/recebi/, acoes(acao({ valor: 80, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Venda', meio: null, carteira_id: null }))]]
  const r = await msg('recebi 80 de venda')
  assert.match(r, /caiu em qual conta\?/)
  assert.match(r, /Cadastre em .*\/ajustes/)
})

fim()
