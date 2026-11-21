import { useEffect, useMemo, useState } from 'react'
import { PRECO_MENSAL } from '../../../../src/lib/config'
import { CAMBIO, custoReais, PRECO_USD, reais, type Consumo } from '../../custo'
import { Falha } from '../comum'
import { AreaDia } from './graficos'
import { Cartao, Gaveta, Pagina, type HeadDef } from './layout'
import { Ausente, diaLongo, hojeSP, mediana, mesRotulo, n, pct, periodoDe, reaisCurto, useRpc } from './usar'
import { diaMes } from './util'

interface Dia extends Consumo {
  dia: string
  mensagens: number
  clientes: number
}
interface Cli extends Consumo {
  user_id: string
  nome: string
  negocio: string
  mensagens: number
}
interface Periodo {
  inicio: string
  fim: string
  dias: Dia[]
  totais: { mensagens: number; clientes: number; estimadas: number; audios_sem_medida: number }
  por_cliente: Cli[]
  meses: string[]
}

type Modo = 'custo' | 'mensagens' | 'porMensagem'
const MODOS: [Modo, string][] = [
  ['custo', 'Custo do dia'],
  ['mensagens', 'Mensagens'],
  ['porMensagem', 'Por mensagem'],
]

const soma = (ds: Consumo[]): Consumo => ds.reduce((a, d) => ({ entrada: a.entrada + d.entrada, saida: a.saida + d.saida, audio_tokens: a.audio_tokens + d.audio_tokens, audio_seg: a.audio_seg + d.audio_seg }), { entrada: 0, saida: 0, audio_tokens: 0, audio_seg: 0 })

const somaDias = (iso: string, d: number) => {
  const x = new Date(`${iso}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + d)
  return x.toISOString().slice(0, 10)
}

/** Período anterior de mesmo tamanho: o mês anterior (do dia 1 em diante) ou os 30 dias antes. */
function anteriorDe(sel: string, qtd: number) {
  const { inicio } = periodoDe(sel)
  if (sel === '30d') return { inicio: somaDias(inicio, -30), fim: somaDias(inicio, -1) }
  const [a, m] = sel.split('-').map(Number)
  const pa = m === 1 ? a - 1 : a
  const pm = m === 1 ? 12 : m - 1
  const ini = `${pa}-${String(pm).padStart(2, '0')}-01`
  const ultimo = new Date(Date.UTC(pa, pm, 0)).getUTCDate()
  return { inicio: ini, fim: somaDias(ini, Math.min(qtd, ultimo) - 1) }
}

export function CustoIA() {
  const mesAtual = hojeSP().slice(0, 7)
  const [sel, setSel] = useState(mesAtual)
  const [modo, setModo] = useState<Modo>('custo')
  const [comparar, setComparar] = useState(true)
  const [meses, setMeses] = useState<string[]>([mesAtual])
  const [gav, setGav] = useState<{ t: 'dia'; i: number } | { t: 'cli'; c: Cli } | null>(null)

  const per = useMemo(() => periodoDe(sel), [sel])
  const atual = useRpc<Periodo>('admin_custo_periodo', { p_inicio: per.inicio, p_fim: per.fim })
  const qtd = atual.dados?.dias.length ?? 0
  const ant = useMemo(() => (qtd ? anteriorDe(sel, qtd) : null), [sel, qtd])
  const anterior = useRpc<Periodo>('admin_custo_periodo', ant ? { p_inicio: ant.inicio, p_fim: ant.fim } : { p_inicio: per.inicio, p_fim: per.inicio })

  useEffect(() => {
    if (atual.dados?.meses) setMeses(Array.from(new Set([mesAtual, ...atual.dados.meses])).sort().reverse())
  }, [atual.dados, mesAtual])

  const a = useMemo(() => {
    const d = atual.dados
    if (!d) return null
    const dias = d.dias
    const custos = dias.map(custoReais)
    const total = custos.reduce((x, y) => x + y, 0)
    const usados = custos.filter((c) => c > 0)
    const medCusto = usados.length >= 5 ? mediana(usados) : 0
    const comUso = dias.filter((_, i) => custos[i] > 0)
    const medMsgs = comUso.length >= 5 ? mediana(comUso.map((x) => x.mensagens)) : 0
    // Pico = mais que o dobro da mediana dos dias com uso e ao menos R$ 0,25 acima dela.
    const pico = custos.map((c) => medCusto > 0 && c > medCusto * 2 && c - medCusto >= 0.25)
    const picos = dias
      .map((x, i) => ({ x, i, c: custos[i] }))
      .filter((p) => pico[p.i])
      .sort((p, q) => q.c - p.c)
      .map((p) => ({ ...p, volume: p.x.mensagens > medMsgs * 1.8, cpm: p.c / Math.max(1, p.x.mensagens) }))
    const tot = soma(dias)
    const parte = {
      entrada: custoReais({ ...tot, saida: 0, audio_tokens: 0, audio_seg: 0 }),
      saida: custoReais({ ...tot, entrada: 0, audio_tokens: 0, audio_seg: 0 }),
      audio: custoReais({ ...tot, entrada: 0, saida: 0 }),
    }
    const [ano, mes] = sel === '30d' ? [0, 0] : sel.split('-').map(Number)
    const diasMes = sel === '30d' ? 0 : new Date(Date.UTC(ano, mes, 0)).getUTCDate()
    return { dias, custos, total, medCusto, medMsgs, pico, picos, parte, msgs: d.totais.mensagens, clientes: d.totais.clientes, proj: sel === mesAtual && dias.length >= 3 ? (total / dias.length) * diasMes : null }
  }, [atual.dados, sel, mesAtual])

  const serie = (ds: Dia[], cs: number[]) => (modo === 'custo' ? cs : modo === 'mensagens' ? ds.map((x) => x.mensagens) : ds.map((x, i) => (x.mensagens ? cs[i] / x.mensagens : 0)))
  const prevDados = comparar && anterior.dados && anterior.dados.dias.length > 1 ? anterior.dados.dias : null

  const controles = (
    <>
      <select className="sel" aria-label="Período" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="30d">Últimos 30 dias</option>
        {meses.map((m) => (
          <option key={m} value={m}>
            {mesRotulo(m)}
            {m === mesAtual ? ' (atual)' : ''}
          </option>
        ))}
      </select>
      <button type="button" className={`vchave ${comparar ? 'on' : ''}`} aria-pressed={comparar} onClick={() => setComparar(!comparar)}>
        <i />
        Comparar com o período anterior
      </button>
    </>
  )

  if (atual.ausente) return <Pagina titulo="Custo de IA" subtitulo="Quanto a IA custa, por dia e por cliente" quantos={4}><Ausente nome="admin_custo_periodo" /></Pagina>
  if (atual.erro) return <Pagina titulo="Custo de IA" quantos={4}><Falha texto={atual.erro} /></Pagina>

  const vazio = !!a && a.msgs === 0
  const heads: HeadDef[] | undefined = a
    ? [
        { rotulo: 'Custo no período', valor: reais(a.total), nota: a.proj !== null ? `projeção do mês: ${reais(a.proj)}` : `${n(a.dias.length)} dias`, spark: a.custos },
        { rotulo: 'Média por dia', valor: reais(a.dias.length ? a.total / a.dias.length : 0), nota: `${n(a.msgs)} mensagens`, spark: a.dias.map((x) => x.mensagens) },
        { rotulo: 'Por mensagem', valor: reais(a.msgs ? a.total / a.msgs : 0), nota: 'média do período', spark: a.dias.map((x, i) => (x.mensagens ? a.custos[i] / x.mensagens : 0)) },
        { rotulo: 'Por cliente que usou', valor: reais(a.clientes ? a.total / a.clientes : 0), nota: `${a.clientes ? pct(a.total / a.clientes, PRECO_MENSAL) : '–'} do plano de ${reais(PRECO_MENSAL)} · ${n(a.clientes)} clientes` },
      ]
    : undefined

  const vals = a ? serie(a.dias, a.custos) : []
  const prevVals = prevDados && a ? serie(prevDados, prevDados.map(custoReais)) : undefined
  const fmt = modo === 'mensagens' ? (v: number) => `${n(Math.round(v))} mensagens` : modo === 'porMensagem' ? (v: number) => `${reais(v)} por mensagem` : (v: number) => reais(v)
  const fmtCurto = modo === 'mensagens' ? (v: number) => n(Math.round(v)) : modo === 'porMensagem' ? (v: number) => `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}` : reaisCurto

  const C = 2 * Math.PI * 52
  const partes = a
    ? [
        { nome: 'Texto lido (entrada)', v: a.parte.entrada, cor: '#454c83' },
        { nome: 'Texto escrito (saída)', v: a.parte.saida, cor: '#747ead' },
        { nome: 'Áudio transcrito', v: a.parte.audio, cor: '#8fe9b8' },
      ]
    : []
  let acc = 0

  const diaAberto = gav?.t === 'dia' && a ? { i: gav.i, x: a.dias[gav.i], c: a.custos[gav.i] } : null

  return (
    <Pagina titulo="Custo de IA" subtitulo={sel === '30d' ? 'Últimos 30 dias' : sel === mesAtual ? `${mesRotulo(sel)}, até hoje` : mesRotulo(sel)} controles={controles} heads={heads}>
      {vazio ? (
        <Cartao g={12}>
          <p className="texto-ajuda" style={{ margin: 0 }}>Nenhuma mensagem em {sel === '30d' ? 'os últimos 30 dias' : mesRotulo(sel)}. Escolha outro período.</p>
        </Cartao>
      ) : (
        <>
          <Cartao
            g={8}
            titulo="Por dia"
            lado={
              <div className="vseg" role="group" aria-label="O que mostrar">
                {MODOS.map(([v, r]) => (
                  <button key={v} type="button" className={modo === v ? 'on' : ''} aria-pressed={modo === v} onClick={() => setModo(v)}>
                    {r}
                  </button>
                ))}
              </div>
            }
          >
            {a ? (
              <>
                <AreaDia
                  nome={`Gráfico por dia: ${MODOS.find(([v]) => v === modo)?.[1]}`}
                  valores={vals}
                  anterior={prevVals}
                  rotulos={a.dias.map((x) => diaMes(x.dia))}
                  titulos={a.dias.map((x) => diaLongo(x.dia))}
                  formato={fmt}
                  formatoCurto={fmtCurto}
                  picos={modo === 'custo' ? a.pico : undefined}
                  aoPico={(i) => setGav({ t: 'dia', i })}
                  extra={(i) => [`${n(a.dias[i].mensagens)} mensagens · ${n(a.dias[i].clientes)} clientes`, ...(a.pico[i] ? ['dia fora do padrão'] : [])]}
                />
                <div className="leg" style={{ marginTop: 10 }}>
                  <span><i />Este período</span>
                  {prevVals && <span><i className="p" />Período anterior</span>}
                  {modo === 'custo' && a.picos.length > 0 && <span><i className="r" />Dia fora do padrão</span>}
                </div>
              </>
            ) : (
              <span className="skel" style={{ height: 260 }} />
            )}
          </Cartao>

          <Cartao g={4} titulo="Para onde vai o custo">
            {a ? (
              <>
                <div className="vrosca">
                  <div className="anel" style={{ width: 132, height: 132 }}>
                    <svg viewBox="0 0 140 140" width="132" height="132" aria-hidden="true">
                      <circle cx="70" cy="70" r="52" fill="none" stroke="#eceef7" strokeWidth="18" />
                      {partes.map((p) => {
                        const f = a.total > 0 ? p.v / a.total : 0
                        const el = <circle key={p.nome} cx="70" cy="70" r="52" fill="none" stroke={p.cor} strokeWidth="18" strokeDasharray={`${Math.max(0, C * f - 3)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />
                        acc += C * f
                        return el
                      })}
                    </svg>
                    <span style={{ fontSize: 16 }}>{reais(a.total)}</span>
                  </div>
                  <div className="rosca-leg">
                    {partes.map((p) => (
                      <div key={p.nome}>
                        <i style={{ background: p.cor }} />
                        {p.nome}
                        <b>
                          {reais(p.v)}
                          <small>{pct(p.v, a.total)}</small>
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="cartao-cab" style={{ marginTop: 22 }}>
                  <h2>Dias fora do padrão</h2>
                </div>
                {modo === 'custo' && a.picos.length === 0 && <p className="texto-ajuda" style={{ margin: 0 }}>{a.medCusto > 0 ? 'Nenhum dia passou do dobro da mediana.' : 'Precisa de pelo menos 5 dias com uso para comparar.'}</p>}
                <div className="linhas">
                  {a.picos.slice(0, 6).map((p) => (
                    <button key={p.x.dia} type="button" className="pico-l" onClick={() => setGav({ t: 'dia', i: p.i })}>
                      <i />
                      <div>
                        <b>{diaLongo(p.x.dia)}</b>
                        <span>{p.volume ? 'mais mensagens que o normal' : 'mensagens mais caras (áudio ou conversa longa)'}</span>
                      </div>
                      <div className="v">
                        {reais(p.c)}
                        <span>{n(p.x.mensagens)} msg</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="skel" style={{ height: 240 }} />
            )}
          </Cartao>

          <Cartao g={12} titulo="Quem mais gastou" nota="toque num cliente para ver o detalhe">
            {a ? (
              <div className="linhas">
                {atual.dados?.por_cliente.slice(0, 10).map((c) => {
                  const custo = custoReais(c)
                  const max = atual.dados ? custoReais(atual.dados.por_cliente[0]) : 1
                  return (
                    <button key={c.user_id} type="button" className="cli-l" onClick={() => setGav({ t: 'cli', c })}>
                      <div>
                        <b>{c.nome || 'Sem nome'}</b>
                        <span className="s">{c.negocio || 'Sem negócio'}</span>
                      </div>
                      <div className="cli-b"><i style={{ width: `${max > 0 ? (custo / max) * 100 : 0}%` }} /></div>
                      <div className="cli-v">
                        {reais(custo)}
                        <span>{pct(custo, a.total)} do total</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <span className="skel" style={{ height: 220 }} />
            )}
          </Cartao>

          {atual.dados && (
            <p className="texto-ajuda g12-nota">
              Custo estimado pelo preço de tabela da OpenAI (entrada US$ {PRECO_USD.entrada.toLocaleString('pt-BR')} e saída US$ {PRECO_USD.saida.toLocaleString('pt-BR')} por milhão de tokens) e dólar a R$ {CAMBIO.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}; ajuste em admin/src/custo.ts. Dias no horário de São Paulo.
              {atual.dados.totais.estimadas > 0 ? ` ${n(atual.dados.totais.estimadas)} mensagens antigas entram com a divisão estimada entre entrada e saída.` : ''}
              {atual.dados.totais.audios_sem_medida > 0 ? ` ${n(atual.dados.totais.audios_sem_medida)} áudios antigos não foram medidos e ficam de fora.` : ''}
            </p>
          )}
        </>
      )}

      <Gaveta aberta={!!gav} onFechar={() => setGav(null)} rotulo="Detalhe">
        {diaAberto && a && (
          <>
            <span className="k">Dia fora do padrão</span>
            <h3>{diaLongo(diaAberto.x.dia)}</h3>
            <div className="grande">{reais(diaAberto.c)}</div>
            <div className="tres">
              <div><small>Mensagens</small><b>{n(diaAberto.x.mensagens)}</b></div>
              <div><small>Por mensagem</small><b>{reais(diaAberto.c / Math.max(1, diaAberto.x.mensagens))}</b></div>
              <div><small>Clientes</small><b>{n(diaAberto.x.clientes)}</b></div>
            </div>
            <div className={`por ${a.pico[diaAberto.i] ? '' : 'ok'}`}>
              {!a.pico[diaAberto.i]
                ? 'Este dia está dentro do padrão.'
                : diaAberto.x.mensagens > a.medMsgs * 1.8
                  ? `Foi volume: ${n(diaAberto.x.mensagens)} mensagens, ${(diaAberto.x.mensagens / Math.max(1, a.medMsgs)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} vezes a mediana dos dias (${n(a.medMsgs)}). O custo por mensagem ficou normal.`
                  : `Foi mensagem cara: o volume ficou perto do normal, mas cada mensagem custou ${reais(diaAberto.c / Math.max(1, diaAberto.x.mensagens))}. Costuma ser áudio ou conversa longa.`}
            </div>
            <p className="texto-ajuda">Mediana dos dias com uso: {reais(a.medCusto)}.</p>
          </>
        )}
        {gav?.t === 'cli' && a && (
          <>
            <span className="k">Cliente</span>
            <h3>{gav.c.nome || 'Sem nome'}</h3>
            <div className="sub-g">{gav.c.negocio}</div>
            <div className="grande">{reais(custoReais(gav.c))}</div>
            <div className="tres">
              <div><small>Mensagens</small><b>{n(gav.c.mensagens)}</b></div>
              <div><small>Por mensagem</small><b>{reais(custoReais(gav.c) / Math.max(1, gav.c.mensagens))}</b></div>
              <div><small>Do total</small><b>{pct(custoReais(gav.c), a.total)}</b></div>
            </div>
            <div className="fato"><span>Texto lido</span><b>{reais(custoReais({ ...gav.c, saida: 0, audio_tokens: 0, audio_seg: 0 }))}</b></div>
            <div className="fato"><span>Texto escrito</span><b>{reais(custoReais({ ...gav.c, entrada: 0, audio_tokens: 0, audio_seg: 0 }))}</b></div>
            <div className="fato"><span>Áudio transcrito</span><b>{reais(custoReais({ ...gav.c, entrada: 0, saida: 0 }))}</b></div>
            <p className="texto-ajuda">Comparado ao plano de {reais(PRECO_MENSAL)}: a IA deste cliente pesa {pct(custoReais(gav.c), PRECO_MENSAL)} do plano no período.</p>
          </>
        )}
      </Gaveta>
    </Pagina>
  )
}
