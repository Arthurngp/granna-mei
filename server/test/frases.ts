/**
 * Bateria de 100 frases do jeito que o MEI escreve, com o que a Granninha deveria entender.
 * Critério principal (meta 95 de 100): intenção certa e, quando registra, o número de ações,
 * o tipo, a direção (entrou/saiu) e o valor certos. Quando falta o valor, ela tem que PERGUNTAR.
 * Rodar: npm run test:frases
 */
import { interpretar, type Contexto, type Interpretacao } from '../src/interpretar.ts'
import { categoriasPadrao } from './categorias.ts'

const CTX: Contexto = {
  hoje: '2026-11-15', // domingo
  ramo: 'beleza e estética (salão)',
  categorias: categoriasPadrao('beleza'),
  carteiras: [
    { id: 'banco', nome: 'Conta do banco', tipo: 'banco', padrao: true },
    { id: 'dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', padrao: false },
    { id: 'maquininha', nome: 'Maquininha', tipo: 'maquininha', padrao: false },
    { id: 'nubank', nome: 'Cartão Nubank', tipo: 'cartao', padrao: false, fechamento: 3, vencimento: 10, conta_pagamento_id: 'banco' },
    { id: 'xp', nome: 'XP Investimentos', tipo: 'investimento', padrao: false },
  ],
  faturasAbertas: [{ cartaoId: 'nubank', fatura: '2026-12', vence: '2026-12-10', falta: 640 }],
  contasAbertas: [
    { id: 'c-agua', descricao: 'Conta de água', valor: 85, vencimento: '2026-11-18', tipo: 'pagar' },
    { id: 'c-aluguel', descricao: 'Aluguel da sala', valor: 900, vencimento: '2026-12-10', tipo: 'pagar' },
    { id: 'c-internet', descricao: 'Internet', valor: 109.9, vencimento: '2026-11-15', tipo: 'pagar' },
    { id: 'c-fornecedor', descricao: 'Fornecedor de cosméticos', valor: 340, vencimento: '2026-11-14', tipo: 'pagar' },
    { id: 'c-mariana', descricao: 'Coloração · Mariana', valor: 250, vencimento: '2026-11-13', tipo: 'receber' },
    { id: 'c-ju', descricao: 'Pacote noiva · Juliana', valor: 600, vencimento: '2026-11-17', tipo: 'receber' },
  ],
}

type A = { t: string; m?: 'entrada' | 'saida'; v?: number; c?: string; w?: string; p?: boolean; n?: number; d?: number; k?: string; dt?: string; venc?: string; dest?: string; tp?: boolean }
type Caso = { f: string; i?: string; a?: A[]; perg?: true }

const L = (m: 'entrada' | 'saida', v: number, x: Partial<A> = {}): A => ({ t: 'lancamento', m, v, ...x })
const E = (v: number, x: Partial<A> = {}) => L('entrada', v, x)
const S = (v: number, x: Partial<A> = {}) => L('saida', v, x)

const CASOS: Caso[] = [
  // Entradas
  { f: 'Recebi 150 da Juliana no pix', a: [E(150, { c: 'servicos', w: 'banco' })] },
  { f: 'corte feminino 70 reais dinheiro', a: [E(70, { c: 'servicos', w: 'dinheiro' })] },
  { f: 'entrou 320 de luzes da roberta no cartão', a: [E(320, { c: 'servicos', w: 'maquininha' })] },
  { f: 'fiz uma escova 55 pix', a: [E(55, { c: 'servicos', w: 'banco' })] },
  { f: 'vendi um shampoo por 45', a: [E(45, { c: 'vendas' })] },
  { f: 'recebi 1.200 de um evento de maquiagem', a: [E(1200, { c: 'servicos' })] },
  { f: 'ganhei 80 de gorjeta', a: [E(80)] },
  { f: 'manicure 40 conto em dinheiro', a: [E(40, { c: 'servicos', w: 'dinheiro' })] },
  { f: 'hj entrou 260 de progressiva', a: [E(260, { c: 'servicos' })] },
  { f: 'recebi 89,90 de um kit', a: [E(89.9, { c: 'vendas' })] },
  { f: 'cliente pagou 130 penteado no débito', a: [E(130, { c: 'servicos', w: 'banco' })] },
  { f: 'pix de 200 da carol pela hidratação', a: [E(200, { c: 'servicos', w: 'banco' })] },
  { f: 'ontem fiz 3 cortes de 50', a: [E(150, { c: 'servicos', dt: '2026-11-14' })] },
  { f: 'recebi 2k de um curso que dei', a: [E(2000)] },
  { f: 'entrada 75 sobrancelha', a: [E(75, { c: 'servicos' })] },
  { f: 'a Patrícia me pagou 110 em espécie', a: [E(110, { w: 'dinheiro' })] },
  { f: 'vendi 3 esmaltes, 36 reais no total', a: [E(36, { c: 'vendas' })] },
  { f: 'recebi 1,5 mil de uma noiva', a: [E(1500, { c: 'servicos' })] },
  { f: 'faturei 420 hoje no salão', a: [E(420)] },
  { f: 'sexta entrou 300 de coloração', a: [E(300, { c: 'servicos', dt: '2026-11-13' })] },
  { f: 'recebi R$ 95,50 da dona lúcia', a: [E(95.5)] },
  { f: 'comissão do salão parceiro caiu, 320', a: [E(320)] },
  { f: 'corte masc 35 pix', a: [E(35, { c: 'servicos', w: 'banco' })] },
  { f: 'recebi duzentos reais de uma escova progressiva', a: [E(200, { c: 'servicos' })] },
  { f: 'entrou 60 de manicure e 40 de pé', a: [E(60), E(40)] },
  // Saídas
  { f: 'paguei 89 de luz', a: [S(89, { c: 'contas-casa', w: 'banco' })] },
  { f: 'gastei 45 de gasolina', a: [S(45, { c: 'transporte' })] },
  { f: 'uber 22', a: [S(22, { c: 'transporte' })] },
  { f: 'almoço 32 no dinheiro', a: [S(32, { c: 'alimentacao', w: 'dinheiro', p: false })] },
  { f: 'comprei tinta e oxidante 186', a: [S(186, { c: 'material' })] },
  { f: 'mercado de casa 230', a: [S(230, { p: true })] },
  { f: 'paguei a escola do meu filho 450', a: [S(450, { p: true })] },
  { f: 'anúncio no insta 120', a: [S(120, { c: 'marketing' })] },
  { f: 'taxa da maquininha 37,40', a: [S(37.4, { c: 'taxas' })] },
  { f: 'comprei luvas e toalhas 64 no pix', a: [S(64, { c: 'material', w: 'banco' })] },
  { f: 'gastei 15 conto de café', a: [S(15, { c: 'alimentacao' })] },
  { f: 'paguei o DAS 86,05', a: [S(86.05, { c: 'impostos' })] },
  { f: 'comprei um secador 380 à vista', a: [S(380, { c: 'equipamentos' })] },
  { f: 'ontem gastei 50 pila de estacionamento', a: [S(50, { c: 'transporte', dt: '2026-11-14' })] },
  { f: 'tirei 800 pra casa', a: [S(800, { p: true })] },
  { f: 'paguei 120 de luz e 60 de gás', a: [S(120), S(60)] },
  { f: 'lanche 18', a: [S(18, { c: 'alimentacao' })] },
  { f: 'comprei 1.200 de produtos pro salão', a: [S(1200, { c: 'material' })] },
  { f: 'farmácia pra mim 67', a: [S(67, { p: true })] },
  { f: 'paguei 250 de aluguel do apartamento onde eu moro', a: [S(250, { p: true })] },
  { f: 'manutenção da cadeira 140', a: [S(140, { c: 'equipamentos' })] },
  { f: 'panfletos 90 reais', a: [S(90, { c: 'marketing' })] },
  { f: 'gastei 23,50 no ifood almoçando no trabalho', a: [S(23.5, { c: 'alimentacao', p: false })] },
  { f: 'tarifa do banco 19,90', a: [S(19.9, { c: 'taxas', w: 'banco' })] },
  { f: 'comprei shampoo pra revender 300 no cartão', a: [S(300, { c: 'material', w: 'nubank' })] },
  // Contas, recorrentes e parcelados
  { f: 'boleto do fornecedor de 480 vence dia 20', a: [{ t: 'conta', m: 'saida', v: 480, venc: '2026-11-20' }] },
  { f: 'a Bia me deve 150 pra sexta', a: [{ t: 'conta', m: 'entrada', v: 150, venc: '2026-11-20' }] },
  { f: 'vou receber 600 da Tati dia 5', a: [{ t: 'conta', m: 'entrada', v: 600, venc: '2026-12-05' }] },
  { f: 'conta de luz 132 vence dia 25', a: [{ t: 'conta', m: 'saida', v: 132, venc: '2026-11-25' }] },
  { f: 'aluguel 900 todo dia 10', a: [{ t: 'recorrente', m: 'saida', v: 900, d: 10 }] },
  { f: 'internet 109,90 todo mês dia 15', a: [{ t: 'recorrente', m: 'saida', v: 109.9, d: 15 }] },
  { f: 'contador 150 por mês dia 5', a: [{ t: 'recorrente', m: 'saida', v: 150, d: 5 }] },
  { f: 'comprei 1.200 de material em 4x', a: [{ t: 'parcelado', m: 'saida', v: 1200, n: 4 }] },
  { f: 'secador de 720 parcelado em 6 vezes', a: [{ t: 'parcelado', m: 'saida', v: 720, n: 6 }] },
  { f: 'cadeira nova 4x de 300', a: [{ t: 'parcelado', m: 'saida', v: 1200, n: 4 }] },
  { f: 'vendi um pacote de 900 em 3x pra Renata', a: [{ t: 'parcelado', m: 'entrada', v: 900, n: 3 }] },
  { f: 'a Sandra vai me pagar 200 semana que vem', a: [{ t: 'conta', m: 'entrada', v: 200, venc: '2026-11-22' }] },
  { f: 'parcela do empréstimo 350 todo dia 8', a: [{ t: 'recorrente', m: 'saida', v: 350, d: 8 }] },
  { f: 'fiado: Aline 80', perg: true },
  { f: 'IPTU do salão 680 vence dia 30', a: [{ t: 'conta', m: 'saida', v: 680, venc: '2026-11-30' }] },
  { f: 'comprei uma máquina de 2.400 em 12x no cartão', a: [{ t: 'parcelado', m: 'saida', v: 2400, n: 12 }] },
  { f: 'mensalidade do sistema 49,90 todo dia 1', a: [{ t: 'recorrente', m: 'saida', v: 49.9, d: 1 }] },
  { f: 'fornecedor 1.500 pra pagar dia 3', a: [{ t: 'conta', m: 'saida', v: 1500, venc: '2026-12-03' }] },
  // Baixar conta que já existe
  { f: 'paguei a água', a: [{ t: 'baixar_conta', k: 'c-agua' }] },
  { f: 'a Mariana pagou', a: [{ t: 'baixar_conta', k: 'c-mariana' }] },
  { f: 'paguei o fornecedor', a: [{ t: 'baixar_conta', k: 'c-fornecedor' }] },
  { f: 'paguei a internet', a: [{ t: 'baixar_conta', k: 'c-internet' }] },
  { f: 'Juliana pagou os 600 do pacote', a: [{ t: 'baixar_conta', k: 'c-ju', v: 600 }] },
  { f: 'paguei o aluguel', a: [{ t: 'baixar_conta', k: 'c-aluguel' }] },
  // Transferências
  { f: 'depositei 500 do caixa no banco', a: [{ t: 'transferencia', v: 500, w: 'dinheiro', dest: 'banco' }] },
  { f: 'caiu 1.300 da maquininha no banco', a: [{ t: 'transferencia', v: 1300, w: 'maquininha', dest: 'banco' }] },
  { f: 'saquei 200 do banco', a: [{ t: 'transferencia', v: 200, w: 'banco', dest: 'dinheiro' }] },
  { f: 'passei 300 do dinheiro pra conta', a: [{ t: 'transferencia', v: 300, w: 'dinheiro', dest: 'banco' }] },
  // Cartão, fatura, investimento e categoria (2026-11-16)
  { f: 'gastei 200 no crédito com material', a: [S(200, { c: 'material', w: 'nubank' })] },
  { f: 'almoço 45 no cartão nubank', a: [S(45, { c: 'alimentacao', w: 'nubank' })] },
  { f: 'comprei uma cadeira de 1.200 em 4x no cartão', a: [{ t: 'parcelado', m: 'saida', v: 1200, n: 4, w: 'nubank' }] },
  { f: 'paguei a fatura do nubank', a: [{ t: 'pagar_fatura', v: 640, dest: 'nubank', w: 'banco' }] },
  { f: 'paguei 300 da fatura do cartão', a: [{ t: 'pagar_fatura', v: 300, dest: 'nubank' }] },
  { f: 'guardei 500 na XP', a: [{ t: 'transferencia', v: 500, dest: 'xp' }] },
  { f: 'criar categoria Combustível', a: [{ t: 'criar_categoria' }] },
  { f: 'cria a categoria embalagens', a: [{ t: 'criar_categoria' }] },
  { f: 'quanto tá a fatura do cartão?', i: 'pergunta' },
  // Gasto que pode ser da casa ou do negócio (2026-11-16)
  { f: 'recarga de celular 30', a: [S(30, { tp: true })] },
  { f: 'gasolina 120 no pix', a: [S(120, { tp: true })] },
  { f: 'paguei a internet 99,90', a: [S(99.9, { tp: true })] },
  { f: 'conserto do carro 450', a: [S(450, { tp: true })] },
  { f: 'recarga do celular do salão 30', a: [S(30, { tp: false })] },
  { f: 'comprei tinta 85', a: [S(85, { tp: false })] },
  { f: 'aluguel do salão 900', a: [S(900, { tp: false })] },
  { f: 'mercado de casa 230', a: [S(230, { p: true, tp: false })] },
  // Perguntas
  { f: 'quanto gastei esse mês?', i: 'pergunta' },
  { f: 'o que vence essa semana', i: 'pergunta' },
  { f: 'quanto sobrou em outubro', i: 'pergunta' },
  { f: 'quanto eu tenho no banco?', i: 'pergunta' },
  { f: 'qual meu maior gasto?', i: 'pergunta' },
  { f: 'quem tá me devendo?', i: 'pergunta' },
  { f: 'quanto falta pro limite do mei', i: 'pergunta' },
  { f: 'quanto entrou ontem', i: 'pergunta' },
  // Desfazer e corrigir
  { f: 'desfazer', i: 'desfazer' },
  { f: 'apaga o último', i: 'desfazer' },
  { f: 'errei, cancela isso', i: 'desfazer' },
  { f: 'não foi 50, foi 60', i: 'corrigir' },
  { f: 'era no dinheiro, não no pix', i: 'corrigir' },
  { f: 'DESFAZER', i: 'desfazer' },
  // Conversa
  { f: 'oi', i: 'saudacao' },
  { f: 'bom dia granninha', i: 'saudacao' },
  { f: 'obrigada!', i: 'saudacao' },
  { f: 'como eu lanço uma conta?', i: 'ajuda' },
  // Falta o valor: tem que perguntar
  { f: 'paguei a luz', perg: true },
  { f: 'recebi da Fernanda', perg: true },
  { f: 'comprei material', perg: true },
  { f: 'gastei com gasolina', perg: true },
]

const perto = (a?: number | null, b?: number | null) => a != null && b != null && Math.abs(a - b) < 0.011

function principal(c: Caso, r: Interpretacao): string | null {
  if (c.perg) return r.perguntar && r.acoes.length === 0 ? null : `devia perguntar; veio ${r.intencao} ${JSON.stringify(r.acoes.map((a) => [a.tipo_acao, a.valor]))}`
  if (c.i) return r.intencao === c.i ? null : `intenção ${r.intencao}, esperava ${c.i}`
  if (r.perguntar) return `perguntou "${r.perguntar}" em vez de registrar`
  if (r.intencao !== 'acoes') return `intenção ${r.intencao}`
  if (r.acoes.length !== c.a!.length) return `${r.acoes.length} ações, esperava ${c.a!.length}`
  const sobra = [...r.acoes]
  for (const e of c.a!) {
    const i = sobra.findIndex((a) => a.tipo_acao === e.t && (e.m === undefined || a.movimento === e.m) && (e.v === undefined || perto(a.valor, e.v)) && (e.k === undefined || a.conta_id === e.k))
    if (i < 0) return `não achei ${JSON.stringify(e)} em ${JSON.stringify(r.acoes.map((a) => [a.tipo_acao, a.movimento, a.valor, a.conta_id]))}`
    sobra.splice(i, 1)
  }
  return null
}

function detalhes(c: Caso, r: Interpretacao) {
  const out: { campo: string; ok: boolean; msg: string }[] = []
  if (!c.a || r.acoes.length !== c.a.length) return out
  c.a.forEach((e, i) => {
    const a = r.acoes.find((x) => x.tipo_acao === e.t && (e.v === undefined || perto(x.valor, e.v))) ?? r.acoes[i]
    if (e.c) out.push({ campo: 'categoria', ok: a.categoria_id === e.c, msg: `${a.categoria_id} vs ${e.c}` })
    if (e.w) out.push({ campo: 'carteira', ok: a.carteira_id === e.w, msg: `${a.carteira_id} vs ${e.w}` })
    if (e.dest) out.push({ campo: 'carteira', ok: a.carteira_destino_id === e.dest, msg: `destino ${a.carteira_destino_id} vs ${e.dest}` })
    if (e.p !== undefined) out.push({ campo: 'pessoal', ok: a.pessoal === e.p, msg: `${a.pessoal} vs ${e.p}` })
    if (e.tp !== undefined) out.push({ campo: 'casa ou negócio', ok: a.talvez_pessoal === e.tp, msg: `talvez_pessoal ${a.talvez_pessoal} vs ${e.tp}` })
    if (e.n) out.push({ campo: 'parcelas', ok: a.parcelas === e.n, msg: `${a.parcelas} vs ${e.n}` })
    if (e.d) out.push({ campo: 'dia', ok: a.dia_do_mes === e.d, msg: `${a.dia_do_mes} vs ${e.d}` })
    if (e.dt) out.push({ campo: 'data', ok: a.data === e.dt, msg: `${a.data} vs ${e.dt}` })
    if (e.venc) out.push({ campo: 'vencimento', ok: a.vencimento === e.venc, msg: `${a.vencimento} vs ${e.venc}` })
  })
  return out
}

async function main() {
  const so = process.argv[2] ? Number(process.argv[2]) : 0
  const lista = so ? CASOS.slice(0, so) : CASOS
  const res: (Interpretacao | Error)[] = new Array(lista.length)
  let prox = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (prox < lista.length) {
        const i = prox++
        try {
          res[i] = await interpretar(lista[i].f, CTX, { perguntarMeio: false })
        } catch (e) {
          res[i] = e as Error
        }
      }
    }),
  )
  let ok = 0
  const falhas: string[] = []
  const camp: Record<string, [number, number]> = {}
  let ms = 0
  let tokE = 0
  let tokS = 0
  lista.forEach((c, i) => {
    const r = res[i]
    if (r instanceof Error) return falhas.push(`#${i + 1} "${c.f}": ERRO ${r.message.slice(0, 160)}`)
    ms += r.ms
    tokE += r.uso.entrada
    tokS += r.uso.saida
    const p = principal(c, r)
    if (p) falhas.push(`#${i + 1} "${c.f}": ${p}`)
    else ok++
    for (const d of detalhes(c, r)) {
      camp[d.campo] ??= [0, 0]
      camp[d.campo][1]++
      if (d.ok) camp[d.campo][0]++
      else falhas.push(`   (detalhe) #${i + 1} "${c.f}": ${d.campo} ${d.msg}`)
    }
  })
  const n = lista.length
  console.log(falhas.join('\n'))
  console.log(`\nACERTO PRINCIPAL: ${ok} de ${n}`)
  for (const [k, [a, t]] of Object.entries(camp)) console.log(`  ${k}: ${a} de ${t}`)
  console.log(`tempo médio: ${(ms / n / 1000).toFixed(1)} s · tokens por mensagem: ${Math.round(tokE / n)} entrada, ${Math.round(tokS / n)} saída`)
}

main()
