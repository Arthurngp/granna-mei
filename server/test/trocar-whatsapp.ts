/**
 * Troca do número do WhatsApp: a confirmação em duas etapas é exigida pelo SERVIDOR. Cada caso de recusa prova que nada foi
 * desconectado (nenhuma chamada de logout chegou ao gateway). Sem banco, sem IA, sem gateway. Rodar: npx tsx test/trocar-whatsapp.ts
 */
import assert from 'node:assert/strict'
import { criarTroca, ErroTroca, FRASE, MAX_ERROS, tratarTroca, VALIDADE_MS, type DepsTroca } from '../src/trocar-whatsapp.ts'

function montar(inicial: { estado: string; numero: string | null } = { estado: 'CONNECTED', numero: '5581988889537' }) {
  const g = {
    estado: inicial.estado,
    numero: inicial.numero,
    t: 1_000_000,
    seq: 0,
    chamadas: [] as string[],
    auditoria: [] as { adminId: string; acao: string; detalhes: Record<string, unknown> }[],
    logoutFalha: false,
    naoDesconecta: false,
    auditoriaFalha: false,
    qrFalha: false,
    logoutDemora: 0,
  }
  const d: DepsTroca = {
    status: async () => (g.chamadas.push('status'), { estado: g.estado, numero: g.numero }),
    desvincular: async () => {
      g.chamadas.push('logout')
      if (g.logoutDemora) await new Promise((ok) => setTimeout(ok, g.logoutDemora))
      if (g.logoutFalha) throw new Error('gateway logout 500')
      if (!g.naoDesconecta) {
        g.estado = 'LOGGED_OUT'
        g.numero = null
      }
    },
    qr: async () => {
      g.chamadas.push('qr')
      if (g.qrFalha) throw new Error('gateway qr 502')
      return { conectado: g.estado === 'CONNECTED', imagem: g.estado === 'CONNECTED' ? null : 'data:image/png;base64,QR', estado: g.estado, numero: g.numero }
    },
    auditar: async (adminId, acao, detalhes) => {
      if (g.auditoriaFalha) throw new Error('banco fora')
      g.auditoria.push({ adminId, acao, detalhes })
    },
    agora: () => g.t,
    sorteio: () => `codigo-${++g.seq}`,
    esperar: async (ms) => void (g.t += ms),
  }
  return { g, troca: criarTroca(d) }
}
const desconectou = (g: { chamadas: string[] }) => g.chamadas.includes('logout')

async function recusa(promessa: Promise<unknown>, status: number, trecho?: RegExp) {
  try {
    await promessa
  } catch (e) {
    assert.ok(e instanceof ErroTroca, 'erro de regra, não erro solto: ' + String(e))
    assert.equal(e.status, status, e.message)
    if (trecho) assert.match(e.message, trecho)
    return
  }
  assert.fail('devia ter recusado com ' + status)
}

let n = 0
const caso = async (nome: string, fn: () => Promise<void>) => {
  await fn()
  n++
  console.log('  ok', nome)
}

await caso('a etapa 1 só libera a confirmação: não toca no WhatsApp e mostra só o final do número', async () => {
  const { g, troca } = montar()
  const r = await troca.pedir('admin-1')
  assert.equal(r.conectado, true)
  assert.equal(r.numero_final, '9537')
  assert.equal(r.validade_s, VALIDADE_MS / 1000)
  assert.ok(r.codigo && r.codigo.length > 3)
  assert.ok(!JSON.stringify(r).includes('5581988889537'), 'o número inteiro não sai no pedido')
  assert.ok(!desconectou(g))
  assert.equal(g.estado, 'CONNECTED')
})

await caso('sem a etapa 1 NÃO existe caminho para desconectar', async () => {
  const { g, troca } = montar()
  await recusa(troca.confirmar('admin-1', 'codigo-1', FRASE), 400, /primeira etapa/)
  await recusa(troca.confirmar('admin-1', '', FRASE), 400)
  assert.ok(!desconectou(g))
})

await caso('código errado: recusa e não desconecta', async () => {
  const { g, troca } = montar()
  await troca.pedir('admin-1')
  await recusa(troca.confirmar('admin-1', 'chutei', FRASE), 400, /inválida/)
  assert.ok(!desconectou(g))
  assert.equal(g.estado, 'CONNECTED')
})

await caso('frase errada ou vazia: recusa e não desconecta', async () => {
  const { g, troca } = montar()
  const { codigo } = await troca.pedir('admin-1')
  // abaixo do limite de tentativas: cada uma é recusada com a orientação, e nada é desconectado
  await recusa(troca.confirmar('admin-1', codigo, ''), 400, /Digite TROCAR/)
  await recusa(troca.confirmar('admin-1', codigo, 'trocar numero'), 400, /Digite TROCAR/)
  assert.ok(!desconectou(g))
  assert.equal(g.estado, 'CONNECTED')
})

await caso(`${MAX_ERROS} erros seguidos invalidam o código (não dá para tentar à força)`, async () => {
  const { g, troca } = montar()
  const { codigo } = await troca.pedir('admin-1')
  await recusa(troca.confirmar('admin-1', codigo, 'x'), 400)
  await recusa(troca.confirmar('admin-1', codigo, 'y'), 400)
  await recusa(troca.confirmar('admin-1', codigo, 'z'), 429)
  // o código certo com a frase certa já não vale mais
  await recusa(troca.confirmar('admin-1', codigo, FRASE), 400, /primeira etapa/)
  assert.ok(!desconectou(g))
})

await caso('o código vence em 2 minutos', async () => {
  const { g, troca } = montar()
  const { codigo } = await troca.pedir('admin-1')
  g.t += VALIDADE_MS + 1
  await recusa(troca.confirmar('admin-1', codigo, FRASE), 410, /venceu/)
  assert.ok(!desconectou(g))
})

await caso('o limite exato: ainda vale no último instante', async () => {
  const { g, troca } = montar()
  const { codigo } = await troca.pedir('admin-1')
  g.t += VALIDADE_MS
  const r = await troca.confirmar('admin-1', codigo, FRASE)
  assert.equal(r.desconectou, true)
})

await caso('o código de um admin não vale para outro', async () => {
  const { g, troca } = montar()
  const { codigo } = await troca.pedir('admin-1')
  await recusa(troca.confirmar('admin-2', codigo, FRASE), 400, /primeira etapa/)
  assert.ok(!desconectou(g))
  // e o do dono continua valendo
  assert.equal((await troca.confirmar('admin-1', codigo, FRASE)).desconectou, true)
})

await caso('um pedido novo substitui o anterior: o código velho deixa de valer', async () => {
  const { g, troca } = montar()
  const velho = (await troca.pedir('admin-1')).codigo
  const novo = (await troca.pedir('admin-1')).codigo
  assert.notEqual(velho, novo)
  await recusa(troca.confirmar('admin-1', velho, FRASE), 400)
  assert.ok(!desconectou(g))
  assert.equal((await troca.confirmar('admin-1', novo, FRASE)).desconectou, true)
})

await caso('caminho feliz: desconecta UMA vez, devolve o QR do chip novo e audita só o final do número', async () => {
  const { g, troca } = montar()
  const { codigo } = await troca.pedir('admin-1')
  const r = await troca.confirmar('admin-1', codigo, '  trocar ')
  assert.equal(r.desconectou, true)
  assert.equal(r.conectado, false)
  assert.ok(r.imagem?.startsWith('data:image/png'))
  assert.equal(g.chamadas.filter((c) => c === 'logout').length, 1)
  assert.equal(g.estado, 'LOGGED_OUT')
  assert.equal(g.auditoria.length, 1)
  assert.equal(g.auditoria[0].adminId, 'admin-1')
  assert.equal(g.auditoria[0].acao, 'whatsapp_desconectar')
  assert.equal(g.auditoria[0].detalhes.numero_final, '9537')
  assert.ok(!JSON.stringify(g.auditoria).includes('5581988889537'), 'a auditoria não guarda o número inteiro')
  // a ordem importa: logout antes do QR
  assert.ok(g.chamadas.indexOf('logout') < g.chamadas.indexOf('qr'))
})

await caso('uso único: repetir a mesma confirmação não desconecta de novo', async () => {
  const { g, troca } = montar()
  const { codigo } = await troca.pedir('admin-1')
  await troca.confirmar('admin-1', codigo, FRASE)
  g.estado = 'CONNECTED' // o chip novo foi lido
  g.numero = '5581977771111'
  await recusa(troca.confirmar('admin-1', codigo, FRASE), 400, /primeira etapa/)
  assert.equal(g.chamadas.filter((c) => c === 'logout').length, 1)
  assert.equal(g.estado, 'CONNECTED', 'o número novo ficou intacto')
})

await caso('dois cliques ao mesmo tempo: só um executa', async () => {
  const { g, troca } = montar()
  g.logoutDemora = 20
  const { codigo } = await troca.pedir('admin-1')
  const outro = (await troca.pedir('admin-2')).codigo
  const a = troca.confirmar('admin-1', codigo, FRASE)
  await new Promise((ok) => setTimeout(ok, 5))
  await recusa(troca.confirmar('admin-2', outro, FRASE), 409, /em andamento/)
  await a
  assert.equal(g.chamadas.filter((c) => c === 'logout').length, 1)
})

await caso('já estava desconectado: não faz logout, só entrega o QR (e não audita desconexão que não houve)', async () => {
  const { g, troca } = montar({ estado: 'LOGGED_OUT', numero: null })
  const r = await troca.pedir('admin-1')
  assert.equal(r.conectado, false)
  assert.equal(r.numero_final, null)
  const q = await troca.confirmar('admin-1', r.codigo, FRASE)
  assert.equal(q.desconectou, false)
  assert.ok(q.imagem)
  assert.ok(!desconectou(g))
  assert.equal(g.auditoria.length, 0)
})

await caso('o gateway recusa o logout: erro claro, número continua conectado, nada auditado', async () => {
  const { g, troca } = montar()
  g.logoutFalha = true
  const { codigo } = await troca.pedir('admin-1')
  await recusa(troca.confirmar('admin-1', codigo, FRASE), 502, /desconectar/)
  assert.equal(g.estado, 'CONNECTED')
  assert.equal(g.auditoria.length, 0)
})

await caso('o gateway aceita o logout mas o número não sai: não finge que desconectou', async () => {
  const { g, troca } = montar()
  g.naoDesconecta = true
  const { codigo } = await troca.pedir('admin-1')
  await recusa(troca.confirmar('admin-1', codigo, FRASE), 502, /não confirmou/)
  assert.equal(g.auditoria.length, 0)
  assert.ok(!g.chamadas.includes('qr'), 'não pede QR de um número que ainda está conectado')
})

await caso('depois de uma falha dá para recomeçar (o bloqueio de "em andamento" não fica preso)', async () => {
  const { g, troca } = montar()
  g.logoutFalha = true
  const a = await troca.pedir('admin-1')
  await recusa(troca.confirmar('admin-1', a.codigo, FRASE), 502)
  g.logoutFalha = false
  const b = await troca.pedir('admin-1')
  assert.equal((await troca.confirmar('admin-1', b.codigo, FRASE)).desconectou, true)
})

await caso('falha ao gravar a auditoria não impede de terminar a troca', async () => {
  const { g, troca } = montar()
  g.auditoriaFalha = true
  const { codigo } = await troca.pedir('admin-1')
  const r = await troca.confirmar('admin-1', codigo, FRASE)
  assert.equal(r.desconectou, true)
  assert.ok(r.imagem)
})

await caso('desconectou mas o QR não saiu: diz isso, para o admin usar o botão de QR', async () => {
  const { g, troca } = montar()
  g.qrFalha = true
  const { codigo } = await troca.pedir('admin-1')
  await recusa(troca.confirmar('admin-1', codigo, FRASE), 502, /foi desconectado, mas o QR/)
  assert.equal(g.estado, 'LOGGED_OUT')
})

// ---- as rotas HTTP (decisão, formato e códigos) ----
const corpo = (o: unknown) => async () => JSON.stringify(o)

await caso('rotas: só POST nas duas rotas; outros caminhos não são daqui', async () => {
  const { troca } = montar()
  assert.equal(await tratarTroca(troca, 'a', 'GET', '/admin/qr', corpo({})), null)
  assert.equal(await tratarTroca(troca, 'a', 'POST', '/admin/alerta', corpo({})), null)
  assert.equal((await tratarTroca(troca, 'a', 'GET', '/admin/whatsapp/trocar/pedir', corpo({})))?.status, 405)
  assert.equal((await tratarTroca(troca, 'a', 'POST', '/admin/whatsapp/trocar/outra', corpo({})))?.status, 404)
})

await caso('rotas: pedir e confirmar de ponta a ponta, com os códigos certos', async () => {
  const { g, troca } = montar()
  const p = await tratarTroca(troca, 'a', 'POST', '/admin/whatsapp/trocar/pedir', corpo({}))
  assert.equal(p?.status, 200)
  const codigo = (p!.json as { codigo: string }).codigo
  const ruim = await tratarTroca(troca, 'a', 'POST', '/admin/whatsapp/trocar/confirmar', corpo({ codigo, frase: 'nao' }))
  assert.equal(ruim?.status, 400)
  assert.ok(!desconectou(g))
  const ok = await tratarTroca(troca, 'a', 'POST', '/admin/whatsapp/trocar/confirmar', corpo({ codigo, frase: 'TROCAR' }))
  assert.equal(ok?.status, 200)
  assert.equal((ok!.json as { desconectou: boolean }).desconectou, true)
})

await caso('rotas: corpo quebrado ou com tipos errados é recusado sem desconectar, e nunca vira 401', async () => {
  const { g, troca } = montar()
  await troca.pedir('a')
  const quebrado = await tratarTroca(troca, 'a', 'POST', '/admin/whatsapp/trocar/confirmar', async () => '{nao é json')
  assert.equal(quebrado?.status, 400)
  const tipos = await tratarTroca(troca, 'a', 'POST', '/admin/whatsapp/trocar/confirmar', corpo({ codigo: 123, frase: ['TROCAR'] }))
  assert.equal(tipos?.status, 400)
  assert.ok(!desconectou(g))
  for (const r of [quebrado, tipos]) assert.notEqual(r?.status, 401)
})

await caso('rotas: erro inesperado vira 500 com mensagem, nunca derruba o servidor', async () => {
  const dep = criarTroca({ status: async () => Promise.reject(new Error('gateway fora')), desvincular: async () => {}, qr: async () => ({ conectado: false, imagem: null, estado: 'X', numero: null }), auditar: async () => {}, agora: () => 0, sorteio: () => 'c', esperar: async () => {} })
  const r = await tratarTroca(dep, 'a', 'POST', '/admin/whatsapp/trocar/pedir', corpo({}))
  assert.equal(r?.status, 500)
  assert.match((r!.json as { erro: string }).erro, /gateway fora/)
})

console.log('trocar-whatsapp: ' + n + ' casos ok')
