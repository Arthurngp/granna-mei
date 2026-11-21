import { useEffect, useRef, useState, type PointerEvent } from 'react'

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

/** Teto "redondo" para o eixo (1, 2, 2,5, 5 × potência de 10). */
function teto(v: number) {
  if (v <= 0) return 1
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / e
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e
}

interface Props {
  /** Um valor por dia. */
  valores: number[]
  /** Texto do eixo horizontal para cada barra (ex.: "14/11"). */
  rotulos: string[]
  /** Título do balão para cada barra (ex.: "sex, 14/11"). */
  titulos: string[]
  /** Como escrever o valor no balão. */
  formato: (v: number) => string
  /** Como escrever o valor nas linhas do eixo vertical. */
  formatoCurto: (v: number) => string
  /** Barras em destaque (picos). */
  destaque?: boolean[]
  /** Linha tracejada de referência (ex.: mediana dos dias). */
  referencia?: { valor: number; rotulo: string }
  /** Linhas extras no balão, abaixo do valor. */
  extra?: (i: number) => string[]
  altura?: number
  /** Descrição para leitor de tela. */
  nome: string
}

/** Barras por dia. Eixo vertical na unidade do dado (reais, mensagens), horizontal em datas. Toque ou passe o mouse para o detalhe. */
export function Barras({ valores, rotulos, titulos, formato, formatoCurto, destaque, referencia, extra, altura = 210, nome }: Props) {
  const [ref, w] = useLargura<HTMLDivElement>()
  const [ativo, setAtivo] = useState<number | null>(null)
  const n = valores.length
  const topo = 16
  const base = altura - 24
  const max = teto(Math.max(...valores, referencia?.valor ?? 0))
  const lugar = (w - 4) / Math.max(1, n)
  const larg = Math.max(2, Math.min(34, lugar * 0.68))
  const x = (i: number) => 2 + lugar * i + (lugar - larg) / 2
  const y = (v: number) => base - (v / max) * (base - topo)
  const cadaRot = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(w / 62))))

  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setAtivo(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - 2) / lugar))))
  }

  return (
    <div className="grafico" ref={ref} onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setAtivo(null)} style={{ height: altura }}>
      <svg width={w} height={altura} viewBox={`0 0 ${w} ${altura}`} role="img" aria-label={nome}>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={0} x2={w} y1={y(max * f)} y2={y(max * f)} stroke="#E7EAF5" strokeWidth="1" strokeDasharray="3 4" />
            <text className="eixo" x={0} y={y(max * f) - 4}>
              {formatoCurto(max * f)}
            </text>
          </g>
        ))}
        <line x1={0} x2={w} y1={base} y2={base} stroke="#DDE1EF" strokeWidth="1" />
        {valores.map((v, i) => (
          <rect
            key={i}
            x={x(i)}
            y={v > 0 ? y(v) : base - 1}
            width={larg}
            height={v > 0 ? Math.max(1.5, base - y(v)) : 1}
            rx={Math.min(3, larg / 2)}
            fill={destaque?.[i] ? '#CC3340' : ativo === i ? '#292D54' : '#454C83'}
            opacity={ativo === null || ativo === i ? 1 : 0.72}
          />
        ))}
        {referencia && referencia.valor > 0 && (
          <g>
            <line x1={0} x2={w} y1={y(referencia.valor)} y2={y(referencia.valor)} stroke="#0E8250" strokeWidth="1.4" strokeDasharray="5 4" />
            <text className="eixo" x={w} y={y(referencia.valor) - 4} textAnchor="end" style={{ fill: '#0E8250' }}>
              {referencia.rotulo}
            </text>
          </g>
        )}
        {rotulos.map((l, i) =>
          i % cadaRot === 0 ? (
            <text key={i} className="eixo" x={x(i) + larg / 2} y={altura - 6} textAnchor={i === 0 ? 'start' : 'middle'} dx={i === 0 ? -larg / 2 + 2 : 0}>
              {l}
            </text>
          ) : null,
        )}
      </svg>
      {ativo !== null && (
        <div className="dica num" style={{ left: Math.max(78, Math.min(w - 78, x(ativo) + larg / 2)) }}>
          <b>{titulos[ativo]}</b>
          {formato(valores[ativo] ?? 0)}
          {extra?.(ativo).map((l, k) => (
            <div key={k} style={{ color: '#b1b9d8' }}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
