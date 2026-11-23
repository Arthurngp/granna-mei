import { useEffect, useState } from 'react'
import { rpc } from '../sb'
import { Falha } from './comum'
import { Cartao } from './visao/layout'
import { Ausente, n, pct } from './visao/usar'

type Regra = 'nunca_mandou' | 'parou_de_usar'
interface PorRegra {
  regra: Regra
  enviados: number
  medidos_24h: number
  responderam_24h: number
  medidos_48h: number
  lancaram_48h: number
  pediram_sair: number
}
interface Ultimo {
  em: string
  regra: Regra
  nome: string
  negocio: string
  respondeu: boolean | null
  lancou: boolean | null
  pediu_sair: boolean
}
interface FilaRegra {
  regra: Regra
  modo: string
  atraso_horas: number
  agora: { nome: string; negocio: string; horas: number }[]
  a_caminho: { nome: string; negocio: string; faltam_horas: number }[]
}
interface Acomp {
  dias: number
  por_regra: PorRegra[]
  ultimos: Ultimo[]
  fila: FilaRegra[]
}

const NOME_REGRA: Record<Regra, string> = { nunca_mandou: 'Nunca mandou nada', parou_de_usar: 'Parou de usar' }

/** "há 5 h", "há 2 dias": o suficiente para ver se o envio é de agora ou de ontem. */
function ha(iso: string): string {
  const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000))
  return h < 1 ? 'agora há pouco' : h < 48 ? `há ${n(h)} h` : `há ${n(Math.round(h / 24))} dias`
}

/** Etiqueta pequena do resultado de um envio: verde bom, vermelho ruim, cinza ainda sem tempo. */
function Etiqueta({ texto, tom }: { texto: string; tom: 'bom' | 'ruim' | 'neutro' }) {
  const cor = tom === 'bom' ? 'var(--in, #1e8e5a)' : tom === 'ruim' ? 'var(--out, #b4232c)' : 'var(--muted, #6b6b86)'
  return <span style={{ fontSize: 12, fontWeight: 620, color: cor, border: `1px solid ${cor}`, borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>{texto}</span>
}

/** "5 de 10 (50%)", ou "sem tempo para medir" quando nenhum envio tem a idade mínima. */
const taxa = (parte: number, todo: number) => (todo > 0 ? `${n(parte)} de ${n(todo)} (${pct(parte, todo)})` : 'ainda sem tempo para medir')

export function AvisosAcompanhar() {
  const [dias, setDias] = useState(30)
  const [d, setD] = useState<Acomp | null>(null)
  const [erro, setErro] = useState('')
  const [ausente, setAusente] = useState(false)

  useEffect(() => {
    let vivo = true
    const ler = () =>
      rpc<Acomp>('admin_retencao_acompanhar', { p_dias: dias })
        .then((r) => vivo && (setD(r), setErro('')))
        .catch((e: Error) => {
          if (!vivo) return
          if (/does not exist|could not find|schema cache/i.test(e.message)) setAusente(true)
          else setErro(e.message)
        })
    void ler()
    const t = setInterval(ler, 60_000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [dias])

  if (ausente) return <div style={{ gridColumn: '1 / -1' }}><Ausente nome="admin_retencao_acompanhar" /></div>

  const seletor = (
    <div className="dupla" style={{ gap: 6 }} role="group" aria-label="Período do acompanhamento">
      {[7, 30].map((x) => (
        <button key={x} type="button" aria-pressed={dias === x} className={`btn ${dias === x ? 'btn-pri' : 'btn-sec'}`} style={{ minHeight: 34, padding: '0 12px' }} onClick={() => setDias(x)}>
          {x} dias
        </button>
      ))}
    </div>
  )

  return (
    <>
      <Cartao g={12} titulo="Acompanhamento" nota={`os últimos ${dias} dias`} lado={seletor}>
        {erro && <Falha texto={erro} />}
        {!d && !erro && <span className="skel" style={{ height: 120 }} />}
        {d && (
          <div className="pilha" style={{ gap: 10 }}>
            {d.por_regra.length === 0 && <p className="suave" style={{ margin: 0 }}>Nenhum lembrete enviado nos últimos {dias} dias.</p>}
            {d.por_regra.map((r) => (
              <div className="item-ob ligado" key={r.regra} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
                <b>{NOME_REGRA[r.regra]}: {n(r.enviados)} {r.enviados === 1 ? 'enviado' : 'enviados'}</b>
                <small className="suave">Respondeu em até 24 h: {taxa(r.responderam_24h, r.medidos_24h)}. Voltou a lançar em até 48 h: {taxa(r.lancaram_48h, r.medidos_48h)}. Pediram SAIR: {n(r.pediram_sair)}.</small>
              </div>
            ))}
            <p className="suave pq" style={{ margin: 0 }}>
              As taxas só contam quem já teve tempo de responder (24 h) ou de lançar (48 h): um lembrete de hoje cedo ainda não pode contar como "não respondeu". A palavra SAIR não conta como resposta.
            </p>
          </div>
        )}
      </Cartao>

      {d && (
        <>
          <Cartao g={6} titulo="Últimos envios" nota={d.ultimos.length ? `os ${n(d.ultimos.length)} mais recentes` : undefined}>
            {d.ultimos.length === 0 ? (
              <p className="suave" style={{ margin: 0 }}>Nenhum lembrete enviado ainda. Quando a primeira regra for ligada em Todos, os envios aparecem aqui.</p>
            ) : (
              <div className="lista">
                {d.ultimos.map((u, i) => (
                  <div className="linha" key={i} style={{ padding: '8px 0' }}>
                    <div className="meio">
                      <div className="tit" style={{ fontSize: 14, whiteSpace: 'normal' }}>{u.nome || 'Sem nome'}{u.negocio ? ` · ${u.negocio}` : ''}</div>
                      <div className="det"><span>{NOME_REGRA[u.regra]} · {ha(u.em)}</span></div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {u.respondeu === null ? <Etiqueta texto="aguardando resposta" tom="neutro" /> : u.respondeu ? <Etiqueta texto="respondeu" tom="bom" /> : <Etiqueta texto="não respondeu" tom="ruim" />}
                        {u.lancou === null ? <Etiqueta texto="lançamento: aguardando" tom="neutro" /> : u.lancou ? <Etiqueta texto="voltou a lançar" tom="bom" /> : <Etiqueta texto="não lançou" tom="ruim" />}
                        {u.pediu_sair && <Etiqueta texto="pediu SAIR" tom="ruim" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Cartao>

          <Cartao g={6} titulo="Na fila" nota="quem recebe e quando">
            <div className="pilha" style={{ gap: 12 }}>
              {d.fila.map((f) => (
                <div key={f.regra}>
                  <b style={{ fontSize: 14 }}>{NOME_REGRA[f.regra]}</b>{' '}
                  <small className="suave">({f.modo === 'desligado' ? 'regra desligada: ninguém recebe, esta é só a lista de quem receberia' : f.modo === 'todos' ? 'ligada para todos' : `em modo ${f.modo}`}, espera de {n(f.atraso_horas)} h)</small>
                  <p className="suave pq" style={{ margin: '6px 0 0' }}>
                    <b>Receberia agora ({n(f.agora.length)}):</b>{' '}
                    {f.agora.length ? f.agora.map((x) => `${x.nome.split(' ')[0]} (${n(x.horas)} h)`).join(', ') : 'ninguém'}
                  </p>
                  <p className="suave pq" style={{ margin: '4px 0 0' }}>
                    <b>Entra nas próximas 24 h ({n(f.a_caminho.length)}):</b>{' '}
                    {f.a_caminho.length ? f.a_caminho.map((x) => `${x.nome.split(' ')[0]} (em ${n(x.faltam_horas)} h)`).join(', ') : 'ninguém'}
                  </p>
                </div>
              ))}
              <p className="suave pq" style={{ margin: 0 }}>
                Quem só escreveu para o número antigo não entra em nenhuma lista, de propósito. Mesmo ligada, a regra manda no máximo 15 por dia, um a cada 3 minutos.
              </p>
            </div>
          </Cartao>
        </>
      )}
    </>
  )
}
