import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FocusEvent, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mascote, useAviso, type Pose } from '../components/ui'
import { PRECO_MENSAL } from '../lib/config'
import { evento } from '../lib/eventos'
import { brl, hoje } from '../lib/format'
import { useApp } from '../lib/store'

function Tela({ titulo, sub, pose, children }: { titulo: string; sub: string; pose: Pose; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-topo">
        <img className="logo" src={`${import.meta.env.BASE_URL}logo-192.png`} alt="Granninha" />
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

function CampoSenha({ valor, onChange, rotulo, dica, auto, campo = 'senha' }: { valor: string; onChange: (v: string) => void; rotulo: string; dica?: string; auto: string; campo?: string }) {
  const [ver, setVer] = useState(false)
  return (
    <label className="campo">
      <span>{rotulo}</span>
      <div style={{ position: 'relative' }}>
        <input className="entrada" data-trk={campo} type={ver ? 'text' : 'password'} autoComplete={auto} value={valor} onChange={(e) => onChange(e.target.value)} style={{ paddingRight: 48 }} />
        <button type="button" className="icone-btn" style={{ position: 'absolute', right: 4, top: 4 }} aria-label={ver ? 'Esconder senha' : 'Mostrar senha'} onClick={() => setVer(!ver)}>
          {ver ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
      {dica && <small>{dica}</small>}
    </label>
  )
}

function Erro({ texto }: { texto: string }) {
  if (!texto) return null
  return (
    <div className="campo" role="alert">
      <small className="erro">{texto}</small>
    </div>
  )
}

function BotaoEnviar({ ocupado, children }: { ocupado: boolean; children: ReactNode }) {
  return (
    <button className="btn btn-pri btn-bloco" type="submit" disabled={ocupado}>
      {ocupado && <LoaderCircle size={18} className="gira" />}
      {children}
    </button>
  )
}

export function Entrar() {
  const { entrar, recuperarSenha, entrarDemo } = useApp()
  const avisar = useAviso()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setErro('')
    if (!emailOk(email)) return setErro('Confira o e-mail: parece incompleto.')
    if (senha.length < 6) return setErro('A senha tem pelo menos 6 caracteres.')
    setOcupado(true)
    const falha = await entrar(email.trim(), senha)
    setOcupado(false)
    if (falha) setErro(falha)
  }

  const esqueci = async () => {
    setErro('')
    if (!emailOk(email)) return setErro('Digite seu e-mail acima para receber o link.')
    const falha = await recuperarSenha(email.trim())
    if (falha) setErro(falha)
    else avisar('Enviamos um link para criar uma senha nova')
  }

  return (
    <Tela titulo="O dinheiro do seu MEI em dia, pelo WhatsApp" sub="Você conversa com a Granninha e ela organiza tudo." pose="hero">
      <h2>Entrar</h2>
      <form className="pilha" onSubmit={enviar} noValidate>
        <label className="campo">
          <span>E-mail</span>
          <input className="entrada" data-trk="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
        </label>
        <CampoSenha valor={senha} onChange={setSenha} rotulo="Senha" auto="current-password" />
        <Erro texto={erro} />
        <BotaoEnviar ocupado={ocupado}>Entrar</BotaoEnviar>
        <button type="button" className="btn btn-txt" onClick={esqueci}>
          Esqueci minha senha
        </button>
      </form>
      <p className="auth-troca">
        Ainda não tem conta? <Link to="/criar-conta">{hoje() <= '2026-12-31' ? 'Use grátis até 31 de dezembro' : 'Teste grátis por 7 dias'}</Link>
      </p>
      <div className="divisor">ou</div>
      <button type="button" className="btn btn-sec btn-bloco" onClick={entrarDemo}>
        Ver uma demonstração
      </button>
      <p className="nota-demo">A demonstração abre uma conta de exemplo, sem cadastro. Nada do que você mexer lá é salvo.</p>
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
  const [ocupado, setOcupado] = useState(false)

  const comecou = useRef(false)
  useEffect(() => evento('cadastro_aberto'), [])
  // Primeiro campo tocado: separa quem abriu a tela e foi embora de quem começou a preencher.
  const aoFocar = (e: FocusEvent<HTMLFormElement>) => {
    const alvo = e.target as HTMLElement
    // Só conta campo de digitar ou marcar: o botão de enviar e o olho da senha também recebem foco.
    if (comecou.current || alvo.tagName !== 'INPUT') return
    comecou.current = true
    evento('cadastro_iniciado', { campo: alvo.getAttribute('data-trk') || 'outro' })
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setErro('')
    evento('cadastro_tentativa')
    const recusa = (motivo: string, texto: string) => {
      evento('cadastro_erro', { motivo })
      setErro(texto)
    }
    if (nome.trim().length < 2) return recusa('nome_curto', 'Como podemos te chamar?')
    if (!emailOk(email)) return recusa('email_invalido', 'Confira o e-mail: parece incompleto.')
    if (senha.length < 6) return recusa('senha_curta', 'Crie uma senha com pelo menos 6 caracteres.')
    if (!aceito) return recusa('termos_nao_marcados', 'Marque que você concorda com os termos para continuar.')
    setOcupado(true)
    const falha = await criarConta(nome.trim(), email.trim(), senha)
    setOcupado(false)
    if (falha) setErro(falha)
  }

  return (
    <Tela titulo={hoje() <= '2026-12-31' ? 'Grátis até 31 de dezembro' : '7 dias grátis para arrumar as contas'} sub={hoje() <= '2026-12-31' ? `Para quem cria a conta até 31 de dezembro. Depois, ${brl(PRECO_MENSAL)} por mês.` : `Depois, ${brl(PRECO_MENSAL)} por mês. Cancele quando quiser.`} pose="ola">
      <h2>Criar conta</h2>
      <form className="pilha" onSubmit={enviar} onFocusCapture={aoFocar} noValidate>
        <label className="campo">
          <span>Seu nome</span>
          <input className="entrada" data-trk="nome" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome e sobrenome" />
        </label>
        <label className="campo">
          <span>E-mail</span>
          <input className="entrada" data-trk="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
        </label>
        <CampoSenha valor={senha} onChange={setSenha} rotulo="Crie uma senha" dica="Pelo menos 6 caracteres." auto="new-password" campo="senha" />
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--muted)' }}>
          <input type="checkbox" data-trk="termos" checked={aceito} onChange={(e) => setAceito(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: '#292D54', flex: 'none' }} />
          <span>Li e concordo com os termos de uso e a política de privacidade.</span>
        </label>
        <Erro texto={erro} />
        <BotaoEnviar ocupado={ocupado}>Começar meu teste grátis</BotaoEnviar>
      </form>
      <p className="auth-troca">
        Já tem conta? <Link to="/entrar">Entrar</Link>
      </p>
    </Tela>
  )
}

/**
 * Criar a senha nova. É onde cai o link de "esqueci minha senha" do e-mail, e também o link
 * que o admin gera para quem perdeu o acesso: quem chega aqui já entrou pelo link, só falta a senha.
 */
export function NovaSenha() {
  const { s, trocarSenha } = useApp()
  const avisar = useAviso()
  const navegar = useNavigate()
  const [senha, setSenha] = useState('')
  const [repete, setRepete] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setErro('')
    if (senha.length < 6) return setErro('A senha tem pelo menos 6 caracteres.')
    if (senha !== repete) return setErro('As duas senhas não são iguais.')
    setOcupado(true)
    const falha = await trocarSenha(senha)
    setOcupado(false)
    if (falha) return setErro(falha)
    avisar('Senha trocada. Já pode usar a nova.')
    navegar('/', { replace: true })
  }

  // Sem sessão, o link venceu ou já foi usado: não adianta mostrar o formulário.
  if (!s.sessao.logado) {
    return (
      <Tela titulo="Criar uma senha nova" sub="Este link não vale mais." pose="pensando">
        <h2>Esse link já venceu</h2>
        <p>Cada link de senha serve uma vez só e dura pouco tempo. Peça outro na tela de entrar.</p>
        <Link className="btn btn-pri btn-bloco" to="/entrar">
          Voltar para entrar
        </Link>
      </Tela>
    )
  }

  return (
    <Tela titulo="Criar uma senha nova" sub="Escolha a senha que você vai usar daqui para a frente." pose="checklist">
      <h2>Senha nova</h2>
      <form className="pilha" onSubmit={enviar} noValidate>
        <CampoSenha valor={senha} onChange={setSenha} rotulo="Senha nova" dica="Pelo menos 6 caracteres" auto="new-password" />
        <CampoSenha valor={repete} onChange={setRepete} rotulo="Repita a senha" auto="new-password" />
        <Erro texto={erro} />
        <BotaoEnviar ocupado={ocupado}>Salvar a senha</BotaoEnviar>
      </form>
    </Tela>
  )
}
