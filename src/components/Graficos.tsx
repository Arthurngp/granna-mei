import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { brl, brlCurto } from '../lib/format'
import type { FatiaCategoria } from '../lib/calc'

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(320)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => setW(Math.max(200, el.clientWidth))
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Curva suave que nunca passa do ponto (monotônica): não desenha valor negativo onde não existe. */
function curva(p: [number, number][]) {
  const n = p.length
  if (n === 0) return ''
  if (n === 1) return `M${p[0][0]},${p[0][1]}`
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) m.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]))
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (2 * m[i - 1] * m[i]) / (m[i - 1] + m[i]))
  t.push(m[n - 2])
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (p[i + 1][0] - p[i][0]) / 3
    d += `C${(p[i][0] + dx).toFixed(1)},${(p[i][1] + t[i] * dx).toFixed(1)} ${(p[i + 1][0] - dx).toFixed(1)},${(p[i + 1][1] - t[i + 1] * dx).toFixed(1)} ${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`
  }
  return d
}

function tetoBonito(v: number) {
  if (v <= 0) return 100
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / e
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e
}

export interface Serie {
  nome: string
  cor: string
  valores: number[]
}

/** Linhas com área em degradê ("morrinhos"). Toque ou passe o mouse para ver o valor do ponto. */
export function AreaLinhas({ labels, series, altura = 190, rotulo }: { labels: string[]; series: Serie[]; altura?: number; rotulo?: (i: number) => string }) {
  const [ref, w] = useLargura<HTMLDivElement>()
  const [ativo, setAtivo] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')
  const n = labels.length
  const topo = 14
  const base = altura - 22
  const esq = 4
  const dir = 4
  const max = tetoBonito(Math.max(1, ...series.flatMap((s) => s.valores)))
  const passo = n > 1 ? (w - esq - dir) / (n - 1) : 0
  const x = (i: number) => (n > 1 ? esq + i * passo : w / 2)
  const y = (v: number) => base - (v / max) * (base - topo)
  const cadaRot = Math.max(1, Math.ceil(n / 6))

  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = n > 1 ? Math.round((e.clientX - r.left - esq) / passo) : 0
    setAtivo(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <div className="grafico" ref={ref} onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setAtivo(null)} style={{ height: altura }}>
      <svg width={w} height={altura} viewBox={`0 0 ${w} ${altura}`} role="img" aria-label={`Gráfico de ${series.map((s) => s.nome).join(' e ')}`}>
        <defs>
          {series.map((s, k) => (
            <linearGradient key={k} id={`g${uid}${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.cor} stopOpacity="0.28" />
              <stop offset="1" stopColor={s.cor} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={0} x2={w} y1={y(max * f)} y2={y(max * f)} stroke="#E7EAF5" strokeWidth="1" strokeDasharray="3 4" />
            <text className="eixo" x={0} y={y(max * f) - 4}>
              {brlCurto(max * f)}
            </text>
          </g>
        ))}
        <line x1={0} x2={w} y1={base} y2={base} stroke="#DDE1EF" strokeWidth="1" />
        <g className="sobe" key={`${n}-${series.map((s) => s.valores.join()).join('|').length}`}>
          {series.map((s, k) => {
            const pts = s.valores.map((v, i) => [x(i), y(v)] as [number, number])
            const linha = curva(pts)
            return (
              <g key={k}>
                {n > 1 && <path d={`${linha}L${x(n - 1)},${base}L${x(0)},${base}Z`} fill={`url(#g${uid}${k})`} />}
                <path d={linha} fill="none" stroke={s.cor} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                {n === 1 && <circle cx={x(0)} cy={y(s.valores[0])} r="4" fill={s.cor} />}
              </g>
            )
          })}
        </g>
        {ativo !== null && (
          <g>
            <line x1={x(ativo)} x2={x(ativo)} y1={topo - 6} y2={base} stroke="#747EAD" strokeWidth="1" />
            {series.map((s, k) => (
              <circle key={k} cx={x(ativo)} cy={y(s.valores[ativo] ?? 0)} r="5" fill="#fff" stroke={s.cor} strokeWidth="2.5" />
            ))}
          </g>
        )}
        {labels.map((l, i) =>
          i % cadaRot === 0 || i === n - 1 ? (
            i !== n - 1 && n - 1 - i < cadaRot * 0.6 ? null : (
              <text key={i} className="eixo" x={x(i)} y={altura - 5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
                {l}
              </text>
            )
          ) : null,
        )}
      </svg>
      {ativo !== null && (
        <div className="dica num" style={{ left: Math.max(74, Math.min(w - 74, x(ativo))) }}>
          <b>{rotulo ? rotulo(ativo) : labels[ativo]}</b>
          {series.map((s, k) => (
            <div key={k}>
              <i style={{ background: s.cor }} />
              {s.nome}: {brl(s.valores[ativo] ?? 0)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Pizza em formato de rosca, com a lista ao lado. Tocar numa fatia destaca e mostra o valor no meio. */
export function Rosca({ fatias, total, rotuloTotal, oculto }: { fatias: FatiaCategoria[]; total: number; rotuloTotal: string; oculto?: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  const [pronto, setPronto] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setPronto(true))
    return () => cancelAnimationFrame(t)
  }, [])
  const R = 54
  const C = 2 * Math.PI * R
  const top = fatias.slice(0, 5)
  const resto = fatias.slice(5)
  const lista: FatiaCategoria[] = resto.length
    ? [...top, { id: 'outros', nome: 'Outras', cor: '#C9CEE4', valor: resto.reduce((a, f) => a + f.valor, 0), frac: resto.reduce((a, f) => a + f.frac, 0), qtd: resto.reduce((a, f) => a + f.qtd, 0) }]
    : top
  const escolhida = lista.find((f) => f.id === sel)
  let acc = 0
  return (
    <div className="rosca">
      <div className="meio">
        <svg viewBox="0 0 148 148" width="148" height="148" role="img" aria-label="Distribuição por categoria">
          <circle cx="74" cy="74" r={R} fill="none" stroke="#EEF0F8" strokeWidth="20" />
          <g transform="rotate(-90 74 74)">
            {lista.map((f) => {
              const comp = Math.max(0, f.frac * C - (lista.length > 1 ? 2.5 : 0))
              const off = -acc * C
              acc += f.frac
              return (
                <circle
                  key={f.id}
                  cx="74"
                  cy="74"
                  r={R}
                  fill="none"
                  stroke={f.cor}
                  strokeWidth={sel === f.id ? 25 : 20}
                  strokeDasharray={`${pronto ? comp : 0} ${C}`}
                  strokeDashoffset={off}
                  opacity={sel && sel !== f.id ? 0.35 : 1}
                  onClick={() => setSel(sel === f.id ? null : f.id)}
                  style={{ cursor: 'pointer' }}
                />
              )
            })}
          </g>
        </svg>
        <div>
          <small>{escolhida ? escolhida.nome : rotuloTotal}</small>
          <strong className="num">{oculto ? 'R$ ••••' : brlCurto(escolhida ? escolhida.valor : total)}</strong>
        </div>
      </div>
      <ul>
        {lista.map((f) => (
          <li key={f.id}>
            <button type="button" aria-pressed={sel === f.id} onClick={() => setSel(sel === f.id ? null : f.id)}>
              <i style={{ background: f.cor }} />
              <span>{f.nome}</span>
              <b className="num">{Math.round(f.frac * 100)}%</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Barras lado a lado por mês. Tocar numa coluna seleciona o mês. */
export function Barras({ labels, series, sel, onSel, teto }: { labels: string[]; series: Serie[]; sel?: number; onSel?: (i: number) => void; teto?: { valor: number; rotulo: string } }) {
  const max = tetoBonito(Math.max(1, teto?.valor ?? 0, ...series.flatMap((s) => s.valores)))
  return (
    <div>
      <div className="barras">
        {teto && (
          <div className="teto" style={{ bottom: `${(teto.valor / max) * 100}%` }}>
            <span>{teto.rotulo}</span>
          </div>
        )}
        {labels.map((l, i) => (
          <button type="button" key={i} className="col" aria-pressed={sel === i} aria-label={`${l}: ${series.map((s) => `${s.nome} ${brl(s.valores[i] ?? 0)}`).join(', ')}`} onClick={() => onSel?.(i)}>
            {series.map((s, k) => (
              <i key={k} style={{ height: `${((s.valores[i] ?? 0) / max) * 100}%`, background: s.cor, animationDelay: `${i * 30}ms` }} />
            ))}
          </button>
        ))}
      </div>
      <div className="barras-rot">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  )
}

/** Medidor em meia-lua para o limite do MEI. */
export function Medidor({ frac, texto, sub }: { frac: number; texto: string; sub: string }) {
  const [pronto, setPronto] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setPronto(true))
    return () => cancelAnimationFrame(t)
  }, [])
  const L = Math.PI * 86
  const f = Math.max(0, Math.min(1, frac))
  const cor = frac >= 0.9 ? '#CC3340' : frac >= 0.7 ? '#D8921C' : '#454C83'
  const marca = (p: number) => {
    const a = Math.PI * (1 - p)
    return { x1: 100 + Math.cos(a) * 74, y1: 100 - Math.sin(a) * 74, x2: 100 + Math.cos(a) * 98, y2: 100 - Math.sin(a) * 98 }
  }
  return (
    <div className="medidor">
      <svg viewBox="0 0 200 112" width="100%" role="img" aria-label={`${texto} ${sub}`}>
        <path d="M14 100 A86 86 0 0 1 186 100" fill="none" stroke="#E7EAF5" strokeWidth="16" strokeLinecap="round" />
        <path d="M14 100 A86 86 0 0 1 186 100" fill="none" stroke={cor} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${pronto ? f * L : 0} ${L + 20}`} />
        {[0.7, 0.9].map((p) => (
          <line key={p} {...marca(p)} stroke="#fff" strokeWidth="2.5" />
        ))}
      </svg>
      <div className="meio">
        <strong className="num">{texto}</strong>
        <small>{sub}</small>
      </div>
    </div>
  )
}
