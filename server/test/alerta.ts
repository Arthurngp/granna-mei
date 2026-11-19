/**
 * O aviso que vai para o dono quando a Granninha para. Sem banco, sem IA, sem rede.
 *
 * Caso de origem (2026-11-19): a chave da OpenAI ficou sem cota e a Granninha respondeu "tive um
 * problema para anotar agora" para todos os clientes por horas, sem avisar ninguém.
 *   npx tsx test/alerta.ts
 */
export {} // módulo: o import dinâmico abaixo precisa disso

import assert from 'node:assert/strict'

process.env.ALERTA_SILENCIO_MS = '3600000' // 1h, para o teste não depender do padrão
const { problemaDe, decidirAviso, textoVoltou, numeroDeAviso, SILENCIO_MS } = await import('../src/alerta.ts')

let n = 0
let falhou = 0
const caso = (nome: string, fn: () => void) => {
  try {
    fn()
    n++
    console.log('  ok  ', nome)
  } catch (e) {
    falhou++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 220))
  }
}

const cfg = (x: Partial<Parameters<typeof decidirAviso>[0]> = {}) => ({
  alerta_whats: '5581999998888', alerta_ligado: true, alerta_tipo: null, alerta_em: null, ...x,
})
const BEM = { iaOk: true, iaProblema: null, iaDesde: null, whatsappEstado: 'CONNECTED' }
const SEM_COTA = { iaOk: false, iaProblema: 'sem_cota', iaDesde: '2026-11-19T20:40:00.000Z', whatsappEstado: 'CONNECTED' }

caso('tudo de pé: nenhum problema', () => {
  assert.equal(problemaDe(BEM), null)
})

caso('IA sem cota vira aviso em português, com a hora e o que isso significa', () => {
  const p = problemaDe(SEM_COTA)!
  assert.equal(p.tipo, 'ia:sem_cota')
  assert.match(p.texto, /sem crédito/)
  assert.match(p.texto, /não consigo anotar nada/)
  assert.doesNotMatch(p.texto, /quota|429|insufficient/i, 'sem jargão técnico')
  assert.equal(p.entregavel, true, 'o WhatsApp está de pé, então o aviso sai')
})

caso('WhatsApp caído é registrado, mas NÃO é entregável (é o próprio canal)', () => {
  const p = problemaDe({ iaOk: true, iaProblema: null, iaDesde: null, whatsappEstado: 'DISCONNECTED' })!
  assert.equal(p.tipo, 'whatsapp:DISCONNECTED')
  assert.equal(p.entregavel, false, 'não dá para avisar pelo canal quebrado — é para isso que existe o olho de fora')
})

caso('IA fora tem prioridade sobre o resto', () => {
  const p = problemaDe({ ...SEM_COTA, whatsappEstado: 'CONNECTED' })!
  assert.ok(p.tipo.startsWith('ia:'))
})

caso('desligado ou sem número: não faz nada', () => {
  assert.equal(decidirAviso(cfg({ alerta_ligado: false }), SEM_COTA).acao, 'nada')
  assert.equal(decidirAviso(cfg({ alerta_whats: '  ' }), SEM_COTA).acao, 'nada')
})

caso('problema novo: avisa', () => {
  const d = decidirAviso(cfg(), SEM_COTA)
  assert.equal(d.acao, 'avisar')
  assert.equal(d.aviso?.tipo, 'ia:sem_cota')
})

caso('mesmo problema logo depois: fica quieto', () => {
  const agora = Date.parse('2026-11-19T21:00:00.000Z')
  const d = decidirAviso(cfg({ alerta_tipo: 'ia:sem_cota', alerta_em: '2026-11-19T20:50:00.000Z' }), SEM_COTA, agora)
  assert.equal(d.acao, 'nada', 'alerta que repete a cada minuto deixa de ser lido')
})

caso('mesmo problema depois do silêncio: lembra uma vez', () => {
  const agora = Date.parse('2026-11-19T22:00:00.000Z')
  const d = decidirAviso(cfg({ alerta_tipo: 'ia:sem_cota', alerta_em: '2026-11-19T20:50:00.000Z' }), SEM_COTA, agora)
  assert.equal(d.acao, 'avisar')
  assert.ok(SILENCIO_MS <= 3600000)
})

caso('o problema MUDA de tipo: avisa de novo na hora', () => {
  const d = decidirAviso(
    cfg({ alerta_tipo: 'ia:limite', alerta_em: new Date().toISOString() }),
    SEM_COTA,
  )
  assert.equal(d.acao, 'avisar', 'limite virou falta de crédito: é outra coisa')
})

caso('voltou ao normal: avisa uma vez e zera', () => {
  const d = decidirAviso(cfg({ alerta_tipo: 'ia:sem_cota', alerta_em: new Date().toISOString() }), BEM)
  assert.equal(d.acao, 'voltou')
  assert.match(textoVoltou('ia:sem_cota'), /A IA voltou/)
  assert.match(textoVoltou('ia:sem_cota'), /volta sozinho/, 'conta que o que ficou pendurado é retomado')
  assert.match(textoVoltou('whatsapp:CLOSED'), /O WhatsApp voltou/)
})

caso('voltou ao normal sem nunca ter avisado: não diz nada', () => {
  assert.equal(decidirAviso(cfg(), BEM).acao, 'nada')
})

caso('número do aviso: aceita o jeito que a gente digita', () => {
  assert.equal(numeroDeAviso('(81) 99999-8888'), '5581999998888')
  assert.equal(numeroDeAviso('81999998888'), '5581999998888')
  assert.equal(numeroDeAviso('5581999998888'), '5581999998888')
  assert.equal(numeroDeAviso('999998888'), '', 'sem DDD não dá')
  assert.equal(numeroDeAviso(''), '')
  assert.equal(numeroDeAviso('abc'), '')
})

console.log(falhou ? `\n${falhou} falha(s) de ${n + falhou}` : `\n${n} casos ok`)
process.exit(falhou ? 1 : 0)
