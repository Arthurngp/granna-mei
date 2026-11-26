-- Custo de IA pelo modelo que RODOU (pedido do Arthur em 2026-11-25: "eu quero que seja real e aplicado a escolha de llm, não pode ficar errado").
--
-- Antes: o admin calculava o custo de todas as mensagens com o preço do gpt-5.4-mini, qualquer que fosse o modelo escolhido, e o banco não
-- guardava qual modelo respondeu (nem se o escolhido falhou e o de fábrica respondeu no lugar).
-- Agora o servidor grava em cada mensagem:
--   ia_chamadas = uma entrada por chamada de IA: tarefa, modelo que respondeu, `pedido` (o configurado, quando caiu no reserva), tokens, cache e `usd`
--   custo_usd   = custo da mensagem em dólar, pelo preço de CADA modelo (tabela em server/src/precos.ts), com o desconto do cache
-- E admin_custo_periodo passa a devolver, além do que já devolvia (o admin antigo continua funcionando):
--   custo_usd e os tokens "medidos" por dia e por cliente (o admin soma o medido e só estima o que é de antes desta migration)
--   por_modelo: chamadas, reserva, tokens e custo por modelo no período
--
-- Colunas novas, nulas para o passado. O servidor funciona com ou sem elas (grava sem e tenta de novo depois). Idempotente.

alter table public.mensagens add column if not exists ia_chamadas jsonb;
alter table public.mensagens add column if not exists custo_usd numeric(14, 6);

create or replace function public.admin_custo_periodo(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ini timestamptz;
  fim timestamptz;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ultimo date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 366 then
    raise exception 'periodo invalido' using errcode = '22023';
  end if;
  ultimo := least(p_fim, hoje);
  ini := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  fim := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
  return jsonb_build_object(
    'inicio', p_inicio,
    'fim', ultimo,
    'dias', (select coalesce(jsonb_agg(x order by x.dia), '[]') from (
        select d::date dia,
          coalesce(s.entrada, 0) entrada, coalesce(s.saida, 0) saida,
          coalesce(s.audio_tokens, 0) audio_tokens, coalesce(s.audio_seg, 0) audio_seg,
          coalesce(s.entrada_foto, 0) entrada_foto, coalesce(s.entrada_pdf, 0) entrada_pdf,
          coalesce(s.mensagens, 0) mensagens, coalesce(s.clientes, 0) clientes,
          s.custo_usd, coalesce(s.entrada_medida, 0) entrada_medida, coalesce(s.saida_medida, 0) saida_medida,
          coalesce(s.audio_tokens_medido, 0) audio_tokens_medido, coalesce(s.audio_seg_medido, 0) audio_seg_medido
        from generate_series(p_inicio::timestamp, ultimo::timestamp, interval '1 day') d
        left join (
          select (m.criado_em at time zone 'America/Sao_Paulo')::date dia,
            sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) entrada,
            sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) saida,
            sum(coalesce(m.audio_tokens, 0)) audio_tokens,
            sum(coalesce(m.audio_seg, 0)) audio_seg,
            sum(case when m.tipo = 'foto' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_foto,
            sum(case when m.tipo = 'pdf' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_pdf,
            count(*) mensagens,
            count(distinct m.user_id) clientes,
            sum(m.custo_usd) custo_usd,
            sum(case when m.custo_usd is not null then coalesce(m.tokens_entrada, 0) else 0 end) entrada_medida,
            sum(case when m.custo_usd is not null then coalesce(m.tokens_saida, 0) else 0 end) saida_medida,
            sum(case when m.custo_usd is not null then coalesce(m.audio_tokens, 0) else 0 end) audio_tokens_medido,
            sum(case when m.custo_usd is not null then coalesce(m.audio_seg, 0) else 0 end) audio_seg_medido
          from public.mensagens m
          where m.criado_em >= ini and m.criado_em < fim
          group by 1) s on s.dia = d::date) x),
    'totais', (select jsonb_build_object(
        'mensagens', count(*),
        'clientes', count(distinct m.user_id),
        'estimadas', count(*) filter (where m.tokens_entrada is null and coalesce(m.tokens, 0) > 0),
        'audios_sem_medida', count(*) filter (where m.tipo = 'audio' and m.audio_tokens is null and m.audio_seg is null),
        'com_modelo', count(*) filter (where m.custo_usd is not null))
      from public.mensagens m where m.criado_em >= ini and m.criado_em < fim),
    'por_cliente', (select coalesce(jsonb_agg(x order by x.pesagem desc), '[]') from (
        select m.user_id, p.nome, p.negocio, count(*) mensagens,
          sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) entrada,
          sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) saida,
          sum(coalesce(m.audio_tokens, 0)) audio_tokens,
          sum(coalesce(m.audio_seg, 0)) audio_seg,
          sum(case when m.tipo = 'foto' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_foto,
          sum(case when m.tipo = 'pdf' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_pdf,
          sum(coalesce(m.tokens, 0)) + sum(coalesce(m.audio_tokens, 0)) pesagem,
          sum(m.custo_usd) custo_usd,
          sum(case when m.custo_usd is not null then coalesce(m.tokens_entrada, 0) else 0 end) entrada_medida,
          sum(case when m.custo_usd is not null then coalesce(m.tokens_saida, 0) else 0 end) saida_medida,
          sum(case when m.custo_usd is not null then coalesce(m.audio_tokens, 0) else 0 end) audio_tokens_medido,
          sum(case when m.custo_usd is not null then coalesce(m.audio_seg, 0) else 0 end) audio_seg_medido
        from public.mensagens m join public.perfis p on p.id = m.user_id
        where m.criado_em >= ini and m.criado_em < fim
        group by m.user_id, p.nome, p.negocio
        order by pesagem desc limit 30) x),
    -- Gasto por modelo que RODOU de verdade (uma linha por chamada de IA). `reserva` = chamadas em que o modelo escolhido falhou e o de fábrica respondeu.
    'por_modelo', (select coalesce(jsonb_agg(x order by x.custo_usd desc), '[]') from (
        select c->>'modelo' modelo, count(*) chamadas,
          count(*) filter (where c ? 'pedido') reserva,
          (array_agg(distinct c->>'pedido') filter (where c ? 'pedido')) pedidos,
          count(*) filter (where c ? 'sem_preco') sem_preco,
          sum(coalesce((c->>'entrada')::bigint, 0)) entrada, sum(coalesce((c->>'saida')::bigint, 0)) saida, sum(coalesce((c->>'cache')::bigint, 0)) cache,
          round(sum(coalesce((c->>'usd')::numeric, 0)), 6) custo_usd
        from public.mensagens m, jsonb_array_elements(coalesce(m.ia_chamadas, '[]'::jsonb)) c
        where m.criado_em >= ini and m.criado_em < fim
        group by 1) x),
    'meses', (select coalesce(jsonb_agg(to_char(mes, 'YYYY-MM') order by mes desc), '[]') from (
        select distinct date_trunc('month', m.criado_em at time zone 'America/Sao_Paulo') mes from public.mensagens m) q)
  );
end $$;

revoke all on function public.admin_custo_periodo(date, date) from public, anon;
grant execute on function public.admin_custo_periodo(date, date) to authenticated;
