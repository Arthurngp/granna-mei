import { Camera, ChevronLeft, ChevronRight, FileText, MessageCircle, Mic, Monitor, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { brl, capitaliza, centavosDe, dinheiroCampo, mesAtual, nomeMes, somaMeses } from '../lib/format'
import type { Origem } from '../lib/tipos'

/* ---------- Mascote ---------- */
export type Pose =
  | 'hero' | 'ola' | 'checklist' | 'festa' | 'laptop' | 'pensando' | 'apresentando' | 'cafe' | 'suporte' | 'coracao' | 'calendario'
  | 'heroi' | 'apontando' | 'duvida' | 'ideia' | 'lupa' | 'crescimento' | 'sino' | 'recibo' | 'escudo' | 'calculadora' | 'maisemenos'
  | 'relatorio' | 'moedas' | 'mei' | 'loja' | 'foto' | 'resumo' | 'saco' | 'dormindo' | 'trofeu' | 'notificacao'

export function Mascote({ pose, tam = 96, anim, className = '', style }: { pose: Pose; tam?: number; anim?: 'flutua' | 'pula'; className?: string; style?: CSSProperties }) {
  return <img src={`/mascote/${pose}.png`} alt="" aria-hidden className={`mascote ${anim ?? ''} ${className}`} style={{ height: tam, ...style }} draggable={false} />
}

export function Vazio({ pose, titulo, texto, children }: { pose: Pose; titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      <Mascote pose={pose} tam={116} anim="flutua" />
      <h3>{titulo}</h3>
      <p>{texto}</p>
      {children && <div className="acoes">{children}</div>}
    </div>
  )
}

/* ---------- Número que conta até o valor ---------- */
export function useContagem(alvo: number, ms = 650) {
  const [v, setV] = useState(alvo)
  const de = useRef(alvo)
  useEffect(() => {
    const inicio = de.current
    if (inicio === alvo) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      de.current = alvo
      setV(alvo)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      const atual = inicio + (alvo - inicio) * e
      de.current = atual
      setV(atual)
      if (p < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [alvo, ms])
  return v
}

export function Valor({ n, oculto, animado }: { n: number; oculto?: boolean; animado?: boolean }) {
  const v = useContagem(n, animado ? 650 : 0)
  if (oculto) return <span className="num" aria-label="valor oculto">R$ ••••</span>
  return <span className="num">{brl(animado ? v : n)}</span>
}

/* ---------- Segmentado ---------- */
export function Seg<T extends string>({ opcoes, valor, onChange, bloco }: { opcoes: { v: T; r: string }[]; valor: T; onChange: (v: T) => void; bloco?: boolean }) {
  return (
    <div className={`seg ${bloco ? 'seg-bloco' : ''}`} role="group">
      {opcoes.map((o) => (
        <button key={o.v} type="button" aria-pressed={valor === o.v} onClick={() => onChange(o.v)}>
          {o.r}
        </button>
      ))}
    </div>
  )
}

export function MesNav({ ym, onChange, futuro = 0 }: { ym: string; onChange: (ym: string) => void; futuro?: number }) {
  const max = somaMeses(mesAtual(), futuro)
  return (
    <div className="mesnav">
      <button type="button" aria-label="Mês anterior" onClick={() => onChange(somaMeses(ym, -1))}>
        <ChevronLeft size={20} />
      </button>
      <strong>{capitaliza(nomeMes(ym))}</strong>
      <button type="button" aria-label="Próximo mês" disabled={ym >= max} onClick={() => onChange(somaMeses(ym, 1))}>
        <ChevronRight size={20} />
      </button>
    </div>
  )
}

export function Chave({ ligado, onChange, rotulo }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} className="chave" onClick={() => onChange(!ligado)} />
}

export function CampoDinheiro({ valor, onChange, id, autoFocus }: { valor: number; onChange: (n: number) => void; id?: string; autoFocus?: boolean }) {
  return (
    <div className="entrada-dinheiro">
      <b>R$</b>
      <input
        id={id}
        className="entrada num"
        inputMode="numeric"
        autoFocus={autoFocus}
        value={valor ? dinheiroCampo(valor) : ''}
        placeholder="0,00"
        onChange={(e) => onChange(centavosDe(e.target.value))}
      />
    </div>
  )
}

const ICONE_ORIGEM = { texto: MessageCircle, audio: Mic, foto: Camera, pdf: FileText, painel: Monitor }
export const NOME_ORIGEM: Record<Origem, string> = { texto: 'Mensagem no WhatsApp', audio: 'Áudio no WhatsApp', foto: 'Foto no WhatsApp', pdf: 'PDF no WhatsApp', painel: 'Pelo painel' }
export function IconeOrigem({ origem, size = 13 }: { origem: Origem; size?: number }) {
  const I = ICONE_ORIGEM[origem]
  return <I size={size} aria-label={NOME_ORIGEM[origem]} />
}

/* ---------- Folha deslizante (vira janela no desktop) ---------- */
export function Folha({ aberta, onFechar, titulo, children, pe }: { aberta: boolean; onFechar: () => void; titulo: string; children: ReactNode; pe?: ReactNode }) {
  useEffect(() => {
    if (!aberta) return
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', tecla)
    return () => {
      document.body.style.overflow = antes
      window.removeEventListener('keydown', tecla)
    }
  }, [aberta, onFechar])
  if (!aberta) return null
  // Vai direto no body: assim nenhuma animação ou camada da página consegue prender ou cobrir a folha.
  return createPortal(
    <div className="folha-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="folha" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="folha-cab">
          <h2>{titulo}</h2>
          <button type="button" className="icone-btn" aria-label="Fechar" onClick={onFechar}>
            <X size={22} />
          </button>
        </div>
        <div className="folha-corpo">{children}</div>
        {pe && <div className="folha-pe">{pe}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* ---------- Aviso rápido ---------- */
interface Aviso {
  id: number
  texto: string
  acao?: { rotulo: string; fn: () => void }
}
const AvisoCtx = createContext<(texto: string, acao?: Aviso['acao']) => void>(() => {})
export const useAviso = () => useContext(AvisoCtx)

export function AvisoProvider({ children }: { children: ReactNode }) {
  const [a, setA] = useState<Aviso | null>(null)
  const timer = useRef<number>()
  const avisar = useCallback((texto: string, acao?: Aviso['acao']) => {
    window.clearTimeout(timer.current)
    setA({ id: Date.now(), texto, acao })
    timer.current = window.setTimeout(() => setA(null), acao ? 5200 : 2800)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      {a && (
        <div className="aviso" key={a.id} role="status">
          <span>{a.texto}</span>
          {a.acao && (
            <button
              type="button"
              onClick={() => {
                a.acao?.fn()
                setA(null)
              }}
            >
              {a.acao.rotulo}
            </button>
          )}
        </div>
      )}
    </AvisoCtx.Provider>
  )
}

/* ---------- Código de 6 dígitos ---------- */
/** Um único campo de verdade por baixo de seis casas: não perde dígito, aceita colar e o preenchimento automático do celular. */
export function Codigo({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const [foco, setFoco] = useState(false)
  return (
    <div className="codigo">
      <input
        className="codigo-real"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Código de 6 números"
        maxLength={6}
        value={valor}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onFocus={() => setFoco(true)}
        onBlur={() => setFoco(false)}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} aria-hidden className={`casa num ${valor[i] ? 'cheio' : ''} ${foco && i === Math.min(valor.length, 5) ? 'ativa' : ''}`}>
          {valor[i] ?? ''}
        </span>
      ))}
    </div>
  )
}
