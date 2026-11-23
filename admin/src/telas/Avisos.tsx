import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAviso } from '../../../src/components/ui'
import { rpc } from '../sb'
import { dataHora, Falha } from './comum'
import { Cartao, Pagina, type HeadDef } from './visao/layout'
import { Ausente, n } from './visao/usar'
import { AvisosAcompanhar } from './AvisosAcompanhar'

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
 * são só o que a tela mostra; um teste do servidor trava os números do código (15, 3 minutos, 9h às 19h) para os dois não divergirem.
 */
const TETO_DIA = 15
const ESPERA_MIN = 3

/** `.item-ob` é um grid de coluna `auto`: texto comprido alarga a caixa e come a margem no celular. */
const CAIXA = { gridTemplateColumns: 'minmax(0, 1fr)' } as const

const RODAPE_SAIR = 'Para não receber mais lembretes meus, responda SAIR.'

const MODOS: { v: Modo; rotulo: string; texto: string }[] = [
  { v: 'desligado', rotulo: 'Desligado', texto: 'Não envia nada.' },
  { v: 'ensaio', rotulo: 'Ensaio', texto: 'Não envia nada. Só escreve no registro do servidor quem receberia, para você conferir.' },
  { v: 'piloto', rotulo: 'Piloto', texto: 'Manda UM exemplo por dia para o número do piloto (o seu), com o texto exato e para quem seria. Não envia a nenhum cliente.' },
  { v: 'todos', rotulo: 'Todos', texto: `Envia de verdade aos clientes elegíveis: no máximo ${TETO_DIA} por dia, um a cada ${ESPERA_MIN} minutos, das 9h às 19h.` },
]

const REGRAS: Record<Regra, { titulo: string; desc: string; atraso: string; sumico?: boolean }> = {
  nunca_mandou: {
    titulo: 'Nunca mandou nada',
    desc: 'Confirmou o WhatsApp e ainda não mandou nenhum lançamento. A conta começa na primeira mensagem dele (o código).',
    atraso: 'Esperar quantas horas depois da primeira mensagem',
  },
  parou_de_usar: {
    titulo: 'Parou de usar',
    desc: 'Já mandou lançamentos e sumiu. A conta começa na última mensagem dele, e só vale até 30 dias de sumiço.',
    atraso: 'Esperar quantas horas depois da última mensagem',
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
        { rotulo: 'Enviados hoje', valor: `${n(cfg.enviados_hoje)} de ${TETO_DIA}`, nota: `um a cada ${ESPERA_MIN} minutos, das 9h às 19h` },
        { rotulo: 'Último envio', valor: cfg.ultimo_envio ? dataHora(cfg.ultimo_envio) : '–', texto: true, nota: cfg.ultimo_envio ? undefined : 'nenhum ainda' },
        { rotulo: 'Regras ligadas', valor: `${ligadas} de 2`, nota: ligadas ? 'veja o modo de cada uma abaixo' : 'tudo desligado: nada sai' },
        { rotulo: 'Número atual no ar desde', valor: cfg.numero_desde ? dataHora(cfg.numero_desde) : '–', texto: true, nota: 'só recebe quem escreveu depois disso' },
      ]
    : undefined

  const semCiclo = cfg && ligadas > 0 && (!cfg.ciclo_em || Date.now() - new Date(cfg.ciclo_em).getTime() > 5 * 60_000)

  return (
    <Pagina titulo="Avisos" subtitulo="Lembretes automáticos para quem não está usando a Granninha" heads={heads}>
      <Cartao g={12} titulo="Como o número fica protegido">
        <p className="suave" style={{ margin: 0 }}>
          O número da Granninha não é oficial: se mandar demais ou para quem nunca falou com ele, o WhatsApp bloqueia. Por isso estes limites ficam fixos no servidor e esta tela não os muda.
          No máximo {TETO_DIA} lembretes por dia, um a cada {ESPERA_MIN} minutos, só das 9h às 19h. Só recebe quem já escreveu para o número atual. Uma mensagem por pessoa por regra,
          nunca em dobro. Quem responde SAIR nunca mais recebe. Se o WhatsApp cair ou 3 envios falharem seguidos, para sozinho.
        </p>
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
          <span>Há regra ligada, mas o servidor não rodou o ciclo nos últimos 5 minutos. Confira se a Granninha está no ar na aba Granninha.</span>
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

  const modoInfo = MODOS.find((m) => m.v === modo)!
  return (
    <Cartao g={6} titulo={info.titulo} nota={`${n(r.enviados_7d)} enviados em 7 dias`}>
      <p className="suave" style={{ marginBottom: 12 }}>{info.desc}</p>

      <div className="rotulo" style={{ marginBottom: 6 }}>Modo</div>
      <div className="dupla" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }} role="group" aria-label={`Modo de ${info.titulo}`}>
        {MODOS.map((m) => (
          <button key={m.v} type="button" aria-pressed={modo === m.v} className={`btn ${modo === m.v ? (m.v === 'todos' ? 'btn-perigo' : 'btn-pri') : 'btn-sec'}`} onClick={() => setModo(m.v)}>
            {m.rotulo}
          </button>
        ))}
      </div>
      <p className="suave pq" style={{ marginBottom: 12 }}>{modoInfo.texto}</p>

      <label className="campo">
        <span>{info.atraso}</span>
        <input className="entrada num" inputMode="numeric" value={atraso} onChange={(e) => setAtraso(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label={`Horas de espera em ${info.titulo}`} />
      </label>

      {atrasoOk && previa === null && <p className="suave pq" style={{ margin: '8px 0' }}>Calculando quem receberia agora…</p>}
      {previa && (
        <div className="item-ob ligado" style={{ ...CAIXA, margin: '8px 0' }}>
          <b>{previa.total === 0 ? 'Ninguém receberia agora' : `${n(previa.total)} ${previa.total === 1 ? 'pessoa receberia' : 'pessoas receberiam'} agora`}</b>
          <small className="suave">
            Com {n(atrasoNum)} {atrasoNum === 1 ? 'hora' : 'horas'} de espera. Saem aos poucos: no máximo {TETO_DIA} por dia, um a cada {ESPERA_MIN} minutos.
            {previa.fora_por_numero_antigo > 0 && ` ${n(previa.fora_por_numero_antigo)} ${previa.fora_por_numero_antigo === 1 ? 'fica' : 'ficam'} de fora por ${previa.fora_por_numero_antigo === 1 ? 'ter escrito' : 'terem escrito'} só para o número antigo: seria contato frio.`}
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
        <span>Texto da mensagem (use {'{nome}'} para o primeiro nome)</span>
        <textarea className="entrada" rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label={`Texto de ${info.titulo}`} style={{ resize: 'vertical', minHeight: 110 }} />
      </label>
      <p className="suave pq" style={{ margin: '4px 0 8px' }}>
        {texto.trim().length} de 600 letras. Sem emoji, sem travessão, sem link. {erroTexto && <b style={{ color: 'var(--out, #b4232c)' }}>{erroTexto}</b>}
      </p>
      <div className="item-ob" style={{ ...CAIXA, marginBottom: 10 }}>
        <small className="suave">Assim chega no WhatsApp (a última linha entra sozinha e você não consegue tirar):</small>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.45, background: 'var(--card, #fff)', border: '1px solid var(--linha, #dcdcec)', borderRadius: 8, padding: 10 }}>{montarPrevia(texto)}</div>
      </div>

      <label className="campo">
        <span>Motivo (fica na auditoria)</span>
        <input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: começar o ensaio" />
      </label>

      {ligandoTodos && (
        <div className="item-ob ligado" style={{ ...CAIXA, marginTop: 10 }}>
          <label className="suave" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} style={{ marginTop: 3 }} />
            Estou ciente de que, a partir de agora, a Granninha manda mensagem sozinha pelo número dela{previa ? ` (hoje seriam ${n(previa.total)} ${previa.total === 1 ? 'pessoa' : 'pessoas'}, no máximo ${TETO_DIA} por dia)` : ''}.
          </label>
        </div>
      )}
      {erro && <div style={{ marginTop: 10 }}><Falha texto={erro} /></div>}
      <button type="button" className={`btn ${ligandoTodos ? 'btn-perigo' : 'btn-pri'} btn-bloco`} style={{ marginTop: 12 }} disabled={ocupado || !pronto} onClick={salvar}>
        {ocupado ? 'Salvando…' : ligandoTodos ? 'Ligar para todos' : 'Salvar'}
      </button>

      {r.etapas && r.etapas.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--linha, #dcdcec)' }}>
          <div className="rotulo" style={{ marginBottom: 4 }}>Se a pessoa não responder: etapas 2 e 3</div>
          <p className="suave pq" style={{ marginBottom: 10 }}>
            Só saem para quem NÃO reagiu à mensagem anterior: se responder ou lançar, a sequência para. No máximo 3 mensagens por pessoa, somando as duas regras, e no mínimo 48 horas
            entre duas mensagens à mesma pessoa. Nascem desligadas.
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

/** "96 h (4 dias)": horas e o equivalente em dias, que é como o Arthur pensa. */
const horasEmDias = (h: number) => (h % 24 === 0 ? `${h} h (${h / 24} ${h / 24 === 1 ? 'dia' : 'dias'})` : `${h} h`)

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
        ? `A etapa 2 precisa esperar mais que a etapa 1 (${r.atraso_horas} h).`
        : outra && atrasoNum >= outra.atraso_horas
          ? `A etapa 2 precisa esperar menos que a etapa 3 (${outra.atraso_horas} h).`
          : null
      : outra && atrasoNum <= outra.atraso_horas
        ? `A etapa 3 precisa esperar mais que a etapa 2 (${outra.atraso_horas} h).`
        : null
  const erroTexto = validarTexto(texto)
  // A 3 só liga com a 2 ligada, e a 2 só desliga com a 3 desligada.
  const travaLigar = !n2 && !!outra && !outra.ativa ? 'Ligue a etapa 2 primeiro.' : null
  const travaDesligar = n2 && !!outra && outra.ativa ? 'Desligue a etapa 3 primeiro.' : null
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
      avisar(ativa ? `Etapa ${e.etapa} ligada. Vale no próximo minuto.` : `Etapa ${e.etapa} desligada.`)
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
        <input type="checkbox" checked={ativa} disabled={ativa ? !!travaDesligar : !!travaLigar} onChange={(x) => setAtiva(x.target.checked)} aria-label={`Etapa ${e.etapa} de ${REGRAS[r.regra].titulo} ligada`} />
        Etapa {e.etapa}: {ativa ? 'ligada' : 'desligada'}
      </label>
      {(ativa ? travaDesligar : travaLigar) && <small className="suave">{ativa ? travaDesligar : travaLigar}</small>}
      <label className="campo">
        <span>Esperar quantas horas ({r.regra === 'nunca_mandou' ? 'depois da primeira mensagem dele' : 'desde a última atividade dele'}){atrasoOk ? `: ${horasEmDias(atrasoNum)}` : ''}</span>
        <input className="entrada num" inputMode="numeric" value={atraso} onChange={(x) => setAtraso(x.target.value.replace(/\D/g, '').slice(0, 3))} aria-label={`Horas de espera da etapa ${e.etapa} de ${REGRAS[r.regra].titulo}`} />
      </label>
      {erroOrdem && <small style={{ color: 'var(--out, #b4232c)', fontWeight: 620 }}>{erroOrdem}</small>}
      {previa && (
        <small className="suave">
          {previa.total === 0 ? 'Ninguém receberia esta etapa agora.' : `${n(previa.total)} ${previa.total === 1 ? 'pessoa receberia' : 'pessoas receberiam'} esta etapa agora.`}
        </small>
      )}
      <label className="campo">
        <span>Texto da etapa {e.etapa} (use {'{nome}'})</span>
        <textarea className="entrada" rows={4} value={texto} onChange={(x) => setTexto(x.target.value)} aria-label={`Texto da etapa ${e.etapa} de ${REGRAS[r.regra].titulo}`} style={{ resize: 'vertical', minHeight: 90 }} />
      </label>
      <small className="suave">
        {texto.trim().length} de 600 letras. Sem emoji, sem travessão, sem link. {erroTexto && <b style={{ color: 'var(--out, #b4232c)' }}>{erroTexto}</b>}
      </small>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.45, background: 'var(--card, #fff)', border: '1px solid var(--linha, #dcdcec)', borderRadius: 8, padding: 10 }}>{montarPrevia(texto)}</div>
      <label className="campo">
        <span>Motivo (fica na auditoria)</span>
        <input className="entrada" value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder={`Ex.: ${ligando ? 'ligar a etapa ' + e.etapa : 'ajustar o texto'}`} />
      </label>
      {precisaCiente && (
        <label className="suave" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input type="checkbox" checked={ciente} onChange={(x) => setCiente(x.target.checked)} style={{ marginTop: 3 }} />
          Estou ciente de que a regra está em Todos: ligar esta etapa é mais uma mensagem saindo sozinha pelo número, para quem não respondeu à anterior.
        </label>
      )}
      {erro && <Falha texto={erro} />}
      <button type="button" className={`btn ${precisaCiente ? 'btn-perigo' : 'btn-pri'} btn-bloco`} disabled={ocupado || !pronto} onClick={salvar}>
        {ocupado ? 'Salvando…' : ligando ? `Ligar a etapa ${e.etapa}` : `Salvar a etapa ${e.etapa}`}
      </button>
    </div>
  )
}
