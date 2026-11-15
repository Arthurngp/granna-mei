import { Download, LogOut } from 'lucide-react'
import { Mascote, useAviso } from '../components/ui'
import { PRECO_ANUAL, PRECO_MENSAL } from '../lib/config'
import { brl, diaCurto } from '../lib/format'
import { useApp } from '../lib/store'
import { baixarTudo } from './Ajustes'

/** Conta bloqueada por falta de pagamento: só dá para pagar, baixar os dados ou sair. */
export default function Bloqueado() {
  const { s, sair, simularStatus } = useApp()
  const avisar = useAviso()
  const valor = s.assinatura.plano === 'anual' ? PRECO_ANUAL : PRECO_MENSAL
  return (
    <div className="bloq">
      <div>
        <Mascote pose="escudo" tam={150} anim="flutua" />
        <h1>Seu acesso está pausado</h1>
        <p>
          Não recebemos o pagamento que venceu em {diaCurto(s.assinatura.proxCobranca)}. Seus lançamentos estão guardados e voltam na hora em que o pagamento cair.
        </p>
        <div className="card pilha">
          <button
            type="button"
            className="btn btn-pri btn-bloco"
            onClick={() => {
              simularStatus('ativa')
              avisar('Pagamento confirmado. Que bom ter você de volta!')
            }}
          >
            Pagar {brl(valor)} e voltar agora
          </button>
          <button
            type="button"
            className="btn btn-sec btn-bloco"
            onClick={() => {
              baixarTudo(s)
              avisar('Seus dados foram baixados')
            }}
          >
            <Download size={18} />
            Baixar meus dados
          </button>
          <button type="button" className="btn btn-txt" onClick={sair}>
            <LogOut size={17} />
            Sair
          </button>
        </div>
        <p className="pq">Enquanto isso, a Granninha não anota lançamentos novos no WhatsApp.</p>
        <div className="assinatura-amp" style={{ width: '100%' }}>
          Desenvolvido por{' '}
          <a href="https://grupongp.com.br" target="_blank" rel="noopener noreferrer">
            Amplasoft — Grupo NGP
          </a>
        </div>
      </div>
    </div>
  )
}
