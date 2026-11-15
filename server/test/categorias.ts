// Mesma lista padrão do painel (src/lib/seed.ts), sem cor, para os testes.
import { MATERIAL_POR_RAMO } from './ramos.ts'

export function categoriasPadrao(ramo: string) {
  return [
    { id: 'servicos', nome: 'Serviços prestados', tipo: 'entrada' as const },
    { id: 'vendas', nome: 'Vendas de produtos', tipo: 'entrada' as const },
    { id: 'outras-entradas', nome: 'Outros recebimentos', tipo: 'entrada' as const },
    { id: 'material', nome: MATERIAL_POR_RAMO[ramo] ?? 'Material', tipo: 'saida' as const },
    { id: 'aluguel', nome: 'Aluguel', tipo: 'saida' as const },
    { id: 'contas-casa', nome: 'Luz, água e internet', tipo: 'saida' as const },
    { id: 'transporte', nome: 'Transporte', tipo: 'saida' as const },
    { id: 'alimentacao', nome: 'Alimentação', tipo: 'saida' as const },
    { id: 'impostos', nome: 'Impostos (DAS)', tipo: 'saida' as const },
    { id: 'equipamentos', nome: 'Ferramentas e equipamentos', tipo: 'saida' as const },
    { id: 'marketing', nome: 'Divulgação', tipo: 'saida' as const },
    { id: 'taxas', nome: 'Taxas e tarifas', tipo: 'saida' as const },
    { id: 'retirada', nome: 'Retirada do dono', tipo: 'saida' as const, pessoal: true },
  ]
}
