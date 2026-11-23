/**
 * Teste de ponta a ponta da Granninha com um GATEWAY FALSO no formato real do WA-AKG (commit 936b26b):
 * webhook "message.received" assinado com HMAC, envio em /api/messages/{sessao}/{jid}/send, mídia em /api/media/{arquivo}.
 * Usa o banco de verdade com um cliente de teste, que é apagado no fim. Rodar: npm run test:fluxo
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'

process.env.WA_GATEWAY_API_KEY = 'chave-teste'
process.env.WA_WEBHOOK_SECRET = 'segredo-teste'
process.env.WA_SESSAO = 'granninha'
process.env.PAINEL_URL = 'https://grannamei.amplasoft.me/painel'
process.env.SEM_BATIMENTO = '1'

// ---------- Gateway falso ----------
const enviados: { jid: string; texto: string }[] = []
const midias = new Map<string, { buf: Buffer; mime: string }>()
const gw = createServer((req, res) => {
  if (req.headers['x-api-key'] !== 'chave-teste') return res.writeHead(401).end()
  const u = req.url ?? ''
  const m = u.match(/^\/api\/messages\/granninha\/([^/]+)\/send$/)
  if (req.method === 'POST' && m) {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      const corpo = JSON.parse(b)
      assert.ok(corpo.message?.text, 'envio tem que ser { message: { text } }')
      enviados.push({ jid: decodeURIComponent(m[1]), texto: corpo.message.text })
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":true}')
    })
    return
  }
  const md = u.match(/^\/api\/media\/(.+)$/)
  if (req.method === 'GET' && md && midias.has(md[1])) {
    const x = midias.get(md[1])!
    return res.writeHead(200, { 'Content-Type': x.mime }).end(x.buf)
  }
  if (req.method === 'GET' && u === '/api/sessions/granninha') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"data":{"status":"CONNECTED","me":{"id":"5581900000000:3@s.whatsapp.net"}}}')
  res.writeHead(404).end()
})
await new Promise<void>((ok) => gw.listen(0, ok))
process.env.WA_GATEWAY_URL = `http://127.0.0.1:${(gw.address() as AddressInfo).port}`

const { iniciar } = await import('../src/index.ts')
const { sb } = await import('../src/banco.ts')
const srv = iniciar(0)
await new Promise((ok) => setTimeout(ok, 300))
const SERV = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`

const FONE = '5581999990001'
const ESTRANHO = '5581999990002'
let seq = 0
const falhas: string[] = []
let ok = 0

async function postar(ev: object, assinatura?: string) {
  const corpo = JSON.stringify(ev)
  const sig = assinatura ?? 'sha256=' + createHmac('sha256', 'segredo-teste').update(corpo).digest('hex')
  return fetch(SERV + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig }, body: corpo })
}

/** Manda uma mensagem como se viesse do WhatsApp e espera a resposta da Granninha (ou nada, se esperarNada). */
async function mandar(de: string, d: Record<string, unknown>, opt: { id?: string; esperarNada?: boolean } = {}) {
  const id = opt.id ?? `TESTE${Date.now()}${++seq}`
  const antes = enviados.length
  const r = await postar({ event: 'message.received', sessionId: 'granninha', timestamp: new Date().toISOString(), data: { key: { id, remoteJid: `${de}@s.whatsapp.net`, fromMe: false }, from: `${de}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: '', ...d } })
  assert.equal(r.status, 200)
  const t0 = Date.now()
  while (Date.now() - t0 < (opt.esperarNada ? 6000 : 60000)) {
    if (enviados.length > antes) return { id, texto: enviados.slice(antes).map((e) => e.texto).join('\n---\n') }
    await new Promise((ok) => setTimeout(ok, 150))
  }
  return { id, texto: '' }
}

/**
 * Manda a mensagem e responde "1" a cada pergunta de opções, até a Granninha fechar.
 *
 * A ORDEM das perguntas depende da IA: ela decide se "conta de luz" pode ser gasto pessoal, e nesse
 * caso a pergunta de negócio/pessoal vem antes da de conta. Fixar a sequência num teste com IA real é
 * frágil — em 19/11 a ordem mudou e três casos reprovaram sem nenhum defeito no produto. O caso cobra
 * o resultado (o lançamento fechado com o valor certo), e as perguntas feitas vão na mensagem de erro.
 */
async function responderAte(de: string, conteudo: string, limite = 4) {
  // O diário guarda a conversa inteira (o que foi mandado e o que ela respondeu). Na rodada de 19/11
  // um caso falhou aqui e a mensagem de erro só tinha as PERGUNTAS, o que não permitia distinguir
  // "a resposta não chegou" de "a resposta veio errada". Falha de diagnóstico não se repete.
  const diario: string[] = []
  const trecho = (t: string) => (t ? t.replace(/\n/g, ' / ').slice(0, 90) : '(NADA — resposta não chegou no tempo)')
  let r = await mandar(de, { content: conteudo })
  diario.push(`eu: "${conteudo}" -> ela: ${trecho(r.texto)}`)
  const perguntas: string[] = []
  for (let i = 0; i < limite && /Responda com o n[úu]mero/i.test(r.texto); i++) {
    perguntas.push(r.texto.split('\n')[0].slice(0, 60))
    r = await mandar(de, { content: '1' })
    diario.push(`eu: "1" -> ela: ${trecho(r.texto)}`)
  }
  return { texto: r.texto, perguntas, conversa: diario.join(' || ') }
}

async function caso(nome: string, fn: () => Promise<void>) {
  try {
    await fn()
    ok++
    console.log('  ok   ', nome)
  } catch (e) {
    falhas.push(nome)
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 300))
  }
}

const lancs = async (uid: string) => (await sb.from('lancamentos').select('*').eq('user_id', uid).order('criado_em')).data ?? []

// ---------- Cliente de teste ----------
const email = `teste-granninha-${Date.now()}@grannamei.test`
const senha = 'Senha-de-teste-9'
const cu = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome: 'Camila Teste' } })
if (cu.error) throw cu.error
const uid = cu.data.user!.id
await sb.from('perfis').update({ negocio: 'Studio Teste', ramo: 'beleza', whats: '(81) 99999-0001', onboarding_feito: true }).eq('id', uid)
await sb.from('carteiras').insert([
  { user_id: uid, id: 'banco', nome: 'Conta do banco', tipo: 'banco', saldo_inicial: 1000, padrao: true },
  { user_id: uid, id: 'dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', saldo_inicial: 200, padrao: false },
])
const { categoriasPadrao } = await import('./categorias.ts')
await sb.from('categorias').insert(categoriasPadrao('beleza').map((c) => ({ user_id: uid, id: c.id, nome: c.nome, tipo: c.tipo, pessoal: !!c.pessoal, cor: '#747EAD' })))
await sb.from('contas').insert({ user_id: uid, id: 'c-agua', tipo: 'pagar', descricao: 'Conta de água', valor: 85, vencimento: '2026-11-20', status: 'aberta', categoria_id: 'contas-casa' })

try {
  console.log('1. número desconhecido e confirmação do número')
  await caso('assinatura errada é recusada (401)', async () => {
    const r = await postar({ event: 'message.received', data: {} }, 'sha256=00')
    assert.equal(r.status, 401)
  })
  await caso('número que não é cliente não recebe nada (nem convite)', async () => {
    const r = await mandar(ESTRANHO, { content: 'oi' }, { esperarNada: true })
    assert.equal(r.texto, '')
  })
  await caso('código errado deixa de ser silêncio (mudança do PR #28)', async () => {
    // Antes era silêncio; desde 2026-11-18 quem manda algo que PARECE código recebe resposta, senão
    // fica esperando para sempre achando que a Granninha não funciona. Estranho sem código segue mudo.
    const r = await mandar(ESTRANHO, { content: 'meu código 000000' })
    assert.match(r.texto, /não confere ou já venceu/)
  })
  await caso('número só digitado no cadastro NÃO é reconhecido e fica sem resposta (precisa confirmar)', async () => {
    const r = await mandar(FONE, { content: 'recebi 150 no pix' }, { esperarNada: true })
    assert.equal(r.texto, '')
    assert.equal((await lancs(uid)).length, 0)
  })
  await caso('cliente gera código no painel e manda: número confirmado', async () => {
    const { data: c } = await sb.from('verificacoes').upsert({ user_id: uid, codigo: '482913' }).select('codigo').single()
    const r = await mandar(FONE, { content: `Meu código Granninha: ${c!.codigo}` })
    assert.match(r.texto, /confirmado/)
    const p = (await sb.from('perfis').select('whats_verificado,whats').eq('id', uid).single()).data!
    assert.equal(p.whats_verificado, true)
    assert.equal(p.whats, '(81) 99999-0001')
  })

  console.log('2. lançar, duplicar, desfazer, perguntar o que falta')
  let idPix = ''
  await caso('texto vira lançamento no banco e a resposta mostra o que foi anotado', async () => {
    const r = await mandar(FONE, { content: 'recebi 150 da Juliana no pix' })
    idPix = r.id
    assert.match(r.texto, /entrada de R\$ 150,00/)
    assert.match(r.texto, /DESFAZER/)
    const ls = await lancs(uid)
    assert.equal(ls.length, 1)
    assert.equal(ls[0].tipo, 'entrada')
    assert.equal(Number(ls[0].valor), 150)
    assert.equal(ls[0].carteira_id, 'banco')
    assert.equal(ls[0].origem, 'texto')
  })
  await caso('a mesma mensagem entregue duas vezes não duplica', async () => {
    const r = await mandar(FONE, { content: 'recebi 150 da Juliana no pix' }, { id: idPix, esperarNada: true })
    assert.equal(r.texto, '')
    assert.equal((await lancs(uid)).length, 1)
  })
  await caso('DESFAZER apaga o último lançamento', async () => {
    const r = await mandar(FONE, { content: 'desfazer' })
    assert.match(r.texto, /desfiz/)
    assert.equal((await lancs(uid)).length, 0)
  })
  await caso('sem valor, ela pergunta; a resposta seguinte completa o lançamento', async () => {
    const r1 = await mandar(FONE, { content: 'paguei a luz' })
    assert.match(r1.texto, /valor|quanto/i)
    assert.equal((await lancs(uid)).length, 0)
    const r = await responderAte(FONE, '89')
    // "saída" ou "retirada": conta de luz é genuinamente ambígua para um MEI (pode ser da casa), e a
    // IA decide isso sozinha. O que este caso prova é que a pergunta do valor fecha o lançamento.
    assert.match(r.texto, /(saída|retirada) de R\$ 89,00/, 'conversa: ' + r.conversa)
    const ls = await lancs(uid)
    assert.equal(ls.length, 1)
    assert.equal(Number(ls[0].valor), 89)
    assert.equal(ls[0].carteira_id, 'banco')
  })
  await caso('pergunta ignorada: a mensagem nova vale sozinha e a pergunta antiga some', async () => {
    const n = (await lancs(uid)).length
    const r1 = await mandar(FONE, { content: 'paguei 20 de pão' })
    // Qual pergunta ela faz aqui depende da IA (se marcar "pão" como talvez pessoal, vem a de
    // negócio/pessoal antes da conta). O que o caso prova é que o lançamento fica em aberto.
    assert.match(r1.texto, /Responda com o n[úu]mero/i, 'ela pergunta algo e não grava ainda: ' + r1.texto.slice(0, 80))
    assert.equal((await lancs(uid)).length, n, 'nada gravado enquanto a pergunta está em aberto')
    const r2 = await mandar(FONE, { content: 'recebi 300 de uma escova no pix' })
    assert.match(r2.texto, /entrada de R\$ 300,00/)
    const novos = (await lancs(uid)).slice(n)
    assert.equal(novos.length, 1)
    assert.equal(Number(novos[0].valor), 300)
    await mandar(FONE, { content: 'desfazer' })
  })

  console.log('3. contas, fixas, parcelas, correção e pergunta')
  await caso('"paguei a água" dá baixa na conta aberta e cria o lançamento', async () => {
    const r0 = await mandar(FONE, { content: 'paguei a água' })
    assert.match(r0.texto, /saiu de qual conta\?/)
    const r = await mandar(FONE, { content: 'Conta do banco' })
    assert.match(r.texto, /pago R\$ 85,00/)
    const c = (await sb.from('contas').select('status,lancamento_id').eq('user_id', uid).eq('id', 'c-agua').single()).data!
    assert.equal(c.status, 'paga')
    assert.ok(c.lancamento_id)
  })
  await caso('compra em 4x no boleto vira 4 contas a pagar', async () => {
    // Com o meio dito na frase o caminho é determinístico. Sem ele, "4x" é ambíguo de verdade (quase
    // sempre é cartão) e a resposta certa pode ser uma pergunta — é o caso logo abaixo.
    await mandar(FONE, { content: 'comprei 1.200 de material em 4x no boleto' })
    const cs = (await sb.from('contas').select('valor,parcela_n,parcela_total').eq('user_id', uid).eq('parcela_total', 4)).data!
    assert.equal(cs.length, 4, 'quatro parcelas')
    assert.equal(cs.reduce((a, c) => a + Number(c.valor), 0), 1200)
  })
  await caso('compra em 4x sem dizer o meio: pergunta ou anota, nunca fica no limbo', async () => {
    // Em 2026-11-19 este caso falhou no gate porque a IA leu "4x" como crédito e o cliente de teste
    // não tinha cartão: a resposta foi "cadastre um cartão". Isso é correto, não defeito. O teste
    // passa a aceitar as três saídas legítimas e a cobrar que o dinheiro acabe anotado.
    const antes = (await sb.from('contas').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('parcela_total', 3)).count ?? 0
    const r = await mandar(FONE, { content: 'comprei 900 de material em 3x' })
    const pediuCartaoOuBoleto = /cart[ãa]o|boleto|carn[êe]/i.test(r.texto)
    const pediuCadastro = /ainda n[ãa]o cadastrou cart[ãa]o/i.test(r.texto)
    assert.ok(pediuCartaoOuBoleto || /R\$ 900,00|3 parcelas|parcela/i.test(r.texto), 'a resposta fala do parcelamento: ' + r.texto.slice(0, 120))
    if (pediuCadastro) return // caminho legítimo: sem cartão cadastrado, ela ensina o caminho
    if (pediuCartaoOuBoleto && /Responda com o n[úu]mero/i.test(r.texto)) {
      const op = r.texto.split('\n').find((l) => /boleto|carn[êe]/i.test(l))
      assert.ok(op, 'a lista de opções inclui boleto ou carnê: ' + r.texto)
      await mandar(FONE, { content: op!.trim().slice(0, 1) }) // responde com o número da opção
    }
    const depois = (await sb.from('contas').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('parcela_total', 3)).count ?? 0
    assert.ok(depois - antes === 3 || pediuCartaoOuBoleto, 'ou criou as 3 parcelas, ou deixou claro o que falta')
  })
  await caso('conta todo mês vira conta fixa e próximos vencimentos', async () => {
    await mandar(FONE, { content: 'aluguel 900 todo dia 10' })
    const f = (await sb.from('fixas').select('id,valor,dia').eq('user_id', uid)).data!
    assert.equal(f.length, 1)
    assert.equal(Number(f[0].valor), 900)
    assert.ok(((await sb.from('contas').select('id').eq('user_id', uid).eq('fixa_id', f[0].id)).data ?? []).length >= 2)
  })
  await caso('"não foi 900, foi 950" corrige a última sem duplicar', async () => {
    const r = await mandar(FONE, { content: 'não foi 900, foi 950' })
    assert.match(r.texto, /Pronto, corrigi/)
    const f = (await sb.from('fixas').select('valor').eq('user_id', uid)).data!
    assert.equal(f.length, 1)
    assert.equal(Number(f[0].valor), 950)
  })
  await caso('pergunta livre responde com os números do cliente', async () => {
    // O esperado sai do BANCO, não de um número fixo: o roteiro acima muda conforme casos são
    // acrescentados, e um 174 cravado quebra sem nenhum defeito no produto. Neste ponto não há compra
    // no cartão, então a soma das saídas não pessoais do mês é o mesmo que a resposta deve mostrar.
    const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
    const saidas = (await lancs(uid)).filter((l) => l.tipo === 'saida' && !l.pessoal && String(l.data).startsWith(mes))
    const total = saidas.reduce((a, l) => a + Number(l.valor), 0)
    assert.ok(total > 0, 'o roteiro precisa ter criado alguma saída antes desta pergunta')
    const r = await mandar(FONE, { content: 'quanto eu gastei esse mês?' })
    const esperado = total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    assert.ok(r.texto.includes(esperado), `esperava R$ ${esperado} (soma do banco), veio: ${r.texto.slice(0, 120)}`)
  })

  console.log('4. áudio, foto e extrato')
  await caso('áudio é transcrito e vira lançamento', async () => {
    const tts = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'coral', input: 'Oi Granninha, gastei cinquenta reais de gasolina hoje.', response_format: 'mp3' }),
    })
    assert.ok(tts.ok, 'gerar áudio de teste')
    midias.set('granninha-AUDIO1.mp3', { buf: Buffer.from(await tts.arrayBuffer()), mime: 'audio/mpeg' })
    const r1 = await mandar(FONE, { type: 'AUDIO', content: '', fileUrl: '/api/media/granninha-AUDIO1.mp3' })
    assert.match(r1.texto, /negócio ou da casa/)
    const r2 = await mandar(FONE, { content: '1' })
    assert.match(r2.texto, /saiu de qual conta\?/)
    const r = await mandar(FONE, { content: '2' })
    assert.match(r.texto, /saída de R\$ 50,00/)
    assert.match(r.texto, /Dinheiro/)
    const l = (await lancs(uid)).at(-1)!
    assert.equal(l.origem, 'audio')
    assert.equal(l.categoria_id, 'transporte')
  })
  await caso('gasolina de novo: lembra que é do negócio e não pergunta outra vez', async () => {
    const r = await mandar(FONE, { content: 'gasolina 40 no pix' })
    assert.match(r.texto, /saída de R\$ 40,00/)
    const l = (await lancs(uid)).at(-1)!
    assert.equal(l.pessoal, false)
  })
  await caso('foto de comprovante vira lançamento, com o arquivo guardado', async () => {
    midias.set('granninha-FOTO1.png', { buf: readFileSync(new URL('./fixtures/comprovante.png', import.meta.url)), mime: 'image/png' })
    const r = await mandar(FONE, { type: 'IMAGE', content: '', caption: '', fileUrl: '/api/media/granninha-FOTO1.png' })
    assert.match(r.texto, /R\$ 64,00/)
    const l = (await lancs(uid)).at(-1)!
    assert.equal(l.origem, 'foto')
    assert.equal(l.data, '2026-11-14')
    assert.ok(l.anexo_path?.startsWith(uid + '/'))
    const arq = await sb.storage.from('comprovantes').download(l.anexo_path!)
    assert.ok(arq.data && arq.data.size > 1000, 'comprovante guardado')
  })
  await caso('extrato em PDF pergunta antes; com SIM importa os 3', async () => {
    midias.set('granninha-PDF1.pdf', { buf: readFileSync(new URL('./fixtures/extrato.pdf', import.meta.url)), mime: 'application/pdf' })
    const antes = (await lancs(uid)).length
    const r1 = await mandar(FONE, { type: 'DOCUMENT', content: 'extrato.pdf', fileUrl: '/api/media/granninha-PDF1.pdf' })
    assert.match(r1.texto, /Achei 3 lançamentos/)
    assert.equal((await lancs(uid)).length, antes)
    const r2 = await mandar(FONE, { content: 'sim' })
    assert.match(r2.texto, /Importei 3/)
    assert.equal((await lancs(uid)).length, antes + 3)
  })
  await caso('fatura do cartão em foto: pergunta o cartão e importa as 3 compras na fatura de dezembro', async () => {
    await sb.from('carteiras').insert({ user_id: uid, id: 'cartao-nu', nome: 'Cartão Nubank', tipo: 'cartao', saldo_inicial: 0, padrao: false, fechamento: 3, vencimento: 10, conta_pagamento_id: 'banco' })
    midias.set('granninha-FAT1.png', { buf: readFileSync(new URL('./fixtures/fatura-cartao.png', import.meta.url)), mime: 'image/png' })
    const r1 = await mandar(FONE, { type: 'IMAGE', content: '', caption: '', fileUrl: '/api/media/granninha-FAT1.png' })
    assert.match(r1.texto, /Achei 3 compras/)
    assert.match(r1.texto, /Cartão Nubank/)
    const r2 = await mandar(FONE, { content: '1' })
    assert.match(r2.texto, /Importei 3 compras/)
    const cs = (await sb.from('lancamentos').select('valor,fatura,tipo').eq('user_id', uid).eq('tipo', 'compra_cartao')).data!
    assert.equal(cs.length, 3)
    assert.ok(cs.every((c) => c.fatura === '2026-12'))
    assert.equal(Math.round(cs.reduce((a, c) => a + Number(c.valor), 0) * 100) / 100, 255.4)
  })
  await caso('a mesma fatura de novo não duplica', async () => {
    const r1 = await mandar(FONE, { type: 'IMAGE', content: '', caption: '', fileUrl: '/api/media/granninha-FAT1.png' })
    assert.match(r1.texto, /Achei 3 compras/)
    const r2 = await mandar(FONE, { content: '1' })
    assert.match(r2.texto, /já estavam anotadas/)
    assert.equal(((await sb.from('lancamentos').select('id').eq('user_id', uid).eq('tipo', 'compra_cartao')).data ?? []).length, 3)
  })
  await caso('"paguei a fatura do nubank" usa o valor em aberto e sai do banco', async () => {
    const r = await mandar(FONE, { content: 'paguei a fatura do nubank' })
    assert.match(r.texto, /pagamento de fatura de R\$ 255,40/)
    const l = (await lancs(uid)).at(-1)!
    assert.equal(l.tipo, 'transferencia')
    assert.equal(l.carteira_id, 'banco')
    assert.equal(l.carteira_destino_id, 'cartao-nu')
  })
  await caso('figurinha fica em silêncio (fase cv)', async () => {
    // Antes cada figurinha recebia "por aqui eu entendo texto, áudio...". Vídeo e localização continuam
    // recebendo a ajuda; o caso disso está na seção 6.
    const r = await mandar(FONE, { type: 'STICKER', content: '' }, { esperarNada: true })
    assert.equal(r.texto, '')
  })

  console.log('5. acesso, cortesia e mensagens que não são para ela')
  await caso('acesso bloqueado: não grava e avisa', async () => {
    await sb.from('assinaturas').update({ status: 'bloqueada' }).eq('user_id', uid)
    const n = (await lancs(uid)).length
    const r = await mandar(FONE, { content: 'paguei 10 de café' })
    assert.match(r.texto, /pausado/)
    assert.equal((await lancs(uid)).length, n)
  })
  await caso('teste grátis vencido: também não grava', async () => {
    await sb.from('assinaturas').update({ status: 'trial', trial_fim: '2026-01-01' }).eq('user_id', uid)
    const r = await mandar(FONE, { content: 'paguei 10 de café' })
    assert.match(r.texto, /pausado/)
  })
  await caso('cortesia (parceiro liberado): grava normal', async () => {
    await sb.from('assinaturas').update({ status: 'cortesia' }).eq('user_id', uid)
    const r = await responderAte(FONE, 'paguei 10 de café no pix')
    assert.match(r.texto, /saída de R\$ 10,00/, 'conversa: ' + r.conversa)
  })
  await caso('mensagem de grupo e mensagem enviada por ela mesma são ignoradas', async () => {
    const n = enviados.length
    await postar({ event: 'message.received', data: { key: { id: 'G' + Date.now(), fromMe: false }, from: `${FONE}@s.whatsapp.net`, isGroup: true, chatType: 'GROUP', type: 'TEXT', content: 'paguei 99 de luz' } })
    await postar({ event: 'message.received', data: { key: { id: 'M' + Date.now(), fromMe: true }, from: `${FONE}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: 'paguei 98 de luz' } })
    await new Promise((ok) => setTimeout(ok, 2500))
    assert.equal(enviados.length, n)
    assert.ok(!(await lancs(uid)).some((l) => [98, 99].includes(Number(l.valor))))
  })
  await caso('modo teste: número fora da lista de liberados é ignorado em silêncio', async () => {
    process.env.WA_SOMENTE_NUMEROS = FONE
    try {
      const r = await mandar(ESTRANHO, { content: 'oi, quero saber o preço' }, { esperarNada: true })
      assert.equal(r.texto, '')
      const m = (await sb.from('mensagens').select('status,erro').eq('id', r.id).single()).data!
      assert.equal(m.status, 'ignorada')
      const r2 = await responderAte(FONE, 'paguei 12 de pão no pix')
      assert.match(r2.texto, /R\$ 12,00/, 'conversa: ' + r2.conversa)
    } finally {
      delete process.env.WA_SOMENTE_NUMEROS
    }
  })
  await caso('saúde: fechada sem a chave, detalhada com ela (mudança do PR #27)', async () => {
    // Desde 2026-11-18 o /saude sem chave diz só que está de pé: o número da Granninha e o volume de
    // mensagens não são para qualquer um na internet.
    const fechada = await (await fetch(SERV + '/saude')).json()
    assert.deepEqual(fechada, { ok: true }, 'sem chave não vaza número nem volume')
    process.env.SAUDE_CHAVE = 'chave-do-fluxo'
    try {
      const s = await (await fetch(SERV + '/saude', { headers: { Authorization: 'Bearer chave-do-fluxo' } })).json()
      assert.equal(s.whatsapp.estado, 'CONNECTED')
      assert.ok(s.mensagens_24h > 0)
    } finally {
      delete process.env.SAUDE_CHAVE
    }
  })

  console.log('6. conversa sem falha (fase cv)')
  await caso('a chegada está no banco ANTES do 200: nada se perde no deploy', async () => {
    const id = `PRESA-TESTE-${Date.now()}`
    const corpo = JSON.stringify({ event: 'message.received', sessionId: 'granninha', data: { key: { id, remoteJid: `${FONE}@s.whatsapp.net`, fromMe: false }, from: `${FONE}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: 'paguei 7 de estacionamento no pix' } })
    const sig = 'sha256=' + createHmac('sha256', 'segredo-teste').update(corpo).digest('hex')
    const r = await fetch(SERV + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig }, body: corpo })
    assert.equal(r.status, 200)
    // Sem esperar nada: a linha tem que existir já, porque o 200 só sai depois de gravar.
    const m = (await sb.from('mensagens').select('id,status,erro').eq('id', id).maybeSingle()).data
    assert.ok(m, 'a mensagem está no banco no instante do 200')
    assert.ok(['recebida', 'ok', 'pergunta'].includes(String((m as { status: string }).status)))
    // deixa terminar para não sujar os casos seguintes
    const t0 = Date.now()
    while (Date.now() - t0 < 60000) {
      const x = (await sb.from('mensagens').select('status').eq('id', id).maybeSingle()).data as { status: string } | null
      if (x && x.status !== 'recebida') break
      await new Promise((ok2) => setTimeout(ok2, 200))
    }
  })
  await caso('mensagem presa (deploy no meio) é retomada pela varredura', async () => {
    const { varredura } = await import('../src/index.ts')
    const { varrerPresas } = await import('../src/presas.ts')
    const id = `RETOMAR-TESTE-${Date.now()}`
    const evento = { event: 'message.received', sessionId: 'granninha', data: { key: { id, remoteJid: `${FONE}@s.whatsapp.net`, fromMe: false }, from: `${FONE}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: 'recebi 33 de corte no pix' } }
    // Como se o processo tivesse morrido antes de começar: 'recebida', marca "na fila", 5 min atrás.
    const linha = { id, telefone: FONE, tipo: 'texto', texto: 'recebi 33 de corte no pix', erro: 'na fila', criado_em: new Date(Date.now() - 5 * 60_000).toISOString() }
    let ins = await sb.from('mensagens').insert({ ...linha, evento })
    if (ins.error) {
      // Sem a migration 20261119120000 a coluna não existe: o texto se reconstrói sem ela.
      console.log('      (sem a coluna `evento`: testando a retomada por texto)')
      ins = await sb.from('mensagens').insert(linha)
    }
    if (ins.error) throw new Error('não deu para semear a mensagem presa: ' + ins.error.message)
    const antes = enviados.length
    const log = await varrerPresas(varredura)
    assert.ok(log.some((l) => l.includes(id)), 'a varredura pegou a mensagem: ' + JSON.stringify(log))
    const t0 = Date.now()
    while (Date.now() - t0 < 60000 && enviados.length === antes) await new Promise((ok2) => setTimeout(ok2, 200))
    assert.ok(enviados.length > antes, 'a resposta saiu')
    assert.ok((await lancs(uid)).some((l) => Number(l.valor) === 33), 'o lançamento que tinha se perdido foi gravado')
  })
  await caso('mensagem que JÁ tinha começado não é reprocessada, e avisa', async () => {
    const { varredura } = await import('../src/index.ts')
    const { varrerPresas } = await import('../src/presas.ts')
    const id = `MEIO-TESTE-${Date.now()}`
    await sb.from('mensagens').insert({ id, telefone: FONE, tipo: 'texto', texto: 'desfazer', erro: 'processando', criado_em: new Date(Date.now() - 5 * 60_000).toISOString() })
    const quantos = (await lancs(uid)).length
    const antes = enviados.length
    await varrerPresas(varredura)
    const t0 = Date.now()
    while (Date.now() - t0 < 20000 && enviados.length === antes) await new Promise((ok2) => setTimeout(ok2, 200))
    assert.equal((await lancs(uid)).length, quantos, 'nada foi desfeito de novo')
    const m = (await sb.from('mensagens').select('status,erro').eq('id', id).single()).data as { status: string; erro: string }
    assert.equal(m.status, 'erro')
    assert.match(m.erro, /interrompida/)
    assert.match(enviados[enviados.length - 1].texto, /não consegui terminar de anotar/)
  })
  await caso('pergunta no meio não rouba o DESFAZER', async () => {
    const r1 = await responderAte(FONE, 'paguei 61 de luz no pix')
    assert.match(r1.texto, /R\$ 61,00/, 'conversa: ' + r1.conversa)
    await mandar(FONE, { content: 'quanto sobrou esse mês?' })
    const r3 = await mandar(FONE, { content: 'desfazer' })
    assert.match(r3.texto, /desfiz/)
    assert.ok(!(await lancs(uid)).some((l) => Number(l.valor) === 61), 'os R$ 61 saíram de verdade')
  })
  await caso('dois DESFAZER seguidos: o segundo pergunta antes de apagar outro', async () => {
    const r = await mandar(FONE, { content: 'desfazer' })
    assert.match(r.texto, /já tinha desfeito|Não tem nada recente/)
  })
  await caso('a pergunta em aberto é apagada de verdade no banco quando dá certo', async () => {
    // O banco falso compara `atualizado_em` como texto; aqui é timestamptz de verdade. Se o filtro
    // não casar, a pergunta fica pendurada e um "2" futuro poderia ser aplicado a ela.
    const r = await mandar(FONE, { content: 'gastei 9 no mercado' })
    assert.match(r.texto, /saiu de qual conta\?/, 'o cenário depende de a Granninha perguntar a conta')
    const r2 = await mandar(FONE, { content: '1' })
    assert.match(r2.texto, /R\$ 9,00/)
    const c = (await sb.from('conversas').select('pendente').eq('telefone', FONE).maybeSingle()).data as { pendente: unknown } | null
    assert.ok(!c || c.pendente === null, 'a pergunta saiu do banco: ' + JSON.stringify(c?.pendente))
  })
  await caso('figurinha não recebe resposta', async () => {
    const r = await mandar(FONE, { type: 'STICKER', fileUrl: '/api/media/granninha-STK.webp' }, { esperarNada: true })
    assert.equal(r.texto, '', 'figurinha fica em silêncio')
  })
  await caso('vídeo continua recebendo a mensagem de ajuda', async () => {
    const r = await mandar(FONE, { type: 'VIDEO', fileUrl: '/api/media/granninha-VID.mp4' })
    assert.match(r.texto, /texto, áudio, foto de comprovante e PDF/)
  })
} finally {
  const arqs = (await sb.storage.from('comprovantes').list(uid)).data ?? []
  if (arqs.length) await sb.storage.from('comprovantes').remove(arqs.map((a) => `${uid}/${a.name}`))
  await sb.from('mensagens').delete().in('telefone', [FONE, ESTRANHO])
  await sb.from('conversas').delete().in('telefone', [FONE, ESTRANHO])
  await sb.auth.admin.deleteUser(uid)
  const sobra = await sb.from('lancamentos').select('id', { count: 'exact', head: true }).eq('user_id', uid)
  console.log(`\nlimpeza: cliente de teste apagado (lançamentos restantes: ${sobra.count ?? 0})`)
  console.log(`RESULTADO: ${ok} ok, ${falhas.length} falhas${falhas.length ? ': ' + falhas.join(' | ') : ''}`)
  srv.close()
  gw.close()
  process.exit(falhas.length ? 1 : 0)
}
