import { Check, ChevronDown, CreditCard, MessageCircle, Repeat } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BotaoZap, FaixaAssinatura, Topo } from '../components/Shell'
import { CampoDinheiroSalvo, Folha, Seg, useAviso, Vazio } from '../components/ui'
import { linkWhats } from '../lib/config'
import { faturas, type FaturaResumo } from '../lib/cartao'
import { brl, capitaliza, centavosDe, diaCurto, diaExtenso, difDias, dinheiroCampo, hoje, prazo, somaDias } from '../lib/format'
import { mudarFixa, mudarValorConta } from '../lib/fixas'
import { candidatosParaConta } from '../lib/vinculo'
import { novoId, useApp } from '../lib/store'
import type { Conta, Lancamento } from '../lib/tipos'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesBR = (f: string) => `${MESES[Number(f.slice(5, 7)) - 1]}/${f.slice(2, 4)}`

export default function Contas() {
  const { s, mut, pagarConta, reabrirConta, vincularPagamento, soltarPagamento } = useApp()
  const avisar = useAviso()
  const [tipo, setTipo] = useState<'pagar' | 'receber'>('pagar')
  const [verPagas, setVerPagas] = useState(false)
  const [abertaId, setAbertaId] = useState<string | null>(null)
  /** Conta para a qual a pessoa está escolhendo "qual lançamento pagou isto". */
  const [vinculandoId, setVinculandoId] = useState<string | null>(null)
  const [carteira, setCarteira] = useState('')
  const h = hoje()

  // Faturas do cartão com valor em aberto. Pagar a fatura é dinheiro saindo da conta para o cartão:
  // as compras daquela fatura entram nos gastos no dia do pagamento.
  const abertasCartao = useMemo(() => faturas(s.lancamentos, s.carteiras).filter((f) => f.falta > 0), [s.lancamentos, s.carteiras])
  const [faturaSel, setFaturaSel] = useState<FaturaResumo | null>(null)
  const [pagaDe, setPagaDe] = useState('')
  const [valorPago, setValorPago] = useState(0)
  const contasQuePagam = s.carteiras.filter((c) => c.tipo === 'banco' || c.tipo === 'dinheiro' || c.tipo === 'outro')
  const nomeCart = (id: string) => s.carteiras.find((c) => c.id === id)?.nome ?? 'Cartão'
  const abrirFatura = (f: FaturaResumo) => {
    const cartao = s.carteiras.find((c) => c.id === f.cartaoId)
    setFaturaSel(f)
    setPagaDe(cartao?.contaPagamentoId ?? contasQuePagam.find((c) => c.padrao)?.id ?? contasQuePagam[0]?.id ?? '')
    setValorPago(f.falta)
  }
  const pagarFatura = () => {
    if (!faturaSel || !pagaDe || valorPago <= 0) return
    const agora = new Date()
    const l: Lancamento = {
      id: novoId('l'), tipo: 'transferencia', valor: Math.round(valorPago * 100) / 100, descricao: `Fatura ${nomeCart(faturaSel.cartaoId)}`,
      carteiraId: pagaDe, carteiraDestinoId: faturaSel.cartaoId, data: hoje(), fatura: faturaSel.fatura,
      hora: `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`, origem: 'painel',
    }
    mut((a) => ({ ...a, lancamentos: [l, ...a.lancamentos] }))
    avisar(`Pagamento de ${brl(l.valor)} anotado na fatura de ${mesBR(faturaSel.fatura)}`, { rotulo: 'Desfazer', fn: () => mut((a) => ({ ...a, lancamentos: a.lancamentos.filter((x) => x.id !== l.id) })) })
    setFaturaSel(null)
  }

  // Valor de uma conta em aberto. Conta de conta fixa muda a fixa inteira (e as outras em aberto dela); conta avulsa muda só ela.
  const mudarValor = (c: Conta, novo: number) => {
    const fixa = c.fixaId ? s.fixas.find((f) => f.id === c.fixaId) : undefined
    if (fixa) {
      const contasAntes = s.contas.filter((x) => x.fixaId === fixa.id && x.status === 'aberta')
      mut((a) => mudarFixa(a, fixa.id, { valor: novo }))
      avisar(`${fixa.descricao} agora é ${brl(novo)} todo mês`, {
        rotulo: 'Desfazer',
        fn: () => mut((a) => ({ ...a, fixas: a.fixas.map((f) => (f.id === fixa.id ? fixa : f)), contas: a.contas.map((x) => contasAntes.find((y) => y.id === x.id) ?? x) })),
      })
      return
    }
    const antes = c.valor
    mut((a) => mudarValorConta(a, c.id, novo))
    avisar(`${c.descricao} agora é ${brl(novo)}`, { rotulo: 'Desfazer', fn: () => mut((a) => mudarValorConta(a, c.id, antes)) })
  }

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
  // Fatura do cartão em aberto também é conta a pagar: entra no resumo pelo vencimento dela.
  const fatPagar = tipo === 'pagar' ? faturas(s.lancamentos, s.carteiras).filter((f) => f.falta > 0) : []
  const somaFat = (de: string | null, ate: string) => fatPagar.filter((f) => (de === null || f.vence >= de) && f.vence <= ate).reduce((a, f) => a + f.falta, 0)
  const totalAberto = soma(abertas.filter((c) => c.vencimento <= somaDias(h, 30))) + somaFat(null, somaDias(h, 30))
  const totalAtraso = soma(abertas.filter((c) => c.vencimento < h)) + fatPagar.filter((f) => f.vence < h).reduce((a, f) => a + f.falta, 0)
  const totalSemana = soma(abertas.filter((c) => c.vencimento >= h && c.vencimento <= somaDias(h, 7))) + somaFat(h, somaDias(h, 7))

  const verbo = tipo === 'pagar' ? 'paga' : 'recebida'
  const aberta = s.contas.find((c) => c.id === abertaId)
  const padrao = s.carteiras.find((c) => c.padrao && c.tipo !== 'cartao' && c.tipo !== 'investimento')?.id ?? s.carteiras.find((c) => c.tipo !== 'cartao' && c.tipo !== 'investimento')?.id ?? ''

  const marcar = (c: Conta, carteiraId?: string) => {
    if (c.status === 'paga') {
      // Voltar para em aberto pode apagar o pagamento lançado: a pessoa escolhe na ficha (manter ou apagar), nunca por baixo dos panos.
      setAbertaId(c.id)
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

      {tipo === 'pagar' && abertasCartao.length > 0 && (
        <section className="card" style={{ paddingBottom: 6 }} aria-label="Faturas do cartão">
          <div className="card-cab" style={{ marginBottom: 2 }}>
            <h2>Faturas do cartão</h2>
            <span className="suave pq num">{brl(abertasCartao.reduce((a, f) => a + f.falta, 0))}</span>
          </div>
          <div className="lista">
            {abertasCartao.map((f) => {
              const dif = difDias(f.vence, h)
              return (
                <button type="button" className="linha" key={f.cartaoId + f.fatura} onClick={() => abrirFatura(f)}>
                  <div className="selo" style={{ background: '#E7EAF5', color: '#454C83' }}>
                    <CreditCard size={19} />
                  </div>
                  <div className="meio">
                    <div className="tit">
                      {nomeCart(f.cartaoId)} · fatura de {mesBR(f.fatura)}
                    </div>
                    <div className="det">
                      <span className={dif < 0 ? 'atraso' : dif === 0 ? 'hoje' : ''}>
                        {capitaliza(prazo(f.vence))} · {diaCurto(f.vence)}
                        {f.pago > 0 ? ` · já pagou ${brl(f.pago)}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="val num">{brl(f.falta)}</div>
                </button>
              )
            })}
          </div>
        </section>
      )}

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
              {aberta.status === 'aberta' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-pri btn-bloco"
                    onClick={() => {
                      marcar(aberta, carteira || undefined)
                      setAbertaId(null)
                    }}
                  >
                    {aberta.tipo === 'pagar' ? 'Marcar como paga' : 'Marcar como recebida'}
                  </button>
                  <button type="button" className="btn btn-sec btn-bloco" onClick={() => setVinculandoId(aberta.id)}>
                    {aberta.tipo === 'pagar' ? 'Já paguei: ligar a um lançamento' : 'Já recebi: ligar a um lançamento'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-sec btn-bloco"
                    onClick={() => {
                      soltarPagamento(aberta.id, false)
                      avisar(`${aberta.descricao}: voltou para em aberto. O pagamento continua lançado.`, { rotulo: 'Desfazer', fn: () => vincularPagamento(aberta.id, aberta.lancId ?? '') })
                      setAbertaId(null)
                    }}
                  >
                    {aberta.lancId && s.lancamentos.some((l) => l.id === aberta.lancId) ? 'Reabrir a conta e manter o pagamento' : 'Voltar para em aberto'}
                  </button>
                  {aberta.lancId && s.lancamentos.some((l) => l.id === aberta.lancId) && (
                    <button
                      type="button"
                      className="btn btn-txt"
                      style={{ color: 'var(--out)' }}
                      onClick={() => {
                        soltarPagamento(aberta.id, true)
                        avisar(`${aberta.descricao}: voltou para em aberto e o pagamento foi apagado`)
                        setAbertaId(null)
                      }}
                    >
                      Reabrir e apagar o pagamento
                    </button>
                  )}
                </>
              )}
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
              {aberta.status === 'aberta' && (
                <div>
                  <span>{aberta.fixaId && s.fixas.some((f) => f.id === aberta.fixaId) ? 'Valor todo mês' : 'Valor'}</span>
                  <CampoDinheiroSalvo key={aberta.id} valor={aberta.valor} rotulo={`Valor de ${aberta.descricao}`} estilo={{ width: 156 }} onSalvar={(v) => mudarValor(aberta, v)} />
                </div>
              )}
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
              {aberta.status === 'paga' && aberta.lancId && (() => {
                const l = s.lancamentos.find((x) => x.id === aberta.lancId)
                return l ? (
                  <div>
                    <span>Pago com</span>
                    <span>
                      {l.descricao} · {l.data.split('-').reverse().slice(0, 2).join('/')} · {brl(l.valor)}
                    </span>
                  </div>
                ) : null
              })()}
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
                    {s.carteiras
                      .filter((c) => c.tipo !== 'investimento' && (aberta.tipo === 'pagar' ? c.tipo !== 'maquininha' : c.tipo !== 'cartao'))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
            {aberta.status === 'aberta' && aberta.fixaId && s.fixas.some((f) => f.id === aberta.fixaId) && (
              <p className="suave" style={{ margin: '12px 2px 0', fontSize: 13.5 }}>
                Mudar o valor aqui muda também as outras contas em aberto desta conta fixa. As que já foram pagas ficam como estão.
              </p>
            )}
          </>
        )}
      </Folha>
      <Folha aberta={!!vinculandoId} onFechar={() => setVinculandoId(null)} titulo="Qual lançamento pagou esta conta?">
        {(() => {
          const alvo = s.contas.find((c) => c.id === vinculandoId)
          if (!alvo) return null
          const candidatos = candidatosParaConta(s, alvo, hoje())
          return (
            <div className="pilha">
              <p className="suave">
                {alvo.descricao}, {brl(alvo.valor)}, vence {diaCurto(alvo.vencimento)}. Escolha o lançamento que foi este pagamento: a conta fica {alvo.tipo === 'pagar' ? 'paga' : 'recebida'} com o valor e a data dele, e nada é lançado de novo.
              </p>
              {candidatos.length === 0 ? (
                <p className="suave">Não achei nenhum lançamento parecido nos últimos dois meses. Lance o pagamento pelo WhatsApp e volte aqui, ou use Marcar como {alvo.tipo === 'pagar' ? 'paga' : 'recebida'}.</p>
              ) : (
                candidatos.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="item-ob"
                    style={{ textAlign: 'left', width: '100%' }}
                    onClick={() => {
                      vincularPagamento(alvo.id, l.id)
                      avisar(`${alvo.descricao}: ligada ao pagamento de ${brl(l.valor)}`, { rotulo: 'Desfazer', fn: () => soltarPagamento(alvo.id, false) })
                      setVinculandoId(null)
                      setAbertaId(null)
                    }}
                  >
                    <b>{l.descricao}</b>
                    <div className="suave">
                      {l.data.split('-').reverse().slice(0, 2).join('/')} · {s.carteiras.find((c) => c.id === l.carteiraId)?.nome ?? 'conta'} · <b className="num">{brl(l.valor)}</b>
                    </div>
                  </button>
                ))
              )}
            </div>
          )
        })()}
      </Folha>
      <Folha
        aberta={!!faturaSel}
        onFechar={() => setFaturaSel(null)}
        titulo="Fatura do cartão"
        pe={
          faturaSel && (
            <button type="button" className="btn btn-pri btn-bloco" disabled={!pagaDe || valorPago <= 0} onClick={pagarFatura}>
              Registrar pagamento de {brl(valorPago)}
            </button>
          )
        }
      >
        {faturaSel && (
          <>
            <div className="detalhe-valor">
              <strong className="num">{brl(faturaSel.falta)}</strong>
              <span className="suave">
                {nomeCart(faturaSel.cartaoId)} · fatura de {mesBR(faturaSel.fatura)}
              </span>
            </div>
            <div className="fatos">
              <div>
                <span>Vencimento</span>
                <span>{capitaliza(diaExtenso(faturaSel.vence))}</span>
              </div>
              <div>
                <span>Compras</span>
                <span>
                  {faturaSel.compras} · {brl(faturaSel.total)}
                </span>
              </div>
              {faturaSel.pago > 0 && (
                <div>
                  <span>Já pago</span>
                  <span className="cor-in">{brl(faturaSel.pago)}</span>
                </div>
              )}
              <div>
                <span>Sai de</span>
                <select className="entrada" aria-label="Conta que paga" style={{ width: 'auto', maxWidth: '62%', minHeight: 40, fontSize: 14.5, fontWeight: 620 }} value={pagaDe} onChange={(e) => setPagaDe(e.target.value)}>
                  {contasQuePagam.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ borderBottom: 0 }}>
                <span>Valor pago</span>
                <input className="entrada num" inputMode="numeric" aria-label="Valor pago" style={{ width: 140, minHeight: 40, textAlign: 'right' }} value={dinheiroCampo(valorPago)} onChange={(e) => setValorPago(centavosDe(e.target.value))} />
              </div>
            </div>
            <p className="suave pq" style={{ marginTop: 10 }}>As compras desta fatura entram nos gastos no dia do pagamento, cada uma na sua categoria. Pagou só uma parte? Ajuste o valor: o resto continua em aberto.</p>
          </>
        )}
      </Folha>
      <BotaoZap />
    </div>
  )
}
