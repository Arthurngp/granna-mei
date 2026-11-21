import { useCallback, useMemo, useState } from 'react'
import { Ativacao } from './visao/Ativacao'
import { CustoIA } from './visao/CustoIA'
import { SUBS, VisaoCtx, type SubAba } from './visao/layout'
import { Publico } from './visao/Publico'
import { Receita } from './visao/Receita'
import { Resumo } from './visao/Resumo'
import { Retencao } from './visao/Retencao'
import { Trafego } from './visao/Trafego'

export { usePainel, type Painel } from './visao/painel'

const CHAVE = 'granna-admin-sub'

/**
 * Visão geral do negócio em páginas. A faixa escura de cada página (título, números, navegação) é desenhada
 * dentro do cabeçalho do app, por isso recebe `slot`: o lugar onde ela entra.
 */
export function Visao({ slot }: { slot: HTMLElement | null }) {
  const [sub, setSub] = useState<SubAba>(() => {
    try {
      const salvo = localStorage.getItem(CHAVE) as SubAba | null
      return salvo && SUBS.some(([v]) => v === salvo) ? salvo : 'resumo'
    } catch {
      return 'resumo'
    }
  })
  const ir = useCallback((s: SubAba) => {
    setSub(s)
    window.scrollTo({ top: 0 })
    try {
      localStorage.setItem(CHAVE, s)
    } catch {
      // lembrar a página é só conveniência
    }
  }, [])
  const valor = useMemo(() => ({ slot, sub, ir }), [slot, sub, ir])
  return (
    <VisaoCtx.Provider value={valor}>
      {sub === 'resumo' && <Resumo />}
      {sub === 'custo' && <CustoIA />}
      {sub === 'ativacao' && <Ativacao />}
      {sub === 'retencao' && <Retencao />}
      {sub === 'trafego' && <Trafego />}
      {sub === 'receita' && <Receita />}
      {sub === 'publico' && <Publico />}
    </VisaoCtx.Provider>
  )
}
