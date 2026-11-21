import { useMemo, useState } from 'react'
import { custoReais, reais, type Consumo } from '../../custo'
import { dataHora, Falha } from '../comum'
import { AreaDia, Anel, Spark } from './graficos'
import { Cartao, Gaveta, Pagina, VisaoCtx, type HeadDef } from './layout'
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

const GRUPOS: { id: Item['grupo']; nome: string }[] = [
  { id: 'nunca', nome: 'Nunca mandaram' },
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
      return { m: 'Confirmou o WhatsApp e nunca mandou mensagem', q: `cadastro há ${i.dias} dias` }
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

  const dias = per.dados?.dias ?? []
  const ult30 = dias.slice(-30)
  const ant30 = dias.slice(-60, -30)
  const mesAtual = hoje.slice(0, 7)
  const custoMes = dias.filter((d) => d.dia.startsWith(mesAtual)).reduce((s, d) => s + custoReais(d), 0)
  const msgsMes = dias.filter((d) => d.dia.startsWith(mesAtual)).reduce((s, d) => s + d.mensagens, 0)
  const custoHoje = dias.length ? custoReais(dias[dias.length - 1]) : 0

  if (erro) return <Pagina titulo="Visão geral" subtitulo={dataExtensa()}><Falha texto={erro} /></Pagina>

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
        { nome: 'Mandaram a 1ª mensagem', v: (ativ.dados.com_mensagem / Math.max(1, ativ.dados.total)) * 100, cor: '#747ead' },
      ]
    : []

  return (
    <Pagina titulo="Visão geral" subtitulo={dataExtensa()} controles={controles} heads={heads}>
      <Cartao g={8} titulo="Precisa de você hoje" nota={acoes.dados ? `${n(total)} contas` : undefined}>
        {acoes.ausente ? (
          <p className="texto-ajuda">Esta lista usa a função admin_acoes, que ainda não foi aplicada no banco. Falta rodar a migration 20261121130000.</p>
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
            <div className="linhas" style={{ marginTop: 6 }}>
              {lista.map((i) => {
                const mt = motivo(i)
                return (
                  <div key={i.user_id} className="ac" role="button" tabIndex={0} onClick={() => setSel(i)} onKeyDown={(e) => (e.key === 'Enter' ? setSel(i) : undefined)}>
                    <div className="ac-id">
                      <b>{i.nome || 'Sem nome'}</b>
                      <span className="s">{i.negocio || 'Sem negócio'}</span>
                      <span className="q">
                        {mt.m} · {mt.q}
                      </span>
                    </div>
                    <a className="ac-wa" href={waLink(i.whats, sugestao(i))} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Chamar ${i.nome} no WhatsApp`}>
                      <IconeWa />
                    </a>
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
          <p className="texto-ajuda">Falta aplicar a migration 20261121130000.</p>
        ) : (
          <span className="skel" style={{ height: 150 }} />
        )}
      </Cartao>

      <Cartao g={8} titulo="Mensagens por dia" lado={<div className="leg"><span><i />Últimos 30 dias</span><span><i className="p" />30 dias anteriores</span></div>}>
        {per.ausente ? (
          <p className="texto-ajuda">Falta aplicar a migration 20261121120000.</p>
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

      <Gaveta aberta={!!sel} onFechar={() => setSel(null)} rotulo="Ficha do cliente">
        {sel && (
          <>
            <span className="k">{motivo(sel).m}</span>
            <h3>{sel.nome || 'Sem nome'}</h3>
            <div className="sub-g">{sel.negocio}</div>
            <div className="por">{porque[sel.grupo](sel.dias)}</div>
            <div className="fato"><span>WhatsApp</span><b>{sel.whats || 'sem número'}</b></div>
            <div className="fato"><span>Cadastro</span><b>{dataHora(sel.criado_em)}</b></div>
            <div className="fato"><span>Passo das boas-vindas</span><b>{NOME_PASSO[Math.min(7, sel.passo)] ?? sel.passo}</b></div>
            <div className="fato"><span>Última mensagem</span><b>{dataHora(sel.ultima)}</b></div>
            <h4>Mensagem sugerida</h4>
            <div className="msg">{sugestao(sel)}</div>
            <div className="acoes-g">
              <a className="p" href={waLink(sel.whats, sugestao(sel))} target="_blank" rel="noopener noreferrer">
                Abrir conversa no WhatsApp
              </a>
            </div>
            <p className="texto-ajuda">O texto abre pronto na conversa; você revisa e envia.</p>
          </>
        )}
      </Gaveta>
    </Pagina>
  )
}
