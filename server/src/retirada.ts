/**
 * Quando a Granninha decide sozinha que um gasto foi SEU e não do negócio.
 *
 * Caso de origem (2026-11-19, achado pelo teste de fluxo): "paguei a luz" foi gravado como retirada do
 * dono sem perguntar nada — e numa outra rodada do mesmo dia ela PERGUNTOU "é do negócio ou pessoal?".
 * Retirada não conta como despesa do negócio, então a decisão muda o lucro que o relatório mostra, em
 * silêncio, e o MEI não tem como saber.
 *
 * Decisão do Arthur (19/11): não criar mais uma pergunta antes do lançamento (atrito logo no começo,
 * que é onde cliente já desistiu), e sim AVISAR na confirmação, com uma correção de um toque.
 */
import type { Acao, Contexto } from './interpretar.ts'
import { lembrancaDe } from './interpretar.ts'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** A pessoa está dizendo que aquilo era do negócio, e não dela? */
export function ehDoNegocio(texto: string): boolean {
  const t = norm(texto).replace(/[.!]+$/, '')
  return /^(e |eh |foi )?(do |da )?(negocio|empresa|trabalho|servico|loja)$/.test(t)
}

/**
 * Deve avisar que anotou como retirada? Só quando a GRANNINHA decidiu: se a pessoa escolheu agora, ou
 * se o histórico dela já dizia que esse gasto é pessoal, o aviso vira ruído.
 */
export function avisoDeRetirada(acoes: Acao[], c: Contexto, forcouPessoal?: boolean): string {
  if (forcouPessoal !== undefined) return ''
  const decidida = acoes.some(
    (a) => a.tipo_acao === 'lancamento' && a.movimento === 'saida' && a.pessoal && lembrancaDe(a.descricao, c.lembrancaPessoal) !== true,
  )
  if (!decidida) return ''
  return '\n\nAnotei como retirada sua, não como gasto do negócio. Se for do negócio, responda NEGÓCIO.'
}

/** A categoria serve para gasto do negócio? Categoria marcada como pessoal não serve. */
export function categoriaDeNegocio(c: Contexto, atual: string | null): string | null {
  const cat = c.categorias.find((x) => x.id === atual)
  if (cat && cat.tipo === 'saida' && !cat.pessoal) return atual
  const saidas = c.categorias.filter((x) => x.tipo === 'saida' && !x.pessoal)
  // "Outros gastos" é o destino certo quando a categoria antiga era de gasto pessoal.
  return saidas.find((x) => /outros|geral/i.test(x.nome))?.id ?? saidas[0]?.id ?? null
}
