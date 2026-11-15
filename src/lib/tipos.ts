export type TipoCarteira = 'banco' | 'dinheiro' | 'maquininha' | 'outro'
export type Origem = 'texto' | 'audio' | 'foto' | 'pdf' | 'painel'
export type StatusAssinatura = 'trial' | 'ativa' | 'atrasada' | 'bloqueada'

export interface Carteira {
  id: string
  nome: string
  tipo: TipoCarteira
  saldoInicial: number
  padrao: boolean
}

export interface Categoria {
  id: string
  nome: string
  tipo: 'entrada' | 'saida'
  cor: string
  /** Para a declaração anual do MEI: receita de serviço ou de comércio */
  natureza?: 'servico' | 'comercio'
  /** Retirada do dono: sai do caixa, mas não é gasto da empresa */
  pessoal?: boolean
}

export interface Lancamento {
  id: string
  tipo: 'entrada' | 'saida' | 'transferencia'
  valor: number
  descricao: string
  categoriaId?: string
  carteiraId: string
  carteiraDestinoId?: string
  data: string
  hora: string
  origem: Origem
  anexo?: boolean
  /** Caminho do comprovante no armazenamento privado (conta de verdade) */
  anexoPath?: string
  pessoal?: boolean
}

export interface Conta {
  id: string
  tipo: 'pagar' | 'receber'
  descricao: string
  valor: number
  vencimento: string
  status: 'aberta' | 'paga'
  categoriaId?: string
  fixaId?: string
  parcela?: { n: number; total: number }
  das?: boolean
  pagoEm?: string
  lancId?: string
}

export interface Fixa {
  id: string
  descricao: string
  valor: number
  dia: number
  categoriaId?: string
  das?: boolean
}

export interface Fatura {
  id: string
  data: string
  valor: number
  status: 'paga' | 'aberta'
}

export interface Estado {
  versao: number
  sessao: { logado: boolean; onboarding: boolean; demo: boolean; passo: number }
  usuario: { nome: string; email: string; negocio: string; cnpj: string; whats: string; ramo: string }
  carteiras: Carteira[]
  categorias: Categoria[]
  lancamentos: Lancamento[]
  contas: Conta[]
  fixas: Fixa[]
  prefs: { resumoDia: number; resumoHora: string; lembreteHora: string; antecedencia: number; ocultar: boolean }
  contador: { nome: string; email: string; whats: string; auto: boolean }
  assinatura: { status: StatusAssinatura; plano: 'mensal' | 'anual'; trialFim: string; proxCobranca: string; faturas: Fatura[] }
  exclusaoEm?: string
}
