import { useMemo } from 'react'
import { PRECO_ANUAL, PRECO_MENSAL } from '../../../../src/lib/config'
import { custoReais, reais, type Consumo } from '../../custo'
import { Carregando, Falha, NOME_SITUACAO } from '../comum'
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

/** Receita de verdade (faturas pagas), a carteira e quanto a IA custa por cliente contra o preço do plano. */
export function Receita() {
  const rec = useRpc<Rec>('admin_receita', {}, 120_000)
  const mes = hojeSP().slice(0, 7)
  const per = useMemo(() => periodoDe(mes), [mes])
  const uso = useRpc<Uso>('admin_custo_periodo', { p_inicio: per.inicio, p_fim: per.fim })

  if (rec.ausente) return <Ausente nome="admin_receita" />
  if (rec.erro) return <Falha texto={rec.erro} />
  if (!rec.dados) return <Carregando />
  const d = rec.dados

  const custoMes = uso.dados ? uso.dados.dias.reduce((s, x) => s + custoReais(x), 0) : null
  const usaram = uso.dados?.totais.clientes ?? 0
  const porCliente = custoMes !== null && usaram > 0 ? custoMes / usaram : null
  const ativas = d.carteira.filter((c) => c.situacao === 'ativa').reduce((s, c) => s + c.n, 0)

  return (
    <div className="pagina">
      <div className="kpis">
        <div className="kpi"><small>Receita paga</small><b className="num">{reais(d.faturas_pagas.total)}</b><span>{n(d.faturas_pagas.qtd)} faturas pagas</span></div>
        <div className="kpi"><small>Faturas em aberto</small><b className="num">{reais(d.faturas_abertas.total)}</b><span>{n(d.faturas_abertas.qtd)} faturas</span></div>
        <div className="kpi"><small>Contas ativas</small><b className="num">{n(ativas)}</b><span>{d.faturas_pagas.qtd === 0 ? 'nenhuma fatura paga: foram liberadas à mão' : `${n(d.faturas_pagas.qtd)} faturas pagas até hoje`}</span></div>
        <div className="kpi"><small>Em teste, ainda com acesso</small><b className="num">{n(d.trial_ate_fim)}</b><span>entram em cobrança quando o teste acabar</span></div>
      </div>

      <div className="grade">
        <section className="card g-6">
          <div className="card-cab"><h2>O que a IA custa por cliente</h2></div>
          <div className="fatos">
            <div><span>Preço do plano mensal</span><span className="num">{reais(PRECO_MENSAL)}</span></div>
            <div><span>Custo de IA no mês por cliente que usou</span><span className="num">{porCliente !== null ? reais(porCliente) : uso.carregando ? '...' : 'sem uso'}</span></div>
            <div><span>Sobra por cliente, só descontando a IA</span><span className="num">{porCliente !== null ? reais(PRECO_MENSAL - porCliente) : '–'}</span></div>
            <div><span>IA como parte do plano</span><span className="num">{porCliente !== null ? pct(porCliente, PRECO_MENSAL) : '–'}</span></div>
          </div>
          <p className="suave pq" style={{ marginTop: 10 }}>
            {mesRotulo(mes)}, até hoje. Não desconta taxa do meio de pagamento, servidor, imposto nem a equipe. É o piso do custo, não o lucro. Plano anual: {reais(PRECO_ANUAL)}.
          </p>
        </section>

        <section className="card g-6">
          <div className="card-cab"><h2>Simulação para a virada</h2></div>
          <p className="suave pq" style={{ marginBottom: 8 }}>Simulação, não previsão: quanto entraria por mês se uma parte dos {n(d.trial_ate_fim)} que estão em teste virasse plano mensal.</p>
          <div className="fatos">
            {[0.1, 0.2, 0.3].map((c) => (
              <div key={c}>
                <span>{Math.round(c * 100)}% viram assinantes ({n(Math.round(d.trial_ate_fim * c))} contas)</span>
                <span className="num">{reais(d.trial_ate_fim * c * PRECO_MENSAL)} por mês</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card g-6">
          <div className="card-cab"><h2>Carteira por situação</h2></div>
          {d.carteira.length ? (
            <div className="lista">
              {d.carteira.map((c) => (
                <div className="linha" key={c.situacao + c.plano}>
                  <div className="meio"><span className={`situacao s-${c.situacao}`}>{NOME_SITUACAO[c.situacao] ?? c.situacao}</span></div>
                  <div className="val num">{n(c.n)}<small>plano {c.plano}</small></div>
                </div>
              ))}
            </div>
          ) : (
            <p className="suave">Nenhuma conta ainda.</p>
          )}
        </section>

        <section className="card g-6">
          <div className="card-cab"><h2>Faturas pagas por mês</h2></div>
          {d.por_mes.length ? (
            <div className="fatos">
              {d.por_mes.map((m) => (
                <div key={m.mes}><span>{mesRotulo(m.mes)} · {n(m.qtd)} faturas</span><span className="num">{reais(m.total)}</span></div>
              ))}
            </div>
          ) : (
            <p className="suave">Nenhuma fatura paga ainda. A cobrança começa depois do período grátis.</p>
          )}
        </section>
      </div>
    </div>
  )
}
