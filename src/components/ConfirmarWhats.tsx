import { CircleCheck, LoaderCircle, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { linkWhats } from '../lib/config'
import { useApp } from '../lib/store'
import { Folha } from './ui'

/**
 * Confirmação do número: o cliente MANDA um código para a Granninha. Como a mensagem sai do próprio
 * WhatsApp dele, fica provado que o número é dele. Só número confirmado consegue lançar pela conversa.
 */
export function ConfirmarWhats({ compacto }: { compacto?: boolean }) {
  const { s, gerarCodigo } = useApp()
  const [codigo, setCodigo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  if (s.usuario.verificado) {
    return (
      <p className="ponto cor-in" style={{ fontSize: 14 }}>
        <CircleCheck size={16} /> Número confirmado: {s.usuario.whats}
      </p>
    )
  }
  const gerar = async () => {
    setOcupado(true)
    setErro('')
    const c = await gerarCodigo()
    setOcupado(false)
    if (c) setCodigo(c)
    else setErro('Não consegui gerar o código agora. Tente de novo.')
  }
  return (
    <div className="pilha" style={{ gap: 10 }}>
      {!compacto && (
        <p className="suave" style={{ fontSize: 14 }}>
          Para a Granninha reconhecer você, mande um código pelo WhatsApp {s.usuario.whats ? `do número ${s.usuario.whats}` : 'que você vai usar'}. Leva 10 segundos.
        </p>
      )}
      {!codigo ? (
        <button type="button" className="btn btn-wa btn-bloco" onClick={gerar} disabled={ocupado}>
          {ocupado ? <LoaderCircle size={18} className="gira" /> : <MessageCircle size={18} />}
          Confirmar meu WhatsApp
        </button>
      ) : (
        <>
          <div className="comprovante" style={{ marginTop: 0, textAlign: 'center' }}>
            <div style={{ fontSize: 13 }}>Seu código</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: 'var(--indigo)' }}>
              {codigo}
            </div>
            <div style={{ fontSize: 12.5 }}>vale por 30 minutos</div>
          </div>
          <a className="btn btn-wa btn-bloco" href={linkWhats(`Meu código Granninha: ${codigo}`)} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={18} />
            Abrir o WhatsApp e enviar
          </a>
          <p className="suave pq" style={{ textAlign: 'center' }}>
            Envie a mensagem como ela vier. A Granninha responde confirmando.
          </p>
        </>
      )}
      {erro && <small className="erro">{erro}</small>}
    </div>
  )
}

/** Faixa no Início enquanto o número não estiver confirmado (só na conta de verdade). */
export function FaixaWhats() {
  const { s } = useApp()
  const [aberta, setAberta] = useState(false)
  if (s.sessao.demo || s.usuario.verificado) return null
  return (
    <>
      <div className="faixa trial nao-imprime">
        <span className="cresce">Confirme seu WhatsApp para a Granninha anotar o que você mandar.</span>
        <button type="button" onClick={() => setAberta(true)}>
          Confirmar
        </button>
      </div>
      <Folha aberta={aberta} onFechar={() => setAberta(false)} titulo="Confirmar WhatsApp">
        <ConfirmarWhats />
      </Folha>
    </>
  )
}
