/** Tudo que é número de negócio fica aqui, num lugar só. */

/** Limite de faturamento anual do MEI. */
export const LIMITE_MEI = 81000

/**
 * Painel fechado para manutenção (pedido do Arthur em 25/11, enquanto o chip do WhatsApp aquece). Com true, toda rota do painel
 * (entrar, criar conta e o painel logado) mostra a tela de manutenção; o site continua no ar. Para reabrir: false e merge na main.
 */
export const MANUTENCAO = false

export const PRECO_MENSAL = 29.9
export const PRECO_ANUAL = 299.9

/** Servidor da Granninha (cobrança). No build vem de VITE_GRANNINHA_API; sem ela usa o endereço de produção. */
export const API_GRANNINHA = ((import.meta.env.VITE_GRANNINHA_API as string | undefined) || 'https://api-grannamei.amplasoft.me').replace(/\/+$/, '')

/**
 * Cadastro novo (decisão do Arthur em 24/11): o site pede só o WhatsApp, e o resto da configuração acontece na conversa com a Granninha.
 * Liga para todos com VITE_ONBOARDING_WHATS=on no build; para o piloto, abrir o cadastro com ?onboarding=whats liga só neste navegador (e
 * ?onboarding=site desliga de novo). O servidor só conduz a conversa com ONBOARDING_WHATS=on no app granninha e a migration configwhats aplicada.
 */
export function fluxoWhats(): boolean {
  if ((import.meta.env.VITE_ONBOARDING_WHATS as string | undefined) === 'on') return true
  try {
    const q = new URLSearchParams(window.location.search).get('onboarding')
    if (q === 'whats' || q === 'site') window.localStorage.setItem('granninha:onboarding', q)
    return window.localStorage.getItem('granninha:onboarding') === 'whats'
  } catch {
    return false
  }
}

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

/**
 * Faturamento mensal do negócio, por faixa. Os códigos são os MESMOS da coluna `perfis.faturamento_faixa` (a página Público do
 * admin lê por eles); mudar um código aqui exige mudar a coluna e o admin. A faixa de cima do MEI acompanha o teto mensal (R$ 6.750).
 */
export const FAIXAS_FATURAMENTO = [
  { v: 'ate_2', r: 'Até R$ 2 mil' },
  { v: '2_4', r: 'De R$ 2 mil a R$ 4 mil' },
  { v: '4_6750', r: 'De R$ 4 mil a R$ 6.750 (teto do MEI)' },
  { v: 'acima', r: 'Acima de R$ 6.750' },
  { v: 'prefiro_nao', r: 'Prefiro não dizer' },
] as const

/** Renda pessoal por mês, por faixa (coluna `perfis.renda_faixa`). */
export const FAIXAS_RENDA = [
  { v: 'ate_2', r: 'Até R$ 2 mil' },
  { v: '2_4', r: 'De R$ 2 mil a R$ 4 mil' },
  { v: '4_8', r: 'De R$ 4 mil a R$ 8 mil' },
  { v: 'acima', r: 'Acima de R$ 8 mil' },
  { v: 'prefiro_nao', r: 'Prefiro não dizer' },
] as const

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const

/** Quem escolhe "Outro ramo" precisa dizer a ocupação: sem ela o ramo não diz nada sobre a pessoa. */
export const OCUPACAO_MIN = 3

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
