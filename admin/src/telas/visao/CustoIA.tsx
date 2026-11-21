import { useEffect, useMemo, useState } from 'react'
import { PRECO_MENSAL } from '../../../../src/lib/config'
import { CAMBIO, custoReais, PRECO_USD, reais, type Consumo } from '../../custo'
import { Carregando, Falha } from '../comum'
import { Barras } from './Barras'
import { Ausente, diaCurto, diaLongo, hojeSP, mediana, mesRotulo, n, pct, periodoDe, reaisCurto, useRpc } from './usar'

interface Dia extends Consumo {
  dia: string
  mensagens: number
  clientes: number
}
interface Periodo {
  inicio: string
  fim: string
  dias: Dia[]
  totais: { mensagens: number; clientes: number; estimadas: number; audios_sem_medida: number }
  por_cliente: (Consumo & { user_id: string; nome: string; negocio: string; mensagens: number })[]
  meses: string[]
}

type Modo = 'custo' | 'mensagens' | 'porMensagem'
const MODOS: [Modo, string][] = [
  ['custo', 'Custo do dia'],
  ['mensagens', 'Mensagens'],
  ['porMensagem', 'Custo por mensagem'],
]

const soma = (ds: Consumo[]): Consumo => ds.reduce((a, d) => ({ entrada: a.entrada + d.entrada, saida: a.saida + d.saida, audio_tokens: a.audio_tokens + d.audio_tokens, audio_seg: a.audio_seg + d.audio_seg }), { entrada: 0, saida: 0, audio_tokens: 0, audio_seg: 0 })

export function CustoIA() {
  const mesAtual = hojeSP().slice(0, 7)
  const [sel, setSel] = useState(mesAtual)
  const [modo, setModo] = useState<Modo>('custo')
  const [meses, setMeses] = useState<string[]>([mesAtual])
  const per = useMemo(() => periodoDe(sel), [sel])
  const { dados, erro, ausente, carregando } = useRpc<Periodo>('admin_custo_periodo', { p_inicio: per.inicio, p_fim: per.fim })

  useEffect(() => {
    if (dados?.meses) setMeses(Array.from(new Set([mesAtual, ...dados.meses])).sort().reverse())
  }, [dados, mesAtual])

  const a = useMemo(() => {
    if (!dados) return null
    const dias = dados.dias
    const custos = dias.map(custoReais)
    const total = custos.reduce((x, y) => x + y, 0)
    const msgs = dados.totais.mensagens
    const comUso = dias.filter((_, i) => custos[i] > 0)
    const medCusto = comUso.length >= 5 ? mediana(custos.filter((c) => c > 0)) : 0
    const medMsgs = comUso.length >= 5 ? mediana(comUso.map((d) => d.mensagens)) : 0
    const medCpm = comUso.length >= 5 ? mediana(comUso.map((d) => custoReais(d) / Math.max(1, d.mensagens))) : 0
    // Pico = mais que o dobro da mediana dos dias com uso, e pelo menos R$ 0,25 acima dela (evita marcar R$ 0,02 contra R$ 0,01).
    const pico = custos.map((c) => medCusto > 0 && c > medCusto * 2 && c - medCusto >= 0.25)
    const picos = dias
      .map((d, i) => ({ d, c: custos[i], i }))
      .filter((x) => pico[x.i])
      .sort((x, y) => y.c - x.c)
      .map((x) => {
        const cpm = x.c / Math.max(1, x.d.mensagens)
        const causa = x.d.mensagens > medMsgs * 1.8 ? 'mais mensagens que o normal' : cpm > medCpm * 1.5 ? 'cada mensagem saiu mais cara (áudio ou conversa longa)' : 'volume e custo acima do normal'
        return { ...x, cpm, causa }
      })
    const decorridos = dias.length
    const mesCorrente = sel === mesAtual
    const [ano, mes] = sel.split('-').map(Number)
    const diasDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
    const projecao = mesCorrente && decorridos >= 3 ? (total / decorridos) * diasDoMes : null
    const tot = soma(dias)
    return {
      custos,
      total,
      msgs,
      pico,
      picos,
      medCusto,
      projecao,
      decorridos,
      porDia: decorridos ? total / decorridos : 0,
      porMsg: msgs ? total / msgs : 0,
      porCliente: dados.totais.clientes ? total / dados.totais.clientes : 0,
      partes: {
        entrada: custoReais({ ...tot, saida: 0, audio_tokens: 0, audio_seg: 0 }),
        saida: custoReais({ ...tot, entrada: 0, audio_tokens: 0, audio_seg: 0 }),
        audio: custoReais({ ...tot, entrada: 0, saida: 0 }),
      },
    }
  }, [dados, sel, mesAtual])

  const seletor = (
    <div className="filtro">
      <label className="campo" style={{ margin: 0 }}>
        <span>Período</span>
        <select className="entrada" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="30d">Últimos 30 dias</option>
          {meses.map((m) => (
            <option key={m} value={m}>
              {mesRotulo(m)}
              {m === mesAtual ? ' (mês atual)' : ''}
            </option>
          ))}
        </select>
      </label>
      {carregando && dados && <span className="suave pq">atualizando…</span>}
    </div>
  )

  if (ausente) return <Ausente nome="admin_custo_periodo" />
  if (erro) return <Falha texto={erro} />
  if (!dados || !a) return <Carregando />

  const vazio = dados.totais.mensagens === 0
  const dias = dados.dias
  const valores = modo === 'custo' ? a.custos : modo === 'mensagens' ? dias.map((d) => d.mensagens) : dias.map((d) => (d.mensagens ? a.custos[dias.indexOf(d)] / d.mensagens : 0))
  const mediaRef = modo === 'custo' && a.medCusto > 0 ? { valor: a.medCusto, rotulo: `mediana ${reais(a.medCusto)}` } : undefined

  return (
    <div className="pagina" style={{ opacity: carregando && dados ? 0.6 : 1, transition: 'opacity 0.2s' }}>
      {seletor}

      {vazio ? (
        <section className="card">
          <p className="suave">Nenhuma mensagem em {sel === '30d' ? 'os últimos 30 dias' : mesRotulo(sel)}. Escolha outro período.</p>
        </section>
      ) : (
        <>
          <div className="kpis kpis-6">
            <div className="kpi"><small>Custo no período</small><b className="num">{reais(a.total)}</b><span>{a.projecao !== null ? `projeção do mês: ${reais(a.projecao)}` : `${n(a.decorridos)} dias`}</span></div>
            <div className="kpi"><small>Média por dia</small><b className="num">{reais(a.porDia)}</b><span>{n(dados.totais.mensagens)} mensagens</span></div>
            <div className="kpi"><small>Custo por mensagem</small><b className="num">{reais(a.porMsg)}</b><span>média do período</span></div>
            <div className="kpi"><small>Clientes que usaram</small><b className="num">{n(dados.totais.clientes)}</b><span>mandaram ao menos 1 mensagem</span></div>
            <div className="kpi"><small>Custo por cliente</small><b className="num">{reais(a.porCliente)}</b><span>{pct(a.porCliente, PRECO_MENSAL)} do plano de {reais(PRECO_MENSAL)}</span></div>
            <div className="kpi"><small>Dias fora do padrão</small><b className="num" style={{ color: a.picos.length ? 'var(--out)' : undefined }}>{n(a.picos.length)}</b><span>{a.medCusto > 0 ? 'mais que o dobro da mediana' : 'poucos dias para comparar'}</span></div>
          </div>

          <div className="grade">
            <section className="card g-8">
              <div className="card-cab">
                <h2>Por dia</h2>
                <div className="seg" role="group" aria-label="O que mostrar no gráfico">
                  {MODOS.map(([v, r]) => (
                    <button key={v} type="button" aria-pressed={modo === v} onClick={() => setModo(v)}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <Barras
                nome={`Gráfico de barras por dia: ${MODOS.find(([v]) => v === modo)?.[1]}`}
                valores={valores}
                rotulos={dias.map((d) => diaCurto(d.dia))}
                titulos={dias.map((d) => diaLongo(d.dia))}
                formato={modo === 'mensagens' ? (v) => `${n(v)} mensagens` : modo === 'porMensagem' ? (v) => `${reais(v)} por mensagem` : (v) => reais(v)}
                formatoCurto={modo === 'mensagens' ? (v) => n(Math.round(v)) : modo === 'porMensagem' ? (v) => `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}` : reaisCurto}
                destaque={modo === 'custo' ? a.pico : undefined}
                referencia={mediaRef}
                extra={(i) => [`${n(dias[i].mensagens)} mensagens · ${n(dias[i].clientes)} clientes`, ...(a.pico[i] ? ['dia fora do padrão'] : [])]}
              />
              <p className="suave pq" style={{ marginTop: 8 }}>
                {modo === 'custo' ? 'Eixo vertical em reais, horizontal em dias. Barra vermelha = dia com mais que o dobro da mediana.' : modo === 'mensagens' ? 'Eixo vertical em quantidade de mensagens, horizontal em dias.' : 'Eixo vertical em reais por mensagem, horizontal em dias. Sobe quando entram áudios ou conversas longas.'}
              </p>
            </section>

            <section className="card g-4">
              <div className="card-cab"><h2>Para onde vai o custo</h2></div>
              <div className="fatos">
                <div><span>Texto lido (entrada)</span><span className="num">{reais(a.partes.entrada)} <small className="suave">{pct(a.partes.entrada, a.total)}</small></span></div>
                <div><span>Texto escrito (saída)</span><span className="num">{reais(a.partes.saida)} <small className="suave">{pct(a.partes.saida, a.total)}</small></span></div>
                <div><span>Áudio transcrito</span><span className="num">{reais(a.partes.audio)} <small className="suave">{pct(a.partes.audio, a.total)}</small></span></div>
              </div>
              <div className="card-cab" style={{ marginTop: 14 }}><h2>Dias fora do padrão</h2></div>
              {a.picos.length ? (
                <div className="lista">
                  {a.picos.slice(0, 6).map((p) => (
                    <div className="linha" key={p.d.dia}>
                      <div className="meio"><div className="tit">{diaLongo(p.d.dia)}</div><div className="det"><span>{p.causa}</span></div></div>
                      <div className="val num">{reais(p.c)}<small>{n(p.d.mensagens)} msg · {reais(p.cpm)}/msg</small></div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="suave">{a.medCusto > 0 ? 'Nenhum dia passou do dobro da mediana.' : 'Precisa de pelo menos 5 dias com uso para comparar.'}</p>
              )}
            </section>

            <section className="card">
              <div className="card-cab"><h2>Quem mais gastou</h2></div>
              {dados.por_cliente.length ? (
                <div className="lista">
                  {dados.por_cliente.slice(0, 10).map((c) => {
                    const custo = custoReais(c)
                    return (
                      <div className="linha" key={c.user_id}>
                        <div className="meio"><div className="tit">{c.nome || 'Sem nome'}</div><div className="det"><span>{c.negocio || 'Sem negócio'}</span></div></div>
                        <div className="val num">{reais(custo)}<small>{n(c.mensagens)} msg · {pct(custo, a.total)} do total</small></div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="suave">Ninguém usou neste período.</p>
              )}
            </section>
          </div>

          <p className="suave pq">
            Custo estimado pelo preço de tabela da OpenAI (entrada US$ {PRECO_USD.entrada.toLocaleString('pt-BR')} e saída US$ {PRECO_USD.saida.toLocaleString('pt-BR')} por milhão de tokens) e dólar a R$ {CAMBIO.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}; ajuste em admin/src/custo.ts. Dias contados no horário de São Paulo.
            {dados.totais.estimadas > 0 ? ` ${n(dados.totais.estimadas)} mensagens antigas entram com a divisão estimada entre entrada e saída.` : ''}
            {dados.totais.audios_sem_medida > 0 ? ` ${n(dados.totais.audios_sem_medida)} áudios antigos não foram medidos e ficam de fora.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
