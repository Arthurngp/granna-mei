/**
 * Adaptador da Anthropic (server/src/anthropic.ts): modelo "claude-*" escolhido na aba Configurações vai para a Messages API, no formato REAL dela
 * (a Anthropic falsa do fixture recusa pedido malformado), e qualquer falha ali cai no modelo de fábrica da OpenAI sem a pessoa perceber.
 *   npx tsx test/ia-anthropic.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, msgAudio, msgFoto, processar, semear } from './_falsos.ts'

process.env.IA_SEGREDO = 'segredo-de-teste-com-mais-de-dezesseis-letras'
const cfg = await import('../src/ia-config.ts')
const adm = await import('../src/ia-config-admin.ts')
const { estadoIA, zerarEstadoIA } = await import('../src/ia-estado.ts')
const { paraBlocosAnthropic } = await import('../src/anthropic.ts')
const { sb: sbReal } = await import('../src/banco.ts')
const { limparCacheIA, MODELO_FABRICA, MODELO_AUDIO_FABRICA, MODELO_TESTE_ANTHROPIC, cifrar } = cfg

const CHAVE_OPENAI = process.env.OPENAI_API_KEY!
const CHAVE_ANT = 'sk-ant-api03-chave-cadastrada-na-tela-1234567890'
const CHAVE_ANT_ENV = 'sk-ant-api03-chave-do-ambiente-0987654321'
const CLAUDE = 'claude-sonnet-5-5'
const feitas = () => ia.chamadasFeitas.map((c) => `${c.nome}|${c.modelo}`)
const NUM_U2 = '5581955554444'
const msgComoU2 = async (texto: string) =>
  (
    await processar({
      event: 'message.received',
      data: { key: { id: `U2${Date.now()}${Math.random()}`, remoteJid: `${NUM_U2}@s.whatsapp.net`, fromMe: false }, from: `${NUM_U2}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: texto },
    } as Parameters<typeof processar>[0])
  ).resposta ?? ''

function novo() {
  semear()
  limparCacheIA()
  zerarEstadoIA()
  delete process.env.ANTHROPIC_API_KEY
  ia.regras = [[/gastei 6/, acoes(acao({ valor: 6 }))], [/gastei 7/, acoes(acao({ valor: 7, descricao: 'Padaria' }))]]
}
const global = (tarefa: string, modelo: string) => (E.tabelas.config_ia_modelo = [...(E.tabelas.config_ia_modelo ?? []), { tarefa, modelo }])
const chaveAnt = (extra: Record<string, unknown> = {}) =>
  (E.tabelas.ia_chaves = [...(E.tabelas.ia_chaves ?? []), { id: 'ka', provedor: 'anthropic', nome: 'Anthropic da agência', ativa: true, chave_cifrada: cifrar(CHAVE_ANT), atualizado_em: new Date().toISOString(), ...extra }])

/* ---------- caminho feliz: o pedido vai para a Anthropic, no formato dela ---------- */

await caso('modelo claude para todos + chave da Anthropic ativa: a mensagem é atendida PELA Anthropic, com a chave decifrada, e a OpenAI nem é chamada', async () => {
  novo()
  global('interpretacao', CLAUDE)
  chaveAnt()
  const r = await msg('gastei 6 no pix')
  assert.match(r, /saiu R\$ 6,00/)
  assert.deepEqual(feitas(), [`anthropic:interpretacao|${CLAUDE}`])
  assert.equal(ia.chamadasFeitas[0].chave, CHAVE_ANT)
  assert.equal(ia.pedidos, 0, 'a OpenAI não foi chamada')
  assert.equal(lancsU1().length, 1)
})

await caso('formato da requisição: ferramenta forçada com o esquema, system à parte, max_tokens e papel user (a Anthropic falsa recusa o contrário)', async () => {
  novo()
  global('interpretacao', CLAUDE)
  chaveAnt()
  await msg('gastei 6 no pix')
  const b = ia.ultimoAnthropic!
  assert.equal(b.model, CLAUDE)
  assert.equal(typeof b.max_tokens, 'number')
  assert.ok(String(b.system).length > 50, 'o prompt de sistema vai no campo system')
  assert.equal(b.messages[0].role, 'user')
  assert.deepEqual(b.tool_choice, { type: 'tool', name: 'interpretacao' })
  assert.equal(b.tools[0].input_schema.type, 'object')
  assert.ok(!('response_format' in b) && !('reasoning_effort' in b), 'nada do formato da OpenAI vaza para a Anthropic')
})

await caso('o consumo gravado vem dos tokens da Anthropic (21 entrada, 9 saída), para o admin não ficar com zero', async () => {
  novo()
  global('interpretacao', CLAUDE)
  chaveAnt()
  await msg('gastei 6 no pix')
  const m = (E.tabelas.mensagens ?? []).at(-1) as Record<string, unknown>
  assert.deepEqual([m.tokens_entrada, m.tokens_saida], [21, 9])
})

await caso('sem chave cadastrada, a ANTHROPIC_API_KEY do ambiente vale', async () => {
  novo()
  global('interpretacao', CLAUDE)
  process.env.ANTHROPIC_API_KEY = CHAVE_ANT_ENV
  await msg('gastei 6 no pix')
  assert.equal(ia.chamadasFeitas[0].chave, CHAVE_ANT_ENV)
  assert.equal(ia.chamadasFeitas[0].nome, 'anthropic:interpretacao')
})

await caso('comprovante (foto) com claude: a imagem vai como bloco image base64 e a leitura segue o fluxo normal', async () => {
  novo()
  global('documento', CLAUDE)
  chaveAnt()
  const f = await msgFoto('f1.jpg', 'Gasolina')
  assert.ok(f.resposta)
  const doc = ia.chamadasFeitas.find((c) => c.nome === 'anthropic:documento')
  assert.ok(doc, 'a leitura foi pela Anthropic')
  const blocos = ia.ultimoAnthropic!.messages[0].content as { type: string }[]
  assert.ok(Array.isArray(blocos) && blocos.some((b) => b.type === 'image'), 'a imagem foi como bloco image')
})

await caso('conversão de blocos: texto, imagem, PDF; e bloco desconhecido é erro (nunca manda lixo)', async () => {
  const r = paraBlocosAnthropic([
    { type: 'text', text: 'oi' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    { type: 'file', file: { filename: 'x.pdf', file_data: 'data:application/pdf;base64,REVG' } },
  ]) as { type: string; source?: { type: string; media_type: string; data: string } }[]
  assert.deepEqual(r[0], { type: 'text', text: 'oi' })
  assert.deepEqual(r[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } })
  assert.deepEqual(r[2], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'REVG' } })
  assert.equal(paraBlocosAnthropic('texto puro'), 'texto puro')
  assert.throws(() => paraBlocosAnthropic([{ type: 'input_audio' }]), /sem equivalente/)
})

await caso('modelo individual: o cliente com claude usa a Anthropic e outro cliente segue na OpenAI', async () => {
  novo()
  E.tabelas.ia_modelo_cliente = [{ user_id: 'u-1', tarefa: 'interpretacao', modelo: CLAUDE }]
  chaveAnt()
  await msg('gastei 6 no pix')
  assert.equal(ia.chamadasFeitas[0].nome, 'anthropic:interpretacao')
  ia.chamadasFeitas = []
  await msgComoU2('gastei 6 no pix')
  assert.deepEqual(feitas(), [`interpretacao|${MODELO_FABRICA}`])
})

/* ---------- a regra de ouro: qualquer falha da Anthropic cai na OpenAI ---------- */

const cai = async (nomeCaso: string, preparar: () => void) =>
  caso(`cai na OpenAI sem a pessoa perceber: ${nomeCaso}`, async () => {
    novo()
    global('interpretacao', CLAUDE)
    chaveAnt()
    preparar()
    const r = await msg('gastei 6 no pix')
    assert.match(r, /saiu R\$ 6,00/, 'a mensagem foi atendida')
    assert.equal(lancsU1().length, 1, 'um lançamento só')
    assert.equal(ia.chamadasFeitas.at(-1)!.nome, 'interpretacao')
    assert.equal(ia.chamadasFeitas.at(-1)!.modelo, MODELO_FABRICA, 'terminou no modelo de fábrica')
    assert.equal(ia.chamadasFeitas.at(-1)!.chave, CHAVE_OPENAI)
    // O contador de falhas não é zerado pela OpenAI que responde depois (só o 'problema atual' é), então ele prova que a queda da Anthropic nunca foi registrada.
    assert.deepEqual([estadoIA().ok, estadoIA().falhas], [true, 0], 'a falha da Anthropic NÃO suja o estado de saúde da OpenAI (nem dispara alerta ao dono)')
  })

await cai('chave da Anthropic recusada (401)', () => ia.recusarChaves.add(CHAVE_ANT))
await cai('modelo claude recusado (404)', () => ia.recusarModelos.add(CLAUDE))
await cai('Anthropic sobrecarregada (529)', () => (ia.erroAnthropic = { status: 529, corpo: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) }))
await cai('limite de taxa (429)', () => (ia.erroAnthropic = { status: 429, corpo: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } }) }))
await cai('saldo esgotado (400 credit balance)', () => (ia.erroAnthropic = { status: 400, corpo: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.' } }) }))
await cai('resposta sem a ferramenta pedida', () => (ia.erroAnthropic = { status: 200, corpo: JSON.stringify({ content: [{ type: 'text', text: 'ola' }], usage: { input_tokens: 1, output_tokens: 1 } }) }))

await caso('sem chave nenhuma da Anthropic (nem cadastrada, nem no ambiente): cai na OpenAI sem sequer chamar a Anthropic', async () => {
  novo()
  global('interpretacao', CLAUDE)
  const r = await msg('gastei 6 no pix')
  assert.match(r, /saiu R\$ 6,00/)
  assert.deepEqual(feitas(), [`interpretacao|${MODELO_FABRICA}`])
  assert.equal(ia.pedidosAnthropic, 0)
})

await caso('só existe chave da OpenAI ativa: a Anthropic NUNCA recebe a chave da OpenAI (cai na OpenAI sem chamar a Anthropic)', async () => {
  novo()
  global('interpretacao', CLAUDE)
  E.tabelas.ia_chaves = [{ id: 'ko', provedor: 'openai', nome: 'OpenAI', ativa: true, chave_cifrada: cifrar('sk-openai-cadastrada-0123456789ab'), atualizado_em: new Date().toISOString() }]
  const r = await msg('gastei 6 no pix')
  assert.match(r, /saiu R\$ 6,00/)
  assert.equal(ia.pedidosAnthropic, 0)
  assert.ok(!ia.chamadasFeitas.some((c) => c.nome.startsWith('anthropic')), 'nenhuma chamada à Anthropic')
  assert.equal(ia.chamadasFeitas[0].chave, 'sk-openai-cadastrada-0123456789ab', 'a OpenAI usou a chave dela')
})

await caso('nenhum erro do adaptador contém a chave (mesmo quando a API a ecoa na resposta)', async () => {
  novo()
  chaveAnt()
  ia.recusarChaves.add(CHAVE_ANT)
  const { jsonAnthropic, chamadaMinimaAnthropic } = await import('../src/anthropic.ts')
  await assert.rejects(jsonAnthropic(CLAUDE, 'sis', 'oi', 'interpretacao', { type: 'object' }), (e: Error) => !e.message.includes(CHAVE_ANT) && /401/.test(e.message))
  const m = await chamadaMinimaAnthropic(CLAUDE, CHAVE_ANT)
  assert.equal(m.ok, false)
  assert.ok(!(m as { detalhe: string }).detalhe.includes(CHAVE_ANT), 'detalhe sem a chave')
  assert.equal((m as { tipo: string }).tipo, 'sem_chave')
})

await caso('chave da Anthropic cifrada que não abre: cai na OpenAI (e na do ambiente, se houver, usa essa)', async () => {
  novo()
  global('interpretacao', CLAUDE)
  chaveAnt({ chave_cifrada: 'v1:AAAA:BBBB:CCCC' })
  await msg('gastei 6 no pix')
  assert.deepEqual(feitas(), [`interpretacao|${MODELO_FABRICA}`])
  ia.chamadasFeitas = []
  limparCacheIA()
  process.env.ANTHROPIC_API_KEY = CHAVE_ANT_ENV
  await msg('gastei 6 no pix')
  assert.equal(ia.chamadasFeitas[0].chave, CHAVE_ANT_ENV)
})

await caso('a OpenAI não é afetada: cota esgotada nela (modelo de fábrica) segue o comportamento de antes, sem trocar para claude', async () => {
  novo()
  chaveAnt()
  ia.erro = { status: 429, corpo: JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }) }
  await msg('gastei 6 no pix')
  assert.equal(ia.pedidos, 1, 'uma tentativa só')
  assert.equal(ia.pedidosAnthropic, 0)
})

await caso('áudio: um modelo claude gravado para áudio é ignorado e a transcrição usa o de fábrica da OpenAI', async () => {
  novo()
  global('audio', CLAUDE)
  chaveAnt()
  ia.regras = [[/gasolina/, acoes(acao({ valor: 50, descricao: 'Gasolina' }))]]
  const r = await msgAudio('a1.ogg')
  assert.ok(r.resposta)
  assert.equal(ia.chamadasFeitas.find((c) => c.nome === 'audio')!.modelo, MODELO_AUDIO_FABRICA)
  assert.ok(!ia.chamadasFeitas.some((c) => c.nome === 'anthropic:audio'))
})

/* ---------- admin: chaves e modelos da Anthropic ---------- */

const auditoria: { acao: string; detalhes: Record<string, unknown> }[] = []
const deps = (testar?: (m: string, c?: string) => Promise<{ ok: boolean; detalhe: string }>) => {
  auditoria.length = 0
  return { sb: sbReal, testar: testar ?? (async () => ({ ok: true, detalhe: 'respondeu' })), auditar: async (_a: string, acao: string, detalhes: Record<string, unknown>) => void auditoria.push({ acao, detalhes }) }
}
const ADMIN = '00000000-0000-0000-0000-0000000000aa'
const erroCom = (status: number, re: RegExp) => (e: Error & { status?: number }) => e.status === status && re.test(e.message)

await caso('cadastrar chave da Anthropic: testa com o modelo barato DA ANTHROPIC, guarda cifrada, desligada e com o provedor certo', async () => {
  novo()
  let testadoCom = ''
  await adm.adicionarChave(deps(async (m) => ((testadoCom = m), { ok: true, detalhe: 'respondeu' })), ADMIN, { provedor: 'anthropic', nome: 'Claude', chave: CHAVE_ANT })
  assert.equal(testadoCom, MODELO_TESTE_ANTHROPIC)
  const l = E.tabelas.ia_chaves[0]
  assert.deepEqual([l.provedor, l.ativa, l.ultimos4], ['anthropic', false, CHAVE_ANT.slice(-4)])
  assert.ok(!String(l.chave_cifrada).includes('sk-ant'))
  assert.equal(auditoria[0].detalhes.provedor, 'anthropic')
  assert.ok(!JSON.stringify(auditoria).includes(CHAVE_ANT))
})

await caso('sem informar o provedor, a chave é da OpenAI (comportamento de antes); provedor desconhecido é recusado', async () => {
  novo()
  let testadoCom = ''
  await adm.adicionarChave(deps(async (m) => ((testadoCom = m), { ok: true, detalhe: 'ok' })), ADMIN, { nome: 'Velha guarda', chave: 'sk-openai-0123456789abcdefghij' })
  assert.equal(E.tabelas.ia_chaves[0].provedor, 'openai')
  assert.equal(testadoCom, MODELO_FABRICA)
  await assert.rejects(adm.adicionarChave(deps(), ADMIN, { provedor: 'gemini', nome: 'x', chave: 'sk-openai-0123456789abcdefghij' }), erroCom(400, /Provedor desconhecido/))
  assert.equal(E.tabelas.ia_chaves.length, 1)
})

await caso('chave da Anthropic que não funciona: recusada, nada guardado, a chave não aparece na mensagem (teste real contra a Anthropic falsa)', async () => {
  novo()
  ia.recusarChaves.add(CHAVE_ANT)
  const real = adm.depsReais(sbReal, async () => {})
  await assert.rejects(adm.adicionarChave(real, ADMIN, { provedor: 'anthropic', nome: 'Ruim', chave: CHAVE_ANT }), (e: Error & { status?: number }) => e.status === 400 && !e.message.includes(CHAVE_ANT) && /não funcionou/.test(e.message))
  assert.equal((E.tabelas.ia_chaves ?? []).length, 0)
  ia.recusarChaves.clear()
  await adm.adicionarChave(real, ADMIN, { provedor: 'anthropic', nome: 'Boa', chave: CHAVE_ANT })
  assert.deepEqual(ia.chamadasFeitas.at(-1), { nome: 'anthropic:minima', modelo: MODELO_TESTE_ANTHROPIC, chave: CHAVE_ANT })
  assert.equal(E.tabelas.ia_chaves[0].provedor, 'anthropic')
})

await caso('ligar a chave da Anthropic NÃO desliga a da OpenAI (uma ativa por provedor), e trocar dentro do mesmo provedor desliga só a do mesmo provedor', async () => {
  novo()
  const I1 = '11111111-1111-1111-1111-111111111111'
  const A1 = '22222222-2222-2222-2222-222222222222'
  const A2 = '33333333-3333-3333-3333-333333333333'
  E.tabelas.ia_chaves = [
    { id: I1, provedor: 'openai', nome: 'OpenAI', ultimos4: 'oooo', ativa: true, chave_cifrada: cifrar('sk-openai-0123456789abcdefghij') },
    { id: A1, provedor: 'anthropic', nome: 'Claude 1', ultimos4: 'aaa1', ativa: false, chave_cifrada: cifrar(CHAVE_ANT) },
    { id: A2, provedor: 'anthropic', nome: 'Claude 2', ultimos4: 'aaa2', ativa: false, chave_cifrada: cifrar(CHAVE_ANT_ENV) },
  ]
  const d = deps()
  await adm.definirChaveAtiva(d, ADMIN, { id: A1, ativa: true })
  assert.deepEqual(E.tabelas.ia_chaves.map((k) => [k.nome, k.ativa]), [['OpenAI', true], ['Claude 1', true], ['Claude 2', false]], 'as duas de provedores diferentes ficam ligadas')
  await adm.definirChaveAtiva(d, ADMIN, { id: A2, ativa: true })
  assert.deepEqual(E.tabelas.ia_chaves.map((k) => [k.nome, k.ativa]), [['OpenAI', true], ['Claude 1', false], ['Claude 2', true]], 'só uma Anthropic por vez, a OpenAI intacta')
  assert.deepEqual(auditoria.map((a) => a.detalhes.provedor), ['anthropic', 'anthropic'], 'as duas ativações foram auditadas com o provedor')
})

await caso('listar mostra qual chave está em uso em CADA provedor (banco, ambiente ou nenhuma) e nunca a chave', async () => {
  novo()
  let l = await adm.listar(deps())
  assert.deepEqual([l.em_uso.openai.origem, l.em_uso.anthropic.origem], ['ambiente', 'nenhuma'])
  process.env.ANTHROPIC_API_KEY = CHAVE_ANT_ENV
  l = await adm.listar(deps())
  assert.equal(l.em_uso.anthropic.origem, 'ambiente')
  chaveAnt({ ultimos4: 'cdef', criado_em: 'agora', testada_em: 'agora' })
  l = await adm.listar(deps())
  assert.deepEqual([l.em_uso.anthropic.origem, l.em_uso.anthropic.nome, l.em_uso.openai.origem], ['banco', 'Anthropic da agência', 'ambiente'])
  assert.equal(l.chave_em_uso, 'ambiente', 'o campo antigo continua falando só da OpenAI')
  assert.ok(!JSON.stringify(l).includes(CHAVE_ANT) && !JSON.stringify(l).includes('v1:'))
})

await caso('escolher modelo claude para uma tarefa: é TESTADO na Anthropic; sem chave da Anthropic é recusado dizendo o que fazer', async () => {
  novo()
  const real = adm.depsReais(sbReal, async () => {})
  await assert.rejects(adm.salvarModelo(real, ADMIN, { tarefa: 'interpretacao', modelo: CLAUDE }), erroCom(400, /Nenhuma chave da Anthropic/))
  assert.equal((E.tabelas.config_ia_modelo ?? []).length, 0, 'nada salvo')
  chaveAnt()
  limparCacheIA()
  const r = await adm.salvarModelo(real, ADMIN, { tarefa: 'interpretacao', modelo: CLAUDE })
  assert.equal(r.vale, CLAUDE)
  assert.deepEqual(ia.chamadasFeitas.at(-1), { nome: 'anthropic:minima', modelo: CLAUDE, chave: CHAVE_ANT })
  ia.recusarModelos.add('claude-nao-existe')
  await assert.rejects(adm.salvarModelo(real, ADMIN, { tarefa: 'ajuda', modelo: 'claude-nao-existe' }), erroCom(400, /não respondeu/))
  assert.equal(E.tabelas.config_ia_modelo.length, 1)
})

await caso('áudio com modelo claude é recusado na hora (para todos e individual); com modelo da OpenAI continua aceito', async () => {
  novo()
  chaveAnt()
  await assert.rejects(adm.salvarModelo(deps(), ADMIN, { tarefa: 'audio', modelo: CLAUDE }), erroCom(400, /só funciona com modelos da OpenAI/))
  E.tabelas.perfis = [{ id: '00000000-0000-0000-0000-000000000001', nome: 'C', negocio: 'L', papel: 'cliente' }]
  await assert.rejects(adm.salvarModeloCliente(deps(), ADMIN, { user_id: '00000000-0000-0000-0000-000000000001', tarefa: 'audio', modelo: CLAUDE }), erroCom(400, /só funciona com modelos da OpenAI/))
  assert.equal((E.tabelas.config_ia_modelo ?? []).length + (E.tabelas.ia_modelo_cliente ?? []).length, 0)
  await adm.salvarModelo(deps(), ADMIN, { tarefa: 'audio', modelo: 'whisper-x' })
  assert.equal(E.tabelas.config_ia_modelo[0].modelo, 'whisper-x')
})

await caso('ponta a ponta: escolhe claude pela tela, a próxima mensagem vai para a Anthropic; derruba a Anthropic e a Granninha continua', async () => {
  novo()
  const real = adm.depsReais(sbReal, async () => {})
  await adm.adicionarChave(real, ADMIN, { provedor: 'anthropic', nome: 'Claude', chave: CHAVE_ANT })
  const id = E.tabelas.ia_chaves[0].id as string
  await adm.definirChaveAtiva(real, ADMIN, { id, ativa: true })
  await adm.salvarModelo(real, ADMIN, { tarefa: 'interpretacao', modelo: CLAUDE })
  ia.chamadasFeitas = []
  await msg('gastei 6 no pix')
  assert.equal(ia.chamadasFeitas[0].nome, 'anthropic:interpretacao')
  ia.chamadasFeitas = []
  ia.erroAnthropic = { status: 529, corpo: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) }
  const r = await msg('gastei 7 na padaria')
  assert.match(r, /saiu R\$ 7,00/)
  assert.equal(ia.chamadasFeitas.at(-1)!.modelo, MODELO_FABRICA)
})

fim()
process.exit(0)
