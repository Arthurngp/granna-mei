/**
 * Ajuda da Granninha: quando a pessoa pergunta o que ela faz, como usar ou se perdeu.
 *
 * Antes era um texto fixo com quatro exemplos, igual para toda pergunta ("o que você faz?", "como eu lanço uma conta?",
 * "você é um robô?"). Agora a resposta sai da IA, mas só a partir do MANUAL abaixo: ela reescreve em tom de conversa e
 * responde ao que foi perguntado, sem poder prometer nada que não esteja nele. Se a IA falhar, vale a AJUDA_FIXA, que
 * conta a mesma coisa em texto natural. Ajuda nunca pode deixar a pessoa sem resposta.
 *
 * REGRA DE MANUTENÇÃO: o MANUAL só diz o que o serviço faz DE VERDADE hoje. Aviso de vencimento, resumo da semana, DAS e
 * limite com alerta não estão aqui de propósito (ver item f8-promessas do backlog): quando existirem de verdade, entram aqui.
 */
import { conversaRecente, type Contexto } from './interpretar.ts'
import { jsonEstruturado, type Uso } from './openai.ts'
import { comoDado, limparSaida, REGRA_DADO } from './seguranca.ts'
import { VOZ } from './voz.ts'

const PAINEL = () => (process.env.PAINEL_URL ?? 'https://granninha.com.br/painel').replace(/\/+$/, '')

/** Tudo o que a Granninha faz hoje. A IA da ajuda só pode afirmar o que está aqui. */
export const MANUAL = `QUEM É A GRANNINHA
- A Granninha é a moedinha: uma inteligência artificial (não é uma pessoa) que cuida do caixa de microempreendedor (MEI) pelo WhatsApp. É um produto da Amplasoft.
- A pessoa conta o que entrou e o que saiu, do jeito que falaria com alguém, e a Granninha anota e vai somando. Também responde quando a pessoa pergunta como estão as contas.
- Ela só anota e consulta o que a pessoa conta. Não acessa o banco, não faz pagamento, não emite nota fiscal e não paga imposto.

O QUE ELA FAZ
1. Anota entradas e saídas ("recebi 150 da Juliana no pix", "paguei 89 de luz"). Entende gíria e valor falado ("50 conto", "1,2 mil").
2. Aceita texto, áudio, foto de comprovante e PDF (comprovante, extrato do banco ou fatura do cartão: ela lê e oferece importar).
3. Contas a pagar e a receber, com data de vencimento ("boleto de 300 vence dia 20", "a Mariana vai me pagar sexta"). Quando a pessoa paga ou recebe, é só dizer ("paguei a água", "a Mariana pagou") que ela dá baixa.
4. Contas que se repetem todo mês ("aluguel 900 todo dia 10") e compras ou vendas parceladas ("comprei 1.200 em 4x"). Dá para mudar tudo isso por aqui, sem abrir o painel: o valor ou o dia de uma conta fixa ("a internet agora é 109", "o aluguel agora vence dia 5"), o valor ou a data de uma conta só dessa vez ("a luz desse mês vence dia 28") e tirar uma conta fixa que acabou ("cancelei a internet"). Conta fixa a receber também vale ("a Joana me paga 300 todo dia 5").
5. Cartão de crédito: anota a compra no cartão e o pagamento da fatura. Dinheiro que passa de uma carteira para outra ("tirei 500 do caixa e depositei no banco") também.
6. Separa gasto do negócio de gasto da casa. Quando não dá para saber, ela pergunta.
7. Categorias: a pessoa pode pedir para criar ("cria a categoria Embalagens").
8. Corrigir e desfazer: "não foi 50, foi 60" corrige o último registro, e DESFAZER apaga o último.
9. Responde perguntas sobre os números: saldo, quanto entrou ou saiu hoje, na semana ou no mês, quanto gastou com alguma coisa, quanto sobrou, o que vence nos próximos dias, contas fixas, fatura do cartão e quanto falta para o limite de faturamento do MEI.
10. Painel no navegador: lançamentos, contas, relatórios, a tela Meu MEI e ajustes (carteiras, categorias, assinatura). O mesmo dinheiro que ela anota aparece lá.

O QUE ELA AINDA NÃO FAZ (não prometa)
- Não manda lembrete automático de conta vencendo, nem resumo da semana, nem aviso de DAS ou de limite do MEI por conta própria. Se a pessoa quiser ver o que vence, ela pode perguntar ("o que vence essa semana?").
- Não conecta com banco, não gera nota fiscal, não paga boleto.
- Preço, plano e cancelamento ficam no painel, em Ajustes, na tela Assinatura (botão Cancelar assinatura). Para excluir a conta e os dados: no painel, em Ajustes, "Excluir minha conta". Trocar o número do WhatsApp também é no painel, em Ajustes.

COMO COMEÇAR
- Basta mandar uma mensagem do dia a dia, como "recebi 80 de um corte no pix". Não precisa de comando nem formato certo.
- Para ver os números, perguntar ("quanto sobrou esse mês?").`

const sistema = () => `${VOZ}

SITUAÇÃO
A pessoa pediu ajuda, quer saber o que você faz ou tem uma dúvida de uso. Responda só com base no MANUAL, no jeito da voz acima.
- Você só EXPLICA: não registra nada e não faz pergunta de registro (valor, conta, categoria). Se a pessoa quer registrar algo, diga como mandar (com uma frase que ela possa copiar).
- Responda PRIMEIRO ao que a pessoa perguntou. Só depois, se couber, dê 2 ou 3 exemplos do que ela pode mandar (frases entre aspas).
- No máximo 7 linhas curtas. Sem lista numerada e sem hífen em lista.
- Se a pergunta for geral ("o que você faz?", "como funciona?"), conte em poucas frases quem você é, o que ela ganha e os 3 ou 4 pontos que mais ajudam: anotar do jeito que ela falar (texto, áudio ou foto), contas a pagar e a receber, e perguntar quanto sobrou. Não despeje o manual inteiro.
- Se a pessoa disse que não entendeu ou está perdida, acolha em meia frase ("tranquilo, é simples") antes de explicar.
- Se for dúvida específica ("como lanço uma conta?", "dá pra mandar áudio?"), responda direto, com uma frase que ela possa copiar.
- Se perguntarem se você faz algo que NÃO está no manual, diga com franqueza que isso você ainda não faz e diga o que faz de mais parecido. Nunca prometa o que não está no manual.
- Se a pergunta é sobre algo que o manual não traz (comissão, imposto, prazo, regra da empresa), diga que isso você não sabe e, se for assunto da conta, que está no painel. NUNCA invente uma resposta.
- O fim da resposta muda a cada vez: às vezes uma dica prática com uma frase para copiar, às vezes uma pergunta curta sobre o negócio dela, às vezes nada além da resposta. NUNCA comece o fecho com "Se quiser", nunca repita "me manda o primeiro lançamento" e não feche toda resposta com convite.
- Pode usar o nome da pessoa uma vez, se ele vier abaixo.
- Para painel, plano, preço ou cancelamento, diga que está no painel e ESCREVA o link exato ${PAINEL()} (é o único link permitido). Não invente preço, prazo nem outro link.

${REGRA_DADO}

${MANUAL}`

/** Resposta de reserva: o MANUAL em conversa, para quando a IA estiver fora. */
export function ajudaFixa(nome: string | null): string {
  const oi = nome ? `${nome}, ` : ''
  return `${oi}eu sou a Granninha, a moedinha que cuida do seu caixa aqui no WhatsApp. Você me conta o que entrou e o que saiu, do seu jeito, e eu anoto e vou somando.

Pode ser texto, áudio ou foto do comprovante: "recebi 150 da Juliana no pix", "paguei 89 de luz". Eu também guardo conta a pagar e a receber, conta fixa e compra parcelada.

Quer saber como tá o mês? Pergunta: "quanto sobrou?" ou "o que vence essa semana?". Errou alguma coisa? Responde DESFAZER ou me conta o que corrigir. Tudo isso aparece no painel também: ${PAINEL()}

Bora começar? Me manda o primeiro.`
}

const FEZ_ALGO = /^(paguei|pagou|recebi|gastei|comprei|vendi|ganhei|cobrei|transferi|depositei|saquei|tirei|fiz|entrou|saiu|caiu|anota|registra|lanca)\b/
const ASSUNTO_DA_CONTA: RegExp[] = [
  /\b(cancel\w*|exclu\w*|apag\w*|delet\w*|encerr\w*)( a| minha| meu| o| os| meus)*( minha)? ?(conta|assinatura|plano|cadastro|dados)\b/,
  /\b(minha assinatura|assinatura da granninha|plano da granninha|mudar (de )?plano|trocar (de )?plano)\b/,
  /\bquanto (voce |vc |voces |a granninha )?(custa|cobra|cobram)( (isso|aqui|a granninha|o app|o plano|o sistema|pra usar|usar|de comissao|de taxa|de mensalidade))?$/,
  /\b(qual|quanto) (e |eh )?(o )?(preco|valor) (disso|daqui|do plano|da granninha|da assinatura|da mensalidade)\b/,
  /\b(tem )?(periodo de teste|teste gratis|plano gratis|e gratis|eh gratis|e pago|eh pago)\b/,
  /\b(esqueci (a )?(minha )?senha|trocar (o |meu )?(numero|email|whats\w*)|mudar (o |meu )?(numero|email|whats\w*))\b/,
]
/** Dúvida sobre a conta ou a assinatura da própria Granninha (preço, plano, cancelar, excluir a conta): vai para a ajuda, não para os números do cliente. */
export function ehAssuntoDaConta(texto: string): boolean {
  if (texto.length > 90) return false
  const t = norm(texto)
  if (!t || /\d/.test(t) || FEZ_ALGO.test(t)) return false
  return ASSUNTO_DA_CONTA.some((re) => re.test(t))
}

/** Normaliza para comparar: minúsculo, sem acento, sem pontuação, espaços únicos. */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

const PEDIDOS_GERAIS: RegExp[] = [
  /^(ajuda|ajudar|help|menu|comandos?|opcoes|socorro|sos)( ai| aqui| por favor| pf| pfv)?$/,
  /^(me )?(ajuda|ajude)( ai| aqui| por favor| pf| pfv)?$/,
  /^(preciso|quero|queria|gostaria|vou precisar)( de)?( uma| um)?( ajuda| ajudinha)$/,
  /^(o que|oq|que) (voce|vc|tu|a granninha|ela) (faz|sabe fazer|pode fazer|consegue fazer|sabe)( por mim| aqui| ai)?$/,
  /^(o que|oq) (da|d[aá]|posso|eu posso|se pode|pode) (pra |para )?(fazer|mandar|pedir)( aqui| com voce| com vc| ai)?$/,
  /^(como|qual) (que )?(voce |vc |isso |isto |a granninha |ela |esse app |o app )?(funciona|e que funciona)( isso| aqui)?$/,
  /^como (eu )?(uso|usar|se usa)( isso| aqui| voce| vc| a granninha)?$/,
  /^como (que )?(eu )?(faco|fazer) (pra|para) (usar|comecar)( isso| aqui)?$/,
  /^(quem (e|eh) )?(voce|vc|tu)$/,
  /^quem (e|eh) (voce|vc|tu|a granninha|ela)$/,
  /^(voce|vc|tu) (e|eh) (um |uma )?(robo|bot|ia|inteligencia artificial|pessoa|gente|humano|humana|de verdade)( de verdade)?$/,
  /^(isso e|isso eh|ai e|ai eh) (um |uma )?(robo|bot|ia|pessoa|gente)$/,
  /^(nao|n|ainda nao) (entendi|sei usar|sei como (usar|funciona)|entendo)( nada)?$/,
  /^(estou|to|tou) (perdid[oa]|confus[oa])$/,
  /^(como|no que) (voce |vc |a granninha |ela )?(pode|vai|consegue) me ajudar$/,
  /^(pra que|para que) (voce |vc |a granninha |ela |isso )?serve$/,
  /^(o que (e|eh) (a )?granninha|que (que )?(e|eh) (isso|a granninha))$/,
]

/** Pedido geral de ajuda, curto e sem número: decidido por código, sem gastar a classificação da IA. */
export function ehPedidoDeAjuda(texto: string): boolean {
  if (texto.length > 80) return false
  const t = norm(texto)
  if (!t || /\d/.test(t)) return false
  return PEDIDOS_GERAIS.some((re) => re.test(t))
}

/**
 * A ajuda em si. Usa a IA só para falar em tom natural e responder ao que foi perguntado; se ela falhar, devolve a ajuda fixa.
 * O texto sai sempre pela limpeza de saída: nunca com link de fora, telefone, e-mail ou chave Pix.
 */
export async function responderAjuda(texto: string, nome: string | null, historico?: Contexto['historico']): Promise<{ texto: string; uso: Uso | null; deReserva: boolean }> {
  try {
    const primeiroNome = nome ? nome.trim().split(/\s+/)[0].slice(0, 30) : null
    const { dados, uso } = await jsonEstruturado<{ resposta: string }>(
      sistema(),
      `${primeiroNome ? `NOME DA PESSOA: ${primeiroNome}\n` : ''}${conversaRecente(historico)}\n\nPEDIDO DE AJUDA:\n${comoDado(texto.slice(0, 600))}`,
      'ajuda',
      { type: 'object', additionalProperties: false, properties: { resposta: { type: 'string' } }, required: ['resposta'] },
    )
    const limpo = limparSaida(dados.resposta.trim(), 900)
    if (limpo.texto.length < 20) return { texto: ajudaFixa(primeiroNome), uso, deReserva: true }
    return { texto: limpo.texto, uso, deReserva: false }
  } catch {
    // IA fora, cota esgotada ou resposta ilegível: a pessoa recebe a ajuda fixa, que conta o mesmo em texto natural.
    return { texto: ajudaFixa(nome ? nome.trim().split(/\s+/)[0].slice(0, 30) : null), uso: null, deReserva: true }
  }
}
