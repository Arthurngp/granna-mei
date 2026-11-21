import { ArrowLeftRight, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Mascote } from '../../../src/components/ui'
import { api } from '../sb'
import { Falha } from './comum'

type Qr = { conectado: boolean; imagem: string | null; estado: string; numero: string | null }
type Pedido = { codigo: string; validade_s: number; conectado: boolean; numero_final: string | null }
type Etapa = 'repouso' | 'aviso' | 'confirma' | 'qr'

/** `.item-ob` é um grid de coluna `auto`: um texto comprido ao lado da caixa de seleção estoura a borda no celular. */
const CAIXA = { gridTemplateColumns: 'minmax(0, 1fr)' } as const

/** "5581988889537" -> "+55 81 98888-9537". Se o formato não for o esperado, devolve os dígitos. */
export function formatarNumero(n: string | null | undefined): string {
  const d = (n ?? '').replace(/\D/g, '')
  const m = d.match(/^55(\d{2})(9?\d{4})(\d{4})$/)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d || '-'
}

/**
 * Troca do número da Granninha, em duas etapas. A regra de verdade mora no servidor (trocar-whatsapp.ts): sem a etapa 1 não
 * existe caminho para desconectar, o código vale 2 minutos e a etapa 2 exige a frase. Esta tela só conduz o admin por elas.
 */
export function TrocarNumero({ conectado, numeroAtual, aoMudar }: { conectado: boolean; numeroAtual: string | null; aoMudar: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>('repouso')
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [venceEm, setVenceEm] = useState(0)
  const [agora, setAgora] = useState(Date.now())
  const [frase, setFrase] = useState('')
  const [ciente, setCiente] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [qr, setQr] = useState<Qr | null>(null)
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  // Relógio do código de 2 minutos.
  useEffect(() => {
    if (etapa !== 'confirma') return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [etapa])
  const restante = Math.max(0, Math.ceil((venceEm - agora) / 1000))
  const venceu = etapa === 'confirma' && restante === 0

  // Depois de desconectar, o QR gira a cada poucos segundos: renova até o chip novo conectar.
  useEffect(() => {
    if (etapa !== 'qr' || qr?.conectado) return
    let parar = false
    const ciclo = async () => {
      await new Promise((ok) => setTimeout(ok, 5000))
      if (parar || !montado.current) return
      try {
        const r = await api<Qr>('/admin/qr')
        if (!parar && montado.current) setQr(r)
      } catch {
        // o QR anterior continua na tela; a próxima volta tenta de novo
      }
      if (!parar && montado.current) void ciclo()
    }
    void ciclo()
    return () => {
      parar = true
    }
  }, [etapa, qr?.conectado])

  const voltar = () => {
    setEtapa('repouso')
    setPedido(null)
    setFrase('')
    setCiente(false)
    setErro('')
  }

  const pedirConfirmacao = async () => {
    setErro('')
    setOcupado(true)
    try {
      const r = await api<Pedido>('/admin/whatsapp/trocar/pedir', { method: 'POST', body: '{}' })
      setPedido(r)
      setVenceEm(Date.now() + r.validade_s * 1000)
      setAgora(Date.now())
      setFrase('')
      setCiente(false)
      setEtapa('confirma')
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const confirmar = async () => {
    if (!pedido) return
    setErro('')
    setOcupado(true)
    try {
      const r = await api<Qr & { desconectou: boolean }>('/admin/whatsapp/trocar/confirmar', { method: 'POST', body: JSON.stringify({ codigo: pedido.codigo, frase }) })
      setQr(r)
      setEtapa('qr')
      aoMudar()
    } catch (e) {
      const msg = (e as Error).message
      setErro(msg)
      // Código vencido, esgotado ou nunca pedido: a única saída é recomeçar pela etapa 1.
      if (/Comece|venceu|Muitas tentativas/.test(msg)) {
        setEtapa('aviso')
        setPedido(null)
      }
    } finally {
      setOcupado(false)
    }
  }

  const fraseCerta = frase.trim().toUpperCase() === 'TROCAR'

  return (
    <section className="card g-6">
      <div className="card-cab"><h2>Trocar o número</h2></div>

      {etapa === 'repouso' && (
        <>
          <p className="suave" style={{ marginBottom: 12 }}>
            Para passar a Granninha para outro chip. Isso desconecta o número atual, e a Granninha fica sem responder até o chip novo ler o QR.
            Por isso a troca pede duas confirmações.
          </p>
          {conectado ? (
            <button type="button" className="btn btn-sec btn-bloco" onClick={() => { setErro(''); setEtapa('aviso') }}>
              <ArrowLeftRight size={18} />
              Trocar o número
            </button>
          ) : (
            <p className="suave pq">O WhatsApp já está desconectado. Use "Conectar o número" para ler o QR do chip novo.</p>
          )}
        </>
      )}

      {etapa === 'aviso' && (
        <div className="item-ob ligado" style={CAIXA}>
          <b>Etapa 1 de 2: o que vai acontecer</b>
          <small className="suave">
            Vamos desconectar o número atual{numeroAtual ? ` (${formatarNumero(numeroAtual)})` : ''}. A partir daí a Granninha para de responder todos os clientes, até o chip novo ser lido no QR.
          </small>
          <small className="suave">Antes de seguir, deixe o celular do chip novo em mãos, com o WhatsApp aberto.</small>
          <small className="suave">
            Os links de onboarding do painel dos clientes continuam apontando para o número antigo até a variável <b>VITE_WHATS_GRANNINHA</b> ser atualizada e o painel publicado de novo.
          </small>
          {erro && <Falha texto={erro} />}
          <div className="dupla">
            <button type="button" className="btn btn-sec" onClick={voltar}>Cancelar</button>
            <button type="button" className="btn btn-pri" disabled={ocupado} onClick={pedirConfirmacao}>
              {ocupado ? 'Aguarde…' : 'Entendi, continuar'}
            </button>
          </div>
        </div>
      )}

      {etapa === 'confirma' && pedido && (
        <div className="item-ob ligado" style={CAIXA}>
          <b style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TriangleAlert size={18} />
            Etapa 2 de 2: confirmar a desconexão
          </b>
          <small className="suave">
            {pedido.numero_final ? `Vai sair do ar o número que termina em ${pedido.numero_final}. ` : ''}
            {venceu ? 'O tempo acabou. Cancele e comece de novo.' : `Esta confirmação vale por mais ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, '0')}.`}
          </small>
          <label className="campo">
            <span>Para confirmar, digite TROCAR</span>
            <input className="entrada" value={frase} onChange={(e) => setFrase(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-label="Digite TROCAR para confirmar" />
          </label>
          <label className="suave" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} style={{ marginTop: 3 }} />
            Estou com o chip novo em mãos e sei que a Granninha fica sem responder até o QR ser lido.
          </label>
          {erro && <Falha texto={erro} />}
          <div className="dupla">
            <button type="button" className="btn btn-sec" onClick={voltar}>Cancelar</button>
            <button type="button" className="btn btn-perigo" disabled={ocupado || venceu || !fraseCerta || !ciente} onClick={confirmar}>
              {ocupado ? 'Desconectando…' : 'Desconectar e gerar o QR'}
            </button>
          </div>
        </div>
      )}

      {etapa === 'qr' && qr && (
        <div className="item-ob ligado" style={CAIXA}>
          {qr.conectado ? (
            <>
              <div className="qr"><Mascote pose="festa" tam={90} /><b>Número novo conectado.</b></div>
              <small className="suave">Conectado: {formatarNumero(qr.numero)}. A Granninha voltou a responder.</small>
              <small className="suave">
                Falta apontar o painel dos clientes para este número: atualizar <b>VITE_WHATS_GRANNINHA</b> e publicar o painel de novo.
              </small>
              <button type="button" className="btn btn-pri btn-bloco" onClick={() => { setQr(null); voltar(); aoMudar() }}>Concluir</button>
            </>
          ) : (
            <>
              <b>Número desconectado. Agora leia o QR com o chip novo.</b>
              <small className="suave">No celular do chip novo: WhatsApp, Aparelhos conectados, Conectar um aparelho, e aponte para o QR. Ele se renova sozinho.</small>
              <div className="qr">
                {qr.imagem ? (
                  <><img src={qr.imagem} alt="QR para conectar o número novo" /><small className="suave">Estado: {qr.estado}</small></>
                ) : (
                  <small className="suave">O gateway ainda não gerou o QR (estado: {qr.estado}). Em alguns segundos ele aparece aqui.</small>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {etapa === 'repouso' && erro && <div style={{ marginTop: 10 }}><Falha texto={erro} /></div>}
    </section>
  )
}
