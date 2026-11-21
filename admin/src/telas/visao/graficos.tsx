import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

/** Curva suave por pontos (quadrática entre os pontos médios). Nunca passa de valor negativo. */
export function suave(p: [number, number][]) {
  if (p.length === 0) return ''
  if (p.length === 1) return `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2
    const my = (p[i][1] + p[i + 1][1]) / 2
    d += ` Q${p[i][0].toFixed(1)},${p[i][1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`
  }
  const l = p[p.length - 1]
  return d + ` L${l[0].toFixed(1)},${l[1].toFixed(1)}`
}

/** Teto "redondo" para o eixo (1, 2, 2,5, 5 vezes uma potência de 10). */
export function teto(v: number) {
  if (v <= 0) return 1
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / e
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e
}

/** Mini linha para os números grandes da faixa. Sem eixo: só a forma. */
export function Spark({ valores, cor = '#8fe9b8', cheio = false }: { valores: number[]; cor?: string; cheio?: boolean }) {
  const estilo = cheio ? { width: '100%', height: '100%', display: 'block' } : undefined
  if (valores.length < 2) return <svg className="spark" style={estilo} viewBox="0 0 300 46" aria-hidden="true" />
  const max = Math.max(...valores, 1) * 1.05
  const pts = valores.map((y, i) => [(i / (valores.length - 1)) * 300, 44 - (y / max) * 42] as [number, number])
  return (
    <svg className="spark" style={estilo} viewBox="0 0 300 46" preserveAspectRatio="none" aria-hidden="true">
      <path d={suave(pts)} fill="none" stroke={cor} strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Medidor circular com o valor no meio. */
export function Anel({ pct, cor = '#454c83', tam = 92, esp = 9, children }: { pct: number; cor?: string; tam?: number; esp?: number; children?: ReactNode }) {
  const r = (tam - esp) / 2
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(100, pct))
  return (
    <div className="anel" style={{ width: tam, height: tam }}>
      <svg viewBox={`0 0 ${tam} ${tam}`} width={tam} height={tam} aria-hidden="true">
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke="#eceef7" strokeWidth={esp} />
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke={cor} strokeWidth={esp} strokeLinecap="round" strokeDasharray={`${(c * f) / 100} ${c}`} transform={`rotate(-90 ${tam / 2} ${tam / 2})`} />
      </svg>
      <span>{children ?? `${Math.round(f)}%`}</span>
    </div>
  )
}

function useMedida<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [m, setM] = useState({ w: 320, h: 240 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => setM({ w: Math.max(200, el.clientWidth), h: Math.max(120, el.clientHeight) })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, m] as const
}

interface AreaProps {
  valores: number[]
  /** Período anterior, mesma quantidade de pontos (linha tracejada). */
  anterior?: number[]
  rotulos: string[]
  titulos: string[]
  formato: (v: number) => string
  formatoCurto: (v: number) => string
  /** Dias fora do padrão: viram uma bolinha vermelha que se toca. */
  picos?: boolean[]
  aoPico?: (i: number) => void
  extra?: (i: number) => string[]
  nome: string
}

/**
 * Área por dia com eixos na unidade do dado (reais, mensagens) e datas embaixo. Funciona por toque e mouse:
 * toque ou passe para ver o valor do dia. A altura vem do contêiner (CSS), então muda no celular.
 */
export function AreaDia({ valores, anterior, rotulos, titulos, formato, formatoCurto, picos, aoPico, extra, nome }: AreaProps) {
  const [ref, { w, h }] = useMedida<HTMLDivElement>()
  const [ativo, setAtivo] = useState<number | null>(null)
  const n = valores.length
  const esq = w < 480 ? 56 : 64
  const base = h - 26
  const topo = 12
  const W = w - esq - 4
  const max = teto(Math.max(...valores, ...(anterior ?? []), 0) * 1.05)
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2)
  const y = (v: number) => base - (v / max) * (base - topo)
  const pts = valores.map((v, i) => [x(i), y(v)] as [number, number])
  const linha = suave(pts)
  const area = n > 1 ? `${linha} L${x(n - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z` : ''
  const nRot = Math.max(2, Math.min(rotulos.length, Math.floor(W / 74)))
  const idxRot = Array.from({ length: nRot }, (_, k) => Math.round((k / (nRot - 1)) * (n - 1)))
  const gid = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current

  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left - esq
    setAtivo(Math.max(0, Math.min(n - 1, n > 1 ? Math.round((px / W) * (n - 1)) : 0)))
  }

  return (
    <div className="plot" ref={ref} onPointerMove={mover} onPointerDown={mover} onPointerLeave={(e) => e.pointerType === 'mouse' && setAtivo(null)}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={nome}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#454c83" stopOpacity="0.28" />
            <stop offset="1" stopColor="#454c83" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={esq} x2={w} y1={y(max * f)} y2={y(max * f)} stroke="#E7EAF5" strokeWidth="1" strokeDasharray="3 4" />
            <text className="eixo" x={esq - 8} y={y(max * f) + 4} textAnchor="end">
              {formatoCurto(max * f)}
            </text>
          </g>
        ))}
        <text className="eixo" x={esq - 8} y={base + 4} textAnchor="end">
          0
        </text>
        <line x1={esq} x2={w} y1={base} y2={base} stroke="#DDE1EF" strokeWidth="1" />
        <g transform={`translate(${esq} 0)`}>
          {anterior && anterior.length > 1 && <path d={suave(anterior.map((v, i) => [(i / (anterior.length - 1)) * W, y(v)] as [number, number]))} fill="none" stroke="#b1b9d8" strokeWidth="2" strokeDasharray="5 5" />}
          {area && <path d={area} fill={`url(#${gid})`} />}
          <path d={linha} fill="none" stroke="#454c83" strokeWidth="3" strokeLinecap="round" />
          {ativo !== null && (
            <g>
              <line x1={x(ativo)} x2={x(ativo)} y1={topo} y2={base} stroke="#747EAD" strokeWidth="1" />
              <circle cx={x(ativo)} cy={y(valores[ativo])} r="6" fill="#fff" stroke="#454c83" strokeWidth="3" />
            </g>
          )}
          {idxRot.map((i, k) => (
            <text key={k} className="eixo" x={x(i)} y={h - 6} textAnchor={k === 0 ? 'start' : k === idxRot.length - 1 ? 'end' : 'middle'}>
              {rotulos[i]}
            </text>
          ))}
        </g>
      </svg>
      {picos?.map((p, i) =>
        p ? (
          <button key={i} type="button" className="pico-dot" style={{ left: esq + x(i), top: y(valores[i]) }} onClick={() => aoPico?.(i)} aria-label={`Detalhar ${titulos[i]}`} />
        ) : null,
      )}
      {ativo !== null && (
        <div className="dica num" style={{ left: Math.max(84, Math.min(w - 84, esq + x(ativo))), top: Math.max(4, y(valores[ativo]) - 14) }}>
          <b>{titulos[ativo]}</b>
          {formato(valores[ativo])}
          {extra?.(ativo).map((l, k) => (
            <div key={k} className="dica-sub">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
