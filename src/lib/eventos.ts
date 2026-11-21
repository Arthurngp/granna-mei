/*
  Eventos do funil de cadastro -> window.dataLayer.

  O Traqueamento Avançado (container CT-8YN6KS7Z) escuta o dataLayer: cada evento daqui tem um
  acionador "Evento: <nome>" e uma tag "Traq. — ..." no container (montados por
  scripts/traqueamento/montar.py, que é a tabela de eventos e parâmetros).

  Regras:
  - É diagnóstico de onde se perde gente, não evento de anúncio.
  - Nunca pôr e-mail, nome, telefone nem texto digitado. Só etapa, nome do campo e motivo da recusa.
  - Rastreio nunca derruba o cadastro: tudo aqui é fogo e esquece, com erro engolido.
*/
export type EventoFunil =
  | 'cadastro_aberto'
  | 'cadastro_iniciado'
  | 'cadastro_tentativa'
  | 'cadastro_erro'
  | 'cadastro_confirmar_email'
  | 'cadastro_concluido'
  | 'onboarding_passo'
  | 'onboarding_concluido'
  | 'perfil_aberto'
  | 'perfil_salvo'
  | 'perfil_pulado'

export function evento(nome: EventoFunil, params: Record<string, string | number> = {}): void {
  try {
    const w = window as unknown as { dataLayer?: unknown[] }
    w.dataLayer = w.dataLayer || []
    w.dataLayer.push({ event: nome, pagina: window.location.pathname, ...params })
  } catch {
    /* rastreio nunca derruba o app */
  }
}

/** Classifica o erro do Supabase em poucos motivos fixos, sem mandar o texto (que pode trazer o e-mail). */
export function motivoServidor(mensagem: string): string {
  const m = mensagem.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered')) return 'email_ja_cadastrado'
  if (m.includes('password')) return 'senha_recusada_servidor'
  if (m.includes('email')) return 'email_recusado_servidor'
  if (m.includes('rate limit') || m.includes('too many')) return 'limite_de_tentativas'
  if (m.includes('failed to fetch') || m.includes('network')) return 'sem_conexao'
  return 'erro_servidor'
}
