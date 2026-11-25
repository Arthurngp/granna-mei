/**
 * As consultas reais do envio manual (ver envio-manual.ts). Separado para o ciclo poder ser testado a seco e para este arquivo poder ser
 * testado contra o banco falso, com as consultas de verdade.
 *
 * ATENÇÃO: usa a service_role, que ignora as regras de acesso. Qualquer erro de leitura LANÇA: o ciclo trata erro como "não envia". Sem a
 * migration (sem a tabela da fila) a leitura do próximo pedido falha e o ciclo simplesmente não faz nada.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { estado as estadoAvisos, estadoTeste } from './avisos.ts'
import type { AlvoManual, DepsManual, NumeroNoWhats, PedidoManual } from './envio-manual.ts'
import { estado as estadoRetencao } from './retencao.ts'
import { estadoResumo } from './resumo-diario.ts'

/** Um pedido "enviando" há mais que isto é de um processo que caiu: vira "falhou", nunca é reenviado sozinho. */
export const PRESO_APOS_MS = 5 * 60_000

function falha(onde: string, e: { message: string } | null) {
  if (e) throw new Error(`envio manual ${onde}: ${e.message}`)
}

/** A tabela da fila ainda não existe (migration não aplicada): não é erro, é "nada a fazer". Qualquer outro erro continua lançando. */
const SEM_TABELA = /could not find the table|schema cache|does not exist|PGRST205|42P01/i
const semTabela = (e: { message: string; code?: string } | null) => !!e && SEM_TABELA.test(`${e.code ?? ''} ${e.message}`)

export function depsEnvioManualDoBanco(
  sb: SupabaseClient,
  enviar: (telefone: string, texto: string) => Promise<void>,
  gatewayConectado: () => Promise<boolean>,
  conferirNumero?: (telefone: string) => Promise<NumeroNoWhats>,
): DepsManual {
  const chaveAviso = (id: string) => `man:${id}`
  return {
    async liberarPresos() {
      const limite = new Date(Date.now() - PRESO_APOS_MS).toISOString()
      const { error } = await sb
        .from('envios_manuais')
        .update({ status: 'falhou', erro: 'interrompido no meio do envio: confira no WhatsApp se a mensagem saiu antes de pedir de novo' })
        .eq('status', 'enviando')
        .lt('iniciado_em', limite)
      if (semTabela(error)) return
      falha('liberar presos', error)
    },

    async proximo() {
      // select('*') de propósito: pedir uma coluna que ainda não existe (migration não aplicada) faria a leitura falhar e travaria a fila inteira.
      const { data, error } = await sb.from('envios_manuais').select('*').eq('status', 'fila').order('pedido_em', { ascending: true }).order('id', { ascending: true }).limit(1)
      if (semTabela(error)) return null
      falha('ler a fila', error)
      const l = ((data ?? []) as PedidoManual[])[0]
      return l ? { id: l.id, user_id: l.user_id, texto: l.texto, contato_frio: !!l.contato_frio, nao_confirmado: !!l.nao_confirmado } : null
    },

    async apto(userId, forcar, naoConfirmado) {
      // O terceiro parâmetro só vai quando o pedido o traz: assim o servidor novo continua falando com o banco de antes da migration.
      const args: Record<string, unknown> = { p_user: userId, p_forcar: forcar }
      if (naoConfirmado) args.p_nao_confirmado = true
      const { data, error } = await sb.rpc('envio_manual_apto', args)
      falha('conferir a pessoa', error)
      const l = ((data ?? []) as { telefone: string | null; nome: string | null; recusa: string | null }[])[0]
      // Sem resposta clara, recusa: em dúvida não envia.
      if (!l) return { telefone: null, nome: '', recusa: 'não consegui conferir a pessoa' } satisfies AlvoManual
      return { telefone: l.telefone ? String(l.telefone).replace(/\D/g, '') || null : null, nome: l.nome ?? '', recusa: l.recusa }
    },

    gatewayConectado,
    conferirNumero,

    async movimento(inicioDoDia) {
      const hoje = await sb.from('avisos').select('chave', { count: 'exact', head: true }).eq('tipo', 'retencao_manual').gte('criado_em', inicioDoDia)
      falha('contar os de hoje', hoje.error)
      // Contagem desconhecida não pode virar "zero enviados": em dúvida, não envia.
      if (hoje.count === null || hoje.count === undefined) throw new Error('envio manual contar os de hoje: o banco não devolveu a contagem')
      // O envio mais recente de QUALQUER tipo (vencimento, fim do teste, retenção, manual): saem pelo mesmo chip.
      const ult = await sb.from('avisos').select('criado_em, enviado_em').order('criado_em', { ascending: false }).limit(1)
      falha('último envio', ult.error)
      const l = ((ult.data ?? []) as { criado_em: string; enviado_em: string | null }[])[0]
      const t = l ? Math.max(Date.parse(l.criado_em), l.enviado_em ? Date.parse(l.enviado_em) : 0) : 0
      return { manuaisHoje: hoje.count, ultimoEnvioEm: l ? (Number.isNaN(t) ? 'invalido' : new Date(t).toISOString()) : null }
    },

    async reservar(p, telefone) {
      // 1) Quem muda de "fila" para "enviando" primeiro é quem envia.
      const g = await sb.from('envios_manuais').update({ status: 'enviando', iniciado_em: new Date().toISOString() }).eq('id', p.id).eq('status', 'fila').select('id')
      falha('reservar o pedido', g.error)
      if (((g.data ?? []) as { id: string }[]).length === 0) return false
      // 2) A reserva em avisos é o que faz os lembretes automáticos enxergarem este envio (espera e intervalo por pessoa).
      const linha = { chave: chaveAviso(p.id), user_id: p.user_id, tipo: 'retencao_manual', referencia: new Date().toISOString().slice(0, 10), para: telefone, status: 'enviando' }
      const a = await sb.from('avisos').upsert([linha], { onConflict: 'chave', ignoreDuplicates: true }).select('chave')
      if (a.error || ((a.data ?? []) as { chave: string }[]).length === 0) {
        // Não deu para registrar: devolve o pedido para a fila e NÃO envia (sem o registro, a espera de 5 minutos não enxerga este envio).
        await sb.from('envios_manuais').update({ status: 'fila', iniciado_em: null }).eq('id', p.id)
        throw new Error(`envio manual reservar em avisos: ${a.error?.message ?? 'a chave já existia'}`)
      }
      return true
    },

    async concluir(p, r) {
      if (r.ok) {
        const agora = new Date().toISOString()
        const a = await sb.from('avisos').update({ status: 'enviado', enviado_em: agora }).eq('chave', chaveAviso(p.id))
        falha('marcar enviado em avisos', a.error)
        const q = await sb.from('envios_manuais').update({ status: 'enviado', enviado_em: agora, erro: null }).eq('id', p.id)
        falha('marcar enviado', q.error)
        return
      }
      // Falhou: solta a reserva em avisos (não houve envio que conte) e marca o pedido. Não é refeito sozinho.
      await sb.from('avisos').delete().eq('chave', chaveAviso(p.id)).eq('status', 'enviando')
      const q = await sb.from('envios_manuais').update({ status: 'falhou', erro: r.erro.slice(0, 300) }).eq('id', p.id)
      falha('marcar falhou', q.error)
    },

    enviar,
    outroCicloAndando: () => estadoAvisos.rodando || estadoTeste.rodando || estadoResumo.rodando || estadoRetencao.rodando,
  }
}
