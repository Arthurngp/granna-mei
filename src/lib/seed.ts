import { MATERIAL_POR_RAMO } from './config'
import { hoje, iso, mesDe, parse, somaDias, somaMeses } from './format'
import type { Categoria, Conta, Estado, Fixa, Lancamento, Origem } from './tipos'

export const VERSAO = 7

export function categoriasPadrao(ramo: string): Categoria[] {
  return [
    { id: 'servicos', nome: 'Serviços prestados', tipo: 'entrada', cor: '#12915A', natureza: 'servico' },
    { id: 'vendas', nome: 'Vendas de produtos', tipo: 'entrada', cor: '#5BBF8A', natureza: 'comercio' },
    { id: 'outras-entradas', nome: 'Outros recebimentos', tipo: 'entrada', cor: '#9AD9B8' },
    { id: 'material', nome: MATERIAL_POR_RAMO[ramo] ?? 'Material', tipo: 'saida', cor: '#454C83' },
    { id: 'aluguel', nome: 'Aluguel', tipo: 'saida', cor: '#747EAD' },
    { id: 'contas-casa', nome: 'Luz, água e internet', tipo: 'saida', cor: '#2F9E8F' },
    { id: 'transporte', nome: 'Transporte', tipo: 'saida', cor: '#E0A03B' },
    { id: 'alimentacao', nome: 'Alimentação', tipo: 'saida', cor: '#D96C4F' },
    { id: 'impostos', nome: 'Impostos (DAS)', tipo: 'saida', cor: '#8B5FBF' },
    { id: 'equipamentos', nome: 'Ferramentas e equipamentos', tipo: 'saida', cor: '#3B82C4' },
    { id: 'marketing', nome: 'Divulgação', tipo: 'saida', cor: '#C2528B' },
    { id: 'taxas', nome: 'Taxas e tarifas', tipo: 'saida', cor: '#8A8FA8' },
    { id: 'retirada', nome: 'Retirada do dono', tipo: 'saida', cor: '#B1B9D8', pessoal: true },
  ]
}

const prefsPadrao = () => ({ resumoDia: 1, resumoHora: '08:00', lembreteHora: '09:00', antecedencia: 1, ocultar: false })

export function estadoVazio(): Estado {
  const h = hoje()
  return {
    versao: VERSAO,
    sessao: { logado: false, onboarding: false, demo: false, passo: 0 },
    usuario: { nome: '', email: '', negocio: '', cnpj: '', whats: '', ramo: '' },
    carteiras: [],
    categorias: categoriasPadrao('outro'),
    lancamentos: [],
    contas: [],
    fixas: [],
    prefs: prefsPadrao(),
    contador: { nome: '', email: '', whats: '', auto: false },
    assinatura: { status: 'trial', plano: 'mensal', trialFim: somaDias(h, 7), proxCobranca: somaDias(h, 7), faturas: [] },
  }
}

/** Gerador determinístico: os dados de exemplo saem iguais a cada carga. */
function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SERVICOS: [string, number][] = [
  ['Corte feminino', 70], ['Escova', 55], ['Coloração', 220], ['Hidratação', 90], ['Manicure e pedicure', 65],
  ['Progressiva', 260], ['Design de sobrancelha', 40], ['Luzes', 320], ['Penteado', 130], ['Corte e escova', 110],
]
const CLIENTES = ['Juliana', 'Mariana', 'Dona Lúcia', 'Patrícia', 'Fernanda', 'Bia', 'Roberta', 'Aline', 'Tati', 'Sandra', 'Carol', 'Renata']
const MATERIAIS = ['Tinta e oxidante', 'Shampoo e máscara', 'Esmaltes', 'Luvas e toalhas', 'Papel alumínio e pincéis', 'Creme de progressiva']

/** Conta de exemplo: o Studio Camila, um salão que usa a Granninha desde janeiro. */
export function estadoDemo(): Estado {
  const rnd = mulberry32(20261115)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]
  const h = hoje()
  const ano = h.slice(0, 4)
  const mes = mesDe(h)
  const lancs: Lancamento[] = []
  const contas: Conta[] = []
  let seq = 0
  const id = (p: string) => `${p}${++seq}`
  const origem = (): Origem => {
    const r = rnd()
    return r < 0.55 ? 'texto' : r < 0.82 ? 'audio' : r < 0.95 ? 'foto' : 'pdf'
  }
  const hora = (min = 8, max = 19) => `${String(min + Math.floor(rnd() * (max - min))).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`
  const add = (l: Omit<Lancamento, 'id' | 'hora'> & { hora?: string }) => {
    const item: Lancamento = { hora: l.hora ?? hora(), ...l, id: id('l') }
    if (item.origem === 'foto' || item.origem === 'pdf') item.anexo = true
    lancs.push(item)
    return item
  }

  const fixas: Fixa[] = [
    { id: 'fx-aluguel', descricao: 'Aluguel da sala', valor: 900, dia: 10, categoriaId: 'aluguel' },
    { id: 'fx-internet', descricao: 'Internet', valor: 109.9, dia: 15, categoriaId: 'contas-casa' },
    { id: 'fx-das', descricao: 'DAS do MEI', valor: 86.05, dia: 20, categoriaId: 'impostos', das: true },
  ]

  for (let d = `${ano}-01-02`; d <= h; d = somaDias(d, 1)) {
    const dt = parse(d)
    const dow = dt.getDay()
    const dia = dt.getDate()
    const aberto = dow >= 2 // terça a sábado
    if (aberto) {
      const n = rnd() < 0.12 ? 0 : 1 + Math.floor(rnd() * (dow === 6 ? 4 : 3))
      for (let i = 0; i < n; i++) {
        const [nome, base] = pick(SERVICOS)
        const r = rnd()
        add({
          tipo: 'entrada', valor: Math.round(base * (0.9 + rnd() * 0.25)), descricao: `${nome} · ${pick(CLIENTES)}`,
          categoriaId: 'servicos', carteiraId: r < 0.58 ? 'banco' : r < 0.9 ? 'maquininha' : 'dinheiro', data: d, origem: origem(),
        })
      }
      if (rnd() < 0.16) add({ tipo: 'entrada', valor: 35 + Math.floor(rnd() * 90), descricao: 'Venda de produto', categoriaId: 'vendas', carteiraId: rnd() < 0.5 ? 'maquininha' : 'banco', data: d, origem: origem() })
      if (rnd() < 0.24) add({ tipo: 'saida', valor: 60 + Math.floor(rnd() * 240), descricao: pick(MATERIAIS), categoriaId: 'material', carteiraId: 'banco', data: d, origem: rnd() < 0.5 ? 'foto' : origem() })
      if (rnd() < 0.3) add({ tipo: 'saida', valor: 14 + Math.floor(rnd() * 26), descricao: rnd() < 0.5 ? 'Uber' : 'Gasolina', categoriaId: 'transporte', carteiraId: rnd() < 0.7 ? 'banco' : 'dinheiro', data: d, origem: origem() })
      if (rnd() < 0.42) add({ tipo: 'saida', valor: 18 + Math.floor(rnd() * 24), descricao: 'Almoço', categoriaId: 'alimentacao', carteiraId: rnd() < 0.6 ? 'banco' : 'dinheiro', data: d, origem: origem() })
    }
    if (dia === 5 || dia === 22) add({ tipo: 'saida', valor: 1300 + Math.floor(rnd() * 5) * 100, descricao: 'Retirada para casa', categoriaId: 'retirada', carteiraId: 'banco', data: d, origem: 'texto', pessoal: true })
    if (dia === 12) add({ tipo: 'saida', valor: 120, descricao: 'Anúncio no Instagram', categoriaId: 'marketing', carteiraId: 'banco', data: d, origem: 'texto' })
    if (dia === 28) add({ tipo: 'saida', valor: 22 + Math.floor(rnd() * 30), descricao: 'Taxa da maquininha', categoriaId: 'taxas', carteiraId: 'maquininha', data: d, origem: 'pdf' })
    if (dia === 1 || dia === 16) add({ tipo: 'transferencia', valor: 400 + Math.floor(rnd() * 6) * 100, descricao: 'Repasse da maquininha', carteiraId: 'maquininha', carteiraDestinoId: 'banco', data: d, origem: 'texto' })
    for (const f of fixas) {
      if (dia !== f.dia || mesDe(d) === mes) continue
      const l = add({ tipo: 'saida', valor: f.valor, descricao: f.descricao, categoriaId: f.categoriaId, carteiraId: 'banco', data: d, origem: f.das ? 'pdf' : 'texto' })
      contas.push({ id: id('c'), tipo: 'pagar', descricao: f.descricao, valor: f.valor, vencimento: d, status: 'paga', categoriaId: f.categoriaId, fixaId: f.id, das: f.das, pagoEm: d, lancId: l.id })
    }
  }

  // Mês atual e os dois seguintes: contas fixas em aberto (as já vencidas e pagas viram lançamento).
  for (let k = 0; k < 3; k++) {
    const ym = somaMeses(mes, k)
    for (const f of fixas) {
      const venc = `${ym}-${String(f.dia).padStart(2, '0')}`
      const paga = k === 0 && venc < h && f.id === 'fx-aluguel'
      const c: Conta = { id: id('c'), tipo: 'pagar', descricao: f.descricao, valor: f.valor, vencimento: venc, status: paga ? 'paga' : 'aberta', categoriaId: f.categoriaId, fixaId: f.id, das: f.das }
      if (paga) {
        const l = add({ tipo: 'saida', valor: f.valor, descricao: f.descricao, categoriaId: f.categoriaId, carteiraId: 'banco', data: venc, origem: 'texto' })
        c.pagoEm = venc
        c.lancId = l.id
      }
      contas.push(c)
    }
  }
  // Compra parcelada e contas a receber, sempre em volta de hoje para a tela ter o que mostrar.
  contas.push(
    { id: id('c'), tipo: 'pagar', descricao: 'Secador profissional', valor: 180, vencimento: somaDias(h, 3), status: 'aberta', categoriaId: 'equipamentos', parcela: { n: 3, total: 4 } },
    { id: id('c'), tipo: 'pagar', descricao: 'Secador profissional', valor: 180, vencimento: somaDias(h, 33), status: 'aberta', categoriaId: 'equipamentos', parcela: { n: 4, total: 4 } },
    { id: id('c'), tipo: 'pagar', descricao: 'Fornecedor de cosméticos', valor: 340, vencimento: somaDias(h, -1), status: 'aberta', categoriaId: 'material' },
    { id: id('c'), tipo: 'receber', descricao: 'Coloração · Mariana', valor: 250, vencimento: somaDias(h, -2), status: 'aberta', categoriaId: 'servicos' },
    { id: id('c'), tipo: 'receber', descricao: 'Pacote noiva · Juliana', valor: 600, vencimento: somaDias(h, 2), status: 'aberta', categoriaId: 'servicos', parcela: { n: 1, total: 2 } },
    { id: id('c'), tipo: 'receber', descricao: 'Pacote noiva · Juliana', valor: 600, vencimento: somaDias(h, 32), status: 'aberta', categoriaId: 'servicos', parcela: { n: 2, total: 2 } },
    { id: id('c'), tipo: 'receber', descricao: 'Comissão do salão parceiro', valor: 320, vencimento: somaDias(h, 9), status: 'aberta', categoriaId: 'outras-entradas' },
  )

  // O saldo inicial é calculado de trás para frente, para cada carteira fechar hoje num valor plausível.
  const mov: Record<string, number> = { banco: 0, dinheiro: 0, maquininha: 0 }
  for (const l of lancs) {
    if (l.tipo === 'entrada') mov[l.carteiraId] += l.valor
    else mov[l.carteiraId] -= l.valor
    if (l.tipo === 'transferencia' && l.carteiraDestinoId) mov[l.carteiraDestinoId] += l.valor
  }
  const inicial = (id: string, alvo: number) => Math.round((alvo - mov[id]) * 100) / 100

  lancs.sort((a, b) => (a.data + a.hora < b.data + b.hora ? 1 : -1))
  const d = new Date()
  const faturas = [1, 2, 3].map((k) => ({ id: `f${k}`, data: iso(new Date(d.getFullYear(), d.getMonth() - k, 15)), valor: 19.9, status: 'paga' as const }))

  return {
    versao: VERSAO,
    sessao: { logado: true, onboarding: true, demo: true, passo: 6 },
    usuario: { nome: 'Camila Duarte', email: 'camila@studiocamila.com.br', negocio: 'Studio Camila', cnpj: '41.287.553/0001-90', whats: '(81) 98765-4321', ramo: 'beleza' },
    carteiras: [
      { id: 'banco', nome: 'Conta do banco', tipo: 'banco', saldoInicial: inicial('banco', 3842.5), padrao: true },
      { id: 'dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', saldoInicial: inicial('dinheiro', 415), padrao: false },
      { id: 'maquininha', nome: 'Maquininha', tipo: 'maquininha', saldoInicial: inicial('maquininha', 968.4), padrao: false },
    ],
    categorias: categoriasPadrao('beleza'),
    lancamentos: lancs,
    contas,
    fixas,
    prefs: prefsPadrao(),
    contador: { nome: 'Sérgio Contabilidade', email: 'sergio@contabil.com.br', whats: '(81) 99888-1020', auto: true },
    assinatura: { status: 'ativa', plano: 'mensal', trialFim: somaDias(h, -100), proxCobranca: `${somaMeses(mes, h.slice(8) >= '15' ? 1 : 0)}-15`, faturas },
  }
}
