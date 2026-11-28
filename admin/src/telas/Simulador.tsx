import { Check, CheckCheck, Clock3, ExternalLink, FileText, KeyRound, Mic, Paperclip, RotateCcw, Send, Square, Trash2, TriangleAlert, UserPlus } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { api } from '../sb'
import { dataBR, Falha, NOME_SITUACAO } from './comum'
import { Pagina } from './visao/layout'
import './simulador.css'

/*
 * Simulador de conversa (pedido do Arthur em 2026-11-27). A mensagem daqui entra no servidor pelo MESMO caminho do webhook do WhatsApp
 * (registro, espera de 10 s, processar), e o que a Granninha mandaria (resposta, tiques azuis, "digitando...", reação, lembretes) volta
 * para esta tela. Nada é imitado aqui: a tela só desenha o que o servidor fez de verdade.
 */

interface Conta {
  user_id: string
  nome: string
  email: string
  verificado: boolean
  onboarding_via: string | null
  etapa_config: string | null
  assinatura: { status: string; trial_fim: string } | null
  codigo: { codigo: string; expira_em: string } | null
  criado_em: string | null
}
interface Slot {
  numero: string
  formatado: string
  conta: Conta | null
  ultima: string | null
}
interface Ambiente {
  onboarding_whats: boolean
  sinais: boolean
  espera_ms: number
  digitar_ms: number
  modo_teste: boolean
  avisos: string
}
interface Ev {
  seq: number
  em: string
  tipo: 'entrada' | 'texto' | 'lida' | 'digitando' | 'parou' | 'reacao'
  id?: string
  texto?: string
  emoji?: string
  ids?: string[]
  midia?: { tipo: 'audio' | 'foto' | 'pdf'; nome: string }
}
interface Msg {
  id: string
  tipo: string
  texto: string
  status: string
  intencao: string | null
  resposta: string | null
  erro: string | null
  efeitos: Record<string, unknown> | null
  ms: number | null
  custo_usd?: number | string | null
  criado_em: string
}
type TipoMidia = 'audio' | 'foto' | 'pdf'

const hora = (s: string) => new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const MAX_ARQUIVO = 8 * 1024 * 1024

function base64(b: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.onerror = () => falha(r.error)
    r.readAsDataURL(b)
  })
}

/** Negrito, itálico, riscado e links do jeito do WhatsApp. */
function formatar(t: string): ReactNode {
  return t.split('\n').map((linha, i, todas) => (
    <Fragment key={i}>
      {linha.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s]+)/g).map((p, k) => {
        if (/^\*[^*]+\*$/.test(p)) return <b key={k}>{p.slice(1, -1)}</b>
        if (/^_[^_]+_$/.test(p)) return <i key={k}>{p.slice(1, -1)}</i>
        if (/^~[^~]+~$/.test(p)) return <s key={k}>{p.slice(1, -1)}</s>
        if (/^https?:\/\//.test(p)) return <a key={k} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
        return p
      })}
      {i < todas.length - 1 && <br />}
    </Fragment>
  ))
}

function situacaoDaConta(c: Conta | null): { rotulo: string; tom: 'neutro' | 'espera' | 'bom' } {
  if (!c) return { rotulo: 'Sem conta', tom: 'neutro' }
  if (!c.verificado) return { rotulo: 'Esperando o código', tom: 'espera' }
  if (c.etapa_config && c.etapa_config !== 'fim') return { rotulo: 'Configurando pela conversa', tom: 'espera' }
  return { rotulo: 'Confirmada', tom: 'bom' }
}

export function Simulador() {
  const [dados, setDados] = useState<{ numeros: Slot[]; ambiente: Ambiente; pronto: boolean } | null>(null)
  const [erro, setErro] = useState('')
  const [sel, setSel] = useState('')

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ numeros: Slot[]; ambiente: Ambiente; pronto: boolean }>('/admin/simulador')
      setDados(r)
      setErro('')
      setSel((s) => s || r.numeros[0]?.numero || '')
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void carregar()
  }, [carregar])

  const titulo = 'Simulador'
  const subtitulo = 'Converse com a Granninha como pelo WhatsApp: mesmo caminho, mesma IA e mesmo banco, sem usar o chip.'
  if (erro && !dados) return <Pagina titulo={titulo} subtitulo={subtitulo} heads={[]}><Falha texto={erro} /></Pagina>
  if (!dados) return <Pagina titulo={titulo} subtitulo={subtitulo} heads={[]}><span className="skel" style={{ height: 520 }} /></Pagina>

  const slot = dados.numeros.find((n) => n.numero === sel) ?? dados.numeros[0]
  const amb = dados.ambiente
  return (
    <Pagina titulo={titulo} subtitulo={subtitulo} heads={[]}>
      {!dados.pronto && <Falha texto="O servidor no ar ainda não tem o simulador ligado. Ele entra no próximo deploy do serviço da Granninha." />}
      {amb.modo_teste && (
        <div className="vaviso" role="status">
          <TriangleAlert size={20} style={{ flex: 'none' }} />
          <span>O servidor está em modo teste (só alguns números conversam). Os números do simulador passam mesmo assim.</span>
        </div>
      )}
      <div className="simu">
        <nav className="simu-lista" aria-label="Números de teste">
          {dados.numeros.map((n, i) => {
            const s = situacaoDaConta(n.conta)
            return (
              <button key={n.numero} type="button" className={n.numero === slot.numero ? 'on' : ''} aria-pressed={n.numero === slot.numero} onClick={() => setSel(n.numero)}>
                <span className="simu-avatar" aria-hidden>{i + 1}</span>
                <span className="simu-lista-txt">
                  <b>{n.conta?.nome || `Teste ${i + 1}`}</b>
                  <small>{n.formatado}</small>
                </span>
                <span className={`simu-tag ${s.tom}`}>{s.rotulo}</span>
              </button>
            )
          })}
        </nav>
        <Conversa key={slot.numero} slot={slot} ambiente={amb} mudou={carregar} />
      </div>
    </Pagina>
  )
}

interface Local {
  id: string
  texto: string
  midia?: { tipo: TipoMidia; nome: string }
  em: string
  falhou?: string
}
type Item =
  | { k: 'eu'; id: string; texto: string; midia?: { tipo: TipoMidia; nome: string }; em: string; enviando?: boolean; falhou?: string; historico?: boolean }
  | { k: 'ela'; texto: string; em: string; chave: string }
  | { k: 'divisor'; texto: string; chave: string }

function Conversa({ slot, ambiente, mudou }: { slot: Slot; ambiente: Ambiente; mudou: () => Promise<void> }) {
  const [eventos, setEventos] = useState<Ev[]>([])
  const [mensagens, setMensagens] = useState<Msg[]>([])
  const [locais, setLocais] = useState<Local[]>([])
  const [texto, setTexto] = useState('')
  const [gravando, setGravando] = useState(false)
  const [recado, setRecado] = useState('')
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [agora, setAgora] = useState(Date.now())
  const seq = useRef(0)
  const previews = useRef(new Map<string, string>())
  const rec = useRef<MediaRecorder | null>(null)
  const fim = useRef<HTMLDivElement>(null)
  const arquivo = useRef<HTMLInputElement>(null)
  const caixa = useRef<HTMLTextAreaElement>(null)

  const buscando = useRef(false)
  const buscar = useCallback(async () => {
    // Uma consulta por vez: duas ao mesmo tempo pediriam os mesmos eventos e a conversa sairia em dobro.
    if (buscando.current) return
    buscando.current = true
    try {
      const r = await api<{ eventos: Ev[]; mensagens: Msg[] }>(`/admin/simulador/conversa?numero=${slot.numero}&depois=${seq.current}`)
      const novos = r.eventos.filter((e) => e.seq > seq.current)
      if (novos.length) {
        seq.current = novos[novos.length - 1].seq
        setEventos((e) => [...e, ...novos])
        // Resposta nova pode ter mudado a conta (código confirmado, configuração andou): a lista e o painel se atualizam.
        if (novos.some((e) => e.tipo === 'texto')) void mudou()
      }
      setMensagens(r.mensagens)
    } catch {
      // a próxima volta tenta de novo; a tela não cai por uma consulta perdida
    } finally {
      buscando.current = false
    }
  }, [slot.numero, mudou])

  useEffect(() => {
    void buscar()
    const t = setInterval(() => void buscar(), 1200)
    const r = setInterval(() => setAgora(Date.now()), 500)
    return () => {
      clearInterval(t)
      clearInterval(r)
    }
  }, [buscar])

  const itens = useMemo<Item[]>(() => {
    const out: Item[] = []
    const daSessao = new Set(eventos.filter((e) => e.tipo === 'entrada').map((e) => e.id))
    // O que está gravado no banco e não está na memória do servidor (ele reiniciou, ou a tela abriu depois): vira histórico.
    const antigas = [...mensagens].reverse().filter((m) => !daSessao.has(m.id) && !(m.erro ?? '').startsWith('juntada em'))
    for (const m of antigas) {
      const midia = m.tipo === 'audio' || m.tipo === 'foto' || m.tipo === 'pdf' ? { tipo: m.tipo as TipoMidia, nome: m.tipo === 'pdf' ? 'documento.pdf' : '' } : undefined
      out.push({ k: 'eu', id: m.id, texto: midia && m.tipo !== 'foto' ? '' : m.texto, midia, em: m.criado_em, historico: true })
      if (m.resposta) out.push({ k: 'ela', texto: m.resposta, em: new Date(new Date(m.criado_em).getTime() + (m.ms ?? 0)).toISOString(), chave: `h-${m.id}` })
    }
    if (antigas.length && eventos.length) out.push({ k: 'divisor', texto: 'Desta sessão', chave: 'div' })
    for (const e of eventos) {
      if (e.tipo === 'entrada' && e.id) out.push({ k: 'eu', id: e.id, texto: e.texto ?? '', midia: e.midia, em: e.em })
      if (e.tipo === 'texto') out.push({ k: 'ela', texto: e.texto ?? '', em: e.em, chave: `e-${e.seq}` })
    }
    const vistos = new Set(out.filter((i) => i.k === 'eu').map((i) => (i as { id: string }).id))
    for (const l of locais) if (!vistos.has(l.id)) out.push({ k: 'eu', id: l.id, texto: l.texto, midia: l.midia, em: l.em, enviando: !l.falhou, falhou: l.falhou })
    return out
  }, [eventos, mensagens, locais])

  const lidas = useMemo(() => new Set(eventos.flatMap((e) => (e.tipo === 'lida' ? e.ids ?? [] : []))), [eventos])
  const reacoes = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of eventos) if (e.tipo === 'reacao' && e.id) m.set(e.id, e.emoji ?? '')
    return m
  }, [eventos])


  // O que o cabeçalho diz: digitando, esperando a pessoa terminar (a espera de 10 s do servidor), ou online.
  const sinal = [...eventos].reverse().find((e) => e.tipo === 'digitando' || e.tipo === 'parou' || e.tipo === 'texto')
  const digitando = sinal?.tipo === 'digitando' && agora - new Date(sinal.em).getTime() < 25_000
  const ultEntrada = [...eventos].reverse().find((e) => e.tipo === 'entrada')
  const ultResposta = [...eventos].reverse().find((e) => e.tipo === 'texto')
  const desdeEntrada = ultEntrada ? agora - new Date(ultEntrada.em).getTime() : Infinity
  const esperando = !digitando && ultEntrada && (!ultResposta || ultResposta.seq < ultEntrada.seq) && desdeEntrada < ambiente.espera_ms
  // Rola só a conversa, nunca a página (scrollIntoView arrastaria a tela inteira a cada mensagem nova).
  useEffect(() => {
    const f = fim.current?.parentElement
    if (f) f.scrollTop = f.scrollHeight
  }, [itens.length, digitando])
  const status = digitando ? 'digitando...' : esperando ? `esperando você terminar · ${Math.ceil((ambiente.espera_ms - desdeEntrada) / 1000)} s` : 'online'

  const enviar = async (corpo: { tipo: 'texto' | TipoMidia; texto?: string; arquivo?: string; mime?: string; nome_arquivo?: string }, previa?: string) => {
    const temp = `local-${Date.now()}`
    const midia = corpo.tipo === 'texto' ? undefined : { tipo: corpo.tipo, nome: corpo.nome_arquivo ?? '' }
    if (previa) previews.current.set(temp, previa)
    setLocais((l) => [...l, { id: temp, texto: corpo.texto ?? '', midia, em: new Date().toISOString() }])
    setRecado('')
    try {
      const r = await api<{ id: string; chegada: string }>('/admin/simulador/enviar', { method: 'POST', body: JSON.stringify({ numero: slot.numero, ...corpo }) })
      if (previa) previews.current.set(r.id, previa)
      setLocais((l) => l.map((x) => (x.id === temp ? { ...x, id: r.id } : x)))
      void buscar()
    } catch (e) {
      setLocais((l) => l.map((x) => (x.id === temp ? { ...x, falhou: (e as Error).message } : x)))
    }
  }

  const mandarTexto = () => {
    const t = texto.trim()
    if (!t) return
    setTexto('')
    void enviar({ tipo: 'texto', texto: t })
    caixa.current?.focus()
  }
  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      mandarTexto()
    }
  }

  const mandarArquivo = async (b: Blob, tipo: TipoMidia, nome: string) => {
    if (b.size > MAX_ARQUIVO) return setRecado('Arquivo grande demais: o máximo é 8 MB.')
    const legenda = tipo === 'foto' || tipo === 'pdf' ? texto.trim() : ''
    if (legenda) setTexto('')
    await enviar({ tipo, texto: legenda, arquivo: await base64(b), mime: b.type || (tipo === 'pdf' ? 'application/pdf' : ''), nome_arquivo: nome }, URL.createObjectURL(b))
  }
  const escolheuArquivo = (f: File | undefined) => {
    if (!f) return
    const tipo: TipoMidia | null = f.type.startsWith('image/') ? 'foto' : f.type === 'application/pdf' ? 'pdf' : f.type.startsWith('audio/') ? 'audio' : null
    if (!tipo) return setRecado('Aqui vale foto (JPG, PNG), PDF ou áudio, como no WhatsApp.')
    void mandarArquivo(f, tipo, f.name)
  }

  const gravar = async () => {
    if (gravando) return rec.current?.stop()
    setRecado('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const tipo = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined)
      const partes: Blob[] = []
      r.ondataavailable = (e) => e.data.size && partes.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setGravando(false)
        const b = new Blob(partes, { type: (r.mimeType || tipo || 'audio/webm').split(';')[0] })
        if (b.size > 0) void mandarArquivo(b, 'audio', 'audio')
      }
      r.start()
      rec.current = r
      setGravando(true)
    } catch {
      setRecado('O navegador não liberou o microfone. Libere nas permissões do site ou mande um arquivo de áudio pelo clipe.')
    }
  }

  const doBanco = (id: string | null) => (id ? mensagens.find((m) => m.id === id) ?? null : null)
  const ultimaMinha = [...itens].reverse().find((i) => i.k === 'eu') as { id: string } | undefined
  const detalhe = doBanco(escolhida ?? ultimaMinha?.id ?? null)

  return (
    <>
      <section className="simu-chat" aria-label={`Conversa com ${slot.formatado}`}>
        <header className="simu-chat-topo">
          <img src={`${import.meta.env.BASE_URL}logo-96.png`} alt="" />
          <div>
            <b>Granninha</b>
            <small className={digitando ? 'dig' : ''}>{status}</small>
          </div>
          <span className="simu-chat-de">de {slot.formatado}</span>
        </header>
        {esperando && <div className="simu-espera" style={{ animationDuration: `${ambiente.espera_ms}ms` }} key={ultEntrada?.seq} />}
        <div className="simu-fundo">
          {!itens.length && (
            <div className="simu-vazio">
              {slot.conta
                ? slot.conta.verificado
                  ? 'Conta confirmada. Mande um gasto, uma venda, um áudio ou a foto de um comprovante.'
                  : 'A conta de teste está esperando o código. Use "Mandar o código" ao lado, como a pessoa faria depois do cadastro no site.'
                : 'Este número não tem conta. O que você mandar chega como de um número desconhecido, igual a alguém que escreveu sem se cadastrar.'}
            </div>
          )}
          {itens.map((i) =>
            i.k === 'divisor' ? (
              <div key={i.chave} className="simu-divisor"><span>{i.texto}</span></div>
            ) : i.k === 'ela' ? (
              <div key={i.chave} className="simu-bolha ela">
                <div className="simu-txt">{formatar(i.texto)}</div>
                <span className="simu-meta">{hora(i.em)}</span>
              </div>
            ) : (
              <div
                key={i.id}
                role="button"
                tabIndex={0}
                className={`simu-bolha eu${escolhida === i.id ? ' escolhida' : ''}${i.falhou ? ' falhou' : ''}`}
                onClick={() => setEscolhida(i.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setEscolhida(i.id)}
                title="Ver o que a Granninha entendeu"
              >
                {i.midia && <Midia midia={i.midia} url={previews.current.get(i.id)} />}
                {i.texto && <div className="simu-txt">{formatar(i.texto)}</div>}
                <span className="simu-meta">
                  {hora(i.em)}
                  {i.falhou ? <TriangleAlert size={14} /> : i.enviando ? <Clock3 size={13} /> : i.historico || lidas.has(i.id) ? <CheckCheck size={16} className="lida" /> : <Check size={16} />}
                </span>
                {reacoes.get(i.id) && <span className="simu-reacao">{reacoes.get(i.id)}</span>}
                {i.falhou && <span className="simu-falhou">{i.falhou}</span>}
              </div>
            ),
          )}
          {digitando && (
            <div className="simu-bolha ela simu-digitando" aria-label="digitando">
              <span /><span /><span />
            </div>
          )}
          <div ref={fim} />
        </div>
        {recado && <div className="simu-recado" role="alert">{recado}</div>}
        <div className="simu-barra">
          <input ref={arquivo} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,audio/*" onChange={(e) => {
            escolheuArquivo(e.target.files?.[0])
            e.target.value = ''
          }} />
          <button type="button" className="simu-ic" onClick={() => arquivo.current?.click()} aria-label="Anexar foto, PDF ou áudio" disabled={gravando}>
            <Paperclip size={22} />
          </button>
          <textarea
            ref={caixa}
            rows={1}
            value={gravando ? '' : texto}
            placeholder={gravando ? 'Gravando áudio... toque no quadrado para enviar' : 'Mensagem'}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={tecla}
            disabled={gravando}
            aria-label="Mensagem"
          />
          {texto.trim() && !gravando ? (
            <button type="button" className="simu-ic simu-enviar" onClick={mandarTexto} aria-label="Enviar">
              <Send size={20} />
            </button>
          ) : (
            <button type="button" className={`simu-ic simu-enviar${gravando ? ' gravando' : ''}`} onClick={() => void gravar()} aria-label={gravando ? 'Parar e enviar o áudio' : 'Gravar áudio'}>
              {gravando ? <Square size={18} fill="currentColor" /> : <Mic size={21} />}
            </button>
          )}
        </div>
      </section>
      <Painel slot={slot} ambiente={ambiente} mudou={mudou} detalhe={detalhe} escolhida={!!escolhida} mandarCodigo={(c) => void enviar({ tipo: 'texto', texto: c })} limpou={() => {
        seq.current = 0
        setEventos([])
        setMensagens([])
        setLocais([])
        setEscolhida(null)
      }} />
    </>
  )
}

function Midia({ midia, url }: { midia: { tipo: TipoMidia; nome: string }; url?: string }) {
  if (midia.tipo === 'foto') return url ? <img className="simu-foto" src={url} alt="Foto enviada" /> : <div className="simu-arq"><FileText size={20} /> Foto</div>
  if (midia.tipo === 'audio') return url ? <audio className="simu-audio" src={url} controls preload="metadata" onClick={(e) => e.stopPropagation()} /> : <div className="simu-arq"><Mic size={18} /> Áudio</div>
  return (
    <div className="simu-arq">
      <FileText size={22} />
      <span>{midia.nome || 'documento.pdf'}</span>
    </div>
  )
}

const NOME_STATUS: Record<string, string> = {
  recebida: 'Na fila (ainda não processada)',
  ok: 'Atendida',
  pergunta: 'Respondeu com pergunta',
  ignorada: 'Ignorada (sem lançamento)',
  bloqueada: 'Bloqueada (acesso pausado)',
  erro: 'Deu erro',
  limite: 'Limite do mês',
}

function Painel({ slot, ambiente, mudou, detalhe, escolhida, mandarCodigo, limpou }: {
  slot: Slot
  ambiente: Ambiente
  mudou: () => Promise<void>
  detalhe: Msg | null
  escolhida: boolean
  mandarCodigo: (c: string) => void
  limpou: () => void
}) {
  const [nome, setNome] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [recado, setRecado] = useState('')
  const [confirmarZerar, setConfirmarZerar] = useState(false)
  const c = slot.conta

  const fazer = async (qual: string, f: () => Promise<void>) => {
    setOcupado(qual)
    setRecado('')
    try {
      await f()
    } catch (e) {
      setRecado((e as Error).message)
    } finally {
      setOcupado('')
    }
  }
  const criar = () => fazer('criar', async () => {
    await api('/admin/simulador/conta', { method: 'POST', body: JSON.stringify({ numero: slot.numero, nome: nome.trim() }) })
    await mudou()
  })
  const novoCodigo = () => fazer('codigo', async () => {
    await api('/admin/simulador/codigo', { method: 'POST', body: JSON.stringify({ numero: slot.numero }) })
    await mudou()
  })
  const abrirPainel = () => fazer('painel', async () => {
    const r = await api<{ link: string }>('/admin/link-acesso', { method: 'POST', body: JSON.stringify({ user_id: c?.user_id }) })
    window.open(r.link, '_blank', 'noopener,noreferrer')
  })
  const zerar = () => fazer('zerar', async () => {
    await api('/admin/simulador/zerar', { method: 'POST', body: JSON.stringify({ numero: slot.numero }) })
    setConfirmarZerar(false)
    limpou()
    await mudou()
  })

  const efeitos = detalhe?.efeitos ? Object.entries(detalhe.efeitos).filter(([, v]) => (Array.isArray(v) ? v.length : v)) : []
  const custo = detalhe?.custo_usd != null ? Number(detalhe.custo_usd) : null
  const juntada = detalhe?.erro?.startsWith('juntada em')

  return (
    <aside className="simu-painel">
      <div className="card simu-card">
        <h3>Conta de teste</h3>
        {!c ? (
          <>
            <p className="suave">
              Sem conta neste número. Crie a conta para testar o cadastro: ela nasce como o cadastro do site de hoje (e-mail, senha e este WhatsApp) e recebe o código de 6 dígitos para você mandar.
            </p>
            <label className="campo">
              <span>Nome no cadastro</span>
              <input className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Ana Teste" maxLength={80} />
            </label>
            <button type="button" className="btn btn-pri btn-bloco" onClick={criar} disabled={!!ocupado}>
              <UserPlus size={18} /> {ocupado === 'criar' ? 'Criando...' : 'Criar conta de teste'}
            </button>
          </>
        ) : (
          <>
            <div className="simu-conta">
              <b>{c.nome || 'Sem nome'}</b>
              <small>{c.email}</small>
              <span className={`simu-tag ${situacaoDaConta(c).tom}`}>{situacaoDaConta(c).rotulo}</span>
            </div>
            <dl className="simu-dl">
              <dt>Assinatura</dt>
              <dd>{c.assinatura ? `${NOME_SITUACAO[c.assinatura.status] ?? c.assinatura.status}${c.assinatura.status === 'trial' ? ` até ${dataBR(c.assinatura.trial_fim)}` : ''}` : 'sem assinatura'}</dd>
              <dt>Cadastro</dt>
              <dd>{c.onboarding_via === 'whats' ? 'pelo WhatsApp (o de hoje)' : c.onboarding_via ?? 'pelo site'}</dd>
              {c.etapa_config && (
                <>
                  <dt>Configuração</dt>
                  <dd>{c.etapa_config === 'fim' ? 'terminada' : `na etapa "${c.etapa_config}"`}</dd>
                </>
              )}
            </dl>
            {!c.verificado && (
              <div className="simu-codigo">
                <small>Código para confirmar o número</small>
                {c.codigo ? (
                  <>
                    <b>{c.codigo.codigo}</b>
                    <button type="button" className="btn btn-wa btn-bloco" onClick={() => mandarCodigo(c.codigo!.codigo)}>
                      <Send size={17} /> Mandar o código na conversa
                    </button>
                  </>
                ) : (
                  <span className="suave">O código venceu (vale 30 minutos).</span>
                )}
                <button type="button" className="btn btn-sec btn-bloco" onClick={novoCodigo} disabled={!!ocupado}>
                  <KeyRound size={17} /> {ocupado === 'codigo' ? 'Gerando...' : 'Gerar outro código'}
                </button>
              </div>
            )}
            <button type="button" className="btn btn-sec btn-bloco" onClick={abrirPainel} disabled={!!ocupado}>
              <ExternalLink size={17} /> {ocupado === 'painel' ? 'Abrindo...' : 'Abrir o painel desta conta'}
            </button>
          </>
        )}
        {(c || slot.ultima) &&
          (confirmarZerar ? (
            <div className="simu-zerar">
              <p>{c ? 'Apaga a conta de teste inteira (lançamentos, contas, mensagens) e a conversa deste número.' : 'Apaga as mensagens e a conversa deste número.'}</p>
              <div className="simu-zerar-bt">
                <button type="button" className="btn btn-sec" onClick={() => setConfirmarZerar(false)} disabled={!!ocupado}>Cancelar</button>
                <button type="button" className="btn btn-perigo" onClick={zerar} disabled={!!ocupado}>
                  <Trash2 size={17} /> {ocupado === 'zerar' ? 'Apagando...' : 'Apagar'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-txt simu-zerar-abre" onClick={() => setConfirmarZerar(true)}>
              <RotateCcw size={16} /> Zerar este número
            </button>
          ))}
        {recado && <p className="simu-erro" role="alert">{recado}</p>}
      </div>

      <div className="card simu-card">
        <h3>{escolhida ? 'Mensagem escolhida' : 'Última mensagem'}</h3>
        {!detalhe ? (
          <p className="suave">Toque numa mensagem sua para ver o que a Granninha entendeu, o que gravou e quanto custou.</p>
        ) : juntada ? (
          <p className="suave">Juntada com as mensagens seguintes na espera de {Math.round(ambiente.espera_ms / 1000)} s. A resposta saiu na última delas.</p>
        ) : (
          <dl className="simu-dl">
            <dt>Situação</dt>
            <dd>{NOME_STATUS[detalhe.status] ?? detalhe.status}</dd>
            {detalhe.intencao && (
              <>
                <dt>Entendeu como</dt>
                <dd>{detalhe.intencao}</dd>
              </>
            )}
            {detalhe.texto && detalhe.tipo !== 'texto' && (
              <>
                <dt>Leu</dt>
                <dd className="simu-leu">{detalhe.texto}</dd>
              </>
            )}
            {efeitos.length > 0 && (
              <>
                <dt>Gravou</dt>
                <dd>{efeitos.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : String(v)}`).join(' · ')}</dd>
              </>
            )}
            {detalhe.erro && detalhe.erro !== 'processando' && (
              <>
                <dt>Erro</dt>
                <dd className="simu-erro">{detalhe.erro}</dd>
              </>
            )}
            {detalhe.ms != null && (
              <>
                <dt>Tempo</dt>
                <dd>{(detalhe.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s de processamento</dd>
              </>
            )}
            {custo != null && (
              <>
                <dt>Custo de IA</dt>
                <dd>US$ {custo.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</dd>
              </>
            )}
          </dl>
        )}
      </div>

      <div className="card simu-card simu-amb">
        <h3>Como o servidor está</h3>
        <dl className="simu-dl">
          <dt>Espera antes de responder</dt>
          <dd>{Math.round(ambiente.espera_ms / 1000)} s sem você escrever</dd>
          <dt>Lida, digitando e reação</dt>
          <dd>{ambiente.sinais ? 'ligados' : 'desligados'}</dd>
          <dt>Configuração pela conversa</dt>
          <dd>{ambiente.onboarding_whats ? 'ligada' : 'desligada (conta nova recebe só a confirmação)'}</dd>
        </dl>
        <p className="suave simu-nota">
          A conta de teste é de verdade no banco: aparece na Visão geral e em Clientes enquanto existir, e a IA gasta de verdade. Zere o número quando terminar. Reiniciar o serviço apaga os tiques e as reações da tela; o histórico gravado fica.
        </p>
      </div>
    </aside>
  )
}
