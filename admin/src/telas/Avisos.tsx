import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAviso } from '../../../src/components/ui'
import { rpc } from '../sb'
import { dataHora, Falha } from './comum'
import { Cartao, Pagina, type HeadDef } from './visao/layout'
import { Ausente, n } from './visao/usar'
import { AvisosAcompanhar } from './AvisosAcompanhar'
import { cicloParado } from './avisosCiclo'

type Regra = 'nunca_mandou' | 'parou_de_usar'
type Modo = 'desligado' | 'ensaio' | 'piloto' | 'todos'

interface EtapaCfg {
  etapa: 2 | 3
  ativa: boolean
  atraso_horas: number
  texto: string
  atualizado_em: string
}
interface RegraCfg {
  regra: Regra
  modo: Modo
  atraso_horas: number
  texto: string
  atualizado_em: string
  enviados_7d: number
  /** As etapas 2 e 3 (acompanhamento de quem não respondeu). Ausente antes da migration da sequência. */
  etapas?: EtapaCfg[]
}
interface Cfg {
  regras: RegraCfg[]
  enviados_hoje: number
  ultimo_envio: string | null
  numero_desde: string | null
  ciclo_em: string | null
  erro: string | null
}
interface Previa {
  total: number
  fora_por_numero_antigo: number
  itens: { nome: string; negocio: string; horas: number }[]
}

/**
 * A proteção do número mora no CÓDIGO do servidor (server/src/retencao.ts) e não muda por esta tela, de propósito. Estes valores
 * são só o que a tela mostra; um teste do servidor trava o teto do dia contra o código (15) para os dois não divergirem.
 */
const TETO_DIA = 15

/** `.item-ob` é um grid de coluna `auto`: texto comprido alarga a caixa e come a margem no celular. */
const CAIXA = { gridTemplateColumns: 'minmax(0, 1fr)' } as const

const RODAPE_SAIR = 'Para não receber mais lembretes meus, responda SAIR.'

const MODOS: { v: Modo; rotulo: string; texto: string }[] = [
  { v: 'desligado', rotulo: 'Desligado', texto: 'não manda nada.' },
  { v: 'ensaio', rotulo: 'Ensaio', texto: 'não manda nada, só mostra quem receberia, para você conferir.' },
  { v: 'piloto', rotulo: 'Piloto', texto: 'manda um exemplo só para você, para ver como fica. Não manda para nenhum cliente.' },
  { v: 'todos', rotulo: 'Todos', texto: 'manda de verdade para os clientes.' },
]

const REGRAS: Record<Regra, { titulo: string; desc: string; atraso: string; sumico?: boolean }> = {
  nunca_mandou: {
    titulo: 'Nunca mandou nada',
    desc: 'Pessoas que confirmaram o WhatsApp, mas ainda não lançaram nada.',
    atraso: 'Quantas horas depois da última mensagem da pessoa',
  },
  parou_de_usar: {
    titulo: 'Parou de usar',
    desc: 'Pessoas que já lançaram e sumiram.',
    atraso: 'Quantas horas depois da última vez que a pessoa usou',
    sumico: true,
  },
}

/** As mesmas regras que o banco aplica ao salvar (admin_retencao_definir). Aqui só para avisar antes, sem ir ao banco. */
function validarTexto(t: string): string | null {
  const s = t.trim()
  if (s.length < 20) return 'O texto precisa ter pelo menos 20 letras.'
  if (s.length > 600) return 'O texto passou de 600 letras.'
  if (/[—–]/.test(s)) return 'Sem travessão no texto.'
  if (/\p{Extended_Pictographic}/u.test(s)) return 'Sem emoji no texto.'
  if (/(https?:\/\/|www\.|\.com\b|\.br\b)/i.test(s)) return 'Sem link no texto.'
  if (/\bsair\b/i.test(s)) return 'Não escreva SAIR: a linha do SAIR entra sozinha no fim.'
  return null
}

/** Como o servidor monta a mensagem: {nome} vira o primeiro nome, e a linha do SAIR é sempre a última. */
const montarPrevia = (texto: string) => `${texto.replace(/\{nome\}/gi, 'Maria').replace(/,\s*([!.,?])/g, '$1').trim()}\n\n${RODAPE_SAIR}`

export function Avisos() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [erro, setErro] = useState('')
  const [ausente, setAusente] = useState(false)

  const carregar = useCallback(async () => {
    try {
      setCfg(await rpc<Cfg>('admin_retencao_config'))
      setErro('')
    } catch (e) {
      const m = (e as Error).message
      if (/does not exist|could not find|schema cache/i.test(m)) setAusente(true)
      else setErro(m)
    }
  }, [])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), 30_000)
    return () => clearInterval(t)
  }, [carregar])

  if (ausente) return <Pagina titulo="Avisos" heads={[]}><Ausente nome="admin_retencao_config" /></Pagina>
  if (erro && !cfg) return <Pagina titulo="Avisos" heads={[]}><Falha texto={erro} /></Pagina>

  const ligadas = cfg ? cfg.regras.filter((r) => r.modo !== 'desligado').length : 0
  const heads: HeadDef[] | undefined = cfg
    ? [
        { rotulo: 'Enviados hoje', valor: `${n(cfg.enviados_hoje)} de ${TETO_DIA}`, nota: 'limite por dia, para proteger o número' },
        { rotulo: 'Último envio', valor: cfg.ultimo_envio ? dataHora(cfg.ultimo_envio) : '–', texto: true, nota: cfg.ultimo_envio ? undefined : 'nenhum ainda' },
        { rotulo: 'Regras ligadas', valor: `${ligadas} de 2`, nota: ligadas ? 'veja o modo de cada uma abaixo' : 'tudo desligado: nada é enviado' },
        { rotulo: 'Número atual no ar desde', valor: cfg.numero_desde ? dataHora(cfg.numero_desde) : '–', texto: true, nota: 'só recebe quem falou com ele depois' },
      ]
    : undefined

  const semCiclo = cfg ? cicloParado(cfg.regras, cfg.ciclo_em) : false

  return (
    <Pagina titulo="Avisos" subtitulo="Lembretes automáticos para quem não está usando a Granninha" heads={heads}>
      <Cartao g={12} titulo="Pra que serve esta página">
        <div className="pilha" style={{ gap: 8 }}>
          <p className="suave" style={{ margin: 0 }}>A Granninha chama no WhatsApp quem se cadastrou e não está usando, para a pessoa voltar a lançar.</p>
          <p className="suave" style={{ margin: 0 }}><b>Nunca mandou nada:</b> a pessoa entrou, mas ainda não lançou nada.</p>
          <p className="suave" style={{ margin: 0 }}><b>Parou de usar:</b> a pessoa já lançou e sumiu.</p>
          <p className="suave" style={{ margin: 0 }}>Cada uma pode mandar até 3 mensagens, uma depois da outra. Se a pessoa responder ou lançar, as próximas não saem.</p>
          <p className="suave" style={{ margin: 0 }}>Para não arriscar o número da Granninha, ela manda poucas por dia e nunca de madrugada. Quem responder SAIR não recebe mais.</p>
        </div>
      </Cartao>

      <AvisosAcompanhar />

      {cfg && erro && <div style={{ gridColumn: '1 / -1' }}><Falha texto={erro} /></div>}
      {cfg && cfg.erro && (
        <div className="vaviso ruim" role="alert" style={{ gridColumn: '1 / -1' }}>
          <TriangleAlert size={20} style={{ flex: 'none' }} />
          <span>Último erro do envio: {cfg.erro}</span>
        </div>
      )}
      {semCiclo && (
        <div className="vaviso ruim" role="alert" style={{ gridColumn: '1 / -1' }}>
          <TriangleAlert size={20} style={{ flex: 'none' }} />
          <span>Tem regra ligada há mais de 5 minutos, mas a Granninha não avisou que está trabalhando nos lembretes. Confira se ela está no ar na aba Granninha.</span>
        </div>
      )}

      {!cfg ? <span className="skel" style={{ height: 320, gridColumn: '1 / -1' }} /> : cfg.regras.map((r) => <RegraCartao key={r.regra} r={r} aoSalvar={carregar} />)}
    </Pagina>
  )
}

function RegraCartao({ r, aoSalvar }: { r: RegraCfg; aoSalvar: () => Promise<void> }) {
  const avisar = useAviso()
  const info = REGRAS[r.regra]
  const [modo, setModo] = useState<Modo>(r.modo)
  const [atraso, setAtraso] = useState(String(r.atraso_horas))
  const [texto, setTexto] = useState(r.texto)
  const [motivo, setMotivo] = useState('')
  const [ciente, setCiente] = useState(false)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  // Depois de salvar (ou de outro admin mudar), a tela volta a refletir o que está no banco.
  useEffect(() => {
    setModo(r.modo)
    setAtraso(String(r.atraso_horas))
    setTexto(r.texto)
  }, [r.modo, r.atraso_horas, r.texto])

  const atrasoNum = Number(atraso)
  const atrasoOk = /^\d{1,3}$/.test(atraso) && atrasoNum >= 1 && atrasoNum <= 720
  const erroTexto = validarTexto(texto)
  const mudou = modo !== r.modo || atrasoNum !== r.atraso_horas || texto.trim() !== r.texto.trim()
  const ligandoTodos = modo === 'todos' && r.modo !== 'todos'

  // Quem receberia agora com este atraso, com um respiro para não consultar a cada tecla.
  useEffect(() => {
    setPrevia(null)
    if (!atrasoOk) return
    let vivo = true
    const t = setTimeout(() => {
      rpc<Previa>('admin_retencao_previa', { p_regra: r.regra, p_atraso: atrasoNum })
        .then((p) => vivo && setPrevia(p))
        .catch(() => vivo && setPrevia(null))
    }, 400)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [r.regra, atrasoOk, atrasoNum])

  useEffect(() => setCiente(false), [modo])

  const pronto = mudou && atrasoOk && !erroTexto && motivo.trim().length >= 3 && (!ligandoTodos || (previa !== null && ciente))

  const salvar = async () => {
    setErro('')
    setOcupado(true)
    try {
      await rpc('admin_retencao_definir', { p_regra: r.regra, p_modo: modo, p_atraso: atrasoNum, p_texto: texto.trim(), p_motivo: motivo.trim() })
      setMotivo('')
      setCiente(false)
      await aoSalvar()
      avisar(modo === 'desligado' ? 'Regra desligada.' : modo === 'todos' ? 'Regra ligada para todos. Vale no próximo minuto.' : `Regra em modo ${modo}. Vale no próximo minuto.`)
    } catch (e) {
      const m = (e as Error).message
      setErro(m.includes('motivo') ? 'Escreva o motivo (pelo menos 3 letras).' : m)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Cartao g={6} titulo={info.titulo} nota={`${n(r.enviados_7d)} enviados em 7 dias`}>
      <p className="suave" style={{ marginBottom: 10 }}>{info.desc}</p>
      <div className="item-ob ligado" style={{ ...CAIXA, marginBottom: 12 }}>
        <b>Resumo</b>
        <small className="suave">{resumoDaRegra(r)}</small>
      </div>

      <div className="rotulo" style={{ marginBottom: 6 }}>Modo</div>
      <div className="dupla" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }} role="group" aria-label={`Modo de ${info.titulo}`}>
        {MODOS.map((m) => (
          <button key={m.v} type="button" aria-pressed={modo === m.v} className={`btn ${modo === m.v ? (m.v === 'todos' ? 'btn-perigo' : 'btn-pri') : 'btn-sec'}`} onClick={() => setModo(m.v)}>
            {m.rotulo}
          </button>
        ))}
      </div>
      <div className="pilha" style={{ gap: 2, marginBottom: 12 }}>
        {MODOS.map((m) => (
          <small key={m.v} className="suave" style={modo === m.v ? { fontWeight: 650, color: 'var(--text)' } : undefined}>
            <b>{m.rotulo}:</b> {m.texto}
          </small>
        ))}
      </div>

      <label className="campo">
        <span>{info.atraso}{atrasoOk ? `: ${prazo(atrasoNum)}` : ''}</span>
        <input className="entrada num" inputMode="numeric" value={atraso} onChange={(e) => setAtraso(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label={`Horas de espera em ${info.titulo}`} />
      </label>

      {atrasoOk && previa === null && <p className="suave pq" style={{ margin: '8px 0' }}>Calculando quem receberia agora…</p>}
      {previa && (
        <div className="item-ob ligado" style={{ ...CAIXA, margin: '8px 0' }}>
          <b>{previa.total === 0 ? 'Ninguém receberia agora' : `${n(previa.total)} ${previa.total === 1 ? 'pessoa receberia' : 'pessoas receberiam'} agora`}</b>
          <small className="suave">
            Com essa espera. Elas saem aos poucos, não todas de uma vez.
            {previa.fora_por_numero_antigo > 0 && ` ${n(previa.fora_por_numero_antigo)} ${previa.fora_por_numero_antigo === 1 ? 'fica' : 'ficam'} de fora porque ${previa.fora_por_numero_antigo === 1 ? 'só falou' : 'só falaram'} com o número antigo.`}
          </small>
          {previa.itens.length > 0 && (
            <small className="suave" style={{ display: 'block' }}>
              {previa.itens.slice(0, 8).map((i) => `${i.nome.split(' ')[0]} (${n(i.horas)} h)`).join(', ')}
              {previa.itens.length > 8 ? ` e mais ${n(previa.total - 8)}` : ''}
            </small>
          )}
        </div>
      )}

      <label className="campo">
        <span>Mensagem que a pessoa recebe</span>
        <textarea className="entrada" rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label={`Texto de ${info.titulo}`} style={{ resize: 'vertical', minHeight: 110 }} />
      </label>
      <p className="suave pq" style={{ margin: '4px 0 8px' }}>
        Use {'{nome}'} para aparecer o primeiro nome da pessoa. {texto.trim().length} de 600 letras. Sem emoji, travessão ou link. {erroTexto && <b style={{ color: 'var(--out, #b4232c)' }}>{erroTexto}</b>}
      </p>
      <div className="item-ob" style={{ ...CAIXA, marginBottom: 10 }}>
        <small className="suave">Assim a pessoa vai ver (a última frase entra sozinha):</small>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.45, background: 'var(--card, #fff)', border: '1px solid var(--linha, #dcdcec)', borderRadius: 8, padding: 10 }}>{montarPrevia(texto)}</div>
      </div>

      <label className="campo">
        <span>Motivo (fica anotado na aba Auditoria)</span>
        <input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: começar o ensaio" />
      </label>

      {ligandoTodos && (
        <div className="item-ob ligado" style={{ ...CAIXA, marginTop: 10 }}>
          <label className="suave" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} style={{ marginTop: 3 }} />
            Estou ciente de que a Granninha vai mandar mensagem de verdade para os clientes{previa ? ` (hoje seriam ${n(previa.total)} ${previa.total === 1 ? 'pessoa' : 'pessoas'})` : ''}.
          </label>
        </div>
      )}
      {erro && <div style={{ marginTop: 10 }}><Falha texto={erro} /></div>}
      <button type="button" className={`btn ${ligandoTodos ? 'btn-perigo' : 'btn-pri'} btn-bloco`} style={{ marginTop: 12 }} disabled={ocupado || !pronto} onClick={salvar}>
        {ocupado ? 'Salvando…' : ligandoTodos ? 'Ligar para todos' : 'Salvar'}
      </button>

      {r.etapas && r.etapas.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--linha, #dcdcec)' }}>
          <div className="rotulo" style={{ marginBottom: 4 }}>Se a pessoa não responder: 2ª e 3ª mensagem</div>
          <p className="suave pq" style={{ marginBottom: 10 }}>
            Mandam outra mensagem para quem ignorou a anterior. Se a pessoa responder ou lançar, elas não saem. Cada pessoa recebe no máximo 3 mensagens, somando tudo. Começam desligadas.
          </p>
          <div className="pilha" style={{ gap: 12 }}>
            {r.etapas.map((e) => (
              <EtapaForm key={e.etapa} r={r} e={e} outra={r.etapas!.find((x) => x.etapa !== e.etapa)} aoSalvar={aoSalvar} />
            ))}
          </div>
        </div>
      )}
    </Cartao>
  )
}

/** O prazo do jeito que se fala: "1 dia", "4 dias", "36 horas". */
const prazo = (h: number) => (h === 24 ? '1 dia' : h > 24 && h % 24 === 0 ? `${h / 24} dias` : h === 1 ? '1 hora' : `${h} horas`)

/** Uma frase simples que traduz a configuração de agora: o que esta regra faz hoje e quando manda cada mensagem. */
function resumoDaRegra(r: RegraCfg): string {
  const sem = r.regra === 'nunca_mandou' ? 'sem lançar nada' : 'sem usar'
  const estado = r.modo === 'desligado' ? 'Está desligada, então não manda nada.' : r.modo === 'ensaio' ? 'Está em ensaio: não manda nada, só mostra quem receberia.' : r.modo === 'piloto' ? 'Está em piloto: manda só um exemplo para você.' : 'Está ligada: manda de verdade para os clientes.'
  const etapas = r.etapas ?? []
  const ligadas = etapas.filter((e) => e.ativa)
  const desligadas = etapas.filter((e) => !e.ativa).map((e) => `${e.etapa}ª`)
  const partes = [`A 1ª mensagem vai depois de ${prazo(r.atraso_horas)} ${sem}.`]
  for (const e of ligadas) partes.push(`A ${e.etapa}ª vai quando completar ${prazo(e.atraso_horas)} ${sem}, só se a pessoa não respondeu.`)
  if (desligadas.length) partes.push(`A ${desligadas.join(' e a ')} ${desligadas.length > 1 ? 'estão desligadas' : 'está desligada'}.`)
  return `${estado} ${partes.join(' ')}`
}

/** Uma etapa de acompanhamento (2 ou 3): ligar, atraso e texto. As regras de ordem são as mesmas do banco (admin_retencao_etapa_definir). */
function EtapaForm({ r, e, outra, aoSalvar }: { r: RegraCfg; e: EtapaCfg; outra: EtapaCfg | undefined; aoSalvar: () => Promise<void> }) {
  const avisar = useAviso()
  const [ativa, setAtiva] = useState(e.ativa)
  const [atraso, setAtraso] = useState(String(e.atraso_horas))
  const [texto, setTexto] = useState(e.texto)
  const [motivo, setMotivo] = useState('')
  const [ciente, setCiente] = useState(false)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    setAtiva(e.ativa)
    setAtraso(String(e.atraso_horas))
    setTexto(e.texto)
  }, [e.ativa, e.atraso_horas, e.texto])

  const n2 = e.etapa === 2
  const atrasoNum = Number(atraso)
  const atrasoOk = /^\d{1,3}$/.test(atraso) && atrasoNum >= 1 && atrasoNum <= 720
  // A ordem dos atrasos: etapa 1 < etapa 2 < etapa 3 (o banco confere de novo ao salvar).
  const erroOrdem = !atrasoOk
    ? null
    : n2
      ? atrasoNum <= r.atraso_horas
        ? `A 2ª mensagem precisa esperar mais que a 1ª (${r.atraso_horas} h).`
        : outra && atrasoNum >= outra.atraso_horas
          ? `A 2ª mensagem precisa esperar menos que a 3ª (${outra.atraso_horas} h).`
          : null
      : outra && atrasoNum <= outra.atraso_horas
        ? `A 3ª mensagem precisa esperar mais que a 2ª (${outra.atraso_horas} h).`
        : null
  const erroTexto = validarTexto(texto)
  // A 3 só liga com a 2 ligada, e a 2 só desliga com a 3 desligada.
  const travaLigar = !n2 && !!outra && !outra.ativa ? 'Ligue a 2ª mensagem primeiro.' : null
  const travaDesligar = n2 && !!outra && outra.ativa ? 'Desligue a 3ª mensagem primeiro.' : null
  const mudou = ativa !== e.ativa || atrasoNum !== e.atraso_horas || texto.trim() !== e.texto.trim()
  const ligando = ativa && !e.ativa
  const precisaCiente = ligando && r.modo === 'todos'

  useEffect(() => {
    setPrevia(null)
    if (!atrasoOk || erroOrdem) return
    let vivo = true
    const t = setTimeout(() => {
      rpc<Previa>('admin_retencao_previa', { p_regra: r.regra, p_atraso: atrasoNum, p_etapa: e.etapa })
        .then((p) => vivo && setPrevia(p))
        .catch(() => vivo && setPrevia(null))
    }, 400)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [r.regra, e.etapa, atrasoOk, atrasoNum, erroOrdem])

  useEffect(() => setCiente(false), [ativa])

  const pronto = mudou && atrasoOk && !erroOrdem && !erroTexto && motivo.trim().length >= 3 && (!precisaCiente || ciente)

  const salvar = async () => {
    setErro('')
    setOcupado(true)
    try {
      await rpc('admin_retencao_etapa_definir', { p_regra: r.regra, p_etapa: e.etapa, p_ativa: ativa, p_atraso: atrasoNum, p_texto: texto.trim(), p_motivo: motivo.trim() })
      setMotivo('')
      setCiente(false)
      await aoSalvar()
      avisar(ativa ? `${e.etapa}ª mensagem ligada. Vale no próximo minuto.` : `${e.etapa}ª mensagem desligada.`)
    } catch (x) {
      const m = (x as Error).message
      setErro(m.includes('motivo') ? 'Escreva o motivo (pelo menos 3 letras).' : m)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="item-ob ligado" style={CAIXA}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 650 }}>
        <input type="checkbox" checked={ativa} disabled={ativa ? !!travaDesligar : !!travaLigar} onChange={(x) => setAtiva(x.target.checked)} aria-label={`${e.etapa}ª mensagem de ${REGRAS[r.regra].titulo} ligada`} />
        {e.etapa}ª mensagem: {ativa ? 'ligada' : 'desligada'}
      </label>
      {(ativa ? travaDesligar : travaLigar) && <small className="suave">{ativa ? travaDesligar : travaLigar}</small>}
      <label className="campo">
        <span>{r.regra === 'nunca_mandou' ? 'Quantas horas depois da última mensagem da pessoa' : 'Quantas horas depois da última vez que a pessoa usou'}{atrasoOk ? `: ${prazo(atrasoNum)}` : ''}</span>
        <input className="entrada num" inputMode="numeric" value={atraso} onChange={(x) => setAtraso(x.target.value.replace(/\D/g, '').slice(0, 3))} aria-label={`Horas de espera da ${e.etapa}ª mensagem de ${REGRAS[r.regra].titulo}`} />
      </label>
      {erroOrdem && <small style={{ color: 'var(--out, #b4232c)', fontWeight: 620 }}>{erroOrdem}</small>}
      {previa && (
        <small className="suave">
          {previa.total === 0 ? 'Ninguém receberia esta mensagem agora.' : `${n(previa.total)} ${previa.total === 1 ? 'pessoa receberia' : 'pessoas receberiam'} esta mensagem agora.`}
        </small>
      )}
      <label className="campo">
        <span>Texto da {e.etapa}ª mensagem</span>
        <textarea className="entrada" rows={4} value={texto} onChange={(x) => setTexto(x.target.value)} aria-label={`Texto da ${e.etapa}ª mensagem de ${REGRAS[r.regra].titulo}`} style={{ resize: 'vertical', minHeight: 90 }} />
      </label>
      <small className="suave">
        Use {'{nome}'} para o primeiro nome. {texto.trim().length} de 600 letras. Sem emoji, travessão ou link. {erroTexto && <b style={{ color: 'var(--out, #b4232c)' }}>{erroTexto}</b>}
      </small>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.45, background: 'var(--card, #fff)', border: '1px solid var(--linha, #dcdcec)', borderRadius: 8, padding: 10 }}>{montarPrevia(texto)}</div>
      <label className="campo">
        <span>Motivo (fica anotado na aba Auditoria)</span>
        <input className="entrada" value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder={`Ex.: ${ligando ? `ligar a ${e.etapa}ª mensagem` : 'ajustar o texto'}`} />
      </label>
      {precisaCiente && (
        <label className="suave" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input type="checkbox" checked={ciente} onChange={(x) => setCiente(x.target.checked)} style={{ marginTop: 3 }} />
          Estou ciente: a regra já manda de verdade, então esta mensagem também vai para os clientes que não responderam à anterior.
        </label>
      )}
      {erro && <Falha texto={erro} />}
      <button type="button" className={`btn ${precisaCiente ? 'btn-perigo' : 'btn-pri'} btn-bloco`} disabled={ocupado || !pronto} onClick={salvar}>
        {ocupado ? 'Salvando…' : ligando ? `Ligar a ${e.etapa}ª mensagem` : `Salvar a ${e.etapa}ª mensagem`}
      </button>
    </div>
  )
}
