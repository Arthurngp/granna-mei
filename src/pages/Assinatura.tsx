import { ArrowLeft, Check } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FaixaAssinatura } from '../components/Shell'
import { Folha, useAviso } from '../components/ui'
import { usoDoMes } from '../lib/calc'
import { LIMITE_LANCAMENTOS, LIMITE_MIDIAS, PRECO_ANUAL, PRECO_MENSAL } from '../lib/config'
import { brl, diaCurto, difDias, hoje, mesAtual, nomeMes } from '../lib/format'
import { useApp } from '../lib/store'

export default function Assinatura() {
  const { s, mut, simularStatus } = useApp()
  const avisar = useAviso()
  const a = s.assinatura
  const [plano, setPlano] = useState(a.plano)
  const [cancelar, setCancelar] = useState(false)
  const uso = usoDoMes(s, mesAtual())
  const economia = PRECO_MENSAL * 12 - PRECO_ANUAL
  const diasTrial = Math.max(0, difDias(a.trialFim, hoje()))

  const situacao = {
    trial: { txt: `Teste grátis: ${diasTrial === 1 ? 'falta 1 dia' : `faltam ${diasTrial} dias`}`, cor: 'var(--indigo-2)' },
    ativa: { txt: 'Em dia', cor: 'var(--in)' },
    atrasada: { txt: 'Pagamento em atraso', cor: 'var(--out)' },
    bloqueada: { txt: 'Bloqueada', cor: 'var(--out)' },
  }[a.status]

  const pagar = () => {
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
            <div>
              <span>{a.status === 'trial' ? 'Primeira cobrança' : a.status === 'ativa' ? 'Próxima cobrança' : 'Venceu em'}</span>
              <span>{diaCurto(a.proxCobranca)}</span>
            </div>
            <div style={{ borderBottom: 0 }}>
              <span>Forma de pagamento</span>
              <span>Pix automático</span>
            </div>
          </div>
          {(a.status === 'atrasada' || a.status === 'trial') && (
            <button type="button" className="btn btn-pri btn-bloco" style={{ marginTop: 10 }} onClick={pagar}>
              {a.status === 'trial' ? `Assinar agora por ${brl(plano === 'anual' ? PRECO_ANUAL : PRECO_MENSAL)}` : `Pagar ${brl(a.plano === 'anual' ? PRECO_ANUAL : PRECO_MENSAL)} agora`}
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
                <span className="economia">Economize {brl(economia)}</span>, sai por {brl(PRECO_ANUAL / 12)} ao mês
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

      {a.status !== 'trial' && (
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
