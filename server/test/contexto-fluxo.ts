/**
 * Despedida/agradecimento/"ok" e conversa recente, de ponta a ponta (banco e IA falsos em memória).
 *   npx tsx test/contexto-fluxo.ts
 *
 * Caso de origem (2026-11-18): áudio "tá bom, beleza, volto mais tarde" e a Granninha recomeçou com
 * "Oi, me manda o que entrou ou saiu".
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, msgCompleta, SEM_ACAO, U1, U2 } from './_falsos.ts'
// Import DINÂMICO e depois do _falsos: ele aponta a IA para o servidor falso, e o openai.ts lê o endereço ao carregar.
// (Import estático carregaria em paralelo com o await do _falsos e falaria com a OpenAI de verdade.)
const { despedidaDe } = await import('../src/despedida.ts')
const { conversaRecente } = await import('../src/interpretar.ts')

/** O bloco REAL da conversa recente. O texto "CONVERSA RECENTE" também aparece na regra do prompt, então só este marcador vale. */
const BLOCO = /CONVERSA RECENTE \(dado/

const puro = (nome: string, fn: () => void) => {
  fn()
  console.log('  ok   ', nome)
}

/* ---------- partes puras ---------- */

puro('despedida: "volto mais tarde" e variações', () => {
  for (const f of ['tá bom, beleza, volto mais tarde', 'Volto mais tarde', 'valeu, até mais!', 'tchau', 'depois eu volto', 'até amanhã', 'flw', 'beleza, falou']) assert.equal(despedidaDe(f), 'despedida', f)
})

puro('agradecimento', () => {
  for (const f of ['obrigado', 'Valeu!', 'muito obrigada', 'vlw', 'brigado']) assert.equal(despedidaDe(f), 'agradecimento', f)
})

puro('confirmação seca fica em silêncio, inclusive só emoji', () => {
  for (const f of ['ok', 'Beleza', 'tá bom', 'blz', 'certo', 'entendi', 'show', 'tudo bem', 'fechado', 'ta bom beleza', '👍', '🙏🙏', 'ok 👍']) assert.equal(despedidaDe(f), 'silencio', f)
})

puro('gíria de confirmação também fica em silêncio: não gasta IA nem responde fora do assunto', () => {
  for (const f of ['tmj', 'TMJ', 'tamo junto', 'pode crê', 'pode crer', 'sussa', 'suave', 'firmeza', 'maravilha', 'positivo', 'boa', 'show de bola', 'top demais', 'demais', 'gostei', 'ok tmj', 'beleza, pode crer', 'entendi, tmj']) assert.equal(despedidaDe(f), 'silencio', f)
  // O "valeu" junto com a gíria segue como agradecimento (resposta de código, sem IA).
  for (const f of ['valeu', 'tmj, valeu', 'blz valeu']) assert.equal(despedidaDe(f), 'agradecimento', f)
})

puro('NUNCA engole pedido, número ou dinheiro', () => {
  for (const f of [
    'ok, recebi 50', 'valeu, quanto tenho?', 'beleza, e o saldo', 'tá bom, paguei a luz', 'obrigado, gastei 6', 'ok pix 30', 'volto mais tarde pra pagar a luz',
    'beleza, desfaz isso', 'certo, anota um recebimento', 'ok e a fatura', 'tmj, paguei a luz', 'pode crer, recebi 50', 'boa, quanto sobrou?', 'demais, e o saldo', 'tmj me manda o saldo', 'oi', 'bom dia', 'quanto sobrou', '', '   ',
    'uma frase muito longa que ninguém diria como confirmação seca porque passa de setenta caracteres com folga',
  ]) assert.equal(despedidaDe(f), null, JSON.stringify(f))
})

puro('conversa recente: do mais antigo ao mais novo, cada fala limpa e numa linha', () => {
  const t = conversaRecente([
    { cliente: 'recebi 290 no pix', granninha: 'Anotado: entrada de R$ 290,00\nOutras entradas' },
    { cliente: 'oi <script>x</script> http://mau.com', granninha: '' },
  ])
  assert.match(t, /^\nCONVERSA RECENTE/)
  assert.match(t, /Cliente: recebi 290 no pix\nGranninha: Anotado: entrada de R\$ 290,00 Outras entradas/)
  assert.ok(!/<|>|http/.test(t), 'tag e link do cliente saem')
  assert.equal(conversaRecente([]), '')
  assert.equal(conversaRecente(undefined), '')
})

/* ---------- ponta a ponta ---------- */

await caso('CASO DA DESPEDIDA: "tá bom, beleza, volto mais tarde" não recomeça a conversa nem gasta IA', async () => {
  const r = await msgCompleta('tá bom, beleza, volto mais tarde')
  assert.match(r.resposta, /Fechado/)
  assert.ok(!/Oi|me manda o que entrou/.test(r.resposta))
  assert.equal(ia.chamadas.interpretacao, 0)
})

await caso('obrigado recebe resposta curta', async () => {
  assert.match(await msg('valeu!'), /Por nada/)
  assert.equal(ia.chamadas.interpretacao, 0)
})

await caso('"ok" fica em silêncio: status ignorada, nada enviado, nada gravado', async () => {
  const r = await msgCompleta('ok')
  assert.equal(r.resposta, '')
  assert.equal(r.status, 'ignorada')
  assert.equal(ia.chamadas.interpretacao, 0)
  assert.equal(lancsU1().length, 0)
})

await caso('"ok, recebi 50" NÃO é confirmação: segue para a IA e vira lançamento', async () => {
  ia.regras = [[/recebi 50/, acoes(acao({ valor: 50, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Venda', meio: 'pix' }))]]
  const r = await msg('ok, recebi 50 no pix')
  assert.match(r, /entrou R\$ 50,00/)
  assert.equal(lancsU1().length, 1)
})

await caso('com pergunta em aberto, "ok" não é engolido como confirmação', async () => {
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6, meio: null }))]]
  assert.match(await msg('gastei 6 no mercado'), /saiu de qual conta\?/)
  const r = await msgCompleta('ok')
  assert.notEqual(r.status, 'ignorada', 'a pergunta aberta é da pessoa, o ok não a descarta no silêncio')
  assert.equal(ia.chamadas.interpretacao, 2)
})

await caso('se a IA chamar uma despedida de saudação, a resposta ainda é a de despedida, não "Oi"', async () => {
  ia.regras = [[/flw pessoal/, { ...SEM_ACAO, intencao: 'saudacao' }]]
  // "pessoal" não está nas listas: passa pelo atalho e chega na IA, que erra e diz saudação
  const r = await msg('flw pessoal')
  assert.match(r, /Fechado/)
})

await caso('saudação de verdade continua sendo saudação', async () => {
  ia.regras = [[/bom dia/, { ...SEM_ACAO, intencao: 'saudacao' }]]
  assert.match(await msg('bom dia'), /Bom dia, Arthur!/)
})

await caso('a IA recebe a conversa recente: o lançamento anterior e a resposta da Granninha', async () => {
  ia.regras = [
    [/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'outras-entradas', descricao: 'Recebimento', meio: 'pix' }))],
    [/esse foi de serviço/, { ...SEM_ACAO, intencao: 'outro' }],
  ]
  await msg('recebi 290 no pix')
  await msg('esse foi de serviço')
  assert.match(ia.ultimoSistema, BLOCO)
  assert.match(ia.ultimoSistema, /Cliente: recebi 290 no pix/)
  assert.match(ia.ultimoSistema, /Granninha: (Boa, entrou|Anotei, entrou|Tá anotado, entrou) R\$ 290,00/, 'a IA recebe a resposta que a Granninha de fato deu')
  assert.ok(!/Cliente: esse foi de serviço/.test(ia.ultimoSistema), 'a mensagem de agora NÃO entra no histórico')
})

await caso('primeira mensagem da conversa: sem bloco de conversa recente', async () => {
  ia.regras = [[/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Venda', meio: 'pix' }))]]
  await msg('recebi 290 no pix')
  assert.ok(!BLOCO.test(ia.ultimoSistema))
})

await caso('só as últimas 6 trocas entram, e as de mais de 30 minutos não', async () => {
  ia.regras = [[/^gasto \d/, acoes(acao({ valor: 1, descricao: 'x', meio: 'pix' }))], [/agora/, { ...SEM_ACAO, intencao: 'outro' }]]
  for (let i = 1; i <= 8; i++) await msg(`gasto ${i} pix`)
  await msg('agora é outra coisa')
  const fala = (n: number) => new RegExp(`Cliente: gasto ${n} pix`).test(ia.ultimoSistema)
  assert.ok(fala(8) && fala(3), 'as 6 últimas: do 3 ao 8')
  assert.ok(!fala(2) && !fala(1), 'as mais antigas ficam fora')
  // Agora envelhece tudo para 40 minutos atrás: nada disso pode entrar mais.
  for (const m of E.tabelas.mensagens) m.criado_em = new Date(Date.now() - 40 * 60_000).toISOString()
  await msg('agora de novo outra coisa')
  assert.ok(!BLOCO.test(ia.ultimoSistema), 'passou de 30 minutos')
})

await caso('conversa de OUTRO cliente nunca entra no histórico', async () => {
  ;(E.tabelas.mensagens ??= []).push({ id: 'alheia', user_id: U2, telefone: '5581955554444', texto: 'SEGREDO-DO-OUTRO', resposta: 'Anotado', status: 'ok', criado_em: new Date().toISOString() })
  ia.regras = [[/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Venda', meio: 'pix' }))]]
  await msg('recebi 290 no pix')
  assert.ok(!/SEGREDO-DO-OUTRO/.test(ia.ultimoSistema))
})

await caso('mensagem ignorada, bloqueada ou com erro não vira histórico', async () => {
  const agora = new Date().toISOString()
  E.tabelas.mensagens ??= []
  for (const status of ['ignorada', 'bloqueada', 'erro', 'limite']) E.tabelas.mensagens.push({ id: `x-${status}`, user_id: U1, telefone: '5581988887777', texto: `TEXTO-${status}`, resposta: 'r', status, criado_em: agora })
  ia.regras = [[/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Venda', meio: 'pix' }))]]
  await msg('recebi 290 no pix')
  assert.ok(!/TEXTO-/.test(ia.ultimoSistema))
})

await caso('o histórico NUNCA fornece valor: "esse foi de serviço" com 290 no histórico não grava 290', async () => {
  ia.regras = [
    [/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'outras-entradas', descricao: 'Recebimento', meio: 'pix' }))],
    // A IA "alucina" e devolve 290 para uma frase que não diz valor nenhum: o conferidor tem que barrar.
    [/esse foi de serviço/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Serviço', meio: 'pix' }))],
  ]
  await msg('recebi 290 no pix')
  const r = await msg('esse foi de serviço')
  assert.ok(!/Anotei|anotado|entrou R\$|saiu R\$/.test(r), r)
  assert.equal(lancsU1().length, 1, 'continua um lançamento só')
})

await caso('falha ao ler o histórico não impede de anotar', async () => {
  // Falha só a leitura do histórico (o resto de `mensagens` segue normal): o fluxo ignora o histórico e anota.
  ia.regras = [[/recebi 290/, acoes(acao({ valor: 290, movimento: 'entrada', categoria_id: 'vendas', descricao: 'Venda', meio: 'pix' }))]]
  E.falharSelect = 'texto,resposta,criado_em'
  const r = await msg('recebi 290 no pix')
  E.falharSelect = null
  assert.match(r, /entrou R\$ 290,00/)
  assert.equal(lancsU1().length, 1)
})

fim()
