import { Eye, EyeOff, MessageCircle } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Codigo, Mascote, Seg, useAviso, type Pose } from '../components/ui'
import { PRECO_MENSAL } from '../lib/config'
import { brl, mascaraFone } from '../lib/format'
import { useApp } from '../lib/store'

function Tela({ titulo, sub, pose, children }: { titulo: string; sub: string; pose: Pose; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-topo">
        <img className="logo" src="/logo-192.png" alt="Granna Mei" />
        <h1>{titulo}</h1>
        <p>{sub}</p>
        <div className="auth-palco">
          <div className="disco" />
          <Mascote pose={pose} anim="flutua" />
        </div>
      </div>
      <div className="auth-caixa">
        {children}
        <div className="assinatura-amp">
          Desenvolvido por{' '}
          <a href="https://grupongp.com.br" target="_blank" rel="noopener noreferrer">
            Amplasoft — Grupo NGP
          </a>
        </div>
      </div>
    </div>
  )
}

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim())

function CampoSenha({ valor, onChange, rotulo, dica, auto }: { valor: string; onChange: (v: string) => void; rotulo: string; dica?: string; auto: string }) {
  const [ver, setVer] = useState(false)
  return (
    <label className="campo">
      <span>{rotulo}</span>
      <div style={{ position: 'relative' }}>
        <input className="entrada" type={ver ? 'text' : 'password'} autoComplete={auto} value={valor} onChange={(e) => onChange(e.target.value)} style={{ paddingRight: 48 }} />
        <button type="button" className="icone-btn" style={{ position: 'absolute', right: 4, top: 4 }} aria-label={ver ? 'Esconder senha' : 'Mostrar senha'} onClick={() => setVer(!ver)}>
          {ver ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
      {dica && <small>{dica}</small>}
    </label>
  )
}

export function Entrar() {
  const { entrarDemo } = useApp()
  const avisar = useAviso()
  const [modo, setModo] = useState<'senha' | 'whats'>('senha')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [fone, setFone] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')

  const foneOk = fone.replace(/\D/g, '').length >= 10

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    setErro('')
    if (modo === 'senha') {
      if (!emailOk(email)) return setErro('Confira o e-mail: parece incompleto.')
      if (senha.length < 6) return setErro('A senha tem pelo menos 6 caracteres.')
      entrarDemo()
    } else if (!enviado) {
      if (!foneOk) return setErro('Digite o WhatsApp com DDD.')
      setEnviado(true)
    } else {
      if (codigo.length < 6) return setErro('O código tem 6 números.')
      entrarDemo()
    }
  }

  return (
    <Tela titulo="O dinheiro do seu MEI em dia, pelo WhatsApp" sub="Você conversa com a Granninha e ela organiza tudo." pose="hero">
      <h2>Entrar</h2>
      <Seg
        bloco
        valor={modo}
        onChange={(m) => {
          setModo(m)
          setErro('')
        }}
        opcoes={[
          { v: 'senha', r: 'E-mail e senha' },
          { v: 'whats', r: 'Código no WhatsApp' },
        ]}
      />
      <form className="pilha" onSubmit={enviar} noValidate>
        {modo === 'senha' ? (
          <>
            <label className="campo">
              <span>E-mail</span>
              <input className="entrada" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
            </label>
            <CampoSenha valor={senha} onChange={setSenha} rotulo="Senha" auto="current-password" />
          </>
        ) : !enviado ? (
          <label className="campo">
            <span>Seu WhatsApp</span>
            <input className="entrada num" type="tel" inputMode="tel" autoComplete="tel-national" value={fone} onChange={(e) => setFone(mascaraFone(e.target.value))} placeholder="(81) 90000-0000" />
            <small>A Granninha manda um código de 6 números para você entrar sem senha.</small>
          </label>
        ) : (
          <div className="campo">
            <span>Código enviado para {fone}</span>
            <Codigo valor={codigo} onChange={setCodigo} />
            <small>
              Não chegou?{' '}
              <button type="button" style={{ fontWeight: 700, color: 'var(--indigo)' }} onClick={() => avisar('Código reenviado no seu WhatsApp')}>
                Reenviar
              </button>{' '}
              ou{' '}
              <button
                type="button"
                style={{ fontWeight: 700, color: 'var(--indigo)' }}
                onClick={() => {
                  setEnviado(false)
                  setCodigo('')
                }}
              >
                trocar o número
              </button>
            </small>
          </div>
        )}
        {erro && (
          <div className="campo" role="alert">
            <small className="erro">{erro}</small>
          </div>
        )}
        <button className={`btn btn-bloco ${modo === 'whats' && !enviado ? 'btn-wa' : 'btn-pri'}`} type="submit">
          {modo === 'whats' && !enviado ? (
            <>
              <MessageCircle size={19} />
              Receber código
            </>
          ) : (
            'Entrar'
          )}
        </button>
        {modo === 'senha' && (
          <button type="button" className="btn btn-txt" onClick={() => (emailOk(email) ? avisar('Enviamos um link para criar uma senha nova') : setErro('Digite seu e-mail acima para receber o link.'))}>
            Esqueci minha senha
          </button>
        )}
      </form>
      <p className="auth-troca">
        Ainda não tem conta? <Link to="/criar-conta">Teste grátis por 7 dias</Link>
      </p>
      <p className="nota-demo">Demonstração: qualquer e-mail, senha ou código abre a conta de exemplo.</p>
    </Tela>
  )
}

export function CriarConta() {
  const { criarConta } = useApp()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [aceito, setAceito] = useState(false)
  const [erro, setErro] = useState('')

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (nome.trim().length < 2) return setErro('Como podemos te chamar?')
    if (!emailOk(email)) return setErro('Confira o e-mail: parece incompleto.')
    if (senha.length < 6) return setErro('Crie uma senha com pelo menos 6 caracteres.')
    if (!aceito) return setErro('Marque que você concorda com os termos para continuar.')
    criarConta(nome.trim(), email.trim())
  }

  return (
    <Tela titulo="7 dias grátis para arrumar as contas" sub={`Depois, ${brl(PRECO_MENSAL)} por mês. Cancele quando quiser.`} pose="ola">
      <h2>Criar conta</h2>
      <form className="pilha" onSubmit={enviar} noValidate>
        <label className="campo">
          <span>Seu nome</span>
          <input className="entrada" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome e sobrenome" />
        </label>
        <label className="campo">
          <span>E-mail</span>
          <input className="entrada" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
        </label>
        <CampoSenha valor={senha} onChange={setSenha} rotulo="Crie uma senha" dica="Pelo menos 6 caracteres." auto="new-password" />
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--muted)' }}>
          <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: '#292D54', flex: 'none' }} />
          <span>Li e concordo com os termos de uso e a política de privacidade.</span>
        </label>
        {erro && (
          <div className="campo" role="alert">
            <small className="erro">{erro}</small>
          </div>
        )}
        <button className="btn btn-pri btn-bloco" type="submit">
          Começar meu teste grátis
        </button>
      </form>
      <p className="auth-troca">
        Já tem conta? <Link to="/entrar">Entrar</Link>
      </p>
    </Tela>
  )
}
