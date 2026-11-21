import { ArrowLeft, Check, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FaixaAssinatura } from '../components/Shell'
import { Folha, useAviso } from '../components/ui'
import { usoDoMes } from '../lib/calc'
import { abrirPagamento } from '../lib/cobranca'
import { LIMITE_LANCAMENTOS, LIMITE_MIDIAS, PRECO_ANUAL, PRECO_MENSAL } from '../lib/config'
import { brl, diaCurto, difDias, hoje, mesAtual, nomeMes, somaDias } from '../lib/format'
import { useApp } from '../lib/store'

export default function Assinatura() {
  const { s, mut, simularStatus, recarregarAssinatura } = useApp()
  const avisar = useAviso()
  const a = s.assinatura
  const [plano, setPlano] = useState(a.plano)
  const [cancelar, setCancelar] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [params, setParams] = useSearchParams()
  const [confirmando, setConfirmando] = useState(params.get('pagamento') === 'ok' && !s.sessao.demo)

  /** Leva para a página certa da Stripe (Checkout, fatura em aberto ou portal). Erro vira aviso; nunca desloga. */
  const irParaStripe = async () => {
    setOcupado(true)
    try {
      const p = await abrirPagamento(plano)
      window.location.assign(p.url)
    } catch (e) {
      avisar((e as Error).message)
      setOcupado(false)
    }
  }

  // Voltou do pagamento: a Stripe avisa o servidor em segundos, então relê a assinatura até aparecer (no máximo ~30 s).
  useEffect(() => {
    if (!confirmando) return
    let tentativas = 0
    void recarregarAssinatura()
    const t = window.setInterval(() => {
      tentativas++
      void recarregarAssinatura()
      if (tentativas >= 15) {
        window.clearInterval(t)
        setConfirmando(false)
        avisar('Recebemos o seu pedido. A confirmação pode levar alguns minutos e aparece aqui.')
      }
    }, 2000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmando])
  useEffect(() => {
    if (confirmando && a.status === 'ativa') {
      setConfirmando(false)
      setParams({}, { replace: true })
      avisar('Assinatura confirmada. Obrigada!')
    }
  }, [a.status, confirmando, avisar, setParams])
  const primeiraCobranca = somaDias(a.trialFim, 1)
  const uso = usoDoMes(s, mesAtual())
  const economia = PRECO_MENSAL * 12 - PRECO_ANUAL
  // Quantas mensalidades a economia paga, sem prometer mais que o real: 1,97 vira "quase 2", nunca "2".
  const mesesExato = economia / PRECO_MENSAL
  const mesesGratis = mesesExato - Math.floor(mesesExato + 1e-9) >= 0.9 ? `quase ${Math.ceil(mesesExato)}` : `${Math.floor(mesesExato + 1e-9)}`
  const diasTrial = Math.max(0, difDias(a.trialFim, hoje()))

  const situacao = {
    trial: { txt: `Teste grátis: ${diasTrial === 1 ? 'falta 1 dia' : `faltam ${diasTrial} dias`}`, cor: 'var(--indigo-2)' },
    ativa: { txt: 'Em dia', cor: 'var(--in)' },
    atrasada: { txt: 'Pagamento em atraso', cor: 'var(--out)' },
    bloqueada: { txt: 'Bloqueada', cor: 'var(--out)' },
    cortesia: { txt: 'Cortesia: acesso liberado, sem cobrança', cor: 'var(--in)' },
  }[a.status] ?? { txt: 'Em análise', cor: 'var(--muted)' }
  const cortesia = a.status === 'cortesia'

  const pagar = () => {
    if (!s.sessao.demo) return void irParaStripe()
    mut((x) => ({ ...x, assinatura: { ...x.assinatura, plano, faturas: [{ id: `f-${Date.now()}`, data: hoje(), valor: plano === 'anual' ? PRECO_ANUAL : PRECO_MENSAL, status: 'paga' as const }, ...x.assinatura.faturas] } }))
    simularStatus('ativa')
    avisar('Pagamento confirmado. Obrigada!')
  }

  const Barra = ({ rotulo, n, max }: { rotulo: string; n: number; max: number }) => {
    const f = Math.min(1, n / max)
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
          <span style={{ fontWeight: 620 }}>{rotulo}</span>
          <span className="num suave">
            <b style={{ color: 'var(--text)' }}>{n}</b> de {max}
          </span>
        </div>
        <div className="prog">
          <i style={{ width: `${Math.max(2, f * 100)}%`, background: f >= 1 ? 'var(--out)' : f >= 0.8 ? '#D8921C' : 'var(--indigo-2)' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="pagina">
      <header className="topo">
        <Link to="/ajustes" className="icone-btn" aria-label="Voltar para Ajustes" style={{ marginLeft: -8 }}>
          <ArrowLeft size={22} />
        </Link>
        <div className="cresce">
          <h1>Assinatura</h1>
        </div>
      </header>
      <FaixaAssinatura />

      <div className="grade">
        <section className="card g-6">
          <div className="fatos">
            <div>
              <span>Situação</span>
              <span className="ponto" style={{ color: situacao.cor }}>
                {situacao.txt}
              </span>
            </div>
            <div>
              <span>Plano</span>
              <span>{a.plano === 'anual' ? `Anual · ${brl(PRECO_ANUAL)} por ano` : `Mensal · ${brl(PRECO_MENSAL)} por mês`}</span>
            </div>
            {cortesia ? (
              <div style={{ borderBottom: 0 }}>
                <span>Cobrança</span>
                <span>Nenhuma</span>
              </div>
            ) : (
              <>
                <div>
                  <span>{a.cancelaEm ? 'Assinatura termina em' : a.status === 'trial' ? 'Primeira cobrança' : a.status === 'ativa' ? 'Próxima cobrança' : 'Venceu em'}</span>
                  <span>{diaCurto(a.cancelaEm ?? (a.status === 'trial' ? primeiraCobranca : a.proxCobranca))}</span>
                </div>
                <div style={{ borderBottom: 0 }}>
                  <span>Pagamento</span>
                  <span>Seguro, pela Stripe</span>
                </div>
              </>
            )}
          </div>
          {confirmando && (
            <p className="suave pq" role="status" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <LoaderCircle size={16} className="gira" />
              Confirmando o seu pagamento…
            </p>
          )}
          {(a.status === 'atrasada' || a.status === 'trial') && !confirmando && (
            <>
              <button type="button" className="btn btn-pri btn-bloco" style={{ marginTop: 10 }} onClick={pagar} disabled={ocupado}>
                {ocupado && <LoaderCircle size={18} className="gira" />}
                {a.status === 'trial' ? `Assinar por ${brl(plano === 'anual' ? PRECO_ANUAL : PRECO_MENSAL)}` : `Pagar ${brl(a.plano === 'anual' ? PRECO_ANUAL : PRECO_MENSAL)} agora`}
              </button>
              {a.status === 'trial' && (
                <p className="suave pq" style={{ marginTop: 8 }}>
                  Nada é cobrado hoje. A cobrança só começa depois do teste grátis, e você cancela quando quiser.
                </p>
              )}
            </>
          )}
          {a.status === 'ativa' && !cortesia && !s.sessao.demo && (
            <button type="button" className="btn btn-sec btn-bloco" style={{ marginTop: 10 }} onClick={() => void irParaStripe()} disabled={ocupado}>
              {ocupado && <LoaderCircle size={18} className="gira" />}
              Trocar cartão ou plano
            </button>
          )}
        </section>

        <section className="card g-6 pilha" style={{ gap: 10 }}>
          <div className="card-cab" style={{ marginBottom: 0 }}>
            <h2>Seu plano</h2>
          </div>
          <button type="button" className="plano" aria-pressed={plano === 'mensal'} onClick={() => setPlano('mensal')}>
            <div className="cresce">
              <b>Mensal</b>
              <small>Sem fidelidade, cancele quando quiser</small>
            </div>
            <div className="preco num">
              {brl(PRECO_MENSAL)}
              <small>por mês</small>
            </div>
          </button>
          <button type="button" className="plano" aria-pressed={plano === 'anual'} onClick={() => setPlano('anual')}>
            <div className="cresce">
              <b>Anual</b>
              <small>
                <span className="economia">Economize {brl(economia)}</span> ({mesesGratis} meses gratuitamente)
              </small>
            </div>
            <div className="preco num">
              {brl(PRECO_ANUAL)}
              <small>por ano</small>
            </div>
          </button>
          {plano !== a.plano && a.status === 'ativa' && (
            <button
              type="button"
              className="btn btn-pri btn-bloco"
              onClick={() => {
                if (!s.sessao.demo) return void irParaStripe()
                mut((x) => ({ ...x, assinatura: { ...x.assinatura, plano } }))
                avisar(plano === 'anual' ? 'Plano anual ativado na próxima cobrança' : 'Plano mensal ativado na próxima cobrança')
              }}
            >
              <Check size={18} />
              Mudar para o plano {plano}
            </button>
          )}
        </section>

        <section className="card g-6 pilha">
          <div className="card-cab" style={{ marginBottom: 0 }}>
            <h2>Uso em {nomeMes(mesAtual(), false)}</h2>
          </div>
          <Barra rotulo="Lançamentos pelo WhatsApp" n={uso.lancamentos} max={LIMITE_LANCAMENTOS} />
          <Barra rotulo="Áudios, fotos e PDFs" n={uso.midias} max={LIMITE_MIDIAS} />
          <p className="suave pq">O uso zera todo dia 1. Perto do limite, a Granninha avisa antes de parar de anotar.</p>
        </section>

        <section className="card g-6" style={{ paddingBottom: 6 }}>
          <div className="card-cab" style={{ marginBottom: 2 }}>
            <h2>Pagamentos</h2>
          </div>
          {a.faturas.length === 0 ? (
            <p className="suave" style={{ padding: '8px 0 14px' }}>
              Nenhum pagamento ainda. A primeira cobrança só acontece no fim do teste grátis.
            </p>
          ) : (
            <div className="lista">
              {a.faturas.map((f) => (
                <div className="linha" key={f.id}>
                  <div className="meio">
                    <div className="tit">{diaCurto(f.data)} de {f.data.slice(0, 4)}</div>
                    <div className="det">
                      <span className="cor-in">Pago</span>
                    </div>
                  </div>
                  <div className="val num">{brl(f.valor)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {a.status !== 'trial' && !cortesia && !a.cancelaEm && (
        <button type="button" className="btn btn-txt" style={{ color: 'var(--muted)', justifySelf: 'center' }} onClick={() => setCancelar(true)}>
          Cancelar assinatura
        </button>
      )}

      <Folha
        aberta={cancelar}
        onFechar={() => setCancelar(false)}
        titulo="Cancelar assinatura"
        pe={
          <>
            <button type="button" className="btn btn-pri btn-bloco" onClick={() => setCancelar(false)}>
              Continuar com a Granninha
            </button>
            <button
              type="button"
              className="btn btn-txt"
              style={{ color: 'var(--out)' }}
              onClick={() => {
                setCancelar(false)
                // Na conta de verdade o cancelamento é feito no portal da Stripe, que pede a confirmação lá.
                if (!s.sessao.demo) return void irParaStripe()
                avisar(`Assinatura cancelada. Você usa até ${diaCurto(a.proxCobranca)}.`)
              }}
            >
              Cancelar mesmo assim
            </button>
          </>
        }
      >
        <p>
          Você continua usando até <b>{diaCurto(a.proxCobranca)}</b> e a cobrança para. Depois disso, o painel fica só para baixar seus dados.
        </p>
      </Folha>
    </div>
  )
}
