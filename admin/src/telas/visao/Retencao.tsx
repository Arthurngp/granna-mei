import { Falha } from '../comum'
import { Cartao, Pagina, type HeadDef } from './layout'
import { Ausente, n, useRpc } from './usar'
import { diaMes } from './util'

interface Ret {
  semana_atual: string
  semanas: { semana: string; total: number; novos: number; voltaram: number; reativados: number }[]
  ativos_semana: number
  confirmados: number
  voltaram_pct: number | null
  sumiram: number
  habito: { um: number; dois_tres: number; quatro_cinco: number; seis_sete: number; media: number }
  coortes: { semana: string; n: number; vals: number[] }[]
}

const calor = (p: number) => `rgba(14, 130, 80, ${(0.08 + (p / 100) * 0.5).toFixed(2)})`

export function Retencao() {
  const { dados, erro, ausente } = useRpc<Ret>('admin_retencao', {}, 120_000)
  if (ausente) return <Pagina titulo="Retenção" heads={[]}><Ausente nome="admin_retencao" /></Pagina>
  if (erro) return <Pagina titulo="Retenção" heads={[]}><Falha texto={erro} /></Pagina>

  const heads: HeadDef[] | undefined = dados
    ? [
        { rotulo: 'Usaram esta semana', valor: n(dados.ativos_semana), nota: `de ${n(dados.confirmados)} com WhatsApp confirmado`, spark: dados.semanas.map((s) => s.total) },
        { rotulo: 'Voltaram na semana seguinte', valor: dados.voltaram_pct === null ? '–' : `${dados.voltaram_pct}%`, nota: 'entre as duas últimas semanas completas' },
        { rotulo: 'Sumiram', valor: n(dados.sumiram), nota: '7 dias ou mais sem mandar nada', tom: dados.sumiram > 0 ? 'ruim' : undefined },
        { rotulo: 'Dias de uso por semana', valor: dados.habito.media.toLocaleString('pt-BR'), nota: 'média entre quem usou nos últimos 7 dias' },
      ]
    : undefined

  const maxCol = dados ? Math.max(1, ...dados.semanas.map((s) => s.total)) : 1
  const altCol = 170
  const hab = dados
    ? [
        { nome: '1 dia', v: dados.habito.um },
        { nome: '2 a 3 dias', v: dados.habito.dois_tres },
        { nome: '4 a 5 dias', v: dados.habito.quatro_cinco },
        { nome: '6 a 7 dias', v: dados.habito.seis_sete },
      ]
    : []
  const maxHab = Math.max(1, ...hab.map((h) => h.v))

  return (
    <Pagina titulo="Retenção" subtitulo="Quem continua usando a Granninha depois da primeira vez" heads={heads}>
      <Cartao g={8} titulo="Clientes ativos por semana" lado={<div className="leg"><span><i className="q" style={{ background: '#8fe9b8' }} />Novos</span><span><i className="q" style={{ background: '#454c83' }} />Voltaram</span><span><i className="q" style={{ background: '#b1b9d8' }} />Reativados</span></div>}>
        {dados ? (
          <>
            <div className="semanas-cols">
              {dados.semanas.map((s) => (
                <div key={s.semana} className="c">
                  <div className="t">{s.total}{s.semana === dados.semana_atual ? ' *' : ''}</div>
                  <div className="pilha">
                    <i style={{ height: (s.novos / maxCol) * altCol, background: '#8fe9b8' }} />
                    <i style={{ height: (s.voltaram / maxCol) * altCol, background: '#454c83' }} />
                    <i style={{ height: (s.reativados / maxCol) * altCol, background: '#b1b9d8' }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="semanas-nomes">
              {dados.semanas.map((s) => (
                <span key={s.semana}>{diaMes(s.semana)}</span>
              ))}
            </div>
            <p className="texto-ajuda">Ativo é quem mandou ao menos 1 mensagem na semana (segunda a domingo, horário de São Paulo). * Semana em andamento.</p>
          </>
        ) : (
          <span className="skel" style={{ height: 260 }} />
        )}
      </Cartao>

      <Cartao g={4} titulo="Hábito" nota="dias de uso nos últimos 7 dias">
        {dados ? (
          <>
            {hab.map((h) => (
              <div key={h.nome} className="hb" style={{ gridTemplateColumns: '88px 1fr 34px' }}>
                <span className="hb-n">{h.nome}</span>
                <div className="hb-t"><i style={{ width: `${(h.v / maxHab) * 100}%` }} /></div>
                <b>{h.v}</b>
              </div>
            ))}
            <p className="rodape-cartao">Quem usa 4 dias ou mais por semana tem o hábito. É a melhor aposta de quem vai pagar quando a cobrança começar.</p>
          </>
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
      </Cartao>

      <Cartao g={12} titulo="Por semana de cadastro" nota="% dos que usaram e voltaram a usar em cada semana depois">
        {dados ? (
          dados.coortes.length ? (
            <div className="rolagem">
              <div className="mapa">
                <div className="mapa-l cab" style={{ gridTemplateColumns: '90px 100px repeat(5, 1fr)' }}>
                  <span>Cadastro em</span><span>Ativados</span>
                  {[0, 1, 2, 3, 4].map((k) => <span key={k}>Semana {k}</span>)}
                </div>
                {dados.coortes.map((c) => (
                  <div key={c.semana} className={`mapa-l ${c.n < 5 ? 'pq' : ''}`} style={{ gridTemplateColumns: '90px 100px repeat(5, 1fr)' }}>
                    <span className="sem">{diaMes(c.semana)}</span>
                    <span className="n">{n(c.n)} pessoas</span>
                    {[0, 1, 2, 3, 4].map((k) => {
                      const v = c.vals[k]
                      return v === undefined ? <div key={k} className="cel vz" /> : <div key={k} className="cel" style={{ background: calor(v) }}>{v}%</div>
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="texto-ajuda">Ainda sem clientes que tenham usado.</p>
          )
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
        <p className="texto-ajuda">Linhas apagadas têm menos de 5 pessoas: a porcentagem engana. Casas tracejadas são semanas que ainda não aconteceram.</p>
      </Cartao>
    </Pagina>
  )
}
