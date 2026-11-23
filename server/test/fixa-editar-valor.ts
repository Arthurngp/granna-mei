/**
 * Mudar o valor de uma conta fixa pelo painel (src/lib/fixas.ts), a regra que a ficha da conta e Ajustes usam.
 * O defeito de origem (achado do Arthur em 23/11): a conta "Internet" estava em R$ 120 e ele não conseguia passar para R$ 109. O campo de
 * valor gravava a cada tecla; apagar "120,00" passava por zero, o banco (`check (valor > 0)` em fixas e contas) recusava, e a tela
 * voltava ao valor salvo. A ficha da conta, de onde ele partia, nem tinha campo de valor: o botão mandava mudar pelo WhatsApp, que não fazia.
 * Os resultados esperados são escritos à mão (não vêm do código testado).
 *   npx tsx test/fixa-editar-valor.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { caso, fim } from './_falsos.ts'

const { mudarFixa, mudarValorConta } = await import('../../src/lib/fixas.ts')

type Cont = { id: string; tipo: 'pagar'; descricao: string; valor: number; vencimento: string; status: 'aberta' | 'paga'; fixaId?: string }
const conta = (id: string, valor: number, vencimento: string, status: 'aberta' | 'paga', fixaId?: string): Cont => ({ id, tipo: 'pagar', descricao: 'Internet', valor, vencimento, status, fixaId })
const estado = () =>
  ({
    fixas: [
      { id: 'fx-net', descricao: 'Internet', valor: 120, dia: 20 },
      { id: 'fx-luz', descricao: 'Luz', valor: 200, dia: 10 },
    ],
    contas: [
      conta('c-paga', 120, '2026-10-20', 'paga', 'fx-net'), // mês passado, já paga: não muda
      conta('c-venc', 120, '2026-11-20', 'aberta', 'fx-net'), // a do print: venceu há dias
      conta('c-dez', 120, '2026-12-22', 'aberta', 'fx-net'), // data que não bate com o dia da fixa (ex.: ajustada à mão)
      conta('c-jan', 120, '2027-01-20', 'aberta', 'fx-net'),
      { ...conta('c-luz', 200, '2026-12-10', 'aberta', 'fx-luz'), descricao: 'Luz' },
      conta('c-avulsa', 55, '2026-12-05', 'aberta'),
    ],
  }) as never

await caso('trocar 120 por 109 muda a fixa e as 3 contas em aberto, inclusive a vencida', async () => {
  const a = mudarFixa(estado(), 'fx-net', { valor: 109 }) as never as { fixas: { id: string; valor: number }[]; contas: Cont[] }
  assert.equal(a.fixas.find((f) => f.id === 'fx-net')!.valor, 109)
  for (const id of ['c-venc', 'c-dez', 'c-jan']) assert.equal(a.contas.find((c) => c.id === id)!.valor, 109, id)
})

await caso('a conta já paga, a de outra fixa e a avulsa não mudam', async () => {
  const a = mudarFixa(estado(), 'fx-net', { valor: 109 }) as never as { fixas: { id: string; valor: number }[]; contas: Cont[] }
  assert.equal(a.contas.find((c) => c.id === 'c-paga')!.valor, 120, 'o dinheiro da paga já saiu')
  assert.equal(a.contas.find((c) => c.id === 'c-luz')!.valor, 200)
  assert.equal(a.contas.find((c) => c.id === 'c-avulsa')!.valor, 55)
  assert.equal(a.fixas.find((f) => f.id === 'fx-luz')!.valor, 200)
})

await caso('trocar só o valor não mexe no vencimento nem no nome', async () => {
  const a = mudarFixa(estado(), 'fx-net', { valor: 109 }) as never as { contas: Cont[] }
  assert.deepEqual(a.contas.filter((c) => c.fixaId === 'fx-net' && c.status === 'aberta').map((c) => [c.vencimento, c.descricao]), [
    ['2026-11-20', 'Internet'],
    ['2026-12-22', 'Internet'],
    ['2027-01-20', 'Internet'],
  ])
})

await caso('trocar só o dia move o vencimento e deixa o valor', async () => {
  const a = mudarFixa(estado(), 'fx-net', { dia: 5 }) as never as { contas: Cont[] }
  assert.deepEqual(a.contas.filter((c) => c.fixaId === 'fx-net' && c.status === 'aberta').map((c) => [c.vencimento, c.valor]), [
    ['2026-11-05', 120],
    ['2026-12-05', 120],
    ['2027-01-05', 120],
  ])
  assert.equal(a.contas.find((c) => c.id === 'c-paga')!.vencimento, '2026-10-20', 'a paga fica no dia em que venceu')
})

await caso('valor zero, negativo, vazio ou inválido nunca passa: devolve o mesmo estado (nada vai ao banco)', async () => {
  const e = estado()
  for (const v of [0, -5, NaN, Infinity]) {
    assert.equal(mudarFixa(e, 'fx-net', { valor: v }), e, `fixa com ${v}`)
    assert.equal(mudarValorConta(e, 'c-avulsa', v), e, `conta com ${v}`)
  }
})

await caso('fixa que não existe e conta paga ou inexistente não mudam nada', async () => {
  const e = estado()
  assert.equal(mudarFixa(e, 'fx-nao-existe', { valor: 109 }), e)
  assert.equal(mudarValorConta(e, 'c-paga', 109), e)
  assert.equal(mudarValorConta(e, 'c-nao-existe', 109), e)
})

await caso('conta avulsa em aberto muda só ela, e arredonda em centavos', async () => {
  const a = mudarValorConta(estado(), 'c-avulsa', 61.239) as never as { contas: Cont[] }
  assert.equal(a.contas.find((c) => c.id === 'c-avulsa')!.valor, 61.24)
  assert.equal(a.contas.find((c) => c.id === 'c-venc')!.valor, 120)
})

await caso('o campo do painel só grava valor válido: sai do campo, Enter ou fecha a janela (trava de fonte)', async () => {
  const ui = readFileSync(new URL('../../src/components/ui.tsx', import.meta.url), 'utf8')
  const campo = ui.slice(ui.indexOf('export function CampoDinheiroSalvo'), ui.indexOf('const ICONE_ORIGEM'))
  assert.ok(campo.includes('rascunho > 0'), 'sem a trava de maior que zero, apagar o campo volta a ser gravado como zero')
  assert.ok(!/onChange=\{\(e\) => (vivo|onSalvar)/.test(campo), 'digitar não pode gravar direto')
  assert.ok(campo.includes('onBlur') && campo.includes("'Enter'"), 'grava ao sair do campo e no Enter')
  const aj = readFileSync(new URL('../../src/pages/Ajustes.tsx', import.meta.url), 'utf8')
  assert.ok(aj.includes('<CampoDinheiroSalvo valor={f.valor}'), 'Ajustes usa o campo que não grava a cada tecla')
  const ct = readFileSync(new URL('../../src/pages/Contas.tsx', import.meta.url), 'utf8')
  assert.ok(ct.includes('CampoDinheiroSalvo') && ct.includes('mudarFixa'), 'a ficha da conta tem o campo de valor')
  assert.ok(!ct.includes('Mudar valor ou data pelo WhatsApp'), 'o botão que prometia mudar valor pelo WhatsApp saiu enquanto o WhatsApp não faz')
})

fim()
