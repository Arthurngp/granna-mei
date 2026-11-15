import { Check, ChevronDown, MessageCircle, Repeat } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BotaoZap, FaixaAssinatura, Topo } from '../components/Shell'
import { Folha, Seg, useAviso, Vazio } from '../components/ui'
import { linkWhats } from '../lib/config'
import { brl, capitaliza, diaCurto, diaExtenso, difDias, hoje, prazo, somaDias } from '../lib/format'
import { useApp } from '../lib/store'
import type { Conta } from '../lib/tipos'

export default function Contas() {
  const { s, pagarConta, reabrirConta } = useApp()
  const avisar = useAviso()
  const [tipo, setTipo] = useState<'pagar' | 'receber'>('pagar')
  const [verPagas, setVerPagas] = useState(false)
  const [abertaId, setAbertaId] = useState<string | null>(null)
  const [carteira, setCarteira] = useState('')
  const h = hoje()

  const doTipo = useMemo(() => s.contas.filter((c) => c.tipo === tipo).sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1)), [s.contas, tipo])
  const abertas = doTipo.filter((c) => c.status === 'aberta')
  const pagas = doTipo.filter((c) => c.status === 'paga').sort((a, b) => ((a.pagoEm ?? '') < (b.pagoEm ?? '') ? 1 : -1)).slice(0, 12)

  const grupos = [
    { id: 'atraso', titulo: tipo === 'pagar' ? 'Atrasadas' : 'Já deviam ter entrado', itens: abertas.filter((c) => c.vencimento < h) },
    { id: 'hoje', titulo: 'Hoje', itens: abertas.filter((c) => c.vencimento === h) },
    { id: 'semana', titulo: 'Próximos 7 dias', itens: abertas.filter((c) => c.vencimento > h && c.vencimento <= somaDias(h, 7)) },
    { id: 'depois', titulo: 'Mais adiante', itens: abertas.filter((c) => c.vencimento > somaDias(h, 7)) },
  ].filter((g) => g.itens.length)

  const soma = (cs: Conta[]) => cs.reduce((a, c) => a + c.valor, 0)
  const totalAberto = soma(abertas.filter((c) => c.vencimento <= somaDias(h, 30)))
  const totalAtraso = soma(abertas.filter((c) => c.vencimento < h))
  const totalSemana = soma(abertas.filter((c) => c.vencimento >= h && c.vencimento <= somaDias(h, 7)))

  const verbo = tipo === 'pagar' ? 'paga' : 'recebida'
  const aberta = s.contas.find((c) => c.id === abertaId)
  const padrao = s.carteiras.find((c) => c.padrao)?.id ?? s.carteiras[0]?.id ?? ''

  const marcar = (c: Conta, carteiraId?: string) => {
    if (c.status === 'paga') {
      reabrirConta(c.id)
      avisar(`${c.descricao}: voltou para em aberto`)
      return
    }
    pagarConta(c.id, carteiraId)
    avisar(`${c.descricao}: marcada como ${c.tipo === 'pagar' ? 'paga' : 'recebida'}`, { rotulo: 'Desfazer', fn: () => reabrirConta(c.id) })
  }

  const Linha = ({ c }: { c: Conta }) => {
    const dif = difDias(c.vencimento, h)
    return (
      <div className="linha">
        <button type="button" className={`marca ${c.status === 'paga' ? 'ok' : ''}`} aria-label={c.status === 'paga' ? `Desmarcar ${c.descricao}` : `Marcar ${c.descricao} como ${verbo}`} onClick={() => marcar(c)}>
          <Check size={16} strokeWidth={3} />
        </button>
        <button
          type="button"
          className="meio"
          style={{ textAlign: 'left' }}
          onClick={() => {
            setAbertaId(c.id)
            setCarteira(padrao)
          }}
        >
          <div className="tit" style={c.status === 'paga' ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
            {c.descricao}
          </div>
          <div className="det">
            {c.fixaId && <Repeat size={12} />}
            <span className={c.status === 'aberta' ? (dif < 0 ? 'atraso' : dif === 0 ? 'hoje' : '') : ''}>
              {c.status === 'paga' ? `${capitaliza(verbo)} em ${diaCurto(c.pagoEm ?? c.vencimento)}` : `${capitaliza(prazo(c.vencimento))} · ${diaCurto(c.vencimento)}`}
              {c.parcela ? ` · parcela ${c.parcela.n} de ${c.parcela.total}` : ''}
            </span>
          </div>
        </button>
        <div className={`val num ${tipo === 'receber' && c.status === 'aberta' ? 'cor-in' : ''}`}>{brl(c.valor)}</div>
      </div>
    )
  }

  return (
    <div className="pagina">
      <Topo titulo="Contas" sub="O que vence e o que tem para entrar" />
      <FaixaAssinatura />
      <Seg
        bloco
        valor={tipo}
        onChange={setTipo}
        opcoes={[
          { v: 'pagar', r: 'A pagar' },
          { v: 'receber', r: 'A receber' },
        ]}
      />

      <div className="trio">
        <div>
          <small>{tipo === 'pagar' ? 'Atrasado' : 'Em atraso'}</small>
          <b className={`num ${totalAtraso > 0 ? 'cor-out' : ''}`}>{brl(totalAtraso)}</b>
        </div>
        <div>
          <small>Em 7 dias</small>
          <b className="num">{brl(totalSemana)}</b>
        </div>
        <div>
          <small>Em 30 dias</small>
          <b className={`num ${tipo === 'receber' ? 'cor-in' : ''}`}>{brl(totalAberto)}</b>
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="card">
          <Vazio
            pose={tipo === 'pagar' ? 'cafe' : 'saco'}
            titulo={tipo === 'pagar' ? 'Nenhuma conta em aberto' : 'Nada a receber por enquanto'}
            texto={tipo === 'pagar' ? 'Para eu te lembrar de uma conta, me diga: "luz de 120 vence dia 10".' : 'Vendeu fiado? Me diga: "a Juliana me deve 250 até sexta".'}
          >
            <a className="btn btn-wa" href={linkWhats()} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={18} />
              Avisar a Granninha
            </a>
          </Vazio>
        </div>
      ) : (
        <div className="grade">
          {grupos.map((g) => (
            <section className={`card ${grupos.length > 1 ? 'g-6' : ''}`} key={g.id} style={{ paddingBottom: 6 }}>
              <div className="card-cab" style={{ marginBottom: 2 }}>
                <h2 className={g.id === 'atraso' ? 'cor-out' : ''}>{g.titulo}</h2>
                <span className="suave pq num">{brl(soma(g.itens))}</span>
              </div>
              <div className="lista">
                {g.itens.map((c) => (
                  <Linha key={c.id} c={c} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {pagas.length > 0 && (
        <section className="card" style={{ paddingBottom: verPagas ? 6 : 16 }}>
          <button type="button" className="card-cab" style={{ width: '100%', marginBottom: 0 }} aria-expanded={verPagas} onClick={() => setVerPagas(!verPagas)}>
            <h2>{tipo === 'pagar' ? 'Pagas' : 'Recebidas'} recentemente</h2>
            <ChevronDown size={20} style={{ transform: verPagas ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'var(--indigo-3)' }} />
          </button>
          {verPagas && (
            <div className="lista" style={{ marginTop: 6 }}>
              {pagas.map((c) => (
                <Linha key={c.id} c={c} />
              ))}
            </div>
          )}
        </section>
      )}

      <Folha
        aberta={!!aberta}
        onFechar={() => setAbertaId(null)}
        titulo={aberta?.tipo === 'pagar' ? 'Conta a pagar' : 'Conta a receber'}
        pe={
          aberta && (
            <>
              <button
                type="button"
                className={`btn btn-bloco ${aberta.status === 'paga' ? 'btn-sec' : 'btn-pri'}`}
                onClick={() => {
                  marcar(aberta, carteira || undefined)
                  setAbertaId(null)
                }}
              >
                {aberta.status === 'paga' ? 'Voltar para em aberto' : aberta.tipo === 'pagar' ? 'Marcar como paga' : 'Marcar como recebida'}
              </button>
              <a className="btn btn-txt" href={linkWhats(`Quero mudar a conta "${aberta.descricao}" de ${brl(aberta.valor)}`)} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={17} />
                Mudar valor ou data pelo WhatsApp
              </a>
            </>
          )
        }
      >
        {aberta && (
          <>
            <div className="detalhe-valor">
              <strong className="num">{brl(aberta.valor)}</strong>
              <span className="suave">{aberta.descricao}</span>
            </div>
            <div className="fatos">
              <div>
                <span>Vencimento</span>
                <span>{capitaliza(diaExtenso(aberta.vencimento))}</span>
              </div>
              <div>
                <span>Situação</span>
                {aberta.status === 'paga' ? (
                  <span className="ponto cor-in">{aberta.tipo === 'pagar' ? 'Paga' : 'Recebida'}</span>
                ) : (
                  <span className={`ponto ${aberta.vencimento < h ? 'cor-out' : ''}`} style={aberta.vencimento >= h ? { color: 'var(--indigo-2)' } : undefined}>
                    {capitaliza(prazo(aberta.vencimento))}
                  </span>
                )}
              </div>
              <div>
                <span>Categoria</span>
                <span>{s.categorias.find((c) => c.id === aberta.categoriaId)?.nome ?? 'Sem categoria'}</span>
              </div>
              {aberta.fixaId && (
                <div>
                  <span>Repetição</span>
                  <span>Todo mês</span>
                </div>
              )}
              {aberta.parcela && (
                <div>
                  <span>Parcela</span>
                  <span>
                    {aberta.parcela.n} de {aberta.parcela.total}
                  </span>
                </div>
              )}
              {aberta.status === 'aberta' && s.carteiras.length > 1 && (
                <div>
                  <span>{aberta.tipo === 'pagar' ? 'Sai de' : 'Entra em'}</span>
                  <select className="entrada" aria-label="Carteira" style={{ width: 'auto', maxWidth: '62%', minHeight: 40, fontSize: 14.5, fontWeight: 620 }} value={carteira} onChange={(e) => setCarteira(e.target.value)}>
                    {s.carteiras.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </>
        )}
      </Folha>
      <BotaoZap />
    </div>
  )
}
