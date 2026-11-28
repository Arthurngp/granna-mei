/**
 * Dados de exemplo do admin. Só entra no build quando `VITE_ADMIN_MOCK=1` (ver sb.ts); em produção este arquivo nem é empacotado.
 * Serve para olhar as telas sem login e sem o código do autenticador. Os números são inventados de propósito.
 */

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

/** Uso do mês de cada cliente do exemplo (igual às mensagens do mês da lista) e o limite configurável, para olhar as telas do limite. */
const USO_EXEMPLO: Record<string, number> = { c1: 41, c2: 33, c3: 27, c4: 12, c5: 9, c6: 0 }
const limites = { padrao: 300, proprio: { c5: 80 } as Record<string, number> }
/** Recursos de plano superior liberados (só para olhar a tela). Um cliente de exemplo já vem com o resumo diário liberado. */
const recursosMock: Record<string, { motivo: string; desde: string }> = { c2: { motivo: 'plano superior combinado', desde: '2026-11-20T15:00:00Z' } }

// Envios pelo sistema: um já saiu, um falhou e um espera na fila, para a tela mostrar os quatro estados. `?limpo` começa sem nenhum.
interface EnvioMock {
  id: string
  user_id: string
  status: 'fila' | 'enviado' | 'falhou' | 'cancelado'
  pedido_em: string
  enviado_em?: string
  erro?: string
}
const semExemplo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('limpo')
let enviosMock: EnvioMock[] = semExemplo
  ? []
  : [
      { id: 'm-a', user_id: 'sumiu-Rafael Dias', status: 'enviado', pedido_em: new Date(Date.now() - 50 * 60_000).toISOString(), enviado_em: new Date(Date.now() - 47 * 60_000).toISOString() },
      { id: 'm-b', user_id: 'nunca-Paulo Reis', status: 'falhou', pedido_em: new Date(Date.now() - 30 * 60_000).toISOString(), erro: 'gateway recusou' },
      { id: 'm-c', user_id: 'nunca-Marina Costa', status: 'fila', pedido_em: new Date(Date.now() - 60_000).toISOString() },
    ]
const ultimoEnvioMock = Date.now() - 2 * 60_000

/** Lembretes de retenção (só para olhar a tela; a regra de verdade é do banco). Os textos e as faixas são os que a migration semeia. */
const lembretes = {
  regras: [
    { regra: 'nunca_mandou', modo: 'desligado', atraso_horas: 24, atualizado_em: new Date().toISOString(), enviados_7d: 0, texto: 'Oi, {nome}! Aqui é a Granninha. Vi que você ainda não me mandou nenhum lançamento. É só escrever do seu jeito, por exemplo "recebi 300 de um serviço" ou "gasolina 60 pro negócio", que eu anoto pra você.' },
    { regra: 'parou_de_usar', modo: 'desligado', atraso_horas: 48, atualizado_em: new Date().toISOString(), enviados_7d: 0, texto: 'Oi, {nome}! Faz uns dias que você não me manda nada. Se teve venda ou gasto nesse tempo, me conta por aqui que eu anoto, e você não perde o controle do mês.' },
  ] as { regra: string; modo: string; atraso_horas: number; atualizado_em: string; enviados_7d: number; texto: string; etapas: { etapa: number; ativa: boolean; atraso_horas: number; texto: string; atualizado_em: string }[] }[],
}
for (const r of lembretes.regras) {
  r.etapas = [
    { etapa: 2, ativa: false, atraso_horas: 96, atualizado_em: new Date().toISOString(), texto: 'Oi, {nome}! Tô passando de novo por aqui. Se você recebeu ou pagou alguma coisa e não me contou, me manda que eu anoto, do seu jeito.' },
    { etapa: 3, ativa: false, atraso_horas: 240, atualizado_em: new Date().toISOString(), texto: 'Oi, {nome}! Essa é a última vez que te chamo por aqui. Quando quiser começar, é só me mandar um gasto ou uma venda, tipo "paguei 80 de material", que eu anoto.' },
  ]
}
const ruido = (i: number) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1

function somaDias(iso: string, d: number) {
  const x = new Date(`${iso}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + d)
  return x.toISOString().slice(0, 10)
}

/** Um dia de consumo. Setembro é vazio (testa o estado sem dados); em cada mês um dia tem pico de volume e outro de áudio. */
function dia(iso: string) {
  const mes = iso.slice(0, 7)
  if (mes === '2026-09') return { dia: iso, entrada: 0, saida: 0, audio_tokens: 0, audio_seg: 0, mensagens: 0, clientes: 0 }
  const k = Number(iso.slice(8, 10))
  let msgs = Math.round((34 + 22 * ruido(k + 3) + k * 0.9) * (mes === '2026-10' ? 0.78 : 1))
  let audioTokens = Math.round(msgs * 0.07) * 1500
  if (k === 12) msgs = Math.round(msgs * 3.4)
  if (k === 19) audioTokens = Math.round(msgs * 0.55) * 1500
  return { dia: iso, entrada: msgs * 2211, saida: msgs * 148, audio_tokens: audioTokens, audio_seg: 0, mensagens: msgs, clientes: Math.min(14, 6 + Math.round(msgs / 12)) }
}

function periodo(inicio: string, fim: string) {
  const ate = fim < hojeSP() ? fim : hojeSP()
  const dias = []
  // Foto e documento são PARTE da entrada (como no banco): cerca de 12% e 4% dela, para a tela mostrar as duas fatias.
  for (let d = inicio; d <= ate; d = somaDias(d, 1)) {
    const x = dia(d)
    dias.push({ ...x, entrada_foto: Math.round(x.entrada * 0.12), entrada_pdf: Math.round(x.entrada * 0.04) })
  }
  const totalMsgs = dias.reduce((s, x) => s + x.mensagens, 0)
  const nomes: [string, string][] = [['Marina Costa', 'Studio Marina'], ['João Pedro', 'JP Reformas'], ['Aline Souza', 'Aline Doces'], ['Carlos Lima', 'Lima Fretes'], ['Bruna Alves', 'Bruna Nails'], ['Rafael Dias', 'RD Elétrica']]
  const pesos = [0.28, 0.22, 0.17, 0.14, 0.11, 0.08]
  const soma = dias.reduce((a, x) => ({ entrada: a.entrada + x.entrada, saida: a.saida + x.saida, audio_tokens: a.audio_tokens + x.audio_tokens, audio_seg: 0, entrada_foto: a.entrada_foto + x.entrada_foto, entrada_pdf: a.entrada_pdf + x.entrada_pdf }), { entrada: 0, saida: 0, audio_tokens: 0, audio_seg: 0, entrada_foto: 0, entrada_pdf: 0 })
  return {
    inicio,
    fim: ate,
    dias,
    totais: { mensagens: totalMsgs, clientes: totalMsgs ? 18 : 0, estimadas: totalMsgs ? 120 : 0, audios_sem_medida: totalMsgs ? 14 : 0 },
    por_cliente: totalMsgs
      ? nomes.map(([nome, negocio], i) => ({ user_id: `u${i}`, nome, negocio, mensagens: Math.round(totalMsgs * pesos[i]), entrada: Math.round(soma.entrada * pesos[i]), saida: Math.round(soma.saida * pesos[i]), audio_tokens: Math.round(soma.audio_tokens * pesos[i]), audio_seg: 0, entrada_foto: Math.round(soma.entrada_foto * pesos[i]), entrada_pdf: Math.round(soma.entrada_pdf * pesos[i]) }))
      : [],
    por_modelo: totalMsgs
      ? [
          { modelo: 'gpt-5.4-mini', chamadas: 212, reserva: 38, pedidos: ['gpt-4.1-nano'], sem_preco: 0, entrada: 640000, saida: 52000, cache: 210000, custo_usd: 0.6612 },
          { modelo: 'gpt-4.1-mini', chamadas: 174, reserva: 0, pedidos: null, sem_preco: 0, entrada: 520000, saida: 31000, cache: 160000, custo_usd: 0.2136 },
          { modelo: 'gpt-4o-mini-transcribe', chamadas: 41, reserva: 0, pedidos: null, sem_preco: 0, entrada: 0, saida: 3900, cache: 0, custo_usd: 0.0412 },
        ]
      : [],
    meses: ['2026-11', '2026-10', '2026-09'],
  }
}

function painel() {
  const hoje = hojeSP()
  const mensagens_por_dia = Array.from({ length: 30 }, (_, i) => {
    const d = somaDias(hoje, i - 29)
    const m = dia(d).mensagens
    return { dia: d, n: m, tokens: m * 2359 }
  })
  return {
    clientes: 38,
    por_situacao: { ativa: 10, trial: 14, teste_vencido: 5, cortesia: 6, bloqueada: 2, atrasada: 1 },
    novos_7d: 10,
    numeros_confirmados: 24,
    onboarding: { '0': 3, '1': 2, '2': 4, '3': 2, '4': 1, '5': 3, '6': 6, '7': 17 },
    mensagens_hoje: 63,
    respondidas_hoje: 61,
    erros_24h: 2,
    ultimos_erros: [
      { criado_em: new Date(Date.now() - 3600_000).toISOString(), tipo: 'audio', erro: 'Transcrição demorou mais de 30 segundos' },
      { criado_em: new Date(Date.now() - 9 * 3600_000).toISOString(), tipo: 'texto', erro: 'OpenAI respondeu 429' },
    ],
    ultima_mensagem: new Date(Date.now() - 4 * 60_000).toISOString(),
    tokens_hoje: 63 * 2359,
    tokens_mes: 1_280_000,
    midias_mes: 310,
    mensagens_por_dia,
    maiores_consumidores: [],
    saude: { whatsapp_estado: 'CONNECTED', whatsapp_numero: '5581999990000', fila: 0, atualizado_em: new Date().toISOString() },
  }
}

function ativacao() {
  const semanas = ['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19']
  const coortes = [
    { cadastros: 11, confirmaram: 8, com_mensagem: 6, passos: { '1': 1, '2': 2, '6': 2, '7': 6 } },
    { cadastros: 14, confirmaram: 10, com_mensagem: 8, passos: { '0': 2, '2': 2, '5': 1, '6': 1, '7': 8 } },
    { cadastros: 8, confirmaram: 5, com_mensagem: 4, passos: { '0': 1, '3': 1, '6': 2, '7': 4 } },
    { cadastros: 3, confirmaram: 1, com_mensagem: 1, passos: { '2': 1, '7': 2 } },
    { cadastros: 2, confirmaram: 0, com_mensagem: 0, passos: { '0': 2 } },
  ]
  return {
    total: 38,
    passos: { '0': 3, '1': 2, '2': 4, '3': 2, '4': 1, '5': 3, '6': 6, '7': 17 },
    confirmaram: 24,
    com_mensagem: 19,
    mediana_horas_ate_primeira: 3.4,
    coortes: coortes.map((c, i) => ({ semana: semanas[i], ...c })),
  }
}

function acoes() {
  const agora = Date.now()
  const iso = (dias: number) => new Date(agora - dias * 86_400_000).toISOString()
  const mk = (grupo: string, nome: string, negocio: string, dias: number, passo: number, status: string, tel: string) => ({
    user_id: `${grupo}-${nome}`, nome, negocio, whats: tel, grupo, status, passo, criado_em: iso(dias + (grupo === 'sumiu' ? 20 : 0)), ultima: grupo === 'sumiu' ? iso(dias) : null, dias,
  })
  const itens = [
    mk('bloq', 'Heitor Nunes', 'HN Marcenaria', 30, 7, 'bloqueada', '(81) 98811-2001'),
    mk('bloq', 'Isabela Cruz', 'Bela Estética', 21, 7, 'atrasada', '(81) 98811-2002'),
    mk('bloq', 'Otávio Lima', 'OL Gesso', 14, 7, 'trial', '(81) 98811-2003'),
    mk('sumiu', 'Aline Souza', 'Aline Doces', 8, 7, 'trial', '(81) 98811-2004'),
    mk('sumiu', 'Bruna Alves', 'Bruna Nails', 7, 7, 'trial', '(81) 98811-2005'),
    mk('sumiu', 'Carlos Lima', 'Lima Fretes', 12, 7, 'trial', '(81) 98811-2006'),
    mk('sumiu', 'Rafael Dias', 'RD Elétrica', 9, 7, 'trial', '(81) 98811-2007'),
    mk('nunca', 'Sônia Vaz', 'Doces da Sônia', 1, 7, 'trial', '(81) 98811-2008'),
    mk('nunca', 'Larissa Gomes', 'Lari Cílios', 2, 7, 'trial', '(81) 98811-2009'),
    mk('nunca', 'Marina Costa', 'Studio Marina', 3, 7, 'trial', '(81) 98811-2010'),
    mk('nunca', 'Paulo Reis', 'PR Pintura', 5, 7, 'trial', '(81) 98811-2011'),
    mk('nunca', 'Diego Matos', 'DM Elétrica', 9, 7, 'trial', '(81) 98811-2012'),
    // Quem só digitou o número no cadastro (migration contatoscadastro): o banco manda verificado:false, e-mail, ramo e ocupação.
    ...[
      mk('whats', 'Eduardo Pires', 'EP Reformas', 0, 7, 'trial', '(81) 98811-2013'),
      mk('whats', 'Márcio Dias', 'MD Ar Condicionado', 1, 6, 'trial', '(81) 98811-2014'),
      mk('whats', 'Tiago Bento', 'TB Fretes', 4, 6, 'trial', '(81) 98811-2015'),
      mk('cadastro', 'Vera Alves', 'Vera Costuras', 0, 2, 'trial', '(81) 98811-2016'),
      mk('cadastro', 'Camila Rocha', 'Studio Camila', 0, 1, 'trial', '(81) 98811-2017'),
      mk('cadastro', 'Joana Lins', 'Joana Bolos', 2, 3, 'trial', '(81) 98811-2018'),
      mk('cadastro', 'Nilo Prado', '', 1, 1, 'trial', '(81) 98811-2019'),
    ].map((i, k) => ({ ...i, verificado: false, sair: i.nome === 'Nilo Prado', ramo: k % 2 ? 'outro' : 'beleza', ocupacao: k % 2 ? 'tatuador' : '', email: `${i.nome.split(' ')[0].toLowerCase()}@exemplo.com` })),
    ...[mk('semfone', 'Rita Moura', '', 0, 0, 'trial', ''), mk('semfone', 'Fábio Teles', '', 1, 0, 'trial', '')].map((i) => ({ ...i, verificado: false, sair: false, ramo: '', ocupacao: '', email: `${i.nome.split(' ')[0].toLowerCase()}@exemplo.com` })),
  ]
  const contagem: Record<string, number> = {}
  for (const i of itens) contagem[i.grupo] = (contagem[i.grupo] ?? 0) + 1
  return { contagem, itens }
}

function retencao() {
  const sem = [6, 8, 9, 11, 12, 13, 15, 14]
  const novos = [4, 3, 2, 3, 2, 3, 4, 3]
  const reat = [0, 0, 1, 0, 1, 0, 0, 1]
  const base = new Date(`${hojeSP()}T12:00:00Z`)
  const segunda = new Date(base)
  segunda.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7))
  const semanas = sem.map((total, i) => {
    const d = new Date(segunda)
    d.setUTCDate(segunda.getUTCDate() - 7 * (7 - i))
    return { semana: d.toISOString().slice(0, 10), total, novos: novos[i], voltaram: total - novos[i] - reat[i], reativados: reat[i] }
  })
  const cs = (k: number) => semanas[k].semana
  return {
    semana_atual: semanas[7].semana,
    semanas,
    ativos_semana: 14,
    confirmados: 24,
    voltaram_pct: 71,
    sumiram: 4,
    habito: { um: 3, dois_tres: 5, quatro_cinco: 4, seis_sete: 2, media: 3.4 },
    coortes: [
      { semana: cs(3), n: 2, vals: [100, 50, 50, 50, 0] },
      { semana: cs(4), n: 3, vals: [100, 67, 67, 33] },
      { semana: cs(5), n: 4, vals: [100, 75, 50] },
      { semana: cs(6), n: 8, vals: [100, 71] },
      { semana: cs(7), n: 6, vals: [100] },
    ],
  }
}

function publico(vazio: boolean) {
  const seg = (dim: string, grupo: string, pessoas: number, ativos7: number, msgs7: number) => ({ dim, grupo, pessoas, confirmados: pessoas, ativos7, msgs7, entrada: msgs7 * 2211 * 4, saida: msgs7 * 148 * 4, audio_tokens: msgs7 * 90, audio_seg: 0 })
  const ramos = [seg('ramo', 'beleza', 9, 6, 144), seg('ramo', 'alimentacao', 8, 4, 76), seg('ramo', 'comercio', 6, 2, 20), seg('ramo', 'servicos', 5, 2, 24), seg('ramo', 'obras', 3, 1, 6), seg('ramo', 'outro', 3, 1, 9), seg('ramo', 'transporte', 2, 1, 8), seg('ramo', 'moda', 2, 1, 14)]
  const perfis = vazio ? [] : [
    seg('idade', 'Até 24', 1, 1, 33), seg('idade', '25 a 34', 3, 3, 78), seg('idade', '35 a 44', 3, 2, 30), seg('idade', '45 a 54', 1, 0, 0), seg('idade', '55 ou mais', 1, 0, 0),
    seg('faturamento', 'ate_2', 2, 1, 18), seg('faturamento', '2_4', 3, 3, 75), seg('faturamento', '4_6750', 3, 2, 24), seg('faturamento', 'acima', 1, 1, 12),
    seg('cidade', 'Recife, PE', 4, 3, 60), seg('cidade', 'Jaboatão dos Guararapes, PE', 2, 1, 20), seg('cidade', 'Olinda, PE', 1, 1, 10), seg('cidade', 'Caruaru, PE', 1, 0, 0), seg('cidade', 'Petrolina, PE', 1, 1, 8),
  ]
  const p = (nome: string, negocio: string, ramo: string, cidade: string, idade: string | null, fat: string, dias: number, msgs7: number, situacao: string, ocupacao = '') => ({
    user_id: nome, nome, negocio, ramo, ocupacao, cidade: vazio ? '' : cidade, uf: vazio || !cidade ? '' : 'PE', faixa_idade: vazio ? null : idade, faturamento_faixa: vazio ? '' : fat, criado_em: new Date(Date.now() - dias * 86_400_000).toISOString(), msgs7, situacao,
  })
  return {
    cobertura: { total: 38, completos: vazio ? 0 : 9 },
    segmentos: [...ramos, ...perfis],
    outros: { total: 3, sem_ocupacao: 1, ocupacoes: [{ ocupacao: 'fotógrafa', n: 1 }, { ocupacao: 'tatuador', n: 1 }] },
    pessoas: [
      p('Marina Costa', 'Studio Marina', 'beleza', 'Recife', '25 a 34', '2_4', 9, 41, 'ativa'),
      p('Paulo Reis', 'PR Pintura', 'obras', 'Olinda', '35 a 44', '4_6750', 11, 0, 'trial'),
      p('Aline Souza', 'Aline Doces', 'alimentacao', 'Jaboatão dos Guararapes', '25 a 34', '2_4', 23, 27, 'ativa'),
      p('Carlos Lima', 'Lima Fretes', 'transporte', 'Recife', '45 a 54', 'acima', 18, 12, 'trial'),
      p('Bruna Alves', 'Bruna Nails', 'beleza', 'Caruaru', 'Até 24', 'ate_2', 3, 33, 'trial'),
      p('Rafael Dias', 'RD Elétrica', 'obras', 'Recife', '35 a 44', '4_6750', 15, 9, 'ativa'),
      p('Tiago Bento', 'TB Fretes', 'transporte', '', null, '', 4, 0, 'trial'),
      p('Júlia Prado', 'Júlia Fotos', 'outro', '', null, '', 6, 3, 'trial', 'Fotógrafa'),
    ],
  }
}

export async function mockRpc(nome: string, args: Record<string, unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 180))
  const vazio = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('vazio')
  switch (nome) {
    case 'admin_painel':
      return painel()
    case 'admin_custo_ia':
      return { mes: {}, hoje: {}, por_cliente: [] }
    case 'admin_custo_periodo':
      return periodo(String(args.p_inicio), String(args.p_fim))
    case 'admin_midias_mes':
      return { audio: 120, foto: 150, pdf: 40 }
    case 'admin_ativacao':
      return ativacao()
    case 'admin_acoes':
      return vazio ? { contagem: {}, itens: [] } : acoes()
    case 'admin_retencao':
      return retencao()
    case 'admin_publico':
      return publico(vazio)
    case 'admin_clientes': {
      const c = (i: number, nome: string, negocio: string, situacao: string, ver: boolean, msgs: number) => ({
        id: `c${i}`, nome, email: `${nome.split(' ')[0].toLowerCase()}@exemplo.com`, negocio, whats: `(81) 98811-20${String(i).padStart(2, '0')}`, verificado: ver, situacao, plano: 'mensal',
        trial_fim: '2026-12-31', motivo: null, criado_em: new Date(Date.now() - i * 86_400_000).toISOString(), ultimo_lancamento: ver ? new Date(Date.now() - i * 3_600_000 * 20).toISOString() : null,
        lancamentos: ver ? 40 - i : 0, mensagens_mes: msgs, onboarding_passo: ver ? 7 : 6, onboarding_feito: ver, papel: 'cliente',
      })
      return [c(1, 'Marina Costa', 'Studio Marina', 'ativa', true, 41), c(2, 'João Pedro', 'JP Reformas', 'trial', true, 33), c(3, 'Aline Souza', 'Aline Doces', 'ativa', true, 27), c(4, 'Carlos Lima', 'Lima Fretes', 'trial', true, 12), c(5, 'Bruna Alves', 'Bruna Nails', 'cortesia', true, 9), c(6, 'Tiago Bento', 'TB Fretes', 'trial', false, 0)]
    }
    case 'admin_auditoria_listar':
      return [
        { criado_em: new Date(Date.now() - 3 * 3_600_000).toISOString(), admin: 'Arthur', acao: 'estender teste', cliente: 'Marina Costa', detalhes: { motivo: 'parceira da NGP', antes: 'trial', depois: 'trial' } },
        { criado_em: new Date(Date.now() - 2 * 86_400_000).toISOString(), admin: 'Arthur', acao: 'cortesia', cliente: 'Bruna Alves', detalhes: { motivo: 'indicação', antes: 'trial', depois: 'cortesia' } },
        { criado_em: new Date(Date.now() - 9 * 86_400_000).toISOString(), admin: 'Arthur', acao: 'verificar numero', cliente: 'João Pedro', detalhes: { motivo: 'confirmou por telefone' } },
      ]
    case 'admin_origens':
      return {
        por_lp: [
          { lp: 'home', cadastros: 17, confirmados: 12, pagantes: 5 },
          { lp: '/lp2', cadastros: 8, confirmados: 5, pagantes: 2 },
          { lp: '/lp3', cadastros: 3, confirmados: 1, pagantes: 0 },
          { lp: 'sem origem', cadastros: 10, confirmados: 6, pagantes: 3 },
        ],
        por_campanha: [
          { campanha: 'bio', cadastros: 9 },
          { campanha: 'trial-dez', cadastros: 4 },
        ],
      }
    case 'admin_receita':
      return {
        faturas_pagas: { qtd: 0, total: 0 },
        faturas_abertas: { qtd: 0, total: 0 },
        por_mes: [],
        carteira: [
          { situacao: 'trial', plano: 'mensal', n: 14 },
          { situacao: 'ativa', plano: 'mensal', n: 10 },
          { situacao: 'cortesia', plano: 'mensal', n: 6 },
          { situacao: 'teste_vencido', plano: 'mensal', n: 5 },
          { situacao: 'bloqueada', plano: 'mensal', n: 2 },
          { situacao: 'atrasada', plano: 'mensal', n: 1 },
        ],
        trial_ate_fim: 14,
      }
    case 'admin_cliente':
      return { carteiras: [{ nome: 'Pessoal', tipo: 'pessoal' }, { nome: 'Negócio', tipo: 'mei' }], lancamentos_por_origem: { whatsapp: 9, painel: 2 }, contas_abertas: 1, fixas: 2, ultimas_mensagens: [], auditoria: [] }
    case 'admin_acao':
      // Só para olhar a tela: desfazer cortesia devolve um teste que ainda vale, ou um vencido se o motivo pedir ("vencido").
      return args.p_acao === 'desfazer_cortesia'
        ? { ok: true, situacao: 'trial', trial_fim: String(args.p_motivo).includes('vencido') ? '2026-11-10' : '2026-12-05' }
        : { ok: true, situacao: 'ativa', trial_fim: null }
    // Limite mensal de lançamentos (só para olhar as telas; a regra de verdade é do banco). Uso do mês: o das mensagens do exemplo.
    case 'admin_limite_cliente': {
      const uso = args.p_user ? (USO_EXEMPLO[String(args.p_user)] ?? 0) : 0
      const proprio = args.p_user ? (limites.proprio[String(args.p_user)] ?? null) : null
      return { padrao: limites.padrao, proprio, efetivo: proprio ?? limites.padrao, uso_mes: uso }
    }
    case 'admin_limite_definir': {
      const v = args.p_valor as number | null
      if (String(args.p_motivo ?? '').trim().length < 3) throw new Error('motivo obrigatório')
      if (args.p_user) {
        if (v === null) delete limites.proprio[String(args.p_user)]
        else limites.proprio[String(args.p_user)] = v
      } else {
        if (v === null || v < 1 || v > 100000) throw new Error('o limite vai de 1 a 100000')
        limites.padrao = v
      }
      const proprio = args.p_user ? (limites.proprio[String(args.p_user)] ?? null) : null
      return { ok: true, padrao: limites.padrao, proprio, efetivo: proprio ?? limites.padrao }
    }
    // Recursos de plano superior por cliente (só para olhar a tela; a regra de verdade é do banco).
    case 'admin_recursos_cliente': {
      const r = recursosMock[String(args.p_user)]
      return { liberados: r ? [{ recurso: 'resumo_diario_contas', motivo: r.motivo, desde: r.desde }] : [] }
    }
    case 'admin_recurso_definir': {
      if (String(args.p_motivo ?? '').trim().length < 3) throw new Error('motivo obrigatório')
      if (args.p_recurso !== 'resumo_diario_contas') throw new Error('recurso desconhecido')
      const u = String(args.p_user)
      if (args.p_ativo) recursosMock[u] = recursosMock[u] ?? { motivo: String(args.p_motivo).trim(), desde: new Date().toISOString() }
      else delete recursosMock[u]
      return { ok: true, recurso: args.p_recurso, liberado: !!args.p_ativo }
    }
    // Envio pelo sistema (só para olhar a tela; a fila, a espera e as recusas de verdade são do banco e do servidor).
    // ?semfila finge o banco sem a migration; ?limpo começa sem nenhum envio de exemplo.
    case 'admin_envios_fila': {
      if (new URLSearchParams(window.location.search).has('semfila')) throw new Error('Could not find the function public.admin_envios_fila in the schema cache')
      const ativos = enviosMock.filter((e) => e.status === 'fila').sort((a, b) => a.pedido_em.localeCompare(b.pedido_em))
      let prox = Math.max(Date.now(), ultimoEnvioMock + 5 * 60_000)
      const itens = ativos.map((e, k) => {
        const previsto_em = new Date(prox).toISOString()
        prox += 5 * 60_000
        return { id: e.id, user_id: e.user_id, status: 'fila', pedido_em: e.pedido_em, posicao: k + 1, previsto_em }
      })
      return {
        agora: new Date().toISOString(),
        espera_min: 5,
        ultimo_envio_em: new Date(ultimoEnvioMock).toISOString(),
        whatsapp_ok: !new URLSearchParams(window.location.search).has('whatsoff'),
        itens,
        frios: ['nunca-Larissa Gomes'],
        recentes: enviosMock.filter((e) => e.status === 'enviado' || e.status === 'falhou').map((e) => ({ id: e.id, user_id: e.user_id, status: e.status, enviado_em: e.enviado_em ?? null, erro: e.erro ?? null })),
      }
    }
    case 'admin_envio_pedir': {
      const u = String(args.p_user)
      if (!['nunca', 'sumiu', 'whats', 'cadastro'].includes(String(args.p_grupo))) throw new Error('este grupo não tem envio pelo sistema: use o link do WhatsApp')
      if (['whats', 'cadastro'].includes(String(args.p_grupo)) && !args.p_forcar) throw new Error('o WhatsApp desta pessoa não está confirmado: o número foi só digitado no cadastro')
      ;(window as unknown as { __pedido?: unknown }).__pedido = args // só para o teste de tela conferir o que foi enviado
      if ((u.includes('Larissa Gomes') || u.includes('Sônia Vaz')) && !args.p_forcar) throw new Error('esta pessoa nunca escreveu para o número atual: chamar primeiro pode bloquear o número')
      if (u.includes('Diego Matos')) throw new Error('esta pessoa respondeu SAIR e não quer receber mensagem')
      if (enviosMock.some((e) => e.user_id === u && e.status === 'fila')) return { ok: true, ja_na_fila: true }
      const id = `mock-${enviosMock.length + 1}`
      enviosMock = enviosMock.filter((e) => !(e.user_id === u && e.status === 'falhou'))
      enviosMock.push({ id, user_id: u, status: 'fila', pedido_em: new Date().toISOString() })
      return { ok: true, ja_na_fila: false, id }
    }
    case 'admin_envio_cancelar': {
      const e = enviosMock.find((x) => x.id === String(args.p_id) && x.status === 'fila')
      if (!e) return { ok: false, motivo: 'já saiu ou já foi cancelado' }
      e.status = 'cancelado'
      return { ok: true }
    }
    case 'admin_retencao_acompanhar': {
      const ha = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
      return {
        dias: Number(args.p_dias),
        por_regra: [
          { regra: 'nunca_mandou', etapa: 1, enviados: 12, medidos_24h: 10, responderam_24h: 4, medidos_48h: 8, lancaram_48h: 3, pediram_sair: 1 },
          { regra: 'nunca_mandou', etapa: 2, enviados: 5, medidos_24h: 4, responderam_24h: 1, medidos_48h: 3, lancaram_48h: 1, pediram_sair: 0 },
          { regra: 'parou_de_usar', etapa: 1, enviados: 7, medidos_24h: 5, responderam_24h: 0, medidos_48h: 0, lancaram_48h: 0, pediram_sair: 0 },
        ],
        ultimos: [
          { em: ha(2), regra: 'nunca_mandou', nome: 'Juan Pinheiro', negocio: 'Juan', respondeu: null, lancou: null, pediu_sair: false },
          { em: ha(30), regra: 'parou_de_usar', etapa: 1, nome: 'Marina Costa', negocio: 'Studio Marina', respondeu: true, lancou: null, pediu_sair: false },
          { em: ha(75), regra: 'nunca_mandou', etapa: 2, nome: 'Walmir Silva', negocio: 'Growthcode', respondeu: true, lancou: true, pediu_sair: false },
          { em: ha(100), regra: 'nunca_mandou', nome: 'Alvaro Melo', negocio: 'Alvaro Melo', respondeu: false, lancou: false, pediu_sair: true },
        ],
        fila: [
          { regra: 'nunca_mandou', modo: lembretes.regras[0].modo, atraso_horas: lembretes.regras[0].atraso_horas, agora: [], a_caminho: [{ nome: 'Carla Dias', negocio: 'Carla Doces', faltam_horas: 6 }, { nome: 'Pedro Alves', negocio: 'PA Fretes', faltam_horas: 19 }] },
          { regra: 'parou_de_usar', modo: lembretes.regras[1].modo, atraso_horas: lembretes.regras[1].atraso_horas, agora: [{ nome: 'João Pedro', negocio: 'JP Reformas', horas: 52 }], a_caminho: [] },
        ],
      }
    }
    case 'admin_retencao_config':
      return { regras: lembretes.regras, enviados_hoje: 0, ultimo_envio: null, numero_desde: '2026-11-21T04:04:14+00:00', ciclo_em: lembretes.regras.some((r) => r.modo !== 'desligado') ? new Date(Date.now() - (localStorage.getItem('mock-ciclo-parado') ? 30 * 60_000 : 0)).toISOString() : null, erro: null }
    // (dev) localStorage 'mock-ciclo-parado' deixa o carimbo do ciclo velho, para ver o aviso de servidor parado na aba Avisos
    case 'admin_retencao_etapa_definir': {
      if (String(args.p_motivo ?? '').trim().length < 3) throw new Error('motivo obrigatório')
      const r = lembretes.regras.find((x) => x.regra === args.p_regra)
      if (!r) throw new Error('regra desconhecida')
      const et = Number(args.p_etapa)
      const e = r.etapas.find((x) => x.etapa === et)
      const outra = r.etapas.find((x) => x.etapa !== et)
      if (!e) throw new Error('esta função muda a etapa 2 ou a 3')
      const atraso = Number(args.p_atraso)
      const ativa = !!args.p_ativa
      if (et === 2) {
        if (atraso <= r.atraso_horas) throw new Error(`o atraso da etapa 2 precisa ser maior que o da etapa 1 (${r.atraso_horas} h)`)
        if (outra && atraso >= outra.atraso_horas) throw new Error(`o atraso da etapa 2 precisa ser menor que o da etapa 3 (${outra.atraso_horas} h)`)
        if (!ativa && outra?.ativa) throw new Error('desligue a etapa 3 antes de desligar a etapa 2')
      } else {
        if (outra && atraso <= outra.atraso_horas) throw new Error(`o atraso da etapa 3 precisa ser maior que o da etapa 2 (${outra.atraso_horas} h)`)
        if (ativa && !outra?.ativa) throw new Error('ligue a etapa 2 antes de ligar a etapa 3')
      }
      e.ativa = ativa
      e.atraso_horas = atraso
      e.texto = String(args.p_texto)
      e.atualizado_em = new Date().toISOString()
      return { ok: true, regra: r.regra, etapa: et, ativa, atraso_horas: atraso }
    }
    case 'admin_retencao_previa': {
      const h = Number(args.p_atraso)
      if (Number(args.p_etapa ?? 1) > 1) return { total: 1, fora_por_numero_antigo: 0, itens: [{ nome: 'Carla Dias', negocio: 'Carla Doces', horas: h + 5 }] }
      const nomes = args.p_regra === 'nunca_mandou' ? [['Juan Pinheiro', 'Juan', 30], ['Walmir Silva', 'Growthcode', 95], ['Alvaro Melo', 'Alvaro Melo', 120]] : [['Marina Costa', 'Studio Marina', 60], ['João Pedro', 'JP Reformas', 52]]
      const itens = (nomes as [string, string, number][]).filter((x) => x[2] >= h).map(([nome, negocio, horas]) => ({ nome, negocio, horas }))
      return { total: itens.length, fora_por_numero_antigo: args.p_regra === 'nunca_mandou' ? 3 : 1, itens }
    }
    case 'admin_retencao_definir': {
      if (String(args.p_motivo ?? '').trim().length < 3) throw new Error('motivo obrigatório')
      const r = lembretes.regras.find((x) => x.regra === args.p_regra)
      if (!r) throw new Error('regra desconhecida')
      if (r.etapas[0] && Number(args.p_atraso) >= r.etapas[0].atraso_horas) throw new Error(`o atraso da etapa 1 (${args.p_atraso} h) precisa ser menor que o da etapa 2 (${r.etapas[0].atraso_horas} h)`)
      r.modo = String(args.p_modo)
      r.atraso_horas = Number(args.p_atraso)
      r.texto = String(args.p_texto)
      r.atualizado_em = new Date().toISOString()
      return { ok: true, regra: r.regra, modo: r.modo, atraso_horas: r.atraso_horas }
    }
    case 'admin_limite_previa': {
      const v = Number(args.p_valor)
      const seguem = Object.keys(USO_EXEMPLO).filter((id) => limites.proprio[id] === undefined)
      return { passam: seguem.filter((id) => USO_EXEMPLO[id] >= v).length, total: seguem.length }
    }
    default:
      throw new Error(`mock sem ${nome}`)
  }
}

/* ---- Configurações de IA (mock em memória: a tela pode ser exercitada inteira sem servidor) ---- */
const iaMock = {
  global: {} as Record<string, string>,
  chaves: [{ id: 'k-1', provedor: 'openai', nome: 'OpenAI da agência', ultimos4: 'a1b2', ativa: false, testada_em: new Date(Date.now() - 86_400_000).toISOString() }] as { id: string; provedor: 'openai' | 'anthropic'; nome: string; ultimos4: string; ativa: boolean; testada_em: string | null }[],
  clientes: [{ user_id: 'c1', nome: 'Marina Costa', negocio: 'Studio Marina', tarefa: 'documento', modelo: 'gpt-5.4' }] as { user_id: string; nome: string; negocio: string; tarefa: string; modelo: string }[],
}
const TAREFAS_MOCK = [
  { id: 'interpretacao', rotulo: 'Entender a mensagem', detalhe: 'Lê o que a pessoa escreveu e monta o registro (a tarefa mais importante).' },
  { id: 'documento', rotulo: 'Ler comprovante, foto e PDF', detalhe: 'Precisa enxergar imagem.' },
  { id: 'ajuda', rotulo: 'Responder dúvidas de uso', detalhe: 'O que a Granninha faz e como usar.' },
  { id: 'resposta', rotulo: 'Responder perguntas sobre os números', detalhe: 'Quanto sobrou, o que vence, resumo.' },
  { id: 'audio', rotulo: 'Transcrever áudio', detalhe: 'Modelo de transcrição, não de chat.' },
]
export async function mockApi(caminho: string, init: RequestInit): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 200))
  const c = init.body ? (JSON.parse(String(init.body)) as Record<string, string | boolean | null>) : {}
  const erro = (m: string) => Promise.reject(new Error(m))
  if (caminho === '/admin/ia') {
    const emUso = (p: 'openai' | 'anthropic') => {
      const a = iaMock.chaves.find((k) => k.ativa && k.provedor === p)
      return a ? { origem: 'banco', nome: a.nome } : { origem: p === 'openai' ? 'ambiente' : 'nenhuma', nome: null }
    }
    const ativa = iaMock.chaves.find((k) => k.ativa && k.provedor === 'openai')
    return {
      em_uso: { openai: emUso('openai'), anthropic: emUso('anthropic') },
      pronto: true, segredo: true, fabrica: { interpretacao: 'gpt-5.4-mini', documento: 'gpt-5.4-mini', ajuda: 'gpt-5.4-mini', resposta: 'gpt-5.4-mini', audio: 'gpt-4o-mini-transcribe' },
      tarefas: TAREFAS_MOCK.map((t) => ({ ...t, global: iaMock.global[t.id] ?? null })), chaves: iaMock.chaves, clientes: iaMock.clientes,
      chave_em_uso: ativa ? 'banco' : 'ambiente', chave_em_uso_nome: ativa?.nome ?? null,
    }
  }
  // Como o servidor: o modelo/chave "nao-existe" é recusado no teste e nada é salvo.
  if (String(c.modelo ?? '').toLowerCase().startsWith('claude') && c.tarefa === 'audio') return erro('Transcrição de áudio só funciona com modelos da OpenAI: a Anthropic não transcreve áudio. Nada foi alterado.')
  if (String(c.modelo ?? '').toLowerCase().startsWith('claude') && !iaMock.chaves.some((k) => k.ativa && k.provedor === 'anthropic')) return erro('O modelo "' + c.modelo + '" não respondeu (Nenhuma chave da Anthropic cadastrada. Cadastre uma em "Chave de API" antes de escolher um modelo Claude.). Nada foi alterado.')
  if (String(c.modelo ?? '').includes('nao-existe')) return erro('Este modelo não respondeu ao teste (OpenAI 404: model_not_found). Nada foi alterado.')
  if (caminho === '/admin/ia/modelo') {
    if (c.modelo) iaMock.global[String(c.tarefa)] = String(c.modelo)
    else delete iaMock.global[String(c.tarefa)]
    return { ok: true }
  }
  if (caminho === '/admin/ia/cliente') {
    iaMock.clientes = iaMock.clientes.filter((x) => !(x.user_id === c.user_id && x.tarefa === c.tarefa))
    if (c.modelo) iaMock.clientes.push({ user_id: String(c.user_id), nome: 'Cliente escolhido', negocio: '', tarefa: String(c.tarefa), modelo: String(c.modelo) })
    return { ok: true }
  }
  if (caminho === '/admin/ia/chave') {
    if (String(c.chave).includes('ruim')) return erro('Esta chave não funcionou (OpenAI 401). Nada foi guardado.')
    iaMock.chaves.push({ id: 'k-' + (iaMock.chaves.length + 1), provedor: (c.provedor as 'openai' | 'anthropic') ?? 'openai', nome: String(c.nome), ultimos4: String(c.chave).slice(-4), ativa: false, testada_em: new Date().toISOString() })
    return { ok: true }
  }
  if (caminho === '/admin/ia/chave/ativar') {
    const alvo = iaMock.chaves.find((k) => k.id === c.id)
    iaMock.chaves.forEach((k) => (k.ativa = k.provedor !== alvo?.provedor ? k.ativa : c.ativa ? k.id === c.id : k.ativa && k.id !== c.id))
    return { ok: true }
  }
  if (caminho === '/admin/ia/chave/remover') {
    iaMock.chaves = iaMock.chaves.filter((k) => k.id !== c.id)
    return { ok: true }
  }
  if (caminho.startsWith('/admin/simulador')) return mockSimulador(caminho, c)
  return erro('Rota desconhecida no modo de exemplo')
}

/* ---------------- simulador (modo de exemplo): responde como o servidor, com uma conversa pronta no número 1 ---------------- */
type EvSim = { seq: number; em: string; tipo: string; id?: string; texto?: string; emoji?: string; ids?: string[] }
const simMock = (() => {
  const numeros = ['5500900000001', '5500900000002', '5500900000003', '5500900000004', '5500900000005', '5500900000006']
  const ev = new Map<string, EvSim[]>()
  let seq = 0
  const t = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
  const push = (n: string, e: Omit<EvSim, 'seq' | 'em'>, em = new Date().toISOString()) => {
    const l = ev.get(n) ?? []
    l.push({ ...e, seq: ++seq, em })
    ev.set(n, l)
  }
  const N = numeros[0]
  push(N, { tipo: 'entrada', id: 'SIMA1', texto: '482913' }, t(12))
  push(N, { tipo: 'lida', ids: ['SIMA1'] }, t(12))
  push(N, { tipo: 'texto', texto: 'Oi, Ana! Número confirmado. Eu sou a Granninha e vou anotar o dinheiro do seu negócio por aqui.\n\nPra começar: qual é o seu ramo? Pode ser *salão*, *loja*, *comida* ou outro.' }, t(12))
  push(N, { tipo: 'entrada', id: 'SIMA2', texto: 'salão de beleza' }, t(10))
  push(N, { tipo: 'lida', ids: ['SIMA2'] }, t(10))
  push(N, { tipo: 'texto', texto: 'Anotado, salão. Já deixei as categorias certas para você.\n\nAgora me manda o primeiro registro: pode ser assim, "recebi 150 no pix".' }, t(10))
  push(N, { tipo: 'entrada', id: 'SIMA3', texto: 'recebi 180 de escova e hidratação no pix' }, t(3))
  push(N, { tipo: 'lida', ids: ['SIMA3'] }, t(3))
  push(N, { tipo: 'reacao', id: 'SIMA3', emoji: '👍' }, t(3))
  push(N, { tipo: 'texto', texto: 'Anotei *R$ 180,00* de entrada em Serviços, no Pix.\n\nSaldo na conta do banco: R$ 180,00.' }, t(3))
  const msgs = new Map<string, Record<string, unknown>[]>([
    [N, [
      { id: 'SIMA3', tipo: 'texto', texto: 'recebi 180 de escova e hidratação no pix', status: 'ok', intencao: 'acoes', resposta: '', erro: null, efeitos: { lancamentos: ['l1'] }, ms: 2140, custo_usd: 0.00041, criado_em: t(3) },
      { id: 'SIMA2', tipo: 'texto', texto: 'salão de beleza', status: 'ok', intencao: 'config', resposta: '', erro: null, efeitos: {}, ms: 380, custo_usd: 0, criado_em: t(10) },
      { id: 'SIMA1', tipo: 'texto', texto: '482913', status: 'ok', intencao: null, resposta: '', erro: null, efeitos: {}, ms: 210, custo_usd: null, criado_em: t(12) },
    ]],
  ])
  const contas = new Map<string, Record<string, unknown> | null>([
    [N, { user_id: 'u-sim1', nome: 'Ana Teste', email: 'sim1-3f9a2c@simulador.granninha.com.br', verificado: true, onboarding_via: 'whats', etapa_config: 'fim', assinatura: { status: 'trial', trial_fim: t(-7 * 24 * 60).slice(0, 10) }, codigo: null, criado_em: t(13) }],
    [numeros[1], { user_id: 'u-sim2', nome: 'Bruno Teste', email: 'sim2-81be04@simulador.granninha.com.br', verificado: false, onboarding_via: 'whats', etapa_config: null, assinatura: { status: 'trial', trial_fim: t(-7 * 24 * 60).slice(0, 10) }, codigo: { codigo: '730214', expira_em: t(-25) }, criado_em: t(2) }],
  ])
  return { numeros, ev, msgs, contas, push }
})()
const fmtSim = (n: string) => `(00) ${n.slice(4, 9)}-${n.slice(9)}`
function mockSimulador(caminho: string, c: Record<string, string | boolean | null>): unknown {
  const m = simMock
  if (caminho === '/admin/simulador') {
    return {
      pronto: true,
      ambiente: { onboarding_whats: true, sinais: true, espera_ms: 10_000, digitar_ms: 3000, modo_teste: false, avisos: 'todos' },
      numeros: m.numeros.map((n) => ({ numero: n, formatado: fmtSim(n), conta: m.contas.get(n) ?? null, ultima: null })),
    }
  }
  if (caminho.startsWith('/admin/simulador/conversa')) {
    const q = new URLSearchParams(caminho.split('?')[1] ?? '')
    const n = q.get('numero') ?? ''
    const depois = Number(q.get('depois') ?? 0)
    return { eventos: (m.ev.get(n) ?? []).filter((e) => e.seq > depois), mensagens: m.msgs.get(n) ?? [] }
  }
  const n = String(c.numero ?? '')
  if (caminho === '/admin/simulador/enviar') {
    const id = 'SIM' + Math.random().toString(36).slice(2, 10).toUpperCase()
    m.push(n, { tipo: 'entrada', id, texto: String(c.texto ?? '') })
    setTimeout(() => m.push(n, { tipo: 'lida', ids: [id] }), 1000)
    setTimeout(() => m.push(n, { tipo: 'digitando' }), 3000)
    setTimeout(() => m.push(n, { tipo: 'texto', texto: `Anotei: "${String(c.texto ?? 'mídia')}". (modo de exemplo: no servidor de verdade quem responde é a Granninha.)` }), 6000)
    return { id, chegada: 'nova' }
  }
  if (caminho === '/admin/simulador/conta') {
    m.contas.set(n, { user_id: 'u-' + n.slice(-1), nome: String(c.nome || ''), email: `sim${n.slice(-1)}-000000@simulador.granninha.com.br`, verificado: false, onboarding_via: 'whats', etapa_config: null, assinatura: { status: 'trial', trial_fim: '2026-12-05' }, codigo: { codigo: '104582', expira_em: new Date(Date.now() + 1800_000).toISOString() }, criado_em: new Date().toISOString() })
    return { conta: m.contas.get(n) }
  }
  if (caminho === '/admin/simulador/codigo') return { conta: m.contas.get(n) }
  if (caminho === '/admin/simulador/zerar') {
    m.contas.delete(n)
    m.ev.delete(n)
    m.msgs.delete(n)
    return { zerado: true }
  }
  return Promise.reject(new Error('Rota desconhecida no modo de exemplo'))
}
