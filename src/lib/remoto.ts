/**
 * Ponte entre o estado do painel e o banco.
 * carregar(): lê tudo do cliente logado. enviar(): compara o estado de antes com o de depois
 * e grava só o que mudou. As telas não sabem que o banco existe.
 */
import { hoje } from './format'
import { categoriasPadrao, VERSAO } from './seed'
import { supabase } from './supabase'
import type { Carteira, Categoria, Conta, Estado, Fixa, Lancamento, StatusAssinatura } from './tipos'

type Linha = Record<string, unknown>

const paraCarteira = (c: Carteira): Linha => ({
  id: c.id, nome: c.nome, tipo: c.tipo, saldo_inicial: c.saldoInicial, padrao: c.padrao,
  fechamento: c.tipo === 'cartao' ? c.fechamento ?? null : null, vencimento: c.tipo === 'cartao' ? c.vencimento ?? null : null,
  conta_pagamento_id: c.tipo === 'cartao' ? c.contaPagamentoId ?? null : null, limite: c.tipo === 'cartao' ? c.limite ?? null : null,
})
const deCarteira = (r: Linha): Carteira => ({
  id: r.id as string, nome: r.nome as string, tipo: r.tipo as Carteira['tipo'], saldoInicial: Number(r.saldo_inicial), padrao: !!r.padrao,
  fechamento: r.fechamento != null ? Number(r.fechamento) : undefined, vencimento: r.vencimento != null ? Number(r.vencimento) : undefined,
  contaPagamentoId: (r.conta_pagamento_id as string) ?? undefined, limite: r.limite != null ? Number(r.limite) : undefined,
})

const paraCategoria = (c: Categoria): Linha => ({ id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor, natureza: c.natureza ?? null, pessoal: !!c.pessoal })
const deCategoria = (r: Linha): Categoria => ({ id: r.id as string, nome: r.nome as string, tipo: r.tipo as Categoria['tipo'], cor: r.cor as string, natureza: (r.natureza as Categoria['natureza']) ?? undefined, pessoal: r.pessoal ? true : undefined })

// anexo_path fica de fora de propósito: quem anexa comprovante é o servidor, e o painel não pode apagar o caminho.
const paraLancamento = (l: Lancamento): Linha => ({
  id: l.id, tipo: l.tipo, valor: l.valor, descricao: l.descricao, categoria_id: l.categoriaId ?? null, carteira_id: l.carteiraId,
  carteira_destino_id: l.carteiraDestinoId ?? null, data: l.data, hora: l.hora, origem: l.origem, pessoal: !!l.pessoal,
  fatura: l.fatura ?? null, parcela_n: l.parcela?.n ?? null, parcela_total: l.parcela?.total ?? null,
})
const deLancamento = (r: Linha): Lancamento => ({
  id: r.id as string, tipo: r.tipo as Lancamento['tipo'], valor: Number(r.valor), descricao: r.descricao as string,
  categoriaId: (r.categoria_id as string) ?? undefined, carteiraId: r.carteira_id as string, carteiraDestinoId: (r.carteira_destino_id as string) ?? undefined,
  data: r.data as string, hora: r.hora as string, origem: r.origem as Lancamento['origem'], anexo: r.anexo_path ? true : undefined,
  anexoPath: (r.anexo_path as string) ?? undefined, pessoal: r.pessoal ? true : undefined, fatura: (r.fatura as string) ?? undefined,
  parcela: r.parcela_n && r.parcela_total ? { n: Number(r.parcela_n), total: Number(r.parcela_total) } : undefined,
})

const paraFixa = (f: Fixa): Linha => ({ id: f.id, descricao: f.descricao, valor: f.valor, dia: f.dia, categoria_id: f.categoriaId ?? null, das: !!f.das })
const deFixa = (r: Linha): Fixa => ({ id: r.id as string, descricao: r.descricao as string, valor: Number(r.valor), dia: Number(r.dia), categoriaId: (r.categoria_id as string) ?? undefined, das: r.das ? true : undefined })

const paraConta = (c: Conta): Linha => ({
  id: c.id, tipo: c.tipo, descricao: c.descricao, valor: c.valor, vencimento: c.vencimento, status: c.status, categoria_id: c.categoriaId ?? null,
  fixa_id: c.fixaId ?? null, parcela_n: c.parcela?.n ?? null, parcela_total: c.parcela?.total ?? null, das: !!c.das, pago_em: c.pagoEm ?? null, lancamento_id: c.lancId ?? null,
})
const deConta = (r: Linha): Conta => ({
  id: r.id as string, tipo: r.tipo as Conta['tipo'], descricao: r.descricao as string, valor: Number(r.valor), vencimento: r.vencimento as string,
  status: r.status as Conta['status'], categoriaId: (r.categoria_id as string) ?? undefined, fixaId: (r.fixa_id as string) ?? undefined,
  parcela: r.parcela_n && r.parcela_total ? { n: Number(r.parcela_n), total: Number(r.parcela_total) } : undefined,
  das: r.das ? true : undefined, pagoEm: (r.pago_em as string) ?? undefined, lancId: (r.lancamento_id as string) ?? undefined,
})

function perfilDe(s: Estado): Linha {
  return {
    nome: s.usuario.nome, negocio: s.usuario.negocio, cnpj: s.usuario.cnpj, whats: s.usuario.whats, ramo: s.usuario.ramo,
    onboarding_feito: s.sessao.onboarding, onboarding_passo: s.sessao.passo,
    resumo_dia: s.prefs.resumoDia, resumo_hora: s.prefs.resumoHora, lembrete_hora: s.prefs.lembreteHora, antecedencia: s.prefs.antecedencia, ocultar: s.prefs.ocultar,
    contador_nome: s.contador.nome, contador_email: s.contador.email, contador_whats: s.contador.whats, contador_auto: s.contador.auto,
    exclusao_em: s.exclusaoEm ?? null,
  }
}

function erro(e: { message: string } | null) {
  if (e) throw new Error(e.message)
}

/** Lê uma tabela inteira do cliente, de mil em mil linhas (o servidor limita cada resposta). */
async function tudo(tabela: string, ordem?: string): Promise<Linha[]> {
  const sb = supabase!
  const r: Linha[] = []
  for (let de = 0; ; de += 1000) {
    let q = sb.from(tabela).select('*').range(de, de + 999)
    q = ordem ? q.order(ordem, { ascending: false }).order('id') : q.order('id')
    const { data, error } = await q
    erro(error)
    r.push(...((data as Linha[]) ?? []))
    if (!data || data.length < 1000) return r
  }
}

export async function carregar(email: string): Promise<Estado> {
  const sb = supabase!
  const [perfil, assin, faturas, carteiras, categorias, lancs, fixas, contas] = await Promise.all([
    sb.from('perfis').select('*').maybeSingle(),
    sb.from('assinaturas').select('*').maybeSingle(),
    sb.from('faturas').select('*').order('data', { ascending: false }),
    tudo('carteiras'),
    tudo('categorias'),
    tudo('lancamentos', 'data'),
    tudo('fixas'),
    tudo('contas'),
  ])
  erro(perfil.error)
  erro(assin.error)
  erro(faturas.error)
  const p = (perfil.data ?? {}) as Linha
  const a = (assin.data ?? {}) as Linha
  const h = hoje()
  let status = ((a.status as StatusAssinatura) ?? 'trial') as StatusAssinatura
  // Teste grátis vencido sem pagamento vale como bloqueio (o banco aplica a mesma regra).
  if (status === 'trial' && typeof a.trial_fim === 'string' && a.trial_fim < h) status = 'bloqueada'
  const ramo = (p.ramo as string) ?? ''
  return {
    versao: VERSAO,
    sessao: { logado: true, onboarding: !!p.onboarding_feito, demo: false, passo: Number(p.onboarding_passo ?? 0) },
    usuario: { nome: (p.nome as string) ?? '', email, negocio: (p.negocio as string) ?? '', cnpj: (p.cnpj as string) ?? '', whats: (p.whats as string) ?? '', ramo, verificado: !!p.whats_verificado, foto: (p.foto_path as string) ?? undefined },
    carteiras: carteiras.map(deCarteira),
    categorias: categorias.length ? categorias.map(deCategoria) : categoriasPadrao(ramo || 'outro'),
    lancamentos: lancs.map(deLancamento).sort((x, y) => (x.data + x.hora < y.data + y.hora ? 1 : -1)),
    contas: contas.map(deConta),
    fixas: fixas.map(deFixa),
    prefs: {
      resumoDia: Number(p.resumo_dia ?? 1), resumoHora: (p.resumo_hora as string) ?? '08:00', lembreteHora: (p.lembrete_hora as string) ?? '09:00',
      antecedencia: Number(p.antecedencia ?? 1), ocultar: !!p.ocultar,
    },
    contador: { nome: (p.contador_nome as string) ?? '', email: (p.contador_email as string) ?? '', whats: (p.contador_whats as string) ?? '', auto: !!p.contador_auto },
    assinatura: {
      status, plano: ((a.plano as 'mensal' | 'anual') ?? 'mensal'), trialFim: (a.trial_fim as string) ?? h, proxCobranca: (a.prox_cobranca as string) ?? h,
      faturas: ((faturas.data as Linha[]) ?? []).map((f) => ({ id: f.id as string, data: f.data as string, valor: Number(f.valor), status: f.status as 'paga' | 'aberta' })),
    },
    exclusaoEm: (p.exclusao_em as string) ?? undefined,
  }
}

async function gravaLista<T extends { id: string }>(tabela: string, antes: T[], depois: T[], para: (x: T) => Linha) {
  if (antes === depois) return
  const sb = supabase!
  const mapaAntes = new Map(antes.map((x) => [x.id, x]))
  const idsDepois = new Set(depois.map((x) => x.id))
  const mudou = depois.filter((x) => mapaAntes.get(x.id) !== x).map(para)
  const sumiu = antes.filter((x) => !idsDepois.has(x.id)).map((x) => x.id)
  for (let i = 0; i < mudou.length; i += 400) erro((await sb.from(tabela).upsert(mudou.slice(i, i + 400), { onConflict: 'user_id,id' })).error)
  for (let i = 0; i < sumiu.length; i += 200) erro((await sb.from(tabela).delete().in('id', sumiu.slice(i, i + 200))).error)
}

/** Grava no banco a diferença entre dois estados. Lança erro se algo for recusado. */
export async function enviar(antes: Estado, depois: Estado, userId: string) {
  const sb = supabase!
  if (antes.usuario !== depois.usuario || antes.prefs !== depois.prefs || antes.contador !== depois.contador || antes.sessao !== depois.sessao || antes.exclusaoEm !== depois.exclusaoEm) {
    const a = perfilDe(antes)
    const d = perfilDe(depois)
    const muda: Linha = {}
    for (const k of Object.keys(d)) if (a[k] !== d[k]) muda[k] = d[k]
    if (Object.keys(muda).length) erro((await sb.from('perfis').update(muda).eq('id', userId)).error)
  }
  // Carteiras e categorias antes: lançamentos e contas apontam para elas.
  await gravaLista('carteiras', antes.carteiras, depois.carteiras, paraCarteira)
  await gravaLista('categorias', antes.categorias, depois.categorias, paraCategoria)
  await gravaLista('fixas', antes.fixas, depois.fixas, paraFixa)
  await gravaLista('lancamentos', antes.lancamentos, depois.lancamentos, paraLancamento)
  await gravaLista('contas', antes.contas, depois.contas, paraConta)
}

/** Sobe a foto de perfil para a pasta privada do cliente (avatares/<user_id>/...) e grava o caminho no perfil. */
export async function enviarFoto(foto: Blob, anterior?: string): Promise<string> {
  const sb = supabase!
  const { data, error: e1 } = await sb.auth.getUser()
  erro(e1)
  const id = data.user!.id
  const path = `${id}/foto-${Date.now()}.jpg`
  erro((await sb.storage.from('avatares').upload(path, foto, { contentType: 'image/jpeg', upsert: true })).error)
  erro((await sb.from('perfis').update({ foto_path: path }).eq('id', id)).error)
  // A foto antiga sai da pasta (falhar aqui não atrapalha: a nova já está no perfil).
  if (anterior && anterior.startsWith(id + '/')) await sb.storage.from('avatares').remove([anterior])
  return path
}

/** Tira a foto de perfil. */
export async function removerFoto(anterior?: string) {
  const sb = supabase!
  const { data, error: e1 } = await sb.auth.getUser()
  erro(e1)
  const id = data.user!.id
  erro((await sb.from('perfis').update({ foto_path: null }).eq('id', id)).error)
  if (anterior && anterior.startsWith(id + '/')) await sb.storage.from('avatares').remove([anterior])
}

/** Endereço temporário (1 hora) para mostrar a foto de perfil, que fica em pasta privada. */
export async function linkFoto(path: string): Promise<string | null> {
  const { data, error } = await supabase!.storage.from('avatares').createSignedUrl(path, 3600)
  return error ? null : data.signedUrl
}

/** Endereço temporário (10 minutos) para abrir um comprovante guardado. */
export async function linkComprovante(path: string): Promise<string | null> {
  const { data, error } = await supabase!.storage.from('comprovantes').createSignedUrl(path, 600)
  return error ? null : data.signedUrl
}
