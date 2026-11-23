import { Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { custoReais, reais, type Consumo } from '../../custo'
import { dataHora, Falha } from '../comum'
import { AreaDia, Anel, Spark } from './graficos'
import { Cartao, Gaveta, Pagina, VisaoCtx, type HeadDef } from './layout'
import { rpc } from '../../sb'
import { usePainel } from './painel'
import { dataExtensa, diaMes, chegaram, maiorPerda, nome1, waLink } from './util'
import { hojeSP, n, NOME_PASSO, useRpc } from './usar'
import { useContext } from 'react'

interface Dia extends Consumo {
  dia: string
  mensagens: number
}
interface Periodo {
  dias: Dia[]
}
interface Item {
  user_id: string
  nome: string
  negocio: string
  whats: string
  grupo: 'bloq' | 'sumiu' | 'nunca' | 'whats'
  status: string | null
  passo: number
  criado_em: string
  ultima: string | null
  dias: number
}
interface Acoes {
  contagem: Partial<Record<Item['grupo'], number>>
  itens: Item[]
}
interface Ret {
  semanas: { semana: string; total: number }[]
  ativos_semana: number
  confirmados: number
  sumiram: number
}
interface Ativ {
  total: number
  passos: Record<string, number>
  confirmaram: number
  com_mensagem: number
}
/** A fila do envio pelo sistema (função admin_envios_fila). `previsto_em` é calculado no banco: a tela só conta o tempo que falta. */
interface ItemFila {
  id: string
  user_id: string
  status: 'fila' | 'enviando'
  pedido_em: string
  posicao: number
  previsto_em: string
}
interface Recente {
  id: string
  user_id: string
  status: 'enviado' | 'falhou'
  enviado_em: string | null
  erro: string | null
}
interface Fila {
  agora: string
  espera_min: number
  ultimo_envio_em: string | null
  whatsapp_ok: boolean
  itens: ItemFila[]
  recentes: Recente[]
}
type EstadoEnvio =
  | { tipo: 'fila' | 'enviando'; id: string; previsto: number; posicao: number }
  | { tipo: 'enviado'; em: number | null }
  | { tipo: 'falhou'; erro: string }

/** Só estes grupos têm envio pelo sistema: quem parou no passo do WhatsApp nunca escreveu para o número, e quem está sem acesso pede conversa de gente. */
const COM_ENVIO: Item['grupo'][] = ['nunca', 'sumiu']
/** A recusa do banco para quem só falou com o número ANTIGO (contato frio). Só nesse caso a tela oferece o link do WhatsApp pessoal: quem respondeu SAIR ou pediu exclusão não recebe nada. */
const RECUSA_FRIA = /nunca escreveu para o número atual/i
/** A mesma linha que o servidor acrescenta no fim de toda mensagem (RODAPE_SAIR em server/src/retencao.ts). */
const LINHA_SAIR = 'Para não receber mais lembretes meus, responda SAIR.'

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const diaSP = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const mmss = (seg: number) => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`
const haQuanto = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 1 ? 'agora há pouco' : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)} h`
}

const GRUPOS: { id: Item['grupo']; nome: string }[] = [
  { id: 'nunca', nome: 'Nunca usaram' },
  { id: 'whats', nome: 'Pararam no WhatsApp' },
  { id: 'sumiu', nome: 'Sumiram' },
  { id: 'bloq', nome: 'Sem acesso' },
]

function motivo(i: Item) {
  switch (i.grupo) {
    case 'bloq':
      return { m: 'Conta sem acesso', q: i.status === 'bloqueada' ? 'bloqueada' : i.status === 'atrasada' ? 'pagamento em atraso' : 'teste vencido' }
    case 'sumiu':
      return { m: 'Usava e parou', q: `última mensagem há ${i.dias} dias` }
    case 'nunca':
      return { m: 'Confirmou o WhatsApp e nunca usou', q: `cadastro há ${i.dias} dias` }
    default:
      return { m: 'Parou em Confirmar WhatsApp', q: `cadastro há ${i.dias} dias` }
  }
}

function sugestao(i: Item) {
  const nome = nome1(i.nome, '')
  const oi = nome ? `Oi, ${nome}!` : 'Oi!'
  switch (i.grupo) {
    case 'nunca':
      return `${oi} Aqui é da Granninha. Vi que você já conectou seu WhatsApp, mas ainda não mandou o primeiro lançamento. Quer que eu te mostre como é rápido? Me manda, por exemplo: gastei 50 no mercado.`
    case 'whats':
      return `${oi} Aqui é da Granninha. Vi que você começou o cadastro e parou na hora de confirmar o WhatsApp. Posso te ajudar a terminar? Leva um minuto.`
    case 'sumiu':
      return `${oi} Faz uns dias que você não usa a Granninha. Aconteceu alguma coisa? Se algo atrapalhou, me conta que eu resolvo.`
    default:
      return `${oi} Aqui é da Granninha. Sua conta está pausada. Posso te ajudar a reativar?`
  }
}

const porque: Record<Item['grupo'], (d: number) => string> = {
  nunca: (d) => `Confirmou o WhatsApp há ${d} dias e não mandou nada. Quanto mais cedo a primeira conversa, maior a chance de virar hábito.`,
  whats: (d) => `Fez o cadastro há ${d} dias e travou na confirmação do número. Sem confirmar, a Granninha não responde.`,
  sumiu: (d) => `Usava a Granninha e está há ${d} dias sem mandar nada. É o sinal mais cedo de que a pessoa vai embora.`,
  bloq: () => 'A conta está sem acesso. Vale entender o motivo antes de qualquer contato.',
}

const IconeWa = () => (
  <svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.4 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 .9-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.3 0 .5l-.4.6c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l2 .9c.3.1.5.2.5.3.1.2.1.8-.1 1.4Z" />
  </svg>
)

/** O estado do envio ao lado do nome: contagem na fila (só este pedacinho se atualiza a cada segundo), enviado ou falhou. */
function ChipEnvio({ e, whatsOk, desvio }: { e: EstadoEnvio; whatsOk: boolean; desvio: number }) {
  const [agora, setAgora] = useState(() => Date.now())
  const contando = e.tipo === 'fila'
  useEffect(() => {
    if (!contando) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [contando])
  const servidor = agora + desvio
  if (e.tipo === 'enviando') return <div className="ac-fila" role="status"><b>Enviando</b>agora</div>
  if (e.tipo === 'enviado') return <div className="ac-fila ok"><b>Enviado</b>{e.em ? haQuanto(servidor - e.em) : 'pelo sistema'}</div>
  if (e.tipo === 'falhou') return <div className="ac-fila ruim" title={e.erro}><b>Não saiu</b>abra a ficha</div>
  const falta = Math.max(0, Math.round((e.previsto - servidor) / 1000))
  const quem = e.posicao > 1 ? `${e.posicao}º na fila` : 'Na fila'
  const quando = !whatsOk ? 'WhatsApp desconectado' : falta <= 20 * 60 ? (falta === 0 ? 'sai em instantes' : `sai em ${mmss(falta)}`) : `sai ${diaSP(e.previsto) !== diaSP(servidor) ? 'amanhã ' : ''}às ${hhmm(e.previsto)}`
  return <div className="ac-fila" role="status"><b>{quem}</b>{quando}</div>
}

/** O que o admin confere antes de soltar uma mensagem de verdade: o texto exato, por onde sai e quando. */
function ConfirmarEnvio({ item, fila, desvio, onFechar, onEnviado, onRecusaFria }: { item: Item; fila: Fila; desvio: number; onFechar: () => void; onEnviado: () => void; onRecusaFria: () => void }) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const texto = sugestao(item)
  const recente = fila.ultimo_envio_em ? Date.now() + desvio - Date.parse(fila.ultimo_envio_em) < fila.espera_min * 60_000 : false
  const espera = fila.itens.length > 0 || recente
  async function enviar() {
    if (enviando) return
    setEnviando(true)
    setErro('')
    try {
      await rpc('admin_envio_pedir', { p_user: item.user_id, p_grupo: item.grupo, p_texto: texto })
      onEnviado()
    } catch (e) {
      const msg = (e as Error).message
      setErro(msg)
      setEnviando(false)
      if (RECUSA_FRIA.test(msg)) onRecusaFria()
    }
  }
  const fria = RECUSA_FRIA.test(erro)
  return (
    <>
      <span className="k">Confirmar envio</span>
      <h3>{item.nome || 'Sem nome'}</h3>
      <div className="sub-g">{item.negocio}</div>
      <h4>Mensagem que vai sair</h4>
      <div className="msg">
        {texto}
        <span className="sair">{LINHA_SAIR}</span>
      </div>
      <p className="texto-ajuda">
        {espera
          ? `Já há envio recente ou pedidos na frente: esta entra na fila e sai sozinha, ${fila.espera_min} minutos depois do anterior.`
          : `Sai em até 1 minuto. Entre um envio e outro o sistema espera ${fila.espera_min} minutos.`}{' '}
        Sai pelo número da Granninha e só entre 9h e 19h. Dá para cancelar enquanto estiver na fila.
      </p>
      {!fila.whatsapp_ok && <div className="por">O WhatsApp da Granninha está desconectado agora. O pedido fica na fila e sai quando reconectar.</div>}
      {erro && <div className="por" role="alert">{erro}</div>}
      {fria && <p className="texto-ajuda">Esta pessoa só falou com o número antigo da Granninha. Pelo seu WhatsApp pessoal você pode chamar: o texto abre pronto, você revisa e envia.</p>}
      <div className="acoes-g">
        <button type="button" onClick={onFechar}>
          Cancelar
        </button>
        {fria ? (
          <a className="p" href={waLink(item.whats, texto)} target="_blank" rel="noopener noreferrer">
            Abrir no WhatsApp
          </a>
        ) : (
          <button type="button" className="p" onClick={enviar} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar mensagem'}
          </button>
        )}
      </div>
    </>
  )
}

/** Hoje em uma tela: o que pede ação, a retenção, o movimento e a saúde da ferramenta. */
export function Resumo() {
  const { ir } = useContext(VisaoCtx)
  const { p, erro } = usePainel()
  const hoje = hojeSP()
  const ini60 = useMemo(() => {
    const d = new Date(`${hoje}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 59)
    return d.toISOString().slice(0, 10)
  }, [hoje])
  const per = useRpc<Periodo>('admin_custo_periodo', { p_inicio: ini60, p_fim: hoje }, 120_000)
  const acoes = useRpc<Acoes>('admin_acoes', {}, 120_000)
  const ret = useRpc<Ret>('admin_retencao', {}, 120_000)
  const ativ = useRpc<Ativ>('admin_ativacao', {}, 120_000)
  const [filtro, setFiltro] = useState<'todos' | Item['grupo']>('todos')
  const [sel, setSel] = useState<Item | null>(null)
  const [errosAbertos, setErrosAbertos] = useState(false)
  // Envio pelo sistema. Sem a migration (função ausente) ou com erro de leitura, tudo volta ao link do WhatsApp: nunca uma tela quebrada.
  const [versaoFila, setVersaoFila] = useState(0)
  const fila = useRpc<Fila>('admin_envios_fila', {}, 10_000, versaoFila)
  const [confirmar, setConfirmar] = useState<Item | null>(null)
  const [avisoEnvio, setAvisoEnvio] = useState('')
  // Quem o banco recusou por nunca ter escrito para o número atual: a linha volta ao link do WhatsApp em vez de oferecer um botão que sempre falha.
  const [soAntigo, setSoAntigo] = useState<Record<string, true>>({})
  const fecharFicha = useCallback(() => setSel(null), [])
  const fecharConfirmar = useCallback(() => setConfirmar(null), [])
  // A diferença entre o relógio do servidor e o deste navegador, para a contagem não depender de o relógio daqui estar certo.
  const recebidoEm = useMemo(() => Date.now(), [fila.dados])
  const desvio = fila.dados ? Date.parse(fila.dados.agora) - recebidoEm : 0
  const podeEnviar = !!fila.dados
  const comEnvioPara = (i: Item) => podeEnviar && COM_ENVIO.includes(i.grupo) && !soAntigo[i.user_id]
  const envioDe = (i: Item): EstadoEnvio | null => {
    const f = fila.dados
    if (!f || !COM_ENVIO.includes(i.grupo)) return null
    const ativo = f.itens.find((x) => x.user_id === i.user_id)
    if (ativo) return { tipo: ativo.status, id: ativo.id, previsto: Date.parse(ativo.previsto_em), posicao: ativo.posicao }
    const rec = f.recentes.find((x) => x.user_id === i.user_id)
    if (!rec) return null
    return rec.status === 'enviado' ? { tipo: 'enviado', em: rec.enviado_em ? Date.parse(rec.enviado_em) : null } : { tipo: 'falhou', erro: rec.erro ?? 'o envio falhou' }
  }
  async function cancelarEnvio(id: string) {
    setAvisoEnvio('')
    try {
      const r = await rpc<{ ok: boolean; motivo?: string }>('admin_envio_cancelar', { p_id: id })
      if (!r.ok) setAvisoEnvio(r.motivo ? `Não deu para cancelar: ${r.motivo}.` : 'Não deu para cancelar.')
    } catch (e) {
      setAvisoEnvio(`Não deu para cancelar: ${(e as Error).message}`)
    }
    setVersaoFila((v) => v + 1)
  }

  const dias = per.dados?.dias ?? []
  const ult30 = dias.slice(-30)
  const ant30 = dias.slice(-60, -30)
  const mesAtual = hoje.slice(0, 7)
  const custoMes = dias.filter((d) => d.dia.startsWith(mesAtual)).reduce((s, d) => s + custoReais(d), 0)
  const msgsMes = dias.filter((d) => d.dia.startsWith(mesAtual)).reduce((s, d) => s + d.mensagens, 0)
  const custoHoje = dias.length ? custoReais(dias[dias.length - 1]) : 0

  if (erro) return <Pagina titulo="Visão geral" subtitulo={dataExtensa()} heads={[]}><Falha texto={erro} /></Pagina>

  const s = p?.saude
  const minutos = s ? (Date.now() - new Date(s.atualizado_em).getTime()) / 60_000 : Infinity
  const conectado = s?.whatsapp_estado === 'CONNECTED' && minutos <= 3

  const heads: HeadDef[] | undefined = p
    ? [
        { rotulo: 'Clientes', valor: n(p.clientes), nota: `${n(p.novos_7d)} novos em 7 dias`, para: 'ativacao' },
        {
          rotulo: 'Usaram esta semana',
          valor: ret.dados ? n(ret.dados.ativos_semana) : '–',
          nota: ret.dados ? `de ${n(ret.dados.confirmados)} com WhatsApp confirmado` : ret.ausente ? 'falta a migration' : 'carregando',
          spark: ret.dados?.semanas.map((x) => x.total),
          para: 'retencao',
        },
        {
          rotulo: 'Custo de IA no mês',
          valor: per.dados ? reais(custoMes) : '–',
          nota: per.dados ? `hoje ${reais(custoHoje)}${msgsMes ? ` · ${reais(custoMes / msgsMes)} por mensagem` : ''}` : per.ausente ? 'falta a migration' : 'carregando',
          spark: dias.filter((d) => d.dia.startsWith(mesAtual)).map((d) => custoReais(d)),
          para: 'custo',
        },
        { rotulo: 'Mensagens hoje', valor: n(p.mensagens_hoje), nota: `${n(p.respondidas_hoje)} respondidas`, spark: p.mensagens_por_dia.map((d) => d.n), para: 'custo' },
      ]
    : undefined

  const controles = p ? (
    <span className={`status-geral ${conectado ? 'ok' : 'ruim'}`}>
      <i />
      {conectado ? 'Tudo funcionando' : 'Atenção: o WhatsApp não está conectado'}
    </span>
  ) : undefined

  const todos = acoes.dados?.itens ?? []
  const lista = (filtro === 'todos' ? todos : todos.filter((i) => i.grupo === filtro)).slice(0, 6)
  const total = acoes.dados ? Object.values(acoes.dados.contagem).reduce((a, b) => a + (b ?? 0), 0) : 0

  const perda = ativ.dados ? maiorPerda(ativ.dados.passos) : null
  const aneis = ativ.dados
    ? [
        { nome: 'Terminaram as boas-vindas', v: (chegaram(ativ.dados.passos, 7) / Math.max(1, ativ.dados.total)) * 100, cor: '#454c83' },
        { nome: 'Confirmaram o WhatsApp', v: (ativ.dados.confirmaram / Math.max(1, ativ.dados.total)) * 100, cor: '#0e8250' },
        { nome: 'Usaram a Granninha', v: (ativ.dados.com_mensagem / Math.max(1, ativ.dados.total)) * 100, cor: '#747ead' },
      ]
    : []

  return (
    <Pagina titulo="Visão geral" subtitulo={dataExtensa()} controles={controles} heads={heads}>
      <Cartao g={8} titulo="Precisa de você hoje" nota={acoes.dados ? `${n(total)} contas` : undefined}>
        {acoes.ausente ? (
          <p className="texto-ajuda">Esta lista usa a função admin_acoes, que ainda não foi aplicada no banco. Falta rodar a migration 20261121150000.</p>
        ) : !acoes.dados ? (
          <div style={{ display: 'grid', gap: 12 }} aria-hidden="true">
            {[0, 1, 2, 3].map((k) => (
              <span key={k} className="skel" style={{ height: 52 }} />
            ))}
          </div>
        ) : total === 0 ? (
          <p className="texto-ajuda">Ninguém precisa de contato agora.</p>
        ) : (
          <>
            <div className="filtros" role="group" aria-label="Filtrar">
              <button type="button" className={filtro === 'todos' ? 'on' : ''} onClick={() => setFiltro('todos')}>
                Todos<b>{total}</b>
              </button>
              {GRUPOS.filter((g) => (acoes.dados?.contagem[g.id] ?? 0) > 0).map((g) => (
                <button key={g.id} type="button" className={filtro === g.id ? 'on' : ''} onClick={() => setFiltro(g.id)}>
                  {g.nome}
                  <b>{acoes.dados?.contagem[g.id]}</b>
                </button>
              ))}
            </div>
            {avisoEnvio && <p className="texto-ajuda" role="status">{avisoEnvio}</p>}
            <div className="linhas" style={{ marginTop: 6 }}>
              {lista.map((i) => {
                const mt = motivo(i)
                const env = envioDe(i)
                const comEnvio = comEnvioPara(i)
                return (
                  <div key={i.user_id} className="ac" role="button" tabIndex={0} onClick={() => setSel(i)} onKeyDown={(e) => (e.key === 'Enter' ? setSel(i) : undefined)}>
                    <div className="ac-id">
                      <b>{i.nome || 'Sem nome'}</b>
                      <span className="s">{i.negocio || 'Sem negócio'}</span>
                      <span className="q">
                        {mt.m} · {mt.q}
                      </span>
                    </div>
                    {comEnvio ? (
                      <div className="ac-lado" onClick={(e) => e.stopPropagation()}>
                        {env && env.tipo !== 'falhou' ? <ChipEnvio e={env} whatsOk={fila.dados?.whatsapp_ok ?? true} desvio={desvio} /> : null}
                        {env?.tipo === 'fila' && (
                          <button type="button" className="ac-mini" onClick={() => void cancelarEnvio(env.id)} aria-label={`Cancelar o envio para ${i.nome}`}>
                            Cancelar
                          </button>
                        )}
                        {env?.tipo === 'falhou' && (
                          <>
                            <ChipEnvio e={env} whatsOk desvio={desvio} />
                            <button type="button" className="ac-mini" onClick={() => setConfirmar(i)} aria-label={`Tentar de novo para ${i.nome}`}>
                              Tentar de novo
                            </button>
                          </>
                        )}
                        {!env && (
                          <button type="button" className="ac-env" onClick={() => setConfirmar(i)} aria-label={`Enviar mensagem para ${i.nome}`}>
                            <Send aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <a className="ac-wa" href={waLink(i.whats, sugestao(i))} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Chamar ${i.nome} no WhatsApp`}>
                        <IconeWa />
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="rodape-cartao">{(filtro === 'todos' ? todos.length : todos.filter((i) => i.grupo === filtro).length) > 6 ? 'Mostrando as 6 primeiras. Os grupos mais urgentes vêm antes.' : 'Toque numa conta para ver a ficha e a mensagem sugerida.'}</p>
          </>
        )}
      </Cartao>

      <Cartao g={4} titulo="Retenção" lado={<button type="button" className="lnk-cab" onClick={() => ir('retencao')}>Detalhar →</button>}>
        {ret.dados ? (
          <>
            <div className="ringbox">
              <Anel pct={(ret.dados.ativos_semana / Math.max(1, ret.dados.confirmados)) * 100} cor="#0e8250" tam={104} esp={10} />
              <p>
                <b>{n(ret.dados.ativos_semana)} de {n(ret.dados.confirmados)}</b> clientes com WhatsApp confirmado usaram a Granninha nesta semana.
              </p>
            </div>
            <div style={{ flex: 1, minHeight: 90, marginBottom: 6 }}>
              <Spark cheio valores={ret.dados.semanas.map((x) => x.total)} cor="#454c83" />
            </div>
            <p className="nota-fim">
              <b>{n(ret.dados.sumiram)} clientes sumiram</b> há 7 dias ou mais.
            </p>
          </>
        ) : ret.ausente ? (
          <p className="texto-ajuda">Falta aplicar a migration 20261121150000.</p>
        ) : (
          <span className="skel" style={{ height: 150 }} />
        )}
      </Cartao>

      <Cartao g={8} titulo="Mensagens por dia" lado={<div className="leg"><span><i />Últimos 30 dias</span><span><i className="p" />30 dias anteriores</span></div>}>
        {per.ausente ? (
          <p className="texto-ajuda">Falta aplicar a migration 20261121140000.</p>
        ) : ult30.length > 1 ? (
          <AreaDia
            nome="Mensagens por dia: últimos 30 dias contra os 30 anteriores"
            valores={ult30.map((d) => d.mensagens)}
            anterior={ant30.length === ult30.length ? ant30.map((d) => d.mensagens) : undefined}
            rotulos={ult30.map((d) => diaMes(d.dia))}
            titulos={ult30.map((d) => diaMes(d.dia))}
            formato={(v) => `${n(Math.round(v))} mensagens`}
            formatoCurto={(v) => n(Math.round(v))}
          />
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
      </Cartao>

      <Cartao g={4} titulo="Ativação" lado={<button type="button" className="lnk-cab" onClick={() => ir('ativacao')}>Detalhar →</button>}>
        {ativ.dados ? (
          <>
            <div className="aneis">
              {aneis.map((a) => (
                <div key={a.nome}>
                  <Anel pct={a.v} cor={a.cor} tam={84} esp={9} />
                  <b>{a.nome}</b>
                </div>
              ))}
            </div>
            {perda && (
              <p className="nota-fim">
                Mais gente para em <b>{NOME_PASSO[perda.k]}</b>: {Math.round(perda.taxa * 100)}% de quem chega lá.
              </p>
            )}
          </>
        ) : (
          <span className="skel" style={{ height: 150 }} />
        )}
      </Cartao>

      <Cartao g={12} titulo="Saúde da ferramenta">
        {p ? (
          <>
            <div className="saude">
              <div>
                <small>WhatsApp da Granninha</small>
                <b className={conectado ? 'cor-in' : 'cor-out'}>
                  <i />
                  {!s ? 'sem sinal' : minutos > 3 ? `sem sinal há ${Math.round(minutos)} min` : conectado ? 'Conectado' : (s.whatsapp_estado ?? 'desconhecido')}
                </b>
              </div>
              <div>
                <small>Fila de mensagens</small>
                <b>{s?.fila ?? '–'}</b>
              </div>
              <div>
                <small>Última mensagem</small>
                <b>{dataHora(p.ultima_mensagem)}</b>
              </div>
              <div>
                <small>Erros nas últimas 24h</small>
                {p.erros_24h > 0 ? (
                  <button type="button" onClick={() => setErrosAbertos(!errosAbertos)}>
                    <b className="cor-out">
                      <i />
                      {n(p.erros_24h)} <span className="ver">{errosAbertos ? 'ocultar' : 'ver'}</span>
                    </b>
                  </button>
                ) : (
                  <b className="cor-in">
                    <i />0
                  </b>
                )}
              </div>
            </div>
            {errosAbertos && (
              <div className="linhas" style={{ marginTop: 14 }}>
                {p.ultimos_erros.map((e, k) => (
                  <div key={k} className="erro-l">
                    <span>
                      {dataHora(e.criado_em)} · {e.tipo}
                    </span>
                    <span>{e.erro}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <span className="skel" style={{ height: 60 }} />
        )}
      </Cartao>

      <Gaveta aberta={!!sel} onFechar={fecharFicha} rotulo="Ficha do cliente">
        {sel && (
          <>
            <span className="k">{motivo(sel).m}</span>
            <h3>{sel.nome || 'Sem nome'}</h3>
            <div className="sub-g">{sel.negocio}</div>
            <div className="por">{porque[sel.grupo](sel.dias)}</div>
            {envioDe(sel)?.tipo === 'falhou' && <div className="por">O último envio pelo sistema não saiu: {(envioDe(sel) as { erro: string }).erro}</div>}
            {envioDe(sel)?.tipo === 'enviado' && <div className="por ok">Já mandamos uma mensagem pelo sistema nas últimas 24 horas.</div>}
            {(envioDe(sel)?.tipo === 'fila' || envioDe(sel)?.tipo === 'enviando') && <div className="por ok">Mensagem na fila do sistema. Ela sai sozinha, e dá para cancelar na lista.</div>}
            <div className="fato"><span>WhatsApp</span><b>{sel.whats || 'sem número'}</b></div>
            <div className="fato"><span>Cadastro</span><b>{dataHora(sel.criado_em)}</b></div>
            <div className="fato"><span>Passo das boas-vindas</span><b>{NOME_PASSO[Math.min(7, sel.passo)] ?? sel.passo}</b></div>
            <div className="fato"><span>Última mensagem</span><b>{dataHora(sel.ultima)}</b></div>
            <h4>Mensagem sugerida</h4>
            <div className="msg">{sugestao(sel)}</div>
            {(() => {
              const env = envioDe(sel)
              const podeSistema = comEnvioPara(sel) && (!env || env.tipo === 'falhou')
              return (
                <>
                  <div className="acoes-g">
                    {podeSistema && (
                      <button type="button" className="p" onClick={() => { setSel(null); setConfirmar(sel) }}>
                        {env?.tipo === 'falhou' ? 'Tentar de novo pelo sistema' : 'Enviar pelo sistema'}
                      </button>
                    )}
                    <a className={podeSistema ? '' : 'p'} href={waLink(sel.whats, sugestao(sel))} target="_blank" rel="noopener noreferrer">
                      Abrir conversa no WhatsApp
                    </a>
                  </div>
                  <p className="texto-ajuda">
                    {podeSistema
                      ? 'Enviar pelo sistema usa o número da Granninha, com fila de 5 minutos entre mensagens. O link abre a sua conversa pessoal: você revisa e envia.'
                      : 'O texto abre pronto na conversa; você revisa e envia.'}
                  </p>
                </>
              )
            })()}
          </>
        )}
      </Gaveta>

      <Gaveta aberta={!!confirmar && !!fila.dados} onFechar={fecharConfirmar} rotulo="Confirmar envio">
        {confirmar && fila.dados && (
          <ConfirmarEnvio
            key={confirmar.user_id}
            item={confirmar}
            fila={fila.dados}
            desvio={desvio}
            onFechar={fecharConfirmar}
            onRecusaFria={() => setSoAntigo((m) => ({ ...m, [confirmar.user_id]: true }))}
            onEnviado={() => {
              setConfirmar(null)
              setAvisoEnvio('')
              setVersaoFila((v) => v + 1)
            }}
          />
        )}
      </Gaveta>
    </Pagina>
  )
}
