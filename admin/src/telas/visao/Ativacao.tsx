import { Carregando, dataBR, Falha } from '../comum'
import { Ausente, n, NOME_PASSO, pct, useRpc } from './usar'

interface Coorte {
  semana: string
  cadastros: number
  confirmaram: number
  com_mensagem: number
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

/** Quantas pessoas chegaram ao passo k: todas que estão nele ou além. */
function chegaram(passos: Record<string, number>, k: number) {
  let s = 0
  for (let j = k; j <= 7; j++) s += passos[String(j)] ?? 0
  return s
}

/** Passo (0 a 6) em que mais gente parou em relação a quem chegou nele. */
function maiorPerda(passos: Record<string, number>) {
  let melhor = { k: -1, taxa: 0 }
  for (let k = 0; k <= 6; k++) {
    const ch = chegaram(passos, k)
    const parou = passos[String(k)] ?? 0
    if (ch > 0 && parou / ch > melhor.taxa) melhor = { k, taxa: parou / ch }
  }
  return melhor.k >= 0 && melhor.taxa > 0 ? melhor : null
}

function tempo(h: number | null) {
  if (h === null) return '–'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 48) return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
  return `${Math.round(h / 24)} dias`
}

const calor = (v: number, todo: number) => (todo > 0 ? { background: `rgba(14, 130, 80, ${(0.06 + (v / todo) * 0.3).toFixed(2)})` } : undefined)

export function Ativacao() {
  const { dados, erro, ausente } = useRpc<Ativ>('admin_ativacao', {}, 120_000)
  if (ausente) return <Ausente nome="admin_ativacao" />
  if (erro) return <Falha texto={erro} />
  if (!dados) return <Carregando />

  const total = dados.total
  const perda = maiorPerda(dados.passos)
  const terminaram = chegaram(dados.passos, 7)

  return (
    <div className="pagina">
      <div className="kpis kpis-5">
        <div className="kpi"><small>Cadastros</small><b className="num">{n(total)}</b><span>todas as contas criadas</span></div>
        <div className="kpi"><small>Terminaram as boas-vindas</small><b className="num">{pct(terminaram, total)}</b><span>{n(terminaram)} de {n(total)}</span></div>
        <div className="kpi"><small>Confirmaram o WhatsApp</small><b className="num">{pct(dados.confirmaram, total)}</b><span>{n(dados.confirmaram)} contas</span></div>
        <div className="kpi"><small>Mandaram a 1ª mensagem</small><b className="num">{pct(dados.com_mensagem, total)}</b><span>{n(dados.com_mensagem)} contas</span></div>
        <div className="kpi"><small>Tempo até a 1ª mensagem</small><b className="num">{tempo(dados.mediana_horas_ate_primeira)}</b><span>mediana, do cadastro</span></div>
      </div>

      <div className="grade">
        <section className="card g-7">
          <div className="card-cab"><h2>Onde as boas-vindas perdem gente</h2></div>
          <div className="funil">
            {NOME_PASSO.map((nome, k) => {
              const ch = chegaram(dados.passos, k)
              const parou = k <= 6 ? (dados.passos[String(k)] ?? 0) : 0
              const maior = perda?.k === k
              return (
                <div className={`passo${maior ? ' maior' : ''}`} key={k}>
                  <div className="topo-passo">
                    <span><i className="num">{k + 1}</i> {nome}</span>
                    <span className="num"><b>{n(ch)}</b> <small className="suave">{pct(ch, total)}</small></span>
                  </div>
                  <div className="prog"><i style={{ width: `${total ? (ch / total) * 100 : 0}%` }} /></div>
                  {k <= 6 && (
                    <small className={maior ? 'perda' : 'suave'}>
                      {parou > 0 ? `${n(parou)} pararam aqui (${pct(parou, ch)} de quem chegou)` : 'ninguém parou aqui'}
                      {maior ? ' · maior perda' : ''}
                    </small>
                  )}
                </div>
              )
            })}
          </div>
          <p className="suave pq" style={{ marginTop: 10 }}>
            “Chegaram” conta quem está neste passo ou já passou dele. Quem terminou as boas-vindas entra como passo 8 mesmo no fluxo antigo de 6 passos (antes de 16/11).
            Ainda não dá para medir o tempo em cada passo: o banco guarda só o passo mais avançado, sem data de entrada. Falta registrar cada entrada.
          </p>
        </section>

        <section className="card g-5">
          <div className="card-cab"><h2>Depois das boas-vindas</h2></div>
          <div className="fatos">
            <div><span>Confirmaram o WhatsApp</span><span className="num">{n(dados.confirmaram)} <small className="suave">{pct(dados.confirmaram, total)}</small></span></div>
            <div><span>Mandaram a 1ª mensagem</span><span className="num">{n(dados.com_mensagem)} <small className="suave">{pct(dados.com_mensagem, total)}</small></span></div>
            <div><span>Terminaram mas nunca mandaram</span><span className="num">{n(Math.max(0, terminaram - dados.com_mensagem))}</span></div>
            <div><span>Tempo até a 1ª mensagem</span><span className="num">{tempo(dados.mediana_horas_ate_primeira)}</span></div>
          </div>
          <p className="suave pq" style={{ marginTop: 10 }}>
            A 1ª mensagem é o sinal de que a pessoa usou a Granninha de verdade. Quem terminou e não mandou nada é o grupo para chamar no WhatsApp.
          </p>
        </section>

        <section className="card">
          <div className="card-cab"><h2>Por semana de cadastro</h2></div>
          {dados.coortes.length ? (
            <div className="rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Semana de</th>
                    <th>Cadastros</th>
                    <th>Terminaram</th>
                    <th>Confirmaram</th>
                    <th>1ª mensagem</th>
                    <th>Param mais em</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.coortes.map((c) => {
                    const term = chegaram(c.passos, 7)
                    const pequena = c.cadastros < 5
                    const mp = !pequena ? maiorPerda(c.passos) : null
                    return (
                      <tr key={c.semana} className={pequena ? 'pequena' : undefined}>
                        <td>{dataBR(c.semana)}</td>
                        <td className="num">{n(c.cadastros)}</td>
                        <td className="num" style={calor(term, c.cadastros)}>{pct(term, c.cadastros)}</td>
                        <td className="num" style={calor(c.confirmaram, c.cadastros)}>{pct(c.confirmaram, c.cadastros)}</td>
                        <td className="num" style={calor(c.com_mensagem, c.cadastros)}>{pct(c.com_mensagem, c.cadastros)}</td>
                        <td>{mp ? NOME_PASSO[mp.k] : pequena ? 'poucos cadastros' : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="suave">Ainda sem cadastros.</p>
          )}
          <p className="suave pq" style={{ marginTop: 10 }}>Semanas começam na segunda-feira, horário de São Paulo. Linhas apagadas têm menos de 5 cadastros: a porcentagem engana.</p>
        </section>
      </div>
    </div>
  )
}
