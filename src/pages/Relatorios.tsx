import { ChevronRight, FileSpreadsheet, FileText, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Barras } from '../components/Graficos'
import { FaixaAssinatura, Topo } from '../components/Shell'
import { Chave, Folha, Mascote, Seg, useAviso } from '../components/ui'
import { doPeriodo, porCategoria, serieMensal, totais } from '../lib/calc'
import { baixar, csvLancamentos } from '../lib/exportar'
import { brl, capitaliza, diaCurto, diasNoMes, hoje, mascaraFone, mesAtual, mesDe, nomeMes, somaMeses } from '../lib/format'
import { useApp } from '../lib/store'

type Periodo = 'mes' | 'anterior' | 'tri' | 'ano' | 'outro'
const PERIODOS: { v: Periodo; r: string }[] = [
  { v: 'mes', r: 'Este mês' },
  { v: 'anterior', r: 'Mês passado' },
  { v: 'tri', r: '3 meses' },
  { v: 'ano', r: 'Este ano' },
  { v: 'outro', r: 'Outro período' },
]

export default function Relatorios() {
  const { s, mut } = useApp()
  const avisar = useAviso()
  const h = hoje()
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [de, setDe] = useState(`${mesAtual()}-01`)
  const [ate, setAte] = useState(h)
  const [lado, setLado] = useState<'saida' | 'entrada'>('saida')
  const [mesSel, setMesSel] = useState<number | undefined>()
  const [folhaContador, setFolhaContador] = useState(false)

  const [ini, fim] = useMemo((): [string, string] => {
    const m = mesAtual()
    if (periodo === 'mes') return [`${m}-01`, h]
    if (periodo === 'anterior') {
      const a = somaMeses(m, -1)
      return [`${a}-01`, `${a}-${diasNoMes(a)}`]
    }
    if (periodo === 'tri') return [`${somaMeses(m, -2)}-01`, h]
    if (periodo === 'ano') return [`${h.slice(0, 4)}-01-01`, h]
    return de <= ate ? [de, ate] : [ate, de]
  }, [periodo, de, ate, h])

  const lancs = useMemo(() => doPeriodo(s.lancamentos, ini, fim), [s.lancamentos, ini, fim])
  const t = useMemo(() => totais(lancs), [lancs])
  const fatias = useMemo(() => porCategoria(lancs, s.categorias, lado), [lancs, s.categorias, lado])
  const mensal = useMemo(() => serieMensal(s.lancamentos, mesDe(fim), 6), [s.lancamentos, fim])
  const rotuloPeriodo = `${diaCurto(ini)} a ${diaCurto(fim)} de ${fim.slice(0, 4)}`
  const margem = t.entrou > 0 ? t.sobrou / t.entrou : 0
  const iSel = mesSel ?? mensal.meses.length - 1

  const planilha = () => {
    if (!lancs.length) return avisar('Não há lançamentos neste período')
    baixar(`granna-mei-${ini}-a-${fim}.csv`, csvLancamentos(s, lancs), 'text/csv;charset=utf-8')
    avisar(`Planilha baixada com ${lancs.length} lançamentos`)
  }

  const c = s.contador
  const contadorOk = c.nome.trim().length > 1 && (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim()) || c.whats.replace(/\D/g, '').length >= 10)
  const mudaContador = (p: Partial<typeof c>) => mut((a) => ({ ...a, contador: { ...a.contador, ...p } }))

  return (
    <div className="pagina">
      <Topo titulo="Relatórios" sub={capitaliza(rotuloPeriodo)} />
      <FaixaAssinatura />

      <div className="fichas nao-imprime" role="group" aria-label="Período">
        {PERIODOS.map((p) => (
          <button type="button" key={p.v} className="ficha" aria-pressed={periodo === p.v} onClick={() => setPeriodo(p.v)}>
            {p.r}
          </button>
        ))}
      </div>
      {periodo === 'outro' && (
        <div className="dupla nao-imprime">
          <label className="campo">
            <span>De</span>
            <input className="entrada" type="date" value={de} max={h} onChange={(e) => e.target.value && setDe(e.target.value)} />
          </label>
          <label className="campo">
            <span>Até</span>
            <input className="entrada" type="date" value={ate} max={h} onChange={(e) => e.target.value && setAte(e.target.value)} />
          </label>
        </div>
      )}

      <div className="trio">
        <div>
          <small>Entrou</small>
          <b className="num cor-in">{brl(t.entrou)}</b>
        </div>
        <div>
          <small>Saiu</small>
          <b className="num cor-out">{brl(t.saiu)}</b>
        </div>
        <div>
          <small>Resultado</small>
          <b className={`num ${t.sobrou < 0 ? 'cor-out' : ''}`}>{brl(t.sobrou)}</b>
        </div>
      </div>

      <div className="grade">
        <section className="card g-5 estica">
          <div className="recado">
            <Mascote pose="apresentando" tam={92} />
            <div className="balao">
              {lancs.length === 0 ? (
                <>Ainda não tem lançamento neste período.</>
              ) : t.sobrou >= 0 ? (
                <>
                  De cada R$ 100 que entraram, <b>sobraram R$ {Math.round(margem * 100)}</b> para o negócio.
                  {t.retirada > 0 && <> Você retirou {brl(t.retirada)} para uso pessoal.</>}
                </>
              ) : (
                <>
                  Saiu <b>{brl(-t.sobrou)} a mais</b> do que entrou neste período. Vale olhar as maiores saídas aqui embaixo.
                </>
              )}
            </div>
          </div>
        </section>

        <section className="card g-7 estica">
          <div className="card-cab">
            <h2>Mês a mês</h2>
            <span className="suave pq">{capitaliza(nomeMes(mensal.meses[iSel]))}</span>
          </div>
          <Barras
            labels={mensal.labels}
            sel={iSel}
            onSel={setMesSel}
            series={[
              { nome: 'Entrou', cor: '#12915A', valores: mensal.entradas },
              { nome: 'Saiu', cor: '#D5505B', valores: mensal.saidas },
            ]}
          />
          <div className="legenda" style={{ marginTop: 12 }}>
            <span>
              <i style={{ background: '#12915A' }} />
              Entrou<b className="num">{brl(mensal.entradas[iSel])}</b>
            </span>
            <span>
              <i style={{ background: '#D5505B' }} />
              Saiu<b className="num">{brl(mensal.saidas[iSel])}</b>
            </span>
          </div>
        </section>

        <section className="card g-7">
          <div className="card-cab">
            <h2>Por categoria</h2>
            <Seg
              valor={lado}
              onChange={setLado}
              opcoes={[
                { v: 'saida', r: 'Saídas' },
                { v: 'entrada', r: 'Entradas' },
              ]}
            />
          </div>
          {fatias.length === 0 ? (
            <p className="suave" style={{ padding: '10px 0' }}>
              Nada neste período.
            </p>
          ) : (
            <div className="pilha" style={{ gap: 12 }}>
              {fatias.map((f) => (
                <div key={f.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14, marginBottom: 5 }}>
                    <span style={{ fontWeight: 620, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.nome} <span className="suave num" style={{ fontWeight: 500 }}>({f.qtd})</span>
                    </span>
                    <span className="num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {brl(f.valor)} <span className="suave" style={{ fontWeight: 600 }}>{Math.round(f.frac * 100)}%</span>
                    </span>
                  </div>
                  <div className="prog">
                    <i style={{ width: `${Math.max(2, (f.valor / fatias[0].valor) * 100)}%`, background: f.cor }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card g-5 nao-imprime" style={{ paddingBottom: 6 }}>
          <div className="card-cab" style={{ marginBottom: 2 }}>
            <h2>Levar para o contador</h2>
          </div>
          <div className="lista">
            <button type="button" className="linha" onClick={planilha}>
              <span className="selo" style={{ background: 'var(--in-bg)', color: 'var(--in)' }}>
                <FileSpreadsheet size={19} />
              </span>
              <div className="meio">
                <div className="tit">Planilha para Excel</div>
                <div className="det">
                  <span>Todos os lançamentos do período</span>
                </div>
              </div>
              <ChevronRight size={18} className="seta" />
            </button>
            <button type="button" className="linha" onClick={() => window.print()}>
              <span className="selo" style={{ background: 'var(--out-bg)', color: 'var(--out)' }}>
                <FileText size={19} />
              </span>
              <div className="meio">
                <div className="tit">Relatório em PDF</div>
                <div className="det">
                  <span>Este resumo, pronto para imprimir ou salvar</span>
                </div>
              </div>
              <ChevronRight size={18} className="seta" />
            </button>
            <button type="button" className="linha" onClick={() => setFolhaContador(true)}>
              <span className="selo" style={{ background: 'var(--mist)', color: 'var(--indigo)' }}>
                <Send size={19} />
              </span>
              <div className="meio">
                <div className="tit">Enviar ao contador</div>
                <div className="det">
                  <span>{contadorOk ? `${c.nome}${c.auto ? ' · todo dia 1 automático' : ''}` : 'Cadastre quem recebe'}</span>
                </div>
              </div>
              <ChevronRight size={18} className="seta" />
            </button>
          </div>
        </section>
      </div>

      <Folha
        aberta={folhaContador}
        onFechar={() => setFolhaContador(false)}
        titulo="Enviar ao contador"
        pe={
          <button
            type="button"
            className="btn btn-pri btn-bloco"
            disabled={!contadorOk}
            onClick={() => {
              setFolhaContador(false)
              avisar(`Relatório de ${rotuloPeriodo} enviado para ${c.nome}`)
            }}
          >
            <Send size={18} />
            Enviar o relatório deste período
          </button>
        }
      >
        <div className="pilha">
          <p className="suave">O contador recebe o PDF do resumo e a planilha com todos os lançamentos de {rotuloPeriodo}.</p>
          <label className="campo">
            <span>Nome do contador</span>
            <input className="entrada" value={c.nome} onChange={(e) => mudaContador({ nome: e.target.value })} placeholder="Ex.: Sérgio Contabilidade" />
          </label>
          <label className="campo">
            <span>E-mail</span>
            <input className="entrada" type="email" inputMode="email" autoCapitalize="none" value={c.email} onChange={(e) => mudaContador({ email: e.target.value })} placeholder="contador@email.com" />
          </label>
          <label className="campo">
            <span>WhatsApp (opcional)</span>
            <input className="entrada num" type="tel" inputMode="tel" value={c.whats} onChange={(e) => mudaContador({ whats: mascaraFone(e.target.value) })} placeholder="(81) 90000-0000" />
            {!contadorOk && <small>Preencha o nome e um e-mail ou WhatsApp para enviar.</small>}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 650 }}>Enviar sozinho todo dia 1</div>
              <div className="suave pq">Com o fechamento do mês anterior.</div>
            </div>
            <Chave rotulo="Enviar automaticamente todo dia 1" ligado={c.auto} onChange={(v) => mudaContador({ auto: v })} />
          </div>
        </div>
      </Folha>
    </div>
  )
}
