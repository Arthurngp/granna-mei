import { KeyRound, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, rpc } from '../sb'
import { dataHora, Falha } from './comum'
import { Cartao, Pagina, type HeadDef } from './visao/layout'
import { n } from './visao/usar'

interface Tarefa {
  id: string
  rotulo: string
  detalhe: string
  global: string | null
}
type Provedor = 'openai' | 'anthropic'
const NOME_PROVEDOR: Record<Provedor, string> = { openai: 'OpenAI', anthropic: 'Anthropic (Claude)' }
interface EmUso {
  origem: 'banco' | 'ambiente' | 'nenhuma'
  nome: string | null
}
interface Chave {
  id: string
  provedor: Provedor
  nome: string
  ultimos4: string
  ativa: boolean
  testada_em: string | null
}
interface ModeloCliente {
  user_id: string
  nome: string
  negocio: string
  tarefa: string
  modelo: string
}
interface Config {
  pronto: boolean
  segredo: boolean
  fabrica: Record<string, string>
  tarefas: Tarefa[]
  chaves: Chave[]
  clientes: ModeloCliente[]
  chave_em_uso: 'banco' | 'ambiente'
  chave_em_uso_nome?: string | null
  em_uso: { openai: EmUso; anthropic: EmUso }
}
interface ClienteBusca {
  id: string
  nome: string
  negocio: string
}

const CAIXA = { display: 'grid', gap: 10 } as const

/** Aba Configurações: qual modelo de IA responde cada tarefa (para todos ou só para um cliente) e qual chave de API o servidor usa. */
export function Configuracoes() {
  const [d, setD] = useState<Config | null>(null)
  const [erro, setErro] = useState('')
  const [recado, setRecado] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState('')
  const [rascunho, setRascunho] = useState<Record<string, string>>({})
  // modelo individual
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ClienteBusca[]>([])
  const [cliente, setCliente] = useState<ClienteBusca | null>(null)
  const [tarefaCli, setTarefaCli] = useState('interpretacao')
  const [modeloCli, setModeloCli] = useState('')
  // chave
  const [provedorChave, setProvedorChave] = useState<Provedor>('openai')
  const [nomeChave, setNomeChave] = useState('')
  const [valorChave, setValorChave] = useState('')
  const [confirmaRemover, setConfirmaRemover] = useState('')

  const recarregar = useCallback(async () => {
    try {
      setD(await api<Config>('/admin/ia'))
      setErro('')
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void recarregar()
  }, [recarregar])

  // Busca de cliente com um pequeno atraso: não chama o banco a cada tecla.
  useEffect(() => {
    if (cliente || busca.trim().length < 2) return setAchados([])
    const t = setTimeout(() => {
      rpc<ClienteBusca[]>('admin_clientes', { p_busca: busca.trim(), p_situacao: '' })
        .then((l) => setAchados(l.slice(0, 6)))
        .catch(() => setAchados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [busca, cliente])

  /** Roda uma operação, mostra o resultado e recarrega. O servidor só salva depois de TESTAR; se recusar, a mensagem diz por quê. */
  const fazer = async (chave: string, caminho: string, corpo: Record<string, unknown>, sucesso: string, depois?: () => void) => {
    setOcupado(chave)
    setRecado(null)
    try {
      await api(caminho, { method: 'POST', body: JSON.stringify(corpo) })
      setRecado({ ok: true, texto: sucesso })
      depois?.()
      await recarregar()
    } catch (e) {
      setRecado({ ok: false, texto: (e as Error).message })
    } finally {
      setOcupado('')
    }
  }

  if (erro) return <Pagina titulo="Configurações" heads={[]}><Falha texto={erro} /></Pagina>
  if (!d) return <Pagina titulo="Configurações" subtitulo="Modelo de IA e chave de API" heads={[]}><div className="skel" style={{ height: 220 }} /></Pagina>

  const personalizadas = d.tarefas.filter((t) => t.global).length
  const heads: HeadDef[] = [
    { rotulo: 'Chave da OpenAI em uso', valor: d.em_uso.openai.origem === 'banco' ? d.em_uso.openai.nome || 'Cadastrada aqui' : 'Do servidor', nota: d.em_uso.openai.origem === 'banco' ? 'cadastrada nesta tela' : 'a de sempre (variável do ambiente)', texto: true },
    { rotulo: 'Tarefas com modelo seu', valor: n(personalizadas), nota: `de ${n(d.tarefas.length)}; as outras usam o padrão` },
    { rotulo: 'Clientes com modelo próprio', valor: n(new Set(d.clientes.map((c) => c.user_id)).size), nota: 'valem no lugar do modelo de todos' },
  ]
  const nomeTarefa = (id: string) => d.tarefas.find((t) => t.id === id)?.rotulo ?? id

  return (
    <Pagina titulo="Configurações" subtitulo="Escolha o modelo de IA e a chave de API. Nada é salvo sem testar antes, e se algo falhar a Granninha volta sozinha ao padrão." heads={heads} quantos={3}>
      {recado && (
        <div className={`vaviso ${recado.ok ? 'bom' : 'ruim'}`} role={recado.ok ? 'status' : 'alert'} style={{ marginBottom: 12 }}>
          <span>{recado.texto}</span>
        </div>
      )}
      {!d.pronto && (
        <div className="vaviso ruim" role="alert" style={{ marginBottom: 12 }}>
          <span>
            Falta criar as tabelas desta tela no banco. Rode no terminal: <code>! /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar configia</code>. Enquanto isso a Granninha segue com o modelo e a chave de sempre.
          </span>
        </div>
      )}

      <Cartao g={14}>
        <div className="cartao-cab"><h2>Modelo para todos os clientes</h2></div>
        <p className="texto-ajuda" style={{ margin: 0 }}>
          Cada tarefa pode usar um modelo diferente. O padrão de fábrica é o que está valendo hoje. Ao salvar, o modelo é testado de verdade; se for recusado, nada muda. Se um modelo escolhido falhar depois, a Granninha usa o padrão na hora e a pessoa nem percebe.
        </p>
        <p className="texto-ajuda" style={{ margin: 0 }}>
          Modelos que começam com <b>claude</b> (por exemplo <code>claude-sonnet-5-5</code>) usam a Anthropic e pedem uma chave da Anthropic cadastrada abaixo. Qualquer outro nome usa a OpenAI. Áudio só funciona com a OpenAI.
        </p>
        {d.tarefas.some((t) => (t.global ?? '').toLowerCase().startsWith('claude')) || d.clientes.some((c) => c.modelo.toLowerCase().startsWith('claude')) ? (
          <div className="vaviso ruim" role="status">
            <span>Atenção: o custo mostrado na Visão geral usa o preço do modelo padrão. Com modelos Claude o custo real é maior do que o número exibido até a conta por modelo ser feita.</span>
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 14 }}>
          {d.tarefas.map((t) => {
            const valor = rascunho[t.id] ?? t.global ?? ''
            return (
              <div key={t.id} className="item-ob" style={CAIXA}>
                <div>
                  <b>{t.rotulo}</b> <small className="suave">{t.detalhe}</small>
                </div>
                <small className="suave">
                  Hoje: <b>{t.global ?? d.fabrica[t.id]}</b> ({t.global ? 'escolhido por você' : 'padrão de fábrica'})
                </small>
                <label className="campo">
                  <span>Modelo</span>
                  <input
                    className="entrada"
                    value={valor}
                    onChange={(e) => setRascunho({ ...rascunho, [t.id]: e.target.value.replace(/\s/g, '') })}
                    placeholder={d.fabrica[t.id]}
                    aria-label={`Modelo para ${t.rotulo}`}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-pri"
                    disabled={!d.pronto || !valor.trim() || valor.trim() === (t.global ?? '') || ocupado !== ''}
                    onClick={() => fazer('m-' + t.id, '/admin/ia/modelo', { tarefa: t.id, modelo: valor.trim() }, `${t.rotulo}: agora usa ${valor.trim()}. Vale já na próxima mensagem.`, () => setRascunho((r) => ({ ...r, [t.id]: '' })))}
                  >
                    {ocupado === 'm-' + t.id ? 'Testando…' : 'Testar e salvar'}
                  </button>
                  {t.global && (
                    <button
                      type="button"
                      className="btn btn-sec"
                      disabled={ocupado !== ''}
                      onClick={() => fazer('p-' + t.id, '/admin/ia/modelo', { tarefa: t.id, modelo: null }, `${t.rotulo}: voltou ao padrão (${d.fabrica[t.id]}).`, () => setRascunho((r) => ({ ...r, [t.id]: '' })))}
                    >
                      Voltar ao padrão
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Cartao>

      <Cartao g={14}>
        <div className="cartao-cab"><h2>Modelo só para um cliente</h2></div>
        <p className="texto-ajuda" style={{ margin: 0 }}>
          Dá um modelo diferente a UM cliente em uma tarefa (por exemplo, um modelo mais inteligente para ler os comprovantes de um cliente importante). Vale no lugar do modelo de todos e não afeta ninguém mais.
        </p>
        {d.clientes.length > 0 && (
          <div className="linhas">
            {d.clientes.map((c) => (
              <div className="cl-l" key={c.user_id + c.tarefa} style={{ cursor: 'default', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
                <div className="cl-id">
                  <b>
                    {c.nome || 'Cliente'} {c.negocio ? `· ${c.negocio}` : ''}
                  </b>
                  <span className="s">
                    {nomeTarefa(c.tarefa)}: <b>{c.modelo}</b>
                  </span>
                </div>
                <button type="button" className="btn btn-txt" disabled={ocupado !== ''} onClick={() => fazer('c-' + c.user_id + c.tarefa, '/admin/ia/cliente', { user_id: c.user_id, tarefa: c.tarefa, modelo: null }, `${c.nome || 'Cliente'}: voltou ao modelo de todos em ${nomeTarefa(c.tarefa)}.`)}>
                  Tirar
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="item-ob" style={CAIXA}>
          <label className="campo">
            <span>Cliente</span>
            {cliente ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <b>
                  {cliente.nome} {cliente.negocio ? `· ${cliente.negocio}` : ''}
                </b>
                <button type="button" className="btn btn-txt" onClick={() => { setCliente(null); setBusca('') }}>
                  Trocar
                </button>
              </div>
            ) : (
              <input className="entrada" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Busque por nome, negócio ou e-mail" aria-label="Buscar cliente" />
            )}
          </label>
          {!cliente && achados.length > 0 && (
            <div className="linhas">
              {achados.map((a) => (
                <button key={a.id} type="button" className="cl-l" style={{ textAlign: 'left' }} onClick={() => { setCliente(a); setAchados([]) }}>
                  <div className="cl-id">
                    <b>{a.nome || 'Sem nome'}</b>
                    <span className="s">{a.negocio}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <label className="campo">
            <span>Tarefa</span>
            <select className="entrada" value={tarefaCli} onChange={(e) => setTarefaCli(e.target.value)} aria-label="Tarefa do modelo individual">
              {d.tarefas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Modelo</span>
            <input className="entrada" value={modeloCli} onChange={(e) => setModeloCli(e.target.value.replace(/\s/g, ''))} placeholder={d.fabrica[tarefaCli]} aria-label="Modelo individual" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <div>
            <button
              type="button"
              className="btn btn-pri"
              disabled={!d.pronto || !cliente || !modeloCli.trim() || ocupado !== ''}
              onClick={() => fazer('cli', '/admin/ia/cliente', { user_id: cliente!.id, tarefa: tarefaCli, modelo: modeloCli.trim() }, `${cliente!.nome}: agora usa ${modeloCli.trim()} em ${nomeTarefa(tarefaCli)}.`, () => { setModeloCli(''); setCliente(null); setBusca('') })}
            >
              {ocupado === 'cli' ? 'Testando…' : 'Testar e salvar'}
            </button>
          </div>
        </div>
      </Cartao>

      <Cartao g={14}>
        <div className="cartao-cab"><h2>Chave de API</h2></div>
        <p className="texto-ajuda" style={{ margin: 0 }}>
          Chaves da OpenAI e da Anthropic. Cada chave é testada, guardada cifrada e nasce <b>desligada</b>: você liga quando quiser, uma por provedor. Se a chave ligada da OpenAI for recusada, a Granninha volta sozinha à chave do servidor; se a da Anthropic falhar, a conversa cai no modelo padrão da OpenAI.
        </p>
        {!d.segredo && (
          <div className="vaviso ruim" role="alert">
            <span>O servidor ainda não tem o segredo para cifrar chaves (variável <code>IA_SEGREDO</code> na Coolify, com pelo menos 16 caracteres). Sem ele não dá para cadastrar chave por aqui.</span>
          </div>
        )}
        <div className="item-ob" style={CAIXA}>
          {(['openai', 'anthropic'] as const).map((p) => (
            <small className="suave" key={p}>
              {NOME_PROVEDOR[p]}:{' '}
              <b>
                {d.em_uso[p].origem === 'banco' ? `chave "${d.em_uso[p].nome}" (cadastrada aqui)` : d.em_uso[p].origem === 'ambiente' ? 'chave do servidor' : 'nenhuma chave (modelos Claude caem no padrão)'}
              </b>
            </small>
          ))}
        </div>
        {d.chaves.length > 0 && (
          <div className="linhas">
            {d.chaves.map((k) => (
              <div className="cl-l" key={k.id} style={{ cursor: 'default', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
                <div className="cl-id">
                  <b>
                    <KeyRound size={14} style={{ verticalAlign: -2 }} /> {k.nome} · ••••{k.ultimos4}
                  </b>
                  <span className="s">
                    {NOME_PROVEDOR[k.provedor ?? 'openai']} · {k.ativa ? 'EM USO' : 'desligada'} · testada {dataHora(k.testada_em)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className={`btn ${k.ativa ? 'btn-sec' : 'btn-pri'}`} disabled={ocupado !== ''} onClick={() => fazer('k-' + k.id, '/admin/ia/chave/ativar', { id: k.id, ativa: !k.ativa }, k.ativa ? `Chave ${k.nome} desligada: voltou a valer a do servidor.` : `Chave ${k.nome} ligada: vale já na próxima mensagem.`)}>
                    {ocupado === 'k-' + k.id ? 'Testando…' : k.ativa ? 'Desligar' : 'Ligar'}
                  </button>
                  {confirmaRemover === k.id ? (
                    <button type="button" className="btn btn-perigo" disabled={ocupado !== ''} onClick={() => fazer('r-' + k.id, '/admin/ia/chave/remover', { id: k.id }, `Chave ${k.nome} removida.`, () => setConfirmaRemover(''))}>
                      Sim, remover{k.ativa ? ' (está em uso)' : ''}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-txt" aria-label={`Remover a chave ${k.nome}`} onClick={() => setConfirmaRemover(k.id)}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <form
          className="item-ob"
          style={CAIXA}
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void fazer('nova', '/admin/ia/chave', { provedor: provedorChave, nome: nomeChave.trim(), chave: valorChave.trim() }, `Chave ${nomeChave.trim()} testada e guardada, desligada. Ligue quando quiser usar.`, () => { setNomeChave(''); setValorChave('') })
          }}
        >
          <b>Cadastrar uma chave nova</b>
          <label className="campo">
            <span>Provedor</span>
            <select className="entrada" value={provedorChave} onChange={(e) => setProvedorChave(e.target.value as Provedor)} aria-label="Provedor da chave">
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </label>
          <label className="campo">
            <span>Nome (só para você reconhecer)</span>
            <input className="entrada" value={nomeChave} onChange={(e) => setNomeChave(e.target.value)} maxLength={60} placeholder="Ex.: OpenAI da agência" aria-label="Nome da chave" />
          </label>
          <label className="campo">
            <span>Chave</span>
            <input className="entrada" type="password" autoComplete="off" value={valorChave} onChange={(e) => setValorChave(e.target.value)} placeholder="Cole a chave inteira" aria-label="Chave de API" />
          </label>
          <div>
            <button type="submit" className="btn btn-pri" disabled={!d.pronto || !d.segredo || !nomeChave.trim() || valorChave.trim().length < 20 || ocupado !== ''}>
              {ocupado === 'nova' ? 'Testando…' : 'Testar e guardar'}
            </button>
          </div>
          <small className="suave">A chave nunca volta para a tela: depois de guardada, só aparecem os 4 últimos caracteres.</small>
        </form>
      </Cartao>
    </Pagina>
  )
}
