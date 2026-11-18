/**
 * Carrega do banco tudo que as consultas de dinheiro precisam, SÓ deste cliente: carteiras, todos os lançamentos
 * (de mil em mil, para nunca cortar o saldo por limite de página), categorias, contas fixas e contas em aberto.
 */
import { falhou, paraMov, sb } from './banco.ts'
import type { Base } from './consultas.ts'

export async function carregarBase(userId: string): Promise<Base> {
  const lancs: Base['lancs'] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb
      .from('lancamentos')
      .select('id,tipo,valor,data,categoria_id,carteira_id,carteira_destino_id,pessoal,descricao,fatura')
      .eq('user_id', userId)
      .order('data', { ascending: false })
      .order('id', { ascending: true })
      .range(de, de + 999)
    falhou(error, 'lançamentos')
    lancs.push(...(data ?? []).map((x) => paraMov(x)))
    if (!data || data.length < 1000) break
  }
  const [carts, cats, fixas, contas] = await Promise.all([
    sb.from('carteiras').select('id,nome,tipo,saldo_inicial,fechamento,vencimento').eq('user_id', userId),
    sb.from('categorias').select('id,nome').eq('user_id', userId),
    sb.from('fixas').select('descricao,valor,dia').eq('user_id', userId),
    sb.from('contas').select('descricao,valor,vencimento,tipo').eq('user_id', userId).eq('status', 'aberta').order('vencimento').limit(500),
  ])
  falhou(carts.error, 'carteiras')
  falhou(cats.error, 'categorias')
  falhou(fixas.error, 'fixas')
  falhou(contas.error, 'contas')
  return {
    carteiras: (carts.data ?? []).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, saldoInicial: Number(c.saldo_inicial), fechamento: c.fechamento ?? undefined, vencimento: c.vencimento ?? undefined })),
    lancs,
    categorias: cats.data ?? [],
    fixas: (fixas.data ?? []).map((f) => ({ descricao: f.descricao, valor: Number(f.valor), dia: Number(f.dia) })),
    contas: (contas.data ?? []).map((c) => ({ descricao: c.descricao, valor: Number(c.valor), vencimento: c.vencimento, tipo: c.tipo === 'receber' ? 'receber' : 'pagar' })),
  }
}
