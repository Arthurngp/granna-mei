/**
 * Envio manual pedido pelo admin: o ciclo da fila, com relógio, banco e gateway falsos.
 *
 * O que está em jogo: o botão do admin manda mensagem de verdade, pelo número que o Arthur tem medo de ver bloqueado. Cada caso aqui é uma
 * trava: 5 minutos entre envios (medidos NO BANCO, não na memória), um envio por ciclo, janela 9h às 19h, WhatsApp conectado, teto do dia,
 * conferir de novo se a pessoa respondeu SAIR, falha não é refeita sozinha, e o princípio de que EM DÚVIDA NÃO ENVIA.
 *   npx tsx test/envio-manual.ts
 */
import assert from 'node:assert/strict'

const M = await import('../src/envio-manual.ts')
const R = await import('../src/retencao.ts')
type Deps = import('../src/envio-manual.ts').DepsManual
type Pedido = import('../src/envio-manual.ts').PedidoManual
type Alvo = import('../src/envio-manual.ts').AlvoManual

let ok = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  M.zerarEstadoManual()
  try {
    await fn()
    ok++
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 600))
  }
}

/** Um instante pelo relógio de São Paulo (sem horário de verão, UTC-3). */
const em = (hhmm: string, dia = '2026-11-23') => new Date(`${dia}T${hhmm}:00-03:00`)
const minAntes = (d: Date, min: number) => new Date(d.getTime() - min * 60_000).toISOString()

const pedido = (n: number, frio = false): Pedido => ({ id: `p${n}`, user_id: `u${n}`, contato_frio: frio, texto: `Oi, Pessoa${n}! Aqui é da Granninha. Vi que você já conectou seu WhatsApp, mas ainda não mandou o primeiro lançamento.` })

interface Opt {
  fila?: Pedido[]
  conectado?: boolean | Error
  manuaisHoje?: number
  ultimoEnvioEm?: string | null
  movimentoErro?: boolean
  proximoErro?: boolean
  outro?: boolean
  falharEnvio?: boolean
  recusa?: string
  reservarGanha?: boolean
}

/** Um banco de brinquedo: a fila e o "último envio" andam juntos, como no banco de verdade. */
function fake(opt: Opt = {}) {
  const fila = [...(opt.fila ?? [])]
  const enviados: { tel: string; texto: string }[] = []
  const resultados: { id: string; ok: boolean; erro?: string }[] = []
  const chamadas = { gateway: 0, reservar: 0, enviar: 0, apto: 0, forcar: [] as boolean[] }
  let ultimo: string | null = opt.ultimoEnvioEm ?? null
  let relogio = new Date()
  const deps: Deps = {
    liberarPresos: async () => undefined,
    proximo: async () => {
      if (opt.proximoErro) throw new Error('tabela não existe')
      return fila[0] ?? null
    },
    apto: async (_u, forcar): Promise<Alvo> => {
      chamadas.apto++
      chamadas.forcar.push(forcar)
      return { telefone: opt.recusa ? null : '558199990001', nome: 'Pessoa Silva', recusa: opt.recusa ?? null }
    },
    gatewayConectado: async () => {
      chamadas.gateway++
      if (opt.conectado instanceof Error) throw opt.conectado
      return opt.conectado ?? true
    },
    movimento: async () => {
      if (opt.movimentoErro) throw new Error('não consegui contar')
      return { manuaisHoje: opt.manuaisHoje ?? 0, ultimoEnvioEm: ultimo }
    },
    reservar: async () => {
      chamadas.reservar++
      return opt.reservarGanha ?? true
    },
    concluir: async (p, r) => {
      resultados.push({ id: p.id, ok: r.ok, erro: r.ok ? undefined : r.erro })
      fila.splice(fila.findIndex((x) => x.id === p.id), 1)
    },
    enviar: async (tel, texto) => {
      chamadas.enviar++
      if (opt.falharEnvio) throw new Error('gateway recusou')
      enviados.push({ tel, texto })
      ultimo = relogio.toISOString() // o envio entra em `avisos`: é o que o banco enxerga no próximo ciclo
    },
    outroCicloAndando: () => opt.outro ?? false,
  }
  const rodar = (quando: Date) => {
    relogio = quando
    return M.rodarEnvioManual(deps, quando)
  }
  return { deps, enviados, resultados, chamadas, fila, rodar }
}

/* ---------------- as travas ---------------- */

await caso('as travas são as combinadas: 5 minutos entre envios, 15 manuais por dia, 3 falhas seguidas param por 30 minutos', async () => {
  assert.equal(M.ESPERA_MANUAL_MINUTOS, 5)
  assert.equal(M.TETO_MANUAL_POR_DIA, 15)
  assert.equal(M.FALHAS_MANUAIS_PARA_PARAR, 3)
  assert.equal(M.PAUSA_MANUAL_MS, 30 * 60_000)
  assert.equal(R.JANELA_DE, '09:00')
  assert.equal(R.JANELA_ATE, '19:00')
})

await caso('fila vazia: não faz nada e nem pergunta pelo WhatsApp', async () => {
  const f = fake()
  const log = await f.rodar(em('10:00'))
  assert.deepEqual(log, [])
  assert.equal(f.chamadas.gateway, 0)
  assert.equal(f.enviados.length, 0)
})

await caso('envia o pedido: o texto termina SEMPRE com a linha do SAIR e o pedido é dado como enviado', async () => {
  const f = fake({ fila: [pedido(1)] })
  await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 1)
  assert.equal(f.enviados[0].tel, '558199990001')
  assert.ok(f.enviados[0].texto.endsWith(R.RODAPE_SAIR), 'a linha do SAIR é a última')
  assert.match(f.enviados[0].texto, /^Oi, Pessoa1!/)
  assert.deepEqual(f.resultados, [{ id: 'p1', ok: true, erro: undefined }])
})

/* ---------------- os 5 minutos ---------------- */

await caso('a espera é de 5 minutos cheios desde o último envio de QUALQUER tipo, medida no banco', async () => {
  const quando = em('10:00')
  const quatro = fake({ fila: [pedido(1)], ultimoEnvioEm: minAntes(quando, 4.9) })
  await quatro.rodar(quando)
  assert.equal(quatro.enviados.length, 0, 'faltam 6 segundos: espera')
  assert.equal(quatro.fila.length, 1, 'o pedido continua na fila')
  M.zerarEstadoManual()
  const cinco = fake({ fila: [pedido(1)], ultimoEnvioEm: minAntes(quando, 5) })
  await cinco.rodar(quando)
  assert.equal(cinco.enviados.length, 1, 'com 5 minutos exatos, sai')
})

await caso('dois cliques seguidos: o segundo entra na fila e sai sozinho 5 minutos depois do primeiro', async () => {
  const f = fake({ fila: [pedido(1), pedido(2)] })
  await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 1)
  for (const hhmm of ['10:01', '10:02', '10:03', '10:04']) {
    await f.rodar(em(hhmm))
    assert.equal(f.enviados.length, 1, `às ${hhmm} ainda espera`)
  }
  await f.rodar(em('10:05'))
  assert.equal(f.enviados.length, 2, 'às 10:05 sai o segundo')
  assert.match(f.enviados[0].texto, /Pessoa1/)
  assert.match(f.enviados[1].texto, /Pessoa2/, 'o segundo da fila é o segundo a sair')
  assert.equal(f.fila.length, 0)
})

await caso('reinício do serviço não zera a espera: ela vem do banco, não da memória do processo', async () => {
  const f = fake({ fila: [pedido(1), pedido(2)] })
  await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 1)
  M.zerarEstadoManual() // o processo reiniciou: a memória sumiu
  await f.rodar(em('10:02'))
  assert.equal(f.enviados.length, 1, 'o banco ainda lembra do envio das 10:00')
})

await caso('um envio por ciclo, mesmo com a fila cheia, e o mais antigo primeiro', async () => {
  const f = fake({ fila: [pedido(1), pedido(2), pedido(3)] })
  await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 1)
  assert.deepEqual(f.fila.map((p) => p.id), ['p2', 'p3'])
  assert.equal(f.resultados[0].id, 'p1')
})

await caso('um envio AUTOMÁTICO recente (vencimento, retenção) também segura o manual: o chip é o mesmo', async () => {
  const quando = em('10:00')
  const f = fake({ fila: [pedido(1)], ultimoEnvioEm: minAntes(quando, 2) })
  await f.rodar(quando)
  assert.equal(f.enviados.length, 0)
})

/* ---------------- janela, WhatsApp, teto ---------------- */

await caso('só das 9h às 19h (São Paulo): antes, depois e na borda', async () => {
  for (const hhmm of ['08:59', '19:00', '23:30', '03:00']) {
    M.zerarEstadoManual()
    const f = fake({ fila: [pedido(1)] })
    await f.rodar(em(hhmm))
    assert.equal(f.enviados.length, 0, `às ${hhmm} não envia`)
    assert.equal(f.fila.length, 1, 'o pedido espera na fila até 9h')
  }
  for (const hhmm of ['09:00', '18:59']) {
    M.zerarEstadoManual()
    const f = fake({ fila: [pedido(1)] })
    await f.rodar(em(hhmm))
    assert.equal(f.enviados.length, 1, `às ${hhmm} envia`)
  }
})

await caso('WhatsApp fora de CONNECTED: não envia, não reserva e o pedido continua na fila', async () => {
  const f = fake({ fila: [pedido(1)], conectado: false })
  const log = await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.equal(f.chamadas.reservar, 0)
  assert.equal(f.fila.length, 1)
  assert.match(log.join('\n'), /fora de CONNECTED/)
})

await caso('não conseguiu ler o estado do WhatsApp: em dúvida, não envia', async () => {
  const f = fake({ fila: [pedido(1)], conectado: new Error('gateway fora') })
  const log = await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join('\n'), /nada enviado/)
})

await caso('teto de 15 manuais por dia: com 14 ainda sai, com 15 fica para amanhã', async () => {
  const quatorze = fake({ fila: [pedido(1)], manuaisHoje: 14 })
  await quatorze.rodar(em('10:00'))
  assert.equal(quatorze.enviados.length, 1)
  M.zerarEstadoManual()
  const quinze = fake({ fila: [pedido(1)], manuaisHoje: 15 })
  const log = await quinze.rodar(em('10:00'))
  assert.equal(quinze.enviados.length, 0)
  assert.match(log.join('\n'), /teto do dia/)
})

/* ---------------- em dúvida, não envia ---------------- */

await caso('não conseguiu contar o movimento: não envia', async () => {
  const f = fake({ fila: [pedido(1)], movimentoErro: true })
  const log = await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join('\n'), /nada enviado/)
})

await caso('data do último envio ilegível: não envia', async () => {
  const f = fake({ fila: [pedido(1)], ultimoEnvioEm: 'invalido' })
  const log = await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join('\n'), /ilegível/)
})

await caso('sem a migration (a fila não existe): o ciclo não faz nada e não lança', async () => {
  const f = fake({ proximoErro: true })
  const log = await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join('\n'), /nada enviado/)
})

await caso('outro ciclo que fala pelo mesmo chip está no meio: este minuto não envia', async () => {
  const f = fake({ fila: [pedido(1)], outro: true })
  await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.equal(f.fila.length, 1)
})

await caso('perdeu a reserva para outro processo: não envia', async () => {
  const f = fake({ fila: [pedido(1)], reservarGanha: false })
  await f.rodar(em('10:00'))
  assert.equal(f.chamadas.reservar, 1)
  assert.equal(f.enviados.length, 0)
})

await caso('dois ciclos ao mesmo tempo: o segundo pula, e a pessoa recebe uma vez só', async () => {
  const f = fake({ fila: [pedido(1)] })
  const [a, b] = await Promise.all([f.rodar(em('10:00')), f.rodar(em('10:00'))])
  assert.equal(f.enviados.length, 1)
  assert.ok([...a, ...b].some((l) => /ainda em andamento/.test(l)))
})

/* ---------------- contato frio, autorizado pelo admin ---------------- */

await caso('contato frio autorizado: a conferência de última hora usa A MESMA autorização do pedido (senão recusaria o que o admin aprovou)', async () => {
  const f = fake({ fila: [pedido(1, true)] })
  await f.rodar(em('10:00'))
  assert.deepEqual(f.chamadas.forcar, [true])
  assert.equal(f.enviados.length, 1)
  assert.ok(f.enviados[0].texto.endsWith(R.RODAPE_SAIR), 'a linha do SAIR continua sendo a última')
})

await caso('pedido comum NÃO leva autorização: a conferência é a de sempre', async () => {
  const f = fake({ fila: [pedido(1)] })
  await f.rodar(em('10:00'))
  assert.deepEqual(f.chamadas.forcar, [false])
})

await caso('uma autorização vale só para aquele pedido: o pedido seguinte, comum, é conferido sem ela', async () => {
  const f = fake({ fila: [pedido(1, true), pedido(2)] })
  await f.rodar(em('10:00'))
  await f.rodar(em('10:05'))
  assert.deepEqual(f.chamadas.forcar, [true, false])
})

await caso('autorizado ou não, quem respondeu SAIR esperando na fila continua barrado e a fila segue', async () => {
  const f = fake({ fila: [pedido(1, true)], recusa: 'esta pessoa respondeu SAIR e não quer receber mensagem' })
  await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.equal(f.chamadas.reservar, 0)
  assert.match(f.resultados[0].erro ?? '', /respondeu SAIR/)
})

await caso('contato frio autorizado respeita as MESMAS travas: espera de 5 minutos, janela e WhatsApp', async () => {
  const quando = em('10:00')
  const espera = fake({ fila: [pedido(1, true)], ultimoEnvioEm: minAntes(quando, 3) })
  await espera.rodar(quando)
  assert.equal(espera.enviados.length, 0, 'espera')
  M.zerarEstadoManual()
  const noite = fake({ fila: [pedido(1, true)] })
  await noite.rodar(em('20:00'))
  assert.equal(noite.enviados.length, 0, 'fora da janela')
  M.zerarEstadoManual()
  const off = fake({ fila: [pedido(1, true)], conectado: false })
  await off.rodar(quando)
  assert.equal(off.enviados.length, 0, 'WhatsApp fora')
})

/* ---------------- SAIR e falhas ---------------- */

await caso('a pessoa respondeu SAIR esperando na fila: confere de novo na hora, não envia, não reserva e diz o motivo', async () => {
  const f = fake({ fila: [pedido(1)], recusa: 'esta pessoa respondeu SAIR e não quer receber mensagem' })
  await f.rodar(em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.equal(f.chamadas.reservar, 0, 'nem reserva')
  assert.equal(f.resultados.length, 1)
  assert.equal(f.resultados[0].ok, false)
  assert.match(f.resultados[0].erro ?? '', /respondeu SAIR/)
})

await caso('falha ao enviar: o pedido vira "falhou" e NÃO é refeito sozinho no ciclo seguinte', async () => {
  const f = fake({ fila: [pedido(1)], falharEnvio: true })
  await f.rodar(em('10:00'))
  assert.equal(f.chamadas.enviar, 1)
  assert.equal(f.resultados[0].ok, false)
  assert.match(f.resultados[0].erro ?? '', /gateway recusou/)
  await f.rodar(em('10:10'))
  await f.rodar(em('10:20'))
  assert.equal(f.chamadas.enviar, 1, 'a mensagem pode ter saído: quem decide é o admin, clicando de novo')
})

await caso('3 falhas seguidas param o envio manual por 30 minutos', async () => {
  const f = fake({ fila: [pedido(1), pedido(2), pedido(3), pedido(4)], falharEnvio: true })
  await f.rodar(em('10:00'))
  await f.rodar(em('10:05'))
  const log = await f.rodar(em('10:10'))
  assert.equal(f.chamadas.enviar, 3)
  assert.match(log.join('\n'), /3 falhas seguidas/)
  await f.rodar(em('10:20'))
  assert.equal(f.chamadas.enviar, 3, 'parado até 10:40')
  await f.rodar(em('10:41'))
  assert.equal(f.chamadas.enviar, 4, 'voltou')
})

/* ---------------- as consultas de verdade, contra o banco falso ---------------- */

const { caso: casoBanco, E, fim } = await import('./_falsos.ts')
const { sb } = await import('../src/banco.ts')
const { depsEnvioManualDoBanco, PRESO_APOS_MS } = await import('../src/envio-manual-banco.ts')
const { depsRetencaoDoBanco } = await import('../src/retencao-banco.ts')

function depsBanco(extra: { rpc?: unknown; conectado?: boolean } = {}) {
  const cliente = extra.rpc ? ({ from: sb.from.bind(sb), rpc: extra.rpc } as never) : sb
  const enviados: string[] = []
  return { enviados, deps: depsEnvioManualDoBanco(cliente, async (tel, texto) => void enviados.push(tel + '|' + texto), async () => extra.conectado ?? true) }
}
const linhaPedido = (n: number, extra: Record<string, unknown> = {}) => ({ id: `p${n}`, user_id: `u${n}`, grupo: 'nunca', texto: pedido(n).texto, status: 'fila', pedido_em: `2026-11-23T12:0${n}:00.000Z`, ...extra })

await casoBanco('banco: proximo devolve o pedido "fila" mais antigo e ignora os que já saíram ou foram cancelados', async () => {
  E.tabelas.envios_manuais = [linhaPedido(3), linhaPedido(1, { status: 'enviado' }), linhaPedido(2), linhaPedido(4, { status: 'cancelado' })]
  const p = await depsBanco().deps.proximo()
  assert.equal(p?.id, 'p2')
  E.tabelas.envios_manuais = [linhaPedido(1, { status: 'enviando' })]
  assert.equal(await depsBanco().deps.proximo(), null)
})

await casoBanco('banco: o pedido lido da fila traz se foi autorizado como contato frio (e, sem a coluna, vale como não autorizado)', async () => {
  E.tabelas.envios_manuais = [linhaPedido(1, { contato_frio: true })]
  assert.equal((await depsBanco().deps.proximo())?.contato_frio, true)
  E.tabelas.envios_manuais = [linhaPedido(2)]
  assert.equal((await depsBanco().deps.proximo())?.contato_frio, false, 'sem autorização gravada, não é contato frio autorizado')
})

await casoBanco('banco: reservar é atômico e grava o envio em avisos (tipo retencao_manual) para os lembretes enxergarem', async () => {
  E.tabelas.envios_manuais = [linhaPedido(1)]
  E.tabelas.avisos = []
  const { deps } = depsBanco()
  const p = (await deps.proximo())!
  assert.equal(await deps.reservar(p, '558199990001'), true)
  assert.equal(await deps.reservar(p, '558199990001'), false, 'segunda chamada não reserva: já está "enviando"')
  assert.equal(E.tabelas.envios_manuais[0].status, 'enviando')
  assert.ok(E.tabelas.envios_manuais[0].iniciado_em, 'guarda quando começou')
  assert.equal(E.tabelas.avisos.length, 1)
  assert.equal(E.tabelas.avisos[0].chave, 'man:p1')
  assert.equal(E.tabelas.avisos[0].tipo, 'retencao_manual')
  assert.equal(E.tabelas.avisos[0].status, 'enviando')
  assert.equal(E.tabelas.avisos[0].para, '558199990001')
})

await casoBanco('banco: não conseguiu registrar em avisos: devolve o pedido à fila e NÃO envia (sem o registro a espera de 5 minutos não o enxerga)', async () => {
  E.tabelas.envios_manuais = [linhaPedido(1)]
  E.tabelas.avisos = []
  E.falharEscritaEm = 'avisos'
  const { deps } = depsBanco()
  await assert.rejects(deps.reservar((await deps.proximo())!, '558199990001'), /reservar em avisos/)
  assert.equal(E.tabelas.envios_manuais[0].status, 'fila', 'voltou para a fila')
  // No ciclo inteiro: o erro encerra o ciclo sem enviar e o pedido segue na fila.
  const f = depsBanco({ rpc: async () => ({ data: [{ telefone: '558199990001', nome: 'Ana', recusa: null }], error: null }) })
  M.zerarEstadoManual()
  const log = await M.rodarEnvioManual(f.deps, em('10:00'))
  E.falharEscritaEm = null
  assert.equal(f.enviados.length, 0, 'nada saiu')
  assert.match(log.join('\n'), /nada enviado/)
  assert.equal(E.tabelas.envios_manuais[0].status, 'fila')
})

await casoBanco('banco: concluir com sucesso marca os dois lados; com falha solta a reserva e guarda o motivo', async () => {
  E.tabelas.envios_manuais = [linhaPedido(1), linhaPedido(2)]
  E.tabelas.avisos = []
  const { deps } = depsBanco()
  const a = { id: 'p1', user_id: 'u1', texto: pedido(1).texto }
  const b = { id: 'p2', user_id: 'u2', texto: pedido(2).texto }
  await deps.reservar(a, '558199990001')
  await deps.reservar(b, '558199990002')
  await deps.concluir(a, { ok: true })
  await deps.concluir(b, { ok: false, erro: 'gateway recusou' })
  const ea = E.tabelas.envios_manuais.find((x) => x.id === 'p1')!
  const eb = E.tabelas.envios_manuais.find((x) => x.id === 'p2')!
  assert.equal(ea.status, 'enviado')
  assert.ok(ea.enviado_em)
  assert.equal(eb.status, 'falhou')
  assert.equal(eb.erro, 'gateway recusou')
  assert.deepEqual(E.tabelas.avisos.map((x) => `${x.chave}:${x.status}`), ['man:p1:enviado'], 'a falha não deixa registro de envio que não houve')
  assert.ok(E.tabelas.avisos[0].enviado_em)
})

await casoBanco('banco: movimento conta só os manuais de hoje, e o "último envio" é o de QUALQUER tipo', async () => {
  const hoje = new Date().toISOString()
  const ontem = new Date(Date.now() - 36 * 3600_000).toISOString()
  const dois = new Date(Date.now() - 2 * 60_000).toISOString()
  E.tabelas.avisos = [
    { chave: 'man:a', tipo: 'retencao_manual', criado_em: hoje, enviado_em: hoje },
    { chave: 'man:b', tipo: 'retencao_manual', criado_em: ontem, enviado_em: ontem },
    { chave: 'ret:x', tipo: 'retencao_nunca', criado_em: hoje, enviado_em: hoje },
    { chave: 'venc:y', tipo: 'vencimento', criado_em: dois, enviado_em: null },
  ]
  const m = await depsBanco().deps.movimento(new Date(Date.now() - 3600_000).toISOString())
  assert.equal(m.manuaisHoje, 1, 'só o manual de hoje')
  assert.ok(m.ultimoEnvioEm && Math.abs(Date.parse(m.ultimoEnvioEm) - Date.parse(hoje)) < 5000, 'o mais recente de qualquer tipo')
})

await casoBanco('banco: o aviso do envio manual aparece para os lembretes automáticos (espera de 3 minutos e 48 horas por pessoa)', async () => {
  E.tabelas.envios_manuais = [linhaPedido(1)]
  E.tabelas.avisos = []
  E.tabelas.config_retencao = []
  const { deps } = depsBanco()
  await deps.reservar((await deps.proximo())!, '558199990001')
  await deps.concluir({ id: 'p1', user_id: 'u1', texto: '' }, { ok: true })
  const auto = depsRetencaoDoBanco(sb, async () => undefined, async () => true, () => [])
  const mov = await auto.movimento(new Date(Date.now() - 3600_000).toISOString())
  assert.ok(mov.ultimoEnvioEm, 'a retenção automática enxerga o envio manual como o mais recente')
  assert.ok(Date.now() - Date.parse(mov.ultimoEnvioEm!) < 10_000)
  assert.equal(mov.retencaoHoje, 0, 'e o teto dos automáticos não é consumido pelo manual')
})

await casoBanco('banco: um pedido "enviando" há mais de 5 minutos é de um processo que caiu: vira "falhou" e nunca é reenviado', async () => {
  const velho = new Date(Date.now() - PRESO_APOS_MS - 60_000).toISOString()
  const novo = new Date(Date.now() - 60_000).toISOString()
  E.tabelas.envios_manuais = [linhaPedido(1, { status: 'enviando', iniciado_em: velho }), linhaPedido(2, { status: 'enviando', iniciado_em: novo })]
  await depsBanco().deps.liberarPresos()
  assert.equal(E.tabelas.envios_manuais[0].status, 'falhou')
  assert.match(String(E.tabelas.envios_manuais[0].erro), /confira no WhatsApp/)
  assert.equal(E.tabelas.envios_manuais[1].status, 'enviando', 'o que começou agora continua')
})

await casoBanco('banco: apto lê pela função SQL, normaliza o telefone e, sem resposta clara, recusa', async () => {
  const chamadas: unknown[] = []
  const rpc = async (nome: string, args: unknown) => {
    chamadas.push([nome, args])
    return { data: [{ telefone: '+55 (81) 99999-0001', nome: null, recusa: null }], error: null }
  }
  const a = await depsBanco({ rpc }).deps.apto('u1', false)
  await depsBanco({ rpc }).deps.apto('u2', true)
  assert.deepEqual(chamadas, [['envio_manual_apto', { p_user: 'u1', p_forcar: false }], ['envio_manual_apto', { p_user: 'u2', p_forcar: true }]], 'a autorização do pedido vai para a função SQL')
  assert.deepEqual(a, { telefone: '5581999990001', nome: '', recusa: null })
  const vazio = await depsBanco({ rpc: async () => ({ data: [], error: null }) }).deps.apto('u1', false)
  assert.equal(vazio.telefone, null)
  assert.match(vazio.recusa ?? '', /não consegui conferir/)
  await assert.rejects(depsBanco({ rpc: async () => ({ data: null, error: { message: 'boom' } }) }).deps.apto('u1', false), /conferir a pessoa/)
})

await casoBanco('banco: fila fora do ar lança, e por isso o ciclo não envia', async () => {
  E.falharTabela = 'envios_manuais'
  await assert.rejects(depsBanco().deps.proximo(), /ler a fila/)
  M.zerarEstadoManual()
  const log = await M.rodarEnvioManual(depsBanco().deps, em('10:00'))
  assert.match(log.join('\n'), /nada enviado/)
})

await casoBanco('banco: migration ainda não aplicada (tabela inexistente) é "nada a fazer": o ciclo fica em silêncio, sem um erro por minuto', async () => {
  const ausente = { message: "Could not find the table 'public.envios_manuais' in the schema cache", code: 'PGRST205' }
  // Um cliente falso em que qualquer consulta encadeada termina com o erro de tabela ausente.
  const cadeia: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res({ data: null, error: ausente, count: null }) : () => cadeia),
    apply: () => cadeia,
  })
  const sbAusente = { from: () => cadeia, rpc: async () => ({ data: null, error: ausente }) } as never
  const d = depsEnvioManualDoBanco(sbAusente, async () => undefined, async () => true)
  assert.equal(await d.proximo(), null)
  await d.liberarPresos()
  M.zerarEstadoManual()
  assert.deepEqual(await M.rodarEnvioManual(d, em('10:00')), [], 'sem log nenhum')
  assert.equal(M.estadoManual.ultimoErro, null)
})

await casoBanco('banco, do começo ao fim: dois pedidos em sequência saem com 5 minutos de diferença, e a mensagem manual vai para a tabela de avisos', async () => {
  const rpc = async (_n: string, a: { p_user: string }) => ({ data: [{ telefone: a.p_user === 'u1' ? '558199990001' : '558199990002', nome: 'Ana Souza', recusa: null }], error: null })
  E.tabelas.envios_manuais = [linhaPedido(1), linhaPedido(2)]
  E.tabelas.avisos = []
  E.falharTabela = null
  const { deps, enviados } = depsBanco({ rpc })
  // O ciclo recebe horários simulados dentro da janela, para o teste não depender da hora do dia nem do fuso da máquina.
  const base = em('12:00')
  const t = (min: number) => new Date(base.getTime() + min * 60_000)
  // Os avisos gravados levam o relógio real; empurra para o horário simulado para a medição de 5 minutos ser a do cenário.
  const alinhar = (quando: Date) => {
    for (const l of E.tabelas.avisos) {
      l.criado_em = quando.toISOString()
      if (l.enviado_em) l.enviado_em = quando.toISOString()
    }
  }
  await M.rodarEnvioManual(deps, t(0))
  alinhar(t(0))
  assert.equal(enviados.length, 1)
  M.zerarEstadoManual()
  await M.rodarEnvioManual(deps, t(3))
  assert.equal(enviados.length, 1, 'aos 3 minutos ainda espera')
  M.zerarEstadoManual()
  await M.rodarEnvioManual(deps, t(5))
  assert.equal(enviados.length, 2, 'aos 5 minutos sai o segundo')
  assert.ok(enviados[0].startsWith('558199990001|Oi, Pessoa1!'), enviados[0])
  assert.ok(enviados[1].startsWith('558199990002|'))
  assert.ok(enviados.every((e) => e.endsWith(R.RODAPE_SAIR)), 'toda mensagem termina com o SAIR')
  assert.equal(E.tabelas.avisos.filter((a) => a.tipo === 'retencao_manual' && a.status === 'enviado').length, 2)
  assert.deepEqual(E.tabelas.envios_manuais.map((x) => x.status), ['enviado', 'enviado'])
})

console.log(`\n${ok} casos do ciclo ok${falhas ? `, ${falhas} falha(s)` : ''}`)
// O fim() do banco falso só conta os casos dele: as falhas do ciclo (contador local) também precisam derrubar o processo.
if (falhas) process.exit(1)
fim()
