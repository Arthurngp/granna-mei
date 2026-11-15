import { Mic, Play } from 'lucide-react'
import { useEffect, useState } from 'react'

interface Msg {
  de: 'eu' | 'ela'
  texto?: string
  audio?: string
  hora: string
}

const ROTEIRO: Msg[] = [
  { de: 'eu', texto: 'Recebi 150 da Juliana no pix', hora: '09:12' },
  { de: 'ela', texto: 'Anotado: entrada de R$ 150,00\nServiços · Conta do banco · hoje\n\nErrou? Responda DESFAZER.', hora: '09:12' },
  { de: 'eu', audio: '0:06', hora: '12:40' },
  { de: 'ela', texto: 'Ouvi aqui: saída de R$ 89,90 com a conta de luz. Anotado.', hora: '12:40' },
  { de: 'eu', texto: 'Quanto sobrou esse mês?', hora: '18:03' },
  { de: 'ela', texto: 'Entrou R$ 4.280,00 e saiu R$ 1.930,00.\nSobrou R$ 2.350,00. Está indo bem!', hora: '18:03' },
]

/** Conversa de exemplo que se escreve sozinha, para mostrar como o produto funciona de verdade. */
export function Conversa() {
  const [n, setN] = useState(0)
  const digitando = n < ROTEIRO.length && ROTEIRO[n].de === 'ela'

  useEffect(() => {
    if (n >= ROTEIRO.length) return
    const espera = n === 0 ? 700 : ROTEIRO[n].de === 'ela' ? 1300 : 1500
    const t = window.setTimeout(() => setN((x) => x + 1), espera)
    return () => window.clearTimeout(t)
  }, [n])

  return (
    <div className="zap" aria-label="Exemplo de conversa com a Granninha">
      <div className="zap-cab">
        <img src="/mascote/hero.png" alt="" />
        <div>
          <b>Granninha</b>
          <small>{digitando ? 'digitando...' : 'online'}</small>
        </div>
      </div>
      <div className="zap-msgs">
        {ROTEIRO.slice(Math.max(0, n - 4), n).map((m, i) =>
          m.audio ? (
            <div key={m.hora + i} className={`msg audio ${m.de}`}>
              <Play size={18} fill="#54656f" color="#54656f" />
              <div className="onda" />
              <Mic size={16} color="#17a34f" />
              <small>
                {m.audio} · {m.hora}
              </small>
            </div>
          ) : (
            <div key={m.hora + i} className={`msg ${m.de}`}>
              {m.texto}
              <small>{m.hora}</small>
            </div>
          ),
        )}
        {digitando && (
          <div className="digitando" aria-hidden>
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
    </div>
  )
}
