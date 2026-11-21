import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Mascote } from '../../src/components/ui'
import { MOCK, sb, rpc } from './sb'
import { Auditoria } from './telas/Auditoria'
import { Clientes } from './telas/Clientes'
import { Granninha } from './telas/Granninha'
import { SlotCtx } from './telas/visao/layout'
import { Visao } from './telas/Visao'

type Etapa = 'carregando' | 'entrar' | 'sem-acesso' | 'ativar-2fa' | 'codigo-2fa' | 'dentro'
type Aba = 'visao' | 'clientes' | 'granninha' | 'auditoria'

export default function App() {
  const [etapa, setEtapa] = useState<Etapa>('carregando')
  const [aba, setAba] = useState<Aba>('visao')
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  /** Decide a etapa: sem login → entrar; não é admin → sem acesso; sem 2ª etapa → ativar ou pedir código. */
  const avaliar = useCallback(async () => {
    if (MOCK) return setEtapa('dentro')
    const { data } = await sb.auth.getSession()
    if (!data.session) return setEtapa('entrar')
    const admin = await rpc<boolean>('admin_papel').catch(() => false)
    if (!admin) return setEtapa('sem-acesso')
    const n = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
    if (n.data?.currentLevel === 'aal2') return setEtapa('dentro')
    const f = await sb.auth.mfa.listFactors()
    setEtapa(f.data?.totp?.some((x) => x.status === 'verified') ? 'codigo-2fa' : 'ativar-2fa')
  }, [])

  useEffect(() => {
    void avaliar()
  }, [avaliar])

  const sair = async () => {
    await sb.auth.signOut()
    setEtapa('entrar')
  }

  if (etapa === 'carregando') return <Centro><LoaderCircle className="gira" size={28} /></Centro>
  if (etapa === 'entrar') return <Entrar pronto={avaliar} />
  if (etapa === 'sem-acesso')
    return (
      <Centro>
        <Mascote pose="escudo" tam={120} />
        <h1 style={{ fontSize: 22 }}>Esta conta não é de admin</h1>
        <p className="suave">O painel admin é só para a equipe da Granninha.</p>
        <button type="button" className="btn btn-sec" onClick={sair}>
          Sair
        </button>
      </Centro>
    )
  if (etapa === 'ativar-2fa' || etapa === 'codigo-2fa') return <SegundaEtapa ativar={etapa === 'ativar-2fa'} pronto={avaliar} sair={sair} />

  return (
    <div>
      <div className="cabeca larga">
        <header className="adm-topo">
          <div className="linha1">
            <img src={`${import.meta.env.BASE_URL}logo-96.png`} alt="" />
            <div className="cresce">
              <b>Granninha</b> <small>Admin{MOCK ? ' · dados de exemplo' : ''}</small>
            </div>
            <button type="button" onClick={sair}>
              Sair
            </button>
          </div>
          <nav className="adm-abas" aria-label="Seções">
            {(
              [
                ['visao', 'Visão geral'],
                ['clientes', 'Clientes'],
                ['granninha', 'Granninha'],
                ['auditoria', 'Auditoria'],
              ] as const
            ).map(([v, r]) => (
              <button key={v} type="button" aria-pressed={aba === v} onClick={() => setAba(v)}>
                {r}
              </button>
            ))}
          </nav>
        </header>
        <div ref={setSlot} />
      </div>
      <SlotCtx.Provider value={slot}>
      <main className="adm-conteudo larga">
        {aba === 'visao' && <Visao />}
        {aba === 'clientes' && <Clientes />}
        {aba === 'granninha' && <Granninha />}
        {aba === 'auditoria' && <Auditoria />}
      </main>
      </SlotCtx.Provider>
    </div>
  )
}

function Centro({ children }: { children: React.ReactNode }) {
  return (
    <div className="bloq">
      <div>{children}</div>
    </div>
  )
}

function Entrar({ pronto }: { pronto: () => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setErro('')
    setOcupado(true)
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha })
    setOcupado(false)
    if (error) return setErro('E-mail ou senha não conferem.')
    pronto()
  }
  return (
    <Centro>
      <img src={`${import.meta.env.BASE_URL}logo-192.png`} alt="Granninha" style={{ width: 72, height: 72, borderRadius: '50%' }} />
      <h1 style={{ fontSize: 24 }}>Admin da Granninha</h1>
      <form className="card pilha" onSubmit={enviar} noValidate>
        <label className="campo">
          <span>E-mail</span>
          <input className="entrada" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="campo">
          <span>Senha</span>
          <input className="entrada" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <small className="erro" role="alert" style={{ color: 'var(--out)' }}>{erro}</small>}
        <button className="btn btn-pri btn-bloco" type="submit" disabled={ocupado}>
          {ocupado && <LoaderCircle size={18} className="gira" />}
          Entrar
        </button>
      </form>
    </Centro>
  )
}

/** Segunda etapa obrigatória: código do aplicativo autenticador (Google Authenticator, 1Password etc.). */
function SegundaEtapa({ ativar, pronto, sair }: { ativar: boolean; pronto: () => void; sair: () => void }) {
  const [fator, setFator] = useState<{ id: string; qr: string; segredo: string } | null>(null)
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (!ativar) return
    void (async () => {
      // Limpa tentativas de cadastro que ficaram pela metade antes de criar uma nova.
      const f = await sb.auth.mfa.listFactors()
      for (const x of f.data?.all ?? []) if (x.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: x.id })
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Admin Granninha' })
      if (error || !data) return setErro('Não consegui iniciar a segunda etapa: ' + (error?.message ?? ''))
      setFator({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret })
    })()
  }, [ativar])

  const confirmar = async (e: FormEvent) => {
    e.preventDefault()
    setErro('')
    setOcupado(true)
    let id = fator?.id
    if (!id) {
      const f = await sb.auth.mfa.listFactors()
      id = f.data?.totp?.find((x) => x.status === 'verified')?.id
    }
    if (!id) {
      setOcupado(false)
      return setErro('Nenhum autenticador encontrado.')
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: id, code: codigo.trim() })
    setOcupado(false)
    if (error) return setErro('Código não confere. Confira a hora do celular e tente o código novo.')
    pronto()
  }

  return (
    <Centro>
      <ShieldCheck size={44} color="var(--indigo)" />
      <h1 style={{ fontSize: 22 }}>{ativar ? 'Ative a segunda etapa' : 'Código do autenticador'}</h1>
      <p className="suave">
        {ativar ? 'O admin pede o código de um aplicativo autenticador. Leia o QR com o Google Authenticator, 1Password ou parecido.' : 'Digite os 6 números que aparecem no seu aplicativo autenticador.'}
      </p>
      <form className="card pilha" onSubmit={confirmar} noValidate>
        {ativar && fator && (
          <div className="qr">
            <img src={fator.qr} alt="QR do autenticador" />
            <small className="suave" style={{ wordBreak: 'break-all', textAlign: 'center' }}>
              Sem câmera? Digite a chave: {fator.segredo}
            </small>
          </div>
        )}
        <label className="campo">
          <span>Código de 6 números</span>
          <input className="entrada num" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
        </label>
        {erro && <small role="alert" style={{ color: 'var(--out)' }}>{erro}</small>}
        <button className="btn btn-pri btn-bloco" type="submit" disabled={ocupado || codigo.length !== 6}>
          {ocupado && <LoaderCircle size={18} className="gira" />}
          Confirmar
        </button>
        <button type="button" className="btn btn-txt" onClick={sair}>
          Sair
        </button>
      </form>
    </Centro>
  )
}
