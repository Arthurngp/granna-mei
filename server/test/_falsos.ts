/**
 * Banco PostgREST falso e IA falsa em memória, para testar o processar() real sem rede nem custo.
 * Usado por test/saldo-fluxo.ts e test/correcao-fluxo.ts.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

type Linha = Record<string, unknown>

/* ---------------- banco falso (PostgREST em memória) ---------------- */

const PKS: Record<string, string[]> = {
  mensagens: ['id'], conversas: ['telefone'], perfis: ['id'], assinaturas: ['user_id'],
  categorias: ['user_id', 'id'], carteiras: ['user_id', 'id'], lancamentos: ['user_id', 'id'], fixas: ['user_id', 'id'], contas: ['user_id', 'id'],
  avisos: ['chave'],
}
export const E = {
  tabelas: {} as Record<string, Linha[]>,
  falharTabela: null as string | null,
  /** falha só a leitura cujo `select` é exatamente este */
  falharSelect: null as string | null,
  /** finge que a coluna não existe (banco sem a migration): recusa insert e select que a citem */
  recusarColuna: null as string | null,
  /** atrasa a resposta deste POST (tabela), para provar que alguém esperou por ele */
  atrasar: null as { tabela: string; ms: number } | null,
  /** caminhos gravados no storage (comprovantes) */
  storage: [] as string[],
}
export const pedidos: string[] = []

const comparar = (a: unknown, b: string) => {
  const sa = String(a)
  if (sa !== '' && b !== '' && !Number.isNaN(Number(sa)) && !Number.isNaN(Number(b))) return Number(sa) - Number(b)
  return sa < b ? -1 : sa > b ? 1 : 0
}
function casa(l: Linha, k: string, v: string): boolean {
  const neg = v.startsWith('not.')
  const t = neg ? v.slice(4) : v
  const ponto = t.indexOf('.')
  const op = t.slice(0, ponto)
  const arg = t.slice(ponto + 1)
  let ok: boolean
  const x = l[k]
  if (op === 'eq') ok = String(x) === arg
  else if (op === 'neq') ok = String(x) !== arg
  else if (op === 'is') ok = arg === 'null' ? x === null || x === undefined : String(x) === arg
  else if (op === 'in') ok = arg.slice(1, -1).split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x))
  else if (op === 'gte') ok = x != null && comparar(x, arg) >= 0
  else if (op === 'gt') ok = x != null && comparar(x, arg) > 0
  else if (op === 'lte') ok = x != null && comparar(x, arg) <= 0
  else if (op === 'lt') ok = x != null && comparar(x, arg) < 0
  else if (op === 'like' || op === 'ilike') {
    // O PostgREST aceita os DOIS curingas: o * da query string e o % do SQL, que o supabase-js
    // repassa como está. O falso tem que aceitar os dois, senão um filtro que funciona em produção
    // volta vazio aqui — e o teste reprova sem defeito nenhum no código.
    const padrao = arg
      .split(/[*%]/)
      .map((parte) => parte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    ok = new RegExp(`^${padrao}$`, op === 'ilike' ? 'i' : '').test(String(x ?? ''))
  } else throw new Error(`operador do banco falso não suportado: ${op}`)
  return neg ? !ok : ok
}
const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

const db = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const tabela = url.pathname.split('/').pop() ?? ''
  const corpoTxt = await new Promise<string>((ok) => {
    let t = ''
    req.on('data', (c) => (t += c))
    req.on('end', () => ok(t))
  })
  const prefer = String(req.headers.prefer ?? '')
  const umSo = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
  pedidos.push(`${req.method} ${tabela}`)
  const enviar = (st: number, corpo: unknown, cab: Record<string, string> = {}) => {
    res.writeHead(st, { 'Content-Type': 'application/json', ...cab })
    res.end(corpo === undefined ? '' : JSON.stringify(corpo))
  }
  // Storage (comprovante): não é tabela e o corpo é binário, então nem chega ao JSON.parse.
  if (url.pathname.includes('/storage/v1/')) {
    E.storage.push(url.pathname.split('/object/').pop() ?? url.pathname)
    return enviar(200, { Key: E.storage[E.storage.length - 1] })
  }
  if (E.falharSelect && req.method === 'GET' && url.searchParams.get('select') === E.falharSelect) return enviar(500, { message: 'banco falso: leitura provocada', code: 'XX000' })
  if (E.falharTabela === tabela) return enviar(500, { message: 'banco falso: falha provocada', code: 'XX000' })
  // Banco sem a migration: a coluna não existe nem para gravar nem para ler.
  if (E.recusarColuna) {
    const col = E.recusarColuna
    const noSelect = (url.searchParams.get('select') ?? '').split(',').includes(col)
    const noCorpo = req.method === 'POST' && corpoTxt.includes(`"${col}":`)
    if (noSelect || noCorpo) {
      return enviar(400, { code: noCorpo ? 'PGRST204' : '42703', message: `Could not find the '${col}' column of '${tabela}' in the schema cache` })
    }
  }
  E.tabelas[tabela] ??= []
  const filtros = [...url.searchParams.entries()].filter(([k]) => !RESERVADOS.has(k))
  const filtra = () => E.tabelas[tabela].filter((l) => filtros.every(([k, v]) => casa(l, k, v)))
  const chave = (l: Linha, pk: string[]) => pk.map((c) => String(l[c])).join('|')

  if (req.method === 'GET' || req.method === 'HEAD') {
    let rows = filtra()
    const total = rows.length
    const ordem = url.searchParams.getAll('order').flatMap((o) => o.split(','))
    for (const o of [...ordem].reverse()) {
      const [col, dir] = o.split('.')
      rows = [...rows].sort((a, b) => (dir === 'desc' ? -1 : 1) * comparar(a[col] ?? '', String(b[col] ?? '')))
    }
    const off = Number(url.searchParams.get('offset') ?? 0)
    const lim = url.searchParams.get('limit')
    rows = rows.slice(off, lim ? off + Number(lim) : undefined)
    const cols = (url.searchParams.get('select') ?? '*').split(',')
    const proj = cols.includes('*') ? rows : rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))
    const cab: Record<string, string> = prefer.includes('count=exact') ? { 'Content-Range': total ? `0-${total - 1}/${total}` : '*/0' } : {}
    if (req.method === 'HEAD') {
      res.writeHead(200, cab)
      return res.end()
    }
    if (umSo) return proj.length ? enviar(200, proj[0], cab) : enviar(406, { code: 'PGRST116', message: 'sem linhas' }, cab)
    return enviar(200, proj, cab)
  }
  const corpo = corpoTxt ? JSON.parse(corpoTxt) : null
  if (req.method === 'POST' && E.atrasar?.tabela === tabela) await new Promise((ok) => setTimeout(ok, E.atrasar!.ms))
  if (req.method === 'POST') {
    const novas: Linha[] = Array.isArray(corpo) ? corpo : [corpo]
    const pk = PKS[tabela] ?? ['id']
    const mescla = prefer.includes('resolution=merge-duplicates')
    const ignora = prefer.includes('resolution=ignore-duplicates')
    const saida: Linha[] = []
    for (const n of novas) {
      const ja = E.tabelas[tabela].find((l) => chave(l, pk) === chave(n, pk))
      if (ja && mescla) Object.assign(ja, n), saida.push(ja)
      else if (ja && ignora) continue
      else if (ja) return enviar(409, { code: '23505', message: 'duplicate key value' })
      else {
        // 'recebida' é o default real da coluna (migration 20261115190000): com 'ok' aqui, nenhuma
        // linha pareceria presa e a trava de "começou" passaria sem ser exercitada.
        const linha: Linha = { ...(tabela === 'mensagens' ? { status: 'recebida', desfeita: false, efeitos: {}, erro: null } : {}), criado_em: new Date().toISOString(), ...n }
        E.tabelas[tabela].push(linha)
        saida.push(linha)
      }
    }
    return prefer.includes('return=representation') ? enviar(201, saida) : enviar(201, undefined)
  }
  if (req.method === 'PATCH') {
    const alvo = filtra()
    for (const l of alvo) Object.assign(l, corpo)
    return prefer.includes('return=representation') ? enviar(200, alvo) : enviar(204, undefined)
  }
  if (req.method === 'DELETE') {
    const alvo = new Set(filtra())
    E.tabelas[tabela] = E.tabelas[tabela].filter((l) => !alvo.has(l))
    return enviar(204, undefined)
  }
  enviar(405, { message: 'método' })
})

/* ---------------- IA falsa (OpenAI em memória) ---------------- */

interface AcaoFalsa {
  tipo_acao: string; movimento: 'entrada' | 'saida' | null; valor: number | null; descricao: string; categoria_id: string | null
  carteira_id: string | null; carteira_destino_id: string | null; meio: string | null; data: string | null; pessoal: boolean
  vencimento: string | null; dia_do_mes: number | null; parcelas: number | null; conta_id: string | null; talvez_pessoal: boolean
}
export const acao = (x: Partial<AcaoFalsa>): AcaoFalsa => ({
  tipo_acao: 'lancamento', movimento: 'saida', valor: 6, descricao: 'Mercado', categoria_id: 'material', carteira_id: null, carteira_destino_id: null,
  meio: 'pix', data: null, pessoal: false, vencimento: null, dia_do_mes: null, parcelas: null, conta_id: null, talvez_pessoal: false, ...x,
})
export const acoes = (...a: AcaoFalsa[]) => ({ intencao: 'acoes', acoes: a, pergunta: null, correcao: null, falta: null })
export const SEM_ACAO = { intencao: 'outro', acoes: [], pergunta: null, correcao: null, falta: null }

export const ia = {
  /** Texto da mensagem (sem o invólucro) → o que a "IA" entendeu. */
  regras: [] as [RegExp, unknown][],
  chamadas: { interpretacao: 0, resposta: 0, transcricao: 0, documento: 0 },
  ultimoResumo: null as null | Record<string, any>,
  /** Prompt de sistema da última interpretação (para provar o que a IA recebeu). */
  ultimoSistema: '',
  queda: false,
  /** Faz a IA falsa responder um erro HTTP específico (ex.: 429 insufficient_quota). */
  erro: null as { status: number; corpo: string } | null,
  /** Quantas vezes a IA falsa foi chamada (para provar que cota não é repetida 3x). */
  pedidos: 0,
  /** O que a transcrição de áudio devolve. */
  transcricao: 'paguei 50 de gasolina',
  /** O que a leitura de foto/PDF devolve (formato Leitura de midia.ts). */
  documento: { tipo: 'comprovante', meio: 'pix', vencimento: null, resumo: 'Comprovante de R$ 50', transacoes: [{ descricao: 'Gasolina', valor: 50, movimento: 'saida', data: null }] } as Record<string, unknown>,
}
const iaServer = createServer(async (req, res) => {
  const txt = await new Promise<string>((ok) => {
    let t = ''
    req.on('data', (c) => (t += c))
    req.on('end', () => ok(t))
  })
  ia.pedidos++
  if (ia.erro) {
    res.writeHead(ia.erro.status, { 'Content-Type': 'application/json' })
    return res.end(ia.erro.corpo)
  }
  if (ia.queda) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'IA fora do ar (provocado pelo teste)' }))
  }
  // Transcrição de áudio: multipart, não JSON.
  if ((req.url ?? '').includes('/audio/transcriptions')) {
    ia.chamadas.transcricao++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ text: ia.transcricao, usage: { type: 'duration', seconds: 3 } }))
  }
  const b = JSON.parse(txt)
  const nome = b.response_format.json_schema.name as string
  const usuario = String(b.messages[1].content)
  let saida: unknown
  if (nome === 'interpretacao') {
    ia.chamadas.interpretacao++
    ia.ultimoSistema = String(b.messages[0].content)
    saida = ia.regras.find(([re]) => re.test(usuario))?.[1] ?? SEM_ACAO
  } else if (nome === 'documento') {
    ia.chamadas.documento++
    saida = ia.documento
  } else if (nome === 'resposta') {
    ia.chamadas.resposta++
    const m = /RESUMO \(JSON\):\n([\s\S]*?)\n\nPERGUNTA:/.exec(usuario)
    ia.ultimoResumo = m ? JSON.parse(m[1]) : null
    saida = { resposta: 'RESPOSTA-DA-IA' }
  } else throw new Error('esquema de IA desconhecido: ' + nome)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(saida) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
})

/* ---------------- gateway falso (só a mídia recebida) ---------------- */

const gw = createServer((req, res) => {
  const u = req.url ?? ''
  if (/^\/api\/media\//.test(u)) {
    res.writeHead(200, { 'Content-Type': u.endsWith('.ogg') ? 'audio/ogg' : 'image/jpeg' })
    return res.end(Buffer.from(u.endsWith('.ogg') ? 'audio-falso' : 'imagem-falsa'))
  }
  res.writeHead(404).end()
})

await new Promise<void>((ok) => db.listen(0, '127.0.0.1', ok))
await new Promise<void>((ok) => iaServer.listen(0, '127.0.0.1', ok))
await new Promise<void>((ok) => gw.listen(0, '127.0.0.1', ok))
process.env.WA_GATEWAY_URL = `http://127.0.0.1:${(gw.address() as AddressInfo).port}`
process.env.WA_GATEWAY_API_KEY = 'falsa'
process.env.WA_SESSAO = 'teste'
process.env.SUPABASE_URL = `http://127.0.0.1:${(db.address() as AddressInfo).port}`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'falsa'
process.env.OPENAI_API_KEY = 'falsa'
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(iaServer.address() as AddressInfo).port}`
process.env.PAINEL_URL = 'https://granninha.amplasoft.me/painel'
delete process.env.WA_SOMENTE_NUMEROS

export const { processar, hojeSP } = await import('../src/granninha.ts')
export const { somaDias } = await import('../src/consultas.ts')

/* ---------------- cenário ---------------- */

export const NUM = '5581988887777'
export const U1 = 'u-1'
export const U2 = 'u-2'
export const HOJE = hojeSP()

export function semear() {
  E.tabelas = {}
  E.falharTabela = null
  E.falharSelect = null
  E.storage = []
  ia.regras = []
  ia.chamadas = { interpretacao: 0, resposta: 0, transcricao: 0, documento: 0 }
  ia.ultimoResumo = null
  ia.ultimoSistema = ''
  ia.queda = false
  ia.erro = null
  ia.pedidos = 0
  ia.transcricao = 'paguei 50 de gasolina'
  ia.documento = { tipo: 'comprovante', meio: 'pix', vencimento: null, resumo: 'Comprovante de R$ 50', transacoes: [{ descricao: 'Gasolina', valor: 50, movimento: 'saida', data: null }] }
  const cats = (u: string) => [
    { user_id: u, id: 'outras-saidas', nome: 'Outros gastos', tipo: 'saida', pessoal: false },
    { user_id: u, id: 'outras-entradas', nome: 'Outras entradas', tipo: 'entrada', pessoal: false },
    { user_id: u, id: 'material', nome: 'Material', tipo: 'saida', pessoal: false },
    { user_id: u, id: 'vendas', nome: 'Vendas', tipo: 'entrada', pessoal: false },
  ]
  E.tabelas.perfis = [
    { id: U1, nome: 'Arthur Teste', negocio: 'Loja', ramo: 'servicos', whats_chave: '8188887777', whats_verificado: true, exclusao_em: null },
    { id: U2, nome: 'Outra Pessoa', negocio: 'Outra', ramo: 'servicos', whats_chave: '8155554444', whats_verificado: true, exclusao_em: null },
  ]
  E.tabelas.assinaturas = [U1, U2].map((u) => ({ user_id: u, status: 'ativa', trial_fim: '2099-12-31' }))
  E.tabelas.categorias = [...cats(U1), ...cats(U2)]
  E.tabelas.carteiras = [
    { user_id: U1, id: 'nubank', nome: 'Nubank', tipo: 'banco', saldo_inicial: 1000, padrao: true, fechamento: null, vencimento: null, conta_pagamento_id: null },
    { user_id: U1, id: 'dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', saldo_inicial: 50, padrao: false, fechamento: null, vencimento: null, conta_pagamento_id: null },
    { user_id: U1, id: 'cartao', nome: 'Cartão Inter', tipo: 'cartao', saldo_inicial: 0, padrao: false, fechamento: 3, vencimento: 10, conta_pagamento_id: 'nubank' },
    // Outro cliente com muito dinheiro: o saldo do U1 nunca pode enxergar isto.
    { user_id: U2, id: 'nubank', nome: 'Nubank', tipo: 'banco', saldo_inicial: 99999, padrao: true, fechamento: null, vencimento: null, conta_pagamento_id: null },
  ]
  E.tabelas.lancamentos = [{ user_id: U2, id: 'x', tipo: 'entrada', valor: 5000, data: HOJE, carteira_id: 'nubank', descricao: 'do outro', pessoal: false }]
  E.tabelas.fixas = [{ user_id: U1, id: 'f1', descricao: 'Aluguel', valor: 900, dia: 10 }, { user_id: U1, id: 'f2', descricao: 'Internet', valor: 100, dia: 20 }]
  E.tabelas.contas = [
    { user_id: U1, id: 'c1', tipo: 'pagar', descricao: 'Luz', valor: 150, vencimento: somaDias(HOJE, 2), status: 'aberta' },
    { user_id: U1, id: 'c2', tipo: 'receber', descricao: 'Joana', valor: 300, vencimento: somaDias(HOJE, 1), status: 'aberta' },
    { user_id: U1, id: 'c3', tipo: 'pagar', descricao: 'Boleto velho', valor: 70, vencimento: somaDias(HOJE, -3), status: 'aberta' },
  ]
}

let seq = 0
/** Como `msg`, mas devolve também o status (para provar o silêncio: status "ignorada" e resposta vazia). */
export const msgCompleta = async (texto: string) => {
  const r = await processar({
    event: 'message.received',
    data: { key: { id: `S${Date.now()}${++seq}`, remoteJid: `${NUM}@s.whatsapp.net`, fromMe: false }, from: `${NUM}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: texto },
  } as Parameters<typeof processar>[0])
  return { resposta: r.resposta ?? '', status: r.status }
}
export const msg = async (texto: string) => (await msgCompleta(texto)).resposta

const evMidia = (tipo: 'AUDIO' | 'IMAGE', arquivo: string, caption = '') => ({
  event: 'message.received',
  data: { key: { id: `M${Date.now()}${++seq}`, remoteJid: `${NUM}@s.whatsapp.net`, fromMe: false }, from: `${NUM}@s.whatsapp.net`, isGroup: false, chatType: 'PERSONAL', type: tipo, fileUrl: `/api/media/${arquivo}`, caption },
})
/** Áudio: o conteúdo vem de `ia.transcricao`. */
export const msgAudio = async (arquivo = 'a1.ogg') => {
  const r = await processar(evMidia('AUDIO', arquivo) as Parameters<typeof processar>[0])
  return { resposta: r.resposta ?? '', status: r.status }
}
/** Foto de comprovante: o conteúdo vem de `ia.documento`. */
export const msgFoto = async (arquivo = 'f1.jpg', caption = '') => {
  const r = await processar(evMidia('IMAGE', arquivo, caption) as Parameters<typeof processar>[0])
  return { resposta: r.resposta ?? '', status: r.status }
}
export const lancsU1 = () => E.tabelas.lancamentos.filter((l) => l.user_id === U1)
export const saldoNoBanco = (carteira: string) => {
  const c = E.tabelas.carteiras.find((x) => x.user_id === U1 && x.id === carteira)!
  let s = Number(c.saldo_inicial)
  for (const l of lancsU1()) {
    if (l.carteira_id === carteira) s += l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor)
    if (l.carteira_destino_id === carteira) s += Number(l.valor)
  }
  return Math.round(s * 100) / 100
}

let n = 0
let falhas = 0
export async function caso(nome: string, fn: () => Promise<void>) {
  semear()
  try {
    await fn()
    n++
    console.log('  ok   ', nome)
  } catch (e) {
    falhas++
    console.log('  FALHA', nome, '->', (e as Error).message.slice(0, 500))
  }
}


export function fim() {
  db.close()
  iaServer.close()
  console.log(falhas ? `\n${falhas} falha(s) de ${n + falhas}` : `\n${n} casos ok`)
  process.exit(falhas ? 1 : 0)
}
