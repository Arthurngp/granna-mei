import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Spark } from './graficos'

export type SubAba = 'resumo' | 'custo' | 'ativacao' | 'retencao' | 'trafego' | 'receita' | 'publico'

export const SUBS: [SubAba, string][] = [
  ['resumo', 'Resumo'],
  ['custo', 'Custo de IA'],
  ['ativacao', 'Ativação'],
  ['retencao', 'Retenção'],
  ['trafego', 'Tráfego'],
  ['receita', 'Receita'],
  ['publico', 'Público'],
]

/** Lugar da faixa escura, que mora no cabeçalho do app para se emendar com ele. Vale para todas as abas. */
export const SlotCtx = createContext<HTMLElement | null>(null)

interface Ctx {
  /** Só a Visão geral tem navegação por páginas dentro da faixa. */
  ativo: boolean
  sub: SubAba
  ir: (s: SubAba) => void
}
export const VisaoCtx = createContext<Ctx>({ ativo: false, sub: 'resumo', ir: () => undefined })

export interface HeadDef {
  rotulo: string
  valor: ReactNode
  nota?: ReactNode
  /** Mini linha embaixo do número. */
  spark?: number[]
  /** Leva para outra página ao tocar. */
  para?: SubAba
  /** Valor em texto (categoria) em vez de número: fonte menor. */
  texto?: boolean
  tom?: 'ruim'
}

function Head({ d }: { d: HeadDef }) {
  const { ir } = useContext(VisaoCtx)
  const corpo = (
    <>
      <small>{d.rotulo}</small>
      <b className={`${d.texto ? 't' : ''} ${d.tom ?? ''}`}>{d.valor}</b>
      {d.nota && <em>{d.nota}</em>}
      {d.spark && <Spark valores={d.spark} />}
    </>
  )
  return d.para ? (
    <button type="button" className="head" onClick={() => ir(d.para as SubAba)}>
      {corpo}
    </button>
  ) : (
    <div className="head">{corpo}</div>
  )
}

function HeadEsqueleto() {
  return (
    <div className="head" aria-hidden="true">
      <small className="skel-esc" style={{ width: 90 }}>&nbsp;</small>
      <b className="skel-esc" style={{ width: 120, height: 40 }}>&nbsp;</b>
      <em className="skel-esc" style={{ width: 150 }}>&nbsp;</em>
    </div>
  )
}

interface PaginaProps {
  titulo: string
  subtitulo?: string
  /** Controles à direita do título (filtros, chaves). */
  controles?: ReactNode
  /** Os números grandes da faixa. Sem eles, mostra o esqueleto. */
  heads?: HeadDef[]
  /** Quantos números esperar (para o esqueleto manter o tamanho). */
  quantos?: number
  children: ReactNode
}

/** Moldura de toda página da visão geral: faixa escura no topo (título, números, navegação) e cartões por cima. */
export function Pagina({ titulo, subtitulo, controles, heads, quantos = 4, children }: PaginaProps) {
  const slot = useContext(SlotCtx)
  const { ativo, sub, ir } = useContext(VisaoCtx)
  const faixa = (
    <div className="vfaixa">
      {ativo && (
        <nav className="sub-nav" aria-label="Páginas da visão geral">
          {SUBS.map(([v, r]) => (
            <button key={v} type="button" aria-current={sub === v ? 'page' : undefined} className={sub === v ? 'on' : ''} onClick={() => ir(v)}>
              {r}
            </button>
          ))}
        </nav>
      )}
      <div className="faixa-tit">
        <div>
          <h1>{titulo}</h1>
          {subtitulo && <p>{subtitulo}</p>}
        </div>
        {controles && <div className="faixa-ctl">{controles}</div>}
      </div>
      {/* heads vazio = a página não tem número para mostrar (erro ou função ausente): sem faixa de números nem esqueleto eterno */}
      {!(heads && heads.length === 0) && (
        <div className="heads" data-n={heads?.length ?? quantos}>
          {heads ? heads.map((d) => <Head key={d.rotulo} d={d} />) : Array.from({ length: quantos }, (_, i) => <HeadEsqueleto key={i} />)}
        </div>
      )}
    </div>
  )
  return (
    <>
      {slot && createPortal(faixa, slot)}
      <div className="corpo-visao">{children}</div>
    </>
  )
}

/** Cartão do mosaico. `g` é a largura em colunas no desktop (de 12). */
export function Cartao({ g = 12, titulo, nota, lado, children, className = '' }: { g?: number; titulo?: ReactNode; nota?: ReactNode; lado?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cartao g${g} ${className}`}>
      {(titulo || nota || lado) && (
        <div className="cartao-cab">
          {titulo && <h2>{titulo}</h2>}
          {nota && <span className="nota-cab">{nota}</span>}
          {lado}
        </div>
      )}
      {children}
    </section>
  )
}

/** Gaveta lateral no computador e no iPad; folha que sobe de baixo no celular. Esc e toque fora fecham. */
export function Gaveta({ aberta, onFechar, rotulo, children }: { aberta: boolean; onFechar: () => void; rotulo: string; children: ReactNode }) {
  const fechar = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!aberta) return
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', tecla)
    fechar.current?.focus()
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', tecla)
      document.body.style.overflow = antes
    }
  }, [aberta, onFechar])
  if (!aberta) return null
  return (
    <>
      <div className="gav-vu" onClick={onFechar} />
      <aside className="gav" role="dialog" aria-modal="true" aria-label={rotulo}>
        <div className="gav-alca" aria-hidden="true" />
        <button type="button" className="gav-x" ref={fechar} onClick={onFechar} aria-label="Fechar">
          ×
        </button>
        {children}
      </aside>
    </>
  )
}

/** Barra horizontal de proporção com rótulo e número. */
export function BarraH({ nome, n, max, cor, sufixo }: { nome: string; n: number; max: number; cor?: string; sufixo?: ReactNode }) {
  return (
    <div className="hb">
      <span className="hb-n">{nome}</span>
      <div className="hb-t">
        <i style={{ width: `${max > 0 ? (n / max) * 100 : 0}%`, background: cor }} />
      </div>
      <b>
        {n.toLocaleString('pt-BR')}
        {sufixo}
      </b>
    </div>
  )
}
