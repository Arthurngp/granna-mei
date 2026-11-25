import { Mascote } from '../components/ui'

/**
 * Painel fechado para manutenção (ligado por MANUTENCAO em lib/config.ts). Cobre todas as rotas do painel, inclusive
 * entrar e criar conta; o site continua no ar. O texto não expõe a causa: quem lê é o cliente.
 */
export default function Manutencao() {
  return (
    <div className="bloq manut">
      <div>
        <span className="manut-selo">
          <span className="manut-ponto" aria-hidden />
          Em manutenção
        </span>
        <Mascote pose="cafe" tam={156} anim="flutua" />
        <h1>Estou dando um trato nas coisas por aqui</h1>
        <p>
          O painel da Granninha está em manutenção por pouco tempo. Seus lançamentos, contas e relatórios estão guardados direitinho e voltam do
          jeitinho que você deixou.
        </p>
        <div className="card manut-card">
          <strong>Daqui a pouco eu volto</strong>
          <span>Assim que terminar, é só entrar com o seu e-mail e senha de sempre. Não precisa fazer nada agora.</span>
        </div>
        <p className="pq">Valeu pela paciência. Já já a gente continua.</p>
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
