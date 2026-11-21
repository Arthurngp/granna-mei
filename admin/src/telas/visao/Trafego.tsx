import { Falha } from '../comum'
import { Cartao, Pagina, type HeadDef } from './layout'
import { Ausente, n, pct, useRpc } from './usar'

interface Origens {
  por_lp: { lp: string; cadastros: number; confirmados: number; pagantes: number }[]
  por_campanha: { campanha: string; cadastros: number }[]
}

export function Trafego() {
  const { dados, erro, ausente } = useRpc<Origens>('admin_origens', {}, 120_000)
  if (ausente) return <Pagina titulo="Tráfego" heads={[]}><Ausente nome="admin_origens" /></Pagina>
  if (erro) return <Pagina titulo="Tráfego" heads={[]}><Falha texto={erro} /></Pagina>

  const total = dados ? dados.por_lp.reduce((s, x) => s + x.cadastros, 0) : 0
  const semOrigem = dados?.por_lp.find((x) => x.lp === 'sem origem')?.cadastros ?? 0
  const confirmados = dados ? dados.por_lp.reduce((s, x) => s + x.confirmados, 0) : 0
  const maxLp = dados ? Math.max(1, ...dados.por_lp.map((x) => x.cadastros)) : 1

  const heads: HeadDef[] | undefined = dados
    ? [
        { rotulo: 'Cadastros', valor: n(total), nota: `${n(dados.por_lp.length)} páginas de origem` },
        { rotulo: 'Com origem conhecida', valor: pct(total - semOrigem, total), nota: `${n(semOrigem)} sem origem (antes de 16/11 ou sem passar pelo site)` },
        { rotulo: 'Confirmaram o WhatsApp', valor: pct(confirmados, total), nota: `${n(confirmados)} de ${n(total)}` },
      ]
    : undefined

  return (
    <Pagina titulo="Tráfego" subtitulo="De onde vêm os cadastros e quais páginas convertem" heads={heads} quantos={3}>
      <Cartao g={8} titulo="Cadastros por página" lado={<div className="leg"><span><i className="q" style={{ background: '#454c83' }} />Confirmaram o WhatsApp</span><span><i className="q" style={{ background: '#b1b9d8' }} />Ainda não</span></div>}>
        {dados ? (
          dados.por_lp.length ? (
            <div className="linhas">
              {dados.por_lp.map((o) => (
                <div key={o.lp} className={`pg ${o.cadastros < 5 ? 'pq' : ''}`}>
                  <b>{o.lp === 'home' ? 'Home' : o.lp}</b>
                  <div className="pg-t" style={{ width: `${(o.cadastros / maxLp) * 100}%` }}>
                    <i style={{ width: `${o.cadastros ? (o.confirmados / o.cadastros) * 100 : 0}%`, background: '#454c83' }} />
                    <i style={{ flex: 1, background: '#b1b9d8' }} />
                  </div>
                  <div className="pg-v">
                    {n(o.cadastros)}
                    <small>{pct(o.confirmados, o.cadastros)} confirmaram · {n(o.pagantes)} ativas</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="texto-ajuda">Ainda sem cadastros.</p>
          )
        ) : (
          <span className="skel" style={{ height: 220 }} />
        )}
      </Cartao>
      <Cartao g={4} titulo="Por campanha">
        {dados ? (
          dados.por_campanha.length ? (
            dados.por_campanha.map((c) => (
              <div className="fato" key={c.campanha}>
                <span>{c.campanha}</span>
                <b>{n(c.cadastros)}</b>
              </div>
            ))
          ) : (
            <p className="texto-ajuda" style={{ margin: 0 }}>Nenhum cadastro veio com campanha (utm_campaign) ainda.</p>
          )
        ) : (
          <span className="skel" style={{ height: 120 }} />
        )}
        <p className="rodape-cartao">A campanha é a utm_campaign do link, então cada anúncio precisa da sua. Páginas apagadas têm menos de 5 cadastros. “Ativas” são contas com situação ativa, paga ou liberada à mão.</p>
      </Cartao>
    </Pagina>
  )
}
