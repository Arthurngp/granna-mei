import { ArrowDown, ArrowUp, Check, ChevronRight, CreditCard, Eye, EyeOff, MessageCircle, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaixaWhats } from '../components/ConfirmarWhats'
import { Conversa } from '../components/Conversa'
import { AreaLinhas, Medidor, Rosca } from '../components/Graficos'
import { BotaoZap, FaixaAssinatura, IconeCarteira, SeloCategoria, Topo } from '../components/Shell'
import { IconeOrigem, Mascote, MesNav, Seg, useAviso, Valor, type Pose } from '../components/ui'
import { caixa, disponivel, doMes, faturamentoAno, porCategoria, saldos, serieDiaria, serieMensal, totais } from '../lib/calc'
import { faturas } from '../lib/cartao'
import { LIMITE_MEI, linkWhats } from '../lib/config'
import { brl, brlCurto, capitaliza, diaCurto, difDias, hoje, mesAtual, nomeMes, pct, prazo, primeiroNome, somaDias, somaMeses } from '../lib/format'
import { useApp } from '../lib/store'

export default function Inicio() {
  const { s, mut, pagarConta, reabrirConta, carregarExemplo } = useApp()
  const avisar = useAviso()
  const [ym, setYm] = useState(mesAtual())
  const [escala, setEscala] = useState<'mes' | 'semestre'>('mes')
  const [lado, setLado] = useState<'saida' | 'entrada'>('saida')
  const oculto = s.prefs.ocultar
  const h = hoje()

  // Caixa: compra no cartão só conta quando a fatura é paga.
  const cx = useMemo(() => caixa(s), [s.lancamentos, s.carteiras])
  const lancsMes = useMemo(() => doMes(cx, ym), [cx, ym])
  const t = useMemo(() => totais(lancsMes), [lancsMes])
  const tAnt = useMemo(() => totais(doMes(cx, somaMeses(ym, -1))), [cx, ym])
  const sal = useMemo(() => saldos(s), [s])
  const emCarteiras = disponivel(s, sal)
  const abertas = useMemo(() => faturas(s.lancamentos, s.carteiras).filter((f) => f.falta > 0), [s.lancamentos, s.carteiras])
  const diaria = useMemo(() => serieDiaria(cx, ym), [cx, ym])
  const mensal = useMemo(() => serieMensal(cx, ym, 6), [cx, ym])
  const fatias = useMemo(() => porCategoria(lancsMes, s.categorias, lado), [lancsMes, s.categorias, lado])
  const fat = useMemo(() => faturamentoAno(s, h.slice(0, 4)), [s, h])
  const proximas = useMemo(
    () =>
      s.contas
        .filter((c) => c.status === 'aberta' && c.vencimento <= somaDias(h, 7))
        .sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1))
        .slice(0, 5),
    [s.contas, h],
  )

  // Fatura do cartão que vence em até 7 dias também aparece no card de vencimentos.
  const fatProximas = abertas.filter((f) => f.vence <= somaDias(h, 7))
  const nomeCartao = (id: string) => s.carteiras.find((c) => c.id === id)?.nome ?? 'Cartão'
  const vazio = s.lancamentos.length === 0
  const nome = primeiroNome(s.usuario.nome)
  const serie = escala === 'mes' ? diaria : mensal
  const fracMei = fat.total / LIMITE_MEI

  const recado = useMemo((): { pose: Pose; texto: JSX.Element } => {
    const atrasadas = s.contas.filter((c) => c.status === 'aberta' && c.vencimento < h)
    if (atrasadas.length) {
      const soma = atrasadas.reduce((a, c) => a + c.valor, 0)
      return { pose: 'sino', texto: <>Você tem <b>{atrasadas.length === 1 ? '1 conta atrasada' : `${atrasadas.length} contas atrasadas`}</b>, somando {brl(soma)}. Vale resolver hoje para não acumular.</> }
    }
    if (fracMei >= 0.7) return { pose: 'mei', texto: <>Seu faturamento do ano já passou de <b>{pct(fracMei)} do limite do MEI</b>. Veja quanto falta em Meu MEI antes de chegar perto do teto.</> }
    if (tAnt.saiu > 0 && t.saiu < tAnt.saiu * 0.9) return { pose: 'crescimento', texto: <>Você está gastando <b>menos que no mês passado</b>. Continue assim que sobra mais no fim do mês.</> }
    return { pose: 'cafe', texto: <>Tudo em ordem por aqui. Fez uma venda ou pagou algo? <b>Me manda no WhatsApp</b> que eu anoto.</> }
  }, [s.contas, h, fracMei, t.saiu, tAnt.saiu])

  const alternarConta = (id: string, paga: boolean, desc: string) => {
    if (paga) return reabrirConta(id)
    pagarConta(id)
    avisar(`${desc}: marcada como paga`, { rotulo: 'Desfazer', fn: () => reabrirConta(id) })
  }

  return (
    <div className="pagina">
      <Topo titulo={nome ? `Oi, ${nome}` : 'Início'} sub={s.usuario.negocio || undefined} />
      <FaixaAssinatura />
      <FaixaWhats />

      <div className="grade">
        <section className="heroi g-5 estica" aria-label="Resumo do mês">
          <div className="heroi-cab">
            <MesNav ym={ym} onChange={setYm} />
            <button type="button" className="icone-btn" aria-label={oculto ? 'Mostrar valores' : 'Esconder valores'} onClick={() => mut((a) => ({ ...a, prefs: { ...a.prefs, ocultar: !a.prefs.ocultar } }))}>
              {oculto ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          <div className="rot">Saldo de {nomeMes(ym, false)}</div>
          <div className={`grande ${t.sobrou < 0 ? 'neg' : ''}`}>
            <Valor n={t.sobrou} oculto={oculto} animado />
          </div>
          {/* O que tem agora fica junto do saldo do mês: no rodapé passava despercebido. */}
          <div className="heroi-caixa">
            <Wallet size={15} strokeWidth={2.2} />
            <span>Em caixa agora</span>
            <b>{oculto ? 'R$ ••••' : brl(emCarteiras)}</b>
          </div>
          <div className="heroi-duo">
            <div>
              <div className="t">
                <span className="bolinha in">
                  <ArrowUp size={13} strokeWidth={3} />
                </span>
                Entrou
              </div>
              <div className="v">
                <Valor n={t.entrou} oculto={oculto} animado />
              </div>
            </div>
            <div>
              <div className="t">
                <span className="bolinha out">
                  <ArrowDown size={13} strokeWidth={3} />
                </span>
                Saiu
              </div>
              <div className="v">
                <Valor n={t.saiu} oculto={oculto} animado />
              </div>
            </div>
          </div>
          {t.retirada > 0 && (
            <div className="rodape">
              Suas retiradas: <b>{oculto ? 'R$ ••••' : brl(t.retirada)}</b>
            </div>
          )}
        </section>

        {vazio ? (
          <section className="card g-7">
            <div className="recado" style={{ marginBottom: 14 }}>
              <Mascote pose="hero" tam={88} anim="flutua" />
              <div className="balao">
                Seu painel está esperando o <b>primeiro lançamento</b>. É só me mandar no WhatsApp, assim:
              </div>
            </div>
            <Conversa />
            <div className="pilha" style={{ marginTop: 14, gap: 8 }}>
              <a className="btn btn-wa btn-bloco" href={linkWhats()} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={19} />
                Falar com a Granninha
              </a>
              {s.sessao.demo && (
                <button type="button" className="btn btn-sec btn-bloco" onClick={carregarExemplo}>
                  Ver o painel com dados de exemplo
                </button>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="card g-7 estica">
              <div className="card-cab">
                <h2>Entradas e saídas</h2>
                <Seg
                  valor={escala}
                  onChange={setEscala}
                  opcoes={[
                    { v: 'mes', r: 'No mês' },
                    { v: 'semestre', r: '6 meses' },
                  ]}
                />
              </div>
              <AreaLinhas
                labels={serie.labels}
                rotulo={(i) => (escala === 'mes' ? `${i + 1} de ${nomeMes(ym, false)}` : capitaliza(nomeMes(mensal.meses[i])))}
                series={[
                  { nome: 'Entrou', cor: '#12915A', valores: serie.entradas },
                  { nome: 'Saiu', cor: '#D5505B', valores: serie.saidas },
                ]}
              />
              <div className="legenda" style={{ marginTop: 10 }}>
                <span>
                  <i style={{ background: '#12915A' }} />
                  Entrou<b className="num">{oculto ? '••••' : brlCurto(t.entrou)}</b>
                </span>
                <span>
                  <i style={{ background: '#D5505B' }} />
                  Saiu<b className="num">{oculto ? '••••' : brlCurto(t.saiu)}</b>
                </span>
              </div>
            </section>

            <section className="g-12" aria-label="Carteiras">
              <div className="trilho">
                {s.carteiras.map((c) => {
                  // Cartão mostra o que está em aberto nas faturas (dívida), não um "saldo".
                  const devendo = c.tipo === 'cartao' ? abertas.filter((f) => f.cartaoId === c.id).reduce((a, f) => a + f.falta, 0) : 0
                  return (
                    <div className="carteira" key={c.id}>
                      <div className="n">
                        <IconeCarteira tipo={c.tipo} />
                        {c.nome}
                      </div>
                      <div className="v">
                        <Valor n={c.tipo === 'cartao' ? devendo : sal[c.id] ?? 0} oculto={oculto} />
                      </div>
                      {c.tipo === 'cartao' && <div className="suave pq">em faturas abertas</div>}
                      {c.tipo === 'investimento' && <div className="suave pq">guardado, fora do caixa</div>}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="card g-4 estica">
              <div className="card-cab">
                <h2>{lado === 'saida' ? 'Para onde foi' : 'De onde veio'}</h2>
                <Seg
                  valor={lado}
                  onChange={setLado}
                  opcoes={[
                    { v: 'saida', r: 'Saídas' },
                    { v: 'entrada', r: 'Entradas' },
                  ]}
                />
              </div>
              {fatias.length ? (
                <Rosca key={lado + ym} fatias={fatias} total={lado === 'saida' ? t.saiu : t.entrou} rotuloTotal={lado === 'saida' ? 'Saiu no mês' : 'Entrou no mês'} oculto={oculto} />
              ) : (
                <p className="suave" style={{ padding: '18px 0' }}>
                  Nada por aqui em {nomeMes(ym, false)}.
                </p>
              )}
            </section>

            <section className="card g-4 estica">
              <div className="card-cab">
                <h2>Vence em até 7 dias</h2>
                <Link to="/contas" className="lnk">
                  Ver todas
                  <ChevronRight size={16} />
                </Link>
              </div>
              {proximas.length || fatProximas.length ? (
                <div className="lista">
                  {fatProximas.map((f) => {
                    const dif = difDias(f.vence, h)
                    return (
                      <Link to="/contas" className="linha" key={f.cartaoId + f.fatura}>
                        <span className="marca" aria-hidden style={{ background: '#E7EAF5', color: '#454C83', borderColor: 'transparent' }}>
                          <CreditCard size={15} />
                        </span>
                        <div className="meio">
                          <div className="tit">Fatura {nomeCartao(f.cartaoId)}</div>
                          <div className="det">
                            <span className={dif < 0 ? 'atraso' : dif === 0 ? 'hoje' : ''}>{prazo(f.vence)}</span>
                          </div>
                        </div>
                        <div className="val num">{oculto ? '••••' : brl(f.falta)}</div>
                      </Link>
                    )
                  })}
                  {proximas.map((c) => {
                    const dif = difDias(c.vencimento, h)
                    return (
                      <div className="linha" key={c.id}>
                        <button type="button" className={`marca ${c.status === 'paga' ? 'ok' : ''}`} aria-label={`Marcar ${c.descricao} como ${c.tipo === 'pagar' ? 'paga' : 'recebida'}`} onClick={() => alternarConta(c.id, c.status === 'paga', c.descricao)}>
                          <Check size={16} strokeWidth={3} />
                        </button>
                        <div className="meio">
                          <div className="tit">{c.descricao}</div>
                          <div className="det">
                            <span className={dif < 0 ? 'atraso' : dif === 0 ? 'hoje' : ''}>
                              {c.tipo === 'receber' ? 'A receber · ' : ''}
                              {prazo(c.vencimento)}
                            </span>
                          </div>
                        </div>
                        <div className={`val num ${c.tipo === 'receber' ? 'cor-in' : ''}`}>{oculto ? '••••' : brl(c.valor)}</div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="recado">
                  <Mascote pose="cafe" tam={72} />
                  <div className="balao">Nenhuma conta vencendo nos próximos dias. Pode respirar.</div>
                </div>
              )}
            </section>

            <section className="card g-4 estica">
              <div className="card-cab">
                <h2>Limite do MEI</h2>
                <Link to="/mei" className="lnk">
                  Meu MEI
                  <ChevronRight size={16} />
                </Link>
              </div>
              <Medidor frac={fracMei} texto={pct(fracMei)} sub="do limite do ano" />
              <p className="suave pq" style={{ textAlign: 'center', marginTop: 10 }}>
                Você faturou <b style={{ color: 'var(--text)' }}>{oculto ? 'R$ ••••' : brl(fat.total)}</b> de {brlCurto(LIMITE_MEI)} em {h.slice(0, 4)}.
              </p>
            </section>

            <section className="card g-5">
              <div className="recado">
                <Mascote pose={recado.pose} tam={92} anim="flutua" />
                <div className="balao">{recado.texto}</div>
              </div>
            </section>

            <section className="card g-7 estica">
              <div className="card-cab">
                <h2>Últimos lançamentos</h2>
                <Link to="/lancamentos" className="lnk">
                  Ver todos
                  <ChevronRight size={16} />
                </Link>
              </div>
              <div className="lista">
                {s.lancamentos.slice(0, 5).map((l) => {
                  const cat = s.categorias.find((c) => c.id === l.categoriaId)
                  return (
                    <div className="linha" key={l.id}>
                      <SeloCategoria cat={cat} tipo={l.tipo} />
                      <div className="meio">
                        <div className="tit">{l.descricao}</div>
                        <div className="det">
                          <IconeOrigem origem={l.origem} />
                          <span>
                            {l.data === h ? 'Hoje' : diaCurto(l.data)} · {l.tipo === 'transferencia' ? 'Transferência' : l.tipo === 'compra_cartao' ? `Cartão · ${cat?.nome ?? 'Sem categoria'}` : cat?.nome ?? 'Sem categoria'}
                          </span>
                        </div>
                      </div>
                      <div className={`val num ${l.tipo === 'entrada' ? 'cor-in' : ''}`}>{oculto ? '••••' : `${l.tipo === 'entrada' ? '+' : l.tipo === 'saida' || l.tipo === 'compra_cartao' ? '-' : ''} ${brl(l.valor)}`}</div>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>
      {!vazio && <BotaoZap />}
    </div>
  )
}
