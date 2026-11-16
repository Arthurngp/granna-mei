import { ArrowRight, MessageCircle, Paperclip, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BotaoZap, FaixaAssinatura, SeloCategoria, Topo } from '../components/Shell'
import { Chave, Folha, IconeOrigem, MesNav, NOME_ORIGEM, useAviso, Vazio } from '../components/ui'
import { caixa, doMes, totais } from '../lib/calc'
import { linkWhats } from '../lib/config'
import { linkComprovante } from '../lib/remoto'
import { brl, capitaliza, diaExtenso, mesAtual, nomeMes } from '../lib/format'
import { useApp } from '../lib/store'
import type { Lancamento } from '../lib/tipos'

type Filtro = 'tudo' | 'entrada' | 'saida' | 'compra_cartao' | 'transferencia' | 'anexo'
const FILTROS: { v: Filtro; r: string }[] = [
  { v: 'tudo', r: 'Tudo' },
  { v: 'entrada', r: 'Entradas' },
  { v: 'saida', r: 'Saídas' },
  { v: 'compra_cartao', r: 'Cartão' },
  { v: 'transferencia', r: 'Transferências' },
  { v: 'anexo', r: 'Com comprovante' },
]

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Lancamentos() {
  const { s, mut, excluirLancamento } = useApp()
  const avisar = useAviso()
  const [ym, setYm] = useState(mesAtual())
  const [filtro, setFiltro] = useState<Filtro>('tudo')
  const [carteira, setCarteira] = useState('todas')
  const [busca, setBusca] = useState('')
  const [abertoId, setAbertoId] = useState<string | null>(null)
  const [confirma, setConfirma] = useState(false)

  const doMesAtual = useMemo(() => doMes(s.lancamentos, ym), [s.lancamentos, ym])
  const lista = useMemo(() => {
    const q = semAcento(busca.trim())
    return doMesAtual.filter((l) => {
      if (filtro === 'anexo' ? !l.anexo : filtro !== 'tudo' && l.tipo !== filtro) return false
      if (carteira !== 'todas' && l.carteiraId !== carteira && l.carteiraDestinoId !== carteira) return false
      if (!q) return true
      const cat = s.categorias.find((c) => c.id === l.categoriaId)?.nome ?? ''
      return semAcento(`${l.descricao} ${cat} ${l.valor.toFixed(2).replace('.', ',')}`).includes(q)
    })
  }, [doMesAtual, filtro, carteira, busca, s.categorias])

  // Sem filtro, o resumo segue o caixa (compra no cartão conta quando a fatura é paga). Com filtro, soma o que está na lista.
  const cxMes = useMemo(() => doMes(caixa(s), ym).filter((l) => carteira === 'todas' || l.carteiraId === carteira || l.carteiraDestinoId === carteira), [s.lancamentos, s.carteiras, ym, carteira])
  const t = useMemo(() => totais(filtro === 'tudo' && !busca.trim() ? cxMes : lista), [cxMes, lista, filtro, busca])
  const mesBR = (f?: string) => (f ? `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(f.slice(5, 7)) - 1]}/${f.slice(2, 4)}` : '')
  const grupos = useMemo(() => {
    const g: { data: string; itens: Lancamento[]; saldo: number }[] = []
    for (const l of lista) {
      let atual = g[g.length - 1]
      if (!atual || atual.data !== l.data) {
        atual = { data: l.data, itens: [], saldo: 0 }
        g.push(atual)
      }
      atual.itens.push(l)
      if (l.tipo === 'entrada') atual.saldo += l.valor
      else if (l.tipo === 'saida') atual.saldo -= l.valor
    }
    return g
  }, [lista])

  const aberto = s.lancamentos.find((l) => l.id === abertoId)
  const nomeCarteira = (id?: string) => s.carteiras.find((c) => c.id === id)?.nome ?? 'Carteira'
  const fechar = () => {
    setAbertoId(null)
    setConfirma(false)
  }
  const mudar = (id: string, p: Partial<Lancamento>) => mut((a) => ({ ...a, lancamentos: a.lancamentos.map((l) => (l.id === id ? { ...l, ...p } : l)) }))

  return (
    <div className="pagina">
      <Topo titulo="Lançamentos" sub="Tudo que entrou e saiu" />
      <FaixaAssinatura />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <MesNav ym={ym} onChange={setYm} />
        {s.carteiras.length > 1 && (
          <select className="entrada" aria-label="Carteira" value={carteira} onChange={(e) => setCarteira(e.target.value)} style={{ width: 'auto', minHeight: 40, fontSize: 14, fontWeight: 600 }}>
            <option value="todas">Todas as carteiras</option>
            {s.carteiras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="trio">
        <div>
          <small>Entrou</small>
          <b className="num cor-in">{brl(t.entrou)}</b>
        </div>
        <div>
          <small>Saiu</small>
          <b className="num cor-out">{brl(t.saiu + t.retirada)}</b>
        </div>
        <div>
          <small>Diferença</small>
          <b className="num">{brl(t.entrou - t.saiu - t.retirada)}</b>
        </div>
      </div>

      <div className="busca">
        <Search size={18} />
        <input className="entrada" type="search" placeholder="Buscar por nome, categoria ou valor" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar lançamentos" />
      </div>
      <div className="fichas" role="group" aria-label="Filtros">
        {FILTROS.map((f) => (
          <button type="button" key={f.v} className="ficha" aria-pressed={filtro === f.v} onClick={() => setFiltro(f.v)}>
            {f.v === 'anexo' && <Paperclip size={14} />}
            {f.r}
          </button>
        ))}
      </div>

      {grupos.length === 0 ? (
        <div className="card">
          {doMesAtual.length === 0 ? (
            <Vazio pose="dormindo" titulo={`Nada em ${nomeMes(ym, false)}`} texto="Quando você mandar um lançamento no WhatsApp, ele aparece aqui na hora.">
              <a className="btn btn-wa" href={linkWhats()} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={18} />
                Lançar pelo WhatsApp
              </a>
            </Vazio>
          ) : (
            <Vazio pose="lupa" titulo="Não achei nada" texto="Nenhum lançamento bate com essa busca ou filtro.">
              <button
                type="button"
                className="btn btn-sec"
                onClick={() => {
                  setBusca('')
                  setFiltro('tudo')
                  setCarteira('todas')
                }}
              >
                Limpar filtros
              </button>
            </Vazio>
          )}
        </div>
      ) : (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 6 }}>
          {grupos.map((g) => (
            <div key={g.data}>
              <div className="grupo-dia">
                <span>{capitaliza(diaExtenso(g.data))}</span>
                <small className="num">
                  {g.saldo >= 0 ? '+' : '-'} {brl(Math.abs(g.saldo))}
                </small>
              </div>
              <div className="lista">
                {g.itens.map((l) => {
                  const cat = s.categorias.find((c) => c.id === l.categoriaId)
                  return (
                    <button type="button" className="linha" key={l.id} onClick={() => setAbertoId(l.id)}>
                      <SeloCategoria cat={cat} tipo={l.tipo} />
                      <div className="meio">
                        <div className="tit">{l.descricao}</div>
                        <div className="det">
                          <IconeOrigem origem={l.origem} />
                          <span>
                            {l.tipo === 'transferencia'
                              ? `${nomeCarteira(l.carteiraId)} para ${nomeCarteira(l.carteiraDestinoId)}${l.fatura ? ` · fatura ${mesBR(l.fatura)}` : ''}`
                              : l.tipo === 'compra_cartao'
                                ? `${cat?.nome ?? 'Sem categoria'} · ${nomeCarteira(l.carteiraId)} · fatura ${mesBR(l.fatura)}`
                                : `${cat?.nome ?? 'Sem categoria'} · ${nomeCarteira(l.carteiraId)}`}
                          </span>
                          {l.anexo && <Paperclip size={12} />}
                        </div>
                      </div>
                      <div className={`val num ${l.tipo === 'entrada' ? 'cor-in' : l.tipo === 'compra_cartao' ? 'suave' : ''}`}>
                        {l.tipo === 'entrada' ? '+ ' : l.tipo === 'saida' || l.tipo === 'compra_cartao' ? '- ' : ''}
                        {brl(l.valor)}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Folha
        aberta={!!aberto}
        onFechar={fechar}
        titulo={aberto?.tipo === 'entrada' ? 'Entrada' : aberto?.tipo === 'saida' ? 'Saída' : aberto?.tipo === 'compra_cartao' ? 'Compra no cartão' : aberto?.carteiraDestinoId && s.carteiras.find((c) => c.id === aberto.carteiraDestinoId)?.tipo === 'cartao' ? 'Pagamento de fatura' : 'Transferência'}
        pe={
          aberto &&
          (confirma ? (
            <>
              <button
                type="button"
                className="btn btn-perigo btn-bloco"
                onClick={() => {
                  excluirLancamento(aberto.id)
                  fechar()
                  avisar('Lançamento apagado')
                }}
              >
                Sim, apagar este lançamento
              </button>
              <button type="button" className="btn btn-sec btn-bloco" onClick={() => setConfirma(false)}>
                Manter
              </button>
            </>
          ) : (
            <>
              <a className="btn btn-wa btn-bloco" href={linkWhats(`Quero corrigir o lançamento "${aberto.descricao}" de ${brl(aberto.valor)}`)} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={18} />
                Corrigir pelo WhatsApp
              </a>
              <button type="button" className="btn btn-txt" style={{ color: 'var(--out)' }} onClick={() => setConfirma(true)}>
                <Trash2 size={17} />
                Apagar lançamento
              </button>
            </>
          ))
        }
      >
        {aberto && (
          <>
            <div className="detalhe-valor">
              <strong className={`num ${aberto.tipo === 'entrada' ? 'cor-in' : ''}`}>
                {aberto.tipo === 'entrada' ? '+ ' : aberto.tipo === 'saida' || aberto.tipo === 'compra_cartao' ? '- ' : ''}
                {brl(aberto.valor)}
              </strong>
              <span className="suave">{aberto.descricao}</span>
            </div>
            <div className="fatos">
              <div>
                <span>Quando</span>
                <span>
                  {capitaliza(diaExtenso(aberto.data))}, {aberto.hora}
                </span>
              </div>
              {aberto.tipo === 'transferencia' ? (
                <div>
                  <span>Movimento</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {nomeCarteira(aberto.carteiraId)} <ArrowRight size={14} /> {nomeCarteira(aberto.carteiraDestinoId)}
                  </span>
                </div>
              ) : (
                <>
                  <div>
                    <span>Categoria</span>
                    <select
                      className="entrada"
                      aria-label="Categoria"
                      style={{ width: 'auto', maxWidth: '62%', minHeight: 40, fontSize: 14.5, fontWeight: 620 }}
                      value={aberto.categoriaId ?? ''}
                      onChange={(e) => {
                        const cat = s.categorias.find((c) => c.id === e.target.value)
                        mudar(aberto.id, { categoriaId: e.target.value, pessoal: aberto.tipo === 'saida' ? !!cat?.pessoal : undefined })
                      }}
                    >
                      {s.categorias
                        .filter((c) => c.tipo === (aberto.tipo === 'compra_cartao' ? 'saida' : aberto.tipo))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <span>Carteira</span>
                    <span>{nomeCarteira(aberto.carteiraId)}</span>
                  </div>
                  {aberto.tipo === 'compra_cartao' && (
                    <div>
                      <span>Fatura</span>
                      <span>
                        {mesBR(aberto.fatura)}
                        {aberto.parcela ? ` · parcela ${aberto.parcela.n} de ${aberto.parcela.total}` : ''}
                      </span>
                    </div>
                  )}
                  {(aberto.tipo === 'saida' || aberto.tipo === 'compra_cartao') && (
                    <div>
                      <span>Gasto pessoal (retirada)</span>
                      <Chave
                        rotulo="Marcar como gasto pessoal"
                        ligado={!!aberto.pessoal}
                        onChange={(v) => mudar(aberto.id, { pessoal: v, categoriaId: v ? 'retirada' : aberto.categoriaId === 'retirada' ? 'taxas' : aberto.categoriaId })}
                      />
                    </div>
                  )}
                </>
              )}
              <div>
                <span>Como chegou</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <IconeOrigem origem={aberto.origem} size={15} />
                  {NOME_ORIGEM[aberto.origem]}
                </span>
              </div>
            </div>
            {aberto.tipo === 'compra_cartao' && <p className="suave pq" style={{ marginTop: 10 }}>Compra no cartão entra nos gastos do mês em que você paga a fatura.</p>}
            {aberto.pessoal && <p className="suave pq" style={{ marginTop: 10 }}>Gasto pessoal sai do caixa, mas não entra na conta do lucro da empresa.</p>}
            {aberto.anexoPath && (
              <button
                type="button"
                className="btn btn-sec btn-bloco"
                style={{ marginTop: 14 }}
                onClick={async () => {
                  const url = await linkComprovante(aberto.anexoPath!)
                  if (url) window.open(url, '_blank', 'noopener,noreferrer')
                  else avisar('Não consegui abrir o comprovante agora.')
                }}
              >
                <Paperclip size={17} />
                Abrir comprovante
              </button>
            )}
            {aberto.anexo && !aberto.anexoPath && (
              <div className="comprovante" aria-label="Comprovante anexado">
                <b>
                  <span>COMPROVANTE</span>
                  <span>{aberto.origem === 'pdf' ? 'PDF' : 'FOTO'}</span>
                </b>
                <div>{aberto.descricao}</div>
                <b>
                  <span>
                    {aberto.data.split('-').reverse().join('/')} {aberto.hora}
                  </span>
                  <span>{brl(aberto.valor)}</span>
                </b>
              </div>
            )}
          </>
        )}
      </Folha>
      <BotaoZap />
    </div>
  )
}
