import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAviso } from '../../../src/components/ui'
import { rpc } from '../sb'
import { Falha } from './comum'
import { n } from './visao/usar'

type Previa = { passam: number; total: number }

/** `.item-ob` é um grid de coluna `auto`: texto comprido ao lado da caixa de seleção estoura a borda no celular. */
const CAIXA = { gridTemplateColumns: 'minmax(0, 1fr)' } as const

/**
 * O limite mensal de lançamentos que vale para TODOS os clientes sem limite próprio. A regra de verdade (faixa de 1 a 100000, motivo,
 * auditoria, quem pode) mora no banco, nas funções admin_limite_*: esta tela só conduz. O que ela acrescenta é o risco concreto:
 * antes de salvar, diz quantos clientes já usaram o valor novo e parariam de anotar na hora, e só deixa seguir com o "estou ciente".
 * Mudar o limite de UM cliente é na ficha dele (Clientes).
 */
export function LimitePadrao() {
  const avisar = useAviso()
  const [padrao, setPadrao] = useState<number | null>(null)
  const [indisponivel, setIndisponivel] = useState('')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [ciente, setCiente] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    // Sem p_user a função devolve só o padrão (e uso 0). Se a migration do limite ainda não rodou, a tela explica em vez de quebrar.
    rpc<{ padrao: number }>('admin_limite_cliente', { p_user: null })
      .then((r) => {
        setPadrao(r.padrao)
        setValor(String(r.padrao))
      })
      .catch(() => setIndisponivel('O limite configurável ainda não está ligado neste banco (falta a migration do limite).'))
  }, [])

  const novo = Number(valor)
  const valorOk = /^\d{1,6}$/.test(valor) && novo >= 1 && novo <= 100_000
  const mudou = padrao !== null && valorOk && novo !== padrao

  // Prévia do impacto, com um respiro para não consultar a cada tecla.
  useEffect(() => {
    setPrevia(null)
    setCiente(false)
    if (!mudou) return
    let vivo = true
    const t = setTimeout(() => {
      rpc<Previa>('admin_limite_previa', { p_valor: novo })
        .then((r) => vivo && setPrevia(r))
        .catch(() => vivo && setPrevia(null))
    }, 400)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [mudou, novo])

  const paramAgora = previa?.passam ?? 0
  // Sem a prévia carregada não se salva: o risco é justamente o que a prévia mostra.
  const pronto = mudou && previa !== null && motivo.trim().length >= 3 && (paramAgora === 0 || ciente)

  const salvar = async () => {
    setErro('')
    setOcupado(true)
    try {
      const r = await rpc<{ padrao: number }>('admin_limite_definir', { p_user: null, p_valor: novo, p_motivo: motivo.trim() })
      setPadrao(r.padrao)
      setValor(String(r.padrao))
      setMotivo('')
      avisar(`Pronto. O padrão agora é ${n(r.padrao)} mensagens atendidas por mês para quem não tem limite próprio. Vale em até 1 minuto.`)
    } catch (e) {
      setErro((e as Error).message.includes('motivo') ? 'Escreva o motivo (pelo menos 3 letras).' : (e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="cartao g6">
      <div className="cartao-cab"><h2>Limite de mensagens atendidas por mês</h2></div>
      {indisponivel ? (
        <Falha texto={indisponivel} />
      ) : padrao === null ? (
        <span className="skel" style={{ height: 120 }} />
      ) : (
        <>
          <p className="suave" style={{ marginBottom: 12 }}>
            Vale para todos os clientes que não têm limite próprio. Para mudar só um cliente, abra a ficha dele em Clientes. O cliente não vê este
            número: a Granninha só avisa no WhatsApp quando ele está perto e quando chega.
          </p>
          <div className="fatos" style={{ marginBottom: 12 }}>
            <div><span>Padrão hoje</span><span className="num">{n(padrao)} por mês</span></div>
          </div>
          <label className="campo">
            <span>Novo padrão (mensagens atendidas por mês)</span>
            <input
              className="entrada num"
              inputMode="numeric"
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-label="Novo limite padrão de mensagens atendidas por mês"
            />
          </label>
          {mudou && previa !== null && (
            <div className={`vaviso ${paramAgora > 0 ? 'ruim' : 'bom'}`} role={paramAgora > 0 ? 'alert' : 'status'} style={{ margin: '10px 0' }}>
              {paramAgora > 0 && <TriangleAlert size={20} style={{ flex: 'none' }} />}
              <span>
                {paramAgora > 0
                  ? `Com ${n(novo)}, ${n(paramAgora)} de ${n(previa.total)} clientes que seguem o padrão já usaram esse tanto neste mês e param de anotar agora, até o dia 1.`
                  : `Com ${n(novo)}, nenhum dos ${n(previa.total)} clientes que seguem o padrão para de anotar agora.`}
              </span>
            </div>
          )}
          {mudou && previa === null && <p className="suave pq" style={{ margin: '10px 0' }}>Calculando quantos clientes seriam afetados…</p>}
          <label className="campo">
            <span>Motivo (fica na auditoria)</span>
            <input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: ajuste do plano" />
          </label>
          {paramAgora > 0 && (
            <div className="item-ob ligado" style={{ ...CAIXA, marginTop: 10 }}>
              <label className="suave" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} style={{ marginTop: 3 }} />
                Estou ciente de que {n(paramAgora)} {paramAgora === 1 ? 'cliente para' : 'clientes param'} de anotar agora.
              </label>
            </div>
          )}
          {erro && <div style={{ marginTop: 10 }}><Falha texto={erro} /></div>}
          <button type="button" className={`btn ${paramAgora > 0 ? 'btn-perigo' : 'btn-pri'} btn-bloco`} style={{ marginTop: 12 }} disabled={ocupado || !pronto} onClick={salvar}>
            {ocupado ? 'Salvando…' : 'Salvar o novo padrão'}
          </button>
        </>
      )}
    </section>
  )
}
