import { Download, LoaderCircle, LogOut } from 'lucide-react'
import { useState } from 'react'
import { Mascote, useAviso } from '../components/ui'
import { abrirPagamento } from '../lib/cobranca'
import { PRECO_ANUAL, PRECO_MENSAL } from '../lib/config'
import { brl, diaCurto, hoje } from '../lib/format'
import { useApp } from '../lib/store'
import { baixarTudo } from './Ajustes'

/** Conta bloqueada: só dá para pagar, baixar os dados ou sair. */
export default function Bloqueado() {
  const { s, sair, simularStatus } = useApp()
  const avisar = useAviso()
  const [ocupado, setOcupado] = useState(false)
  const a = s.assinatura
  const valor = a.plano === 'anual' ? PRECO_ANUAL : PRECO_MENSAL
  // Nunca pagou e o teste grátis acabou: dizer "não recebemos o pagamento que venceu" seria falso, ele nunca foi cobrado.
  const testeAcabou = a.faturas.length === 0 && a.trialFim < hoje()

  const pagar = async () => {
    if (s.sessao.demo) {
      simularStatus('ativa')
      avisar('Pagamento confirmado. Que bom ter você de volta!')
      return
    }
    setOcupado(true)
    try {
      const p = await abrirPagamento(a.plano)
      window.location.assign(p.url)
    } catch (e) {
      avisar((e as Error).message)
      setOcupado(false)
    }
  }

  return (
    <div className="bloq">
      <div>
        <Mascote pose="escudo" tam={150} anim="flutua" />
        <h1>{testeAcabou ? 'Seu teste grátis terminou' : 'Seu acesso está pausado'}</h1>
        <p>
          {testeAcabou
            ? `O seu teste grátis terminou em ${diaCurto(a.trialFim)}. Seus lançamentos estão guardados e voltam na hora em que você assinar.`
            : `Não recebemos o pagamento que venceu em ${diaCurto(a.proxCobranca)}. Seus lançamentos estão guardados e voltam na hora em que o pagamento cair.`}
        </p>
        <div className="card pilha">
          <button type="button" className="btn btn-pri btn-bloco" onClick={() => void pagar()} disabled={ocupado}>
            {ocupado && <LoaderCircle size={18} className="gira" />}
            {testeAcabou ? `Assinar por ${brl(valor)} e voltar agora` : `Pagar ${brl(valor)} e voltar agora`}
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
