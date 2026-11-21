import { CircleCheck, Copy, Search, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAviso } from '../../../src/components/ui'
import { api, rpc } from '../sb'
import { dataBR, dataHora, Falha, NOME_SITUACAO } from './comum'
import { Cartao, Gaveta, Pagina, type HeadDef } from './visao/layout'
import { usePainel } from './visao/painel'
import { n } from './visao/usar'

interface Cliente {
  id: string
  nome: string
  email: string
  negocio: string
  whats: string
  verificado: boolean
  situacao: string
  plano: string
  trial_fim: string
  motivo: string | null
  criado_em: string
  ultimo_lancamento: string | null
  lancamentos: number
  mensagens_mes: number
  onboarding_passo: number
  onboarding_feito: boolean
  papel: string
}
/** `.item-ob` é um grid de coluna `auto`: texto comprido (como o aviso do limite) alarga a gaveta e come a margem direita no celular. */
const CAIXA = { gridTemplateColumns: 'minmax(0, 1fr)' } as const

/** Limite mensal de lançamentos pelo WhatsApp: o próprio do cliente (se houver), o padrão de todos e quanto ele já usou no mês. */
interface LimiteCliente {
  padrao: number
  proprio: number | null
  efetivo: number
  uso_mes: number
}

interface Ficha {
  carteiras: { nome: string; tipo: string }[]
  lancamentos_por_origem: Record<string, number>
  contas_abertas: number
  fixas: number
  ultimas_mensagens: { criado_em: string; tipo: string; status: string; intencao: string | null; texto: string }[]
  auditoria: { criado_em: string; acao: string; detalhes: { motivo?: string; antes?: string; depois?: string; dias?: number } }[]
}

const FILTROS: [string, string][] = [
  ['', 'Todos'],
  ['trial', 'Em teste'],
  ['teste_vencido', 'Teste vencido'],
  ['ativa', 'Em dia'],
  ['atrasada', 'Em atraso'],
  ['bloqueada', 'Bloqueadas'],
  ['cortesia', 'Cortesia'],
]

const ACOES: Record<string, { rotulo: string; dica: string; dias?: boolean }> = {
  cortesia: { rotulo: 'Liberar sem pagamento (cortesia)', dica: 'Para parceiros. A cobrança nunca bloqueia esta conta.' },
  estender_teste: { rotulo: 'Estender o teste grátis', dica: 'Soma dias ao fim do teste (ou a partir de hoje, se já venceu).', dias: true },
  liberar: { rotulo: 'Liberar como em dia', dica: 'Use quando o pagamento foi confirmado por fora.' },
  bloquear: { rotulo: 'Bloquear acesso', dica: 'O cliente só consegue pagar e baixar os dados.' },
}

export function Clientes() {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('')
  const [lista, setLista] = useState<Cliente[] | null>(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState<Cliente | null>(null)

  const carregar = () =>
    rpc<Cliente[]>('admin_clientes', { p_busca: busca.trim(), p_situacao: filtro })
      .then((l) => {
        setLista(l)
        setErro('')
      })
      .catch((e: Error) => setErro(e.message))

  useEffect(() => {
    const t = setTimeout(carregar, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtro])

  const { p } = usePainel()
  const sit = p?.por_situacao ?? {}
  const heads: HeadDef[] | undefined = p
    ? [
        { rotulo: 'Clientes', valor: n(p.clientes), nota: `${n(p.novos_7d)} novos em 7 dias` },
        { rotulo: 'Em dia', valor: n(sit.ativa ?? 0), nota: `${n(sit.cortesia ?? 0)} em cortesia` },
        { rotulo: 'Em teste', valor: n(sit.trial ?? 0), nota: `${n(sit.teste_vencido ?? 0)} com teste vencido` },
        { rotulo: 'Sem acesso', valor: n((sit.bloqueada ?? 0) + (sit.atrasada ?? 0) + (sit.teste_vencido ?? 0)), nota: 'bloqueadas, em atraso ou teste vencido', tom: (sit.bloqueada ?? 0) + (sit.atrasada ?? 0) > 0 ? 'ruim' : undefined },
      ]
    : undefined

  return (
    <Pagina titulo="Clientes" subtitulo="Busque, abra a ficha e mude a situação de cada conta" heads={heads}>
      <Cartao g={12}>
        <div className="cl-busca">
          <Search size={18} aria-hidden="true" />
          <input type="search" placeholder="Nome, negócio, e-mail ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar clientes" />
        </div>
        <div className="filtros" role="group" aria-label="Filtrar por situação" style={{ marginBottom: 6 }}>
          {FILTROS.map(([v, r]) => (
            <button key={v} type="button" className={filtro === v ? 'on' : ''} aria-pressed={filtro === v} onClick={() => setFiltro(v)}>
              {r}
            </button>
          ))}
        </div>
        {erro && <Falha texto={erro} />}
        {!lista ? (
          <div style={{ display: 'grid', gap: 12, marginTop: 10 }} aria-hidden="true">
            {[0, 1, 2, 3, 4].map((k) => (
              <span key={k} className="skel" style={{ height: 56 }} />
            ))}
          </div>
        ) : lista.length === 0 ? (
          <p className="texto-ajuda">Nenhum cliente encontrado.</p>
        ) : (
          <div className="linhas">
            {lista.map((c) => (
              <button type="button" className="cl-l" key={c.id} onClick={() => setAberto(c)}>
                <div className="cl-id">
                  <b>{c.nome || '(sem nome)'}</b>
                  <span className="s">{c.negocio || 'sem negócio'}</span>
                  <span className="q">
                    {c.whats || 'sem WhatsApp'}
                    {c.whats && (c.verificado ? ' · confirmado' : ' · não confirmado')} · último lançamento {dataBR(c.ultimo_lancamento)}
                  </span>
                </div>
                <div className="cl-v">
                  <span className={`situacao s-${c.situacao}`}>{NOME_SITUACAO[c.situacao] ?? c.situacao}</span>
                  <small>{c.mensagens_mes} msg no mês</small>
                </div>
              </button>
            ))}
          </div>
        )}
        {lista && <p className="rodape-cartao">{lista.length} {lista.length === 1 ? 'cliente' : 'clientes'}{lista.length === 500 ? ' (mostrando os 500 mais novos)' : ''}</p>}
      </Cartao>
      <FichaCliente c={aberto} fechar={() => setAberto(null)} mudou={carregar} />
    </Pagina>
  )
}

function FichaCliente({ c, fechar, mudou }: { c: Cliente | null; fechar: () => void; mudou: () => void }) {
  const avisar = useAviso()
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [acao, setAcao] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [dias, setDias] = useState('7')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [link, setLink] = useState('')
  const [emailConf, setEmailConf] = useState('')
  const [limite, setLimite] = useState<LimiteCliente | null>(null)
  const [valorLimite, setValorLimite] = useState('')

  useEffect(() => {
    setFicha(null)
    setAcao(null)
    setMotivo('')
    setErro('')
    setLink('')
    setEmailConf('')
    setLimite(null)
    setValorLimite('')
    if (c) rpc<Ficha>('admin_cliente', { p_id: c.id }).then(setFicha).catch((e: Error) => setErro(e.message))
    // Sem a migration do limite a função não existe: a ficha segue sem o bloco, em vez de dar erro.
    if (c) rpc<LimiteCliente>('admin_limite_cliente', { p_user: c.id }).then(setLimite).catch(() => setLimite(null))
  }, [c])

  if (!c) return null

  const executar = async (a: string) => {
    setErro('')
    setOcupado(true)
    try {
      const r = await rpc<{ situacao: string }>('admin_acao', { p_user: c.id, p_acao: a, p_motivo: motivo.trim(), p_dias: Number(dias) || 0 })
      avisar(`Feito. Situação agora: ${NOME_SITUACAO[r.situacao] ?? r.situacao}`)
      mudou()
      fechar()
    } catch (e) {
      setErro((e as Error).message.includes('motivo') ? 'Escreva o motivo (pelo menos 3 letras).' : (e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const gerarLink = async (tipo?: 'senha') => {
    setErro('')
    setOcupado(true)
    try {
      const r = await api<{ link: string }>('/admin/link-acesso', { method: 'POST', body: JSON.stringify({ user_id: c.id, tipo }) })
      setLink(r.link)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  /** Muda o limite SÓ deste cliente, ou (remover) tira o limite próprio e ele volta a seguir o padrão. */
  const salvarLimite = async (remover = false) => {
    setErro('')
    setOcupado(true)
    try {
      const r = await rpc<{ efetivo: number }>('admin_limite_definir', { p_user: c.id, p_valor: remover ? null : Number(valorLimite), p_motivo: motivo.trim() })
      avisar(remover ? `Limite próprio removido. Agora vale o padrão: ${n(r.efetivo)} por mês.` : `Limite deste cliente: ${n(r.efetivo)} lançamentos por mês.`)
      mudou()
      fechar()
    } catch (e) {
      setErro((e as Error).message.includes('motivo') ? 'Escreva o motivo (pelo menos 3 letras).' : (e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const excluirDefinitivo = async () => {
    setErro('')
    setOcupado(true)
    try {
      await api('/admin/excluir-conta', { method: 'POST', body: JSON.stringify({ user_id: c.id, email: emailConf, motivo }) })
      avisar('Conta excluída. E-mail, CNPJ e telefone estão livres para cadastrar de novo.')
      mudou()
      fechar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const def = acao ? ACOES[acao] : null
  const limiteNovo = Number(valorLimite)
  const limiteValorOk = /^\d{1,6}$/.test(valorLimite) && limiteNovo >= 1 && limiteNovo <= 100_000
  /** Quem já usou o novo limite para de anotar na hora: o botão avisa e muda de cor. */
  const limiteBloqueiaAgora = !!limite && limiteValorOk && limite.uso_mes >= limiteNovo
  return (
    <Gaveta aberta={!!c} onFechar={fechar} rotulo="Ficha do cliente">
      <span className="k">Cliente</span>
      <h3>{c.nome || c.email}</h3>
      <div className="pilha">
        <div className="fatos">
          <div><span>Negócio</span><span>{c.negocio || '-'}</span></div>
          <div><span>E-mail</span><span style={{ wordBreak: 'break-all' }}>{c.email}</span></div>
          <div><span>WhatsApp</span><span>{c.whats || '-'} {c.verificado && <CircleCheck size={14} color="var(--in)" />}</span></div>
          <div><span>Situação</span><span className={`situacao s-${c.situacao}`}>{NOME_SITUACAO[c.situacao] ?? c.situacao}</span></div>
          {c.situacao === 'trial' && <div><span>Teste até</span><span>{dataBR(c.trial_fim)}</span></div>}
          {c.motivo && <div><span>Último motivo</span><span>{c.motivo}</span></div>}
          <div><span>Cadastro</span><span>{dataHora(c.criado_em)}</span></div>
          <div><span>Boas-vindas</span><span>{c.onboarding_feito ? 'terminou' : `parou no passo ${c.onboarding_passo + 1} de 7`}</span></div>
          <div><span>Lançamentos</span><span className="num">{c.lancamentos}</span></div>
          {limite && (
            <div>
              <span>Limite do mês</span>
              <span className="num">
                {n(limite.uso_mes)} de {n(limite.efetivo)} <small className="suave">({limite.proprio !== null ? 'só dele' : 'padrão'})</small>
              </span>
            </div>
          )}
        </div>

        {ficha && (
          <div className="fatos">
            <div><span>Carteiras</span><span>{ficha.carteiras.map((x) => x.nome).join(', ') || '-'}</span></div>
            <div><span>Por onde lançou</span><span>{Object.entries(ficha.lancamentos_por_origem).map(([o, q]) => `${o} ${q}`).join(' · ') || '-'}</span></div>
            <div><span>Contas em aberto</span><span className="num">{ficha.contas_abertas}</span></div>
            <div><span>Contas fixas</span><span className="num">{ficha.fixas}</span></div>
          </div>
        )}

        <div className="rotulo" style={{ marginBottom: 0 }}>Ações</div>
        {!acao ? (
          <div className="pilha" style={{ gap: 8 }}>
            {Object.entries(ACOES).map(([k, v]) => (
              <button key={k} type="button" className={`btn btn-bloco ${k === 'bloquear' ? 'btn-perigo' : 'btn-sec'}`} onClick={() => setAcao(k)}>
                {v.rotulo}
              </button>
            ))}
            {limite && c.papel !== 'admin' && (
              <button type="button" className="btn btn-sec btn-bloco" onClick={() => { setValorLimite(String(limite.efetivo)); setAcao('limite') }}>
                Mudar o limite de lançamentos
              </button>
            )}
            <button type="button" className="btn btn-sec btn-bloco" disabled={ocupado} onClick={() => executar(c.verificado ? 'desverificar_numero' : 'verificar_numero')}>
              {c.verificado ? 'Desfazer confirmação do número' : 'Marcar número como confirmado'}
            </button>
            <button type="button" className="btn btn-sec btn-bloco" disabled={ocupado} onClick={() => gerarLink()}>
              Gerar link de acesso
            </button>
            <button type="button" className="btn btn-sec btn-bloco" disabled={ocupado} onClick={() => gerarLink('senha')}>
              Gerar link para criar senha nova
            </button>
            {c.papel !== 'admin' && (
              <button type="button" className="btn btn-perigo btn-bloco" disabled={ocupado} onClick={() => setAcao('excluir_definitivo')}>
                Excluir conta definitivamente
              </button>
            )}
            {link && (
              <div className="pilha" style={{ gap: 6 }}>
                <small className="suave">Link de entrada sem senha, vale uma vez. Mande para o cliente pelo WhatsApp.</small>
                <button
                  type="button"
                  className="btn btn-pri btn-bloco"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link)
                    avisar('Link copiado')
                  }}
                >
                  <Copy size={17} />
                  Copiar link
                </button>
              </div>
            )}
          </div>
        ) : acao === 'limite' && limite ? (
          <div className="item-ob ligado" style={CAIXA}>
            <b>Limite de lançamentos por mês</b>
            <small className="suave">
              Só de {c.nome || c.email}. Hoje vale {n(limite.efetivo)} ({limite.proprio !== null ? 'definido só para ele' : 'o padrão de todos'}) e ele já usou {n(limite.uso_mes)} neste mês. O cliente não vê este número.
            </small>
            <label className="campo">
              <span>Novo limite por mês</span>
              <input
                className="entrada num"
                inputMode="numeric"
                value={valorLimite}
                onChange={(e) => setValorLimite(e.target.value.replace(/\D/g, '').slice(0, 6))}
                aria-label="Novo limite de lançamentos por mês"
              />
            </label>
            {limiteBloqueiaAgora && (
              <div className="vaviso ruim" role="alert">
                <TriangleAlert size={20} style={{ flex: 'none' }} />
                <span>Ele já usou {n(limite.uso_mes)}. Com {n(limiteNovo)}, ele para de anotar agora e só volta no dia 1, ou se você subir o limite.</span>
              </div>
            )}
            <label className="campo">
              <span>Motivo (fica na auditoria)</span>
              <input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: plano de teste, uso abusivo, parceiro" />
            </label>
            <div className="dupla">
              <button type="button" className="btn btn-sec" onClick={() => setAcao(null)}>
                Voltar
              </button>
              <button
                type="button"
                className={`btn ${limiteBloqueiaAgora ? 'btn-perigo' : 'btn-pri'}`}
                disabled={ocupado || !limiteValorOk || motivo.trim().length < 3 || limite.proprio === limiteNovo}
                onClick={() => salvarLimite()}
              >
                {limiteBloqueiaAgora ? 'Salvar e parar as anotações dele' : 'Salvar'}
              </button>
            </div>
            {limite.proprio !== null && (
              <button type="button" className="btn btn-sec btn-bloco" disabled={ocupado || motivo.trim().length < 3} onClick={() => salvarLimite(true)}>
                Voltar ao padrão ({n(limite.padrao)})
              </button>
            )}
          </div>
        ) : acao === 'excluir_definitivo' ? (
          <div className="item-ob ligado">
            <b>Excluir conta definitivamente</b>
            <small className="suave">
              Apaga o login, o perfil (CNPJ, WhatsApp, contador), todos os lançamentos, contas, mensagens e arquivos de {c.nome || c.email}. Não tem volta. Depois disso o mesmo e-mail, CNPJ e telefone podem criar uma conta nova do zero.
            </small>
            <label className="campo">
              <span>Para confirmar, digite o e-mail da conta: {c.email}</span>
              <input className="entrada" value={emailConf} onChange={(e) => setEmailConf(e.target.value)} autoCapitalize="none" autoComplete="off" />
            </label>
            <label className="campo">
              <span>Motivo (fica na auditoria)</span>
              <input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cliente pediu para recomeçar do zero" />
            </label>
            <div className="dupla">
              <button type="button" className="btn btn-sec" onClick={() => setAcao(null)}>
                Voltar
              </button>
              <button type="button" className="btn btn-perigo" disabled={ocupado || motivo.trim().length < 3 || emailConf.trim().toLowerCase() !== c.email.trim().toLowerCase()} onClick={excluirDefinitivo}>
                Excluir de vez
              </button>
            </div>
          </div>
        ) : (
          <div className="item-ob ligado">
            <b>{def!.rotulo}</b>
            <small className="suave">{def!.dica}</small>
            {def!.dias && (
              <label className="campo">
                <span>Quantos dias</span>
                <input className="entrada num" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 2))} />
              </label>
            )}
            <label className="campo">
              <span>Motivo (fica na auditoria)</span>
              <input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: parceiro da NGP" />
            </label>
            <div className="dupla">
              <button type="button" className="btn btn-sec" onClick={() => setAcao(null)}>
                Voltar
              </button>
              <button type="button" className={`btn ${acao === 'bloquear' ? 'btn-perigo' : 'btn-pri'}`} disabled={ocupado || motivo.trim().length < 3} onClick={() => executar(acao)}>
                Confirmar
              </button>
            </div>
          </div>
        )}
        {erro && <Falha texto={erro} />}

        {ficha && ficha.ultimas_mensagens.length > 0 && (
          <>
            <div className="rotulo" style={{ marginBottom: 0 }}>Últimas mensagens com a Granninha</div>
            <div className="lista">
              {ficha.ultimas_mensagens.map((m, i) => (
                <div className="linha" key={i} style={{ padding: '8px 0' }}>
                  <div className="meio">
                    <div className="tit" style={{ fontWeight: 550, fontSize: 14 }}>{m.texto || `(${m.tipo})`}</div>
                    <div className="det"><span>{dataHora(m.criado_em)} · {m.tipo} · {m.status}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {ficha && ficha.auditoria.length > 0 && (
          <>
            <div className="rotulo" style={{ marginBottom: 0 }}>Histórico de ações do admin</div>
            <div className="lista">
              {ficha.auditoria.map((a, i) => (
                <div className="linha" key={i} style={{ padding: '8px 0' }}>
                  <div className="meio">
                    <div className="tit" style={{ fontSize: 14 }}>{a.acao.replace(/_/g, ' ')}</div>
                    <div className="det"><span>{dataHora(a.criado_em)} · {a.detalhes.motivo ?? ''}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Gaveta>
  )
}
