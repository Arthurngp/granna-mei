-- Custo de IA para o admin: tokens de entrada, saída e áudio, no mês, hoje e por cliente.
-- Mensagens antigas (antes de 16/11/2026) só têm o total: entram estimadas com 94% de entrada,
-- a proporção medida na bateria de frases (2.211 de entrada e 148 de saída por mensagem).
-- O admin converte em reais com os preços e o câmbio de admin/src/custo.ts.

create function public.admin_custo_ia() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  inicio_mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  inicio_dia timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'mes', (select jsonb_build_object(
        'entrada', coalesce(sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))), 0),
        'saida', coalesce(sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))), 0),
        'audio_tokens', coalesce(sum(m.audio_tokens), 0),
        'audio_seg', coalesce(sum(m.audio_seg), 0),
        'audios_sem_medida', count(*) filter (where m.tipo = 'audio' and m.audio_tokens is null and m.audio_seg is null),
        'estimadas', count(*) filter (where m.tokens_entrada is null and coalesce(m.tokens, 0) > 0),
        'mensagens', count(*))
      from public.mensagens m where m.criado_em >= inicio_mes),
    'hoje', (select jsonb_build_object(
        'entrada', coalesce(sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))), 0),
        'saida', coalesce(sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))), 0),
        'audio_tokens', coalesce(sum(m.audio_tokens), 0),
        'audio_seg', coalesce(sum(m.audio_seg), 0),
        'mensagens', count(*))
      from public.mensagens m where m.criado_em >= inicio_dia),
    'por_cliente', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select p.nome, p.negocio, count(*) mensagens,
          coalesce(sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))), 0) entrada,
          coalesce(sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))), 0) saida,
          coalesce(sum(m.audio_tokens), 0) audio_tokens,
          coalesce(sum(m.audio_seg), 0) audio_seg,
          coalesce(sum(coalesce(m.tokens, 0)), 0) + coalesce(sum(m.audio_tokens), 0) total
        from public.mensagens m join public.perfis p on p.id = m.user_id
        where m.criado_em >= inicio_mes
        group by p.id, p.nome, p.negocio
        order by total desc limit 10) x)
  );
end $$;
revoke all on function public.admin_custo_ia() from public, anon;
grant execute on function public.admin_custo_ia() to authenticated;
