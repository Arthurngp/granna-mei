import { ArrowLeft, ArrowRight, LoaderCircle, Brush, Car, Check, HardHat, MessageCircle, Plus, Shirt, ShoppingBag, Sparkles, Trash2, Utensils, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Conversa } from '../components/Conversa'
import { IconeCarteira } from '../components/Shell'
import { CampoDinheiro, Chave, Mascote, Seg, type Pose } from '../components/ui'
import { linkWhats, RAMOS } from '../lib/config'
import { evento } from '../lib/eventos'
import { DIAS_SEMANA, documentoValido, hoje, mascaraCnpj, mascaraFone, mesAtual, primeiroNome, somaMeses } from '../lib/format'
import { categoriasPadrao } from '../lib/seed'
import { novoId, useApp } from '../lib/store'
import type { Carteira, Conta, Fixa, TipoCarteira } from '../lib/tipos'

const ICONE_RAMO: Record<string, typeof Brush> = { beleza: Brush, alimentacao: Utensils, comercio: ShoppingBag, servicos: Wrench, obras: HardHat, transporte: Car, moda: Shirt, outro: Sparkles }

interface CarteiraOb {
  id: string
  tipo: TipoCarteira
  nome: string
  dica: string
  on: boolean
  saldo: number
  /** Conta acrescentada pela pessoa (segundo banco, investimento): pode remover e renomear */
  livre?: boolean
}
interface CartaoOb {
  id: string
  nome: string
  /** 0 = ainda não escolheu */
  fechamento: number
  vencimento: number
  pagaCom: string
}
const DIAS_MES = Array.from({ length: 31 }, (_, i) => i + 1)
interface FixaOb {
  id: string
  nome: string
  categoriaId: string
  on: boolean
  valor: number
  dia: number
  das?: boolean
  livre?: boolean
}

const HORAS = Array.from({ length: 16 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`)

const GUIA: { pose: Pose; titulo: string; texto: string }[] = [
  { pose: 'laptop', titulo: 'Prazer, eu sou a Granninha!', texto: 'Vou cuidar do dinheiro do seu negócio com você. Primeiro, me conta do seu negócio.' },
  { pose: 'loja', titulo: 'Qual é o seu ramo?', texto: 'Assim eu já separo seus ganhos e gastos do jeito certo.' },
  { pose: 'moedas', titulo: 'Onde fica o seu dinheiro?', texto: 'Marque as contas que você usa e quanto tem em cada uma hoje. Pode pôr mais de um banco.' },
  { pose: 'calculadora', titulo: 'Você usa cartão de crédito?', texto: 'Me conta seus cartões e os dias da fatura. A compra no cartão entra nos seus gastos quando você paga a fatura.' },
  { pose: 'calendario', titulo: 'Quais contas chegam todo mês?', texto: 'Eu aviso antes de vencer, para você não pagar multa por esquecimento.' },
  { pose: 'sino', titulo: 'Quando eu posso te chamar?', texto: 'Escolha o melhor horário para o resumo e os lembretes.' },
  { pose: 'hero', titulo: 'Último passo: confirme seu WhatsApp', texto: 'É assim que eu sei que o número é seu. Sem isso, eu não consigo anotar o que você me mandar.' },
]

export default function Onboarding() {
  const { s, mut, sair, gerarCodigo, checarConfirmado } = useApp()
  const [confirmado, setConfirmado] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  // Quem já terminou os dados e está esperando a Granninha confirmar o número volta direto para esse
  // passo se recarregar a página. Antes caía no passo 1 e tinha de preencher os 6 passos de novo.
  const [passo, setPassoLocal] = useState(s.sessao.passo >= 6 ? 6 : 0)

  // Pré-preenchidos com o que já foi salvo: voltar do último passo não pode apagar o que ele escreveu.
  const [negocio, setNegocio] = useState(s.usuario.negocio)
  const [cnpj, setCnpj] = useState(s.usuario.cnpj)
  const [fone, setFone] = useState(s.usuario.whats)
  const [ramo, setRamo] = useState(s.usuario.ramo)
  const [carteiras, setCarteiras] = useState<CarteiraOb[]>([
    { id: 'banco', tipo: 'banco', nome: 'Conta do banco', dica: 'Pix, transferência e cartão de débito', on: true, saldo: 0 },
    { id: 'dinheiro', tipo: 'dinheiro', nome: 'Dinheiro', dica: 'O que fica na gaveta ou na carteira', on: false, saldo: 0 },
    { id: 'maquininha', tipo: 'maquininha', nome: 'Maquininha', dica: 'Vendas no cartão que ainda vão cair', on: false, saldo: 0 },
  ])
  const [padrao, setPadrao] = useState('banco')
  const [usaCartao, setUsaCartao] = useState<boolean | null>(null)
  const [cartoes, setCartoes] = useState<CartaoOb[]>([])
  const pagadoras = carteiras.filter((c) => c.on && (c.tipo === 'banco' || c.tipo === 'dinheiro'))
  const novoCartao = (): CartaoOb => ({ id: novoId('k'), nome: '', fechamento: 0, vencimento: 0, pagaCom: pagadoras.find((c) => c.id === padrao)?.id ?? pagadoras[0]?.id ?? '' })
  const [fixas, setFixas] = useState<FixaOb[]>([
    { id: 'das', nome: 'DAS do MEI', categoriaId: 'impostos', on: true, valor: 86.05, dia: 20, das: true },
    { id: 'aluguel', nome: 'Aluguel', categoriaId: 'aluguel', on: false, valor: 0, dia: 10 },
    { id: 'internet', nome: 'Internet', categoriaId: 'contas-casa', on: false, valor: 0, dia: 15 },
    { id: 'luz', nome: 'Luz', categoriaId: 'contas-casa', on: false, valor: 0, dia: 10 },
    { id: 'celular', nome: 'Celular', categoriaId: 'contas-casa', on: false, valor: 0, dia: 5 },
  ])
  const [resumoDia, setResumoDia] = useState(1)
  const [resumoHora, setResumoHora] = useState('08:00')
  const [lembreteHora, setLembreteHora] = useState('09:00')
  const [antecedencia, setAntecedencia] = useState('1')

  const foneOk = fone.replace(/\D/g, '').length >= 10
  const cnpjOk = documentoValido(cnpj)

  /** O que ainda falta no passo atual. Vazio = pode avançar. */
  const falta = useMemo(() => {
    if (passo === 0) {
      if (negocio.trim().length < 2) return 'Diga o nome do seu negócio.'
      if (!cnpjOk) return 'Esse CNPJ ou CPF não confere. Revise os números ou deixe em branco.'
      if (!foneOk) return 'Digite seu WhatsApp com DDD.'
    }
    if (passo === 1 && !ramo) return 'Escolha o ramo mais parecido com o seu.'
    if (passo === 2) {
      if (!carteiras.some((c) => c.on && c.tipo !== 'investimento')) return 'Marque pelo menos uma conta ou o dinheiro.'
      if (carteiras.some((c) => c.on && !c.nome.trim())) return 'Dê um nome para cada conta (ex.: Nubank).'
      const p = carteiras.find((c) => c.id === padrao)
      if (!p?.on || p.tipo === 'investimento') return 'Escolha qual é a principal.'
    }
    if (passo === 3) {
      if (usaCartao === null) return 'Me diga se você usa cartão de crédito.'
      if (usaCartao) {
        if (!cartoes.length) return 'Acrescente pelo menos um cartão.'
        const c = cartoes.find((x) => !x.nome.trim() || !x.fechamento || !x.vencimento || !x.pagaCom)
        if (c) return !c.nome.trim() ? 'Dê um nome para o cartão (ex.: Nubank).' : !c.fechamento ? 'Falta o dia em que a fatura fecha.' : !c.vencimento ? 'Falta o dia em que a fatura vence.' : 'Escolha de qual conta sai o pagamento da fatura.'
      }
    }
    if (passo === 4) {
      const semNome = fixas.find((f) => f.on && !f.nome.trim())
      if (semNome) return 'Dê um nome para a conta nova, ou remova.'
      const semValor = fixas.find((f) => f.on && f.valor <= 0)
      if (semValor) return `Falta o valor de ${semValor.nome}.`
    }
    return ''
  }, [passo, negocio, cnpjOk, foneOk, ramo, carteiras, padrao, fixas, usaCartao, cartoes])

  const salvarDados = () =>
    mut((a) => {
      const h = hoje()
      const cs: Carteira[] = carteiras.filter((c) => c.on).map((c) => ({ id: c.id, nome: c.nome.trim(), tipo: c.tipo, saldoInicial: c.saldo, padrao: c.id === padrao }))
      if (usaCartao) {
        for (const k of cartoes) {
          cs.push({ id: k.id, nome: k.nome.trim().toLowerCase().startsWith('cartão') ? k.nome.trim() : `Cartão ${k.nome.trim()}`, tipo: 'cartao', saldoInicial: 0, padrao: false, fechamento: k.fechamento, vencimento: k.vencimento, contaPagamentoId: k.pagaCom })
        }
      }
      const fx: Fixa[] = fixas.filter((f) => f.on).map((f) => ({ id: `fx-${f.id}`, descricao: f.nome.trim(), valor: f.valor, dia: f.dia, categoriaId: f.categoriaId, das: f.das }))
      const contas: Conta[] = []
      for (const f of fx) {
        for (let k = 0; k < 3; k++) {
          const venc = `${somaMeses(mesAtual(), k)}-${String(Math.min(f.dia, 28)).padStart(2, '0')}`
          if (venc < h) continue
          contas.push({ id: novoId('c'), tipo: 'pagar', descricao: f.descricao, valor: f.valor, vencimento: venc, status: 'aberta', categoriaId: f.categoriaId, fixaId: f.id, das: f.das })
        }
      }
      return {
        ...a,
        sessao: { ...a.sessao, passo: 6 },
        usuario: { ...a.usuario, negocio: negocio.trim(), cnpj, whats: fone, ramo },
        categorias: categoriasPadrao(ramo),
        carteiras: cs,
        fixas: fx,
        contas,
        prefs: { ...a.prefs, resumoDia, resumoHora, lembreteHora, antecedencia: Number(antecedencia) },
      }
    })

  /** Guarda o passo mais avançado que a pessoa alcançou, para medir onde o cadastro trava. */
  const setPasso = (p: number) => {
    setPassoLocal(p)
    if (p > s.sessao.passo) {
      evento('onboarding_passo', { passo: p })
      mut((a) => ({ ...a, sessao: { ...a.sessao, passo: p } }))
    }
  }

  const concluir = () => {
    evento('onboarding_concluido')
    mut((a) => ({ ...a, sessao: { ...a.sessao, onboarding: true, passo: 7 } }))
  }

  // Último passo: gera o código e fica conferindo no banco até a Granninha confirmar o número.
  useEffect(() => {
    if (passo === 6 && !codigo) void gerarCodigo().then(setCodigo)
  }, [passo, codigo, gerarCodigo])
  useEffect(() => {
    if (passo !== 6 || confirmado) return
    let vivo = true
    const t = setInterval(async () => {
      if (vivo && (await checarConfirmado())) setConfirmado(true)
    }, 3000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [passo, confirmado, checarConfirmado])

  const g = GUIA[passo]
  const nome = primeiroNome(s.usuario.nome)
  const mudaCarteira = (i: number, p: Partial<CarteiraOb>) => {
    setCarteiras((cs) => {
      const novo = cs.map((c, k) => (k === i ? { ...c, ...p } : c))
      const atual = novo.find((c) => c.id === padrao)
      if (!atual?.on || atual.tipo === 'investimento') {
        const prim = novo.find((c) => c.on && c.tipo !== 'investimento')
        if (prim) setPadrao(prim.id)
      }
      return novo
    })
  }
  const mudaCartao = (id: string, p: Partial<CartaoOb>) => setCartoes((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)))
  const mudaFixa = (id: string, p: Partial<FixaOb>) => setFixas((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)))

  return (
    <div className="ob">
      {confirmado && <Confete />}
      <div className="ob-topo">
        <div className="faixa-topo">
          <button type="button" className="icone-btn" aria-label={passo === 0 ? 'Sair' : 'Voltar'} onClick={() => (passo === 0 ? sair() : setPasso(passo - 1))}>
            <ArrowLeft size={22} />
          </button>
          <div className="ob-passos" role="progressbar" aria-valuemin={1} aria-valuemax={GUIA.length} aria-valuenow={passo + 1} aria-label="Progresso do cadastro">
            {GUIA.map((_, i) => (
              <i key={i} className={i < passo ? 'feito' : i === passo ? 'atual' : ''} />
            ))}
          </div>
          <span className="ob-cont num">{passo + 1} de {GUIA.length}</span>
        </div>
      </div>

      <div className="ob-corpo" key={passo}>
        <div className="ob-guia">
          <Mascote pose={passo === 6 && confirmado ? 'festa' : g.pose} tam={104} anim={confirmado ? 'pula' : 'flutua'} />
          <div className="balao">
            <h1>{passo === 6 && confirmado ? `Tudo pronto${nome ? `, ${nome}` : ''}!` : passo === 0 && nome ? `Prazer, ${nome}! Eu sou a Granninha.` : g.titulo}</h1>
            <p>{passo === 6 && confirmado ? 'Seu número está confirmado e eu já te respondi no WhatsApp. Agora é só me mandar o que entrou ou saiu.' : g.texto}</p>
          </div>
        </div>

        {passo === 0 && (
          <div className="pilha">
            <label className="campo">
              <span>Nome do seu negócio</span>
              <input className="entrada" value={negocio} onChange={(e) => setNegocio(e.target.value)} placeholder="Ex.: Studio Camila" autoComplete="organization" />
            </label>
            <label className="campo">
              <span>CNPJ ou CPF (opcional)</span>
              <input className="entrada num" inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(mascaraCnpj(e.target.value))} placeholder="CNPJ do MEI ou seu CPF" />
            </label>
            <label className="campo">
              <span>Seu WhatsApp</span>
              <input
                className="entrada num"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={fone}
                onChange={(e) => setFone(mascaraFone(e.target.value))}
                placeholder="(81) 90000-0000"
              />
              <small>É por este número que você vai conversar comigo. Eu confirmo com você por lá.</small>
            </label>
          </div>
        )}

        {passo === 1 && (
          <div className="opcoes">
            {RAMOS.map((r) => {
              const I = ICONE_RAMO[r.id]
              return (
                <button type="button" key={r.id} className="opcao" aria-pressed={ramo === r.id} onClick={() => setRamo(r.id)}>
                  {ramo === r.id && (
                    <span className="visto">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                  <span className="ic">
                    <I size={19} />
                  </span>
                  <b>{r.nome}</b>
                  <small>{r.ex}</small>
                </button>
              )
            })}
          </div>
        )}

        {passo === 2 && (
          <div className="pilha">
            {carteiras.map((c, i) => (
              <div key={c.id} className={`item-ob ${c.on ? 'ligado' : ''}`}>
                <div className="cab">
                  <span className="selo" style={{ background: 'var(--mist)', color: 'var(--indigo)' }}>
                    <IconeCarteira tipo={c.tipo} size={19} />
                  </span>
                  <div className="cresce">
                    <b>{c.nome || (c.tipo === 'investimento' ? 'Investimento' : 'Outro banco')}</b>
                    <small>{c.dica}</small>
                  </div>
                  {c.livre ? (
                    <button type="button" className="icone-btn" aria-label={`Remover ${c.nome || 'conta'}`} onClick={() => setCarteiras((cs) => cs.filter((x) => x.id !== c.id))}>
                      <Trash2 size={19} />
                    </button>
                  ) : (
                    <Chave ligado={c.on} onChange={(v) => mudaCarteira(i, { on: v })} rotulo={`Usar ${c.nome}`} />
                  )}
                </div>
                {c.on && (
                  <div className="abre">
                    {(c.tipo === 'banco' || c.tipo === 'investimento') && (
                      <label className="campo">
                        <span>{c.tipo === 'investimento' ? 'Onde? (ex.: XP, poupança)' : 'Qual banco? (ex.: Nubank, Itaú)'}</span>
                        <input className="entrada" value={c.nome} onChange={(e) => mudaCarteira(i, { nome: e.target.value })} placeholder={c.tipo === 'investimento' ? 'XP' : 'Nubank'} />
                      </label>
                    )}
                    <label className="campo">
                      <span>Quanto tem aí hoje?</span>
                      <CampoDinheiro valor={c.saldo} onChange={(v) => mudaCarteira(i, { saldo: v })} />
                    </label>
                    {c.tipo !== 'investimento' && (
                      <button type="button" className="radio-linha" aria-pressed={padrao === c.id} onClick={() => setPadrao(c.id)}>
                        <i />
                        Principal: a conta que você mais usa
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="dupla">
              <button type="button" className="btn btn-sec" onClick={() => setCarteiras((cs) => [...cs, { id: novoId('w'), tipo: 'banco', nome: '', dica: 'Outra conta de banco', on: true, saldo: 0, livre: true }])}>
                <Plus size={18} />
                Outro banco
              </button>
              <button type="button" className="btn btn-sec" onClick={() => setCarteiras((cs) => [...cs, { id: novoId('w'), tipo: 'investimento', nome: '', dica: 'Dinheiro guardado. Fica fora do caixa do mês.', on: true, saldo: 0, livre: true }])}>
                <Plus size={18} />
                Investimento
              </button>
            </div>
          </div>
        )}

        {passo === 3 && (
          <div className="pilha">
            <div className="opcoes duas">
              <button type="button" className="opcao" aria-pressed={usaCartao === true} onClick={() => { setUsaCartao(true); if (!cartoes.length) setCartoes([novoCartao()]) }}>
                {usaCartao === true && (
                  <span className="visto">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
                <span className="ic">
                  <IconeCarteira tipo="cartao" size={19} />
                </span>
                <b>Uso cartão de crédito</b>
                <small>No negócio ou misturado</small>
              </button>
              <button type="button" className="opcao" aria-pressed={usaCartao === false} onClick={() => setUsaCartao(false)}>
                {usaCartao === false && (
                  <span className="visto">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
                <span className="ic">
                  <Check size={19} />
                </span>
                <b>Não uso</b>
                <small>Dá para cadastrar depois</small>
              </button>
            </div>
            {usaCartao &&
              cartoes.map((k) => (
                <div key={k.id} className="item-ob ligado">
                  <div className="cab">
                    <span className="selo" style={{ background: 'var(--mist)', color: 'var(--indigo)' }}>
                      <IconeCarteira tipo="cartao" size={19} />
                    </span>
                    <div className="cresce">
                      <input className="entrada" aria-label="Nome do cartão" value={k.nome} onChange={(e) => mudaCartao(k.id, { nome: e.target.value })} placeholder="Nome do cartão (ex.: Nubank)" />
                    </div>
                    {cartoes.length > 1 && (
                      <button type="button" className="icone-btn" aria-label="Remover cartão" onClick={() => setCartoes((cs) => cs.filter((x) => x.id !== k.id))}>
                        <Trash2 size={19} />
                      </button>
                    )}
                  </div>
                  <div className="abre">
                    <div className="dupla">
                      <label className="campo">
                        <span>A fatura fecha dia</span>
                        <select className="entrada num" value={k.fechamento} onChange={(e) => mudaCartao(k.id, { fechamento: Number(e.target.value) })}>
                          <option value={0}>Escolha</option>
                          {DIAS_MES.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="campo">
                        <span>E vence dia</span>
                        <select className="entrada num" value={k.vencimento} onChange={(e) => mudaCartao(k.id, { vencimento: Number(e.target.value) })}>
                          <option value={0}>Escolha</option>
                          {DIAS_MES.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="campo">
                      <span>A fatura é paga com</span>
                      <select className="entrada" value={k.pagaCom} onChange={(e) => mudaCartao(k.id, { pagaCom: e.target.value })}>
                        {pagadoras.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome || 'Conta do banco'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small className="suave">Os dois dias estão no app do banco, na tela da fatura.</small>
                  </div>
                </div>
              ))}
            {usaCartao && (
              <button type="button" className="btn btn-sec" onClick={() => setCartoes((cs) => [...cs, novoCartao()])}>
                <Plus size={18} />
                Outro cartão
              </button>
            )}
          </div>
        )}

        {passo === 4 && (
          <div className="pilha">
            {fixas.map((f) => (
              <div key={f.id} className={`item-ob ${f.on ? 'ligado' : ''}`}>
                <div className="cab">
                  <div className="cresce">
                    {f.livre ? (
                      <input className="entrada" value={f.nome} onChange={(e) => mudaFixa(f.id, { nome: e.target.value })} placeholder="Nome da conta" autoFocus />
                    ) : (
                      <>
                        <b>{f.nome}</b>
                        {f.das && <small>O imposto mensal de todo MEI. Confira o valor no seu boleto.</small>}
                      </>
                    )}
                  </div>
                  {f.livre ? (
                    <button type="button" className="icone-btn" aria-label="Remover conta" onClick={() => setFixas((fs) => fs.filter((x) => x.id !== f.id))}>
                      <Trash2 size={19} />
                    </button>
                  ) : (
                    <Chave ligado={f.on} onChange={(v) => mudaFixa(f.id, { on: v })} rotulo={`Tenho ${f.nome}`} />
                  )}
                </div>
                {f.on && (
                  <div className="abre dupla">
                    <label className="campo">
                      <span>Valor</span>
                      <CampoDinheiro valor={f.valor} onChange={(v) => mudaFixa(f.id, { valor: v })} />
                    </label>
                    <label className="campo">
                      <span>Vence todo dia</span>
                      <select className="entrada num" value={f.dia} onChange={(e) => mudaFixa(f.id, { dia: Number(e.target.value) })}>
                        {Array.from({ length: 28 }, (_, i) => (
                          <option key={i} value={i + 1}>
                            {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-sec" onClick={() => setFixas((fs) => [...fs, { id: novoId('x'), nome: '', categoriaId: 'taxas', on: true, valor: 0, dia: 10, livre: true }])}>
              <Plus size={18} />
              Outra conta
            </button>
          </div>
        )}

        {passo === 5 && (
          <div className="pilha">
            <div className="card pilha">
              <div>
                <div className="rotulo">Resumo da semana: em que dia?</div>
                <div className="dias">
                  {DIAS_SEMANA.map((d, i) => (
                    <button type="button" key={d} aria-pressed={resumoDia === i} aria-label={d} onClick={() => setResumoDia(i)}>
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="campo">
                <span>A que horas?</span>
                <select className="entrada num" value={resumoHora} onChange={(e) => setResumoHora(e.target.value)}>
                  {HORAS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
                <small>Toda {DIAS_SEMANA[resumoDia]} eu conto quanto entrou, quanto saiu e o que vem pela frente.</small>
              </label>
            </div>
            <div className="card pilha">
              <label className="campo">
                <span>Lembrete de conta vencendo: a que horas?</span>
                <select className="entrada num" value={lembreteHora} onChange={(e) => setLembreteHora(e.target.value)}>
                  {HORAS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
              <div>
                <div className="rotulo">Com quanta antecedência?</div>
                <Seg
                  bloco
                  valor={antecedencia}
                  onChange={setAntecedencia}
                  opcoes={[
                    { v: '0', r: 'Só no dia' },
                    { v: '1', r: '1 dia antes' },
                    { v: '3', r: '3 dias antes' },
                  ]}
                />
              </div>
            </div>
          </div>
        )}

        {passo === 6 && !confirmado && (
          <div className="card pilha confirma">
            <div className="codigo-grande">
              <small>Seu código</small>
              <b className="num">{codigo ?? '······'}</b>
              <small>vale por 30 minutos</small>
            </div>
            <ol className="passos-confirma">
              <li>Toque no botão verde aqui embaixo.</li>
              <li>O WhatsApp abre com a mensagem pronta para a Granninha, do número {s.usuario.whats || 'que você informou'}.</li>
              <li>Toque em enviar e volte para esta tela.</li>
            </ol>
            <div className="esperando" aria-live="polite">
              <LoaderCircle size={16} className="gira" /> Esperando sua mensagem chegar...
            </div>
            {/* Sem isto, quem demora e vê o código vencer fica esperando para sempre. */}
            <button
              type="button"
              className="btn btn-txt"
              onClick={() => {
                setCodigo(null)
                void gerarCodigo().then(setCodigo)
              }}
            >
              Demorei, quero outro código
            </button>
          </div>
        )}
        {passo === 6 && confirmado && <Conversa />}
      </div>

      <div className="ob-pe">
        <div>
          {passo < 6 ? (
            <>
              <div className="falta" aria-live="polite">
                {falta}
              </div>
              <button
                type="button"
                className="btn btn-pri btn-bloco"
                disabled={!!falta}
                onClick={() => {
                  // Ao concluir o último passo de dados, grava tudo antes de mandar a pessoa ao WhatsApp.
                  if (passo === 5) salvarDados()
                  setPasso(passo + 1)
                }}
              >
                {passo === 5 ? 'Concluir' : 'Continuar'}
                <ArrowRight size={18} />
              </button>
            </>
          ) : (
            <>
              {!confirmado ? (
                <>
                  <a
                    className="btn btn-wa btn-bloco"
                    href={linkWhats(codigo ? `Meu código Granninha: ${codigo}` : 'Oi, Granninha!')}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      // Na demonstração não há Granninha de verdade: confirma sozinho depois de um instante.
                      if (s.sessao.demo) setTimeout(() => setConfirmado(true), 2500)
                    }}
                  >
                    <MessageCircle size={19} />
                    Abrir o WhatsApp e enviar o código
                  </a>
                  <button type="button" className="btn btn-txt" onClick={concluir}>
                    Confirmar depois
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-pri btn-bloco" onClick={concluir}>
                  Ver meu painel
                  <ArrowRight size={18} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const CORES = ['#17A34F', '#454C83', '#747EAD', '#B1B9D8', '#5BBF8A', '#292D54']

function Confete() {
  const pecas = useMemo(
    () => Array.from({ length: 42 }, (_, i) => ({ left: `${(i * 37) % 100}%`, cor: CORES[i % CORES.length], dur: 1.8 + ((i * 13) % 14) / 10, atraso: ((i * 7) % 10) / 14, giro: (i * 47) % 360 })),
    [],
  )
  return (
    <div className="confete" aria-hidden>
      {pecas.map((p, i) => (
        <i key={i} style={{ left: p.left, background: p.cor, animationDuration: `${p.dur}s`, animationDelay: `${p.atraso}s`, transform: `rotate(${p.giro}deg)` }} />
      ))}
    </div>
  )
}
