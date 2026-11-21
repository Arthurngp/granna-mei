import { useMemo } from 'react'
import { PRECO_ANUAL, PRECO_MENSAL } from '../../../../src/lib/config'
import { custoReais, reais, type Consumo } from '../../custo'
import { Falha, NOME_SITUACAO } from '../comum'
import { Cartao, Pagina, type HeadDef } from './layout'
import { Ausente, hojeSP, mesRotulo, n, pct, periodoDe, useRpc } from './usar'

interface Rec {
  faturas_pagas: { qtd: number; total: number }
  faturas_abertas: { qtd: number; total: number }
  por_mes: { mes: string; qtd: number; total: number }[]
  carteira: { situacao: string; plano: string; n: number }[]
  trial_ate_fim: number
}
interface Uso {
  dias: (Consumo & { dia: string })[]
  totais: { mensagens: number; clientes: number }
}

const COR: Record<string, string> = { trial: '#454c83', ativa: '#0e8250', cortesia: '#7a4fb5', teste_vencido: '#cc3340', bloqueada: '#8a90b0', atrasada: '#9a6408' }

/** Receita de verdade (faturas pagas), a carteira e quanto a IA pesa em cada plano. */
export function Receita() {
  const rec = useRpc<Rec>('admin_receita', {}, 120_000)
  const mes = hojeSP().slice(0, 7)
  const per = useMemo(() => periodoDe(mes), [mes])
  const uso = useRpc<Uso>('admin_custo_periodo', { p_inicio: per.inicio, p_fim: per.fim })

  if (rec.ausente) return <Pagina titulo="Receita" heads={[]}><Ausente nome="admin_receita" /></Pagina>
  if (rec.erro) return <Pagina titulo="Receita" heads={[]}><Falha texto={rec.erro} /></Pagina>

  const d = rec.dados
  const custoMes = uso.dados ? uso.dados.dias.reduce((s, x) => s + custoReais(x), 0) : null
  const usaram = uso.dados?.totais.clientes ?? 0
  const porCliente = custoMes !== null && usaram > 0 ? custoMes / usaram : null
  const ativas = d ? d.carteira.filter((c) => c.situacao === 'ativa').reduce((s, c) => s + c.n, 0) : 0
  const totalCarteira = d ? d.carteira.reduce((s, c) => s + c.n, 0) : 0

  const heads: HeadDef[] | undefined = d
    ? [
        { rotulo: 'Receita paga', valor: reais(d.faturas_pagas.total), nota: d.faturas_pagas.qtd === 0 ? 'nenhuma fatura paga ainda' : `${n(d.faturas_pagas.qtd)} faturas pagas` },
        { rotulo: 'Contas ativas', valor: n(ativas), nota: d.faturas_pagas.qtd === 0 ? 'liberadas à mão, sem fatura' : 'ativas ou liberadas' },
        { rotulo: 'Em teste, com acesso', valor: n(d.trial_ate_fim), nota: 'entram em cobrança quando o teste acabar' },
        { rotulo: 'IA por cliente no mês', valor: porCliente !== null ? reais(porCliente) : '–', nota: porCliente !== null ? `${pct(porCliente, PRECO_MENSAL)} do plano mensal` : 'sem uso no mês' },
      ]
    : undefined

  return (
    <Pagina titulo="Receita" subtitulo="O que entrou de verdade e quanto a IA pesa em cada plano" heads={heads}>
      <Cartao g={6} titulo={`De cada plano de ${reais(PRECO_MENSAL)}`} nota="só descontando a IA">
        {porCliente !== null ? (
          <>
            <div className="plano-v">
              <b>{reais(PRECO_MENSAL - porCliente)}</b>
              <span>sobram por cliente</span>
            </div>
            <div className="pilha-sit" style={{ height: 34, borderRadius: 10 }}>
              <i style={{ width: `${(porCliente / PRECO_MENSAL) * 100}%`, background: '#cc3340', minWidth: 3 }} />
              <i style={{ flex: 1, background: '#0e8250' }} />
            </div>
            <div className="plano-leg">
              <span><i style={{ background: '#cc3340' }} />IA <b>{reais(porCliente)}</b></span>
              <span><i style={{ background: '#0e8250' }} />Sobra <b>{reais(PRECO_MENSAL - porCliente)}</b></span>
            </div>
          </>
        ) : uso.ausente ? (
          <p className="texto-ajuda">Falta aplicar a migration 20261121140000.</p>
        ) : (
          <span className="skel" style={{ height: 110 }} />
        )}
        <p className="rodape-cartao">{mesRotulo(mes)}, até hoje. Ainda sem descontar taxa do meio de pagamento, servidor, imposto e equipe: é o piso do custo, não o lucro. Plano anual: {reais(PRECO_ANUAL)}.</p>
      </Cartao>

      <Cartao g={6} titulo="Simulação para a virada" nota="não é previsão">
        {d ? (
          <>
            <div className="sim">
              {[0.1, 0.2, 0.3].map((c) => (
                <div key={c}>
                  <div className="v">{reais(d.trial_ate_fim * c * PRECO_MENSAL)}</div>
                  <div className="b" style={{ height: `${c * 100 * 2.2}%` }} />
                </div>
              ))}
            </div>
            <div className="sim-n">
              {[0.1, 0.2, 0.3].map((c) => (
                <span key={c}>{Math.round(c * 100)}% dos {n(d.trial_ate_fim)}<br />{n(Math.round(d.trial_ate_fim * c))} contas</span>
              ))}
            </div>
            <p className="rodape-cartao">Por mês, se essa parte dos que estão em teste virasse plano mensal.</p>
          </>
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
      </Cartao>

      <Cartao g={6} titulo="Carteira">
        {d ? (
          d.carteira.length ? (
            <>
              <div className="pilha-sit">
                {d.carteira.map((c) => (
                  <i key={c.situacao + c.plano} style={{ width: `${(c.n / Math.max(1, totalCarteira)) * 100}%`, background: COR[c.situacao] ?? '#8a90b0' }} />
                ))}
              </div>
              <div className="linhas">
                {d.carteira.map((c) => (
                  <div className="sit" key={c.situacao + c.plano} style={{ padding: '11px 0' }}>
                    <i style={{ background: COR[c.situacao] ?? '#8a90b0' }} />
                    {NOME_SITUACAO[c.situacao] ?? c.situacao}
                    <b>{n(c.n)}</b>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="texto-ajuda">Nenhuma conta ainda.</p>
          )
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
      </Cartao>

      <Cartao g={6} titulo="Faturas pagas por mês">
        {d ? (
          d.por_mes.length ? (
            d.por_mes.map((m) => (
              <div className="fato" key={m.mes}>
                <span>{mesRotulo(m.mes)} · {n(m.qtd)} faturas</span>
                <b>{reais(m.total)}</b>
              </div>
            ))
          ) : (
            <div className="vvazio">Nenhuma fatura paga ainda.<br />Quando a cobrança começar, cada mês aparece aqui.</div>
          )
        ) : (
          <span className="skel" style={{ height: 160 }} />
        )}
      </Cartao>
    </Pagina>
  )
}
