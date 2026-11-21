import { Carregando, Falha } from '../comum'
import { Ausente, n, pct, useRpc } from './usar'

interface Origens {
  por_lp: { lp: string; cadastros: number; confirmados: number; pagantes: number }[]
  por_campanha: { campanha: string; cadastros: number }[]
}

export function Trafego() {
  const { dados, erro, ausente } = useRpc<Origens>('admin_origens', {}, 120_000)
  if (ausente) return <Ausente nome="admin_origens" />
  if (erro) return <Falha texto={erro} />
  if (!dados) return <Carregando />

  const total = dados.por_lp.reduce((s, x) => s + x.cadastros, 0)
  const semOrigem = dados.por_lp.find((x) => x.lp === 'sem origem')?.cadastros ?? 0
  const confirmados = dados.por_lp.reduce((s, x) => s + x.confirmados, 0)

  return (
    <div className="pagina">
      <div className="kpis kpis-3">
        <div className="kpi"><small>Cadastros</small><b className="num">{n(total)}</b><span>{n(dados.por_lp.length)} páginas de origem</span></div>
        <div className="kpi"><small>Com origem conhecida</small><b className="num">{pct(total - semOrigem, total)}</b><span>{n(semOrigem)} sem origem (antes de 16/11 ou sem passar pelo site)</span></div>
        <div className="kpi"><small>Confirmaram o WhatsApp</small><b className="num">{pct(confirmados, total)}</b><span>{n(confirmados)} de {n(total)}</span></div>
      </div>

      <div className="grade">
        <section className="card g-7">
          <div className="card-cab"><h2>Cadastros por página</h2></div>
          {dados.por_lp.length ? (
            <div className="rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Página</th>
                    <th>Cadastros</th>
                    <th>Confirmaram</th>
                    <th>Contas ativas</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.por_lp.map((o) => (
                    <tr key={o.lp} className={o.cadastros < 5 ? 'pequena' : undefined}>
                      <td>{o.lp === 'home' ? 'Home' : o.lp}</td>
                      <td className="num">{n(o.cadastros)}</td>
                      <td className="num">{n(o.confirmados)} <small className="suave">{pct(o.confirmados, o.cadastros)}</small></td>
                      <td className="num">{n(o.pagantes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="suave">Ainda sem cadastros.</p>
          )}
        </section>

        <section className="card g-5">
          <div className="card-cab"><h2>Cadastros por campanha</h2></div>
          {dados.por_campanha.length ? (
            <div className="fatos">
              {dados.por_campanha.map((c) => (
                <div key={c.campanha}><span>{c.campanha}</span><span className="num">{n(c.cadastros)}</span></div>
              ))}
            </div>
          ) : (
            <p className="suave">Nenhum cadastro veio com campanha (utm_campaign) ainda.</p>
          )}
        </section>
      </div>

      <p className="suave pq">
        Página e campanha da última chegada ao site antes de criar a conta. A campanha é a utm_campaign do link, então cada anúncio precisa da sua. “Contas ativas” são as que estão com situação ativa, paga ou liberada à mão. Linhas apagadas têm menos de 5 cadastros.
      </p>
    </div>
  )
}
