/**
 * Aviso de fim do teste grátis: no penúltimo e no último dia, sozinho, uma vez por pessoa, sem nunca sair de
 * madrugada nem para quem já assinou. No dia seguinte o acesso já é bloqueado pela regra que existe (trial_fim < hoje).
 *
 * Origem (2026-11-21): depois de 31/12 o cadastro volta a ser 7 dias sem cartão; o Arthur pediu avisos no WhatsApp
 * avisando que o teste vai expirar e bloqueio no 8º dia, e que isso fosse autônomo (sem ninguém ligar nada).
 * Dependências falsas, sem rede.
 *   npx tsx test/avisos-teste.ts
 */
import assert from 'node:assert/strict'
import { caso, fim } from './_falsos.ts'

const A = await import('../src/avisos.ts')
const { depsAvisosDoBanco } = await import('../src/avisos-banco.ts')
type Deps = import('../src/avisos.ts').DepsAvisos
type Perfil = import('../src/avisos.ts').PerfilAviso

const em = (hhmm: string, dia: string) => new Date(`${dia}T${hhmm}:00-03:00`)
const HOJE = '2027-01-08'
const AMANHA = '2027-01-09'
const CFG = (x: Partial<import('../src/avisos.ts').ConfigTeste> = {}) => ({ modo: 'todos' as const, de: '09:00', ate: '20:00', maxPorCiclo: 15, espacoMs: 0, painelUrl: 'https://granninha.com.br/painel', ...x })
const perfil = (p: Partial<Perfil> = {}): Perfil => ({
  id: 'u1', nome: 'João da Padaria', whats: '(81) 98888-7777', whats_chave: '8188887777', lembrete_hora: '09:00', antecedencia: 1,
  ocultar: false, exclusao_em: null, assinatura: { status: 'trial', trial_fim: AMANHA }, ...p,
})

function fake(perfis: Partial<Perfil>[], opt: { falharEnvio?: boolean; sem?: Set<string> } = {}) {
  const ledger = new Map<string, string>()
  const enviados: { tel: string; texto: string }[] = []
  const esperas: number[] = []
  const deps: Deps = {
    perfis: async () => [],
    contas: async () => [],
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
    emTeste: async () => perfis.map(perfil),
  }
  return { deps, ledger, enviados, esperas }
}
const novo = () => A.zerarEstadoTeste()

await caso('termina amanhã: UMA mensagem, com o nome, o preço e o link para assinar; fica registrada como enviada', async () => {
  novo()
  const f = fake([{}])
  const log = await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', HOJE))
  assert.equal(f.enviados.length, 1, log.join(' | '))
  const t = f.enviados[0].texto
  assert.match(t, /^Oi, João\./)
  assert.match(t, /termina amanhã/)
  assert.match(t, /acesso fica pausado/)
  assert.match(t, /lançamentos continuam guardados/)
  assert.match(t, /R\$ 29,90 por mês/)
  assert.match(t, /https:\/\/granninha\.com\.br\/painel\/ajustes\/assinatura/)
  assert.equal(f.ledger.get(`teste:u1:${AMANHA}:amanha`), 'enviado')
})

await caso('último dia: mensagem de "hoje é o último dia" e o bloqueio a partir de amanhã', async () => {
  novo()
  const f = fake([{ assinatura: { status: 'trial', trial_fim: HOJE } }])
  await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', HOJE))
  assert.equal(f.enviados.length, 1)
  assert.match(f.enviados[0].texto, /Hoje é o último dia/)
  assert.match(f.enviados[0].texto, /a partir de amanhã o acesso fica pausado/i)
})

await caso('texto sem emoji e sem travessão (regra do Arthur)', async () => {
  for (const q of ['amanha', 'hoje'] as const) {
    const t = A.textoFimDoTeste('Ana Maria', q, 'https://granninha.com.br/painel')
    assert.ok(!/[—–]/.test(t), 'travessão')
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), 'emoji')
  }
  assert.match(A.textoFimDoTeste('', 'hoje', 'https://x'), /^Oi\. /, 'sem nome não escreve "Oi, ."')
})

await caso('rodar de novo no mesmo dia, dois minutos seguidos ou dois processos: NUNCA manda em dobro', async () => {
  novo()
  const f = fake([{}])
  await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', HOJE))
  await A.rodarAvisosTeste(f.deps, CFG(), em('10:01', HOJE))
  await A.rodarAvisosTeste(f.deps, CFG(), em('19:00', HOJE))
  assert.equal(f.enviados.length, 1)
})

await caso('dois avisos ao longo do teste: o de "amanhã" no penúltimo dia e o de "hoje" no último (chaves diferentes)', async () => {
  novo()
  const f = fake([{ assinatura: { status: 'trial', trial_fim: AMANHA } }])
  await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', HOJE))
  f.deps.emTeste = async () => [perfil({ assinatura: { status: 'trial', trial_fim: AMANHA } })]
  await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', AMANHA))
  assert.equal(f.enviados.length, 2)
  assert.match(f.enviados[0].texto, /termina amanhã/)
  assert.match(f.enviados[1].texto, /último dia/)
})

await caso('só avisa quem termina hoje ou amanhã: em 2 dias e teste já vencido ficam fora', async () => {
  novo()
  const f = fake([
    { id: 'a', assinatura: { status: 'trial', trial_fim: '2027-01-10' } },
    { id: 'b', assinatura: { status: 'trial', trial_fim: '2027-01-07' } },
  ])
  await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', HOJE))
  assert.equal(f.enviados.length, 0)
})

await caso('quem já assinou (ativa), tem cortesia ou está em atraso NÃO é avisado, mesmo com trial_fim hoje', async () => {
  novo()
  for (const status of ['ativa', 'cortesia', 'atrasada', 'bloqueada']) {
    const f = fake([{ assinatura: { status, trial_fim: HOJE } }])
    await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', HOJE))
    assert.equal(f.enviados.length, 0, status)
  }
})

await caso('conta em exclusão não recebe', async () => {
  novo()
  const f = fake([{ exclusao_em: '2027-02-01' }])
  await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', HOJE))
  assert.equal(f.enviados.length, 0)
})

await caso('horário: só entre 09:00 e 20:00, nunca de madrugada nem à noite (limites exatos)', async () => {
  for (const [h, esperado] of [['08:59', 0], ['09:00', 1], ['20:00', 1], ['20:01', 0], ['21:31', 0], ['03:00', 0]] as const) {
    novo()
    const f = fake([{}])
    await A.rodarAvisosTeste(f.deps, CFG(), em(h, HOJE))
    assert.equal(f.enviados.length, esperado, h)
  }
})

await caso('nunca depois das 21:30 nem com a janela configurada até 23:00', async () => {
  novo()
  const f = fake([{}])
  await A.rodarAvisosTeste(f.deps, CFG({ ate: '23:00' }), em('21:45', HOJE))
  assert.equal(f.enviados.length, 0)
})

await caso('padrão é LIGADO (autônomo); AVISOS_TESTE=off desliga; =ensaio só escreve no log', async () => {
  assert.equal(A.lerConfigTeste({}).modo, 'todos')
  assert.equal(A.lerConfigTeste({ AVISOS_TESTE: '' }).modo, 'todos')
  assert.equal(A.lerConfigTeste({ AVISOS_TESTE: 'OFF' }).modo, 'off')
  assert.equal(A.lerConfigTeste({ AVISOS_TESTE: 'ensaio' }).modo, 'ensaio')
  novo()
  const off = fake([{}])
  await A.rodarAvisosTeste(off.deps, CFG({ modo: 'off' }), em('10:00', HOJE))
  assert.equal(off.enviados.length, 0)
  const ens = fake([{}])
  const log = await A.rodarAvisosTeste(ens.deps, CFG({ modo: 'ensaio' }), em('10:00', HOJE))
  assert.equal(ens.enviados.length, 0)
  assert.equal(ens.ledger.size, 0, 'ensaio não reserva nada')
  assert.ok(log.some((l) => /^ensaio: avisaria \(termina amanhã\) a 55\*+7777$/.test(l)), log.join(' | '))
})

await caso('configuração: horas inválidas voltam ao padrão e o painel vem de PAINEL_URL', async () => {
  const c = A.lerConfigTeste({ AVISOS_TESTE_DE: 'abc', AVISOS_TESTE_ATE: '18:30', PAINEL_URL: 'https://x.com/painel///' })
  assert.deepEqual([c.de, c.ate, c.painelUrl], ['09:00', '18:30', 'https://x.com/painel'])
})

await caso('falha no envio: solta a reserva e tenta de novo no minuto seguinte, no máximo 3 vezes por dia', async () => {
  novo()
  const f = fake([{}], { falharEnvio: true })
  for (let i = 0; i < 5; i++) await A.rodarAvisosTeste(f.deps, CFG(), em(`10:0${i}`, HOJE))
  assert.equal(f.ledger.size, 0, 'nunca fica "enviado" sem ter saído')
  assert.equal(A.estadoTeste.falhas, 3, 'para na terceira tentativa do dia')
  // No dia seguinte (último dia) recomeça, e sai.
  f.deps.enviar = async (tel, texto) => void f.enviados.push({ tel, texto })
  f.deps.emTeste = async () => [perfil({ assinatura: { status: 'trial', trial_fim: AMANHA } })]
  await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', AMANHA))
  assert.equal(f.enviados.length, 1)
})

await caso('sem número para avisar: registra no log e não reserva', async () => {
  novo()
  const f = fake([{}], { sem: new Set(['u1']) })
  const log = await A.rodarAvisosTeste(f.deps, CFG(), em('10:00', HOJE))
  assert.equal(f.enviados.length, 0)
  assert.equal(f.ledger.size, 0)
  assert.ok(log.some((l) => /não escreveu para o número atual/.test(l)))
})

await caso('ritmo: envios espaçados e teto por ciclo (número não oficial que dispara demais é banido)', async () => {
  novo()
  const muitos = Array.from({ length: 5 }, (_, i) => ({ id: `u${i}` }))
  const f = fake(muitos)
  const log = await A.rodarAvisosTeste(f.deps, CFG({ maxPorCiclo: 3, espacoMs: 5000 }), em('10:00', HOJE))
  assert.equal(f.enviados.length, 3)
  assert.equal(f.esperas.length, 2, 'espera entre um envio e o seguinte, não antes do primeiro')
  assert.ok(f.esperas.every((ms) => ms >= 5000))
  assert.ok(log.some((l) => /teto de envios/.test(l)))
  // O minuto seguinte continua de onde parou, sem repetir quem já recebeu.
  await A.rodarAvisosTeste(f.deps, CFG({ maxPorCiclo: 3 }), em('10:01', HOJE))
  assert.equal(f.enviados.length, 5)
})

await caso('sem a consulta emTeste (dependência ausente) o ciclo não faz nada e não quebra', async () => {
  novo()
  const f = fake([{}])
  const semConsulta: Deps = { ...f.deps }
  delete semConsulta.emTeste
  assert.deepEqual(await A.rodarAvisosTeste(semConsulta, CFG(), em('10:00', HOJE)), [])
})

/* ===================== a consulta real, contra um banco em memória ===================== */

type Linha = Record<string, any>
function banco(tabelas: Record<string, Linha[]>) {
  const from = (t: string) => {
    const filtros: ((r: Linha) => boolean)[] = []
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), b),
      in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(r[c])), b),
      is: (c: string, v: unknown) => (filtros.push((r) => (r[c] ?? null) === v), b),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: (tabelas[t] ?? []).filter((r) => filtros.every((f) => f(r))).map((r) => ({ ...r })), error: null }).then(ok),
    }
    return b
  }
  return { from } as never
}

await caso('consulta de verdade: só trial que termina hoje ou amanhã, com WhatsApp verificado e sem exclusão', async () => {
  const sbFalso = banco({
    assinaturas: [
      { user_id: 'a', status: 'trial', trial_fim: HOJE },
      { user_id: 'b', status: 'trial', trial_fim: AMANHA },
      { user_id: 'c', status: 'trial', trial_fim: '2027-01-12' },
      { user_id: 'd', status: 'ativa', trial_fim: HOJE },
      { user_id: 'e', status: 'trial', trial_fim: HOJE },
      { user_id: 'f', status: 'trial', trial_fim: HOJE },
    ],
    perfis: [
      { id: 'a', nome: 'Ana', whats: '81911112222', whats_chave: '8111112222', whats_verificado: true, exclusao_em: null },
      { id: 'b', nome: 'Bia', whats: '81933334444', whats_chave: '8133334444', whats_verificado: true, exclusao_em: null },
      { id: 'c', nome: 'Cris', whats: '81955556666', whats_chave: '8155556666', whats_verificado: true, exclusao_em: null },
      { id: 'd', nome: 'Duda', whats: '81977778888', whats_chave: '8177778888', whats_verificado: true, exclusao_em: null },
      { id: 'e', nome: 'Eva', whats: '81999990000', whats_chave: '8199990000', whats_verificado: false, exclusao_em: null },
      { id: 'f', nome: 'Fê', whats: '81912345678', whats_chave: '8112345678', whats_verificado: true, exclusao_em: '2027-02-01' },
    ],
  })
  const deps = depsAvisosDoBanco(sbFalso, async () => {})
  const r = await deps.emTeste!(HOJE, AMANHA)
  assert.deepEqual(r.map((p) => p.id).sort(), ['a', 'b'])
  assert.deepEqual(r.find((p) => p.id === 'a')!.assinatura, { status: 'trial', trial_fim: HOJE })
})

fim()
