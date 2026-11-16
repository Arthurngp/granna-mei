import { useEffect, useState } from 'react'
import { AreaLinhas } from '../../../src/components/Graficos'
import { custoReais, reais, type Consumo } from '../custo'
import { rpc } from '../sb'
import { Carregando, Falha, NOME_SITUACAO } from './comum'

export interface Painel {
  clientes: number
  por_situacao: Record<string, number>
  novos_7d: number
  numeros_confirmados: number
  onboarding: Record<string, number>
  mensagens_hoje: number
  respondidas_hoje: number
  erros_24h: number
  ultimos_erros: { criado_em: string; tipo: string; erro: string }[]
  ultima_mensagem: string | null
  tokens_hoje: number
  tokens_mes: number
  midias_mes: number
  mensagens_por_dia: { dia: string; n: number; tokens: number }[]
  maiores_consumidores: { nome: string; negocio: string; mensagens: number; tokens: number }[]
  saude: { whatsapp_estado: string | null; whatsapp_numero: string | null; fila: number | null; atualizado_em: string } | null
}

interface Custo {
  mes: Consumo & { mensagens: number; estimadas: number; audios_sem_medida: number }
  hoje: Consumo & { mensagens: number }
  por_cliente: (Consumo & { nome: string; negocio: string; mensagens: number })[]
}

/** Custo de IA. Se a função ainda não existe no banco, devolve null e o painel segue sem o quadro. */
function useCusto() {
  const [c, setC] = useState<Custo | null>(null)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => {
    const ler = () => rpc<Custo>('admin_custo_ia').then(setC).catch(() => setFalhou(true))
    void ler()
    const t = setInterval(ler, 60_000)
    return () => clearInterval(t)
  }, [])
  return { c, falhou }
}

interface Origens {
  por_lp: { lp: string; cadastros: number; confirmados: number; pagantes: number }[]
  por_campanha: { campanha: string; cadastros: number }[]
}

/** Cadastros por LP e campanha. Se a função ainda não existe no banco, devolve null e o quadro não aparece. */
function useOrigens() {
  const [o, setO] = useState<Origens | null>(null)
  useEffect(() => {
    const ler = () => rpc<Origens>('admin_origens').then(setO).catch(() => setO(null))
    void ler()
    const t = setInterval(ler, 60_000)
    return () => clearInterval(t)
  }, [])
  return o
}

interface Midias { audio: number; foto: number; pdf: number }

/** Mídias do mês por tipo. Se a função ainda não existe no banco, devolve null e o painel mostra o total somado. */
function useMidias() {
  const [m, setM] = useState<Midias | null>(null)
  useEffect(() => {
    const ler = () => rpc<Midias>('admin_midias_mes').then(setM).catch(() => setM(null))
    void ler()
    const t = setInterval(ler, 60_000)
    return () => clearInterval(t)
  }, [])
  return m
}

/** Nome de cada passo das boas-vindas (o número é o passo mais avançado que a pessoa alcançou). */
const NOME_PASSO = ['Dados do negócio', 'Ramo', 'Contas', 'Cartões', 'Contas fixas', 'Horários', 'Confirmar WhatsApp', 'Terminou']

export function usePainel() {
  const [p, setP] = useState<Painel | null>(null)
  const [erro, setErro] = useState('')
  const recarregar = () => rpc<Painel>('admin_painel').then(setP).catch((e: Error) => setErro(e.message))
  useEffect(() => {
    void recarregar()
    const t = setInterval(recarregar, 60_000)
    return () => clearInterval(t)
  }, [])
  return { p, erro, recarregar }
}

const n = (x: number) => x.toLocaleString('pt-BR')

export function Visao() {
  const { p, erro } = usePainel()
  const { c: custo, falhou: custoFalhou } = useCusto()
  const midias = useMidias()
  const origens = useOrigens()
  if (erro) return <Falha texto={erro} />
  if (!p) return <Carregando />
  const dias = p.mensagens_por_dia
  const passos = ['0', '1', '2', '3', '4', '5', '6', '7']
  const total = Math.max(1, p.clientes)
  return (
    <div className="pagina">
      <div className="kpis">
        <div className="kpi"><small>Clientes</small><b className="num">{n(p.clientes)}</b><span>{n(p.novos_7d)} novos em 7 dias</span></div>
        <div className="kpi"><small>Pagando</small><b className="num">{n(p.por_situacao.ativa ?? 0)}</b><span>{n(p.por_situacao.cortesia ?? 0)} em cortesia</span></div>
        <div className="kpi"><small>Em teste</small><b className="num">{n(p.por_situacao.trial ?? 0)}</b><span>{n(p.por_situacao.teste_vencido ?? 0)} com teste vencido</span></div>
        <div className="kpi"><small>WhatsApp confirmado</small><b className="num">{n(p.numeros_confirmados)}</b><span>{Math.round((p.numeros_confirmados / total) * 100)}% dos clientes</span></div>
      </div>

      <div className="grade">
        <section className="card g-8">
          <div className="card-cab"><h2>Mensagens por dia (30 dias)</h2></div>
          {dias.length > 1 ? (
            <AreaLinhas labels={dias.map((d) => d.dia.slice(8, 10) + '/' + d.dia.slice(5, 7))} series={[{ nome: 'Mensagens', cor: '#454C83', valores: dias.map((d) => d.n) }]} />
          ) : (
            <p className="suave">Ainda sem mensagens suficientes para o gráfico.</p>
          )}
          <p className="suave pq" style={{ marginTop: 8 }}>O eixo mostra quantidade de mensagens, não reais.</p>
        </section>
        <section className="card g-4">
          <div className="card-cab"><h2>Situação das contas</h2></div>
          <div className="lista">
            {Object.entries(p.por_situacao).sort((a, b) => b[1] - a[1]).map(([s, q]) => (
              <div className="linha" key={s}>
                <div className="meio"><span className={`situacao s-${s}`}>{NOME_SITUACAO[s] ?? s}</span></div>
                <div className="val num">{n(q)}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="card g-6">
          <div className="card-cab"><h2>Onde as boas-vindas param</h2></div>
          <p className="suave pq" style={{ marginBottom: 10 }}>Passo mais avançado que cada pessoa alcançou. Quem terminou antes de 16/11 (6 passos) aparece em "Confirmar WhatsApp".</p>
          <div className="pilha" style={{ gap: 8 }}>
            {passos.map((ps) => {
              const q = p.onboarding[ps] ?? 0
              return (
                <div key={ps}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{NOME_PASSO[Number(ps)] ?? `Passo ${ps}`}</span><b className="num">{n(q)}</b></div>
                  <div className="prog"><i style={{ width: `${(q / total) * 100}%` }} /></div>
                </div>
              )
            })}
          </div>
        </section>
        <section className="card g-6">
          <div className="card-cab"><h2>Uso deste mês</h2></div>
          <div className="fatos">
            <div><span>Custo de IA no mês</span><span className="num">{custo ? reais(custoReais(custo.mes)) : custoFalhou ? 'indisponível' : '...'}</span></div>
            <div><span>Custo de IA hoje</span><span className="num">{custo ? reais(custoReais(custo.hoje)) : custoFalhou ? 'indisponível' : '...'}</span></div>
            {custo && custo.mes.mensagens > 0 && (
              <div><span>Custo médio por mensagem</span><span className="num">{reais(custoReais(custo.mes) / custo.mes.mensagens)}</span></div>
            )}
            <div><span>Tokens de IA no mês</span><span className="num">{n(p.tokens_mes)}</span></div>
            <div><span>Tokens hoje</span><span className="num">{n(p.tokens_hoje)}</span></div>
            {midias ? (
              <>
                <div><span>Áudios no mês</span><span className="num">{n(midias.audio)}</span></div>
                <div><span>Fotos no mês</span><span className="num">{n(midias.foto)}</span></div>
                <div><span>PDFs no mês</span><span className="num">{n(midias.pdf)}</span></div>
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
                  <div className="val num">
                    {(() => {
                      const k = custo?.por_cliente.find((x) => x.nome === c.nome && x.negocio === c.negocio)
                      return k ? reais(custoReais(k)) : `${n(c.mensagens)} msg`
                    })()}
                    <small>
                      {n(c.mensagens)} msg · {n(c.tokens)} tokens
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="suave">Ninguém usou a Granninha este mês ainda.</p>
          )}
          {custo && (
            <p className="suave pq" style={{ marginTop: 10 }}>
              Custo estimado pelo preço de tabela da OpenAI e dólar a R$ 5,50 (ajuste em admin/src/custo.ts).
              {custo.mes.estimadas > 0 ? ` ${n(custo.mes.estimadas)} mensagens antigas entram com a divisão estimada entre entrada e saída.` : ''}
              {custo.mes.audios_sem_medida > 0 ? ` ${n(custo.mes.audios_sem_medida)} áudios antigos não foram medidos e ficam de fora.` : ''}
            </p>
          )}
        </section>
        {origens && origens.por_lp.length > 0 && (
          <section className="card g-6">
            <div className="card-cab"><h2>Cadastros por página</h2></div>
            <div className="lista">
              {origens.por_lp.map((o) => (
                <div className="linha" key={o.lp}>
                  <div className="meio"><div className="tit">{o.lp === 'home' ? 'Home' : o.lp}</div><div className="det"><span>{n(o.confirmados)} confirmaram o WhatsApp</span></div></div>
                  <div className="val num">
                    {n(o.cadastros)}
                    <small>{n(o.pagantes)} pagando</small>
                  </div>
                </div>
              ))}
            </div>
            {origens.por_campanha.length > 0 && (
              <>
                <div className="card-cab" style={{ marginTop: 14 }}><h2>Cadastros por campanha</h2></div>
                <div className="fatos">
                  {origens.por_campanha.map((c) => (
                    <div key={c.campanha}><span>{c.campanha}</span><span className="num">{n(c.cadastros)}</span></div>
                  ))}
                </div>
              </>
            )}
            <p className="suave pq" style={{ marginTop: 10 }}>Página e campanha da última chegada ao site antes de criar a conta. Cadastros anteriores a 16/11 aparecem como “sem origem”.</p>
          </section>
        )}
      </div>
    </div>
  )
}
