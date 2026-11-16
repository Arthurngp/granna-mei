import { CircleCheck, Copy, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Folha, useAviso } from '../../../src/components/ui'
import { api, rpc } from '../sb'
import { Carregando, dataBR, dataHora, Falha, NOME_SITUACAO } from './comum'

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

  return (
    <div className="pagina">
      <div className="busca">
        <Search size={18} />
        <input className="entrada" type="search" placeholder="Nome, negócio, e-mail ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar clientes" />
      </div>
      <div className="fichas" role="group" aria-label="Filtrar por situação">
        {FILTROS.map(([v, r]) => (
          <button key={v} type="button" className="ficha" aria-pressed={filtro === v} onClick={() => setFiltro(v)}>
            {r}
          </button>
        ))}
      </div>
      {erro && <Falha texto={erro} />}
      {!lista ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <div className="card"><p className="suave">Nenhum cliente encontrado.</p></div>
      ) : (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <div className="lista">
            {lista.map((c) => (
              <button type="button" className="linha" key={c.id} onClick={() => setAberto(c)}>
                <div className="meio">
                  <div className="tit">
                    {c.nome || '(sem nome)'} {c.negocio && <span className="suave" style={{ fontWeight: 500 }}>· {c.negocio}</span>}
                  </div>
                  <div className="det">
                    <span>
                      {c.whats || 'sem WhatsApp'}
                      {c.whats && (c.verificado ? ' · confirmado' : ' · não confirmado')} · último lançamento {dataBR(c.ultimo_lancamento)}
                    </span>
                  </div>
                </div>
                <div className="val">
                  <span className={`situacao s-${c.situacao}`}>{NOME_SITUACAO[c.situacao] ?? c.situacao}</span>
                  <small>{c.mensagens_mes} msg no mês</small>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {lista && <p className="suave pq">{lista.length} {lista.length === 1 ? 'cliente' : 'clientes'}{lista.length === 500 ? ' (mostrando os 500 mais novos)' : ''}</p>}
      <FichaCliente c={aberto} fechar={() => setAberto(null)} mudou={carregar} />
    </div>
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

  useEffect(() => {
    setFicha(null)
    setAcao(null)
    setMotivo('')
    setErro('')
    setLink('')
    if (c) rpc<Ficha>('admin_cliente', { p_id: c.id }).then(setFicha).catch((e: Error) => setErro(e.message))
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

  const gerarLink = async () => {
    setErro('')
    setOcupado(true)
    try {
      const r = await api<{ link: string }>('/admin/link-acesso', { method: 'POST', body: JSON.stringify({ user_id: c.id }) })
      setLink(r.link)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const def = acao ? ACOES[acao] : null
  return (
    <Folha aberta={!!c} onFechar={fechar} titulo={c.nome || c.email}>
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
            <button type="button" className="btn btn-sec btn-bloco" disabled={ocupado} onClick={() => executar(c.verificado ? 'desverificar_numero' : 'verificar_numero')}>
              {c.verificado ? 'Desfazer confirmação do número' : 'Marcar número como confirmado'}
            </button>
            <button type="button" className="btn btn-sec btn-bloco" disabled={ocupado} onClick={gerarLink}>
              Gerar link de acesso
            </button>
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
    </Folha>
  )
}
