/**
 * Espera de 10 s e rajada (rajada.ts): o que é juntado e o que fica sozinho.
 *   npx tsx test/rajada.ts
 */
import assert from 'node:assert/strict'
import type { EventoGateway } from '../src/granninha.ts'

const { agrupar, ehSozinha } = await import('../src/rajada.ts')

let seq = 0
const ev = (type: string, content = '', caption?: string): EventoGateway => ({
  event: 'message.received',
  data: { key: { id: `R${++seq}`, remoteJid: '5581999990000@s.whatsapp.net' }, from: '5581999990000@s.whatsapp.net', chatType: 'PERSONAL', type, content, caption, fileUrl: type === 'TEXT' ? null : 'http://x/arquivo' },
})
const txt = (t: string) => ev('TEXT', t)
const foto = (caption = '') => ev('IMAGE', '', caption)
const audio = () => ev('AUDIO')

let falhas = 0
let total = 0
async function caso(nome: string, f: () => void | Promise<void>) {
  total++
  try {
    await f()
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message)
  }
}

await caso('"oi", "lança isso", "10 reais" viram uma mensagem só, processada no id da última', () => {
  const a = txt('oi'), b = txt('lança isso'), c = txt('10 reais')
  const u = agrupar([a, b, c])
  assert.equal(u.length, 1)
  assert.equal(u[0].ev.data.key?.id, c.data.key?.id)
  assert.equal(u[0].ev.data.content, 'oi\nlança isso\n10 reais')
  assert.deepEqual(u[0].juntadas, [a.data.key?.id, b.data.key?.id])
})

await caso('print do extrato e depois a pergunta: a pergunta vira a legenda do print', () => {
  const f = foto(), q = txt('quais desses já foram lançados?')
  const u = agrupar([f, q])
  assert.equal(u.length, 1)
  assert.equal(u[0].ev.data.key?.id, f.data.key?.id)
  assert.equal(u[0].ev.data.caption, 'quais desses já foram lançados?')
  assert.deepEqual(u[0].juntadas, [q.data.key?.id])
})

await caso('texto antes da foto e legenda própria: tudo junto, na ordem', () => {
  const a = txt('olha esse'), f = foto('extrato de ontem')
  const u = agrupar([a, f])
  assert.equal(u.length, 1)
  assert.equal(u[0].ev.data.caption, 'olha esse\nextrato de ontem')
})

await caso('"sim" e depois "anota 50 de gás" continuam separadas', () => {
  const u = agrupar([txt('sim'), txt('anota 50 de gás')])
  assert.equal(u.length, 2)
  assert.equal(u[0].ev.data.content, 'sim')
  assert.equal(u[1].ev.data.content, 'anota 50 de gás')
})

await caso('código de 6 números fica sozinho, mesmo com "oi" antes', () => {
  const u = agrupar([txt('oi'), txt('meu código é 482913')])
  assert.equal(u.length, 2)
  assert.equal(u[1].ev.data.content, 'meu código é 482913')
})

await caso('DESFAZER, SAIR, "2", "pronto", "não", "já paguei" ficam sozinhos', () => {
  for (const t of ['DESFAZER', 'desfaz', 'SAIR', '2', 'pronto', 'não', 'já paguei', 'pular', 'ok']) assert.ok(ehSozinha(t), t)
  for (const t of ['oi', 'lança isso', '10 reais', 'paguei 50 de luz', 'quais desses já foram lançados?']) assert.ok(!ehSozinha(t), t)
  const u = agrupar([txt('paguei 30 de uber'), txt('DESFAZER'), txt('foi 35')])
  assert.deepEqual(u.map((x) => x.ev.data.content), ['paguei 30 de uber', 'DESFAZER', 'foi 35'])
})

await caso('cinco comprovantes seguidos continuam cinco', () => {
  const u = agrupar([foto(), foto(), foto(), foto(), foto()])
  assert.equal(u.length, 5)
  assert.ok(u.every((x) => x.juntadas.length === 0))
})

await caso('duas fotos com texto no meio: o texto vai com a foto de antes', () => {
  const f1 = foto(), t = txt('esse foi do mercado'), f2 = foto()
  const u = agrupar([f1, t, f2])
  assert.equal(u.length, 2)
  assert.equal(u[0].ev.data.caption, 'esse foi do mercado')
  assert.equal(u[1].ev.data.caption ?? '', '')
})

await caso('áudio com texto depois: o texto vai como legenda do áudio', () => {
  const a = audio(), t = txt('no nubank')
  const u = agrupar([a, t])
  assert.equal(u.length, 1)
  assert.equal(u[0].ev.data.type, 'AUDIO')
  assert.equal(u[0].ev.data.caption, 'no nubank')
})

await caso('sticker no meio fica sozinho e não quebra a ordem', () => {
  const u = agrupar([txt('oi'), ev('STICKER'), txt('gastei 20 de pão')])
  assert.deepEqual(u.map((x) => x.ev.data.type), ['TEXT', 'STICKER', 'TEXT'])
})

await caso('com pergunta em aberto, a primeira fica sozinha: "pode anotar" + "gastei 20 de pão", "pessoal" + "e anota 20 de café"', () => {
  const u = agrupar([txt('pode anotar'), txt('gastei 20 de pão')], { primeiraSozinha: true })
  assert.deepEqual(u.map((x) => x.ev.data.content), ['pode anotar', 'gastei 20 de pão'])
  assert.deepEqual(agrupar([txt('pessoal'), txt('e anota 20 de café')], { primeiraSozinha: true }).map((x) => x.ev.data.content), ['pessoal', 'e anota 20 de café'])
  assert.equal(agrupar([txt('lança isso'), txt('10 reais')]).length, 1, 'sem pergunta em aberto, "lança isso" junta')
})

await caso('pergunta com número continua virando legenda do print ("quais desses 3 já foram lançados?", "esse é do dia 24")', () => {
  for (const q of ['quais desses 3 já foram lançados?', 'esse é do dia 24', 'extrato de novembro 2026']) {
    const u = agrupar([foto(), txt(q)])
    assert.equal(u.length, 1, q)
    assert.equal(u[0].ev.data.caption, q)
  }
})

await caso('tetos: legenda até 450 caracteres (o resto vira texto próprio) e texto juntado até 1800 (o resto vira outro bloco); nada se perde', () => {
  const grande = 'a'.repeat(300)
  const u = agrupar([foto(), txt(grande), txt(grande)])
  assert.equal(u.length, 2)
  assert.equal(u[0].ev.data.caption, grande)
  assert.equal(u[1].ev.data.content, grande)
  const mil = 'b'.repeat(1000)
  const v = agrupar([txt(mil), txt(mil), txt('oi')])
  assert.ok(v.every((x) => (x.ev.data.content ?? '').length <= 1800), 'bloco passou do teto')
  assert.equal(v.reduce((a, x) => a + 1 + x.juntadas.length, 0), 3, 'perdeu mensagem')
})

await caso('comprovante e depois "gastei 20 de pão": são dois registros, o 20 não vira legenda', () => {
  const f = foto(), t = txt('gastei 20 de pão')
  const u = agrupar([f, t])
  assert.equal(u.length, 2)
  assert.equal(u[0].ev.data.caption ?? '', '')
  assert.equal(u[1].ev.data.content, 'gastei 20 de pão')
})

await caso('sem mídia, texto com valor junta normal ("lança isso" + "10 reais")', () => {
  assert.equal(agrupar([txt('lança isso'), txt('10 reais')]).length, 1)
})

await caso('a unidade guarda as originais na ordem (para atender uma a uma se a marcação falhar)', () => {
  const a = txt('olha'), f = foto(), q = txt('quais desses já foram?')
  const u = agrupar([a, f, q])
  assert.equal(u.length, 1)
  assert.deepEqual(u[0].originais.map((e) => e.data.key?.id), [a, f, q].map((e) => e.data.key?.id))
})

await caso('mensagem única sai do jeito que chegou', () => {
  const a = txt('recebi 150 no pix')
  const u = agrupar([a])
  assert.equal(u.length, 1)
  assert.equal(u[0].ev, a)
})

console.log(falhas ? `\n${falhas} falha(s) de ${total}` : `\nrajada: ${total} de ${total}`)
if (falhas) process.exit(1)
