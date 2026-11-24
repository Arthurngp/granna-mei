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

/** Modelos sugeridos no dropdown. Qualquer outro nome vale ("Outro"): ele é testado de verdade antes de ser salvo. */
const SUGESTOES: { grupo: string; modelos: string[]; audio?: boolean }[] = [
  { grupo: 'OpenAI', modelos: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'] },
  { grupo: 'Anthropic (Claude)', modelos: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'] },
  { grupo: 'Transcrição de áudio (OpenAI)', modelos: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'], audio: true },
]
const gruposDe = (tarefa: string) => SUGESTOES.filter((g) => (tarefa === 'audio' ? g.audio : !g.audio))

/** Dropdown de modelo: "" = padrão de fábrica; lista sugerida; "Outro" abre um campo para digitar qualquer nome. */
function ModeloCampo({ tarefa, valor, padrao, onChange, rotulo, desabilitado }: { tarefa: string; valor: string; padrao: string; onChange: (v: string) => void; rotulo: string; desabilitado?: boolean }) {
  const conhecidos = gruposDe(tarefa).flatMap((g) => g.modelos)
  const [outro, setOutro] = useState(valor !== '' && !conhecidos.includes(valor))
  const modoOutro = outro || (valor !== '' && !conhecidos.includes(valor))
  return (
    <div className="cfg-modelo">
      <select
        className="entrada"
        aria-label={rotulo}
        disabled={desabilitado}
        value={modoOutro ? '__outro' : valor}
        onChange={(e) => {
          if (e.target.value === '__outro') {
            setOutro(true)
            onChange('')
            return
          }
          setOutro(false)
          onChange(e.target.value)
        }}
      >
        <option value="">Padrão de fábrica ({padrao})</option>
        {gruposDe(tarefa).map((g) => (
          <optgroup key={g.grupo} label={g.grupo}>
            {g.modelos.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__outro">Outro (digitar o nome)…</option>
      </select>
      {modoOutro && (
        <input
          className="entrada"
          aria-label={`${rotulo}: nome do modelo`}
          value={valor}
          onChange={(e) => onChange(e.target.value.replace(/\s/g, ''))}
          placeholder="Ex.: claude-sonnet-5-5"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
      )}
    </div>
  )
}

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

  /** Apaga o rascunho da tarefa: o dropdown volta a mostrar o que está salvo (um '' aqui seria lido como "padrão"). */
  const limparRascunho = (id: string) =>
    setRascunho((r) => {
      const { [id]: _descartado, ...resto } = r
      return resto
    })

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
      <div className="cfg-pagina">
        {recado && (
          <div className={`vaviso ${recado.ok ? 'bom' : 'ruim'} cfg-largo`} role={recado.ok ? 'status' : 'alert'}>
            <span>{recado.texto}</span>
          </div>
        )}
        {!d.pronto && (
          <div className="vaviso ruim cfg-largo" role="alert">
            <span>
              Falta criar as tabelas desta tela no banco. Rode no terminal: <code>! /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar configia</code>. Enquanto isso a Granninha segue com o modelo e a chave de sempre.
            </span>
          </div>
        )}

        <Cartao g={12} className="cfg-largo">
          <div className="cartao-cab">
            <h2>Modelo para todos os clientes</h2>
          </div>
          <p className="texto-ajuda cfg-texto" style={{ margin: '0 0 6px' }}>
            Escolha o modelo de cada tarefa. Ao salvar, ele é testado de verdade; se for recusado, nada muda, e se falhar depois a Granninha usa o padrão na hora, sem a pessoa perceber. Modelos <b>claude</b> usam a Anthropic (pedem uma chave dela, mais abaixo); áudio só funciona com a OpenAI.
          </p>
          {d.tarefas.some((t) => (t.global ?? '').toLowerCase().startsWith('claude')) || d.clientes.some((c) => c.modelo.toLowerCase().startsWith('claude')) ? (
            <div className="vaviso ruim" role="status">
              <span>Atenção: o custo mostrado na Visão geral usa o preço do modelo padrão. Com modelos Claude o custo real é maior do que o número exibido até a conta por modelo ser feita.</span>
            </div>
          ) : null}
          <div className="cfg-linhas">
            {d.tarefas.map((t) => {
              const valor = rascunho[t.id] ?? t.global ?? ''
              const mudou = valor !== (t.global ?? '')
              const ocupadoAqui = ocupado === 'm-' + t.id
              return (
                <div key={t.id} className="cfg-linha">
                  <div className="cfg-tarefa">
                    <b>{t.rotulo}</b>
                    <small className="suave">{t.detalhe}</small>
                    <small className="suave">
                      Hoje: <b>{t.global ?? d.fabrica[t.id]}</b> ({t.global ? 'escolhido por você' : 'padrão de fábrica'})
                    </small>
                  </div>
                  <ModeloCampo key={t.id + (t.global ?? '')} tarefa={t.id} valor={valor} padrao={d.fabrica[t.id]} rotulo={`Modelo para ${t.rotulo}`} desabilitado={ocupado !== ''} onChange={(v) => setRascunho({ ...rascunho, [t.id]: v })} />
                  <button
                    type="button"
                    className="btn btn-pri cfg-botao"
                    disabled={!d.pronto || !mudou || ocupado !== ''}
                    onClick={() =>
                      valor === ''
                        ? fazer('m-' + t.id, '/admin/ia/modelo', { tarefa: t.id, modelo: null }, `${t.rotulo}: voltou ao padrão (${d.fabrica[t.id]}).`, () => limparRascunho(t.id))
                        : fazer('m-' + t.id, '/admin/ia/modelo', { tarefa: t.id, modelo: valor.trim() }, `${t.rotulo}: agora usa ${valor.trim()}. Vale já na próxima mensagem.`, () => limparRascunho(t.id))
                    }
                  >
                    {ocupadoAqui ? 'Testando…' : valor === '' ? 'Voltar ao padrão' : 'Testar e salvar'}
                  </button>
                </div>
              )
            })}
          </div>
        </Cartao>

        <Cartao g={6}>
          <div className="cartao-cab">
            <h2>Modelo só para um cliente</h2>
          </div>
          <p className="texto-ajuda cfg-texto" style={{ margin: 0 }}>
            Dá um modelo diferente a UM cliente em uma tarefa (por exemplo, um modelo mais inteligente para ler os comprovantes de um cliente importante). Vale no lugar do modelo de todos e não afeta ninguém mais.
          </p>
          {d.clientes.length > 0 && (
            <div className="linhas">
              {d.clientes.map((c) => (
                <div className="cl-l" key={c.user_id + c.tarefa} style={{ cursor: 'default', gridTemplateColumns: 'minmax(0,1fr) auto' }}>
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
          <div className="cfg-form">
            <label className="campo">
              <span>Cliente</span>
              {cliente ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
                  <button key={a.id} type="button" className="cl-l" style={{ textAlign: 'left', gridTemplateColumns: 'minmax(0,1fr)' }} onClick={() => { setCliente(a); setAchados([]) }}>
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
              <select className="entrada" value={tarefaCli} onChange={(e) => { setTarefaCli(e.target.value); setModeloCli('') }} aria-label="Tarefa do modelo individual">
                {d.tarefas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <div className="campo">
              <span>Modelo</span>
              <ModeloCampo key={tarefaCli} tarefa={tarefaCli} valor={modeloCli} padrao={d.fabrica[tarefaCli]} rotulo="Modelo individual" onChange={setModeloCli} />
            </div>
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

        <Cartao g={6}>
          <div className="cartao-cab">
            <h2>Chave de API</h2>
          </div>
          <p className="texto-ajuda cfg-texto" style={{ margin: 0 }}>
            Chaves da OpenAI e da Anthropic. Cada chave é testada, guardada cifrada e nasce <b>desligada</b>: você liga quando quiser, uma por provedor. Se a chave ligada da OpenAI for recusada, a Granninha volta sozinha à chave do servidor; se a da Anthropic falhar, a conversa cai no modelo padrão da OpenAI.
          </p>
          {!d.segredo && (
            <div className="vaviso ruim" role="alert">
              <span>O servidor não tem como cifrar chaves (defina <code>IA_SEGREDO</code> na Coolify, com pelo menos 16 caracteres). Sem isso não dá para cadastrar chave por aqui.</span>
            </div>
          )}
          <div className="cfg-uso">
            {(['openai', 'anthropic'] as const).map((p) => (
              <small className="suave" key={p}>
                {NOME_PROVEDOR[p]}:{' '}
                <b>{d.em_uso[p].origem === 'banco' ? `chave "${d.em_uso[p].nome}" (cadastrada aqui)` : d.em_uso[p].origem === 'ambiente' ? 'chave do servidor' : 'nenhuma chave (modelos Claude caem no padrão)'}</b>
              </small>
            ))}
          </div>
          {d.chaves.length > 0 && (
            <div className="linhas">
              {d.chaves.map((k) => (
                <div className="cl-l" key={k.id} style={{ cursor: 'default', alignItems: 'center', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
                  <div className="cl-id">
                    <b>
                      <KeyRound size={14} style={{ verticalAlign: -2 }} /> {k.nome} · ••••{k.ultimos4}
                    </b>
                    <span className="s">
                      {NOME_PROVEDOR[k.provedor ?? 'openai']} · {k.ativa ? 'EM USO' : 'desligada'} · testada {dataHora(k.testada_em)}
                    </span>
                  </div>
                  <div className="cfg-acoes">
                    <button type="button" className={`btn ${k.ativa ? 'btn-sec' : 'btn-pri'}`} disabled={ocupado !== ''} onClick={() => fazer('k-' + k.id, '/admin/ia/chave/ativar', { id: k.id, ativa: !k.ativa }, k.ativa ? `Chave ${k.nome} desligada.` : `Chave ${k.nome} ligada: vale já na próxima mensagem.`)}>
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
            className="cfg-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              void fazer('nova', '/admin/ia/chave', { provedor: provedorChave, nome: nomeChave.trim(), chave: valorChave.trim() }, `Chave ${nomeChave.trim()} testada e guardada, desligada. Ligue quando quiser usar.`, () => { setNomeChave(''); setValorChave('') })
            }}
          >
            <b>Cadastrar uma chave nova</b>
            <div className="cfg-dupla">
              <label className="campo">
                <span>Provedor</span>
                <select className="entrada" value={provedorChave} onChange={(e) => setProvedorChave(e.target.value as Provedor)} aria-label="Provedor da chave">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </select>
              </label>
              <label className="campo">
                <span>Nome (só para você reconhecer)</span>
                <input className="entrada" value={nomeChave} onChange={(e) => setNomeChave(e.target.value)} maxLength={60} placeholder="Ex.: Claude da agência" aria-label="Nome da chave" />
              </label>
            </div>
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
      </div>
    </Pagina>
  )
}
