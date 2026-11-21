/**
 * Lembretes de retenção (nunca mandou / parou de usar): o ciclo, com relógio, banco e gateway falsos.
 *
 * O que está em jogo: o número da Granninha não é oficial e o Arthur tem medo de bloqueio. Cada caso aqui é uma trava que impede
 * uma rajada, um contato frio ou uma mensagem a mais: janela 9h às 19h, 3 minutos entre envios, teto de 15 por dia, um envio por
 * ciclo, WhatsApp conectado, parada após falhas seguidas, SAIR sempre na última linha, e o princípio de que EM DÚVIDA NÃO ENVIA.
 *   npx tsx test/retencao.ts
 */
import assert from 'node:assert/strict'

const R = await import('../src/retencao.ts')
const { depsRetencaoDoBanco } = await import('../src/retencao-banco.ts')
type Deps = import('../src/retencao.ts').DepsRetencao
type Config = import('../src/retencao.ts').ConfigRegra
type Elegivel = import('../src/retencao.ts').Elegivel
type Regra = import('../src/retencao.ts').RegraRetencao

let ok = 0
let falhas = 0
async function caso(nome: string, fn: () => Promise<void>) {
  R.zerarEstado()
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

const cfg = (regra: Regra, modo: Config['modo'], extra: Partial<Config> = {}): Config => ({
  regra,
  modo,
  atraso_horas: regra === 'nunca_mandou' ? 24 : 48,
  texto: 'Oi, {nome}! Aqui é a Granninha. Me manda seus lançamentos por aqui, do seu jeito.',
  ...extra,
})
const pessoa = (n: number, extra: Partial<Elegivel> = {}): Elegivel => ({ user_id: `u${n}`, nome: `Pessoa${n} Silva`, telefone: `558199999000${n}`, whats: '8199999000' + n, horas: 30 + n, ...extra })

interface Opt {
  configs?: Config[] | Error
  lista?: Partial<Record<Regra, Elegivel[]>>
  conectado?: boolean | Error
  hoje?: number
  ultimoEnvioEm?: string | null
  movimentoErro?: boolean
  outro?: boolean
  falharEnvio?: boolean
  piloto?: string[]
  elegiveisErro?: boolean
}

function fake(opt: Opt = {}) {
  const enviados: { tel: string; texto: string }[] = []
  const ledger = new Set<string>()
  const chamadas = { elegiveis: 0, reservar: 0, enviar: 0, ciclos: [] as { em: string; erro: string | null }[] }
  const deps: Deps = {
    configs: async () => {
      if (opt.configs instanceof Error) throw opt.configs
      return opt.configs ?? []
    },
    elegiveis: async (regra) => {
      chamadas.elegiveis++
      if (opt.elegiveisErro) throw new Error('banco fora')
      return opt.lista?.[regra] ?? []
    },
    gatewayConectado: async () => {
      if (opt.conectado instanceof Error) throw opt.conectado
      return opt.conectado ?? true
    },
    movimento: async () => {
      if (opt.movimentoErro) throw new Error('não consegui contar')
      return { retencaoHoje: opt.hoje ?? 0, ultimoEnvioEm: opt.ultimoEnvioEm ?? null }
    },
    reservar: async (u, r) => {
      chamadas.reservar++
      const k = R.chaveRetencao(r, u)
      if (ledger.has(k)) return false
      ledger.add(k)
      return true
    },
    concluir: async (u, r, enviado) => {
      if (!enviado) ledger.delete(R.chaveRetencao(r, u))
    },
    enviar: async (tel, texto) => {
      chamadas.enviar++
      if (opt.falharEnvio) throw new Error('gateway recusou')
      enviados.push({ tel, texto })
    },
    outroCicloAndando: () => opt.outro ?? false,
    piloto: opt.piloto ?? [],
    registrarCiclo: async (i) => void chamadas.ciclos.push(i),
  }
  return { deps, enviados, ledger, chamadas }
}

const TODOS = [cfg('nunca_mandou', 'todos'), cfg('parou_de_usar', 'desligado')]

/* ---------------- as travas ---------------- */

await caso('as travas de proteção do número são as que o Arthur aprovou: 15 por dia, 3 minutos, 9h às 19h', async () => {
  assert.equal(R.TETO_POR_DIA, 15)
  assert.equal(R.ESPERA_MINUTOS, 3)
  assert.equal(R.JANELA_DE, '09:00')
  assert.equal(R.JANELA_ATE, '19:00')
})

await caso('os números que a tela do admin mostra são os mesmos do código (15, 3 minutos, 9h às 19h): um não muda sem o outro', async () => {
  const { readFileSync } = await import('node:fs')
  const tela = readFileSync(new URL('../../admin/src/telas/Avisos.tsx', import.meta.url), 'utf8')
  assert.equal(Number(/const TETO_DIA = (\d+)/.exec(tela)?.[1]), R.TETO_POR_DIA, 'teto do dia na tela')
  assert.equal(Number(/const ESPERA_MIN = (\d+)/.exec(tela)?.[1]), R.ESPERA_MINUTOS, 'espera na tela')
  assert.ok(tela.includes('das 9h às 19h'), 'a janela da tela')
  assert.equal(R.JANELA_DE, '09:00')
  assert.equal(R.JANELA_ATE, '19:00')
  assert.ok(tela.includes(R.RODAPE_SAIR), 'a linha do SAIR que a tela mostra é a que o servidor envia')
})

await caso('tudo desligado: não envia e nem consulta quem seria elegível', async () => {
  const f = fake({ configs: [cfg('nunca_mandou', 'desligado'), cfg('parou_de_usar', 'desligado')], lista: { nunca_mandou: [pessoa(1)] } })
  const log = await R.rodarRetencao(f.deps, em('10:00'))
  assert.deepEqual(log, [])
  assert.equal(f.chamadas.elegiveis, 0)
  assert.equal(f.enviados.length, 0)
  assert.equal(f.chamadas.ciclos.length, 0, 'e nem marca ciclo para o admin: está tudo desligado')
})

await caso('sem ler a configuração (migration não rodou) não envia: vale como desligado', async () => {
  const f = fake({ configs: new Error('relation "config_retencao" does not exist'), lista: { nunca_mandou: [pessoa(1)] } })
  const log = await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join('\n'), /nada enviado/)
})

await caso('EM DÚVIDA NÃO ENVIA: erro ao contar o dia, ao ler os elegíveis ou ao ver o WhatsApp encerra o ciclo sem enviar', async () => {
  for (const opt of [{ movimentoErro: true }, { elegiveisErro: true }, { conectado: new Error('gateway fora') }] as Opt[]) {
    R.zerarEstado()
    const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, ...opt })
    const log = await R.rodarRetencao(f.deps, em('10:00'))
    assert.equal(f.enviados.length, 0, JSON.stringify(opt))
    assert.match(log.join('\n'), /erro no ciclo/, JSON.stringify(opt))
    assert.ok(f.chamadas.ciclos[0]?.erro, 'e o erro fica registrado para o admin ver')
  }
})

await caso('janela: 08:59 e 19:00 não enviam; 09:00 e 18:59 enviam', async () => {
  for (const [hhmm, deve] of [['08:59', false], ['09:00', true], ['12:30', true], ['18:59', true], ['19:00', false], ['23:00', false], ['03:00', false]] as const) {
    R.zerarEstado()
    const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] } })
    await R.rodarRetencao(f.deps, em(hhmm))
    assert.equal(f.enviados.length, deve ? 1 : 0, hhmm)
  }
})

await caso('espera de 3 minutos desde o último envio automático, de qualquer tipo, medida no banco', async () => {
  const agora = em('10:00')
  for (const [atras, deve] of [[60, false], [179, false], [180, true], [600, true]] as const) {
    R.zerarEstado()
    const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, ultimoEnvioEm: new Date(agora.getTime() - atras * 1000).toISOString() })
    await R.rodarRetencao(f.deps, agora)
    assert.equal(f.enviados.length, deve ? 1 : 0, `${atras}s atrás`)
  }
})

await caso('a data do último envio ilegível BLOQUEIA (não pula a espera)', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, ultimoEnvioEm: 'invalido' })
  const log = await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join('\n'), /ilegível/)
})

await caso('depois de enviar, o próximo ciclo (1 minuto depois) não envia: a espera vale mesmo que o banco ainda não mostre o envio', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1), pessoa(2)] } })
  await R.rodarRetencao(f.deps, em('10:00'))
  await R.rodarRetencao(f.deps, em('10:01'))
  assert.equal(f.enviados.length, 1)
  await R.rodarRetencao(f.deps, em('10:03'))
  assert.equal(f.enviados.length, 2, 'três minutos depois, sai o próximo')
})

await caso('teto do dia: 15 enviados hoje não enviam mais; 14 enviam', async () => {
  const f15 = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, hoje: 15 })
  const log = await R.rodarRetencao(f15.deps, em('10:00'))
  assert.equal(f15.enviados.length, 0)
  assert.match(log.join('\n'), /teto do dia/)
  R.zerarEstado()
  const f14 = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, hoje: 14 })
  await R.rodarRetencao(f14.deps, em('10:00'))
  assert.equal(f14.enviados.length, 1)
})

await caso('WhatsApp fora de CONNECTED: não envia', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, conectado: false })
  const log = await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join('\n'), /CONNECTED/)
})

await caso('aviso de vencimento ou de fim do teste no meio do ciclo: este minuto não envia (saem pelo mesmo chip)', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, outro: true })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 0)
})

await caso('UM envio por ciclo, mesmo com vários elegíveis, e o escolhido é o primeiro da lista (o que espera há mais tempo)', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(7), pessoa(8), pessoa(9)] } })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 1)
  assert.equal(f.enviados[0].tel, '5581999990007')
})

await caso('as duas regras ligadas: ainda um envio só por ciclo (primeiro nunca_mandou, depois parou_de_usar)', async () => {
  const f = fake({ configs: [cfg('nunca_mandou', 'todos'), cfg('parou_de_usar', 'todos')], lista: { nunca_mandou: [pessoa(1)], parou_de_usar: [pessoa(2)] } })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 1)
  assert.equal(f.enviados[0].tel, '5581999990001')
  await R.rodarRetencao(f.deps, em('10:04'))
  assert.equal(f.enviados.length, 2)
  assert.equal(f.enviados[1].tel, '5581999990002')
})

await caso('uma mensagem por pessoa por regra: quem já foi reservado é pulado e sai o próximo', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1), pessoa(2)] } })
  f.ledger.add(R.chaveRetencao('nunca_mandou', 'u1'))
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 1)
  assert.equal(f.enviados[0].tel, '5581999990002')
})

await caso('candidato sem telefone é pulado, nunca recebe no número cadastrado', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1, { telefone: null }), pessoa(2)] } })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 1)
  assert.equal(f.enviados[0].tel, '5581999990002')
})

/* ---------------- falha de envio ---------------- */

await caso('falhou o envio: solta a reserva (pode tentar de novo), conta a falha e registra o erro', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, falharEnvio: true })
  const log = await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.ledger.size, 0, 'a reserva foi solta')
  assert.equal(R.estado.falhas, 1)
  assert.match(log.join('\n'), /falha ao enviar/)
  assert.equal(f.chamadas.ciclos[0].erro, 'gateway recusou')
})

await caso('o erro do gateway NUNCA leva número nem JID do cliente para o /saude, o log ou a tela do admin', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] } })
  f.deps.enviar = async () => {
    throw new Error('gateway envio 400: number 5581999990001 is not registered (5581999990001@s.whatsapp.net)')
  }
  const log = await R.rodarRetencao(f.deps, em('10:00'))
  const tudo = [R.estado.ultimoErro ?? '', log.join('\n'), f.chamadas.ciclos[0]?.erro ?? ''].join('\n')
  assert.match(tudo, /gateway envio 400/, 'o erro continua útil para quem investiga')
  assert.doesNotMatch(tudo, /\d{8,}/, `sem número de telefone: ${tudo}`)
  assert.doesNotMatch(tudo, /@/, `sem JID: ${tudo}`)
})

await caso('3 falhas seguidas param os lembretes por 30 minutos, e depois voltam', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1), pessoa(2), pessoa(3), pessoa(4)] }, falharEnvio: true })
  await R.rodarRetencao(f.deps, em('10:00'))
  await R.rodarRetencao(f.deps, em('10:01'))
  const log = await R.rodarRetencao(f.deps, em('10:02'))
  assert.match(log.join('\n'), /3 falhas seguidas/)
  const antes = f.chamadas.enviar
  await R.rodarRetencao(f.deps, em('10:20'))
  assert.equal(f.chamadas.enviar, antes, 'dentro dos 30 minutos nem tenta')
  const g = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(5)] } })
  await R.rodarRetencao(g.deps, em('10:33'))
  assert.equal(g.enviados.length, 1, 'passados os 30 minutos volta a enviar')
})

await caso('a mesma pessoa não é tentada mais de 3 vezes no dia', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] }, falharEnvio: true })
  await R.rodarRetencao(f.deps, em('10:00'))
  await R.rodarRetencao(f.deps, em('10:01'))
  await R.rodarRetencao(f.deps, em('10:02'))
  R.estado.pausaAte = 0
  const antes = f.chamadas.enviar
  await R.rodarRetencao(f.deps, em('10:05'))
  assert.equal(f.chamadas.enviar, antes, 'depois de 3 falhas a pessoa fica para outro dia')
})

await caso('um envio que deu certo zera a contagem de falhas seguidas', async () => {
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1), pessoa(2), pessoa(3)] } })
  R.estado.falhasSeguidas = 2
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(R.estado.falhasSeguidas, 0)
})

/* ---------------- ensaio e piloto ---------------- */

await caso('ensaio: só escreve no log quem receberia (com o número mascarado), não envia nem reserva, e não repete a cada minuto', async () => {
  const f = fake({ configs: [cfg('nunca_mandou', 'ensaio'), cfg('parou_de_usar', 'desligado')], lista: { nunca_mandou: [pessoa(1)] } })
  const log = await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.equal(f.chamadas.reservar, 0)
  assert.match(log.join('\n'), /ensaio \(nunca_mandou\): enviaria a 55\*+0001 \(Pessoa1/)
  assert.doesNotMatch(log.join('\n'), /5581999990001/, 'o número inteiro nunca vai para o log')
  const de_novo = await R.rodarRetencao(f.deps, em('10:01'))
  assert.deepEqual(de_novo, [], 'o mesmo nome não se repete no log no minuto seguinte')
})

await caso('piloto: manda ao número do Arthur UM exemplo com o texto exato e para quem seria, sem reservar a chave do cliente', async () => {
  const f = fake({ configs: [cfg('nunca_mandou', 'piloto'), cfg('parou_de_usar', 'desligado')], lista: { nunca_mandou: [pessoa(1), pessoa(2)] }, piloto: ['(81) 98888-7777'] })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 1)
  assert.equal(f.enviados[0].tel, '81988887777', 'vai ao piloto, nunca ao cliente')
  assert.match(f.enviados[0].texto, /^\[PILOTO\] Este lembrete iria para Pessoa1/)
  assert.match(f.enviados[0].texto, /Nada foi enviado a ele/)
  assert.match(f.enviados[0].texto, /Oi, Pessoa1!/)
  assert.equal(f.chamadas.reservar, 0, 'a chave do cliente fica livre')
  await R.rodarRetencao(f.deps, em('10:10'))
  await R.rodarRetencao(f.deps, em('10:20'))
  assert.equal(f.enviados.length, 1, 'no máximo um exemplo por regra por dia')
  R.zerarEstado()
  await R.rodarRetencao(f.deps, em('10:30', '2026-11-24'))
  assert.equal(f.enviados.length, 2, 'no dia seguinte manda outro')
})

await caso('piloto sem número do Arthur configurado: não envia nada', async () => {
  const f = fake({ configs: [cfg('nunca_mandou', 'piloto')], lista: { nunca_mandou: [pessoa(1)] }, piloto: [] })
  const log = await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join('\n'), /sem número do piloto/)
})

/* ---------------- texto e SAIR ---------------- */

await caso('o texto: primeiro nome, e a linha do SAIR é SEMPRE a última', async () => {
  const t = R.montarTextoRetencao('Oi, {nome}! Aqui é a Granninha. Me manda seus lançamentos por aqui.', 'Maria Souza Lima')
  assert.match(t, /^Oi, Maria! Aqui é a Granninha\./)
  assert.ok(t.endsWith(R.RODAPE_SAIR), 'termina com a linha do SAIR')
  assert.equal(t.split('\n\n').pop(), R.RODAPE_SAIR)
  assert.match(R.RODAPE_SAIR, /responda SAIR/)
})

await caso('o texto sem nome fica natural ("Oi!", não "Oi, !")', async () => {
  assert.match(R.montarTextoRetencao('Oi, {nome}! Me manda seus lançamentos.', ''), /^Oi! Me manda/)
  assert.match(R.montarTextoRetencao('Oi, {nome}! Me manda seus lançamentos.', '   '), /^Oi! Me manda/)
})

await caso('por garantia: travessão vira vírgula, link que não é nosso some, e o texto longo é cortado sem perder a linha do SAIR', async () => {
  const sujo = R.montarTextoRetencao('Oi, {nome} — tudo bem? Veja https://golpe.exemplo/x agora. Me manda seus lançamentos.', 'Ana')
  assert.doesNotMatch(sujo, /[—–]/)
  assert.doesNotMatch(sujo, /golpe/)
  const longo = R.montarTextoRetencao('Oi, {nome}! ' + 'texto de enchimento '.repeat(80), 'Ana')
  assert.ok(longo.length <= 700, `cabe no limite (${longo.length})`)
  assert.ok(longo.endsWith(R.RODAPE_SAIR))
})

await caso('o texto padrão que o banco semeia sai inteiro, sem a limpeza apagar nada dele', async () => {
  const padrao = 'Oi, {nome}! Aqui é a Granninha. Vi que você ainda não me mandou nenhum lançamento. É só escrever do seu jeito, por exemplo "recebi 300 de um serviço" ou "gasolina 60 pro negócio", que eu anoto pra você.'
  const t = R.montarTextoRetencao(padrao, 'Arthur')
  assert.ok(t.includes('recebi 300 de um serviço') && t.includes('gasolina 60 pro negócio'), t)
  assert.doesNotMatch(t, /[—–]/)
})

await caso('ehSair: a palavra sozinha, sem diferença de acento, maiúscula ou pontuação', async () => {
  for (const s of ['SAIR', 'sair', ' Sair ', 'Sair.', 'SAIR!', 'sáir', 'Sair?', '  sair  ']) assert.equal(R.ehSair(s), true, JSON.stringify(s))
  for (const s of ['quero sair', 'sair do plano', 'sairam', 'não quero sair', 'quero sair dessa lista', '', ' ', 's a i r', 'saída', 'sair e voltar']) assert.equal(R.ehSair(s), false, JSON.stringify(s))
})

await caso('a confirmação do SAIR diz o que para e o que continua', async () => {
  assert.match(R.TEXTO_SAIR, /não vou mais te mandar lembretes para usar a Granninha/i)
  assert.match(R.TEXTO_SAIR, /avisos de conta vencendo.*continuam/i)
})

/* ---------------- as consultas de verdade, contra o banco falso ---------------- */

const { caso: casoBanco, E, fim } = await import('./_falsos.ts')
const { sb } = await import('../src/banco.ts')

const hojeISO = () => new Date().toISOString()
function depsBanco(extra: { rpc?: unknown; conectado?: boolean; piloto?: string[] } = {}) {
  const cliente = extra.rpc ? ({ from: sb.from.bind(sb), rpc: extra.rpc } as never) : sb
  const enviados: string[] = []
  return { enviados, deps: depsRetencaoDoBanco(cliente, async (tel, texto) => void enviados.push(tel + '|' + texto), async () => extra.conectado ?? true, () => extra.piloto ?? ['81988887777']) }
}

await casoBanco('banco: configs devolve só linhas válidas (linha estranha vale como desligada)', async () => {
  E.tabelas.config_retencao = [
    { regra: 'nunca_mandou', modo: 'todos', atraso_horas: 24, texto: 'Oi, {nome}! Aqui é a Granninha, me manda seus lançamentos.' },
    { regra: 'parou_de_usar', modo: 'ligadissimo', atraso_horas: 48, texto: 'Oi, {nome}! Aqui é a Granninha, me manda seus lançamentos.' },
    { regra: 'outra_coisa', modo: 'todos', atraso_horas: 48, texto: 'Oi, {nome}! Aqui é a Granninha, me manda seus lançamentos.' },
    { regra: 'nunca_mandou', modo: 'todos', atraso_horas: 0, texto: 'Oi, {nome}! Aqui é a Granninha, me manda seus lançamentos.' },
    { regra: 'nunca_mandou', modo: 'todos', atraso_horas: 24, texto: 'curto' },
  ]
  const c = await depsBanco().deps.configs()
  assert.deepEqual(c.map((x) => `${x.regra}:${x.modo}:${x.atraso_horas}`), ['nunca_mandou:todos:24'])
})

await casoBanco('banco: tabela de configuração fora do ar lança (e o ciclo, por isso, não envia)', async () => {
  E.falharTabela = 'config_retencao'
  await assert.rejects(depsBanco().deps.configs(), /configuração/)
  const f = depsBanco().deps
  R.zerarEstado()
  const log = await R.rodarRetencao(f, em('10:00'))
  assert.match(log.join('\n'), /nada enviado/)
})

await casoBanco('banco: elegiveis lê pela função SQL e normaliza (telefone só com dígitos, nome nulo vira vazio)', async () => {
  const chamadas: unknown[] = []
  const rpc = async (nome: string, args: unknown) => {
    chamadas.push([nome, args])
    return { data: [{ user_id: 'a', nome: null, telefone: '+55 (81) 99999-0001', whats: '8199990001', horas: 31 }, { user_id: 'b', nome: 'Bia', telefone: null, whats: '8199990002', horas: 40 }], error: null }
  }
  const r = await depsBanco({ rpc }).deps.elegiveis('parou_de_usar', 48)
  assert.deepEqual(chamadas, [['retencao_elegiveis', { p_regra: 'parou_de_usar', p_atraso: 48, p_ignorar_marco: false }]])
  assert.deepEqual(r.map((x) => [x.user_id, x.nome, x.telefone]), [['a', '', '5581999990001'], ['b', 'Bia', null]])
  await assert.rejects(depsBanco({ rpc: async () => ({ data: null, error: { message: 'boom' } }) }).deps.elegiveis('nunca_mandou', 24), /elegíveis/)
})

await casoBanco('banco: reservar é atômico (quem reserva primeiro é quem envia) e soltar libera para tentar de novo', async () => {
  E.tabelas.avisos = []
  const { deps } = depsBanco()
  assert.equal(await deps.reservar('u1', 'nunca_mandou', '5581999990001'), true)
  assert.equal(await deps.reservar('u1', 'nunca_mandou', '5581999990001'), false, 'segunda chamada não reserva')
  assert.equal(await deps.reservar('u1', 'parou_de_usar', '5581999990001'), true, 'outra regra é outra chave')
  assert.equal(E.tabelas.avisos[0].chave, 'ret:nunca_mandou:u1')
  assert.equal(E.tabelas.avisos[0].tipo, 'retencao_nunca')
  assert.equal(E.tabelas.avisos[1].tipo, 'retencao_parou')
  await deps.concluir('u1', 'nunca_mandou', false)
  assert.equal(await deps.reservar('u1', 'nunca_mandou', '5581999990001'), true, 'soltou: pode reservar de novo')
  await deps.concluir('u1', 'nunca_mandou', true)
  assert.equal(E.tabelas.avisos.find((a) => a.chave === 'ret:nunca_mandou:u1')?.status, 'enviado')
})

await casoBanco('banco: movimento conta só os de retenção de hoje e olha o último envio de QUALQUER tipo', async () => {
  const antes = new Date(Date.now() - 2 * 86_400_000).toISOString()
  const meiaHoraAtras = new Date(Date.now() - 30 * 60_000).toISOString()
  E.tabelas.avisos = [
    { chave: 'a', user_id: 'u1', tipo: 'retencao_nunca', criado_em: meiaHoraAtras, enviado_em: meiaHoraAtras },
    { chave: 'b', user_id: 'u2', tipo: 'retencao_parou', criado_em: meiaHoraAtras, enviado_em: null },
    { chave: 'c', user_id: 'u3', tipo: 'retencao_nunca', criado_em: antes, enviado_em: antes },
    { chave: 'd', user_id: 'u4', tipo: 'vencimento', criado_em: hojeISO(), enviado_em: hojeISO() },
  ]
  const inicio = new Date(Date.now() - 3600_000).toISOString()
  const m = await depsBanco().deps.movimento(inicio)
  assert.equal(m.retencaoHoje, 2, 'o de ontem e o de vencimento não contam')
  assert.ok(m.ultimoEnvioEm && Date.now() - Date.parse(m.ultimoEnvioEm) < 60_000, 'o último envio é o mais recente de qualquer tipo (o de vencimento, agora), não só o de retenção (30 min atrás)')
  E.falharTabela = 'avisos'
  await assert.rejects(depsBanco().deps.movimento(inicio), /contar os de hoje/)
})

await casoBanco('banco: o ciclo inteiro, de ponta a ponta, com o banco falso: envia um, registra o aviso e para na espera', async () => {
  E.tabelas.avisos = []
  E.tabelas.granninha_saude = [{ id: 1 }]
  E.tabelas.config_retencao = [{ regra: 'nunca_mandou', modo: 'todos', atraso_horas: 24, texto: 'Oi, {nome}! Aqui é a Granninha, me manda seus lançamentos.' }]
  const rpc = async () => ({ data: [{ user_id: 'u1', nome: 'Bia Souza', telefone: '5581999990001', whats: '8199990001', horas: 30 }, { user_id: 'u2', nome: 'Caio', telefone: '5581999990002', whats: '8199990002', horas: 28 }], error: null })
  const { deps, enviados } = depsBanco({ rpc })
  R.zerarEstado()
  const agora = em('10:00')
  await R.rodarRetencao(deps, agora)
  assert.equal(enviados.length, 1)
  assert.match(enviados[0], /^5581999990001\|Oi, Bia! Aqui é a Granninha/)
  assert.ok(enviados[0].endsWith(R.RODAPE_SAIR))
  assert.equal(E.tabelas.avisos.length, 1)
  assert.equal(E.tabelas.avisos[0].status, 'enviado')
  assert.ok(E.tabelas.granninha_saude[0].retencao_ciclo_em, 'o admin vê quando o ciclo rodou')
  // O banco falso grava no relógio REAL e o ciclo usa um relógio de mentira: aqui o banco passa a refletir o relógio do ciclo, como em produção.
  E.tabelas.avisos[0].criado_em = agora.toISOString()
  E.tabelas.avisos[0].enviado_em = agora.toISOString()
  R.estado.ultimoEnvioMs = 0 // sem a memória do processo: quem segura a espera é só o que o banco mostra
  const log2 = await R.rodarRetencao(deps, new Date(agora.getTime() + 60_000))
  assert.equal(enviados.length, 1, 'um minuto depois o banco mostra o envio e a espera segura o próximo')
  assert.deepEqual(log2, [])
  R.estado.ultimoEnvioMs = 0
  await R.rodarRetencao(deps, new Date(agora.getTime() + 3 * 60_000))
  assert.equal(enviados.length, 2, 'três minutos depois sai o segundo')
  assert.match(enviados[1], /^5581999990002\|Oi, Caio!/)
  assert.equal(E.tabelas.avisos.length, 2)
})

console.log(`\n${ok} casos do motor ok${falhas ? `, ${falhas} falha(s)` : ''}`)
// O fim() do banco falso só conta os casos dele: as falhas do motor (contador local) também precisam derrubar o processo.
if (falhas) process.exit(1)
fim()
