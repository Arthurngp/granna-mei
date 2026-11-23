/**
 * Perguntas livres ("quanto gastei com material?"). A IA nunca consulta o banco e nunca faz conta:
 * o serviço calcula um resumo dos números SÓ deste cliente (com as mesmas funções do saldo e das consultas
 * diretas) e a IA responde a partir dele. Pedido de saldo, entrou/saiu, fixas e vencimentos já são respondidos
 * por código antes de chegar aqui (consultas.ts); isto cobre o resto: categoria, comparação, limite do MEI.
 */
import { carregarBase } from './base.ts'
import { efetivos, faturas } from './cartao.ts'
import { palavrasChave } from './interpretar.ts'
import { disponivelDaBase, periodoDe, resumoDoPeriodo, saldosDaBase, somaDias, type Base } from './consultas.ts'
import { jsonEstruturado, type Uso } from './openai.ts'
import { centavosDe } from './saldo.ts'
import { comoDado, limparSaida, REGRA_DADO } from './seguranca.ts'
import { VOZ } from './voz.ts'

const LIMITE_MEI = 81000
const r2 = centavosDe

export function resumoDaBase(b: Base, hoje: string) {
  const sal = saldosDaBase(b)
  const cartoes = b.carteiras.map((c) => ({ id: c.id, tipo: c.tipo, fechamento: c.fechamento, vencimento: c.vencimento }))
  const nomeCart = new Map(b.carteiras.map((c) => [c.id, c.nome]))
  const nomeCat = new Map(b.categorias.map((c) => [c.id, c.nome]))
  // Cartão no regime de caixa: compra no cartão só vira gasto quando a fatura é paga (mesma regra do painel).
  const ef = efetivos(b.lancs, cartoes)
  const mes = hoje.slice(0, 7)
  const porMes = new Map<string, { entrou: number; saiu: number; retiradas: number }>()
  const catMes = new Map<string, Map<string, number>>()
  const limiteDia = somaDias(hoje, -31)
  const porDia = new Map<string, { entrou: number; saiu: number }>()
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
    const nome = l.pessoal ? 'Retirada do dono' : nomeCat.get(l.categoriaId ?? '') ?? 'Sem categoria'
    cm.set(nome, (cm.get(nome) ?? 0) + l.valor)
    catMes.set(chave, cm)
  }
  const ano = hoje.slice(0, 4)
  const faturamentoAno = b.lancs.filter((l) => l.tipo === 'entrada' && l.data.startsWith(ano)).reduce((a, l) => a + l.valor, 0)
  const meses = [...porMes.entries()].sort().slice(-13).map(([m, v]) => ({ mes: m, entrou: r2(v.entrou), saiu: r2(v.saiu), sobrou: r2(v.entrou - v.saiu), retiradas: r2(v.retiradas) }))
  const categoriasPorMes = Object.fromEntries(
    [...catMes.entries()].filter(([k]) => k.slice(0, 7) >= meses[Math.max(0, meses.length - 3)]?.mes).map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, c) => c[1] - a[1]).map(([n, x]) => [n, r2(x)]))]),
  )
  // "Quanto gastei de gasolina?", "quem mais me pagou?": o que a pessoa chama pelo nome vive na DESCRIÇÃO, não na categoria.
  // Por isso vai pronto, já somado por palavra e por descrição, para a IA achar o número sem somar nada.
  const mesPassado = somaDias(`${mes}-01`, -1).slice(0, 7)
  const porPalavra = (m: string, tipo: 'entrada' | 'saida') => {
    const acc = new Map<string, number>()
    for (const l of ef) {
      if (l.tipo !== tipo || !l.data.startsWith(m) || (tipo === 'saida' && l.pessoal)) continue
      for (const p of new Set(palavrasChave(l.descricao ?? ''))) acc.set(p, (acc.get(p) ?? 0) + l.valor)
    }
    return Object.fromEntries([...acc.entries()].sort((a, c) => c[1] - a[1]).slice(0, 40).map(([p, v]) => [p, r2(v)]))
  }
  const porDescricao = (m: string, tipo: 'entrada' | 'saida') => {
    const acc = new Map<string, { descricao: string; total: number; vezes: number }>()
    for (const l of ef) {
      if (l.tipo !== tipo || !l.data.startsWith(m) || (tipo === 'saida' && l.pessoal)) continue
      const k = (l.descricao ?? '').trim().toLowerCase()
      const x = acc.get(k) ?? { descricao: l.descricao ?? '', total: 0, vezes: 0 }
      x.total += l.valor
      x.vezes++
      acc.set(k, x)
    }
    return [...acc.values()].sort((a, c) => c.total - a.total).slice(0, 10).map((x) => ({ descricao: x.descricao, total: r2(x.total), vezes: x.vezes }))
  }
  const periodo = (q: 'hoje' | 'ontem' | 'semana' | 'mes') => {
    const p = periodoDe(hoje, q)
    const r = resumoDoPeriodo(b, p.de, p.ate)
    return { de: p.de, ate: p.ate, entrou: r.entrou, saiu: r.saiu, retiradas: r.retiradas, sobrou: r2(r.entrou - r.saiu) }
  }
  return {
    hoje,
    // "disponivel" é o dinheiro real em conta e em mãos AGORA (saldo). "periodos.*.sobrou" é entrou menos saiu, outra coisa.
    disponivel: disponivelDaBase(b, sal),
    carteiras: b.carteiras.map((c) => ({
      nome: c.nome,
      tipo: c.tipo === 'cartao' ? 'cartão de crédito (saldo negativo = quanto deve)' : c.tipo,
      saldo: r2(sal[c.id] ?? 0),
    })),
    periodos: { hoje: periodo('hoje'), ontem: periodo('ontem'), semana_atual: periodo('semana'), mes_atual: periodo('mes') },
    faturas_em_aberto: faturas(b.lancs, cartoes).filter((f) => f.falta > 0).map((f) => ({ cartao: nomeCart.get(f.cartaoId), vence: f.vence, total: f.total, pago: f.pago, falta: f.falta })),
    meses,
    dias_recentes: [...porDia.entries()].sort().map(([d, v]) => ({ dia: d, entrou: r2(v.entrou), saiu: r2(v.saiu) })),
    categorias_por_mes: categoriasPorMes,
    maiores_gastos_do_mes: ef.filter((l) => l.tipo === 'saida' && l.data.startsWith(mes)).sort((a, c) => c.valor - a.valor).slice(0, 5).map((l) => ({ descricao: l.descricao, valor: l.valor, dia: l.data })),
    por_palavra: { mes_atual: { saidas: porPalavra(mes, 'saida'), entradas: porPalavra(mes, 'entrada') }, mes_passado: { saidas: porPalavra(mesPassado, 'saida'), entradas: porPalavra(mesPassado, 'entrada') } },
    por_descricao: { mes_atual: { saidas: porDescricao(mes, 'saida'), entradas: porDescricao(mes, 'entrada') }, mes_passado: { saidas: porDescricao(mesPassado, 'saida'), entradas: porDescricao(mesPassado, 'entrada') } },
    contas_fixas: b.fixas.map((f) => ({ descricao: f.descricao, valor: f.valor, dia_do_mes: f.dia })),
    contas_em_aberto: b.contas.slice(0, 80).map((c) => ({ descricao: c.descricao, valor: c.valor, vencimento: c.vencimento, tipo: c.tipo === 'pagar' ? 'a pagar' : 'a receber', atrasada: c.vencimento < hoje })),
    mei: { faturamento_do_ano: r2(faturamentoAno), limite_anual: LIMITE_MEI, usado: `${Math.round((faturamentoAno / LIMITE_MEI) * 100)}%`, falta: r2(Math.max(0, LIMITE_MEI - faturamentoAno)) },
  }
}

export async function resumoDoCliente(userId: string, hoje: string) {
  return resumoDaBase(await carregarBase(userId), hoje)
}

const SISTEMA = `${VOZ}

SITUAÇÃO
A pessoa perguntou sobre os próprios números, no WhatsApp.
Responda à pergunta usando SÓ os números do resumo abaixo. Nunca invente número e nunca some, subtraia nem estime: use o valor pronto que está no resumo.
Regras: no máximo 4 linhas curtas, valores no formato R$ 1.234,56. Resultado negativo (mês no vermelho): nunca escreva "sobrou R$ -550,00"; diga que ficou R$ 550,00 abaixo (ou que faltou), dê o número limpo, acolha em meia frase, com palavras suas e diferentes a cada vez, sem frase pronta e ofereça o próximo passo que existe: mostrar os maiores gastos do mês. Conta atrasada: o mesmo, oferecendo mostrar o que está vencendo. Resultado bom: comemore em poucas palavras antes do número, do seu jeito e sem repetir sempre a mesma frase.
Em pergunta de UM número (quanto gastei de X, quanto entrou, quanto tirei, quanto falta pro limite), responda com UMA frase completa que cite o assunto, o período e o número, e pare: sem comentário extra, sem piada e sem oferecer nada. A oferta de próximo passo é só para resultado negativo ou conta atrasada.
Para perguntas sobre UMA coisa ("quanto gastei de gasolina", "quanto entrou de corte"), procure a palavra em "por_palavra" (já somada, por mês): se ela não aparece naquele mês, o valor é R$ 0,00 e você diz isso, nunca "não tenho". Para "quem mais me pagou" ou "qual foi meu maior gasto", use "por_descricao" e "maiores_gastos_do_mes".
Nunca diga a palavra "resumo" (a pessoa não sabe o que é): fale "nos seus lançamentos" ou só dê o número. Nunca prometa olhar o painel junto com ela: se mandar para o painel, diga só onde fica (Relatórios ou Lançamentos). Nunca diga "anotei" nem "tá anotado": você está respondendo, não registrando.
"Saiu" é gasto do negócio; retiradas do dono ficam à parte. Compra no cartão de crédito só conta como gasto quando a fatura é paga; antes disso está em "faturas_em_aberto".
SALDO é "disponivel" (dinheiro em conta e em mãos agora, sem cartão nem investimento) e "carteiras[].saldo". Não confunda com "sobrou" de "periodos" e "meses", que é entrou menos saiu de um período: se perguntarem saldo, responda com "disponivel".
Para hoje, ontem, semana e mês use "periodos". Contas fixas estão em "contas_fixas"; o que vence está em "contas_em_aberto". Se o resumo não tiver a resposta, diga com simplicidade e sugira ver no painel.
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
  return { texto: limpo.texto || 'Não consegui responder isso por aqui. Veja seus números no painel: https://granninha.com.br/painel', uso }
}
