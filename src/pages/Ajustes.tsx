import { Bell, CalendarClock, Camera, ChevronRight, CreditCard, Download, LogOut, MessageCircle, Plus, Send, Tags, Trash2, UserRound, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmarWhats } from '../components/ConfirmarWhats'
import { FaixaAssinatura, FotoPerfil, IconeCarteira, Topo } from '../components/Shell'
import { faturas } from '../lib/cartao'
import { blobParaDataUrl, prepararFoto } from '../lib/foto'
import { enviarFoto, removerFoto } from '../lib/remoto'
import { CampoDinheiro, Chave, Codigo, Folha, Seg, useAviso } from '../components/ui'
import { saldos } from '../lib/calc'
import { PRECO_ANUAL, PRECO_MENSAL, RAMOS } from '../lib/config'
import { baixar, csvLancamentos } from '../lib/exportar'
import { brl, DIAS_SEMANA, diaCurto, documentoValido, hoje, mascaraCnpj, mascaraFone, mesAtual, somaDias, somaMeses } from '../lib/format'
import { novoId, useApp } from '../lib/store'
import type { Carteira, Categoria, Conta, Estado, Fixa, StatusAssinatura, TipoCarteira } from '../lib/tipos'

type Aba = null | 'perfil' | 'whats' | 'carteiras' | 'categorias' | 'fixas' | 'horarios' | 'contador' | 'excluir'
const HORAS = Array.from({ length: 16 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`)
const CORES_NOVAS = ['#3B82C4', '#C2528B', '#2F9E8F', '#E0A03B', '#8B5FBF', '#D96C4F']

/** Contas em aberto geradas por uma conta fixa: mês atual (se ainda não venceu) e os dois seguintes. */
function contasDaFixa(f: Fixa): Conta[] {
  const h = hoje()
  const r: Conta[] = []
  for (let k = 0; k < 3; k++) {
    const venc = `${somaMeses(mesAtual(), k)}-${String(f.dia).padStart(2, '0')}`
    if (venc < h) continue
    r.push({ id: novoId('c'), tipo: 'pagar', descricao: f.descricao, valor: f.valor, vencimento: venc, status: 'aberta', categoriaId: f.categoriaId, fixaId: f.id, das: f.das })
  }
  return r
}

export function baixarTudo(s: Estado) {
  const { sessao: _sessao, ...dados } = s
  baixar(`granna-mei-meus-dados-${hoje()}.json`, JSON.stringify(dados, null, 2), 'application/json')
  window.setTimeout(() => baixar(`granna-mei-lancamentos-${hoje()}.csv`, csvLancamentos(s, s.lancamentos), 'text/csv;charset=utf-8'), 400)
}

export default function Ajustes() {
  const { s, mut, sair, simularStatus, entrarDemo } = useApp()
  const avisar = useAviso()
  const [aba, setAba] = useState<Aba>(null)
  const fechar = () => setAba(null)
  const u = s.usuario
  const sal = saldos(s)

  // Troca de WhatsApp
  const [novoFone, setNovoFone] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [codigo, setCodigo] = useState('')
  // Nova carteira / categoria / conta fixa
  const [nCarteira, setNCarteira] = useState<{ nome: string; tipo: TipoCarteira; fechamento: number; vencimento: number; paga: string }>({ nome: '', tipo: 'banco', fechamento: 0, vencimento: 0, paga: '' })
  const [subindoFoto, setSubindoFoto] = useState(false)
  const trocarFoto = async (arquivo?: File) => {
    if (!arquivo) return
    setSubindoFoto(true)
    try {
      const foto = await prepararFoto(arquivo)
      // Na demonstração a foto fica só no navegador; na conta de verdade, vai para a pasta privada.
      const caminho = s.sessao.demo ? await blobParaDataUrl(foto) : await enviarFoto(foto, s.usuario.foto)
      mut((a) => ({ ...a, usuario: { ...a.usuario, foto: caminho } }))
      avisar('Foto atualizada')
    } catch (e) {
      avisar((e as Error).message || 'Não consegui trocar a foto agora.')
    } finally {
      setSubindoFoto(false)
    }
  }
  const tirarFoto = async () => {
    try {
      if (!s.sessao.demo) await removerFoto(s.usuario.foto)
      mut((a) => ({ ...a, usuario: { ...a.usuario, foto: undefined } }))
      avisar('Foto removida')
    } catch {
      avisar('Não consegui remover a foto agora.')
    }
  }
  const pagadoras = s.carteiras.filter((c) => c.tipo === 'banco' || c.tipo === 'dinheiro' || c.tipo === 'outro')
  const abertasCartao = faturas(s.lancamentos, s.carteiras).filter((f) => f.falta > 0)
  const mudaCarteira = (id: string, p: Partial<Carteira>) => mut((a) => ({ ...a, carteiras: a.carteiras.map((x): Carteira => (x.id === id ? { ...x, ...p } : x)) }))
  const DIAS_MES = Array.from({ length: 31 }, (_, i) => i + 1)
  const novaOk =
    nCarteira.nome.trim().length >= 2 && (nCarteira.tipo !== 'cartao' || (nCarteira.fechamento > 0 && nCarteira.vencimento > 0 && !!(nCarteira.paga || pagadoras[0])))
  const [nCat, setNCat] = useState<{ nome: string; tipo: 'entrada' | 'saida' }>({ nome: '', tipo: 'saida' })
  const [nFixa, setNFixa] = useState({ descricao: '', valor: 0, dia: 10 })
  const [confirmaExcluir, setConfirmaExcluir] = useState('')

  const usuario = (p: Partial<typeof u>) => mut((a) => ({ ...a, usuario: { ...a.usuario, ...p } }))
  const prefs = (p: Partial<Estado['prefs']>) => mut((a) => ({ ...a, prefs: { ...a.prefs, ...p } }))
  const contador = (p: Partial<Estado['contador']>) => mut((a) => ({ ...a, contador: { ...a.contador, ...p } }))

  const carteiraEmUso = (id: string) => s.lancamentos.some((l) => l.carteiraId === id || l.carteiraDestinoId === id)
  const mudaFixa = (id: string, p: Partial<Fixa>) =>
    mut((a) => {
      const fixas = a.fixas.map((f) => (f.id === id ? { ...f, ...p } : f))
      const f = fixas.find((x) => x.id === id)!
      // As contas em aberto dessa fixa acompanham o novo valor e o novo dia.
      const contas = a.contas.map((c): Conta => (c.fixaId === id && c.status === 'aberta' ? { ...c, valor: f.valor, descricao: f.descricao, vencimento: `${c.vencimento.slice(0, 8)}${String(f.dia).padStart(2, '0')}` } : c))
      return { ...a, fixas, contas }
    })

  const Item = ({ I, titulo, det, onClick, para }: { I: typeof Bell; titulo: string; det: string; onClick?: () => void; para?: string }) => {
    const dentro: ReactNode = (
      <>
        <span className="selo">
          <I size={19} />
        </span>
        <div className="meio">
          <div className="tit">{titulo}</div>
          <div className="det">
            <span>{det}</span>
          </div>
        </div>
        <ChevronRight size={18} className="seta" />
      </>
    )
    return para ? (
      <Link to={para} className="linha">
        {dentro}
      </Link>
    ) : (
      <button type="button" className="linha" onClick={onClick}>
        {dentro}
      </button>
    )
  }

  const statusTxt: Record<StatusAssinatura, string> = { trial: 'Teste grátis', ativa: 'Em dia', atrasada: 'Pagamento em atraso', bloqueada: 'Bloqueada', cortesia: 'Cortesia' }

  return (
    <div className="pagina">
      <Topo titulo="Ajustes" />
      <FaixaAssinatura />

      {s.exclusaoEm && (
        <div className="faixa atraso" role="alert">
          <span className="cresce">Sua conta será apagada em {diaCurto(s.exclusaoEm)}. Até lá, dá para desistir.</span>
          <button
            type="button"
            onClick={() => {
              mut((a) => ({ ...a, exclusaoEm: undefined }))
              avisar('Exclusão cancelada. Sua conta continua.')
            }}
          >
            Desistir
          </button>
        </div>
      )}

      <div className="grade">
        <section className="card g-6">
          <div className="perfil">
            <label className={`avatar avatar-troca ${subindoFoto ? 'subindo' : ''}`} aria-label="Trocar foto de perfil" title="Trocar foto">
              <FotoPerfil />
              <span className="camera" aria-hidden>
                <Camera size={14} />
              </span>
              <input type="file" accept="image/*" hidden disabled={subindoFoto} onChange={(e) => { void trocarFoto(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <div style={{ minWidth: 0 }}>
              <b>{u.nome || 'Sua conta'}</b>
              <div className="suave" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.negocio}
                {u.negocio && u.email ? ' · ' : ''}
                {u.email}
              </div>
              {u.foto ? (
                <button type="button" className="lnk pq" onClick={() => void tirarFoto()}>
                  Remover foto
                </button>
              ) : (
                <span className="suave pq">Toque no círculo para pôr sua foto</span>
              )}
            </div>
          </div>
        </section>
        <section className="card g-6 menu">
          <Item I={CreditCard} titulo="Assinatura" det={s.assinatura.status === 'cortesia' ? 'Cortesia · sem cobrança' : `${s.assinatura.plano === 'anual' ? `Anual · ${brl(PRECO_ANUAL)}` : `Mensal · ${brl(PRECO_MENSAL)}`} · ${statusTxt[s.assinatura.status] ?? s.assinatura.status}`} para="/ajustes/assinatura" />
        </section>

        <div className="g-6 pilha" style={{ gap: 8 }}>
          <div className="secao-tit">Sua conta</div>
          <section className="card menu">
            <Item I={UserRound} titulo="Você e seu negócio" det={[u.negocio, RAMOS.find((r) => r.id === u.ramo)?.nome].filter(Boolean).join(' · ') || 'Nome, CNPJ ou CPF e ramo'} onClick={() => setAba('perfil')} />
            <Item
              I={MessageCircle}
              titulo="WhatsApp conectado"
              det={u.whats ? `${u.whats}${s.sessao.demo || u.verificado ? '' : ' · falta confirmar'}` : 'Nenhum número'}
              onClick={() => {
                setNovoFone('')
                setEnviado(false)
                setCodigo('')
                setAba('whats')
              }}
            />
            <Item I={Bell} titulo="Horários da Granninha" det={`Resumo ${DIAS_SEMANA[s.prefs.resumoDia]} às ${s.prefs.resumoHora} · lembretes às ${s.prefs.lembreteHora}`} onClick={() => setAba('horarios')} />
            <Item I={Send} titulo="Contador" det={s.contador.nome || 'Cadastre quem recebe seus relatórios'} onClick={() => setAba('contador')} />
          </section>
        </div>

        <div className="g-6 pilha" style={{ gap: 8 }}>
          <div className="secao-tit">Seu dinheiro</div>
          <section className="card menu">
            <Item I={Wallet} titulo="Carteiras" det={s.carteiras.map((c) => c.nome).join(', ') || 'Nenhuma'} onClick={() => setAba('carteiras')} />
            <Item I={Tags} titulo="Categorias" det={`${s.categorias.length} categorias`} onClick={() => setAba('categorias')} />
            <Item I={CalendarClock} titulo="Contas fixas" det={s.fixas.length ? s.fixas.map((f) => f.descricao).join(', ') : 'Nenhuma conta que se repete'} onClick={() => setAba('fixas')} />
          </section>
        </div>

        <div className="g-6 pilha" style={{ gap: 8 }}>
          <div className="secao-tit">Seus dados</div>
          <section className="card menu">
            <Item
              I={Download}
              titulo="Baixar meus dados"
              det="Tudo que você lançou, em planilha e arquivo"
              onClick={() => {
                baixarTudo(s)
                avisar('Seus dados foram baixados')
              }}
            />
            <Item
              I={Trash2}
              titulo="Excluir minha conta"
              det="Apaga tudo depois de 30 dias"
              onClick={() => {
                setConfirmaExcluir('')
                setAba('excluir')
              }}
            />
            <Item I={LogOut} titulo="Sair" det={s.sessao.demo ? 'Fechar a demonstração' : 'Encerrar a sessão neste aparelho'} onClick={sair} />
          </section>
        </div>

        {s.sessao.demo && (
        <div className="g-6 pilha" style={{ gap: 8 }}>
          <div className="secao-tit">Demonstração (não existe na conta de verdade)</div>
          <section className="card pilha">
            <div>
              <div className="rotulo">Simular situação da assinatura</div>
              <Seg
                bloco
                valor={s.assinatura.status}
                onChange={(v) => simularStatus(v)}
                opcoes={[
                  { v: 'trial', r: 'Teste' },
                  { v: 'ativa', r: 'Em dia' },
                  { v: 'atrasada', r: 'Atraso' },
                  { v: 'bloqueada', r: 'Bloqueio' },
                ]}
              />
            </div>
            <div className="dupla">
              <button type="button" className="btn btn-sec btn-p" onClick={() => mut((a) => ({ ...a, sessao: { ...a.sessao, onboarding: false } }))}>
                Rever boas-vindas
              </button>
              <button
                type="button"
                className="btn btn-sec btn-p"
                onClick={() => {
                  entrarDemo()
                  avisar('Dados de exemplo recarregados')
                }}
              >
                Recarregar exemplo
              </button>
            </div>
          </section>
        </div>
        )}
      </div>

      {/* No computador a assinatura fica no fim da barra lateral. */}
      <div className="assinatura-amp so-mobile" style={{ marginTop: 6 }}>
        Desenvolvido por{' '}
        <a href="https://grupongp.com.br" target="_blank" rel="noopener noreferrer">
          Amplasoft — Grupo NGP
        </a>
      </div>

      {/* ---------- Você e seu negócio ---------- */}
      <Folha aberta={aba === 'perfil'} onFechar={fechar} titulo="Você e seu negócio" pe={<button type="button" className="btn btn-pri btn-bloco" onClick={fechar}>Pronto</button>}>
        <div className="pilha">
          <label className="campo">
            <span>Seu nome</span>
            <input className="entrada" value={u.nome} onChange={(e) => usuario({ nome: e.target.value })} />
          </label>
          <label className="campo">
            <span>Nome do negócio</span>
            <input className="entrada" value={u.negocio} onChange={(e) => usuario({ negocio: e.target.value })} />
          </label>
          <label className="campo">
            <span>CNPJ ou CPF</span>
            <input className="entrada num" inputMode="numeric" value={u.cnpj} onChange={(e) => usuario({ cnpj: mascaraCnpj(e.target.value) })} placeholder="CNPJ do MEI ou seu CPF" aria-invalid={!documentoValido(u.cnpj)} />
            {!documentoValido(u.cnpj) && <small className="cor-out">Esse CNPJ ou CPF não confere. Revise os números.</small>}
          </label>
          <label className="campo">
            <span>E-mail</span>
            <input className="entrada" type="email" inputMode="email" autoCapitalize="none" value={u.email} onChange={(e) => usuario({ email: e.target.value })} />
          </label>
          <label className="campo">
            <span>Ramo</span>
            <select className="entrada" value={u.ramo} onChange={(e) => usuario({ ramo: e.target.value })}>
              {RAMOS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Folha>

      {/* ---------- WhatsApp (conta de verdade) ---------- */}
      {!s.sessao.demo && (
        <Folha aberta={aba === 'whats'} onFechar={fechar} titulo="WhatsApp conectado" pe={<button type="button" className="btn btn-sec btn-bloco" onClick={fechar}>Fechar</button>}>
          <div className="pilha">
            <label className="campo">
              <span>Seu número</span>
              <input
                className="entrada num"
                type="tel"
                inputMode="tel"
                value={novoFone || u.whats}
                onChange={(e) => setNovoFone(mascaraFone(e.target.value))}
                placeholder="(81) 90000-0000"
              />
              <small>Só este número consegue lançar e consultar pela Granninha.</small>
            </label>
            {novoFone && novoFone !== u.whats && novoFone.replace(/\D/g, '').length >= 10 && (
              <button
                type="button"
                className="btn btn-sec"
                onClick={() => {
                  usuario({ whats: novoFone, verificado: false })
                  setNovoFone('')
                  avisar('Número salvo. Agora confirme pelo WhatsApp.')
                }}
              >
                Salvar número novo
              </button>
            )}
            <ConfirmarWhats />
          </div>
        </Folha>
      )}

      {/* ---------- WhatsApp (demonstração) ---------- */}
      <Folha
        aberta={aba === 'whats' && s.sessao.demo}
        onFechar={fechar}
        titulo="WhatsApp conectado"
        pe={
          enviado ? (
            <button
              type="button"
              className="btn btn-pri btn-bloco"
              disabled={codigo.length < 6}
              onClick={() => {
                usuario({ whats: novoFone })
                fechar()
                avisar(s.sessao.demo ? 'WhatsApp trocado. A Granninha já fala com o número novo.' : 'Número salvo. A confirmação pelo WhatsApp entra quando a Granninha for ligada.')
              }}
            >
              Confirmar número novo
            </button>
          ) : (
            <button type="button" className="btn btn-wa btn-bloco" disabled={novoFone.replace(/\D/g, '').length < 10} onClick={() => setEnviado(true)}>
              <MessageCircle size={18} />
              Receber código no número novo
            </button>
          )
        }
      >
        <div className="pilha">
          <p className="suave">
            Hoje a Granninha conversa com <b style={{ color: 'var(--text)' }}>{u.whats || 'nenhum número'}</b>. Só esse número consegue lançar e consultar.
          </p>
          <label className="campo">
            <span>Número novo</span>
            <input
              className="entrada num"
              type="tel"
              inputMode="tel"
              value={novoFone}
              onChange={(e) => {
                setNovoFone(mascaraFone(e.target.value))
                setEnviado(false)
                setCodigo('')
              }}
              placeholder="(81) 90000-0000"
            />
          </label>
          {enviado && (
            <div className="campo">
              <span>Código enviado para {novoFone}</span>
              <Codigo valor={codigo} onChange={setCodigo} />
              <small>{s.sessao.demo ? 'Demonstração: qualquer código de 6 números vale.' : 'Digite o código que a Granninha mandou.'}</small>
            </div>
          )}
        </div>
      </Folha>

      {/* ---------- Horários ---------- */}
      <Folha aberta={aba === 'horarios'} onFechar={fechar} titulo="Horários da Granninha" pe={<button type="button" className="btn btn-pri btn-bloco" onClick={fechar}>Pronto</button>}>
        <div className="pilha">
          <div>
            <div className="rotulo">Resumo da semana: em que dia?</div>
            <div className="dias">
              {DIAS_SEMANA.map((d, i) => (
                <button type="button" key={d} aria-pressed={s.prefs.resumoDia === i} aria-label={d} onClick={() => prefs({ resumoDia: i })}>
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
          <div className="dupla">
            <label className="campo">
              <span>Hora do resumo</span>
              <select className="entrada num" value={s.prefs.resumoHora} onChange={(e) => prefs({ resumoHora: e.target.value })}>
                {HORAS.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Hora dos lembretes</span>
              <select className="entrada num" value={s.prefs.lembreteHora} onChange={(e) => prefs({ lembreteHora: e.target.value })}>
                {HORAS.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <div className="rotulo">Lembrar de conta vencendo</div>
            <Seg
              bloco
              valor={String(s.prefs.antecedencia)}
              onChange={(v) => prefs({ antecedencia: Number(v) })}
              opcoes={[
                { v: '0', r: 'Só no dia' },
                { v: '1', r: '1 dia antes' },
                { v: '3', r: '3 dias antes' },
              ]}
            />
          </div>
        </div>
      </Folha>

      {/* ---------- Contador ---------- */}
      <Folha aberta={aba === 'contador'} onFechar={fechar} titulo="Contador" pe={<button type="button" className="btn btn-pri btn-bloco" onClick={fechar}>Pronto</button>}>
        <div className="pilha">
          <p className="suave">Quem recebe seus relatórios. O envio é feito na tela Relatórios.</p>
          <label className="campo">
            <span>Nome</span>
            <input className="entrada" value={s.contador.nome} onChange={(e) => contador({ nome: e.target.value })} placeholder="Ex.: Sérgio Contabilidade" />
          </label>
          <label className="campo">
            <span>E-mail</span>
            <input className="entrada" type="email" inputMode="email" autoCapitalize="none" value={s.contador.email} onChange={(e) => contador({ email: e.target.value })} placeholder="contador@email.com" />
          </label>
          <label className="campo">
            <span>WhatsApp (opcional)</span>
            <input className="entrada num" type="tel" inputMode="tel" value={s.contador.whats} onChange={(e) => contador({ whats: mascaraFone(e.target.value) })} placeholder="(81) 90000-0000" />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 650 }}>Enviar sozinho todo dia 1</div>
              <div className="suave pq">Com o fechamento do mês anterior.</div>
            </div>
            <Chave rotulo="Enviar automaticamente todo dia 1" ligado={s.contador.auto} onChange={(v) => contador({ auto: v })} />
          </div>
        </div>
      </Folha>

      {/* ---------- Carteiras ---------- */}
      <Folha aberta={aba === 'carteiras'} onFechar={fechar} titulo="Carteiras" pe={<button type="button" className="btn btn-pri btn-bloco" onClick={fechar}>Pronto</button>}>
        <div className="pilha">
          {s.carteiras.map((c) => (
            <div key={c.id} className={`item-ob ${c.padrao ? 'ligado' : ''}`}>
              <div className="cab">
                <span className="selo" style={{ background: 'var(--mist)', color: 'var(--indigo)' }}>
                  <IconeCarteira tipo={c.tipo} size={19} />
                </span>
                <div className="cresce">
                  <input className="entrada" aria-label="Nome da carteira" value={c.nome} onChange={(e) => mut((a) => ({ ...a, carteiras: a.carteiras.map((x): Carteira => (x.id === c.id ? { ...x, nome: e.target.value } : x)) }))} style={{ minHeight: 42 }} />
                </div>
                {!carteiraEmUso(c.id) && s.carteiras.length > 1 && (
                  <button
                    type="button"
                    className="icone-btn"
                    aria-label={`Remover ${c.nome}`}
                    onClick={() =>
                      mut((a) => {
                        const resto = a.carteiras.filter((x) => x.id !== c.id)
                        if (!resto.some((x) => x.padrao) && resto[0]) resto[0] = { ...resto[0], padrao: true }
                        return { ...a, carteiras: resto }
                      })
                    }
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
              {c.tipo === 'cartao' && (
                <div className="pilha" style={{ gap: 8 }}>
                  <div className="dupla">
                    <label className="campo">
                      <span>Fecha dia</span>
                      <select className="entrada num" value={c.fechamento ?? 0} onChange={(e) => mudaCarteira(c.id, { fechamento: Number(e.target.value) })}>
                        {DIAS_MES.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="campo">
                      <span>Vence dia</span>
                      <select className="entrada num" value={c.vencimento ?? 0} onChange={(e) => mudaCarteira(c.id, { vencimento: Number(e.target.value) })}>
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
                    <select className="entrada" value={c.contaPagamentoId ?? ''} onChange={(e) => mudaCarteira(c.id, { contaPagamentoId: e.target.value || undefined })}>
                      <option value="">Perguntar na hora</option>
                      {pagadoras.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {c.tipo === 'cartao' || c.tipo === 'investimento' ? (
                  <span className="suave pq">{c.tipo === 'cartao' ? 'Cartão de crédito' : 'Investimento, fora do caixa'}</span>
                ) : (
                  <button type="button" className="radio-linha" aria-pressed={c.padrao} onClick={() => mut((a) => ({ ...a, carteiras: a.carteiras.map((x): Carteira => ({ ...x, padrao: x.id === c.id })) }))}>
                    <i />
                    Principal
                  </button>
                )}
                <span className="suave pq">
                  {c.tipo === 'cartao' ? 'Em faturas abertas: ' : 'Saldo: '}
                  <b className="num" style={{ color: 'var(--text)' }}>
                    {brl(c.tipo === 'cartao' ? abertasCartao.filter((f) => f.cartaoId === c.id).reduce((a, f) => a + f.falta, 0) : sal[c.id] ?? 0)}
                  </b>
                </span>
              </div>
            </div>
          ))}
          <div className="item-ob">
            <div className="rotulo" style={{ marginBottom: 0 }}>Nova carteira</div>
            <select className="entrada" aria-label="Tipo da carteira" value={nCarteira.tipo} onChange={(e) => setNCarteira({ ...nCarteira, tipo: e.target.value as TipoCarteira })}>
              <option value="banco">Conta de banco</option>
              <option value="cartao">Cartão de crédito</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="maquininha">Maquininha</option>
              <option value="investimento">Investimento (fica fora do caixa)</option>
              <option value="outro">Outro</option>
            </select>
            <input className="entrada" placeholder={nCarteira.tipo === 'cartao' ? 'Ex.: Nubank' : nCarteira.tipo === 'investimento' ? 'Ex.: XP' : 'Ex.: Itaú'} value={nCarteira.nome} onChange={(e) => setNCarteira({ ...nCarteira, nome: e.target.value })} />
            {nCarteira.tipo === 'cartao' && (
              <>
                <div className="dupla">
                  <label className="campo">
                    <span>Fecha dia</span>
                    <select className="entrada num" value={nCarteira.fechamento} onChange={(e) => setNCarteira({ ...nCarteira, fechamento: Number(e.target.value) })}>
                      <option value={0}>Escolha</option>
                      {DIAS_MES.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="campo">
                    <span>Vence dia</span>
                    <select className="entrada num" value={nCarteira.vencimento} onChange={(e) => setNCarteira({ ...nCarteira, vencimento: Number(e.target.value) })}>
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
                  <select className="entrada" value={nCarteira.paga || pagadoras[0]?.id || ''} onChange={(e) => setNCarteira({ ...nCarteira, paga: e.target.value })}>
                    {pagadoras.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <button
              type="button"
              className="btn btn-sec"
              disabled={!novaOk}
              onClick={() => {
                const n = nCarteira
                const ehCartao = n.tipo === 'cartao'
                const nome = ehCartao && !n.nome.trim().toLowerCase().startsWith('cartão') ? `Cartão ${n.nome.trim()}` : n.nome.trim()
                mut((a) => ({
                  ...a,
                  carteiras: [
                    ...a.carteiras,
                    {
                      id: novoId('w'), nome, tipo: n.tipo, saldoInicial: 0,
                      padrao: !a.carteiras.some((x) => x.padrao) && n.tipo !== 'cartao' && n.tipo !== 'investimento',
                      ...(ehCartao ? { fechamento: n.fechamento, vencimento: n.vencimento, contaPagamentoId: n.paga || pagadoras[0]?.id } : {}),
                    },
                  ],
                }))
                setNCarteira({ nome: '', tipo: 'banco', fechamento: 0, vencimento: 0, paga: '' })
              }}
            >
              <Plus size={18} />
              Adicionar carteira
            </button>
          </div>
          <p className="suave pq">Carteira que já tem lançamento não pode ser removida, para não bagunçar o saldo.</p>
        </div>
      </Folha>

      {/* ---------- Categorias ---------- */}
      <Folha aberta={aba === 'categorias'} onFechar={fechar} titulo="Categorias" pe={<button type="button" className="btn btn-pri btn-bloco" onClick={fechar}>Pronto</button>}>
        <div className="pilha">
          {(['entrada', 'saida'] as const).map((tp) => (
            <div key={tp}>
              <div className="rotulo">{tp === 'entrada' ? 'Entradas' : 'Saídas'}</div>
              <div className="lista">
                {s.categorias
                  .filter((c) => c.tipo === tp)
                  .map((c) => {
                    const emUso = s.lancamentos.some((l) => l.categoriaId === c.id) || s.contas.some((x) => x.categoriaId === c.id) || s.fixas.some((f) => f.categoriaId === c.id)
                    return (
                      <div className="linha" key={c.id} style={{ padding: '6px 0' }}>
                        <i style={{ width: 12, height: 12, borderRadius: 4, background: c.cor, flex: 'none' }} />
                        <div className="meio">
                          <input className="entrada" aria-label="Nome da categoria" value={c.nome} onChange={(e) => mut((a) => ({ ...a, categorias: a.categorias.map((x): Categoria => (x.id === c.id ? { ...x, nome: e.target.value } : x)) }))} style={{ minHeight: 42 }} />
                        </div>
                        {c.id.startsWith('cat-') && !emUso ? (
                          <button type="button" className="icone-btn" aria-label={`Remover ${c.nome}`} onClick={() => mut((a) => ({ ...a, categorias: a.categorias.filter((x) => x.id !== c.id) }))}>
                            <Trash2 size={18} />
                          </button>
                        ) : (
                          <span style={{ width: 40, flex: 'none' }} />
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
          <div className="item-ob">
            <div className="rotulo" style={{ marginBottom: 0 }}>Nova categoria</div>
            <input className="entrada" placeholder="Ex.: Cursos" value={nCat.nome} onChange={(e) => setNCat({ ...nCat, nome: e.target.value })} />
            <Seg
              bloco
              valor={nCat.tipo}
              onChange={(v) => setNCat({ ...nCat, tipo: v })}
              opcoes={[
                { v: 'saida', r: 'Saída' },
                { v: 'entrada', r: 'Entrada' },
              ]}
            />
            <button
              type="button"
              className="btn btn-sec"
              disabled={nCat.nome.trim().length < 2}
              onClick={() => {
                mut((a) => ({ ...a, categorias: [...a.categorias, { id: novoId('cat'), nome: nCat.nome.trim(), tipo: nCat.tipo, cor: CORES_NOVAS[a.categorias.length % CORES_NOVAS.length] }] }))
                setNCat({ nome: '', tipo: nCat.tipo })
              }}
            >
              <Plus size={18} />
              Adicionar categoria
            </button>
          </div>
        </div>
      </Folha>

      {/* ---------- Contas fixas ---------- */}
      <Folha aberta={aba === 'fixas'} onFechar={fechar} titulo="Contas fixas" pe={<button type="button" className="btn btn-pri btn-bloco" onClick={fechar}>Pronto</button>}>
        <div className="pilha">
          <p className="suave">Contas que chegam todo mês. A Granninha cria o lembrete sozinha.</p>
          {s.fixas.map((f) => (
            <div className="item-ob" key={f.id}>
              <div className="cab">
                <div className="cresce">
                  <input className="entrada" aria-label="Nome da conta" value={f.descricao} onChange={(e) => mudaFixa(f.id, { descricao: e.target.value })} style={{ minHeight: 42 }} />
                </div>
                <button type="button" className="icone-btn" aria-label={`Remover ${f.descricao}`} onClick={() => mut((a) => ({ ...a, fixas: a.fixas.filter((x) => x.id !== f.id), contas: a.contas.filter((c) => !(c.fixaId === f.id && c.status === 'aberta')) }))}>
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="dupla">
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
            </div>
          ))}
          <div className="item-ob">
            <div className="rotulo" style={{ marginBottom: 0 }}>Nova conta fixa</div>
            <input className="entrada" placeholder="Ex.: Aluguel" value={nFixa.descricao} onChange={(e) => setNFixa({ ...nFixa, descricao: e.target.value })} />
            <div className="dupla">
              <label className="campo">
                <span>Valor</span>
                <CampoDinheiro valor={nFixa.valor} onChange={(v) => setNFixa({ ...nFixa, valor: v })} />
              </label>
              <label className="campo">
                <span>Vence todo dia</span>
                <select className="entrada num" value={nFixa.dia} onChange={(e) => setNFixa({ ...nFixa, dia: Number(e.target.value) })}>
                  {Array.from({ length: 28 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="btn btn-sec"
              disabled={nFixa.descricao.trim().length < 2 || nFixa.valor <= 0}
              onClick={() => {
                const f: Fixa = { id: novoId('fx'), descricao: nFixa.descricao.trim(), valor: nFixa.valor, dia: nFixa.dia, categoriaId: 'taxas' }
                mut((a) => ({ ...a, fixas: [...a.fixas, f], contas: [...a.contas, ...contasDaFixa(f)] }))
                setNFixa({ descricao: '', valor: 0, dia: 10 })
              }}
            >
              <Plus size={18} />
              Adicionar conta fixa
            </button>
          </div>
        </div>
      </Folha>

      {/* ---------- Excluir conta ---------- */}
      <Folha
        aberta={aba === 'excluir'}
        onFechar={fechar}
        titulo="Excluir minha conta"
        pe={
          <>
            <button
              type="button"
              className="btn btn-perigo btn-bloco"
              disabled={confirmaExcluir.trim().toUpperCase() !== 'EXCLUIR'}
              onClick={() => {
                mut((a) => ({ ...a, exclusaoEm: somaDias(hoje(), 30) }))
                fechar()
                avisar('Exclusão agendada para daqui a 30 dias')
              }}
            >
              Excluir minha conta
            </button>
            <button type="button" className="btn btn-sec btn-bloco" onClick={fechar}>
              Manter minha conta
            </button>
          </>
        }
      >
        <div className="pilha">
          <p>
            Sua assinatura é cancelada agora e, <b>em 30 dias</b>, apagamos todos os seus lançamentos, contas e comprovantes. Nesse prazo você pode desistir aqui mesmo, em Ajustes.
          </p>
          <button type="button" className="btn btn-sec" onClick={() => baixarTudo(s)}>
            <Download size={18} />
            Baixar meus dados antes
          </button>
          <label className="campo">
            <span>Para confirmar, digite EXCLUIR</span>
            <input className="entrada" value={confirmaExcluir} onChange={(e) => setConfirmaExcluir(e.target.value)} autoCapitalize="characters" autoComplete="off" />
          </label>
        </div>
      </Folha>
    </div>
  )
}
