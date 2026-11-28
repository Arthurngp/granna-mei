/**
 * A IA da configuração pela conversa: entra só quando o código não entendeu a resposta (config-whats.ts lê o que é exato: número, nome de banco
 * conhecido, valor, sim/não). Pedido do Arthur em 2026-11-28: "Sou videomaker" tem que ser aceito, "caixinha" é dinheiro guardado e não banco,
 * banco escrito errado vira "você quis dizer...", e o saldo dito junto com o banco não é perguntado de novo.
 *
 * A instrução é fixa aqui (nada de prompt editável no admin). O servidor NÃO confia no que volta: ramo só da lista, banco só da lista de nomes
 * conhecidos, ocupação pela mesma régua do código, valores dentro de limites. Se a IA cair, devolve null e a configuração segue só com o código.
 */
import { jsonEstruturado, type Uso } from './openai.ts'
import { lerOcupacao, NOMES_BANCOS, nomeDoBanco, RAMOS, type Etapa } from './config-whats.ts'

export type TipoConta = 'banco' | 'dinheiro' | 'reserva'
export interface Entendido {
  eh_resposta: boolean
  pular: boolean
  sim_nao: 'sim' | 'nao' | null
  ramo: string | null
  ocupacao: string | null
  contas: { tipo: TipoConta; banco: string | null; nome_dito: string; saldo: number | null }[]
  valor: number | null
  cartao_banco: string | null
  cartao_dia: number | null
}

const nulo = (tipo: string) => ({ type: [tipo, 'null'] })
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['eh_resposta', 'pular', 'sim_nao', 'ramo', 'ocupacao', 'contas', 'valor', 'cartao_banco', 'cartao_dia'],
  properties: {
    eh_resposta: { type: 'boolean' },
    pular: { type: 'boolean' },
    sim_nao: { type: ['string', 'null'], enum: ['sim', 'nao', null] },
    ramo: { type: ['string', 'null'], enum: [...RAMOS.map((r) => r.id), null] },
    ocupacao: nulo('string'),
    contas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'banco', 'nome_dito', 'saldo'],
        properties: { tipo: { type: 'string', enum: ['banco', 'dinheiro', 'reserva'] }, banco: nulo('string'), nome_dito: { type: 'string' }, saldo: nulo('number') },
      },
    },
    valor: nulo('number'),
    cartao_banco: nulo('string'),
    cartao_dia: nulo('integer'),
  },
}

const SISTEMA = `Você lê UMA mensagem de WhatsApp de uma pessoa que está terminando o cadastro na Granninha (app que anota o dinheiro do negócio de MEI). A Granninha fez uma pergunta; diga se a mensagem responde a ela e tire os dados. Nunca invente: o que a pessoa não disse fica null.

- eh_resposta: false se a mensagem é outro assunto (um gasto ou recebimento como "paguei 50 de luz", uma dúvida, um cumprimento). true se responde a pergunta, mesmo com outras palavras.
- pular: true se a pessoa não quer responder agora ("depois", "não sei", "pula").
- sim_nao: para pergunta de sim ou não ("tem mais alguma conta?", "usa cartão?", "quer que eu te lembre do DAS?"), o que ela respondeu; senão null.
- ramo: na pergunta "você trabalha com o quê?", o id mais próximo: ${RAMOS.map((r) => `${r.id} (${r.nome})`).join(', ')}. Quem presta serviço e não cabe nos outros (videomaker, fotógrafo, designer, professor, consultor, eletricista) é servicos. "outro" só se nenhum servir.
- ocupacao: a profissão como a pessoa disse, curta e em minúsculas ("sou videomaker" → "videomaker"); null se ela não disse uma profissão.
- contas: cada lugar onde a pessoa guarda dinheiro citado na mensagem. tipo "reserva" para caixinha, cofrinho, poupança, reserva, investimento, CDB, tesouro; "dinheiro" para espécie, em casa, em mãos; "banco" para conta em banco ou carteira digital. banco: o nome escrito certo, só se for um destes: ${NOMES_BANCOS.join(', ')}. Corrija erro de digitação ("nubak" → "Nubank", "bradeco" → "Bradesco", "itau" → "Itaú"). Se não for nenhum destes, null. nome_dito: como a pessoa escreveu. saldo: o valor em reais que ela disse ter ali ("tenho 450 lá" → 450, "uns mil e duzentos" → 1200); senão null.
- valor: na pergunta de quanto tem na conta, o valor dito; senão null.
- cartao_banco e cartao_dia: na pergunta do cartão de crédito, o banco do cartão e o dia de vencimento da fatura (1 a 31); senão null.`

const PERGUNTA_DA_ETAPA: Partial<Record<Etapa, string>> = {
  ramo: 'Você trabalha com o quê?',
  ocupacao: 'O que você faz, exatamente?',
  banco: 'Em qual banco cai o dinheiro do trabalho?',
  mais_banco: 'Tem mais alguma conta, caixinha ou dinheiro guardado em casa?',
  saldo: 'Quanto tem nessa conta hoje?',
  cartao: 'Usa cartão de crédito? De qual banco e que dia vence a fatura?',
  cartao_dia: 'Que dia vence a fatura do cartão?',
  das: 'Quer que eu te lembre do DAS do MEI todo mês?',
  banco_confirma: 'É esse o nome do seu banco?',
}

const numeroOk = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null)

/** Confere tudo o que a IA devolveu: o que sai daqui é seguro de gravar. */
export function validar(d: Partial<Entendido> | null | undefined): Entendido {
  const ramo = typeof d?.ramo === 'string' && RAMOS.some((r) => r.id === d.ramo) ? d.ramo : null
  const oc = typeof d?.ocupacao === 'string' && !/[?!]/.test(d.ocupacao) ? lerOcupacao(d.ocupacao.toLowerCase()) : null
  const contas = (Array.isArray(d?.contas) ? d.contas : [])
    .slice(0, 4)
    .filter((c) => c && ['banco', 'dinheiro', 'reserva'].includes(c.tipo))
    .map((c) => ({
      tipo: c.tipo,
      // Só nome da lista de bancos conhecidos: o que a IA inventar vira null e passa pela confirmação.
      banco: typeof c.banco === 'string' ? nomeDoBanco(c.banco) : null,
      nome_dito: String(c.nome_dito ?? '').trim().slice(0, 40),
      saldo: numeroOk(c.saldo, 100_000_000),
    }))
  const dia = typeof d?.cartao_dia === 'number' && Number.isInteger(d.cartao_dia) && d.cartao_dia >= 1 && d.cartao_dia <= 31 ? d.cartao_dia : null
  return {
    eh_resposta: d?.eh_resposta === true,
    pular: d?.pular === true,
    sim_nao: d?.sim_nao === 'sim' || d?.sim_nao === 'nao' ? d.sim_nao : null,
    ramo,
    ocupacao: oc,
    contas,
    valor: numeroOk(d?.valor, 100_000_000),
    cartao_banco: typeof d?.cartao_banco === 'string' ? d.cartao_banco.trim().slice(0, 30) || null : null,
    cartao_dia: dia,
  }
}

/**
 * Pede à IA para entender a resposta. Devolve o que entendeu (já conferido) e o consumo, ou null com o consumo zerado se a IA falhou:
 * quem chama segue só com o código, e a configuração nunca trava por causa da IA.
 */
export async function entenderResposta(etapa: Etapa, texto: string, contas: string[]): Promise<{ dados: Entendido | null; uso: Uso | null }> {
  const usuario = `Pergunta feita: ${PERGUNTA_DA_ETAPA[etapa] ?? etapa}\nContas que a pessoa já tem anotadas: ${contas.length ? contas.join(', ') : 'nenhuma'}\nMensagem: ${texto.slice(0, 500)}`
  try {
    const r = await jsonEstruturado<Entendido>(SISTEMA, usuario, 'configuracao', ESQUEMA)
    return { dados: validar(r.dados), uso: r.uso }
  } catch (e) {
    console.error('[config] a IA não entendeu a resposta, sigo só com o código:', (e as Error).message.slice(0, 200))
    return { dados: null, uso: null }
  }
}
