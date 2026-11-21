import { useState } from 'react'
import { Ativacao } from './visao/Ativacao'
import { CustoIA } from './visao/CustoIA'
import { Receita } from './visao/Receita'
import { Resumo } from './visao/Resumo'
import { Trafego } from './visao/Trafego'

export { usePainel, type Painel } from './visao/painel'

export type SubAba = 'resumo' | 'custo' | 'ativacao' | 'trafego' | 'receita'

const SUBS: [SubAba, string][] = [
  ['resumo', 'Resumo'],
  ['custo', 'Custo de IA'],
  ['ativacao', 'Ativação'],
  ['trafego', 'Tráfego'],
  ['receita', 'Receita'],
]

/** Visão geral do negócio, em páginas: o resumo de tudo e uma página para cada assunto. */
export function Visao() {
  const [sub, setSub] = useState<SubAba>(() => {
    try {
      const salvo = localStorage.getItem('granna-admin-sub') as SubAba | null
      return salvo && SUBS.some(([v]) => v === salvo) ? salvo : 'resumo'
    } catch {
      return 'resumo'
    }
  })
  const ir = (s: SubAba) => {
    setSub(s)
    try {
      localStorage.setItem('granna-admin-sub', s)
    } catch {
      // lembrar a página é só conveniência
    }
  }
  return (
    <div className="pagina">
      <nav className="sub-abas" aria-label="Páginas da visão geral">
        {SUBS.map(([v, r]) => (
          <button key={v} type="button" aria-pressed={sub === v} onClick={() => ir(v)}>
            {r}
          </button>
        ))}
      </nav>
      {sub === 'resumo' && <Resumo ir={ir} />}
      {sub === 'custo' && <CustoIA />}
      {sub === 'ativacao' && <Ativacao />}
      {sub === 'trafego' && <Trafego />}
      {sub === 'receita' && <Receita />}
    </div>
  )
}
