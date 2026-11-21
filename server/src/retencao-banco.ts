/**
 * As consultas reais dos lembretes de retenção (ver retencao.ts). Separado para o ciclo poder ser testado a seco e para este
 * arquivo poder ser testado contra o banco falso, com as consultas de verdade.
 *
 * ATENÇÃO: usa a service_role, que ignora as regras de acesso. A lista de elegíveis vem da função SQL retencao_elegiveis (uma só
 * definição, a mesma que a prévia do admin usa). Qualquer erro de leitura LANÇA: o ciclo trata erro como "não envia".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { estado as estadoAvisos, estadoTeste } from './avisos.ts'
import { chaveRetencao, REGRAS, TIPO_AVISO, type ConfigRegra, type DepsRetencao, type Elegivel, type ModoRetencao, type RegraRetencao } from './retencao.ts'

const MODOS: ModoRetencao[] = ['desligado', 'ensaio', 'piloto', 'todos']

function falha(onde: string, e: { message: string } | null) {
  if (e) throw new Error(`retencao ${onde}: ${e.message}`)
}

export function depsRetencaoDoBanco(sb: SupabaseClient, enviar: (telefone: string, texto: string) => Promise<void>, gatewayConectado: () => Promise<boolean>, piloto: () => string[]): DepsRetencao {
  return {
    async configs() {
      const { data, error } = await sb.from('config_retencao').select('regra, modo, atraso_horas, texto')
      falha('configuração', error)
      const out: ConfigRegra[] = []
      for (const r of (data ?? []) as { regra: string; modo: string; atraso_horas: number; texto: string }[]) {
        // Linha estranha vale como desligada: some da lista, em vez de arriscar um envio com valor quebrado.
        const atraso = Number(r.atraso_horas)
        if (!REGRAS.includes(r.regra as RegraRetencao) || !MODOS.includes(r.modo as ModoRetencao) || !Number.isInteger(atraso) || atraso < 1 || atraso > 720) continue
        if (typeof r.texto !== 'string' || r.texto.trim().length < 20) continue
        out.push({ regra: r.regra as RegraRetencao, modo: r.modo as ModoRetencao, atraso_horas: atraso, texto: r.texto })
      }
      return out
    },

    async elegiveis(regra, atrasoHoras) {
      const { data, error } = await sb.rpc('retencao_elegiveis', { p_regra: regra, p_atraso: atrasoHoras, p_ignorar_marco: false })
      falha('elegíveis', error)
      return ((data ?? []) as { user_id: string; nome: string | null; telefone: string | null; whats: string | null; horas: number }[]).map(
        (r): Elegivel => ({ user_id: r.user_id, nome: r.nome ?? '', telefone: String(r.telefone ?? '').replace(/\D/g, '') || null, whats: r.whats ?? '', horas: Number(r.horas) || 0 }),
      )
    },

    gatewayConectado,

    async movimento(inicioDoDia) {
      const hoje = await sb.from('avisos').select('chave', { count: 'exact', head: true }).in('tipo', ['retencao_nunca', 'retencao_parou']).gte('criado_em', inicioDoDia)
      falha('contar os de hoje', hoje.error)
      // Contagem desconhecida não pode virar "zero enviados": em dúvida, não envia.
      if (hoje.count === null || hoje.count === undefined) throw new Error('retencao contar os de hoje: o banco não devolveu a contagem')
      // O envio automático mais recente de QUALQUER tipo (vencimento, fim do teste, retenção): saem pelo mesmo chip.
      const ult = await sb.from('avisos').select('criado_em, enviado_em').order('criado_em', { ascending: false }).limit(1)
      falha('último envio', ult.error)
      const l = ((ult.data ?? []) as { criado_em: string; enviado_em: string | null }[])[0]
      const t = l ? Math.max(Date.parse(l.criado_em), l.enviado_em ? Date.parse(l.enviado_em) : 0) : 0
      return { retencaoHoje: hoje.count, ultimoEnvioEm: l ? (Number.isNaN(t) ? 'invalido' : new Date(t).toISOString()) : null }
    },

    async reservar(userId, regra, telefone) {
      const linha = { chave: chaveRetencao(regra, userId), user_id: userId, tipo: TIPO_AVISO[regra], referencia: new Date().toISOString().slice(0, 10), para: telefone, status: 'enviando' }
      // ignoreDuplicates: o insert devolve só a linha que ELE criou. Quem reserva primeiro é quem envia.
      const { data, error } = await sb.from('avisos').upsert([linha], { onConflict: 'chave', ignoreDuplicates: true }).select('chave')
      falha('reservar', error)
      return ((data ?? []) as { chave: string }[]).length > 0
    },

    async concluir(userId, regra, enviado) {
      const chave = chaveRetencao(regra, userId)
      const q = enviado
        ? await sb.from('avisos').update({ status: 'enviado', enviado_em: new Date().toISOString() }).eq('user_id', userId).eq('chave', chave)
        : await sb.from('avisos').delete().eq('user_id', userId).eq('chave', chave)
      falha(enviado ? 'marcar enviado' : 'soltar reserva', q.error)
    },

    enviar,
    outroCicloAndando: () => estadoAvisos.rodando || estadoTeste.rodando,
    get piloto() {
      return piloto()
    },

    async registrarCiclo({ em, erro }) {
      // Só para o admin ver. Se a coluna ainda não existe (migration não rodou), o erro é engolido de propósito.
      await sb.from('granninha_saude').update({ retencao_ciclo_em: em, retencao_erro: erro }).eq('id', 1)
    },
  }
}
