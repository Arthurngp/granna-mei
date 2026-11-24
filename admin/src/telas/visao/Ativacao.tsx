import { Falha } from '../comum'
import { dataBR } from '../comum'
import { Anel } from './graficos'
import { Cartao, Pagina, type HeadDef } from './layout'
import { Ausente, n, NOME_PASSO, pct, useRpc } from './usar'
import { chegaram, maiorPerda } from './util'

interface Coorte {
  semana: string
  cadastros: number
  confirmaram: number
  com_mensagem: number
  /** Terminaram as boas-vindas (passo 7) e nunca usaram. Vem contado do banco; ausente se a migration admin_uso_real ainda não rodou. */
  terminaram_sem_uso?: number
  passos: Record<string, number>
}
interface Ativ {
  total: number
  passos: Record<string, number>
  confirmaram: number
  com_mensagem: number
  mediana_horas_ate_primeira: number | null
  coortes: Coorte[]
}

function tempo(h: number | null) {
  if (h === null) return '–'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 48) return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
  return `${Math.round(h / 24)} dias`
}

const calor = (v: number, todo: number) => (todo > 0 ? `rgba(14, 130, 80, ${(0.08 + (v / todo) * 0.45).toFixed(2)})` : '#f2f3f9')

export function Ativacao() {
  const { dados, erro, ausente } = useRpc<Ativ>('admin_ativacao', {}, 120_000)
  if (ausente) return <Pagina titulo="Ativação" heads={[]}><Ausente nome="admin_ativacao" /></Pagina>
  if (erro) return <Pagina titulo="Ativação" heads={[]}><Falha texto={erro} /></Pagina>

  const total = dados?.total ?? 0
  const terminaram = dados ? chegaram(dados.passos, 7) : 0
  const perda = dados ? maiorPerda(dados.passos) : null

  const heads: HeadDef[] | undefined = dados
    ? [
        { rotulo: 'Cadastros', valor: n(total), nota: 'todas as contas criadas' },
        { rotulo: 'Terminaram as boas-vindas', valor: pct(terminaram, total), nota: `${n(terminaram)} de ${n(total)}` },
        { rotulo: 'Confirmaram o WhatsApp', valor: pct(dados.confirmaram, total), nota: `${n(dados.confirmaram)} contas` },
        { rotulo: 'Usaram a Granninha', valor: pct(dados.com_mensagem, total), nota: `${n(dados.com_mensagem)} contas · mediana de ${tempo(dados.mediana_horas_ate_primeira)}, sem contar a confirmação do número` },
      ]
    : undefined

  return (
    <Pagina titulo="Ativação" subtitulo="Do cadastro até usar a Granninha de verdade" heads={heads}>
      <Cartao g={8} titulo="Onde as boas-vindas perdem gente" nota="pessoas que chegaram em cada passo">
        {dados ? (
          <>
            <div className="funil-cols">
              {NOME_PASSO.map((_, k) => {
                const ch = chegaram(dados.passos, k)
                return (
                  <div key={k} className={`fcol ${perda?.k === k ? 'm' : ''}`}>
                    <div className="v">
                      {n(ch)}
                      <small>{pct(ch, total)}</small>
                    </div>
                    <div className="b" style={{ height: `${Math.max(4, total ? (ch / total) * 78 : 0)}%` }} />
                  </div>
                )
              })}
            </div>
            <div className="funil-nomes">
              {NOME_PASSO.map((nome, k) => (
                <span key={k} className={perda?.k === k ? 'm' : ''}>
                  {nome}
                </span>
              ))}
            </div>
            <div className="funil-linhas">
              {NOME_PASSO.map((nome, k) => {
                const ch = chegaram(dados.passos, k)
                const parou = k <= 6 ? (dados.passos[String(k)] ?? 0) : 0
                return (
                  <div key={k} className={`passo ${perda?.k === k ? 'maior' : ''}`}>
                    <div className="passo-topo">
                      <span><i>{k + 1}</i>{nome}</span>
                      <span><b>{n(ch)}</b> <em>{pct(ch, total)}</em></span>
                    </div>
                    <div className="prog"><i style={{ width: `${total ? (ch / total) * 100 : 0}%` }} /></div>
                    {k <= 6 && <small>{parou > 0 ? `${n(parou)} pararam aqui (${pct(parou, ch)} de quem chegou)` : 'ninguém parou aqui'}{perda?.k === k ? ' · maior perda' : ''}</small>}
                  </div>
                )
              })}
            </div>
            {perda && (
              <div className="caixa-nota">
                A maior perda é em <b>{NOME_PASSO[perda.k]}</b>: {n(dados.passos[String(perda.k)] ?? 0)} das {n(chegaram(dados.passos, perda.k))} pessoas que chegaram aqui pararam.
              </div>
            )}
            <p className="texto-ajuda">Quem terminou as boas-vindas entra como passo 8 mesmo no fluxo antigo de 6 passos. Ainda não dá para medir o tempo em cada passo: o banco guarda só o passo mais avançado, sem a data de entrada.</p>
          </>
        ) : (
          <span className="skel" style={{ height: 300 }} />
        )}
      </Cartao>

      <Cartao g={4} titulo="Depois das boas-vindas">
        {dados ? (
          <>
            <div className="ringbox">
              <Anel pct={total ? (dados.com_mensagem / total) * 100 : 0} cor="#0e8250" tam={120} esp={12} />
              <p>
                <b>{n(dados.com_mensagem)} de {n(total)}</b> usaram a Granninha depois de confirmar o número. A mensagem do código não conta.
              </p>
            </div>
            <div className="fato"><span>Confirmaram o WhatsApp</span><b>{n(dados.confirmaram)}<small>{pct(dados.confirmaram, total)}</small></b></div>
            <div className="fato"><span>Terminaram e nunca usaram</span><b>{dados.terminaram_sem_uso === undefined ? '–' : n(dados.terminaram_sem_uso)}</b></div>
            <div className="fato"><span>Tempo até o 1º uso</span><b>{tempo(dados.mediana_horas_ate_primeira)}</b></div>
          </>
        ) : (
          <span className="skel" style={{ height: 240 }} />
        )}
      </Cartao>

      <Cartao g={12} titulo="Por semana de cadastro" nota="quanto mais verde, melhor">
        {dados ? (
          dados.coortes.length ? (
            <div className="rolagem">
              <div className="mapa">
                <div className="mapa-l cab" style={{ gridTemplateColumns: '90px 80px repeat(3, 1fr) minmax(130px, 1.3fr)' }}>
                  <span>Semana de</span><span>Cadastros</span><span>Terminaram</span><span>Confirmaram</span><span>Usaram</span><span>Param mais em</span>
                </div>
                {dados.coortes.map((c) => {
                  const term = chegaram(c.passos, 7)
                  const pq = c.cadastros < 5
                  const mp = pq ? null : maiorPerda(c.passos)
                  return (
                    <div key={c.semana} className={`mapa-l ${pq ? 'pq' : ''}`} style={{ gridTemplateColumns: '90px 80px repeat(3, 1fr) minmax(130px, 1.3fr)' }}>
                      <span className="sem">{dataBR(c.semana).slice(0, 5)}</span>
                      <div className="cel" style={{ background: '#f2f3f9' }}>{n(c.cadastros)}</div>
                      <div className="cel" style={{ background: calor(term, c.cadastros) }}>{pct(term, c.cadastros)}</div>
                      <div className="cel" style={{ background: calor(c.confirmaram, c.cadastros) }}>{pct(c.confirmaram, c.cadastros)}</div>
                      <div className="cel" style={{ background: calor(c.com_mensagem, c.cadastros) }}>{pct(c.com_mensagem, c.cadastros)}</div>
                      <span className="n" style={{ fontWeight: 600 }}>{mp ? NOME_PASSO[mp.k] : pq ? 'poucos cadastros' : '–'}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="texto-ajuda">Ainda sem cadastros.</p>
          )
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
        <p className="texto-ajuda">Semanas começam na segunda-feira, horário de São Paulo. Semanas com menos de 5 cadastros ficam apagadas: a porcentagem engana.</p>
      </Cartao>
    </Pagina>
  )
}
