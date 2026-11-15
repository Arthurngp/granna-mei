/**
 * Grava no banco as ações que o leitor conferiu, sempre com o user_id do dono do número,
 * e guarda o que foi criado para o DESFAZER saber exatamente o que reverter.
 */
import { randomUUID } from 'node:crypto'
import { falhou, sb } from './banco.ts'
import type { Acao, Contexto } from './interpretar.ts'

export interface Efeitos {
  lancamentos?: string[]
  contas?: string[]
  fixas?: string[]
  contasPagas?: string[]
}
export type Origem = 'texto' | 'audio' | 'foto' | 'pdf'

const id = (p: string) => `${p}-w${randomUUID().replace(/-/g, '').slice(0, 14)}`
const agora = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const somaMes = (data: string, n: number, dia?: number) => {
  const [y, m, d] = data.split('-').map(Number)
  const alvo = new Date(y, m - 1 + n, 1)
  const ult = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(Math.min(dia ?? d, ult)).padStart(2, '0')}`
}
const centavos = (n: number) => Math.round(n * 100) / 100

export interface Resultado {
  efeitos: Efeitos
  linhas: string[]
}

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const diaBR = (d: string) => d.split('-').reverse().slice(0, 2).join('/')

export async function executar(userId: string, ctx: Contexto, acoes: Acao[], origem: Origem, anexo: string | null): Promise<Resultado> {
  const ef: Efeitos = { lancamentos: [], contas: [], fixas: [], contasPagas: [] }
  const linhas: string[] = []
  const nomeCat = (cid: string | null) => ctx.categorias.find((c) => c.id === cid)?.nome
  const nomeCart = (cid: string | null) => ctx.carteiras.find((c) => c.id === cid)?.nome ?? 'carteira'
  const quando = (d: string) => (d === ctx.hoje ? 'hoje' : diaBR(d))
  // Desfaz o que já gravou se uma ação no meio falhar: ou entra tudo, ou nada.
  try {
    for (const a of acoes) {
      if (a.tipo_acao === 'lancamento' || a.tipo_acao === 'transferencia') {
        const lid = id('l')
        const transf = a.tipo_acao === 'transferencia'
        const { error } = await sb.from('lancamentos').insert({
          user_id: userId, id: lid, tipo: transf ? 'transferencia' : a.movimento, valor: centavos(a.valor!), descricao: a.descricao,
          categoria_id: a.categoria_id, carteira_id: a.carteira_id, carteira_destino_id: transf ? a.carteira_destino_id : null,
          data: a.data, hora: agora(), origem, pessoal: a.pessoal, anexo_path: anexo,
        })
        falhou(error, 'lançamento')
        ef.lancamentos!.push(lid)
        linhas.push(
          transf
            ? `Anotado: transferência de ${brl(a.valor!)}\n${nomeCart(a.carteira_id)} para ${nomeCart(a.carteira_destino_id)} · ${quando(a.data)}`
            : `Anotado: ${a.movimento === 'entrada' ? 'entrada' : a.pessoal ? 'retirada' : 'saída'} de ${brl(a.valor!)}\n${[a.descricao, nomeCat(a.categoria_id), nomeCart(a.carteira_id), quando(a.data)].filter(Boolean).join(' · ')}`,
        )
      } else if (a.tipo_acao === 'conta') {
        const cid = id('c')
        const { error } = await sb.from('contas').insert({
          user_id: userId, id: cid, tipo: a.movimento === 'entrada' ? 'receber' : 'pagar', descricao: a.descricao, valor: centavos(a.valor!),
          vencimento: a.vencimento, status: 'aberta', categoria_id: a.categoria_id,
        })
        falhou(error, 'conta')
        ef.contas!.push(cid)
        linhas.push(`Anotado: ${a.movimento === 'entrada' ? 'a receber' : 'a pagar'} ${brl(a.valor!)}\n${a.descricao} · vence ${diaBR(a.vencimento!)}`)
      } else if (a.tipo_acao === 'recorrente') {
        const fid = id('fx')
        const dia = a.dia_do_mes!
        const { error } = await sb.from('fixas').insert({ user_id: userId, id: fid, descricao: a.descricao, valor: centavos(a.valor!), dia, categoria_id: a.categoria_id })
        falhou(error, 'conta fixa')
        ef.fixas!.push(fid)
        // Próximos 3 vencimentos ainda não passados, como faz o painel.
        const contas = []
        for (let k = 0; k < 4 && contas.length < 3; k++) {
          const venc = somaMes(ctx.hoje, k, dia)
          if (venc < ctx.hoje) continue
          contas.push({ user_id: userId, id: id('c'), tipo: a.movimento === 'entrada' ? 'receber' : 'pagar', descricao: a.descricao, valor: centavos(a.valor!), vencimento: venc, status: 'aberta', categoria_id: a.categoria_id, fixa_id: fid })
        }
        const r = await sb.from('contas').insert(contas)
        falhou(r.error, 'contas da fixa')
        ef.contas!.push(...contas.map((c) => c.id))
        linhas.push(`Anotado: ${a.descricao} de ${brl(a.valor!)} todo dia ${dia}\nEu te lembro antes de vencer.`)
      } else if (a.tipo_acao === 'parcelado') {
        const n = a.parcelas!
        const total = centavos(a.valor!)
        const parcela = Math.floor((total / n) * 100) / 100
        const contas = Array.from({ length: n }, (_, i) => ({
          user_id: userId, id: id('c'), tipo: a.movimento === 'entrada' ? 'receber' : 'pagar', descricao: a.descricao,
          // A última parcela leva os centavos que sobram da divisão.
          valor: i === n - 1 ? centavos(total - parcela * (n - 1)) : parcela,
          vencimento: somaMes(ctx.hoje, i + 1), status: 'aberta', categoria_id: a.categoria_id, parcela_n: i + 1, parcela_total: n,
        }))
        const r = await sb.from('contas').insert(contas)
        falhou(r.error, 'parcelas')
        ef.contas!.push(...contas.map((c) => c.id))
        linhas.push(`Anotado: ${a.descricao} de ${brl(total)} em ${n}x de ${brl(parcela)}\nPrimeira parcela em ${diaBR(contas[0].vencimento)}.`)
      } else if (a.tipo_acao === 'baixar_conta') {
        const conta = ctx.contasAbertas.find((c) => c.id === a.conta_id)!
        const lid = id('l')
        const r1 = await sb.from('lancamentos').insert({
          user_id: userId, id: lid, tipo: conta.tipo === 'receber' ? 'entrada' : 'saida', valor: conta.valor, descricao: conta.descricao,
          categoria_id: a.categoria_id, carteira_id: a.carteira_id, data: a.data, hora: agora(), origem, anexo_path: anexo,
        })
        falhou(r1.error, 'baixa: lançamento')
        ef.lancamentos!.push(lid)
        // Só marca como paga se ainda estava aberta e é deste cliente.
        const r2 = await sb.from('contas').update({ status: 'paga', pago_em: a.data, lancamento_id: lid }).eq('user_id', userId).eq('id', conta.id).eq('status', 'aberta').select('id')
        falhou(r2.error, 'baixa: conta')
        if (r2.data?.length) ef.contasPagas!.push(conta.id)
        linhas.push(`Anotado: ${conta.tipo === 'receber' ? 'recebido' : 'pago'} ${brl(conta.valor)}\n${conta.descricao} · ${nomeCart(a.carteira_id)} · ${quando(a.data)}`)
      }
    }
  } catch (e) {
    await reverter(userId, ef)
    throw e
  }
  return { efeitos: ef, linhas }
}

/** Reverte exatamente o que uma mensagem criou. */
export async function reverter(userId: string, ef: Efeitos) {
  if (ef.contasPagas?.length) falhou((await sb.from('contas').update({ status: 'aberta', pago_em: null, lancamento_id: null }).eq('user_id', userId).in('id', ef.contasPagas)).error, 'reabrir contas')
  if (ef.lancamentos?.length) falhou((await sb.from('lancamentos').delete().eq('user_id', userId).in('id', ef.lancamentos)).error, 'apagar lançamentos')
  if (ef.contas?.length) falhou((await sb.from('contas').delete().eq('user_id', userId).in('id', ef.contas)).error, 'apagar contas')
  if (ef.fixas?.length) falhou((await sb.from('fixas').delete().eq('user_id', userId).in('id', ef.fixas)).error, 'apagar fixas')
}

/** Última mensagem do cliente que gravou algo e ainda não foi desfeita (até 3 dias atrás). */
export async function ultimaComEfeito(userId: string) {
  const desde = new Date(Date.now() - 3 * 86400_000).toISOString()
  const { data, error } = await sb.from('mensagens').select('id,texto,efeitos').eq('user_id', userId).eq('status', 'ok').eq('desfeita', false).gte('criado_em', desde).order('criado_em', { ascending: false }).limit(1).maybeSingle()
  falhou(error, 'ultimaComEfeito')
  return data as { id: string; texto: string; efeitos: Efeitos } | null
}
