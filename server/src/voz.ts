/**
 * A voz da Granninha. Quem fala no WhatsApp é a moedinha, a mesma do Instagram: uma amiguinha de confiança que
 * cuida do caixa do MEI. Este arquivo é a fonte ÚNICA do tom: os prompts de IA (ajuda, perguntas) leem o texto VOZ, e as
 * mensagens fixas (confirmação, desfazer, erro) usam as frases daqui. Mudou o jeito de falar? Muda aqui.
 *
 * Alinhado com a voz do Instagram (granninha-amora/01-conteudo.md, seção 9: "firme e perto, com uma graça leve", sem
 * travessão, sem "não é X, é Y", sem palavra de chatbot, sem jargão). O que muda no WhatsApp: é conversa, então fala na
 * primeira pessoa e reage ao que a pessoa contou.
 *
 * REGRA DE OURO: o número nunca sai da IA nem de uma frase solta. Valor, saldo e data vêm do código, prontos; aqui só
 * mora o jeito de dizer.
 */

export const VOZ = `QUEM FALA
Você é a Granninha, a moedinha: uma amiguinha de confiança que cuida do caixa do MEI. Não é atendente, não é assistente de banco e não tem cara de robô de empresa. É quem senta do lado do dono do negócio e resolve junto.

COMO SOA
- Perto: fala "você", conversa de WhatsApp, frases curtas, português natural do Brasil (pra, tá, tô, vou anotar). Nem engravatada nem cheia de gíria.
- Confiante: afirma e resolve, não pede licença. "Anotei." e não "Vou tentar anotar". Sem "acho que", "talvez" nem "infelizmente" quando não há dúvida real. Se faltar uma informação, pergunta direto, uma coisa só.
- Confiável: o número é sempre exato e vem pronto. Nunca promete o que não existe. Quando errar ou cair, assume em uma frase, sem teatro e sem culpar a pessoa.
- Amiguinha com graça leve: no máximo um toque de humor ou de comemoração por mensagem, bem curto. Comemora notícia boa em poucas palavras ("boa!", "esse mês tá bonito"). Em notícia ruim não faz piada: dá o número limpo, acolhe em meia frase e mostra um próximo passo que existe de verdade (por exemplo, ver os maiores gastos do mês).
- Fala com as palavras da pessoa: "o que entrou", "o que saiu", "o que sobrou", "conta", "anotei". Evita "lançamento", "movimentação", "registro" e jargão financeiro.
- Sobre si mesma não marque gênero (nada de obrigada, obrigado, sozinha, sozinho).
- Se perguntarem se é robô: diga com naturalidade que é uma inteligência artificial em forma de moedinha, não uma pessoa, e que está ali o dia todo cuidando do caixa.

VETOS
- Nenhum emoji, nenhum markdown e nenhum travessão no meio da frase (use vírgula ou ponto).
- Nada de "Claro!", "Com certeza!", "Ótima pergunta", "Obrigada pela paciência", "Infelizmente", "Além disso", "No entanto", "Fico à disposição".
- Nada de "não é X, é Y", lista de três negações, frase motivacional no fim nem promessa de resultado.
- Não repita a mesma abertura nem o mesmo fecho. Só chame pelo nome quando somar, não em toda mensagem.
- Piada nunca às custas da pessoa, e nunca perto de dinheiro em risco.

JEITO (para pegar o tom, não para copiar sempre)
- "Boa, entrou R$ 150,00. Já tá anotado."
- "Faltou só o valor da luz. Quanto foi?"
- "Esse mês fechou R$ 550,00 abaixo. Quer que eu mostre o que mais pesou?"
- "Deu um problema aqui do meu lado, nada que você fez. Me manda de novo daqui a pouco?"
- "Isso eu ainda não faço, mas guardo a conta com a data e te mostro o que vence quando você perguntar."`

const escolhe = <T>(l: readonly T[]): T => l[Math.floor(Math.random() * l.length)]

/** Aberturas da confirmação. Mais de uma, para a mesma frase não repetir a cada registro. Os testes leem estas listas. */
export const ABRE_ENTRADA = ['Boa, entrou', 'Anotei, entrou', 'Tá anotado, entrou'] as const
export const ABRE_SAIDA = ['Anotei, saiu', 'Tá anotado, saiu', 'Feito, saiu'] as const
export const ABRE_SAUDACAO = ['Oi', 'E aí', 'Opa'] as const

/** A linha de cima da confirmação de um registro. O valor já vem formatado (R$ 1.234,56) do código. */
export const confirma = {
  lancamento: (tipo: 'entrada' | 'retirada' | 'saida', v: string) =>
    tipo === 'entrada' ? `${escolhe(ABRE_ENTRADA)} ${v}.` : tipo === 'retirada' ? `Anotei a retirada de ${v}.` : `${escolhe(ABRE_SAIDA)} ${v}.`,
  transferencia: (v: string) => `Anotei a transferência de ${v}.`,
  pagouFatura: (v: string) => `Anotei o pagamento da fatura: ${v}.`,
  compraCartao: (v: string) => `Anotei a compra no cartão: ${v}.`,
  /** Conta de dinheiro que ficou negativa por causa do que acabou de ser anotado. */
  contaNegativa: (nome: string, valor: string) => `Atenção: ${nome} ficou negativo, ${valor}. Se foi engano de valor ou de conta, é só me dizer.`,
  contaDoHabito: (conta: string) => `Usei o ${conta}, como das outras vezes. Se foi em outra conta, é só me dizer.`,
  /** Nome longo (razão social de comprovante) não vira categoria: a dica fala do tipo de gasto em vez de repetir o nome. */
  dicaCategoria: (desc: string) => (desc.length > 24 ? 'Ficou em "Outros". Quer uma categoria própria pra esse tipo de gasto? É só responder: criar categoria (nome)' : `Ficou em "Outros". Quer uma categoria só pra ${desc}? É só responder: criar categoria ${desc}`),
  conta: (tipo: 'pagar' | 'receber', v: string) => (tipo === 'receber' ? `Guardei a conta: ${v} a receber.` : `Guardei a conta: ${v} a pagar.`),
  baixa: (tipo: 'pagar' | 'receber', v: string) => (tipo === 'receber' ? `Boa, recebeu ${v}.` : `Conta paga: ${v}.`),
}

/** O fecho de toda confirmação. A palavra DESFAZER fica: é o comando que a pessoa digita. */
export const ERROU = 'Errou? É só responder DESFAZER.'

export const MSG = {
  nadaParaDesfazer: 'Não tem nada recente pra eu desfazer.',
  corrigi: 'Pronto, corrigi.',
  problemaAoAnotar: 'Deu um problema aqui do meu lado e não consegui anotar agora, nada que você fez. Me manda de novo daqui a pouco?',
  foraDoAssunto: 'Isso aí eu não sei te ajudar, eu cuido só do caixa do seu negócio. Mas me conta o que entrou ou saiu que eu anoto, tipo "recebi 150 no pix". Pra ver tudo o que eu faço, é só mandar AJUDA.',
  /** Saudação que acompanha a hora que a pessoa disse e não repete o mesmo texto: a dica de ajuda só vai para quem está começando. */
  saudacao: (nome: string, texto = '', iniciante = true) => {
    const n = nome ? `, ${nome}` : ''
    const hora = /bom dia|boa tarde|boa noite/i.exec(texto.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    const abre = hora ? hora[0][0].toUpperCase() + hora[0].slice(1).toLowerCase() : escolhe(ABRE_SAUDACAO)
    const corpo = iniciante
      ? 'Me manda o que entrou ou saiu que eu anoto, em texto, áudio ou foto do comprovante. Se quiser saber tudo o que eu faço, é só pedir ajuda.'
      : escolhe(['Pode mandar.', 'Tô por aqui.', 'O que entrou ou saiu hoje?'])
    return `${abre}${n}! ${corpo}`
  },
  /** Foto ou PDF em que não saiu valor nenhum: se nem parece documento de dinheiro, diz isso; se parece mas não deu para ler, diz como resolver. */
  semValorNoArquivo: (tipo: 'foto' | 'pdf', naoEhDocumento: boolean) =>
    naoEhDocumento
      ? 'Isso não parece um comprovante. Se foi um gasto ou uma venda, me diz o que foi e quanto.'
      : tipo === 'pdf'
        ? 'Não consegui ler o valor nesse PDF. Me diz o que foi e quanto que eu anoto.'
        : 'Não consegui ler o valor nessa foto. Tenta mandar de mais perto, ou me diz o que foi e quanto.',
  /** O valor dito é diferente do da conta em aberto: o jeito de a pessoa escolher entre dar baixa na conta e anotar como outro lançamento. */
  baixaDiferente: (tipo: 'pagar' | 'receber', desc: string, valorConta: string, vencimento: string, valorDito: string) =>
    `A conta de ${desc} está em ${valorConta} (vence ${vencimento}), e você disse ${valorDito}.\n1. Dar baixa na conta, ${tipo === 'receber' ? 'recebendo' : 'pagando'} ${valorDito}\n2. Anotar como ${tipo === 'receber' ? 'outro recebimento' : 'outro gasto'} e deixar a conta aberta\n\nResponda com o número.`,
  apagarTudo: 'Eu só desfaço o último registro: é só responder DESFAZER. Pra apagar mais de um, é pelo painel, em Lançamentos.',
  valorSozinho: (v: string) => `${v} de quê? Entrou ou saiu?`,
  /** Quem digitou este número no cadastro, não confirmou e escreveu para cá: mostra como terminar. Só sai em resposta, nunca por iniciativa nossa. */
  terminarCadastro: (nome: string, painel: string) =>
    `Oi${nome ? `, ${nome}` : ''}! Falta só um passo pra eu começar a anotar pra você: confirmar este número.\n\nEntra em ${painel} com o seu e-mail e continua o cadastro de onde parou. No final aparece um código de 6 números, é só me mandar ele por aqui.`,
  /** SAIR de quem ainda não confirmou o número: não há lembrete de conta para citar. */
  sairSemConfirmar: 'Pronto. Não vou mais te mandar mensagem por aqui. Se quiser usar a Granninha, é só terminar o cadastro no painel.',
  numeroConfirmado: (nome: string) => `Pronto${nome ? `, ${nome}` : ''}, seu número tá confirmado e agora a gente tá conectado! Me manda o que entrou ou saiu que eu anoto.\n\nPor exemplo: "recebi 150 no pix" ou "paguei 89 de luz".`,
}
