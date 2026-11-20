// SEO de cauda longa das LPs: cada LP vira uma página indexável em /mei/<slug>, com título e descrição
// para a busca e um guia curto que responde a pergunta. /lpN redireciona (301) para cá, com a UTM junto.
// Regra: fatos do MEI só os certos e estáveis (limite anual, vencimento do DAS, DASN-SIMEI, relatório mensal).

export const SEO = {
  lp2: {
    slug: 'como-controlar-o-financeiro-do-mei-pelo-whatsapp',
    titulo: 'Como controlar o financeiro do MEI pelo WhatsApp',
    desc: 'Passo a passo para controlar entradas, gastos, contas e o limite do MEI pelo WhatsApp, sem planilha e sem aplicativo novo.',
    guia: ['Como controlar o financeiro do MEI pelo WhatsApp', [
      'Controlar o financeiro do MEI é anotar tudo o que entra e sai do negócio, saber o que vence e acompanhar o faturamento do ano. O problema quase nunca é saber o que fazer, e sim ter tempo para fazer. Por isso o controle precisa caber no lugar onde você já passa o dia: o WhatsApp.',
      'Na prática, funciona assim: cada venda, cada gasto e cada conta vira uma mensagem curta, como “recebi 150 no pix” ou “paguei 89 de luz”. Quem organiza é a assistente do outro lado, que coloca o valor na categoria certa, separa o que é do negócio e guarda as contas a pagar, que aparecem no painel.',
      'No fim do mês, você pergunta quanto entrou, quanto saiu e quanto sobrou, e tem a resposta na conversa. Se quiser ver gráficos ou baixar relatório, o painel abre no navegador do celular.',
    ]],
  },
  lp3: {
    slug: 'como-separar-dinheiro-pessoal-e-do-mei',
    titulo: 'Como separar o dinheiro pessoal do dinheiro do MEI',
    desc: 'Por que misturar as contas de casa com as do MEI esconde o lucro e como separar as duas coisas mesmo usando a mesma conta no banco.',
    guia: ['Como separar o dinheiro pessoal do dinheiro do MEI', [
      'Misturar o dinheiro de casa com o do negócio é o erro mais comum de quem é MEI. Quando o mercado da família sai da mesma conta que o material de trabalho, fica impossível saber se o negócio dá lucro ou se só parece dar.',
      'O ideal é ter uma conta só para o negócio, mas muita gente começa usando a conta pessoal mesmo. Nesse caso, o que resolve é marcar cada gasto como pessoal ou do negócio na hora em que ele acontece. Assim o resultado do MEI aparece limpo, sem as contas de casa no meio.',
      'Outra prática que ajuda é definir quanto você tira do negócio por mês para você, como se fosse um salário, e registrar essa retirada. Fica claro o que o negócio produziu e o que foi para a sua vida.',
    ]],
  },
  lp4: {
    slug: 'como-saber-o-lucro-do-mei',
    titulo: 'Como saber o lucro do MEI todo mês',
    desc: 'Faturamento não é lucro. Veja como calcular quanto o seu MEI realmente lucra no mês, separando gastos do negócio e gastos pessoais.',
    guia: ['Como saber o lucro do MEI todo mês', [
      'Lucro é o que sobra do que entrou no negócio depois de pagar tudo o que o negócio gastou: material, mercadoria, combustível, aluguel, DAS e as outras contas. Faturamento é só a parte de cima dessa conta, e é por isso que tanto MEI fatura bem e mesmo assim não vê o dinheiro sobrar.',
      'Para saber o lucro de verdade, duas coisas precisam estar anotadas: todas as entradas do negócio e todas as saídas do negócio. Gastos pessoais ficam de fora, senão o número fica menor do que é.',
      'Com tudo anotado, a conta é simples: entradas menos saídas no período. Comparar mês a mês mostra se o negócio está melhorando e onde o dinheiro está indo embora.',
    ]],
  },
  lp5: {
    slug: 'limite-de-faturamento-do-mei-como-acompanhar',
    titulo: 'Limite de faturamento do MEI: como acompanhar',
    desc: 'O MEI pode faturar até R$ 81 mil por ano. Veja como acompanhar o faturamento mês a mês e quanto falta para o limite.',
    guia: ['Como acompanhar o limite de faturamento do MEI', [
      'O MEI pode faturar até R$ 81 mil por ano, o que dá uma média de R$ 6.750 por mês. No ano em que o CNPJ é aberto, o limite é proporcional aos meses de atividade. Passar desse valor pode tirar você do MEI e gerar imposto a mais, por isso vale acompanhar de perto.',
      'O jeito mais seguro é somar todas as entradas do negócio desde janeiro e conferir quanto falta para o limite. Quem só olha o extrato do banco costuma se perder, porque ali estão misturadas entradas pessoais, transferências e devoluções.',
      'Anotando cada venda no dia em que ela acontece, o total do ano está sempre pronto. Aí dá para planejar com antecedência: segurar uma venda grande para janeiro ou conversar com o contador sobre mudar de enquadramento.',
    ]],
  },
  lp6: {
    slug: 'como-nao-esquecer-de-pagar-o-das-do-mei',
    titulo: 'Como não esquecer de pagar o DAS do MEI',
    desc: 'O DAS do MEI vence todo dia 20. Veja como ter o DAS sempre à vista, todo mês, e evitar multa e juros por atraso.',
    guia: ['Como não esquecer de pagar o DAS do MEI', [
      'O DAS é a guia mensal do MEI e vence no dia 20 de cada mês. Ele junta a contribuição do INSS e o ICMS ou ISS da sua atividade. Pagar em dia mantém o CNPJ regular e conta para a aposentadoria e os benefícios do INSS.',
      'Quando atrasa, a guia passa a ter multa e juros, e meses em aberto podem virar dívida ativa. Na maioria das vezes o atraso não é falta de dinheiro, é esquecimento no meio da correria.',
      'O que resolve é ter o DAS no mesmo lugar das outras contas do mês, com o vencimento à vista, e marcar o pagamento quando fizer, para saber quanto pagou de imposto no ano. Na Granninha, o DAS de cada mês aparece no painel, em Meu MEI e em Contas, e você marca quando pagar.',
    ]],
  },
  lp7: {
    slug: 'como-nao-atrasar-contas-do-mei',
    titulo: 'Como não atrasar as contas do MEI e parar de pagar multa',
    desc: 'Aluguel, internet, fornecedor e DAS em dia: veja como ter o vencimento de cada conta à vista e parar de pagar multa por esquecimento.',
    guia: ['Como parar de atrasar as contas do negócio', [
      'Multa por atraso é dinheiro jogado fora. Em boleto, costuma vir 2% de multa mais juros por dia, e no fim do ano isso soma um valor que faria diferença no caixa.',
      'O primeiro passo é ter todas as contas do negócio num lugar só, com valor e dia de vencimento: aluguel, internet, fornecedor, contador, DAS. Conta que se repete todo mês precisa ser anotada uma vez só.',
      'O segundo é olhar o que vence com antecedência suficiente para separar o dinheiro. Com as contas num lugar só, basta abrir o painel ou perguntar no WhatsApp “o que vence até sexta?”, sem procurar boleto no meio dos e-mails.',
    ]],
  },
  lp8: {
    slug: 'alternativa-a-planilha-financeira-para-mei',
    titulo: 'Alternativa à planilha financeira para MEI',
    desc: 'Cansou da planilha de controle financeiro? Veja como controlar o MEI por mensagem no WhatsApp e ainda baixar seus dados em planilha quando quiser.',
    guia: ['Uma alternativa à planilha financeira para o MEI', [
      'A planilha é o primeiro controle de quase todo MEI, e também o primeiro a ser abandonado. Ela pede computador, disciplina para abrir todo dia e cuidado com fórmula. Basta uma semana corrida para os lançamentos atrasarem e o controle virar retrabalho.',
      'A alternativa é lançar no momento em que a venda ou o gasto acontece, pelo celular, do jeito que você fala. Uma mensagem no WhatsApp leva segundos, e a organização em categorias, contas e meses fica por conta da assistente.',
      'Quem gosta de planilha não perde nada: os dados continuam seus e podem ser baixados em planilha quando você quiser, por exemplo para mandar ao contador.',
    ]],
  },
  lp9: {
    slug: 'controle-financeiro-rapido-para-mei',
    titulo: 'Controle financeiro rápido para MEI sem tempo',
    desc: 'Controle financeiro do MEI em segundos por dia: lance cada venda e cada gasto por mensagem no WhatsApp, na hora em que acontecem.',
    guia: ['Controle financeiro para quem não tem tempo', [
      'Quem é MEI faz tudo: atende, produz, entrega, cobra. Sobra pouco tempo para sentar e organizar as contas, e o controle financeiro acaba ficando para o fim de semana, que nunca chega.',
      'O controle que funciona para quem não tem tempo é o que acontece junto com o trabalho. Terminou um serviço, manda “recebi 380”. Abasteceu, manda “gasolina 45”. São alguns segundos por lançamento, sem abrir sistema.',
      'Com o dia a dia anotado assim, as respostas ficam prontas quando você precisa: quanto entrou hoje, quanto sobrou na semana, o que vence até sexta.',
    ]],
  },
  lp10: {
    slug: 'como-controlar-clientes-que-devem-fiado',
    titulo: 'Como controlar clientes que devem e o fiado do MEI',
    desc: 'Anote quem te deve, quanto e até quando, e veja quem está em aberto na hora de cobrar. Controle de fiado e contas a receber para MEI pelo WhatsApp.',
    guia: ['Como controlar quem te deve', [
      'Vender fiado, aceitar pagamento depois ou parcelar um serviço é comum no dia a dia do MEI. O risco é esquecer quem deve, quanto e até quando, e o dinheiro simplesmente não voltar.',
      'Para cada valor a receber, anote três coisas: o nome do cliente, o valor e a data combinada. Quando o cliente pagar uma parte, registre o pagamento parcial para saber quanto ainda falta.',
      'No dia combinado, você precisa lembrar de cobrar. Com a lista de quem está em aberto sempre à mão, a cobrança fica mais fácil e menos constrangedora, porque você sabe exatamente o que foi combinado.',
    ]],
  },
  lp11: {
    slug: 'como-controlar-cartao-de-credito-do-mei',
    titulo: 'Como controlar o cartão de crédito do MEI',
    desc: 'Compras no crédito, parcelas e fatura do MEI sob controle: veja como registrar cada compra na fatura certa e evitar susto no vencimento.',
    guia: ['Como controlar o cartão de crédito do MEI', [
      'O cartão de crédito confunde o controle porque a compra acontece num mês e o dinheiro sai em outro. Se você anota a compra como gasto no dia, o mês fica errado. Se não anota, a fatura chega maior do que você lembrava.',
      'O jeito certo é registrar cada compra na fatura do cartão, com as parcelas quando houver, e só contar como gasto no mês em que você paga a fatura. Assim o caixa mostra o dinheiro que realmente saiu.',
      'Ter o dia de fechamento e o dia de vencimento de cada cartão anotados ajuda a saber quanto já está comprometido antes da fatura chegar.',
    ]],
  },
  lp12: {
    slug: 'como-organizar-comprovantes-do-mei',
    titulo: 'Como organizar os comprovantes do MEI',
    desc: 'Comprovante de Pix, nota e boleto organizados: mande a foto pelo WhatsApp, o valor é lançado e a imagem fica guardada junto do lançamento.',
    guia: ['Como organizar os comprovantes do MEI', [
      'O MEI precisa guardar as notas fiscais de compra e venda e preencher todo mês o relatório mensal das receitas brutas. Na prática, os comprovantes ficam espalhados entre a galeria do celular, o e-mail e a gaveta.',
      'O melhor momento de organizar um comprovante é quando ele chega. Tirou a foto do Pix ou da nota, já manda para o lugar onde o controle financeiro está. O valor vira lançamento e a imagem fica anexada a ele.',
      'Quando o contador pedir ou quando você precisar conferir um pagamento, o comprovante está junto do lançamento, no mês certo, sem precisar procurar.',
    ]],
  },
  lp13: {
    slug: 'controle-financeiro-por-audio-no-whatsapp',
    titulo: 'Controle financeiro por áudio no WhatsApp',
    desc: 'Lance vendas e gastos do MEI mandando áudio no WhatsApp. A assistente entende o que você falou e anota no seu controle financeiro.',
    guia: ['Como fazer o controle financeiro por áudio', [
      'Tem dia em que digitar é impossível: você está dirigindo, com a mão suja de trabalho ou atendendo um cliente. Mandar um áudio de poucos segundos é bem mais fácil.',
      'No controle por áudio, você fala do seu jeito, como “gastei 80 de material na loja do Zé”. A assistente transcreve, entende o valor, a categoria e o dia, e responde por escrito com o que anotou.',
      'Como a resposta mostra o que foi entendido, dá para conferir na hora e corrigir se algo veio errado. Isso garante que o controle continua confiável mesmo lançando tudo por voz.',
    ]],
  },
  lp14: {
    slug: 'como-organizar-o-financeiro-do-mei-para-o-contador',
    titulo: 'Como organizar o financeiro do MEI para o contador',
    desc: 'Entradas, saídas, comprovantes e faturamento do ano prontos para o contador e para a declaração anual do MEI, em planilha e PDF.',
    guia: ['Como chegar no contador com tudo organizado', [
      'Todo ano o MEI entrega a declaração anual, a DASN-SIMEI, até 31 de maio, informando quanto faturou no ano anterior. Além disso, precisa preencher o relatório mensal das receitas brutas e guardar as notas.',
      'Quando os lançamentos são feitos ao longo do mês, esses números já estão prontos na hora de declarar: faturamento por mês, total do ano, despesas por categoria e os comprovantes de cada uma.',
      'Com o relatório em planilha ou PDF, o contador trabalha mais rápido e com menos chance de erro, e você evita a correria de juntar papel no fim do prazo.',
    ]],
  },
  lp15: {
    slug: 'para-onde-vai-o-dinheiro-do-meu-negocio',
    titulo: 'Para onde vai o dinheiro do meu negócio?',
    desc: 'Entra dinheiro e não sobra? Veja como descobrir para onde vai o dinheiro do negócio separando cada gasto por categoria.',
    guia: ['Como descobrir para onde vai o dinheiro do negócio', [
      'Quando o dinheiro entra e no fim do mês não sobra, quase sempre o problema está nos gastos pequenos e repetidos: o material comprado aos poucos, o combustível, o lanche do dia, as taxas.',
      'Para enxergar isso, cada gasto precisa ser anotado com uma categoria. No fim do mês, somando por categoria, aparece onde está o peso: às vezes o maior gasto não é o que você imaginava.',
      'Comparar com o mês anterior mostra o que subiu. Com esse número na mão, fica mais fácil cortar, renegociar com fornecedor ou ajustar o preço do que você vende.',
    ]],
  },
  lp16: {
    slug: 'como-controlar-contas-fixas-do-mei',
    titulo: 'Como controlar as contas fixas do MEI',
    desc: 'Aluguel, internet, contador e DAS: anote cada conta fixa uma vez, veja o que vence a cada mês e saiba quanto o seu negócio precisa vender para pagar tudo.',
    guia: ['Como controlar as contas fixas do MEI', [
      'Contas fixas são as que chegam todo mês, vendendo ou não: aluguel, internet, contador, DAS, sistema, telefone. Somadas, elas mostram o mínimo que o negócio precisa faturar para se pagar.',
      'Cada conta fixa precisa ser anotada uma vez, com valor e dia de vencimento. A partir daí, ela entra de novo todo mês nas contas a pagar e você só confirma o pagamento.',
      'Quando o valor muda, como a luz que vem diferente a cada mês, o certo é registrar o que foi pago de verdade. Assim o controle reflete o gasto real e não uma estimativa.',
    ]],
  },
  lp17: {
    slug: 'como-controlar-compras-parceladas-do-mei',
    titulo: 'Como controlar as compras parceladas do MEI',
    desc: 'Material em 4x, equipamento em 10x: veja como controlar cada parcela, ver quando cada uma vence e saber quanto ainda falta pagar.',
    guia: ['Como controlar compras parceladas no negócio', [
      'Parcelar ajuda o caixa do MEI, mas várias compras parceladas ao mesmo tempo viram uma conta difícil de acompanhar. Quando você percebe, metade do faturamento do mês já está comprometida.',
      'Para cada compra parcelada, anote o valor total, o número de parcelas e quando vence a primeira. Assim cada parcela vira um compromisso com data, no boleto ou na fatura do cartão.',
      'Saber quanto ainda falta pagar em parcelas é o número que ajuda a decidir se dá para assumir uma compra nova ou se é melhor esperar.',
    ]],
  },
  lp18: {
    slug: 'como-juntar-contas-de-banco-dinheiro-e-maquininha',
    titulo: 'Como controlar várias contas de banco, dinheiro e maquininha',
    desc: 'Nubank, Inter, dinheiro em espécie e maquininha num controle só, sem conectar o banco. Veja como saber o saldo de tudo junto.',
    guia: ['Como controlar várias contas do negócio num lugar só', [
      'É comum o MEI receber no Pix de um banco, na maquininha que deposita em outro e em dinheiro na mão. Com o dinheiro espalhado, ninguém sabe ao certo quanto o negócio tem.',
      'A solução é registrar cada conta separadamente, banco por banco, dinheiro e maquininha, e anotar cada entrada e saída na conta de onde ela veio. Transferências entre contas são registradas como transferência, para não parecer venda nem gasto.',
      'Você não precisa conectar o banco a nenhum sistema. Basta informar na hora do lançamento de onde entrou ou saiu o dinheiro.',
    ]],
  },
  lp19: {
    slug: 'aplicativo-de-financas-simples-para-mei',
    titulo: 'Aplicativo de finanças simples para MEI',
    desc: 'Desistiu de aplicativo de finanças complicado? Conheça um controle financeiro para MEI que funciona dentro do WhatsApp que você já usa.',
    guia: ['O que um controle financeiro simples para MEI precisa ter', [
      'Muito aplicativo de finanças foi pensado para quem gosta de planilha: cadastro de categoria, formulário com cinco campos, gráfico logo na primeira tela. Para quem trabalha o dia inteiro, isso vira mais uma tarefa e é abandonado em poucas semanas.',
      'Um controle simples para MEI precisa de três coisas: lançar em segundos, aceitar o jeito que você fala e corrigir fácil quando errar. Se a pessoa precisa aprender a usar, ela não vai usar.',
      'Por isso faz sentido usar o WhatsApp, que todo mundo já sabe usar. Você manda a mensagem, a assistente confirma o que anotou e você corrige falando normalmente.',
    ]],
  },
  lp20: {
    slug: 'resumo-financeiro-semanal-para-mei',
    titulo: 'Resumo financeiro semanal para MEI',
    desc: 'Saiba como foi a semana do seu MEI: quanto entrou, quanto saiu e o que vence na próxima semana. Pergunte no WhatsApp quando quiser.',
    guia: ['Por que olhar o financeiro toda semana', [
      'Olhar o financeiro só no fim do mês é tarde demais para corrigir alguma coisa. Uma olhada por semana mostra se as vendas estão no ritmo, se algum gasto saiu do normal e o que vence nos próximos dias.',
      'O resumo semanal funciona melhor com dia e hora fixos, para virar hábito. Domingo à noite é um bom momento para perguntar como foi a semana e planejar a que começa.',
      'Com os números da semana na mão, dá para separar com antecedência o dinheiro das contas e acompanhar a evolução do negócio sem abrir relatório.',
    ]],
  },
  lp21: {
    slug: 'como-ter-controle-do-dinheiro-do-negocio',
    titulo: 'Como ter controle do dinheiro do negócio',
    desc: 'Pare de fazer conta de cabeça: pergunte no WhatsApp quanto entrou, quanto saiu e o que vence, e tenha a resposta com os seus números.',
    guia: ['Como ter controle do dinheiro do negócio', [
      'Não saber como está o dinheiro do negócio gera ansiedade. A conta fica rodando na cabeça: será que dá para pagar o fornecedor, será que sobrou alguma coisa este mês.',
      'Ter controle é poder responder essas perguntas na hora, com número e não com sensação. Para isso, o dia a dia precisa estar anotado: entradas, saídas, contas a pagar e valores a receber.',
      'Quando a resposta está a uma mensagem de distância, a decisão fica mais tranquila: você sabe o que pode gastar, o que precisa guardar e o que vence.',
    ]],
  },
  lp22: {
    slug: 'financeiro-para-quem-acabou-de-abrir-mei',
    titulo: 'Financeiro para quem acabou de abrir o MEI',
    desc: 'Acabou de abrir o MEI? Veja como organizar o financeiro desde o primeiro mês: separar casa e negócio, pagar o DAS e acompanhar o limite.',
    guia: ['Como organizar o financeiro de um MEI recém-aberto', [
      'O primeiro mês do MEI é o melhor momento para criar o hábito de controle. Três cuidados fazem diferença desde o início: separar o dinheiro do negócio do pessoal, pagar o DAS até o dia 20 de cada mês e anotar todo o faturamento.',
      'No ano em que o CNPJ é aberto, o limite de faturamento é proporcional aos meses de atividade, cerca de R$ 6.750 por mês. Por isso acompanhar desde a primeira venda evita surpresa no fim do ano.',
      'Outras obrigações vêm depois, como a declaração anual até 31 de maio. Com tudo anotado desde o começo, ela fica simples.',
    ]],
  },
  lp23: {
    slug: 'substituir-caderno-de-contas-por-whatsapp',
    titulo: 'Como trocar o caderno de contas pelo WhatsApp',
    desc: 'O caderninho de vendas e fiado some e não faz conta. Veja como passar o controle do caderno para mensagens no WhatsApp.',
    guia: ['Como sair do caderninho de contas', [
      'O caderno é simples e por isso tanta gente usa. Mas ele não soma sozinho, não mostra quem está devendo, não organiza as contas e some no dia em que você mais precisa.',
      'A troca que funciona mantém a simplicidade do caderno: você continua escrevendo do seu jeito, só que numa mensagem de WhatsApp. “Vendi 240 no dinheiro”, “a Bia me deve 60”.',
      'A diferença é que agora as contas são feitas por você: total da semana, quem está devendo, quanto sobrou. E nada se perde.',
    ]],
  },
  lp24: {
    slug: 'como-registrar-pix-recebido-no-controle-financeiro',
    titulo: 'Como registrar o Pix recebido no controle financeiro',
    desc: 'Mande o print do Pix recebido ou pago no WhatsApp e o valor é lançado no seu controle financeiro, com o comprovante guardado.',
    guia: ['Como registrar Pix no controle financeiro do MEI', [
      'O Pix virou a principal forma de receber de muito MEI. O problema é que, no extrato, os Pix do negócio aparecem misturados com os pessoais, e dá trabalho separar no fim do mês.',
      'O jeito mais rápido é registrar cada Pix na hora: encaminhar o print do comprovante para o seu controle. A leitura do comprovante pega o valor, quem pagou ou recebeu e a data.',
      'Como a imagem fica guardada junto do lançamento, você tem o comprovante à mão se o cliente questionar ou se o contador pedir.',
    ]],
  },
  lp25: {
    slug: 'controle-financeiro-para-confeiteira-mei',
    titulo: 'Controle financeiro para confeiteira MEI',
    desc: 'Encomendas, ingredientes, embalagem e gás: controle financeiro para confeiteira MEI pelo WhatsApp, separando as contas de casa.',
    guia: ['Como fazer o controle financeiro da confeitaria', [
      'Na confeitaria, o maior risco é o gasto que se mistura com a casa: o gás, a luz, o ingrediente comprado junto com o mercado da família. Sem separar, parece que sobra dinheiro quando não sobra, ou o contrário.',
      'Anote cada encomenda paga, incluindo sinal e restante, e cada compra de ingrediente e embalagem. Quando um gasto for dividido com a casa, registre só a parte do negócio.',
      'Com isso, dá para ver quanto cada mês rendeu e conferir se o preço das encomendas está cobrindo os custos e o seu trabalho.',
    ]],
  },
  lp26: {
    slug: 'controle-financeiro-para-motorista-de-aplicativo',
    titulo: 'Controle financeiro para motorista de aplicativo',
    desc: 'Ganhos das corridas, combustível, manutenção e aluguel do carro num só lugar. Saiba quanto sobra de verdade como motorista de app.',
    guia: ['Como saber quanto sobra das corridas', [
      'O aplicativo mostra quanto você ganhou, mas não mostra quanto sobrou. Combustível, manutenção, troca de óleo, lavagem e aluguel do carro comem boa parte do valor das corridas.',
      'Para saber o ganho real, anote o que entrou no dia e cada gasto com o carro. Uma mensagem ou um áudio curto quando você estiver parado já resolve.',
      'Com os números da semana, dá para comparar dias e horários e decidir quando vale a pena rodar.',
    ]],
  },
  lp27: {
    slug: 'controle-financeiro-para-salao-de-beleza-mei',
    titulo: 'Controle financeiro para salão de beleza e manicure MEI',
    desc: 'Atendimentos, produtos e aluguel de cadeira anotados pelo WhatsApp. Controle financeiro para manicure, cabeleireira e profissionais de beleza MEI.',
    guia: ['Como controlar o financeiro de quem trabalha com beleza', [
      'Na beleza, o dinheiro entra em muitos atendimentos pequenos ao longo do dia, no Pix, no cartão e no dinheiro. Sem anotar, é difícil saber quanto o mês rendeu.',
      'Anote cada atendimento com o valor e cada compra de produto: esmalte, tintura, material descartável. Se você aluga cadeira ou divide o espaço, o aluguel entra como gasto do negócio.',
      'Assim você sabe quanto o seu trabalho realmente deu no mês e se o preço dos serviços está acompanhando o custo dos produtos.',
    ]],
  },
  lp28: {
    slug: 'controle-financeiro-para-prestador-de-servico-mei',
    titulo: 'Controle financeiro para eletricista, pintor e prestador de serviço MEI',
    desc: 'Serviços, material, combustível e clientes que pagam depois: controle financeiro para prestador de serviço MEI pelo WhatsApp.',
    guia: ['Como controlar o financeiro de quem presta serviço', [
      'Para quem presta serviço, o lucro de cada trabalho depende do material e do deslocamento. Quando esses gastos não são anotados, o serviço parece render mais do que rende.',
      'Anote o valor de cada serviço, o material comprado, com a foto da nota quando tiver, e o combustível. Cliente que paga depois entra como valor a receber, com a data combinada.',
      'No fim do mês, você vê quanto entrou, quanto foi de material e quem ainda está devendo.',
    ]],
  },
  lp29: {
    slug: 'controle-financeiro-para-revendedora',
    titulo: 'Controle financeiro para revendedora de roupa, cosmético e semijoia',
    desc: 'Mercadoria, vendas, fiado e parcelas: controle financeiro para revendedora MEI e saiba o lucro real depois de repor o estoque.',
    guia: ['Como saber o lucro real da revenda', [
      'Na revenda, é fácil confundir dinheiro em caixa com lucro. Parte do que entra precisa voltar para repor a mercadoria, e as vendas fiado ou parceladas ainda nem entraram.',
      'Anote cada compra de mercadoria e cada venda, inclusive as fiado e as parceladas, com quem deve e até quando. O frete e a embalagem também entram como gasto.',
      'Com vendas menos mercadoria e despesas, aparece o lucro de verdade, e fica claro se a margem está boa ou se o preço precisa subir.',
    ]],
  },
  lp30: {
    slug: 'controle-de-mensalidades-de-alunos',
    titulo: 'Controle de mensalidades de alunos para personal e professores',
    desc: 'Quem pagou e quem falta pagar: controle de mensalidades e aulas avulsas para personal, professores e aulas particulares pelo WhatsApp.',
    guia: ['Como controlar mensalidades de alunos', [
      'Com muitos alunos, cada um pagando num dia, é comum perder a conta de quem já pagou o mês. E cobrar alguém que já pagou é constrangedor.',
      'Anote cada pagamento assim que ele cair, e cada mensalidade em aberto com a data de vencimento. Aulas avulsas e pacotes entram do mesmo jeito.',
      'Com a lista de quem está em aberto atualizada, a cobrança fica certa e no dia combinado, e você sabe quanto vai entrar no mês.',
    ]],
  },
  lp31: {
    slug: 'controle-financeiro-para-delivery-e-marmita',
    titulo: 'Controle financeiro para delivery, marmita e comida por encomenda',
    desc: 'Vendas, mercado, embalagem e taxa do app de entrega: controle financeiro para quem vende comida e saiba quanto sobra de verdade.',
    guia: ['Como saber quanto sobra vendendo comida', [
      'Quem vende comida compra ingrediente quase todo dia e paga embalagem, gás e a taxa do aplicativo de entrega. Sem anotar, o lucro de cada marmita ou salgado fica no chute.',
      'Registre cada venda e cada ida ao mercado. No aplicativo de entrega, anote o repasse como entrada e a taxa como gasto, para ver o valor real que ficou.',
      'Com a semana anotada, dá para ver quanto o mercado está pesando e ajustar o preço ou o cardápio antes que o mês feche no vermelho.',
    ]],
  },
  lp32: {
    slug: 'controle-financeiro-para-artesa-mei',
    titulo: 'Controle financeiro para artesã e artesão MEI',
    desc: 'Material, vendas na feira, no Instagram e por encomenda: controle financeiro para artesanato MEI pelo WhatsApp.',
    guia: ['Como controlar o financeiro do artesanato', [
      'No artesanato, as vendas acontecem em vários lugares, como feira, Instagram e encomenda, e o material é comprado aos poucos. No fim do mês, é difícil dizer se o trabalho compensou.',
      'Anote cada venda e cada compra de material, além dos custos da feira e do frete. Uma mensagem por lançamento basta.',
      'Somando vendas e gastos, você vê quanto o artesanato rendeu e consegue conferir se o preço das peças paga o material e as horas de trabalho.',
    ]],
  },
  lp33: {
    slug: 'controle-de-caixa-para-loja-pequena',
    titulo: 'Controle de caixa para loja pequena pelo WhatsApp',
    desc: 'Vendas no dinheiro, Pix e maquininha, contas de fornecedor e fechamento do caixa do dia: controle de caixa para loja pequena pelo WhatsApp.',
    guia: ['Como fechar o caixa da loja todo dia', [
      'Fechar o caixa é conferir, no fim do dia, quanto entrou em cada forma de pagamento e quanto saiu. Sem isso, diferença de valor e venda esquecida só aparecem quando já é tarde.',
      'Ao longo do dia, anote cada venda com a forma de pagamento: dinheiro, Pix ou maquininha. Pagamentos a fornecedor e retiradas também entram.',
      'No fim do dia, o total por forma de pagamento está pronto para conferir com a gaveta e o extrato da maquininha. O mês organizado é a soma desses dias.',
    ]],
  },
}
