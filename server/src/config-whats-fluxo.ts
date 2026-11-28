/**
 * O que a configuração pela conversa (config-whats.ts) lê e grava no banco, e como ela entra no fluxo das mensagens (granninha.ts).
 *
 * ATENÇÃO: usa a service_role, que ignora as regras de acesso. Toda consulta filtra pelo id do cliente.
 *
 * Compatível nos dois sentidos com a migration `configwhats`: sem as colunas `onboarding_via` e `config_whats`, nada disto roda (a conta segue o
 * caminho de sempre) e o servidor não para. A chave ONBOARDING_WHATS (off por padrão) desliga tudo de uma vez.
 */
import { randomUUID } from 'node:crypto'
import { falhou, sb } from './banco.ts'
import {
  abandonou, bancoConhecido, boasVindas, categoriasPadrao, DAS, ehEspecie, ehNao, ehPronto, ehPular, ehSim, fechamentoDe, lerBanco, lerCartao, lerOcupacao, lerRamo, lerReserva, lerValor,
  MATERIAL_POR_RAMO, MAX_BANCOS, MAX_CARTOES, MAX_VOLTAS, MAIS_FIXA, naConta, nomeDoBanco, pareceDuvida, pareceLancamento, pergunta, sugerirBanco, TEXTO_FIM, valorNaFrase,
  type Etapa, type EstadoConfig,
} from './config-whats.ts'
import { entenderResposta, type Entendido } from './config-entender.ts'
import { quantosBancos } from './cruzar.ts'
import type { Uso } from './openai.ts'
import { somaMeses, vencimentoNoMes } from './datas.ts'
import { despedidaDe } from './despedida.ts'

export const ligado = () => (process.env.ONBOARDING_WHATS ?? 'off').trim().toLowerCase() === 'on'

const id = (p: string) => `${p}-w${randomUUID().replace(/-/g, '').slice(0, 14)}`
const agoraIso = () => new Date().toISOString()

/* ---------------- coluna ainda não existe (migration não rodou) ---------------- */

let semColunaDesde = 0
const semColuna = () => semColunaDesde > 0 && Date.now() - semColunaDesde < 10 * 60_000
/** Para os testes: esquece que a coluna faltou (em produção a lembrança dura 10 minutos, para não consultar a cada mensagem sem a migration). */
export const esquecerColunaFaltando = () => {
  semColunaDesde = 0
}
const colunaFaltando = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /config_whats|onboarding_via/.test(e.message ?? ''))

/** A conta veio pelo cadastro novo? (`perfis.onboarding_via = 'whats'`). Sem a coluna ou com a chave desligada: não. */
export async function veioPeloWhats(userId: string): Promise<boolean> {
  if (!ligado() || semColuna()) return false
  const { data, error } = await sb.from('perfis').select('onboarding_via').eq('id', userId).maybeSingle()
  if (colunaFaltando(error)) {
    semColunaDesde = Date.now()
    return false
  }
  if (error) {
    console.error('[config] não li onboarding_via:', error.message)
    return false
  }
  return (data as { onboarding_via?: string | null } | null)?.onboarding_via === 'whats'
}

/** A configuração em andamento desta conta, ou null (não começou, terminou, chave desligada, sem coluna). Abandonada há 7 dias: encerra. */
export async function configAtiva(userId: string): Promise<EstadoConfig | null> {
  if (!ligado() || semColuna()) return null
  const { data, error } = await sb.from('perfis').select('config_whats').eq('id', userId).maybeSingle()
  if (colunaFaltando(error)) {
    semColunaDesde = Date.now()
    return null
  }
  if (error) {
    console.error('[config] não li config_whats:', error.message)
    return null
  }
  const e = (data as { config_whats?: EstadoConfig | null } | null)?.config_whats
  if (!e || typeof e !== 'object' || !e.etapa || e.etapa === 'fim') return null
  if (abandonou(e, Date.now())) {
    await gravar(userId, { ...e, etapa: 'fim', em: agoraIso() })
    return null
  }
  return e
}

async function gravar(userId: string, e: EstadoConfig) {
  const r = await sb.from('perfis').update({ config_whats: e }).eq('id', userId)
  falhou(r.error, 'gravar configuração')
}

/* ---------------- começo: depois de confirmar o número ---------------- */

/**
 * As linhas das categorias padrão, iguais às que o painel grava (`paraCategoria` em src/lib/remoto.ts): TODA linha com `natureza` e `pessoal`.
 * Num insert em lote o PostgREST usa a união das colunas e põe NULL onde a linha não tem a chave; sem isto, `pessoal` (not null) ia nulo em todas
 * menos "Retirada do dono" e a configuração pela conversa não começava (achado pelo simulador em 2026-11-28).
 */
export const linhasCategoriasPadrao = (userId: string, ramo = 'outro') =>
  categoriasPadrao(ramo).map((c) => ({ user_id: userId, id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor, natureza: (c as { natureza?: string }).natureza ?? null, pessoal: !!(c as { pessoal?: boolean }).pessoal }))

/** A conta de banco principal que o painel cria no cadastro (`salvarMinimo` em src/pages/Onboarding.tsx). */
export const linhaContaPadrao = (userId: string) => ({ user_id: userId, id: 'banco', nome: 'Conta do banco', tipo: 'banco', saldo_inicial: 0, padrao: true })

/**
 * Garante o mínimo para a conta funcionar (uma conta de banco principal e as categorias), caso o site não tenha gravado, e começa a conversa.
 * Devolve a mensagem de boas-vindas com a primeira pergunta.
 */
export async function iniciar(userId: string, nome: string): Promise<string> {
  const cs = await sb.from('carteiras').select('id').eq('user_id', userId).limit(1)
  falhou(cs.error, 'config: carteiras')
  if (!cs.data?.length) {
    const r = await sb.from('carteiras').insert(linhaContaPadrao(userId))
    falhou(r.error, 'config: conta padrão')
  }
  const cat = await sb.from('categorias').select('id').eq('user_id', userId).limit(1)
  falhou(cat.error, 'config: categorias')
  if (!cat.data?.length) {
    const r = await sb.from('categorias').insert(linhasCategoriasPadrao(userId))
    falhou(r.error, 'config: categorias padrão')
  }
  const agora = agoraIso()
  await gravar(userId, { etapa: 'ramo', em: agora, inicio: agora, voltas: 0, bancos: 0, cartoes: 0, saldoFixado: {} })
  return boasVindas(nome)
}

/* ---------------- respostas ---------------- */

export interface RespostaConfig {
  /** A mensagem foi resposta da configuração (nada mais a fazer com ela). */
  tratou: boolean
  resposta: string
  /** Consumo da IA da configuração, quando ela foi chamada (entra no custo da mensagem, tratada ou não). */
  uso?: Uso | null
}
const NAO_TRATOU: RespostaConfig = { tratou: false, resposta: '' }
const naoTratou = (uso: Uso | null | undefined): RespostaConfig => ({ tratou: false, resposta: '', uso: uso ?? null })

async function bancosDe(userId: string) {
  const r = await sb.from('carteiras').select('id,nome,tipo,padrao').eq('user_id', userId)
  falhou(r.error, 'config: contas')
  return (r.data ?? []) as { id: string; nome: string; tipo: string; padrao: boolean }[]
}

type TipoCarteira = 'banco' | 'dinheiro' | 'investimento'

/** Põe o nome do banco: renomeia a "Conta do banco" que nasceu no cadastro; se ela já tem nome, cria outra conta. Devolve id e nome. */
async function porBanco(userId: string, nome: string, tipo: TipoCarteira): Promise<{ id: string; nome: string }> {
  const cs = await bancosDe(userId)
  const iguais = cs.find((c) => c.tipo === tipo && c.nome.trim().toLowerCase() === nome.trim().toLowerCase())
  if (iguais) return iguais
  const generica = tipo === 'banco' ? cs.find((c) => c.tipo === 'banco' && c.nome === 'Conta do banco') : undefined
  if (generica) {
    falhou((await sb.from('carteiras').update({ nome }).eq('user_id', userId).eq('id', generica.id)).error, 'config: nome do banco')
    return { id: generica.id, nome }
  }
  // Dinheiro guardado (caixinha, poupança) nunca é a conta principal: o dia a dia sai do banco ou da espécie.
  const novo = { user_id: userId, id: id(tipo === 'banco' ? 'b' : tipo === 'dinheiro' ? 'd' : 'r'), nome, tipo, saldo_inicial: 0, padrao: tipo !== 'investimento' && !cs.some((c) => c.padrao) }
  falhou((await sb.from('carteiras').insert(novo)).error, 'config: conta nova')
  return { id: novo.id, nome }
}

/** Põe o saldo de hoje numa conta, se ela ainda não tem lançamento. Devolve se pôs. */
async function porSaldo(userId: string, carteira: string, valor: number): Promise<boolean> {
  const [a, b] = await Promise.all([
    sb.from('lancamentos').select('id').eq('user_id', userId).eq('carteira_id', carteira).limit(1),
    sb.from('lancamentos').select('id').eq('user_id', userId).eq('carteira_destino_id', carteira).limit(1),
  ])
  falhou(a.error ?? b.error, 'config: lançamentos da conta')
  if (a.data?.length || b.data?.length) return false
  falhou((await sb.from('carteiras').update({ saldo_inicial: Math.round(valor * 100) / 100 }).eq('user_id', userId).eq('id', carteira)).error, 'config: saldo')
  return true
}

const real = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Avança para a etapa seguinte, grava, e devolve a pergunta dela (ou a mensagem final). */
async function irPara(userId: string, e: EstadoConfig, etapa: Etapa, extra: Partial<EstadoConfig> = {}, nomeConta?: string): Promise<string> {
  const novo: EstadoConfig = { ...e, ...extra, etapa, em: agoraIso(), voltas: 0 }
  if (etapa === 'fim') {
    await gravar(userId, novo)
    falhou((await sb.from('perfis').update({ onboarding_feito: true, onboarding_passo: 7 }).eq('id', userId)).error, 'config: concluir')
    return TEXTO_FIM
  }
  await gravar(userId, novo)
  return pergunta(novo, nomeConta)
}

const juntar = (...p: string[]) => p.filter(Boolean).join('\n\n')
const LIMPO: Partial<EstadoConfig> = { bancoNome: undefined, voltaPara: undefined, sugestao: undefined, saldoDito: undefined }

/** "Sou videomaker", "trabalho com fotografia": a ocupação sem o "sou". */
const semSou = (t: string) => t.trim().replace(/^(eu\s+)?(sou|trabalho com|trabalho de|trabalho como|faço|mexo com|atuo como)\s+(um|uma)?\s*/i, '')

/** As contas que a configuração conhece, para a IA não perguntar de novo o que já foi dito. */
async function nomesDasContas(userId: string) {
  return (await bancosDe(userId)).filter((c) => c.tipo !== 'cartao' && c.nome !== 'Conta do banco').map((c) => c.nome)
}

/** A IA entende a resposta que o código não leu. Só para o que pode ser resposta: lançamento e dúvida vão para a conversa normal sem gastar IA. */
async function entender(userId: string, e: EstadoConfig, t: string): Promise<{ d: Entendido | null; uso: Uso | null; tentou: boolean }> {
  if (pareceLancamento(t) || pareceDuvida(t) || t.length > 300) return { d: null, uso: null, tentou: false }
  const r = await entenderResposta(e.etapa, t, await nomesDasContas(userId))
  return { d: r.dados, uso: r.uso, tentou: true }
}

/** Grava o ramo (e a ocupação) e troca o nome da categoria de material pelo do ramo. */
async function porRamo(userId: string, ramo: string | null, ocupacao: string | null) {
  const muda: Record<string, string> = {}
  if (ramo) muda.ramo = ramo
  if (ocupacao) muda.ocupacao = ocupacao
  if (Object.keys(muda).length) falhou((await sb.from('perfis').update(muda).eq('id', userId)).error, 'config: ramo')
  if (ramo) falhou((await sb.from('categorias').update({ nome: MATERIAL_POR_RAMO[ramo] ?? 'Material' }).eq('user_id', userId).eq('id', 'material')).error, 'config: categoria do ramo')
}

/** Depois do ramo: "Boa, videomaker! Anotado." e a pergunta do banco. */
async function depoisDoRamo(userId: string, e: EstadoConfig, ocupacao: string | null): Promise<string> {
  return juntar(ocupacao ? `Boa, ${ocupacao}! Anotado.` : 'Anotado!', await irPara(userId, e, 'banco'))
}

interface ContaDita {
  tipo: TipoCarteira
  nome: string
  saldo: number | null
}

/** "Caixinha" sem o banco, e a pessoa tem um banco só com nome: é a caixinha dele ("Caixinha Nubank"). */
function nomeDaReserva(base: string, cs: { nome: string; tipo: string }[]): string {
  if (base.includes(' ')) return base
  const bancos = cs.filter((c) => c.tipo === 'banco' && c.nome !== 'Conta do banco')
  return bancos.length === 1 ? `${base} ${bancos[0].nome}` : base
}

/**
 * Cria as contas ditas (banco, dinheiro, caixinha), põe o saldo de quem veio com valor e pergunta o saldo de quem veio sem, uma de cada vez.
 * Conta que já existe com saldo posto aqui não é perguntada de novo ("eu já disse que no Nubank tinha 450").
 */
async function registrarContas(userId: string, e: EstadoConfig, ditas: ContaDita[]): Promise<string> {
  const notas: string[] = []
  const pendentes = [...(e.pendentes ?? [])]
  const saldoFixado = { ...(e.saldoFixado ?? {}) }
  let bancos = e.bancos ?? 0
  const nomes = new Map<string, string>()
  for (const d of ditas) {
    const c = await porBanco(userId, d.nome, d.tipo)
    nomes.set(c.id, c.nome)
    bancos++
    const ja = saldoFixado[c.id]
    if (typeof ja === 'number') {
      notas.push(`${maiuscula(naConta(c.nome))} já tá anotado: ${real(ja)}.`)
    } else if (d.saldo !== null) {
      const pos = await porSaldo(userId, c.id, d.saldo)
      if (pos) saldoFixado[c.id] = d.saldo
      notas.push(pos ? `Anotei ${real(d.saldo)} ${naConta(c.nome)}.` : `${maiuscula(naConta(c.nome))} já tem lançamento, então não mexi no saldo.`)
    } else if (!pendentes.includes(c.id)) pendentes.push(c.id)
  }
  const base: Partial<EstadoConfig> = { ...LIMPO, saldoFixado, bancos }
  if (pendentes.length) {
    const [prox, ...resto] = pendentes
    const nome = nomes.get(prox) ?? (await bancosDe(userId)).find((c) => c.id === prox)?.nome
    return juntar(...notas, await irPara(userId, e, 'saldo', { ...base, carteira: prox, pendentes: resto }, nome))
  }
  return juntar(...notas, await irPara(userId, e, bancos >= MAX_BANCOS ? 'cartao' : 'mais_banco', { ...base, carteira: undefined, pendentes: undefined }))
}

/** Confirma um nome antes de virar conta: o banco escrito errado ("Você quis dizer Nubank?") ou o nome que não é de banco conhecido. */
async function confirmarBanco(userId: string, e: EstadoConfig, nome: string, sugestao: boolean, saldo: number | null): Promise<string> {
  const volta = e.etapa === 'banco_confirma' ? (e.voltaPara ?? 'banco') : (e.etapa as 'banco' | 'mais_banco')
  return irPara(userId, e, 'banco_confirma', { bancoNome: nome, voltaPara: volta, sugestao: sugestao || undefined, saldoDito: saldo ?? undefined })
}

/** O que a IA entendeu como contas, já no formato de gravar. Banco com nome corrigido pela IA ("nubak") passa pela confirmação. */
async function contasDaIA(userId: string, e: EstadoConfig, d: Entendido): Promise<{ resposta: string } | null> {
  const cs = await bancosDe(userId)
  const ditas: ContaDita[] = []
  for (const c of d.contas) {
    if (c.tipo === 'dinheiro') ditas.push({ tipo: 'dinheiro', nome: 'Dinheiro', saldo: c.saldo })
    else if (c.tipo === 'reserva') ditas.push({ tipo: 'investimento', nome: nomeDaReserva(lerReserva(c.nome_dito) ?? (c.banco ? `Caixinha ${c.banco}` : 'Caixinha'), cs), saldo: c.saldo })
    else if (c.banco) {
      // A pessoa escreveu diferente do nome certo: confirma antes ("Você quis dizer Nubank?"). Só quando é a única conta da mensagem.
      if (!nomeDoBanco(c.nome_dito) && d.contas.length === 1) return { resposta: await confirmarBanco(userId, e, c.banco, true, c.saldo) }
      ditas.push({ tipo: 'banco', nome: c.banco, saldo: c.saldo })
    } else if (d.contas.length === 1) {
      const nome = lerBanco(c.nome_dito)
      if (!nome) return null
      return { resposta: await confirmarBanco(userId, e, nome, false, c.saldo) }
    }
  }
  if (!ditas.length) return null
  return { resposta: await registrarContas(userId, e, ditas) }
}

/**
 * A mensagem de texto (ou áudio já transcrito) é resposta da pergunta da configuração? Se for, faz o que ela pede e devolve a próxima pergunta.
 * Primeiro o código (número, nome de banco, valor, sim/não); o que ele não lê e pode ser resposta vai para a IA (config-entender.ts). Lançamento e
 * dúvida nunca são resposta: vão para a conversa normal, e a pergunta da configuração volta depois. Na etapa das contas de todo mês, só o "é só
 * isso" é tratado aqui: o resto passa pelo leitor normal ("aluguel 900 dia 10").
 */
export async function responder(userId: string, e: EstadoConfig, texto: string): Promise<RespostaConfig> {
  const t = texto.trim()
  if (!t) return NAO_TRATOU
  const pulou = ehPular(t)
  switch (e.etapa) {
    case 'ramo': {
      if (pulou) return { tratou: true, resposta: await irPara(userId, e, 'banco') }
      const ramo = lerRamo(t)
      if (ramo === 'outro') {
        await porRamo(userId, 'outro', null)
        return { tratou: true, resposta: await irPara(userId, e, 'ocupacao') }
      }
      if (ramo) {
        await porRamo(userId, ramo, null)
        return { tratou: true, resposta: await depoisDoRamo(userId, e, null) }
      }
      if (/^\s*\d{1,2}\s*$/.test(t)) return { tratou: true, resposta: `Não entendi esse número. ${pergunta(e)}` }
      if (despedidaDe(t)) return NAO_TRATOU
      const { d, uso, tentou } = await entender(userId, e, t)
      if (!d) {
        // IA fora: a resposta livre que parece uma profissão ("sou videomaker") é aceita como está. Lançamento e dúvida não.
        const oc = tentou ? lerOcupacao(semSou(t)) : null
        if (!oc) return naoTratou(uso)
        await porRamo(userId, 'outro', oc.toLowerCase())
        return { tratou: true, resposta: await depoisDoRamo(userId, e, oc.toLowerCase()), uso }
      }
      if (!d.eh_resposta) return naoTratou(uso)
      if (d.pular) return { tratou: true, resposta: await irPara(userId, e, 'banco'), uso }
      const oc = d.ocupacao ?? (d.ramo ? null : lerOcupacao(semSou(t))?.toLowerCase() ?? null)
      const r = d.ramo ?? (oc ? 'outro' : null)
      if (!r) return naoTratou(uso)
      await porRamo(userId, r, oc)
      if (r === 'outro' && !oc) return { tratou: true, resposta: await irPara(userId, e, 'ocupacao'), uso }
      return { tratou: true, resposta: await depoisDoRamo(userId, e, oc), uso }
    }
    case 'ocupacao': {
      const oc = pulou ? null : lerOcupacao(semSou(t))
      if (!pulou && (!oc || pareceLancamento(t) || pareceDuvida(t))) return NAO_TRATOU
      if (oc) await porRamo(userId, null, oc.toLowerCase())
      return { tratou: true, resposta: await depoisDoRamo(userId, e, oc ? oc.toLowerCase() : null) }
    }
    case 'banco':
    case 'mais_banco': {
      if (pulou || (e.etapa === 'mais_banco' && ehNao(t))) {
        if (e.etapa === 'banco') return { tratou: true, resposta: juntar('Tudo bem, deixo como "Conta do banco" por enquanto.', await irPara(userId, e, 'saldo', { carteira: undefined }, 'Conta do banco')) }
        return { tratou: true, resposta: await irPara(userId, e, 'cartao') }
      }
      // "ok", "certo", "valeu", "kkk": não é resposta, é reação. Vai para o fluxo normal (que fica em silêncio) e a pergunta volta depois.
      if (despedidaDe(t)) return NAO_TRATOU
      if (ehSim(t)) return { tratou: true, resposta: 'Qual? Me diz o nome do banco, ou se é caixinha ou dinheiro em casa.' }
      if (!pareceLancamento(t)) {
        const valor = valorNaFrase(t)
        const semValor = t.replace(/(?:r\$\s*)?\d[\d.,]*(?:\s*(?:reais|real|conto|contos))?/gi, ' ').replace(/\b(tenho|tem|uns|umas|mais ou menos|la|lá|com|e)\b/gi, ' ').replace(/\s+/g, ' ').trim()
        // A caixinha vem antes do banco: "caixinha do nubank" é dinheiro guardado, não um segundo Nubank.
        const reserva = lerReserva(t)
        if (reserva) return { tratou: true, resposta: await registrarContas(userId, e, [{ tipo: 'investimento', nome: nomeDaReserva(reserva, await bancosDe(userId)), saldo: valor }]) }
        if (ehEspecie(t)) return { tratou: true, resposta: await registrarContas(userId, e, [{ tipo: 'dinheiro', nome: 'Dinheiro', saldo: valor }]) }
        const conhecido = nomeDoBanco(semValor)
        // Um banco só: "nubank e inter" vai para a IA, senão o Inter sumiria sem aviso.
        if (conhecido && semValor.split(' ').length <= 4 && quantosBancos(semValor) === 1) return { tratou: true, resposta: await registrarContas(userId, e, [{ tipo: 'banco', nome: conhecido, saldo: valor }]) }
        const sug = sugerirBanco(semValor)
        if (sug) return { tratou: true, resposta: await confirmarBanco(userId, e, sug, true, valor) }
      }
      const { d, uso } = await entender(userId, e, t)
      if (!d) {
        // IA fora (ou mensagem que não é para ela): o caminho de sempre, nome curto confirma antes de virar conta.
        const nome = pareceLancamento(t) ? null : lerBanco(t)
        if (!nome) return naoTratou(uso)
        if (bancoConhecido(t)) return { tratou: true, resposta: await registrarContas(userId, e, [{ tipo: 'banco', nome, saldo: null }]), uso }
        return { tratou: true, resposta: await confirmarBanco(userId, e, nome, false, null), uso }
      }
      if (!d.eh_resposta) return naoTratou(uso)
      if (d.pular || (e.etapa === 'mais_banco' && d.sim_nao === 'nao' && !d.contas.length)) {
        if (e.etapa === 'banco') return { tratou: true, resposta: juntar('Tudo bem, deixo como "Conta do banco" por enquanto.', await irPara(userId, e, 'saldo', { carteira: undefined }, 'Conta do banco')), uso }
        return { tratou: true, resposta: await irPara(userId, e, 'cartao'), uso }
      }
      if (d.sim_nao === 'sim' && !d.contas.length) return { tratou: true, resposta: 'Qual? Me diz o nome do banco, ou se é caixinha ou dinheiro em casa.', uso }
      const r = await contasDaIA(userId, e, d)
      return r ? { tratou: true, resposta: r.resposta, uso } : naoTratou(uso)
    }
    case 'banco_confirma': {
      const volta = e.voltaPara ?? 'banco'
      const voltar = { ...e, etapa: volta, ...LIMPO } as EstadoConfig
      if (pulou) return { tratou: true, resposta: await irPara(userId, e, volta, LIMPO) }
      if (ehSim(t) && e.bancoNome) return { tratou: true, resposta: await registrarContas(userId, voltar, [{ tipo: 'banco', nome: e.bancoNome, saldo: e.saldoDito ?? null }]) }
      if (despedidaDe(t) || ehNao(t)) {
        if (e.sugestao) {
          await gravar(userId, { ...voltar, em: agoraIso(), voltas: 0 })
          return { tratou: true, resposta: 'Ah, tá. Então me escreve o nome do banco do jeito que aparece no app.' }
        }
        return { tratou: true, resposta: await irPara(userId, e, volta, LIMPO) }
      }
      // Disse outro nome: banco conhecido entra direto; escrito errado ou desconhecido, confirma de novo.
      const valor = valorNaFrase(t) ?? e.saldoDito ?? null
      const conhecido = nomeDoBanco(t)
      if (conhecido) return { tratou: true, resposta: await registrarContas(userId, voltar, [{ tipo: 'banco', nome: conhecido, saldo: valor }]) }
      const sug = sugerirBanco(t)
      if (sug) return { tratou: true, resposta: await confirmarBanco(userId, e, sug, true, valor) }
      const outro = lerBanco(t)
      if (!outro) return NAO_TRATOU
      return { tratou: true, resposta: await confirmarBanco(userId, e, outro, false, valor) }
    }
    case 'saldo': {
      const cs = await bancosDe(userId)
      const conta = cs.find((c) => c.id === e.carteira) ?? cs.find((c) => c.tipo === 'banco' && c.padrao) ?? cs.find((c) => c.tipo === 'banco')
      const seguinte = async (extra: Partial<EstadoConfig>): Promise<string> => {
        const [prox, ...resto] = e.pendentes ?? []
        if (prox) return irPara(userId, e, 'saldo', { ...extra, carteira: prox, pendentes: resto }, cs.find((c) => c.id === prox)?.nome)
        return irPara(userId, e, (e.bancos ?? 0) >= MAX_BANCOS ? 'cartao' : 'mais_banco', { ...extra, carteira: undefined, pendentes: undefined })
      }
      if (pulou) return { tratou: true, resposta: await seguinte({}) }
      let v = lerValor(t) ?? (pareceLancamento(t) ? null : valorNaFrase(t))
      let uso: Uso | null = null
      if (v === null) {
        const r = await entender(userId, e, t)
        uso = r.uso
        if (r.d && r.d.eh_resposta && r.d.pular) return { tratou: true, resposta: await seguinte({}), uso }
        v = r.d?.eh_resposta ? (r.d.valor ?? r.d.contas[0]?.saldo ?? null) : null
      }
      if (v === null || !conta) return naoTratou(uso)
      // O saldo já foi posto pelo extrato (saldo final dele): não muda, e diz qual ficou.
      const jaFixado = e.saldoFixado?.[conta.id]
      if (typeof jaFixado === 'number') {
        const nota = Math.abs(jaFixado - v) < 0.01 ? `Bateu com o extrato: ${real(v)} ${naConta(conta.nome)}.` : `Pelo extrato, ficou ${real(jaFixado)} ${naConta(conta.nome)}, então mantive esse. Se não for isso, dá pra ajustar no painel.`
        return { tratou: true, resposta: juntar(nota, await seguinte({})), uso }
      }
      const pos = await porSaldo(userId, conta.id, v)
      const fixado = pos ? { ...(e.saldoFixado ?? {}), [conta.id]: v } : e.saldoFixado
      const nota = pos ? `Anotei ${real(v)} ${naConta(conta.nome)}.` : `${maiuscula(naConta(conta.nome))} já tem lançamento, então não mexi no saldo. Dá pra ajustar no painel.`
      return { tratou: true, resposta: juntar(nota, await seguinte({ saldoFixado: fixado })), uso }
    }
    case 'cartao':
    case 'cartao_dia': {
      if (pulou || (e.etapa === 'cartao' && ehNao(t))) return { tratou: true, resposta: await irPara(userId, e, 'das', { cartao: undefined }) }
      if (despedidaDe(t)) return NAO_TRATOU
      if (e.etapa === 'cartao' && ehSim(t)) return { tratou: true, resposta: 'Boa! De qual banco é o cartão, e que dia vence a fatura?' }
      let banco: string | null = null
      let dia: number | null = null
      let uso: Uso | null = null
      if (e.etapa === 'cartao_dia') {
        banco = e.cartao ?? null
        const m = /^\s*(?:(?:todo\s+)?dia\s+)?([1-9]|[12]\d|3[01])\s*$/i.exec(t) ?? /\bdia\s+([1-9]|[12]\d|3[01])\b/i.exec(t)
        dia = m ? Number(m[1]) : null
        if (dia === null) return NAO_TRATOU
      } else {
        const l = pareceLancamento(t) ? null : lerCartao(t)
        if (l?.banco) {
          banco = l.banco
          dia = l.dia
        } else {
          const r = await entender(userId, e, t)
          uso = r.uso
          if (!r.d || !r.d.eh_resposta) return naoTratou(uso)
          if (r.d.pular || (r.d.sim_nao === 'nao' && !r.d.cartao_banco)) return { tratou: true, resposta: await irPara(userId, e, 'das', { cartao: undefined }), uso }
          banco = r.d.cartao_banco ? nomeDoBanco(r.d.cartao_banco) ?? lerBanco(r.d.cartao_banco) : null
          dia = r.d.cartao_dia
          if (!banco) return r.d.sim_nao === 'sim' ? { tratou: true, resposta: 'Boa! De qual banco é o cartão, e que dia vence a fatura?', uso } : naoTratou(uso)
        }
        if (dia === null) return { tratou: true, resposta: await irPara(userId, e, 'cartao_dia', { cartao: banco }), uso }
      }
      const cs = await bancosDe(userId)
      const paga = cs.find((c) => c.tipo === 'banco' && c.padrao) ?? cs.find((c) => c.tipo === 'banco')
      const nome = banco!.toLowerCase().startsWith('cartão') ? banco! : `Cartão ${banco}`
      if (!cs.some((c) => c.tipo === 'cartao' && c.nome.toLowerCase() === nome.toLowerCase())) {
        const novo = { user_id: userId, id: id('k'), nome, tipo: 'cartao', saldo_inicial: 0, padrao: false, fechamento: fechamentoDe(dia!), vencimento: dia, conta_pagamento_id: paga?.id ?? null }
        falhou((await sb.from('carteiras').insert(novo)).error, 'config: cartão')
      }
      const cartoes = (e.cartoes ?? 0) + 1
      const nota = `Anotei o ${nome}, com a fatura vencendo todo dia ${dia}.`
      if (cartoes >= MAX_CARTOES) return { tratou: true, resposta: juntar(nota, await irPara(userId, e, 'das', { cartoes, cartao: undefined })), uso }
      await gravar(userId, { ...e, etapa: 'cartao', em: agoraIso(), voltas: 0, cartoes, cartao: undefined })
      return { tratou: true, resposta: juntar(nota, 'Tem outro cartão?'), uso }
    }
    case 'das': {
      let sim = ehSim(t)
      let nao = pulou || ehNao(t)
      let uso: Uso | null = null
      if (!sim && !nao) {
        const r = await entender(userId, e, t)
        uso = r.uso
        if (!r.d || !r.d.eh_resposta) return naoTratou(uso)
        sim = r.d.sim_nao === 'sim'
        nao = r.d.pular || r.d.sim_nao === 'nao'
        if (!sim && !nao) return naoTratou(uso)
      }
      if (nao) return { tratou: true, resposta: await irPara(userId, e, 'fixas'), uso }
      await porDas(userId)
      return { tratou: true, resposta: juntar(`Combinado, te lembro do DAS todo dia ${DAS.dia}.`, await irPara(userId, e, 'fixas')), uso }
    }
    case 'fixas': {
      if (pulou || ehPronto(t)) return { tratou: true, resposta: await irPara(userId, e, 'fim') }
      return NAO_TRATOU
    }
    default:
      return NAO_TRATOU
  }
}

/** O DAS como conta fixa, com as contas dos próximos vencimentos (como o cadastro do site fazia). Não duplica. */
async function porDas(userId: string) {
  const ja = await sb.from('fixas').select('id').eq('user_id', userId).eq('das', true).limit(1)
  falhou(ja.error, 'config: DAS existente')
  if (ja.data?.length) return
  const fid = id('fx')
  falhou((await sb.from('fixas').insert({ user_id: userId, id: fid, descricao: DAS.descricao, valor: DAS.valor, dia: DAS.dia, categoria_id: 'impostos', das: true })).error, 'config: DAS')
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const contas = []
  for (let k = 0; k < 4 && contas.length < 3; k++) {
    const venc = vencimentoNoMes(somaMeses(hoje.slice(0, 7), k), DAS.dia)
    if (venc < hoje) continue
    contas.push({ user_id: userId, id: id('c'), tipo: 'pagar', descricao: DAS.descricao, valor: DAS.valor, vencimento: venc, status: 'aberta', categoria_id: 'impostos', fixa_id: fid, das: true })
  }
  falhou((await sb.from('contas').insert(contas)).error, 'config: contas do DAS')
}

/**
 * Print da tela de saldo durante a configuração (etapas banco, saldo e mais um banco): põe o banco e o saldo de uma vez.
 * Devolve null se a etapa não é de banco (o fluxo normal responde).
 */
export async function responderPrintSaldo(userId: string, e: EstadoConfig, banco: string | null | undefined, saldo: number | null | undefined): Promise<RespostaConfig | null> {
  if (e.etapa !== 'banco' && e.etapa !== 'saldo' && e.etapa !== 'mais_banco') return null
  if (typeof saldo !== 'number') return { tratou: true, resposta: `Vi a tela do banco, mas não deu pra ler o saldo. ${pergunta(e)}` }
  let conta: { id: string; nome: string } | null = null
  const nome = banco ? lerBanco(banco) : null
  if (e.etapa === 'saldo' && e.carteira) {
    const cs = await bancosDe(userId)
    conta = cs.find((c) => c.id === e.carteira) ?? null
  }
  if (!conta) {
    if (!nome) return { tratou: true, resposta: `Vi o saldo de ${real(saldo)}, mas não consegui ler de qual banco é. Me diz o nome do banco, tipo Nubank.` }
    conta = await porBanco(userId, nome, 'banco')
  }
  const pos = await porSaldo(userId, conta.id, saldo)
  const fixado = pos ? { ...(e.saldoFixado ?? {}), [conta.id]: saldo } : e.saldoFixado
  const bancos = e.etapa === 'saldo' ? (e.bancos ?? 1) : (e.bancos ?? 0) + 1
  const seguinte = bancos >= MAX_BANCOS ? 'cartao' : 'mais_banco'
  const nota = pos ? `Li o print: ${conta.nome}, com ${real(saldo)} de saldo. Anotado.` : `Li o print do ${conta.nome}, mas essa conta já tem lançamento, então não mexi no saldo.`
  return { tratou: true, resposta: juntar(nota, await irPara(userId, e, seguinte, { saldoFixado: fixado, bancos, carteira: undefined })) }
}

/**
 * Depois de uma mensagem que NÃO era resposta da configuração: o que dizer a mais.
 * - Nas contas de todo mês, conta fixa nova recebe "mais alguma?" (não conta como pergunta ignorada).
 * - Fora isso, a pergunta da etapa volta no fim, no máximo 2 vezes; depois a etapa é pulada.
 * - Se a mensagem deixou pergunta própria em aberto, ou a fila de perguntas falou, a configuração espera a vez.
 */
export async function depoisDaMensagem(userId: string, lido: EstadoConfig, criouFixa: boolean): Promise<string> {
  // Relê: a mensagem pode ter mudado o estado no meio (extrato importado na configuração põe o saldo e avança a etapa).
  const e = (await configAtiva(userId)) ?? null
  if (!e) return ''
  void lido
  if (e.etapa === 'fixas' && criouFixa) {
    await gravar(userId, { ...e, em: agoraIso(), voltas: 0 })
    return MAIS_FIXA
  }
  const voltas = (e.voltas ?? 0) + 1
  if (voltas > MAX_VOLTAS) {
    const ordem: Etapa[] = ['ramo', 'banco', 'saldo', 'mais_banco', 'cartao', 'das', 'fixas', 'fim']
    const atual = e.etapa === 'ocupacao' ? 'ramo' : e.etapa === 'cartao_dia' ? 'cartao' : e.etapa === 'banco_confirma' ? (e.voltaPara ?? 'banco') : e.etapa
    const prox = ordem[Math.min(ordem.indexOf(atual) + 1, ordem.length - 1)]
    return irPara(userId, e, prox, { carteira: undefined, cartao: undefined })
  }
  await gravar(userId, { ...e, voltas })
  const cs = e.etapa === 'saldo' && e.carteira ? (await bancosDe(userId)).find((c) => c.id === e.carteira) : undefined
  return pergunta(e, cs?.nome)
}

/**
 * O saldo de hoje vindo do extrato: só para conta cujo saldo ainda não foi posto e que não tinha lançamento antes deste extrato. Se a conta é a
 * genérica ("Conta do banco") e o extrato diz o banco, ela ganha o nome dele, e a configuração avança da etapa do banco para "mais algum banco?".
 */
async function saldoPeloExtrato(userId: string, e: EstadoConfig, lancamentos: string[], saldoFinal: number, banco: string | null): Promise<string | null> {
  const r = await sb.from('lancamentos').select('id,tipo,valor,carteira_id').eq('user_id', userId).in('id', lancamentos)
  falhou(r.error, 'config: lançamentos do extrato')
  const linhas = (r.data ?? []) as { id: string; tipo: string; valor: number; carteira_id: string }[]
  const carteira = linhas[0]?.carteira_id
  if (!carteira || linhas.some((l) => l.carteira_id !== carteira) || typeof e.saldoFixado?.[carteira] === 'number') return null
  const outros = await sb.from('lancamentos').select('id').eq('user_id', userId).eq('carteira_id', carteira).not('id', 'in', `(${lancamentos.map((x) => `"${x}"`).join(',')})`).limit(1)
  falhou(outros.error, 'config: lançamentos anteriores')
  if (outros.data?.length) return null
  const liquido = linhas.reduce((s, l) => s + Number(l.valor) * (l.tipo === 'entrada' ? 1 : l.tipo === 'saida' ? -1 : 0), 0)
  const inicial = Math.round((saldoFinal - liquido) * 100) / 100
  falhou((await sb.from('carteiras').update({ saldo_inicial: inicial }).eq('user_id', userId).eq('id', carteira)).error, 'config: saldo pelo extrato')
  const saldoFixado = { ...(e.saldoFixado ?? {}), [carteira]: saldoFinal }
  let extra: Partial<EstadoConfig> = { saldoFixado }
  const nome = banco ? lerBanco(banco) : null
  if (nome && bancoConhecido(banco!)) {
    const cs = await bancosDe(userId)
    const c = cs.find((x) => x.id === carteira)
    if (c && c.nome === 'Conta do banco') falhou((await sb.from('carteiras').update({ nome }).eq('user_id', userId).eq('id', carteira)).error, 'config: nome pelo extrato')
  }
  // Estava esperando o banco ou o saldo desta conta: os dois vieram do extrato, então a configuração segue para "mais algum banco?".
  if (e.etapa === 'banco' || (e.etapa === 'saldo' && (!e.carteira || e.carteira === carteira))) {
    extra = { ...extra, etapa: (e.bancos ?? 0) + 1 >= MAX_BANCOS ? 'cartao' : 'mais_banco', bancos: (e.bancos ?? 0) + (e.etapa === 'banco' ? 1 : 0), carteira: undefined, voltas: 0 }
  }
  await gravar(userId, { ...e, ...extra, em: new Date().toISOString() })
  return carteira
}

/**
 * Extrato importado DURANTE a configuração numa conta cujo saldo foi posto aqui: o saldo já contém o que o extrato trouxe. Sem isto, o histórico
 * somaria em dobro (saldo de hoje + o que entrou e saiu até hoje). O saldo inicial é corrigido pelo líquido importado, e o saldo de hoje fica o lido.
 */
export async function corrigirSaldoImportado(userId: string, e: EstadoConfig | null, lancamentos: string[], extrato: { saldo?: number | null; banco?: string | null } = {}): Promise<void> {
  if (!e || !lancamentos.length) return
  // Extrato ANTES do saldo (a pessoa manda o extrato na etapa do banco): o saldo final do extrato é o saldo de hoje. Sem isto a conta ficava só com
  // o líquido do extrato (muitas vezes negativo), e o saldo dito depois era recusado porque a conta "já tem lançamento".
  const acertada = typeof extrato.saldo === 'number' ? await saldoPeloExtrato(userId, e, lancamentos, extrato.saldo, extrato.banco ?? null) : null
  const atual = (await configAtiva(userId)) ?? e
  const fixado = { ...(atual.saldoFixado ?? {}) }
  for (const k of Object.keys(e.saldoFixado ?? {})) if (!(k in fixado)) fixado[k] = e.saldoFixado![k]
  // A conta cujo saldo acabou de ser posto pelo próprio extrato já está certa: não corrige de novo.
  if (acertada) delete fixado[acertada]
  if (!Object.keys(fixado).length) return
  const r = await sb.from('lancamentos').select('id,tipo,valor,carteira_id').eq('user_id', userId).in('id', lancamentos)
  falhou(r.error, 'config: lançamentos importados')
  const liquido = new Map<string, number>()
  for (const l of (r.data ?? []) as { tipo: string; valor: number; carteira_id: string }[]) {
    if (!(l.carteira_id in fixado)) continue
    const v = Number(l.valor) * (l.tipo === 'entrada' ? 1 : l.tipo === 'saida' ? -1 : 0)
    liquido.set(l.carteira_id, (liquido.get(l.carteira_id) ?? 0) + v)
  }
  for (const [carteira, v] of liquido) {
    if (!v) continue
    // Cumulativo: cada extrato importado tira o que trouxe, para dois extratos da mesma conta não se anularem.
    const atual = await sb.from('carteiras').select('saldo_inicial').eq('user_id', userId).eq('id', carteira).maybeSingle()
    falhou(atual.error, 'config: saldo da conta')
    const novo = Math.round((Number((atual.data as { saldo_inicial?: number } | null)?.saldo_inicial ?? fixado[carteira]) - v) * 100) / 100
    falhou((await sb.from('carteiras').update({ saldo_inicial: novo }).eq('user_id', userId).eq('id', carteira)).error, 'config: saldo depois do extrato')
  }
}
