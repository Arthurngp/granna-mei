import { CircleCheck, QrCode, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Mascote } from '../../../src/components/ui'
import { api } from '../sb'
import { Carregando, dataHora, Falha } from './comum'
import { TrocarNumero } from './TrocarNumero'
import { usePainel } from './Visao'

export function Granninha() {
  const { p, erro, recarregar } = usePainel()
  const [qr, setQr] = useState<{ conectado: boolean; imagem: string | null; estado: string } | null>(null)
  const [erroQr, setErroQr] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [alerta, setAlerta] = useState({ whats: '', ligado: false })
  const [recadoAlerta, setRecadoAlerta] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const r = await api<{ alerta_whats: string; alerta_ligado: boolean; alerta_tipo: string | null }>('/admin/alerta')
        setAlerta({ whats: r.alerta_whats ?? '', ligado: !!r.alerta_ligado })
        if (r.alerta_tipo) setRecadoAlerta(`Hoje há um problema em aberto já avisado (${r.alerta_tipo}).`)
      } catch {
        // a tela funciona sem isto: o campo fica vazio e o recado aparece ao salvar
      }
    })()
  }, [])

  const salvarAlerta = async () => {
    setSalvando(true)
    setRecadoAlerta('')
    try {
      const r = await api<{ alerta_whats: string; alerta_ligado: boolean }>('/admin/alerta', {
        method: 'POST',
        body: JSON.stringify({ whats: alerta.whats, ligado: alerta.ligado }),
      })
      setAlerta({ whats: r.alerta_whats, ligado: r.alerta_ligado })
      setRecadoAlerta(r.alerta_ligado ? 'Pronto. Vou avisar neste número se algo parar.' : 'Aviso desligado.')
    } catch (e) {
      setRecadoAlerta((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  if (erro) return <Falha texto={erro} />
  if (!p) return <Carregando />

  const s = p.saude
  const minutos = s ? (Date.now() - new Date(s.atualizado_em).getTime()) / 60_000 : Infinity
  const conectado = s?.whatsapp_estado === 'CONNECTED'
  // Sem batimento há mais de 3 minutos = o serviço parou. Número fora de CONNECTED = clientes sem atendimento.
  const problema = !s ? 'O serviço da Granninha ainda não mandou nenhum sinal.' : minutos > 3 ? `O serviço da Granninha está sem dar sinal há ${Math.round(minutos)} minutos.` : !conectado ? `O WhatsApp da Granninha não está conectado (${s.whatsapp_estado}). Os clientes estão sem atendimento.` : null

  const pedirQr = async () => {
    setErroQr('')
    setOcupado(true)
    try {
      setQr(await api('/admin/qr'))
    } catch (e) {
      setErroQr((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="pagina">
      {problema ? (
        <div className="alerta ruim" role="alert"><TriangleAlert size={20} style={{ flex: 'none' }} /><span>{problema}</span></div>
      ) : (
        <div className="alerta bom"><CircleCheck size={20} style={{ flex: 'none' }} /><span>A Granninha está no ar e o WhatsApp conectado{s?.whatsapp_numero ? ` (${s.whatsapp_numero})` : ''}.</span></div>
      )}

      <div className="kpis">
        <div className="kpi"><small>Mensagens hoje</small><b className="num">{p.mensagens_hoje}</b></div>
        <div className="kpi"><small>Respondidas hoje</small><b className="num">{p.respondidas_hoje}</b></div>
        <div className="kpi"><small>Erros em 24 h</small><b className={`num ${p.erros_24h ? 'cor-out' : ''}`}>{p.erros_24h}</b></div>
        <div className="kpi"><small>Fila agora</small><b className="num">{s?.fila ?? '-'}</b><span>último sinal {dataHora(s?.atualizado_em)}</span></div>
      </div>

      <div className="grade">
        <section className="card g-6">
          <div className="card-cab"><h2>Conectar o número</h2></div>
          <p className="suave" style={{ marginBottom: 12 }}>
            Abra o WhatsApp do chip da Granninha, vá em Aparelhos conectados e leia o QR. O QR muda a cada poucos segundos: se vencer, peça outro.
          </p>
          <button type="button" className="btn btn-pri btn-bloco" onClick={pedirQr} disabled={ocupado}>
            <QrCode size={18} />
            {qr ? 'Pedir outro QR' : 'Mostrar QR para conectar'}
          </button>
          {erroQr && <div style={{ marginTop: 10 }}><Falha texto={erroQr} /></div>}
          {qr && (
            <div className="qr" style={{ marginTop: 12 }}>
              {qr.conectado ? (
                <><Mascote pose="festa" tam={90} /><b>Já está conectado.</b></>
              ) : qr.imagem ? (
                <><img src={qr.imagem} alt="QR para conectar o WhatsApp" /><small className="suave">Estado: {qr.estado}</small></>
              ) : (
                <small className="suave">O gateway ainda não gerou o QR (estado: {qr.estado}). Tente de novo em alguns segundos.</small>
              )}
            </div>
          )}
        </section>
        <TrocarNumero conectado={conectado} numeroAtual={s?.whatsapp_numero ?? null} aoMudar={() => void recarregar()} />
        <section className="card g-6">
          <div className="card-cab"><h2>Me avisar se parar</h2></div>
          <p className="suave" style={{ marginBottom: 12 }}>
            Se a IA ficar sem crédito ou parar de responder, a Granninha manda uma mensagem para este número.
            Um aviso por problema, sem repetir — e outro quando voltar ao normal.
          </p>
          <input
            className="campo"
            inputMode="tel"
            placeholder="(81) 99999-8888"
            value={alerta.whats}
            onChange={(e) => setAlerta({ ...alerta, whats: e.target.value })}
            aria-label="Número que recebe o aviso"
          />
          <label className="suave" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
            <input type="checkbox" checked={alerta.ligado} onChange={(e) => setAlerta({ ...alerta, ligado: e.target.checked })} />
            Ligado
          </label>
          <button type="button" className="btn btn-pri btn-bloco" onClick={salvarAlerta} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          {recadoAlerta && <p className="suave pq" style={{ marginTop: 10 }}>{recadoAlerta}</p>}
          <p className="suave pq" style={{ marginTop: 10 }}>
            O aviso sai pelo WhatsApp da própria Granninha, então ele <b>não</b> cobre o caso de o WhatsApp dela cair —
            para isso existe o monitoramento de fora.
          </p>
        </section>

        <section className="card g-6">
          <div className="card-cab">
            <h2>Últimos erros</h2>
            <button type="button" className="lnk" onClick={() => void recarregar()}>Atualizar</button>
          </div>
          {p.ultimos_erros.length ? (
            <div className="lista">
              {p.ultimos_erros.map((e, i) => (
                <div className="linha" key={i} style={{ padding: '8px 0' }}>
                  <div className="meio">
                    <div className="tit" style={{ fontSize: 14, whiteSpace: 'normal' }}>{e.erro}</div>
                    <div className="det"><span>{dataHora(e.criado_em)} · {e.tipo}</span></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="suave">Nenhum erro registrado.</p>
          )}
          <p className="suave pq" style={{ marginTop: 10 }}>Última mensagem recebida: {dataHora(p.ultima_mensagem)}</p>
        </section>
      </div>
    </div>
  )
}
