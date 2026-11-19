/**
 * Fase "Conversa sem falha", últimos dois itens:
 *
 * - figurinha e reação ficam em silêncio (antes cada uma recebia "por aqui eu entendo texto, áudio...");
 * - áudio que não deu para entender é avisado como tal, em vez da lista de exemplos.
 *   npx tsx test/ruido.ts
 */
import assert from 'node:assert/strict'
import { caso, fim, ia, lancsU1, msgAudio, NUM } from './_falsos.ts'

const { processar } = await import('../src/granninha.ts')

let seq = 0
const mandar = async (tipo: string, extra: Record<string, unknown> = {}) => {
  const r = await processar({
    event: 'message.received',
    data: { key: { id: `R${Date.now()}${++seq}`, remoteJid: `${NUM}@s.whatsapp.net`, fromMe: false }, from: `${NUM}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: tipo, ...extra },
  } as Parameters<typeof processar>[0])
  return { resposta: r.resposta ?? '', status: r.status }
}

await caso('figurinha não recebe resposta', async () => {
  const r = await mandar('STICKER', { fileUrl: '/api/media/s1.webp' })
  assert.equal(r.resposta, '', 'nada é enviado')
  assert.equal(r.status, 'ignorada')
})

await caso('reação (o 👍 numa resposta) não recebe resposta', async () => {
  for (const t of ['REACTION', 'reaction', 'MESSAGE_REACTION']) {
    const r = await mandar(t)
    assert.equal(r.resposta, '', `tipo ${t} devia ficar em silêncio`)
  }
})

await caso('vídeo e localização CONTINUAM recebendo a mensagem de ajuda', async () => {
  // Aqui a pessoa quis mandar algo de verdade: calar seria pior.
  for (const t of ['VIDEO', 'LOCATION', 'CONTACT']) {
    const r = await mandar(t)
    assert.match(r.resposta, /texto, áudio, foto de comprovante e PDF/, `tipo ${t} devia receber a ajuda`)
  }
})

await caso('áudio sem nada compreensível é avisado, e não cai na lista de exemplos', async () => {
  ia.transcricao = '   '
  const r = await msgAudio()
  assert.match(r.resposta, /Não consegui entender o áudio/)
  assert.doesNotMatch(r.resposta, /recebi 150 da Juliana/, 'nada de despejar os exemplos')
  assert.equal(lancsU1().length, 0)
  assert.equal(ia.chamadas.interpretacao, 0, 'nem gasta IA interpretando o vazio')
})

await caso('transcrição só com pontuação também conta como vazia', async () => {
  ia.transcricao = '... ,!'
  const r = await msgAudio()
  assert.match(r.resposta, /Não consegui entender o áudio/)
})

await caso('áudio normal segue funcionando', async () => {
  ia.regras = [[/gasolina/, { intencao: 'acoes', acoes: [{ tipo_acao: 'lancamento', movimento: 'saida', valor: 50, descricao: 'Gasolina', categoria_id: 'material', carteira_id: 'nubank', carteira_destino_id: null, meio: 'pix', data: null, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null, conta_id: null, talvez_pessoal: false }], pergunta: null, correcao: null, falta: null }]]
  const r = await msgAudio()
  assert.match(r.resposta, /R\$ 50,00/)
  assert.equal(lancsU1().length, 1)
})

fim()
