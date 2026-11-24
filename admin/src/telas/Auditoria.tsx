import { useEffect, useState } from 'react'
import { rpc } from '../sb'
import { dataHora, Falha, NOME_SITUACAO } from './comum'
import { Cartao, Pagina, type HeadDef } from './visao/layout'
import { n } from './visao/usar'

interface Linha {
  criado_em: string
  admin: string
  acao: string
  cliente: string
  detalhes: { motivo?: string; antes?: string; depois?: string; dias?: number }
}

/** Nomes legíveis das ações que não se leem bem só trocando o "_" por espaço. */
const ROTULO_ACAO: Record<string, string> = {
  limite_global: 'padrão do limite de lançamentos',
  limite_cliente: 'limite de lançamentos',
  retencao_regra: 'regra de lembrete automático',
  recurso_cliente: 'recurso de plano superior (liberar ou retirar)',
}
/** Ações que não têm um cliente alvo: o nome do alvo no lugar do "(removido)" que a listagem devolve. */
const ALVO_GERAL: Record<string, string> = {
  limite_global: 'todos os clientes',
  retencao_regra: 'lembretes automáticos',
  retencao_etapa: 'lembretes automáticos',
  whatsapp_desconectar: 'o WhatsApp da Granninha',
  alerta: 'alerta de queda',
  excluir_conta_definitivo: 'conta excluída',
}

export function Auditoria() {
  const [l, setL] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    rpc<Linha[]>('admin_auditoria_listar').then(setL).catch((e: Error) => setErro(e.message))
  }, [])

  if (erro) return <Pagina titulo="Auditoria" heads={[]}><Falha texto={erro} /></Pagina>

  const semana = l ? l.filter((a) => Date.now() - new Date(a.criado_em).getTime() < 7 * 86_400_000).length : 0
  const heads: HeadDef[] | undefined = l
    ? [
        { rotulo: 'Ações registradas', valor: n(l.length) + (l.length >= 300 ? '+' : ''), nota: l.length >= 300 ? 'mostrando as 300 mais recentes' : 'tudo que um admin já fez' },
        { rotulo: 'Nos últimos 7 dias', valor: n(semana) },
        { rotulo: 'Última ação', valor: l[0] ? dataHora(l[0].criado_em) : '–', nota: l[0] ? `por ${l[0].admin}` : 'nenhuma ainda', texto: true },
      ]
    : undefined

  return (
    <Pagina titulo="Auditoria" subtitulo="Tudo que um admin fez: quem, quando, em qual cliente e por quê" heads={heads} quantos={3}>
      <Cartao g={12}>
        {!l ? (
          <div style={{ display: 'grid', gap: 12 }} aria-hidden="true">
            {[0, 1, 2, 3, 4].map((k) => (
              <span key={k} className="skel" style={{ height: 52 }} />
            ))}
          </div>
        ) : l.length === 0 ? (
          <p className="texto-ajuda" style={{ margin: 0 }}>Nenhuma ação registrada ainda.</p>
        ) : (
          <div className="linhas">
            {l.map((a, i) => (
              <div className="cl-l" key={i} style={{ cursor: 'default' }}>
                <div className="cl-id">
                  <b>
                    {ROTULO_ACAO[a.acao] ?? a.acao.replace(/_/g, ' ')} · {ALVO_GERAL[a.acao] ?? a.cliente}
                  </b>
                  <span className="s">
                    {dataHora(a.criado_em)} · por {a.admin}
                  </span>
                  {(a.detalhes.motivo || (a.detalhes.antes && a.detalhes.depois && a.detalhes.antes !== a.detalhes.depois)) && (
                    <span className="q" style={{ color: 'var(--muted)' }}>
                      {a.detalhes.antes && a.detalhes.depois && a.detalhes.antes !== a.detalhes.depois ? `${NOME_SITUACAO[a.detalhes.antes] ?? a.detalhes.antes} → ${NOME_SITUACAO[a.detalhes.depois] ?? a.detalhes.depois}` : ''}
                      {a.detalhes.motivo ? `${a.detalhes.antes ? ' · ' : ''}“${a.detalhes.motivo}”` : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Cartao>
    </Pagina>
  )
}
