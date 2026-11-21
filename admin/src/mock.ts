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

/** Um dia de consumo. Mês 2026-09 é vazio (testa o estado sem dados); um dia por mês tem pico de volume e outro de áudio. */
function dia(iso: string) {
  const mes = iso.slice(0, 7)
  if (mes === '2026-09') return { dia: iso, entrada: 0, saida: 0, audio_tokens: 0, audio_seg: 0, mensagens: 0, clientes: 0 }
  const k = Number(iso.slice(8, 10))
  let msgs = Math.round(34 + 22 * ruido(k + 3) + k * 0.9)
  let audioTokens = Math.round(msgs * 0.07) * 1500
  if (k === 12) msgs = Math.round(msgs * 3.4) // pico de volume
  if (k === 19) audioTokens = Math.round(msgs * 0.55) * 1500 // pico de áudio: mesma quantidade, mensagem mais cara
  return { dia: iso, entrada: msgs * 2211, saida: msgs * 148, audio_tokens: audioTokens, audio_seg: 0, mensagens: msgs, clientes: Math.min(14, 6 + Math.round(msgs / 12)) }
}

function periodo(inicio: string, fim: string) {
  const ate = fim < hojeSP() ? fim : hojeSP()
  const dias = []
  for (let d = inicio; d <= ate; d = somaDias(d, 1)) dias.push(dia(d))
  const totalMsgs = dias.reduce((s, x) => s + x.mensagens, 0)
  const nomes: [string, string][] = [['Marina Costa', 'Studio Marina'], ['João Pedro', 'JP Reformas'], ['Aline Souza', 'Aline Doces'], ['Carlos Lima', 'Lima Fretes'], ['Bruna Alves', 'Bruna Nails'], ['Rafael Dias', 'RD Eletrica']]
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
    maiores_consumidores: [
      { nome: 'Marina Costa', negocio: 'Studio Marina', mensagens: 410, tokens: 960_000 },
      { nome: 'João Pedro', negocio: 'JP Reformas', mensagens: 330, tokens: 780_000 },
      { nome: 'Aline Souza', negocio: 'Aline Doces', mensagens: 250, tokens: 590_000 },
    ],
    saude: { whatsapp_estado: 'CONNECTED', whatsapp_numero: '5581999990000', fila: 0, atualizado_em: new Date().toISOString() },
  }
}

function custoIa() {
  const p = periodo(`${hojeSP().slice(0, 7)}-01`, hojeSP())
  const c = p.dias.reduce((a, x) => ({ entrada: a.entrada + x.entrada, saida: a.saida + x.saida, audio_tokens: a.audio_tokens + x.audio_tokens, audio_seg: 0, mensagens: a.mensagens + x.mensagens }), { entrada: 0, saida: 0, audio_tokens: 0, audio_seg: 0, mensagens: 0 })
  const h = p.dias[p.dias.length - 1]
  return { mes: { ...c, estimadas: 0, audios_sem_medida: 0 }, hoje: { entrada: h.entrada, saida: h.saida, audio_tokens: h.audio_tokens, audio_seg: 0, mensagens: h.mensagens }, por_cliente: [] }
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

export async function mockRpc(nome: string, args: Record<string, unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 180))
  switch (nome) {
    case 'admin_painel':
      return painel()
    case 'admin_custo_ia':
      return custoIa()
    case 'admin_custo_periodo':
      return periodo(String(args.p_inicio), String(args.p_fim))
    case 'admin_midias_mes':
      return { audio: 120, foto: 150, pdf: 40 }
    case 'admin_ativacao':
      return ativacao()
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
      if (args.__ausente) throw new Error('Could not find the function public.admin_receita in the schema cache')
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
