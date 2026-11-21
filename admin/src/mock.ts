/**
 * Dados de exemplo do admin. Só entra no build quando `VITE_ADMIN_MOCK=1` (ver sb.ts); em produção este arquivo nem é empacotado.
 * Serve para olhar as telas sem login e sem o código do autenticador. Os números são inventados de propósito.
 */

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
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
  for (let d = inicio; d <= ate; d = somaDias(d, 1)) dias.push(dia(d))
  const totalMsgs = dias.reduce((s, x) => s + x.mensagens, 0)
  const nomes: [string, string][] = [['Marina Costa', 'Studio Marina'], ['João Pedro', 'JP Reformas'], ['Aline Souza', 'Aline Doces'], ['Carlos Lima', 'Lima Fretes'], ['Bruna Alves', 'Bruna Nails'], ['Rafael Dias', 'RD Elétrica']]
  const pesos = [0.28, 0.22, 0.17, 0.14, 0.11, 0.08]
  const soma = dias.reduce((a, x) => ({ entrada: a.entrada + x.entrada, saida: a.saida + x.saida, audio_tokens: a.audio_tokens + x.audio_tokens, audio_seg: 0 }), { entrada: 0, saida: 0, audio_tokens: 0, audio_seg: 0 })
  return {
    inicio,
    fim: ate,
    dias,
    totais: { mensagens: totalMsgs, clientes: totalMsgs ? 18 : 0, estimadas: totalMsgs ? 120 : 0, audios_sem_medida: totalMsgs ? 14 : 0 },
    por_cliente: totalMsgs
      ? nomes.map(([nome, negocio], i) => ({ user_id: `u${i}`, nome, negocio, mensagens: Math.round(totalMsgs * pesos[i]), entrada: Math.round(soma.entrada * pesos[i]), saida: Math.round(soma.saida * pesos[i]), audio_tokens: Math.round(soma.audio_tokens * pesos[i]), audio_seg: 0 }))
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
    mk('whats', 'Eduardo Pires', 'EP Reformas', 2, 6, 'trial', '(81) 98811-2013'),
    mk('whats', 'Márcio Dias', 'MD Ar Condicionado', 3, 6, 'trial', '(81) 98811-2014'),
    mk('whats', 'Tiago Bento', 'TB Fretes', 4, 6, 'trial', '(81) 98811-2015'),
    mk('whats', 'Vera Alves', 'Vera Costuras', 5, 6, 'trial', '(81) 98811-2016'),
    mk('whats', 'Camila Rocha', 'Studio Camila', 6, 6, 'trial', '(81) 98811-2017'),
    mk('whats', 'Joana Lins', 'Joana Bolos', 8, 6, 'trial', '(81) 98811-2018'),
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
    default:
      throw new Error(`mock sem ${nome}`)
  }
}
