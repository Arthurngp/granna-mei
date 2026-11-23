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
  /** Elegíveis das etapas 2 e 3, por "regra:etapa". */
  listaEtapa?: Record<string, Elegivel[]>
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
  const chamadas = { elegiveis: 0, reservar: 0, enviar: 0, ciclos: [] as { em: string; erro: string | null }[], pedidos: [] as [string, number, number][] }
  const deps: Deps = {
    configs: async () => {
      if (opt.configs instanceof Error) throw opt.configs
      return opt.configs ?? []
    },
    elegiveis: async (regra, atraso, etapa) => {
      chamadas.elegiveis++
      chamadas.pedidos.push([regra, atraso, etapa])
      if (opt.elegiveisErro) throw new Error('banco fora')
      return etapa === 1 ? (opt.lista?.[regra] ?? []) : (opt.listaEtapa?.[`${regra}:${etapa}`] ?? [])
    },
    gatewayConectado: async () => {
      if (opt.conectado instanceof Error) throw opt.conectado
      return opt.conectado ?? true
    },
    movimento: async () => {
      if (opt.movimentoErro) throw new Error('não consegui contar')
      return { retencaoHoje: opt.hoje ?? 0, ultimoEnvioEm: opt.ultimoEnvioEm ?? null }
    },
    reservar: async (u, r, et) => {
      chamadas.reservar++
      const k = R.chaveRetencao(r, u, et)
      if (ledger.has(k)) return false
      ledger.add(k)
      return true
    },
    concluir: async (u, r, et, enviado) => {
      if (!enviado) ledger.delete(R.chaveRetencao(r, u, et))
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
const COM_ETAPAS = (modo: Config['modo'] = 'todos'): Config[] => [
  cfg('nunca_mandou', modo, {
    etapas: [
      { etapa: 2, atraso_horas: 96, texto: 'Oi, {nome}! Etapa dois: me manda o que entrou ou saiu, que eu anoto por aqui.' },
      { etapa: 3, atraso_horas: 240, texto: 'Oi, {nome}! Etapa três, a última: quando quiser, é só me mandar um gasto.' },
    ],
  }),
  cfg('parou_de_usar', 'desligado'),
]

/* ---------------- as travas ---------------- */

await caso('as travas de proteção do número são as que o Arthur aprovou: 15 por dia, 3 minutos, 9h às 19h', async () => {
  assert.equal(R.TETO_POR_DIA, 15)
  assert.equal(R.ESPERA_MINUTOS, 3)
  assert.equal(R.JANELA_DE, '09:00')
  assert.equal(R.JANELA_ATE, '19:00')
})

await caso('o que a tela do admin mostra é o que o código aplica: o teto do dia e a linha do SAIR (espera e janela não aparecem na tela)', async () => {
  const { readFileSync } = await import('node:fs')
  const tela = readFileSync(new URL('../../admin/src/telas/Avisos.tsx', import.meta.url), 'utf8')
  assert.equal(Number(/const TETO_DIA = (\d+)/.exec(tela)?.[1]), R.TETO_POR_DIA, 'teto do dia na tela')
  assert.ok(tela.includes(R.RODAPE_SAIR), 'a linha do SAIR que a tela mostra é a que o servidor envia')
  // a tela não pode voltar a prometer um ritmo ou horário que este teste não trava
  assert.ok(!/ESPERA_MIN|minutos, das|das 9h/.test(tela), 'a tela não cita espera nem janela, que ninguém aqui confere')
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

/* ---------------- a sequência: etapas 2 e 3 ---------------- */

await caso('só a etapa 1 é consultada quando as etapas 2 e 3 estão desligadas, mesmo que haja gente "elegível" nelas (nada muda no que sai)', async () => {
  // Ninguém na etapa 1 para o ciclo não parar nela; e as etapas 2 e 3 têm candidatos que NUNCA podem receber, porque estão desligadas.
  const f = fake({ configs: TODOS, lista: { nunca_mandou: [] }, listaEtapa: { 'nunca_mandou:2': [pessoa(5)], 'nunca_mandou:3': [pessoa(6)] } })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.deepEqual(f.chamadas.pedidos, [['nunca_mandou', 24, 1]], 'nem pergunta pelas etapas 2 e 3')
  assert.equal(f.enviados.length, 0, 'e ninguém recebe')
  const g = fake({ configs: TODOS, lista: { nunca_mandou: [pessoa(1)] } })
  await R.rodarRetencao(g.deps, em('10:00'))
  assert.equal(g.enviados.length, 1, 'a etapa 1 segue saindo como sempre')
})

await caso('com a etapa 1 sem ninguém, sai a etapa 2 com o texto DELA e a chave ":2" (a 1 tem prioridade quando há gente nela)', async () => {
  const f = fake({ configs: COM_ETAPAS(), lista: { nunca_mandou: [] }, listaEtapa: { 'nunca_mandou:2': [pessoa(5)], 'nunca_mandou:3': [pessoa(6)] } })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 1)
  assert.equal(f.enviados[0].tel, '5581999990005')
  assert.match(f.enviados[0].texto, /^Oi, Pessoa5! Etapa dois:/, 'o texto da etapa 2, não o da etapa 1')
  assert.ok(f.ledger.has('ret:nunca_mandou:u5:2'), 'a reserva leva o sufixo da etapa')
  assert.ok(!f.ledger.has('ret:nunca_mandou:u5'), 'e NÃO ocupa a chave da etapa 1')
  assert.deepEqual(f.chamadas.pedidos.map((x) => x[2]), [1, 2], 'parou na etapa 2: um envio por ciclo')
})

await caso('a etapa 1 vem antes das etapas de acompanhamento: quem nunca foi chamado sai primeiro', async () => {
  const f = fake({ configs: COM_ETAPAS(), lista: { nunca_mandou: [pessoa(1)] }, listaEtapa: { 'nunca_mandou:2': [pessoa(5)] } })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados[0].tel, '5581999990001')
  assert.match(f.enviados[0].texto, /^Oi, Pessoa1! Aqui é a Granninha/)
  assert.ok(f.ledger.has('ret:nunca_mandou:u1'))
  await R.rodarRetencao(f.deps, em('10:04'))
  assert.equal(f.enviados[1].tel, '5581999990005', 'três minutos depois, ninguém mais na etapa 1 (o reservado já tem a chave), sai a etapa 2')
})

await caso('a etapa 3 sai com o texto dela e a chave ":3"', async () => {
  const f = fake({ configs: COM_ETAPAS(), listaEtapa: { 'nunca_mandou:3': [pessoa(6)] } })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.match(f.enviados[0].texto, /^Oi, Pessoa6! Etapa três/)
  assert.ok(f.ledger.has('ret:nunca_mandou:u6:3'))
})

await caso('cada etapa recebe o ATRASO dela (24 h, 96 h e 240 h) ao pedir quem é elegível', async () => {
  const f = fake({ configs: COM_ETAPAS(), lista: {}, listaEtapa: {} })
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.deepEqual(f.chamadas.pedidos, [['nunca_mandou', 24, 1], ['nunca_mandou', 96, 2], ['nunca_mandou', 240, 3]])
})

await caso('a mesma pessoa pode estar na etapa 1 e na 2 com chaves diferentes (a chave da etapa 1 não segura a 2)', async () => {
  const f = fake({ configs: COM_ETAPAS(), listaEtapa: { 'nunca_mandou:2': [pessoa(7)] } })
  f.ledger.add(R.chaveRetencao('nunca_mandou', 'u7', 1))
  await R.rodarRetencao(f.deps, em('10:00'))
  assert.equal(f.enviados.length, 1, 'a etapa 1 já foi enviada a ela; a 2 é outra chave')
})

await caso('chaves: etapa 1 sem sufixo (compatível com o que já foi enviado), etapas 2 e 3 com sufixo', async () => {
  assert.equal(R.chaveRetencao('nunca_mandou', 'u1'), 'ret:nunca_mandou:u1')
  assert.equal(R.chaveRetencao('nunca_mandou', 'u1', 1), 'ret:nunca_mandou:u1')
  assert.equal(R.chaveRetencao('parou_de_usar', 'u1', 2), 'ret:parou_de_usar:u1:2')
  assert.equal(R.chaveRetencao('parou_de_usar', 'u1', 3), 'ret:parou_de_usar:u1:3')
})

await caso('ensaio rotula a etapa no registro; piloto manda UM exemplo por etapa por dia, com o texto da etapa', async () => {
  const f = fake({ configs: COM_ETAPAS('ensaio'), lista: { nunca_mandou: [pessoa(1)] }, listaEtapa: { 'nunca_mandou:2': [pessoa(5)] } })
  const log = (await R.rodarRetencao(f.deps, em('10:00'))).join('\n')
  assert.match(log, /ensaio \(nunca_mandou\): enviaria a 55\*+0001/)
  assert.match(log, /ensaio \(nunca_mandou, etapa 2\): enviaria a 55\*+0005/)
  assert.equal(f.enviados.length, 0)
  R.zerarEstado()
  const g = fake({ configs: COM_ETAPAS('piloto'), lista: { nunca_mandou: [pessoa(1)] }, listaEtapa: { 'nunca_mandou:2': [pessoa(5)] }, piloto: ['(81) 98888-7777'] })
  await R.rodarRetencao(g.deps, em('10:00'))
  await R.rodarRetencao(g.deps, em('10:04'))
  await R.rodarRetencao(g.deps, em('10:08'))
  assert.equal(g.enviados.length, 2, 'um exemplo da etapa 1 e um da etapa 2; nada de repetir')
  assert.ok(g.enviados.every((x) => x.tel === '81988887777'), 'só ao piloto')
  assert.match(g.enviados[0].texto, /^\[PILOTO\] Este lembrete iria para Pessoa1/)
  assert.match(g.enviados[1].texto, /^\[PILOTO\] Este lembrete \(etapa 2\) iria para Pessoa5/)
  assert.match(g.enviados[1].texto, /Etapa dois:/)
  assert.equal(g.chamadas.reservar, 0)
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

await casoBanco('banco: configs traz as etapas 2 e 3 LIGADAS, em ordem, e descarta cadeia incoerente (em dúvida não envia)', async () => {
  const txt = 'Oi, {nome}! Aqui é a Granninha, me manda seus lançamentos.'
  E.tabelas.config_retencao = [{ regra: 'nunca_mandou', modo: 'todos', atraso_horas: 24, texto: txt }, { regra: 'parou_de_usar', modo: 'ensaio', atraso_horas: 48, texto: txt }]
  E.tabelas.config_retencao_etapa = [
    { regra: 'nunca_mandou', etapa: 2, ativa: true, atraso_horas: 96, texto: txt + ' dois' },
    { regra: 'nunca_mandou', etapa: 3, ativa: true, atraso_horas: 240, texto: txt + ' tres' },
    { regra: 'parou_de_usar', etapa: 2, ativa: false, atraso_horas: 96, texto: txt },
    { regra: 'parou_de_usar', etapa: 3, ativa: true, atraso_horas: 240, texto: txt },
  ]
  let c = await depsBanco().deps.configs()
  const nm = c.find((x) => x.regra === 'nunca_mandou')!
  assert.deepEqual(nm.etapas?.map((e) => `${e.etapa}:${e.atraso_horas}`), ['2:96', '3:240'], 'as duas ligadas, em ordem')
  assert.equal(nm.etapas?.[0].texto.endsWith(' dois'), true)
  assert.deepEqual(c.find((x) => x.regra === 'parou_de_usar')!.etapas, [], 'a etapa 3 ligada sem a 2 ligada é descartada')
  E.tabelas.config_retencao_etapa[1].atraso_horas = 90
  c = await depsBanco().deps.configs()
  assert.deepEqual(c.find((x) => x.regra === 'nunca_mandou')!.etapas?.map((e) => e.etapa), [2], 'atraso da etapa 3 menor que o da 2: a 3 é descartada')
  E.tabelas.config_retencao_etapa[0].atraso_horas = 20
  c = await depsBanco().deps.configs()
  assert.deepEqual(c.find((x) => x.regra === 'nunca_mandou')!.etapas, [], 'atraso da etapa 2 menor que o da 1: nenhuma etapa de acompanhamento vale')
  E.falharTabela = 'config_retencao_etapa'
  await assert.rejects(depsBanco().deps.configs(), /etapas/)
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
  const r = await depsBanco({ rpc }).deps.elegiveis('parou_de_usar', 48, 1)
  const r3 = await depsBanco({ rpc }).deps.elegiveis('nunca_mandou', 240, 3)
  assert.deepEqual(chamadas, [['retencao_elegiveis', { p_regra: 'parou_de_usar', p_atraso: 48, p_ignorar_marco: false, p_etapa: 1 }], ['retencao_elegiveis', { p_regra: 'nunca_mandou', p_atraso: 240, p_ignorar_marco: false, p_etapa: 3 }]], 'a etapa vai para a função SQL')
  assert.equal(r3.length, 2)
  assert.deepEqual(r.map((x) => [x.user_id, x.nome, x.telefone]), [['a', '', '5581999990001'], ['b', 'Bia', null]])
  await assert.rejects(depsBanco({ rpc: async () => ({ data: null, error: { message: 'boom' } }) }).deps.elegiveis('nunca_mandou', 24, 1), /elegíveis/)
})

await casoBanco('banco: reservar é atômico (quem reserva primeiro é quem envia) e soltar libera para tentar de novo', async () => {
  E.tabelas.avisos = []
  const { deps } = depsBanco()
  assert.equal(await deps.reservar('u1', 'nunca_mandou', 1, '5581999990001'), true)
  assert.equal(await deps.reservar('u1', 'nunca_mandou', 1, '5581999990001'), false, 'segunda chamada não reserva')
  assert.equal(await deps.reservar('u1', 'parou_de_usar', 1, '5581999990001'), true, 'outra regra é outra chave')
  assert.equal(await deps.reservar('u1', 'nunca_mandou', 2, '5581999990001'), true, 'outra etapa é outra chave')
  assert.equal(E.tabelas.avisos[2].chave, 'ret:nunca_mandou:u1:2')
  assert.equal(E.tabelas.avisos[2].tipo, 'retencao_nunca', 'o tipo é o da regra, em qualquer etapa')
  await deps.concluir('u1', 'nunca_mandou', 2, false)
  assert.equal(E.tabelas.avisos.length, 2, 'soltar a etapa 2 não mexe nas outras chaves')
  assert.equal(E.tabelas.avisos[0].chave, 'ret:nunca_mandou:u1')
  assert.equal(E.tabelas.avisos[0].tipo, 'retencao_nunca')
  assert.equal(E.tabelas.avisos[1].tipo, 'retencao_parou')
  await deps.concluir('u1', 'nunca_mandou', 1, false)
  assert.equal(await deps.reservar('u1', 'nunca_mandou', 1, '5581999990001'), true, 'soltou: pode reservar de novo')
  await deps.concluir('u1', 'nunca_mandou', 1, true)
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
