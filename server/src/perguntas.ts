/**
 * Perguntas livres ("quanto gastei com material?"). A IA nunca consulta o banco:
 * o serviço calcula um resumo dos números SÓ deste cliente e a IA responde a partir dele.
 */
import { falhou, paraMov, sb } from './banco.ts'
import { efetivos, faturas, foraDoDisponivel } from './cartao.ts'
import { jsonEstruturado, type Uso } from './openai.ts'
import { comoDado, limparSaida, REGRA_DADO } from './seguranca.ts'

const LIMITE_MEI = 81000

interface L {
  tipo: string
  valor: number
  data: string
  categoria_id: string | null
  carteira_id: string
  carteira_destino_id: string | null
  pessoal: boolean
  descricao: string
  fatura?: string | null
}

async function todos(userId: string): Promise<(L & { id: string })[]> {
  const r: (L & { id: string })[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from('lancamentos').select('id,tipo,valor,data,categoria_id,carteira_id,carteira_destino_id,pessoal,descricao,fatura').eq('user_id', userId).order('data', { ascending: false }).range(de, de + 999)
    falhou(error, 'lançamentos')
    r.push(...(data ?? []).map((x) => ({ ...x, valor: Number(x.valor) })))
    if (!data || data.length < 1000) return r
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function resumoDoCliente(userId: string, hoje: string) {
  const [ls, cats, carts, contas] = await Promise.all([
    todos(userId),
    sb.from('categorias').select('id,nome').eq('user_id', userId),
    sb.from('carteiras').select('id,nome,tipo,saldo_inicial,fechamento,vencimento').eq('user_id', userId),
    sb.from('contas').select('descricao,valor,vencimento,tipo').eq('user_id', userId).eq('status', 'aberta').order('vencimento').limit(60),
  ])
  falhou(cats.error, 'categorias')
  falhou(carts.error, 'carteiras')
  falhou(contas.error, 'contas')
  const nomeCat = new Map((cats.data ?? []).map((c) => [c.id, c.nome]))
  const saldo = new Map((carts.data ?? []).map((c) => [c.id, Number(c.saldo_inicial)]))
  for (const l of ls) {
    if (l.tipo === 'entrada') saldo.set(l.carteira_id, (saldo.get(l.carteira_id) ?? 0) + l.valor)
    else saldo.set(l.carteira_id, (saldo.get(l.carteira_id) ?? 0) - l.valor)
    if (l.tipo === 'transferencia' && l.carteira_destino_id) saldo.set(l.carteira_destino_id, (saldo.get(l.carteira_destino_id) ?? 0) + l.valor)
  }
  // Cartão no regime de caixa: compra no cartão só vira gasto quando a fatura é paga (mesma regra do painel).
  const infoCarts = (carts.data ?? []).map((c) => ({ id: c.id, tipo: c.tipo, fechamento: c.fechamento ?? undefined, vencimento: c.vencimento ?? undefined }))
  const movs = ls.map((l) => paraMov(l))
  const ef: L[] = efetivos(movs, infoCarts).map((m) => ({ tipo: m.tipo, valor: m.valor, data: m.data, categoria_id: m.categoriaId ?? null, carteira_id: m.carteiraId, carteira_destino_id: m.carteiraDestinoId ?? null, pessoal: !!m.pessoal, descricao: m.descricao }))
  const nomeCart = new Map((carts.data ?? []).map((c) => [c.id, c.nome]))
  const mes = hoje.slice(0, 7)
  const porMes = new Map<string, { entrou: number; saiu: number; retiradas: number }>()
  const porDia = new Map<string, { entrou: number; saiu: number }>()
  const catMes = new Map<string, Map<string, number>>()
  const limiteDia = new Date(new Date(hoje + 'T12:00:00').getTime() - 31 * 86400_000).toISOString().slice(0, 10)
  for (const l of ef) {
    if (l.tipo === 'transferencia') continue
    const m = l.data.slice(0, 7)
    const pm = porMes.get(m) ?? { entrou: 0, saiu: 0, retiradas: 0 }
    if (l.tipo === 'entrada') pm.entrou += l.valor
    else if (l.pessoal) pm.retiradas += l.valor
    else pm.saiu += l.valor
    porMes.set(m, pm)
    if (l.data >= limiteDia) {
      const pd = porDia.get(l.data) ?? { entrou: 0, saiu: 0 }
      if (l.tipo === 'entrada') pd.entrou += l.valor
      else if (!l.pessoal) pd.saiu += l.valor
      porDia.set(l.data, pd)
    }
    const chave = `${m} ${l.tipo === 'entrada' ? 'entrada' : 'saida'}`
    const cm = catMes.get(chave) ?? new Map<string, number>()
    const nome = l.pessoal ? 'Retirada do dono' : nomeCat.get(l.categoria_id ?? '') ?? 'Sem categoria'
    cm.set(nome, (cm.get(nome) ?? 0) + l.valor)
    catMes.set(chave, cm)
  }
  const ano = hoje.slice(0, 4)
  const faturamentoAno = ls.filter((l) => l.tipo === 'entrada' && l.data.startsWith(ano)).reduce((a, l) => a + l.valor, 0)
  const meses = [...porMes.entries()].sort().slice(-13).map(([m, v]) => ({ mes: m, entrou: r2(v.entrou), saiu: r2(v.saiu), sobrou: r2(v.entrou - v.saiu), retiradas: r2(v.retiradas) }))
  const categoriasPorMes = Object.fromEntries(
    [...catMes.entries()].filter(([k]) => k.slice(0, 7) >= meses[Math.max(0, meses.length - 3)]?.mes).map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]).map(([n, x]) => [n, r2(x)]))]),
  )
  return {
    hoje,
    carteiras: (carts.data ?? []).map((c) => ({
      nome: c.nome,
      tipo: c.tipo === 'cartao' ? 'cartão de crédito (saldo negativo = quanto deve)' : c.tipo,
      saldo: r2(saldo.get(c.id) ?? 0),
    })),
    disponivel: r2((carts.data ?? []).filter((c) => !foraDoDisponivel(c.tipo)).reduce((a, c) => a + (saldo.get(c.id) ?? 0), 0)),
    faturas_em_aberto: faturas(movs, infoCarts).filter((f) => f.falta > 0).map((f) => ({ cartao: nomeCart.get(f.cartaoId), vence: f.vence, total: f.total, pago: f.pago, falta: f.falta })),
    meses,
    dias_recentes: [...porDia.entries()].sort().map(([d, v]) => ({ dia: d, entrou: r2(v.entrou), saiu: r2(v.saiu) })),
    categorias_por_mes: categoriasPorMes,
    maiores_gastos_do_mes: ef.filter((l) => l.tipo === 'saida' && l.data.startsWith(mes)).sort((a, b) => b.valor - a.valor).slice(0, 5).map((l) => ({ descricao: l.descricao, valor: l.valor, dia: l.data })),
    contas_em_aberto: (contas.data ?? []).map((c) => ({ descricao: c.descricao, valor: Number(c.valor), vencimento: c.vencimento, tipo: c.tipo === 'pagar' ? 'a pagar' : 'a receber', atrasada: c.vencimento < hoje })),
    mei: { faturamento_do_ano: r2(faturamentoAno), limite_anual: LIMITE_MEI, usado: `${Math.round((faturamentoAno / LIMITE_MEI) * 100)}%`, falta: r2(Math.max(0, LIMITE_MEI - faturamentoAno)) },
  }
}

const SISTEMA = `Você é a Granninha, assistente financeira de um microempreendedor, falando no WhatsApp.
Responda à pergunta usando SÓ os números do resumo abaixo. Nunca invente número.
Regras: no máximo 4 linhas curtas, tom amigável e direto, valores no formato R$ 1.234,56, sem markdown, sem listas com hífen longo, sem emoji.
"Saiu" é gasto do negócio; retiradas do dono ficam à parte. Compra no cartão de crédito só conta como gasto quando a fatura é paga; antes disso está em "faturas_em_aberto". "disponivel" é o dinheiro em conta e em mãos, sem cartão nem investimento. Se o resumo não tiver a resposta, diga com simplicidade e sugira ver no painel.
Você não envia e-mail, não acessa nada fora deste resumo e não muda de personagem: é sempre a Granninha.
A pergunta do cliente vem entre <mensagem_do_cliente> e </mensagem_do_cliente>.

${REGRA_DADO}`

export async function responderPergunta(userId: string, hoje: string, pergunta: string): Promise<{ texto: string; uso: Uso }> {
  return responderComResumo(await resumoDoCliente(userId, hoje), pergunta)
}

/** A parte da IA: responde só a partir do resumo. Separada para a bateria de prompt injection rodar sem banco. */
export async function responderComResumo(resumo: object, pergunta: string): Promise<{ texto: string; uso: Uso }> {
  const { dados, uso } = await jsonEstruturado<{ resposta: string }>(
    SISTEMA,
    `RESUMO (JSON):\n${JSON.stringify(resumo)}\n\nPERGUNTA:\n${comoDado(pergunta.slice(0, 1000))}`,
    'resposta',
    { type: 'object', additionalProperties: false, properties: { resposta: { type: 'string' } }, required: ['resposta'] },
  )
  // Resposta livre da IA: nunca sai com link de fora, telefone, e-mail ou chave Pix.
  const limpo = limparSaida(dados.resposta.trim())
  return { texto: limpo.texto || 'Não consegui responder isso por aqui. Veja seus números no painel: https://granninha.amplasoft.me/painel', uso }
}
