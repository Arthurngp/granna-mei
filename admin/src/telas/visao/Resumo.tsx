import { AreaLinhas } from '../../../../src/components/Graficos'
import { custoReais, reais, type Consumo } from '../../custo'
import { Carregando, dataHora, Falha, NOME_SITUACAO } from '../comum'
import type { SubAba } from '../Visao'
import { usePainel } from './painel'
import { n, pct, useRpc } from './usar'

interface Custo {
  mes: Consumo & { mensagens: number }
  hoje: Consumo & { mensagens: number }
}
interface Midias {
  audio: number
  foto: number
  pdf: number
}
interface Rec {
  faturas_pagas: { qtd: number; total: number }
}

const num1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/** O negócio em uma tela: clientes, dinheiro, custo e saúde da ferramenta. Cada assunto tem a sua página. */
export function Resumo({ ir }: { ir: (s: SubAba) => void }) {
  const { p, erro } = usePainel()
  const custo = useRpc<Custo>('admin_custo_ia', {}, 60_000)
  const midias = useRpc<Midias>('admin_midias_mes', {}, 60_000)
  const rec = useRpc<Rec>('admin_receita', {}, 120_000)
  if (erro) return <Falha texto={erro} />
  if (!p) return <Carregando />

  const dias = p.mensagens_por_dia
  const total = Math.max(1, p.clientes)
  const cMes = custo.dados ? custoReais(custo.dados.mes) : null
  const cHoje = custo.dados ? custoReais(custo.dados.hoje) : null
  const s = p.saude
  const minutos = s ? (Date.now() - new Date(s.atualizado_em).getTime()) / 60_000 : Infinity
  const conectado = s?.whatsapp_estado === 'CONNECTED' && minutos <= 3
  const ativas = p.por_situacao.ativa ?? 0

  return (
    <div className="pagina">
      <div className="kpis">
        <div className="kpi"><small>Clientes</small><b className="num">{n(p.clientes)}</b><span>{n(p.novos_7d)} novos em 7 dias</span></div>
        <div className="kpi"><small>Em teste</small><b className="num">{n(p.por_situacao.trial ?? 0)}</b><span>{n(p.por_situacao.teste_vencido ?? 0)} com teste vencido</span></div>
        <div className="kpi">
          <small>Contas ativas</small>
          <b className="num">{n(ativas)}</b>
          <span>{rec.dados ? (rec.dados.faturas_pagas.qtd === 0 ? 'nenhuma fatura paga: liberadas à mão' : `${n(rec.dados.faturas_pagas.qtd)} faturas pagas`) : 'ativas ou liberadas'} · {n(p.por_situacao.cortesia ?? 0)} cortesia</span>
        </div>
        <div className="kpi"><small>WhatsApp confirmado</small><b className="num">{n(p.numeros_confirmados)}</b><span>{pct(p.numeros_confirmados, total)} dos clientes</span></div>
        <div className="kpi"><small>Receita paga</small><b className="num">{rec.dados ? reais(rec.dados.faturas_pagas.total) : '...'}</b><span>faturas pagas de verdade</span></div>
        <div className="kpi"><small>Custo de IA no mês</small><b className="num">{cMes !== null ? reais(cMes) : custo.erro ? 'indisponível' : '...'}</b><span>{cHoje !== null ? `hoje ${reais(cHoje)}` : ' '}</span></div>
        <div className="kpi"><small>Mensagens hoje</small><b className="num">{n(p.mensagens_hoje)}</b><span>{n(p.respondidas_hoje)} respondidas</span></div>
        <div className="kpi"><small>Erros nas últimas 24h</small><b className="num" style={{ color: p.erros_24h ? 'var(--out)' : undefined }}>{n(p.erros_24h)}</b><span>mensagens que falharam</span></div>
      </div>

      <div className="grade">
        <section className="card g-8">
          <div className="card-cab"><h2>Mensagens por dia (30 dias)</h2></div>
          {dias.length > 1 ? (
            <AreaLinhas
              labels={dias.map((d) => d.dia.slice(8, 10) + '/' + d.dia.slice(5, 7))}
              series={[{ nome: 'Mensagens', cor: '#454C83', valores: dias.map((d) => d.n) }]}
              formato={(v) => `${n(Math.round(v))}`}
              formatoCurto={num1}
            />
          ) : (
            <p className="suave">Ainda sem mensagens suficientes para o gráfico.</p>
          )}
          <p className="suave pq" style={{ marginTop: 8 }}>Eixo vertical em quantidade de mensagens, horizontal em dias.</p>
        </section>

        <section className="card g-4">
          <div className="card-cab"><h2>Situação das contas</h2></div>
          <div className="lista">
            {Object.entries(p.por_situacao).sort((a, b) => b[1] - a[1]).map(([sit, q]) => (
              <div className="linha" key={sit}>
                <div className="meio"><span className={`situacao s-${sit}`}>{NOME_SITUACAO[sit] ?? sit}</span></div>
                <div className="val num">{n(q)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card g-6">
          <div className="card-cab"><h2>Saúde da ferramenta</h2></div>
          <div className="fatos">
            <div><span>WhatsApp da Granninha</span><span className={conectado ? 'cor-in' : 'cor-out'}>{!s ? 'sem sinal' : minutos > 3 ? `sem sinal há ${Math.round(minutos)} min` : conectado ? 'conectado' : (s.whatsapp_estado ?? 'desconhecido')}</span></div>
            <div><span>Fila de mensagens</span><span className="num">{s?.fila ?? '–'}</span></div>
            <div><span>Última mensagem recebida</span><span className="num">{dataHora(p.ultima_mensagem)}</span></div>
            <div><span>Erros nas últimas 24h</span><span className="num">{n(p.erros_24h)}</span></div>
          </div>
          {p.ultimos_erros.length > 0 && (
            <div className="lista" style={{ marginTop: 8 }}>
              {p.ultimos_erros.map((e, i) => (
                <div className="linha" key={i}>
                  <div className="meio"><div className="tit">{e.tipo} · {dataHora(e.criado_em)}</div><div className="det"><span>{e.erro}</span></div></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card g-6">
          <div className="card-cab">
            <h2>Uso deste mês</h2>
            <button type="button" className="lnk" onClick={() => ir('custo')}>Ver custo por dia →</button>
          </div>
          <div className="fatos">
            <div><span>Tokens de IA no mês</span><span className="num">{n(p.tokens_mes)}</span></div>
            <div><span>Tokens hoje</span><span className="num">{n(p.tokens_hoje)}</span></div>
            {custo.dados && custo.dados.mes.mensagens > 0 && cMes !== null && <div><span>Custo médio por mensagem</span><span className="num">{reais(cMes / custo.dados.mes.mensagens)}</span></div>}
            {midias.dados ? (
              <>
                <div><span>Áudios no mês</span><span className="num">{n(midias.dados.audio)}</span></div>
                <div><span>Fotos no mês</span><span className="num">{n(midias.dados.foto)}</span></div>
                <div><span>PDFs no mês</span><span className="num">{n(midias.dados.pdf)}</span></div>
              </>
            ) : (
              <div><span>Áudios, fotos e PDFs</span><span className="num">{n(p.midias_mes)}</span></div>
            )}
          </div>
          <div className="card-cab" style={{ marginTop: 14 }}><h2>Quem mais usa</h2></div>
          {p.maiores_consumidores.length ? (
            <div className="lista">
              {p.maiores_consumidores.map((c) => (
                <div className="linha" key={c.nome + c.negocio}>
                  <div className="meio"><div className="tit">{c.nome}</div><div className="det"><span>{c.negocio}</span></div></div>
                  <div className="val num">{n(c.mensagens)} msg<small>{n(c.tokens)} tokens</small></div>
                </div>
              ))}
            </div>
          ) : (
            <p className="suave">Ninguém usou a Granninha este mês ainda.</p>
          )}
        </section>

        <section className="card">
          <div className="card-cab"><h2>Por onde ir a fundo</h2></div>
          <div className="atalhos">
            <button type="button" onClick={() => ir('custo')}><b>Custo de IA</b><span>por mês, por dia, dias fora do padrão e por cliente</span></button>
            <button type="button" onClick={() => ir('ativacao')}><b>Ativação</b><span>onde as boas-vindas perdem gente, por semana de cadastro</span></button>
            <button type="button" onClick={() => ir('trafego')}><b>Tráfego</b><span>cadastros por página e por campanha</span></button>
            <button type="button" onClick={() => ir('receita')}><b>Receita</b><span>faturas pagas, carteira e custo de IA por cliente</span></button>
          </div>
        </section>
      </div>
    </div>
  )
}
