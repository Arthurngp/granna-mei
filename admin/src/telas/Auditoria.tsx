import { useEffect, useState } from 'react'
import { rpc } from '../sb'
import { Carregando, dataHora, Falha, NOME_SITUACAO } from './comum'

interface Linha {
  criado_em: string
  admin: string
  acao: string
  cliente: string
  detalhes: { motivo?: string; antes?: string; depois?: string; dias?: number }
}

export function Auditoria() {
  const [l, setL] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    rpc<Linha[]>('admin_auditoria_listar').then(setL).catch((e: Error) => setErro(e.message))
  }, [])
  if (erro) return <Falha texto={erro} />
  if (!l) return <Carregando />
  return (
    <div className="pagina">
      <p className="suave">Tudo que um admin fez: quem, quando, em qual cliente e por quê.</p>
      <div className="card tabela-aud" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {l.length === 0 ? (
          <p className="suave" style={{ padding: '12px 0' }}>Nenhuma ação registrada ainda.</p>
        ) : (
          <div className="lista">
            {l.map((a, i) => (
              <div className="linha" key={i}>
                <div className="meio">
                  <div className="tit" style={{ whiteSpace: 'normal' }}>
                    {a.acao.replace(/_/g, ' ')} · {a.cliente}
                  </div>
                  <div className="det" style={{ whiteSpace: 'normal' }}>
                    <span style={{ whiteSpace: 'normal' }}>
                      {dataHora(a.criado_em)} · por {a.admin}
                      {a.detalhes.antes && a.detalhes.depois && a.detalhes.antes !== a.detalhes.depois ? ` · ${NOME_SITUACAO[a.detalhes.antes] ?? a.detalhes.antes} → ${NOME_SITUACAO[a.detalhes.depois] ?? a.detalhes.depois}` : ''}
                      {a.detalhes.motivo ? ` · "${a.detalhes.motivo}"` : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
