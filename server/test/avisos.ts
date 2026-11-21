/**
 * Aviso de conta vencendo (fase f4): no dia e na hora que o cliente escolheu, uma vez por conta, sem nunca
 * mandar em dobro nem sair de madrugada.
 *
 * Caso de origem (2026-11-20): a Granninha gravava "Hora dos lembretes" e "1 dia antes" e nada lia isso. O site
 * e o próprio bot prometiam o aviso, e o Arthur nunca recebeu um.
 *
 * Duas camadas: o ciclo com dependências falsas (relógio, banco e gateway em memória, cobre todas as regras) e o
 * banco de verdade contra o banco falso (prova que as consultas e a reserva atômica fazem o que o ciclo supõe).
 *   npx tsx test/avisos.ts
 */
import assert from 'node:assert/strict'
import { caso, E, fim } from './_falsos.ts'

const A = await import('../src/avisos.ts')
const { depsAvisosDoBanco } = await import('../src/avisos-banco.ts')
const { sb, chaveDoNumero } = await import('../src/banco.ts')
type Deps = import('../src/avisos.ts').DepsAvisos
type Perfil = import('../src/avisos.ts').PerfilAviso
type Conta = import('../src/avisos.ts').ContaAviso

/** Um instante pelo relógio de São Paulo (sem horário de verão em 2026, UTC-3). */
const em = (hhmm: string, dia = '2026-11-20') => new Date(`${dia}T${hhmm}:00-03:00`)
const HOJE = '2026-11-20' // sexta-feira
const AMANHA = '2026-11-21'
const EM3 = '2026-11-23'
const EM4 = '2026-11-24'
const CFG = (x: Partial<import('../src/avisos.ts').ConfigAvisos> = {}) => ({ modo: 'todos' as const, piloto: [] as string[], janelaMin: 180, maxPorCiclo: 15, espacoMs: 0, ...x })
const conta = (id: string, descricao: string, valor: number, vencimento: string): Conta => ({ id, descricao, valor, vencimento })
const perfilBase = (p: Partial<Perfil> = {}): Perfil => ({
  id: 'u1', nome: 'Arthur Teste', whats: '(81) 98888-7777', whats_chave: '8188887777', lembrete_hora: '09:00', antecedencia: 0,
  ocultar: false, exclusao_em: null, assinatura: { status: 'ativa', trial_fim: null }, ...p,
})

/** Banco, relógio e gateway em memória, com as mesmas regras de reserva que a tabela `avisos` tem. */
function fake(perfis: Partial<Perfil>[], contas: Record<string, Conta[]>, opt: { falharEnvio?: boolean; sem?: Set<string> } = {}) {
  const ledger = new Map<string, string>()
  const enviados: { tel: string; texto: string }[] = []
  const esperas: number[] = []
  const chamadas = { contas: 0 }
  const deps: Deps = {
    perfis: async (hhmm) => perfis.map(perfilBase).filter((p) => p.lembrete_hora <= hhmm),
    contas: async (u, de, ate) => {
      chamadas.contas++
      return (contas[u] ?? []).filter((c) => c.vencimento >= de && c.vencimento <= ate)
    },
    telefoneDe: async (p) => (opt.sem?.has(p.id) ? null : '5581988887777'),
    jaAvisadas: async (_u, chaves) => new Set(chaves.filter((c) => ledger.has(c))),
    reservar: async (_u, _tel, itens) => {
      const minhas: string[] = []
      for (const i of itens) if (!ledger.has(i.chave)) (ledger.set(i.chave, 'enviando'), minhas.push(i.chave))
      return minhas
    },
    concluir: async (_u, chaves, ok) => {
      for (const c of chaves) ok ? ledger.set(c, 'enviado') : ledger.delete(c)
    },
    enviar: async (tel, texto) => {
      if (opt.falharEnvio) throw new Error('gateway envio 500: provocado')
      enviados.push({ tel, texto })
    },
    esperar: async (ms) => void esperas.push(ms),
  }
  return { deps, ledger, enviados, esperas, chamadas }
}
const novo = () => A.zerarEstado()

/* ===================== o ciclo, com dependências falsas ===================== */

await caso('conta que vence hoje, na hora escolhida: UMA mensagem com a conta, e fica registrada como enviada', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  const log = await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.equal(f.enviados.length, 1, log.join(' | '))
  assert.equal(f.enviados[0].tel, '5581988887777')
  assert.match(f.enviados[0].texto, /Oi, Arthur\./)
  assert.match(f.enviados[0].texto, /Hoje\n- Aluguel, R\$ 900,00/)
  assert.match(f.enviados[0].texto, /"paguei aluguel"/, 'diz como dar baixa, que é o que fecha o ciclo')
  assert.equal(f.ledger.get(`venc:u1:c1:${HOJE}`), 'enviado')
})

await caso('antes da hora escolhida não envia', async () => {
  novo()
  const f = fake([{ lembrete_hora: '09:00' }], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  await A.rodarAvisos(f.deps, CFG(), em('08:59'))
  assert.equal(f.enviados.length, 0)
})

await caso('a janela vale por conta própria: limites exatos, e mesmo que o banco devolva quem ainda não chegou na hora', async () => {
  novo()
  assert.equal(A.naJanela('08:59', '09:00', 180), false)
  assert.equal(A.naJanela('09:00', '09:00', 180), true)
  assert.equal(A.naJanela('12:00', '09:00', 180), true)
  assert.equal(A.naJanela('12:01', '09:00', 180), false)
  assert.equal(A.naJanela('09:30', 'lixo', 180), true, 'hora inválida cai no padrão 09:00')
  const f = fake([{ lembrete_hora: '09:00' }], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  const semFiltroDoBanco: Deps = { ...f.deps, perfis: async () => [perfilBase({ lembrete_hora: '09:00' })] }
  await A.rodarAvisos(semFiltroDoBanco, CFG(), em('08:59'))
  assert.equal(f.enviados.length, 0, 'quem garante é o ciclo, não só o filtro da consulta')
})

await caso('janela: ainda sai até 3h depois (cobre um reinício), mas depois disso o aviso do dia se perde', async () => {
  novo()
  const f = fake([{ lembrete_hora: '09:00' }], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  await A.rodarAvisos(f.deps, CFG(), em('12:01'))
  assert.equal(f.enviados.length, 0, 'passou de 12:00: falar de "hoje" à tarde seria aviso fora de hora')
  await A.rodarAvisos(f.deps, CFG(), em('12:00'))
  assert.equal(f.enviados.length, 1, 'dentro da janela de 3h, ainda sai')
})

await caso('nunca depois das 21:30, mesmo com a hora escolhida às 21:00 e a janela enorme', async () => {
  novo()
  const f = fake([{ lembrete_hora: '21:00' }], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  await A.rodarAvisos(f.deps, CFG({ janelaMin: 600 }), em('21:45'))
  assert.equal(f.enviados.length, 0)
  await A.rodarAvisos(f.deps, CFG({ janelaMin: 600 }), em('21:20'))
  assert.equal(f.enviados.length, 1)
})

await caso('repetir o ciclo, ou reiniciar o processo, NUNCA manda de novo (o registro é do banco, não da memória)', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  await A.rodarAvisos(f.deps, CFG(), em('09:01'))
  novo() // "reiniciou": a memória do processo some, o registro fica
  await A.rodarAvisos(f.deps, CFG(), em('09:02'))
  assert.equal(f.enviados.length, 1)
})

await caso('antecedência 1: a conta de hoje e a de amanhã viram UMA mensagem, agrupadas por dia, com o total', async () => {
  novo()
  const f = fake([{ antecedencia: 1 }], { u1: [conta('c1', 'Internet', 99.9, HOJE), conta('c2', 'Fornecedor', 450, AMANHA)] })
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.equal(f.enviados.length, 1)
  const t = f.enviados[0].texto
  assert.match(t, /Estas contas estão vencendo:/)
  assert.match(t, /Hoje\n- Internet, R\$ 99,90\n\nAmanhã\n- Fornecedor, R\$ 450,00/)
  assert.match(t, /Total: R\$ 549,90/)
})

await caso('antecedência 0 ("só no dia") não avisa a conta de amanhã', async () => {
  novo()
  const f = fake([{ antecedencia: 0 }], { u1: [conta('c2', 'Fornecedor', 450, AMANHA)] })
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.equal(f.enviados.length, 0)
})

await caso('antecedência 3: avisa a conta de daqui a 3 dias, e não a de 4', async () => {
  novo()
  const f = fake([{ antecedencia: 3 }], { u1: [conta('c3', 'Luz', 150, EM3), conta('c4', 'Seguro', 300, EM4)] })
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.equal(f.enviados.length, 1)
  assert.match(f.enviados[0].texto, /Segunda, 23\/11\n- Luz, R\$ 150,00/)
  assert.doesNotMatch(f.enviados[0].texto, /Seguro/)
})

await caso('conta anotada DEPOIS do dia do lembrete, mas que ainda não venceu, é avisada uma vez', async () => {
  novo()
  const f = fake([{ antecedencia: 3 }], { u1: [conta('c1', 'Aluguel', 900, AMANHA)] }) // venceria no dia 24, lembrete era dia 21; anotada hoje
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.equal(f.enviados.length, 1)
  await A.rodarAvisos(f.deps, CFG(), em('09:30'))
  assert.equal(f.enviados.length, 1, 'e só uma vez')
})

await caso('quando uma conta já foi avisada e aparece outra no mesmo dia, só a nova entra', async () => {
  novo()
  const contas = { u1: [conta('c1', 'Aluguel', 900, HOJE)] }
  const f = fake([{}], contas)
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  contas.u1.push(conta('c2', 'Internet', 99.9, HOJE))
  novo() // passou o silêncio de "sem novidade"
  await A.rodarAvisos(f.deps, CFG(), em('09:20'))
  assert.equal(f.enviados.length, 2)
  assert.doesNotMatch(f.enviados[1].texto, /Aluguel/)
  assert.match(f.enviados[1].texto, /Tem uma conta vencendo:\n\nHoje\n- Internet/)
})

await caso('quem não deve receber não recebe: sem teste válido, bloqueado, exclusão pedida', async () => {
  novo()
  const hoje = [conta('c1', 'Aluguel', 900, HOJE)]
  const f = fake(
    [
      { id: 'ok' },
      { id: 'bloqueada', assinatura: { status: 'bloqueada', trial_fim: null } },
      { id: 'trial-vencido', assinatura: { status: 'trial', trial_fim: '2026-11-19' } },
      { id: 'sem-assinatura', assinatura: null },
      { id: 'excluindo', exclusao_em: '2026-12-10' },
    ],
    { ok: hoje, bloqueada: hoje, 'trial-vencido': hoje, 'sem-assinatura': hoje, excluindo: hoje },
  )
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.deepEqual([...f.ledger.keys()], [`venc:ok:c1:${HOJE}`])
  // e o que vale: trial no último dia ainda vale, atrasada (24h de carência) também
  assert.equal(A.acessoLiberado({ status: 'trial', trial_fim: HOJE }, HOJE), true)
  assert.equal(A.acessoLiberado({ status: 'atrasada', trial_fim: null }, HOJE), true)
})

await caso('sem número para avisar: não reserva nada e diz no log', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] }, { sem: new Set(['u1']) })
  const log = await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.equal(f.ledger.size, 0)
  assert.match(log.join(' '), /sem número/)
})

await caso('desligado por padrão: nem consulta o banco', async () => {
  novo()
  assert.equal(A.lerConfig({}).modo, 'off')
  assert.equal(A.lerConfig({ AVISOS: 'lixo' }).modo, 'off')
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  const log = await A.rodarAvisos(f.deps, A.lerConfig({}), em('09:00'))
  assert.deepEqual(log, [])
  assert.equal(f.chamadas.contas, 0)
  assert.equal(f.enviados.length, 0)
})

await caso('ensaio: diz no log o que enviaria, mas não envia nem reserva nada', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  const log = await A.rodarAvisos(f.deps, CFG({ modo: 'ensaio' }), em('09:00'))
  assert.match(log.join(' '), /ensaio: enviaria a 55\*+7777 \(1 conta\)/, 'número mascarado no log')
  assert.equal(f.enviados.length, 0)
  assert.equal(f.ledger.size, 0, 'ensaio não pode gastar o aviso de verdade')
})

await caso('piloto: só quem está na lista, por número em qualquer formato ou por id', async () => {
  novo()
  const hoje = [conta('c1', 'Aluguel', 900, HOJE)]
  const f = fake(
    [{ id: 'eu', whats_chave: '8188887777' }, { id: 'outro', whats_chave: '8155554444' }, { id: 'terceiro', whats_chave: '8133332222' }],
    { eu: hoje, outro: hoje, terceiro: hoje },
  )
  await A.rodarAvisos(f.deps, CFG({ modo: 'piloto', piloto: ['+55 (81) 98888-7777', 'terceiro'] }), em('09:00'))
  assert.deepEqual([...f.ledger.keys()].sort(), [`venc:eu:c1:${HOJE}`, `venc:terceiro:c1:${HOJE}`])
  for (const formato of ['(81) 98888-7777', '+55 81 98888-7777', '5581988887777', '558188887777', '81988887777']) {
    assert.equal(A.noPiloto({ id: 'x', whats_chave: '8188887777' }, [formato]), true, formato)
  }
  assert.equal(A.noPiloto({ id: 'x', whats_chave: '8188887777' }, ['8155554444']), false)
})

await caso('falha de envio: solta a reserva, conta a falha, e o ciclo seguinte tenta de novo (nunca fica "enviado")', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] }, { falharEnvio: true })
  const log = await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  assert.match(log.join(' '), /falha ao enviar/)
  assert.equal(f.ledger.size, 0, 'a reserva foi solta')
  assert.equal(A.estado.falhas, 1)
  assert.equal(A.estado.enviados, 0)
})

await caso('o erro do envio NUNCA leva número nem JID do cliente para o /saude (que é público) nem para o log', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  f.deps.enviar = async () => {
    throw new Error('gateway envio 400: number 5581988887777 is not registered (5581988887777@s.whatsapp.net)')
  }
  const log = await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  const tudo = `${A.estado.ultimoErro}\n${log.join('\n')}`
  assert.match(tudo, /gateway envio 400/, 'o erro continua útil para quem investiga')
  assert.doesNotMatch(tudo, /\d{8,}/, `sem número de telefone: ${tudo}`)
  assert.doesNotMatch(tudo, /@/, `sem JID: ${tudo}`)
})

await caso('depois de 3 falhas no mesmo dia para a mesma pessoa, para até amanhã (não martela o gateway a cada minuto)', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] }, { falharEnvio: true })
  for (let m = 0; m < 6; m++) {
    A.estado.semNovidadeAte.clear() // isola a trava de falhas da de "sem novidade"
    await A.rodarAvisos(f.deps, CFG(), em(`09:0${m}`))
  }
  assert.equal(A.estado.falhas, A.MAX_FALHAS_DIA)
  // no dia seguinte volta a tentar
  A.estado.semNovidadeAte.clear()
  const g = fake([{}], { u1: [conta('c1', 'Aluguel', 900, '2026-11-21')] })
  await A.rodarAvisos(g.deps, CFG(), em('09:00', '2026-11-21'))
  assert.equal(g.enviados.length, 1)
})

await caso('fuso: 21:00 em São Paulo já é dia seguinte em UTC, e vale a data de São Paulo', async () => {
  novo()
  const f = fake([{ lembrete_hora: '21:00' }], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  const instante = new Date('2026-11-21T00:00:00Z') // = 21:00 de 20/11 em São Paulo
  assert.equal(A.dataSP(instante), HOJE)
  assert.equal(A.horaSP(instante), '21:00')
  await A.rodarAvisos(f.deps, CFG(), instante)
  assert.equal(f.enviados.length, 1)
  assert.match(f.enviados[0].texto, /Hoje\n- Aluguel/)
})

await caso('meia-noite de São Paulo é 00:00, nunca "24:00"', async () => {
  assert.equal(A.horaSP(new Date('2026-11-20T03:00:00Z')), '00:00')
})

await caso('quem escolheu ocultar valores não recebe valores, nem total', async () => {
  novo()
  const f = fake([{ ocultar: true }], { u1: [conta('c1', 'Aluguel', 900, HOJE), conta('c2', 'Internet', 99.9, HOJE)] })
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  const t = f.enviados[0].texto
  assert.match(t, /- Aluguel\n- Internet/)
  assert.doesNotMatch(t, /R\$|Total/)
})

await caso('muita conta vencendo: lista 8 e diz quantas faltam, em vez de uma parede de texto', async () => {
  novo()
  const muitas = Array.from({ length: 11 }, (_, i) => conta(`c${i}`, `Conta ${String(i).padStart(2, '0')}`, 10 + i, HOJE))
  const f = fake([{}], { u1: muitas })
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  const t = f.enviados[0].texto
  assert.equal(t.split('\n').filter((l) => l.startsWith('- ')).length, A.MAX_LINHAS)
  assert.match(t, /E mais 3\. Veja no painel\./)
  assert.equal(f.ledger.size, 11, 'as 11 foram avisadas, nenhuma volta amanhã')
})

await caso('ritmo: teto de envios por ciclo e espera entre um e outro (número não oficial que dispara demais é banido)', async () => {
  novo()
  const hoje = [conta('c1', 'Aluguel', 900, HOJE)]
  const f = fake([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { a: hoje, b: hoje, c: hoje })
  const log = await A.rodarAvisos(f.deps, CFG({ maxPorCiclo: 2, espacoMs: 5000 }), em('09:00'))
  assert.equal(f.enviados.length, 2)
  assert.match(log.join(' '), /teto de envios por ciclo/)
  assert.equal(f.esperas.length, 1, 'espera entre o primeiro e o segundo, não antes do primeiro')
  assert.ok(f.esperas[0] >= 5000, 'espera pelo menos o espaço configurado')
  // o minuto seguinte atende quem ficou
  await A.rodarAvisos(f.deps, CFG({ maxPorCiclo: 2, espacoMs: 5000 }), em('09:01'))
  assert.equal(f.enviados.length, 3)
})

await caso('dois ciclos ao mesmo tempo: só um roda, o outro pula', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  const devagar: Deps = { ...f.deps, perfis: async (h) => (await new Promise((ok) => setTimeout(ok, 40)), f.deps.perfis(h)) }
  const [a, b] = await Promise.all([A.rodarAvisos(devagar, CFG(), em('09:00')), A.rodarAvisos(devagar, CFG(), em('09:00'))])
  assert.equal(f.enviados.length, 1)
  assert.match([...a, ...b].join(' '), /ainda em andamento/)
})

await caso('sem a tabela de registro, NADA é enviado (sem o registro o risco é mandar em dobro)', async () => {
  novo()
  const f = fake([{}], { u1: [conta('c1', 'Aluguel', 900, HOJE)] })
  const semTabela: Deps = { ...f.deps, jaAvisadas: async () => { throw new Error('avisos consultar avisos: relation "public.avisos" does not exist') }, reservar: async () => { throw new Error('relation "public.avisos" does not exist') } }
  const log = await A.rodarAvisos(semTabela, CFG(), em('09:00'))
  assert.equal(f.enviados.length, 0)
  assert.match(log.join(' '), /erro no ciclo, nada enviado/)
  assert.equal(A.estado.rodando, false, 'e o ciclo seguinte pode rodar')
})

await caso('quem não tinha nada novo não é consultado a cada minuto (5 min de silêncio), e volta depois', async () => {
  novo()
  const f = fake([{}], { u1: [] })
  await A.rodarAvisos(f.deps, CFG(), em('09:00'))
  await A.rodarAvisos(f.deps, CFG(), em('09:01'))
  await A.rodarAvisos(f.deps, CFG(), em('09:04'))
  assert.equal(f.chamadas.contas, 1)
  await A.rodarAvisos(f.deps, CFG(), em('09:06'))
  assert.equal(f.chamadas.contas, 2)
})

await caso('o texto: sem travessão nem emoji em NENHUMA variante, com o exemplo de "paguei" e o nome certo', async () => {
  const t = A.montarTexto({ nome: '  maria   da Silva ', ocultar: false }, [conta('c1', 'Mensalidade do aluguel do ponto comercial', 1200, HOJE)], HOJE)
  const duas = [conta('c1', 'Aluguel', 900, HOJE), conta('c2', 'Internet', 99.9, AMANHA)]
  const muitas = Array.from({ length: 11 }, (_, i) => conta(`c${i}`, `Conta ${i}`, 10, HOJE))
  for (const [nome, texto] of Object.entries({
    uma: t,
    duas: A.montarTexto({ nome: 'Ana', ocultar: false }, duas, HOJE),
    oculta: A.montarTexto({ nome: 'Ana', ocultar: true }, duas, HOJE),
    muitas: A.montarTexto({ nome: 'Ana', ocultar: false }, muitas, HOJE),
    sem_nome: A.montarTexto({ nome: '', ocultar: false }, duas, HOJE),
  })) {
    assert.doesNotMatch(texto, /[—–]/, `sem travessão (${nome})`)
    assert.doesNotMatch(texto, /\p{Extended_Pictographic}/u, `sem emoji (${nome})`)
  }
  assert.match(t, /^Oi, maria\./)
  assert.match(t, /"paguei a conta"/, 'descrição comprida não vira exemplo')
  assert.match(A.montarTexto({ nome: '', ocultar: false }, [conta('c1', 'Luz', 89, HOJE)], HOJE), /^Oi\. Tem uma conta vencendo:/)
})

await caso('a regra de número do piloto é a mesma de banco.chaveDoNumero (não pode se afastar)', async () => {
  for (const n of ['5581988887777', '558188887777', '(81) 98888-7777', '81988887777', '5581988887777@s.whatsapp.net', '123', '']) {
    assert.equal(A.chaveDoTelefone(n), chaveDoNumero(n), n)
  }
})

/* ===================== o banco de verdade, contra o banco falso ===================== */

const enviadosBanco: { tel: string; texto: string }[] = []
const depsBanco = (falhar = false): Deps => ({
  ...depsAvisosDoBanco(sb, async (tel, texto) => {
    if (falhar) throw new Error('gateway envio 500: provocado')
    enviadosBanco.push({ tel, texto })
  }),
  esperar: async () => {},
})
function semearBanco() {
  enviadosBanco.length = 0
  novo()
  E.tabelas.perfis = [
    { id: 'u1', nome: 'Arthur Teste', whats: '(81) 98888-7777', whats_chave: '8188887777', whats_verificado: true, exclusao_em: null, lembrete_hora: '09:00', antecedencia: 1, ocultar: false },
    { id: 'naoverif', nome: 'Sem Verificar', whats: '(81) 97777-6666', whats_chave: '8177776666', whats_verificado: false, exclusao_em: null, lembrete_hora: '09:00', antecedencia: 1, ocultar: false },
    { id: 'excl', nome: 'Saindo', whats: '(81) 96666-5555', whats_chave: '8166665555', whats_verificado: true, exclusao_em: '2026-12-10', lembrete_hora: '09:00', antecedencia: 1, ocultar: false },
    { id: 'tarde', nome: 'Tarde', whats: '(81) 95555-4444', whats_chave: '8155554444', whats_verificado: true, exclusao_em: null, lembrete_hora: '18:00', antecedencia: 1, ocultar: false },
    { id: 'vencido', nome: 'Trial Vencido', whats: '(81) 94444-3333', whats_chave: '8144443333', whats_verificado: true, exclusao_em: null, lembrete_hora: '09:00', antecedencia: 1, ocultar: false },
  ]
  E.tabelas.assinaturas = [
    { user_id: 'u1', status: 'ativa', trial_fim: '2099-12-31' },
    { user_id: 'naoverif', status: 'ativa', trial_fim: '2099-12-31' },
    { user_id: 'excl', status: 'ativa', trial_fim: '2099-12-31' },
    { user_id: 'tarde', status: 'ativa', trial_fim: '2099-12-31' },
    { user_id: 'vencido', status: 'trial', trial_fim: '2026-11-19' },
  ]
  const c = (user_id: string, id: string, tipo: string, descricao: string, valor: number, vencimento: string, status = 'aberta') => ({ user_id, id, tipo, descricao, valor, vencimento, status })
  E.tabelas.contas = [
    c('u1', 'c1', 'pagar', 'Aluguel', 900, HOJE),
    c('u1', 'c2', 'pagar', 'Internet', 99.9, AMANHA),
    c('u1', 'paga', 'pagar', 'Luz já paga', 150, HOJE, 'paga'),
    c('u1', 'recebe', 'receber', 'A Bia me deve', 150, HOJE),
    c('u1', 'longe', 'pagar', 'Seguro', 300, '2026-12-30'),
    c('u1', 'velha', 'pagar', 'Boleto de ontem', 70, '2026-11-19'),
    c('naoverif', 'c1', 'pagar', 'Conta de quem não verificou', 10, HOJE),
    c('excl', 'c1', 'pagar', 'Conta de quem vai sair', 10, HOJE),
    c('tarde', 'c1', 'pagar', 'Conta da tarde', 10, HOJE),
    c('vencido', 'c1', 'pagar', 'Conta do trial vencido', 10, HOJE),
  ]
  E.tabelas.mensagens = [{ id: 'm1', user_id: 'u1', telefone: '558188887777', status: 'ok', criado_em: '2026-11-19T10:00:00Z', texto: 'x', tipo: 'texto' }]
  E.tabelas.avisos = []
}

await caso('banco: só conta a pagar, aberta, do dono, no intervalo; só cliente verificado, com acesso e sem exclusão, no horário', async () => {
  semearBanco()
  const log = await A.rodarAvisos(depsBanco(), CFG(), em('09:00'))
  assert.equal(enviadosBanco.length, 1, log.join(' | '))
  const t = enviadosBanco[0].texto
  assert.match(t, /Hoje\n- Aluguel, R\$ 900,00/)
  assert.match(t, /Amanhã\n- Internet, R\$ 99,90/)
  for (const fora of ['Luz já paga', 'A Bia me deve', 'Seguro', 'Boleto de ontem', 'não verificou', 'vai sair', 'da tarde', 'trial vencido']) {
    assert.doesNotMatch(t, new RegExp(fora), fora)
  }
  assert.equal(E.tabelas.avisos.length, 2)
  assert.ok(E.tabelas.avisos.every((a) => a.user_id === 'u1' && a.status === 'enviado' && a.tipo === 'vencimento' && a.para === '558188887777' && a.enviado_em), 'registrado com o número, o tipo e a hora do envio')
})

await caso('banco: o número é o da última conversa (sem o nono dígito, como o WhatsApp entrega), e cai no cadastrado se nunca conversou', async () => {
  semearBanco()
  await A.rodarAvisos(depsBanco(), CFG(), em('09:00'))
  assert.equal(enviadosBanco[0].tel, '558188887777', 'o JID em que ela escreveu, não o formatado do cadastro')
  semearBanco()
  E.tabelas.mensagens = []
  await A.rodarAvisos(depsBanco(), CFG(), em('09:00'))
  assert.equal(enviadosBanco[0].tel, '5581988887777', 'sem conversa: 55 + número cadastrado')
  semearBanco()
  E.tabelas.mensagens = [{ id: 'm1', user_id: 'u1', telefone: '558100000000', status: 'ignorada', criado_em: '2026-11-19T10:00:00Z' }]
  await A.rodarAvisos(depsBanco(), CFG(), em('09:00'))
  assert.equal(enviadosBanco[0].tel, '5581988887777', 'mensagem ignorada não conta como conversa')
})

await caso('banco: reservar é atômico: quem reserva primeiro é o único que envia, e a segunda tentativa volta vazia', async () => {
  semearBanco()
  const d = depsBanco()
  const itens = [{ chave: `venc:u1:c1:${HOJE}`, referencia: HOJE }]
  assert.deepEqual(await d.reservar('u1', '5581988887777', itens), [itens[0].chave])
  assert.deepEqual(await d.reservar('u1', '5581988887777', itens), [], 'a mesma chave não é entregue a dois')
  assert.equal(E.tabelas.avisos.length, 1)
})

await caso('banco: repetir o ciclo não manda de novo, e o registro sobrevive a "reiniciar"', async () => {
  semearBanco()
  await A.rodarAvisos(depsBanco(), CFG(), em('09:00'))
  novo()
  await A.rodarAvisos(depsBanco(), CFG(), em('09:05'))
  assert.equal(enviadosBanco.length, 1)
})

await caso('banco: falha de envio apaga a reserva, e o ciclo seguinte reenvia', async () => {
  semearBanco()
  await A.rodarAvisos(depsBanco(true), CFG(), em('09:00'))
  assert.equal(E.tabelas.avisos.length, 0, 'a reserva foi solta')
  A.estado.falhasPorPessoa.clear()
  await A.rodarAvisos(depsBanco(), CFG(), em('09:01'))
  assert.equal(enviadosBanco.length, 1)
  assert.equal(E.tabelas.avisos.length, 2)
})

await caso('banco: tabela avisos fora do ar: nada é enviado e o serviço segue de pé', async () => {
  semearBanco()
  E.falharTabela = 'avisos'
  const log = await A.rodarAvisos(depsBanco(), CFG(), em('09:00'))
  assert.equal(enviadosBanco.length, 0)
  assert.match(log.join(' '), /erro no ciclo, nada enviado/)
  E.falharTabela = null
})

await caso('banco: erro ao reservar NÃO é lido como "reservei": falha de verdade, e ninguém envia', async () => {
  semearBanco()
  const d = depsBanco()
  E.falharTabela = 'avisos'
  await assert.rejects(d.reservar('u1', '5581988887777', [{ chave: `venc:u1:c1:${HOJE}`, referencia: HOJE }]), /avisos reservar/)
  await assert.rejects(d.concluir('u1', [`venc:u1:c1:${HOJE}`], true), /marcar enviado/)
  await assert.rejects(d.concluir('u1', [`venc:u1:c1:${HOJE}`], false), /soltar reserva/)
  E.falharTabela = null
})

await caso('banco: o ensaio lê tudo de verdade, mas não grava nem envia', async () => {
  semearBanco()
  const log = await A.rodarAvisos(depsBanco(), CFG({ modo: 'ensaio' }), em('09:00'))
  assert.match(log.join(' '), /ensaio: enviaria a 55\*+7777 \(2 contas\)/)
  assert.equal(enviadosBanco.length, 0)
  assert.equal(E.tabelas.avisos.length, 0)
})

fim()
