/**
 * Grava no banco as ações que o leitor conferiu, sempre com o user_id do dono do número,
 * e guarda o que foi criado para o DESFAZER saber exatamente o que reverter.
 */
import { randomUUID } from 'node:crypto'
import { falhou, sb } from './banco.ts'
import type { Acao, Contexto } from './interpretar.ts'
import { confirma } from './voz.ts'
import { somaMeses, vencimentoNoMes } from './datas.ts'

export interface Efeitos {
  lancamentos?: string[]
  contas?: string[]
  fixas?: string[]
  contasPagas?: string[]
  /** Categorias criadas pela mensagem */
  categorias?: string[]
  /** Lançamentos que trocaram de categoria (para o DESFAZER voltar) */
  recategorizados?: { id: string; de: string | null }[]
  /** Contas fixas que mudaram de valor: o valor de ANTES da fixa e de cada conta em aberto dela (para o DESFAZER voltar) */
  valores?: { fixa: string; valor: number; dia?: number; contas: { id: string; valor: number; vencimento?: string }[] }[]
  /** Contas em aberto que mudaram de valor ou de data, uma a uma (para o DESFAZER voltar) */
  contasAjustadas?: { id: string; valor: number; vencimento: string }[]
  /** Contas fixas encerradas: a linha da fixa e as contas em aberto que saíram com ela, inteiras (para o DESFAZER recolocar) */
  removidos?: { fixa: Record<string, unknown>; contas: Record<string, unknown>[] }[]
}
export type Origem = 'texto' | 'audio' | 'foto' | 'pdf'

const id = (p: string) => `${p}-w${randomUUID().replace(/-/g, '').slice(0, 14)}`
const agora = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const somaMes = (data: string, n: number, dia?: number) => vencimentoNoMes(somaMeses(data.slice(0, 7), n), dia ?? Number(data.slice(8, 10)))
const centavos = (n: number) => Math.round(n * 100) / 100

export interface Resultado {
  efeitos: Efeitos
  linhas: string[]
}

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const diaBR = (d: string) => d.split('-').reverse().slice(0, 2).join('/')
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesBR = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`
const somaYM = (ym: string, n: number) => somaMes(`${ym}-01`, n).slice(0, 7)
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'categoria'
const OUTROS = new Set(['outras-saidas', 'outras-entradas'])

export async function executar(userId: string, ctx: Contexto, acoes: Acao[], origem: Origem, anexo: string | null, anteriores?: Efeitos): Promise<Resultado> {
  const ef: Efeitos = { lancamentos: [], contas: [], fixas: [], contasPagas: [], categorias: [], recategorizados: [], valores: [], contasAjustadas: [], removidos: [] }
  const linhas: string[] = []
  const nomeCat = (cid: string | null) => ctx.categorias.find((c) => c.id === cid)?.nome
  const nomeCart = (cid: string | null) => ctx.carteiras.find((c) => c.id === cid)?.nome ?? 'carteira'
  const quando = (d: string) => (d === ctx.hoje ? 'hoje' : diaBR(d))
  const vencCartao = (cid: string) => ctx.carteiras.find((c) => c.id === cid)?.vencimento ?? 10
  let foiParaOutros = false
  /** Descrição do lançamento que caiu em Outros: a dica de categoria usa o nome do que ela acabou de anotar. */
  let descOutros = ''
  // Desfaz o que já gravou se uma ação no meio falhar: ou entra tudo, ou nada.
  try {
    for (const a of acoes) {
      if (a.categoria_id && OUTROS.has(a.categoria_id)) {
        foiParaOutros = true
        if (a.tipo_acao === 'lancamento' && !descOutros) descOutros = a.descricao
      }
      if (a.tipo_acao === 'criar_categoria') {
        const nome = a.descricao
        const tipo = a.movimento === 'entrada' ? 'entrada' : 'saida'
        const existe = ctx.categorias.find((c) => c.nome.toLowerCase() === nome.toLowerCase() && c.tipo === tipo)
        if (existe) {
          linhas.push(`A categoria "${existe.nome}" já existe.`)
          continue
        }
        let cid = slug(nome)
        if (ctx.categorias.some((c) => c.id === cid)) cid = `${cid}-${randomUUID().slice(0, 4)}`
        const { error } = await sb.from('categorias').insert({ user_id: userId, id: cid, nome, tipo, cor: '#747EAD' })
        falhou(error, 'categoria')
        ef.categorias!.push(cid)
        // O que acabou de cair em "Outros" (na mensagem anterior) passa para a categoria nova.
        let movidos = 0
        if (anteriores?.lancamentos?.length) {
          const { data } = await sb.from('lancamentos').select('id,categoria_id').eq('user_id', userId).in('id', anteriores.lancamentos).in('categoria_id', [...OUTROS])
          for (const l of data ?? []) {
            const r = await sb.from('lancamentos').update({ categoria_id: cid }).eq('user_id', userId).eq('id', l.id)
            falhou(r.error, 'recategorizar')
            ef.recategorizados!.push({ id: l.id, de: l.categoria_id })
            movidos++
          }
        }
        linhas.push(`Criei a categoria "${nome}" (${tipo === 'saida' ? 'gasto' : 'recebimento'}).${movidos ? ` O último lançamento que estava em Outros já foi para ela.` : ''}`)
        continue
      }
      if (a.tipo_acao === 'ajustar_fixa') {
        // Mesma regra do painel: a conta fixa é a fonte, então as contas em aberto dela (inclusive a vencida) levam o valor e o dia novos; as pagas não mudam.
        const novo = a.valor !== null && a.valor > 0 ? centavos(a.valor) : null
        const diaNovo = a.dia_do_mes ?? null
        const fx = await sb.from('fixas').select('id,valor,dia').eq('user_id', userId).eq('id', a.fixa_id!).maybeSingle()
        falhou(fx.error, 'ajustar fixa: ler')
        if (!fx.data) throw new Error('ajustar fixa: a conta fixa não existe mais')
        const ab = await sb.from('contas').select('id,valor,vencimento').eq('user_id', userId).eq('fixa_id', a.fixa_id!).eq('status', 'aberta')
        falhou(ab.error, 'ajustar fixa: ler contas')
        const abertas = (ab.data ?? []) as { id: string; valor: number; vencimento: string }[]
        // Guarda o que havia ANTES de gravar: é isso que o DESFAZER, a correção e a falha no meio devolvem.
        ef.valores!.push({ fixa: a.fixa_id!, valor: Number(fx.data.valor), dia: Number(fx.data.dia), contas: abertas.map((c) => ({ id: c.id, valor: Number(c.valor), vencimento: c.vencimento })) })
        const r1 = await sb.from('fixas').update({ ...(novo !== null ? { valor: novo } : {}), ...(diaNovo !== null ? { dia: diaNovo } : {}) }).eq('user_id', userId).eq('id', a.fixa_id!)
        falhou(r1.error, 'ajustar fixa')
        if (novo !== null && abertas.length) {
          const r2 = await sb.from('contas').update({ valor: novo }).eq('user_id', userId).eq('fixa_id', a.fixa_id!).eq('status', 'aberta')
          falhou(r2.error, 'ajustar contas da fixa')
        }
        if (diaNovo !== null) {
          for (const c of abertas) {
            const r3 = await sb.from('contas').update({ vencimento: vencimentoNoMes(c.vencimento.slice(0, 7), diaNovo) }).eq('user_id', userId).eq('id', c.id).eq('status', 'aberta')
            falhou(r3.error, 'ajustar dia das contas da fixa')
          }
        }
        const o = abertas.length
        const quando = [novo !== null ? `é ${brl(novo)} todo mês` : '', diaNovo !== null ? `vence todo dia ${diaNovo}` : ''].filter(Boolean).join(' e ')
        linhas.push(`${a.descricao} agora ${quando}.\n${o ? `Ajustei ${o === 1 ? 'a conta em aberto' : `as ${o} contas em aberto`}. As que você já pagou ficam como estão.` : 'Não tinha conta em aberto para ajustar. As próximas já saem com o valor e o dia novos.'}`)
        continue
      }
      if (a.tipo_acao === 'ajustar_conta') {
        // Só ESTA conta (valor e/ou data). A conta fixa de onde ela veio, se veio, não muda.
        const cc = await sb.from('contas').select('id,valor,vencimento').eq('user_id', userId).eq('id', a.conta_id!).eq('status', 'aberta').maybeSingle()
        falhou(cc.error, 'ajustar conta: ler')
        if (!cc.data) throw new Error('ajustar conta: a conta não está mais em aberto')
        ef.contasAjustadas!.push({ id: a.conta_id!, valor: Number(cc.data.valor), vencimento: cc.data.vencimento as string })
        const r = await sb.from('contas').update({ ...(a.valor !== null ? { valor: centavos(a.valor) } : {}), ...(a.vencimento ? { vencimento: a.vencimento } : {}) }).eq('user_id', userId).eq('id', a.conta_id!).eq('status', 'aberta')
        falhou(r.error, 'ajustar conta')
        const partes = [a.valor !== null ? `agora é ${brl(a.valor)}` : '', a.vencimento ? `vence ${diaBR(a.vencimento)}` : ''].filter(Boolean).join(' e ')
        linhas.push(`${a.descricao} ${partes}.\nMudei só essa conta. Para mudar todo mês, é só dizer, por exemplo, "a ${a.descricao.toLowerCase()} agora é tanto todo mês".`)
        continue
      }
      if (a.tipo_acao === 'encerrar_fixa') {
        // Tira a conta fixa e as contas em aberto dela (as pagas ficam no histórico). Tudo guardado inteiro: o DESFAZER recoloca.
        const fx = await sb.from('fixas').select('*').eq('user_id', userId).eq('id', a.fixa_id!).maybeSingle()
        falhou(fx.error, 'encerrar fixa: ler')
        if (!fx.data) throw new Error('encerrar fixa: a conta fixa não existe mais')
        const ab = await sb.from('contas').select('*').eq('user_id', userId).eq('fixa_id', a.fixa_id!).eq('status', 'aberta')
        falhou(ab.error, 'encerrar fixa: ler contas')
        ef.removidos!.push({ fixa: fx.data as Record<string, unknown>, contas: (ab.data ?? []) as Record<string, unknown>[] })
        const r1 = await sb.from('contas').delete().eq('user_id', userId).eq('fixa_id', a.fixa_id!).eq('status', 'aberta')
        falhou(r1.error, 'encerrar fixa: apagar contas')
        const r2 = await sb.from('fixas').delete().eq('user_id', userId).eq('id', a.fixa_id!)
        falhou(r2.error, 'encerrar fixa')
        const o = ab.data?.length ?? 0
        linhas.push(`Tirei ${a.descricao} das contas fixas${o ? ` e as ${o === 1 ? 'conta' : `${o} contas`} em aberto dela` : ''}. O que você já pagou fica no histórico.\nFoi sem querer? Responda DESFAZER.`)
        continue
      }
      if (a.tipo_acao === 'pagar_fatura') {
        const lid = id('l')
        const { error } = await sb.from('lancamentos').insert({
          user_id: userId, id: lid, tipo: 'transferencia', valor: centavos(a.valor!), descricao: a.descricao, categoria_id: null,
          carteira_id: a.carteira_id, carteira_destino_id: a.carteira_destino_id, data: a.data, hora: agora(), origem, anexo_path: anexo, fatura: a.fatura,
        })
        falhou(error, 'pagamento de fatura')
        ef.lancamentos!.push(lid)
        linhas.push(`${confirma.pagouFatura(brl(a.valor!))}\n${nomeCart(a.carteira_destino_id)}${a.fatura ? ` · fatura de ${mesBR(a.fatura)}` : ''} · saiu de ${nomeCart(a.carteira_id)} · ${quando(a.data)}\nAs compras dessa fatura entram nos gastos de hoje.`)
        continue
      }
      if (a.tipo_acao === 'lancamento' && a.noCartao) {
        const lid = id('l')
        const { error } = await sb.from('lancamentos').insert({
          user_id: userId, id: lid, tipo: 'compra_cartao', valor: centavos(a.valor!), descricao: a.descricao, categoria_id: a.categoria_id,
          carteira_id: a.carteira_id, data: a.data, hora: agora(), origem, pessoal: a.pessoal, anexo_path: anexo, fatura: a.fatura,
        })
        falhou(error, 'compra no cartão')
        ef.lancamentos!.push(lid)
        linhas.push(`${confirma.compraCartao(brl(a.valor!))}\n${[a.descricao, nomeCat(a.categoria_id), nomeCart(a.carteira_id), quando(a.data)].filter(Boolean).join(' · ')}\nEntra na fatura de ${mesBR(a.fatura!)} (vence ${diaBR(`${a.fatura}-${String(vencCartao(a.carteira_id)).padStart(2, '0')}`)}).`)
        continue
      }
      if (a.tipo_acao === 'parcelado' && a.noCartao) {
        const n = a.parcelas!
        const total = centavos(a.valor!)
        const parcela = Math.floor((total / n) * 100) / 100
        const linhasP = Array.from({ length: n }, (_, i) => ({
          user_id: userId, id: id('l'), tipo: 'compra_cartao', descricao: `${a.descricao} (${i + 1}/${n})`,
          valor: i === n - 1 ? centavos(total - parcela * (n - 1)) : parcela, categoria_id: a.categoria_id, carteira_id: a.carteira_id,
          data: a.data, hora: agora(), origem, pessoal: a.pessoal, anexo_path: i === 0 ? anexo : null,
          fatura: somaYM(a.fatura!, i), parcela_n: i + 1, parcela_total: n,
        }))
        const r = await sb.from('lancamentos').insert(linhasP)
        falhou(r.error, 'parcelas no cartão')
        ef.lancamentos!.push(...linhasP.map((l) => l.id))
        linhas.push(`Anotei: ${a.descricao} de ${brl(total)} em ${n}x de ${brl(parcela)} no ${nomeCart(a.carteira_id)}\nDa fatura de ${mesBR(a.fatura!)} até a de ${mesBR(somaYM(a.fatura!, n - 1))}.`)
        continue
      }
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
            ? `${confirma.transferencia(brl(a.valor!))}\n${nomeCart(a.carteira_id)} para ${nomeCart(a.carteira_destino_id)} · ${quando(a.data)}`
            : `${confirma.lancamento(a.movimento === 'entrada' ? 'entrada' : a.pessoal ? 'retirada' : 'saida', brl(a.valor!))}\n${[a.descricao, nomeCat(a.categoria_id), nomeCart(a.carteira_id), quando(a.data)].filter(Boolean).join(' · ')}${a.carteiraDoHabito ? `\n${confirma.contaDoHabito(nomeCart(a.carteira_id))}` : ''}`,
        )
      } else if (a.tipo_acao === 'conta') {
        const cid = id('c')
        const { error } = await sb.from('contas').insert({
          user_id: userId, id: cid, tipo: a.movimento === 'entrada' ? 'receber' : 'pagar', descricao: a.descricao, valor: centavos(a.valor!),
          vencimento: a.vencimento, status: 'aberta', categoria_id: a.categoria_id,
        })
        falhou(error, 'conta')
        ef.contas!.push(cid)
        linhas.push(`${confirma.conta(a.movimento === 'entrada' ? 'receber' : 'pagar', brl(a.valor!))}\n${a.descricao} · vence ${diaBR(a.vencimento!)}`)
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
        linhas.push(`Anotei a conta fixa: ${a.descricao} de ${brl(a.valor!)} todo dia ${dia}\nJá aparece em Contas, no painel.`)
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
        linhas.push(`Anotei: ${a.descricao} de ${brl(total)} em ${n}x de ${brl(parcela)}\nPrimeira parcela em ${diaBR(contas[0].vencimento)}.`)
      } else if (a.tipo_acao === 'baixar_conta') {
        const conta = ctx.contasAbertas.find((c) => c.id === a.conta_id)!
        const lid = id('l')
        const r1 = await sb.from('lancamentos').insert({
          user_id: userId, id: lid, tipo: conta.tipo === 'receber' ? 'entrada' : a.noCartao ? 'compra_cartao' : 'saida', valor: centavos(a.valor ?? conta.valor), descricao: conta.descricao,
          categoria_id: a.categoria_id, carteira_id: a.carteira_id, data: a.data, hora: agora(), origem, anexo_path: anexo, fatura: a.noCartao ? a.fatura : null,
        })
        falhou(r1.error, 'baixa: lançamento')
        ef.lancamentos!.push(lid)
        // Só marca como paga se ainda estava aberta e é deste cliente.
        const r2 = await sb.from('contas').update({ status: 'paga', pago_em: a.data, lancamento_id: lid }).eq('user_id', userId).eq('id', conta.id).eq('status', 'aberta').select('id')
        falhou(r2.error, 'baixa: conta')
        if (r2.data?.length) ef.contasPagas!.push(conta.id)
        linhas.push(`${confirma.baixa(conta.tipo === 'receber' ? 'receber' : 'pagar', brl(a.valor ?? conta.valor))}\n${conta.descricao} · ${nomeCart(a.carteira_id)} · ${quando(a.data)}`)
      }
    }
  } catch (e) {
    await reverter(userId, ef)
    throw e
  }
  // A dica de categoria só aparece para quem está começando e só para o que foi lançado agora (nunca em conta, fixa ou parcela), com o nome do que ela anotou.
  if (foiParaOutros && descOutros && ctx.poucosRegistros) linhas.push(confirma.dicaCategoria(descOutros))
  return { efeitos: ef, linhas }
}

/** Reverte exatamente o que uma mensagem criou. */
export async function reverter(userId: string, ef: Efeitos) {
  // Valor de conta fixa: do último ajuste para o primeiro. Conta que já foi paga nesse meio tempo fica como está (o dinheiro já saiu).
  for (const v of [...(ef.valores ?? [])].reverse()) {
    falhou((await sb.from('fixas').update({ valor: v.valor, ...(v.dia !== undefined ? { dia: v.dia } : {}) }).eq('user_id', userId).eq('id', v.fixa)).error, 'voltar valor da fixa')
    for (const c of v.contas) falhou((await sb.from('contas').update({ valor: c.valor, ...(c.vencimento ? { vencimento: c.vencimento } : {}) }).eq('user_id', userId).eq('id', c.id).eq('status', 'aberta')).error, 'voltar valor da conta')
  }
  for (const c of [...(ef.contasAjustadas ?? [])].reverse()) falhou((await sb.from('contas').update({ valor: c.valor, vencimento: c.vencimento }).eq('user_id', userId).eq('id', c.id).eq('status', 'aberta')).error, 'voltar conta ajustada')
  // Conta fixa encerrada: a linha volta primeiro e depois as contas em aberto que saíram com ela.
  for (const r of [...(ef.removidos ?? [])].reverse()) {
    falhou((await sb.from('fixas').upsert(r.fixa, { onConflict: 'user_id,id' })).error, 'recolocar conta fixa')
    if (r.contas.length) falhou((await sb.from('contas').upsert(r.contas, { onConflict: 'user_id,id' })).error, 'recolocar contas da fixa')
  }
  for (const r of ef.recategorizados ?? []) falhou((await sb.from('lancamentos').update({ categoria_id: r.de }).eq('user_id', userId).eq('id', r.id)).error, 'voltar categoria')
  if (ef.categorias?.length) falhou((await sb.from('categorias').delete().eq('user_id', userId).in('id', ef.categorias)).error, 'apagar categorias')
  if (ef.contasPagas?.length) falhou((await sb.from('contas').update({ status: 'aberta', pago_em: null, lancamento_id: null }).eq('user_id', userId).in('id', ef.contasPagas)).error, 'reabrir contas')
  if (ef.lancamentos?.length) falhou((await sb.from('lancamentos').delete().eq('user_id', userId).in('id', ef.lancamentos)).error, 'apagar lançamentos')
  if (ef.contas?.length) falhou((await sb.from('contas').delete().eq('user_id', userId).in('id', ef.contas)).error, 'apagar contas')
  if (ef.fixas?.length) falhou((await sb.from('fixas').delete().eq('user_id', userId).in('id', ef.fixas)).error, 'apagar fixas')
}

/** Última mensagem do cliente que gravou algo e ainda não foi desfeita (até 3 dias atrás). */
/**
 * A mensagem gravou ou mudou alguma coisa? Pergunta, saudação e a própria resposta do DESFAZER saem
 * com as listas vazias, e nessas não há nada para reverter.
 */
export function temEfeito(e: Efeitos | null | undefined): boolean {
  if (!e) return false
  return Object.values(e).some((v) => Array.isArray(v) && v.length > 0)
}

export interface MensagemComEfeito {
  id: string
  texto: string
  tipo: string
  intencao: string | null
  efeitos: Efeitos
  criado_em: string
}

/**
 * A última mensagem que REALMENTE gravou algo, para o DESFAZER e a correção.
 *
 * O filtro tem que ser no código: `efeitos` vem com as listas montadas ({"lancamentos":[],...}),
 * então "diferente de {}" não distingue quem gravou de quem só respondeu. Antes disto, "paguei 89 de
 * luz" → "quanto sobrou?" → "desfazer" respondia «desfiz: "quanto sobrou?"» e os R$ 89 ficavam lá.
 */
export async function ultimaComEfeito(userId: string): Promise<MensagemComEfeito | null> {
  const desde = new Date(Date.now() - 3 * 86400_000).toISOString()
  const { data, error } = await sb.from('mensagens').select('id,texto,tipo,intencao,efeitos,criado_em').eq('user_id', userId).eq('status', 'ok').eq('desfeita', false).gte('criado_em', desde).order('criado_em', { ascending: false }).limit(30)
  falhou(error, 'ultimaComEfeito')
  return ((data ?? []) as MensagemComEfeito[]).find((m) => temEfeito(m.efeitos)) ?? null
}

/** A última mensagem do cliente, com efeito ou não: diz se ele acabou de mandar um DESFAZER. */
export async function ultimaMensagem(userId: string): Promise<MensagemComEfeito | null> {
  const desde = new Date(Date.now() - 86400_000).toISOString()
  const { data, error } = await sb.from('mensagens').select('id,texto,tipo,intencao,efeitos,criado_em').eq('user_id', userId).eq('status', 'ok').gte('criado_em', desde).order('criado_em', { ascending: false }).limit(1).maybeSingle()
  falhou(error, 'ultimaMensagem')
  return (data as MensagemComEfeito | null) ?? null
}
