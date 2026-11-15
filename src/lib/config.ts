/** Tudo que é número de negócio fica aqui, num lugar só. */

/** Limite de faturamento anual do MEI. */
export const LIMITE_MEI = 81000

export const PRECO_MENSAL = 19.9
export const PRECO_ANUAL = 197

/** Uso justo por mês (a confirmar com o Arthur antes do lançamento). */
export const LIMITE_LANCAMENTOS = 300
export const LIMITE_MIDIAS = 100

/** Número do WhatsApp da Granninha, definido no build (VITE_WHATS_GRANNINHA). Sem ele, usa um número provisório. */
export const WHATS_GRANNINHA = (import.meta.env.VITE_WHATS_GRANNINHA as string | undefined) || '5581900000000'
export const linkWhats = (texto = 'Oi, Granninha!') => `https://wa.me/${WHATS_GRANNINHA}?text=${encodeURIComponent(texto)}`

export const RAMOS = [
  { id: 'beleza', nome: 'Beleza e estética', ex: 'Salão, barbearia, manicure' },
  { id: 'alimentacao', nome: 'Alimentação', ex: 'Marmita, doces, lanches' },
  { id: 'comercio', nome: 'Comércio', ex: 'Loja, revenda, vendas online' },
  { id: 'servicos', nome: 'Serviços', ex: 'Manutenção, limpeza, aulas' },
  { id: 'obras', nome: 'Construção e reformas', ex: 'Pedreiro, eletricista, pintor' },
  { id: 'transporte', nome: 'Transporte e entregas', ex: 'Motorista, motoboy, frete' },
  { id: 'moda', nome: 'Moda e artesanato', ex: 'Costura, bijuteria, personalizados' },
  { id: 'outro', nome: 'Outro ramo', ex: 'A Granninha se adapta' },
] as const

/** Nome que a categoria de material ganha em cada ramo. */
export const MATERIAL_POR_RAMO: Record<string, string> = {
  beleza: 'Produtos e material',
  alimentacao: 'Ingredientes e embalagens',
  comercio: 'Mercadoria para revenda',
  servicos: 'Material de trabalho',
  obras: 'Material de obra',
  transporte: 'Combustível e manutenção',
  moda: 'Tecidos e material',
  outro: 'Material',
}
