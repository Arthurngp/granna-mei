/**
 * Aba Configurações do admin: modelo de IA (para todos e individual por cliente) e chave de API (server/src/ia-config.ts e ia-config-admin.ts).
 * Banco e IA falsos em memória; a IA falsa registra o modelo e a chave de CADA chamada, então o teste prova o que a OpenAI de verdade receberia.
 * Regra de ouro provada aqui: sem configuração, ou com qualquer falha ao lê-la, tudo segue como antes (modelo de fábrica, chave do ambiente).
 *   npx tsx test/ia-config.ts
 */
import assert from 'node:assert/strict'
import { acao, acoes, caso, E, fim, ia, lancsU1, msg, msgAudio, msgFoto, processar, semear, U1, U2 } from './_falsos.ts'

process.env.IA_SEGREDO = 'segredo-de-teste-com-mais-de-dezesseis-letras'
const cfg = await import('../src/ia-config.ts')
const adm = await import('../src/ia-config-admin.ts')
const { limparCacheIA, MODELO_FABRICA, MODELO_AUDIO_FABRICA, cifrar, decifrar } = cfg

const CHAVE_AMBIENTE = process.env.OPENAI_API_KEY!
const CHAVE_BANCO = 'sk-chave-cadastrada-na-tela-1234567890abcdef'
const interp = () => ia.chamadasFeitas.filter((c) => c.nome === 'interpretacao')
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
  ia.regras = [
    [/gastei 6/, acoes(acao({ valor: 6 }))],
    [/Internet/, acoes(acao({ valor: 6, descricao: 'Internet' }))],
  ]
}
const global = (tarefa: string, modelo: string) => E.tabelas.config_ia_modelo = [...(E.tabelas.config_ia_modelo ?? []), { tarefa, modelo }]
const doCliente = (user_id: string, tarefa: string, modelo: string) => E.tabelas.ia_modelo_cliente = [...(E.tabelas.ia_modelo_cliente ?? []), { user_id, tarefa, modelo }]

/* ---------- a regra de ouro: sem configuração, nada muda ---------- */

await caso('sem nada configurado: modelo de FÁBRICA e chave do AMBIENTE em todas as tarefas (o comportamento de hoje)', async () => {
  novo()
  const r = await msg('gastei 6 no pix')
  assert.match(r, /saiu R\$ 6,00/)
  assert.equal(interp()[0].modelo, MODELO_FABRICA)
  assert.equal(interp()[0].chave, CHAVE_AMBIENTE)
  const f = await msgFoto('f1.jpg', 'Internet')
  assert.ok(f.resposta)
  assert.equal(ia.chamadasFeitas.find((c) => c.nome === 'documento')!.modelo, MODELO_FABRICA)
  await msgAudio('a1.ogg')
  assert.equal(ia.chamadasFeitas.find((c) => c.nome === 'audio')!.modelo, MODELO_AUDIO_FABRICA)
})

await caso('falha ao LER a configuração (tabela fora do ar): a conversa segue com o padrão e grava normalmente', async () => {
  novo()
  global('interpretacao', 'modelo-global-x')
  E.falharTabela = 'config_ia_modelo'
  const r = await msg('gastei 6 no pix')
  E.falharTabela = null
  assert.match(r, /saiu R\$ 6,00/)
  assert.equal(interp()[0].modelo, MODELO_FABRICA, 'não conseguiu ler: usa o de fábrica')
  assert.equal(lancsU1().length, 1)
})

await caso('valor inválido no banco (nome de modelo com lixo) é ignorado, nunca vai para a OpenAI', async () => {
  novo()
  global('interpretacao', 'x; rm -rf /')
  doCliente(U1, 'interpretacao', '../../etc')
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].modelo, MODELO_FABRICA)
})

/* ---------- ordem: cliente > todos > fábrica ---------- */

await caso('modelo para TODOS: vale na próxima mensagem; só a tarefa configurada muda (o comprovante segue no de fábrica)', async () => {
  novo()
  global('interpretacao', 'modelo-global-x')
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].modelo, 'modelo-global-x')
  ia.chamadasFeitas = []
  await msgFoto('f1.jpg', 'Internet')
  assert.equal(ia.chamadasFeitas.find((c) => c.nome === 'documento')!.modelo, MODELO_FABRICA, 'ler comprovante não foi configurado')
  assert.equal(ia.chamadasFeitas.find((c) => c.nome === 'interpretacao')!.modelo, 'modelo-global-x')
})

await caso('modelo INDIVIDUAL vence o de todos, e os outros clientes NÃO são afetados', async () => {
  novo()
  global('interpretacao', 'modelo-global-x')
  doCliente(U1, 'interpretacao', 'modelo-so-do-u1')
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].modelo, 'modelo-so-do-u1', 'o cliente com modelo próprio usa o dele')
  ia.chamadasFeitas = []
  await msgComoU2('gastei 6 no pix')
  assert.equal(interp()[0].modelo, 'modelo-global-x', 'outro cliente usa o de todos, não o do U1')
})

await caso('modelo individual de UMA tarefa não muda as outras tarefas desse cliente', async () => {
  novo()
  doCliente(U1, 'documento', 'visao-so-do-u1')
  await msgFoto('f1.jpg', 'Internet')
  assert.equal(ia.chamadasFeitas.find((c) => c.nome === 'documento')!.modelo, 'visao-so-do-u1')
  assert.equal(ia.chamadasFeitas.find((c) => c.nome === 'interpretacao')!.modelo, MODELO_FABRICA)
})

await caso('o cache de 60 s é limpo quando o admin muda: a próxima mensagem já usa o modelo novo', async () => {
  novo()
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].modelo, MODELO_FABRICA)
  global('interpretacao', 'modelo-novo')
  const antes = interp().length
  await msg('gastei 6 no pix')
  assert.equal(interp()[antes].modelo, MODELO_FABRICA, 'sem limpar o cache vale o de antes (60 s)')
  limparCacheIA()
  await msg('gastei 6 no pix')
  assert.equal(interp().at(-1)!.modelo, 'modelo-novo')
})

/* ---------- fallback ---------- */

await caso('modelo configurado que a OpenAI RECUSA (nome errado, sem acesso): repete na hora com o de fábrica e a mensagem é atendida', async () => {
  novo()
  global('interpretacao', 'modelo-que-nao-existe')
  ia.recusarModelos.add('modelo-que-nao-existe')
  const r = await msg('gastei 6 no pix')
  assert.match(r, /saiu R\$ 6,00/, 'a pessoa nem percebe')
  assert.deepEqual(interp().map((c) => c.modelo), ['modelo-que-nao-existe', MODELO_FABRICA])
  assert.equal(lancsU1().length, 1, 'um lançamento só')
})

await caso('o fallback é só para modelo recusado: cota esgotada NÃO repete com outro modelo (não gasta à toa)', async () => {
  novo()
  global('interpretacao', 'modelo-global-x')
  ia.erro = { status: 429, corpo: JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }) }
  await msg('gastei 6 no pix')
  assert.equal(ia.pedidos, 1, 'uma tentativa só: sem cota não adianta trocar de modelo')
})

await caso('modelo de áudio recusado: volta ao de fábrica e transcreve', async () => {
  novo()
  global('audio', 'transcricao-que-nao-existe')
  ia.recusarModelos.add('transcricao-que-nao-existe')
  ia.regras = [[/gasolina/, acoes(acao({ valor: 50, descricao: 'Gasolina' }))]]
  const r = await msgAudio('a1.ogg')
  assert.ok(r.resposta)
  assert.deepEqual(ia.chamadasFeitas.filter((c) => c.nome === 'audio').map((c) => c.modelo), ['transcricao-que-nao-existe', MODELO_AUDIO_FABRICA])
})

/* ---------- chave ---------- */

await caso('chave cadastrada e ATIVA: é a usada, decifrada só no servidor', async () => {
  novo()
  E.tabelas.ia_chaves = [{ id: 'k1', provedor: 'openai', ativa: true, chave_cifrada: cifrar(CHAVE_BANCO), atualizado_em: new Date().toISOString() }]
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].chave, CHAVE_BANCO)
})

await caso('chave cadastrada mas DESLIGADA não é usada (nasce desligada)', async () => {
  novo()
  E.tabelas.ia_chaves = [{ id: 'k1', provedor: 'openai', ativa: false, chave_cifrada: cifrar(CHAVE_BANCO) }]
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].chave, CHAVE_AMBIENTE)
})

await caso('chave cifrada que não abre (segredo mudou, texto corrompido): usa a do ambiente, sem parar', async () => {
  novo()
  E.tabelas.ia_chaves = [{ id: 'k1', provedor: 'openai', ativa: true, chave_cifrada: 'v1:AAAA:BBBB:CCCC', atualizado_em: new Date().toISOString() }]
  const r = await msg('gastei 6 no pix')
  assert.match(r, /saiu R\$ 6,00/)
  assert.equal(interp()[0].chave, CHAVE_AMBIENTE)
})

await caso('chave cadastrada RECUSADA pela OpenAI (revogada): volta à chave do ambiente e a mensagem é atendida', async () => {
  novo()
  E.tabelas.ia_chaves = [{ id: 'k1', provedor: 'openai', ativa: true, chave_cifrada: cifrar(CHAVE_BANCO), atualizado_em: new Date().toISOString() }]
  ia.recusarChaves.add(CHAVE_BANCO)
  const r = await msg('gastei 6 no pix')
  assert.match(r, /saiu R\$ 6,00/)
  assert.deepEqual(ia.chamadasFeitas.map((c) => c.chave), [CHAVE_BANCO, CHAVE_AMBIENTE], 'a recusada e depois a do ambiente')
})

await caso('cifra: ida e volta, o texto cifrado não contém a chave, cada cifra é diferente, adulterar quebra e sem segredo recusa', async () => {
  const c1 = cifrar(CHAVE_BANCO)
  const c2 = cifrar(CHAVE_BANCO)
  assert.equal(decifrar(c1), CHAVE_BANCO)
  assert.ok(!c1.includes(CHAVE_BANCO) && !c1.includes('sk-'), 'não vaza a chave no texto cifrado')
  assert.notEqual(c1, c2, 'IV novo a cada vez')
  const partes = c1.split(':')
  partes[3] = Buffer.from('adulterado' + partes[3]).toString('base64')
  assert.throws(() => decifrar(partes.join(':')), 'texto adulterado não abre')
  const seg = process.env.IA_SEGREDO
  process.env.IA_SEGREDO = ''
  assert.throws(() => cifrar('qualquer'), /IA_SEGREDO/)
  assert.throws(() => decifrar(c1), /IA_SEGREDO/)
  process.env.IA_SEGREDO = seg
  assert.equal(decifrar(c1), CHAVE_BANCO)
})

/* ---------- operações do admin ---------- */

const auditoria: { acao: string; detalhes: Record<string, unknown>; alvo?: string }[] = []
const ADMIN = '00000000-0000-0000-0000-0000000000aa'
const UUID_U1 = '00000000-0000-0000-0000-000000000001'
const fake = (testar: (m: string, c?: string) => Promise<{ ok: boolean; detalhe: string }> = async () => ({ ok: true, detalhe: 'respondeu' })) => {
  auditoria.length = 0
  const { sb } = { sb: null as never }
  void sb
  return { sb: null as never, testar, auditar: async (_a: string, acao: string, detalhes: Record<string, unknown>, alvo?: string) => void auditoria.push({ acao, detalhes, alvo }) }
}
const { sb: sbReal } = await import('../src/banco.ts')
const deps = (testar?: Parameters<typeof fake>[0]) => ({ ...fake(testar), sb: sbReal })
const perfilCliente = (id: string) => (E.tabelas.perfis = [...(E.tabelas.perfis ?? []).filter((p) => p.id !== id), { id, nome: 'Cliente ' + id.slice(-2), negocio: 'Loja', papel: 'cliente' }])

await caso('listar: sem a migration (tabela fora) avisa "pronto: false" e não quebra', async () => {
  novo()
  E.falharTabela = 'config_ia_modelo'
  const l = await adm.listar(deps())
  E.falharTabela = null
  assert.equal(l.pronto, false)
})

await caso('listar: nunca devolve a chave nem o texto cifrado, só os 4 últimos caracteres', async () => {
  novo()
  perfilCliente(UUID_U1)
  E.tabelas.ia_chaves = [{ id: 'k1', provedor: 'openai', nome: 'Minha chave', ultimos4: CHAVE_BANCO.slice(-4), ativa: true, testada_em: 'agora', criado_em: 'agora', chave_cifrada: cifrar(CHAVE_BANCO) }]
  E.tabelas.ia_modelo_cliente = [{ user_id: UUID_U1, tarefa: 'documento', modelo: 'visao-x' }]
  const l = await adm.listar(deps())
  const texto = JSON.stringify(l)
  assert.ok(!texto.includes(CHAVE_BANCO) && !texto.includes('chave_cifrada') && !texto.includes('v1:'), 'nada de chave nem de cifra na resposta')
  assert.equal(l.chaves[0].ultimos4, CHAVE_BANCO.slice(-4))
  assert.equal(l.chave_em_uso, 'banco')
  assert.equal(l.clientes[0].modelo, 'visao-x')
  assert.equal(l.tarefas.length, 5)
})

await caso('salvar modelo para todos: TESTA antes; se responde, grava, audita (antes e depois) e vale na próxima mensagem', async () => {
  novo()
  await msg('gastei 6 no pix') // enche o cache com o padrão: a mudança do admin tem que ESVAZIÁ-LO para valer já
  assert.equal(interp()[0].modelo, MODELO_FABRICA)
  let testado = ''
  const r = await adm.salvarModelo(deps(async (m) => ((testado = m), { ok: true, detalhe: 'respondeu' })), ADMIN, { tarefa: 'interpretacao', modelo: 'modelo-bom' })
  assert.equal(testado, 'modelo-bom')
  assert.equal(r.vale, 'modelo-bom')
  assert.deepEqual(E.tabelas.config_ia_modelo.map((x) => [x.tarefa, x.modelo]), [['interpretacao', 'modelo-bom']])
  assert.deepEqual(auditoria[0], { acao: 'ia_modelo', detalhes: { tarefa: 'interpretacao', antes: null, depois: 'modelo-bom', escopo: 'todos' }, alvo: undefined })
  await msg('gastei 6 no pix')
  assert.equal(interp().at(-1)!.modelo, 'modelo-bom', 'o cache foi limpo: já vale na próxima mensagem')
})

await caso('salvar modelo que NÃO responde: nada é alterado e a mensagem diz o motivo', async () => {
  novo()
  await assert.rejects(adm.salvarModelo(deps(async () => ({ ok: false, detalhe: 'OpenAI 404: model_not_found' })), ADMIN, { tarefa: 'interpretacao', modelo: 'modelo-ruim' }), (e: Error & { status?: number }) => e.status === 400 && /não respondeu/.test(e.message) && /Nada foi alterado/.test(e.message))
  assert.equal((E.tabelas.config_ia_modelo ?? []).length, 0)
  assert.equal(auditoria.length, 0, 'nada para auditar')
})

await caso('salvar: tarefa desconhecida, nome com lixo ou vazio são recusados antes de qualquer chamada', async () => {
  novo()
  let chamadas = 0
  const d = deps(async () => (chamadas++, { ok: true, detalhe: '' }))
  for (const corpo of [{ tarefa: 'hackear', modelo: 'x1' }, { tarefa: 'interpretacao', modelo: 'a b; drop' }, { tarefa: 'interpretacao', modelo: '../x' }, { tarefa: 'interpretacao', modelo: undefined }, { tarefa: 'interpretacao', modelo: 'x'.repeat(200) }]) {
    await assert.rejects(adm.salvarModelo(d, ADMIN, corpo as never), (e: Error & { status?: number }) => e.status === 400, JSON.stringify(corpo))
  }
  assert.equal(chamadas, 0)
  assert.equal((E.tabelas.config_ia_modelo ?? []).length, 0)
})

await caso('voltar ao padrão (modelo nulo) apaga o de todos e audita; áudio não é testado como chat', async () => {
  novo()
  global('interpretacao', 'modelo-bom')
  const r = await adm.salvarModelo(deps(), ADMIN, { tarefa: 'interpretacao', modelo: null })
  assert.equal(r.vale, MODELO_FABRICA)
  assert.equal(E.tabelas.config_ia_modelo.length, 0)
  assert.deepEqual(auditoria[0].detalhes, { tarefa: 'interpretacao', antes: 'modelo-bom', depois: null, escopo: 'todos' })
  let testes = 0
  await adm.salvarModelo(deps(async () => (testes++, { ok: true, detalhe: '' })), ADMIN, { tarefa: 'audio', modelo: 'whisper-x' })
  assert.equal(testes, 0, 'modelo de transcrição não passa pela chamada mínima de chat')
  assert.equal(E.tabelas.config_ia_modelo[0].modelo, 'whisper-x')
})

await caso('modelo individual: só para cliente de verdade (admin e inexistente são recusados), audita com o cliente e vale só para ele', async () => {
  novo()
  perfilCliente(UUID_U1)
  E.tabelas.perfis.push({ id: ADMIN, nome: 'Admin', negocio: '', papel: 'admin' })
  await assert.rejects(adm.salvarModeloCliente(deps(), ADMIN, { user_id: ADMIN, tarefa: 'interpretacao', modelo: 'm1' }), (e: Error & { status?: number }) => e.status === 404)
  await assert.rejects(adm.salvarModeloCliente(deps(), ADMIN, { user_id: '00000000-0000-0000-0000-00000000ffff', tarefa: 'interpretacao', modelo: 'm1' }), (e: Error & { status?: number }) => e.status === 404)
  await assert.rejects(adm.salvarModeloCliente(deps(), ADMIN, { user_id: 'nao-e-uuid', tarefa: 'interpretacao', modelo: 'm1' }), (e: Error & { status?: number }) => e.status === 400)
  await adm.salvarModeloCliente(deps(), ADMIN, { user_id: UUID_U1, tarefa: 'interpretacao', modelo: 'modelo-individual' })
  assert.deepEqual(E.tabelas.ia_modelo_cliente.map((x) => [x.user_id, x.tarefa, x.modelo]), [[UUID_U1, 'interpretacao', 'modelo-individual']])
  assert.deepEqual([auditoria[0].acao, auditoria[0].alvo, auditoria[0].detalhes.escopo], ['ia_modelo', UUID_U1, 'cliente'])
  await adm.salvarModeloCliente(deps(), ADMIN, { user_id: UUID_U1, tarefa: 'interpretacao', modelo: null })
  assert.equal(E.tabelas.ia_modelo_cliente.length, 0, 'tirar o individual volta ao de todos')
})

await caso('cadastrar chave: sem segredo no servidor é recusado e nada é guardado', async () => {
  novo()
  const seg = process.env.IA_SEGREDO
  process.env.IA_SEGREDO = ''
  await assert.rejects(adm.adicionarChave(deps(), ADMIN, { nome: 'x', chave: CHAVE_BANCO }), (e: Error & { status?: number }) => e.status === 400 && /IA_SEGREDO/.test(e.message))
  process.env.IA_SEGREDO = seg
  assert.equal((E.tabelas.ia_chaves ?? []).length, 0)
})

await caso('cadastrar chave: formato ruim e chave que NÃO funciona são recusados, e a mensagem de erro nunca contém a chave', async () => {
  novo()
  for (const chave of ['curta', 'tem espaço no meio da chave 1234567890', '']) await assert.rejects(adm.adicionarChave(deps(), ADMIN, { nome: 'x', chave }), (e: Error & { status?: number }) => e.status === 400)
  await assert.rejects(adm.adicionarChave(deps(), ADMIN, { nome: '', chave: CHAVE_BANCO }), (e: Error & { status?: number }) => e.status === 400)
  await assert.rejects(
    adm.adicionarChave(deps(async (_m, c) => ({ ok: false, detalhe: `OpenAI 401: Incorrect API key provided: ${c}` })), ADMIN, { nome: 'Teste', chave: CHAVE_BANCO }),
    (e: Error & { status?: number }) => e.status === 400 && !e.message.includes(CHAVE_BANCO) && /não funcionou/.test(e.message),
  )
  assert.equal((E.tabelas.ia_chaves ?? []).length, 0)
  assert.equal(auditoria.length, 0)
})

await caso('cadastrar chave que funciona: guarda CIFRADA, DESLIGADA, com os 4 últimos; a auditoria não leva a chave', async () => {
  novo()
  let testadaCom = ''
  const r = await adm.adicionarChave(deps(async (_m, c) => ((testadaCom = c ?? ''), { ok: true, detalhe: 'respondeu' })), ADMIN, { nome: 'Chave nova', chave: ` ${CHAVE_BANCO} ` })
  assert.equal(testadaCom, CHAVE_BANCO, 'testou com a chave informada')
  const linha = E.tabelas.ia_chaves[0]
  assert.equal(r.id, linha.id)
  assert.equal(linha.ativa, false, 'nasce desligada')
  assert.equal(linha.ultimos4, CHAVE_BANCO.slice(-4))
  assert.ok(!String(linha.chave_cifrada).includes(CHAVE_BANCO) && decifrar(String(linha.chave_cifrada)) === CHAVE_BANCO)
  assert.ok(!JSON.stringify(auditoria).includes(CHAVE_BANCO), 'a auditoria não guarda a chave')
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].chave, CHAVE_AMBIENTE, 'desligada: ainda vale a do ambiente')
})

await caso('ativar chave: testa de novo, desliga a que estava ligada (só uma por vez) e passa a valer; desativar volta ao ambiente', async () => {
  novo()
  E.tabelas.ia_chaves = [
    { id: '11111111-1111-1111-1111-111111111111', provedor: 'openai', nome: 'Velha', ultimos4: 'aaaa', ativa: true, chave_cifrada: cifrar('sk-velha-chave-de-teste-1234567890') },
    { id: '22222222-2222-2222-2222-222222222222', provedor: 'openai', nome: 'Nova', ultimos4: 'bbbb', ativa: false, chave_cifrada: cifrar(CHAVE_BANCO) },
  ]
  const d = deps()
  await adm.definirChaveAtiva(d, ADMIN, { id: '22222222-2222-2222-2222-222222222222', ativa: true })
  assert.deepEqual(E.tabelas.ia_chaves.map((k) => [k.nome, k.ativa]), [['Velha', false], ['Nova', true]], 'só uma ligada')
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].chave, CHAVE_BANCO)
  await adm.definirChaveAtiva(d, ADMIN, { id: '22222222-2222-2222-2222-222222222222', ativa: false })
  ia.chamadasFeitas = []
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].chave, CHAVE_AMBIENTE, 'desligou: volta à do ambiente')
  assert.deepEqual(auditoria.map((a) => a.acao), ['ia_chave_ativar', 'ia_chave_desativar'])
})

await caso('ativar chave que não funciona mais: recusa e a que estava valendo continua', async () => {
  novo()
  E.tabelas.ia_chaves = [
    { id: '11111111-1111-1111-1111-111111111111', provedor: 'openai', nome: 'Velha', ultimos4: 'aaaa', ativa: true, chave_cifrada: cifrar('sk-velha-chave-de-teste-1234567890') },
    { id: '22222222-2222-2222-2222-222222222222', provedor: 'openai', nome: 'Nova', ultimos4: 'bbbb', ativa: false, chave_cifrada: cifrar(CHAVE_BANCO) },
  ]
  await assert.rejects(adm.definirChaveAtiva(deps(async () => ({ ok: false, detalhe: 'sem saldo' })), ADMIN, { id: '22222222-2222-2222-2222-222222222222', ativa: true }), (e: Error & { status?: number }) => e.status === 400 && /ontinua valendo/.test(e.message))
  assert.deepEqual(E.tabelas.ia_chaves.map((k) => [k.nome, k.ativa]), [['Velha', true], ['Nova', false]])
})

await caso('remover chave: some e a auditoria diz se estava ativa; id inválido ou inexistente é recusado', async () => {
  novo()
  E.tabelas.ia_chaves = [{ id: '11111111-1111-1111-1111-111111111111', provedor: 'openai', nome: 'Velha', ultimos4: 'aaaa', ativa: true, chave_cifrada: cifrar(CHAVE_BANCO) }]
  await assert.rejects(adm.removerChave(deps(), ADMIN, { id: 'x' }), (e: Error & { status?: number }) => e.status === 400)
  await assert.rejects(adm.removerChave(deps(), ADMIN, { id: '99999999-9999-9999-9999-999999999999' }), (e: Error & { status?: number }) => e.status === 404)
  await adm.removerChave(deps(), ADMIN, { id: '11111111-1111-1111-1111-111111111111' })
  assert.equal(E.tabelas.ia_chaves.length, 0)
  assert.equal(auditoria[0].detalhes.estava_ativa, true)
  await msg('gastei 6 no pix')
  assert.equal(interp()[0].chave, CHAVE_AMBIENTE)
})

await caso('integração com a IA falsa (teste de verdade): modelo que a IA recusa não é salvo; chave recusada não é guardada', async () => {
  novo()
  const real = adm.depsReais(sbReal, async () => {})
  ia.recusarModelos.add('nao-existe')
  await assert.rejects(adm.salvarModelo(real, ADMIN, { tarefa: 'interpretacao', modelo: 'nao-existe' }), (e: Error & { status?: number }) => e.status === 400)
  assert.equal((E.tabelas.config_ia_modelo ?? []).length, 0)
  const r = await adm.salvarModelo(real, ADMIN, { tarefa: 'interpretacao', modelo: 'existe-sim' })
  assert.equal(r.vale, 'existe-sim')
  assert.equal(ia.chamadasFeitas.at(-1)!.modelo, 'existe-sim', 'o teste foi feito com o modelo escolhido')
  ia.recusarChaves.add(CHAVE_BANCO)
  await assert.rejects(adm.adicionarChave(real, ADMIN, { nome: 'Ruim', chave: CHAVE_BANCO }), (e: Error & { status?: number }) => e.status === 400 && !e.message.includes(CHAVE_BANCO))
  assert.equal((E.tabelas.ia_chaves ?? []).length, 0)
  ia.recusarChaves.clear()
  await adm.adicionarChave(real, ADMIN, { nome: 'Boa', chave: CHAVE_BANCO })
  assert.equal(ia.chamadasFeitas.at(-1)!.chave, CHAVE_BANCO, 'a chave foi testada de verdade')
  assert.equal(E.tabelas.ia_chaves.length, 1)
})

void U2
fim()
process.exit(0)
