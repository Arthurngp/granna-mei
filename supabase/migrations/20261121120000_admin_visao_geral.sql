-- Admin: visão geral do negócio em páginas (custo de IA por período, ativação por coorte e receita).
--
-- Três funções novas, só leitura, mesma guarda das outras do admin (eh_admin, security definer,
-- search_path vazio, sem acesso para anon). Nada aqui altera dado. Sem esta migration o admin continua
-- funcionando e cada página nova mostra "função ainda não aplicada no banco".
--
-- Todo recorte de dia e de mês usa America/Sao_Paulo. (admin_painel e admin_midias_mes ainda usam o
-- mês em UTC, por isso os cartões do Resumo podem divergir por poucas horas na virada do mês.)
-- O custo em reais NÃO sai do banco: as funções devolvem consumo bruto e o admin converte com os
-- preços de admin/src/custo.ts, que é a única fonte de preço.

-- ---------- Custo de IA por período ----------
create function public.admin_custo_periodo(p_inicio date, p_fim date) returns jsonb
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
          coalesce(s.mensagens, 0) mensagens, coalesce(s.clientes, 0) clientes
        from generate_series(p_inicio::timestamp, ultimo::timestamp, interval '1 day') d
        left join (
          select (m.criado_em at time zone 'America/Sao_Paulo')::date dia,
            sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) entrada,
            sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) saida,
            sum(coalesce(m.audio_tokens, 0)) audio_tokens,
            sum(coalesce(m.audio_seg, 0)) audio_seg,
            count(*) mensagens,
            count(distinct m.user_id) clientes
          from public.mensagens m
          where m.criado_em >= ini and m.criado_em < fim
          group by 1) s on s.dia = d::date) x),
    'totais', (select jsonb_build_object(
        'mensagens', count(*),
        'clientes', count(distinct m.user_id),
        'estimadas', count(*) filter (where m.tokens_entrada is null and coalesce(m.tokens, 0) > 0),
        'audios_sem_medida', count(*) filter (where m.tipo = 'audio' and m.audio_tokens is null and m.audio_seg is null))
      from public.mensagens m where m.criado_em >= ini and m.criado_em < fim),
    'por_cliente', (select coalesce(jsonb_agg(x order by x.pesagem desc), '[]') from (
        select m.user_id, p.nome, p.negocio, count(*) mensagens,
          sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) entrada,
          sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) saida,
          sum(coalesce(m.audio_tokens, 0)) audio_tokens,
          sum(coalesce(m.audio_seg, 0)) audio_seg,
          sum(coalesce(m.tokens, 0)) + sum(coalesce(m.audio_tokens, 0)) pesagem
        from public.mensagens m join public.perfis p on p.id = m.user_id
        where m.criado_em >= ini and m.criado_em < fim
        group by m.user_id, p.nome, p.negocio
        order by pesagem desc limit 30) x),
    'meses', (select coalesce(jsonb_agg(to_char(mes, 'YYYY-MM') order by mes desc), '[]') from (
        select distinct date_trunc('month', m.criado_em at time zone 'America/Sao_Paulo') mes from public.mensagens m) q)
  );
end $$;
revoke all on function public.admin_custo_periodo(date, date) from public, anon;
grant execute on function public.admin_custo_periodo(date, date) to authenticated;

-- ---------- Ativação: boas-vindas por semana de cadastro ----------
-- passo_efetivo: quem terminou (onboarding_feito) conta como passo 7 mesmo que o passo gravado seja
-- menor. Antes de 16/11 o fluxo tinha 6 passos e quem terminava ficava gravado como 6.
create function public.admin_ativacao() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with base as (
      select p.id, p.criado_em, p.whats_verificado,
        case when p.onboarding_feito then 7 else least(p.onboarding_passo, 7) end passo,
        (select min(m.criado_em) from public.mensagens m where m.user_id = p.id) primeira
      from public.perfis p
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'passos', (select coalesce(jsonb_object_agg(passo, n), '{}') from (select passo, count(*) n from base group by 1) x),
      'confirmaram', (select count(*) from base where whats_verificado),
      'com_mensagem', (select count(*) from base where primeira is not null),
      'mediana_horas_ate_primeira', (select round((percentile_cont(0.5) within group (order by extract(epoch from (primeira - criado_em)) / 3600))::numeric, 1) from base where primeira is not null and primeira >= criado_em),
      'coortes', (select coalesce(jsonb_agg(x order by x.semana desc), '[]') from (
          select to_char(date_trunc('week', b.criado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') semana,
            count(*) cadastros,
            count(*) filter (where b.whats_verificado) confirmaram,
            count(*) filter (where b.primeira is not null) com_mensagem,
            (select coalesce(jsonb_object_agg(q.passo, q.n), '{}') from (
               select b2.passo, count(*) n from base b2
               where date_trunc('week', b2.criado_em at time zone 'America/Sao_Paulo') = date_trunc('week', b.criado_em at time zone 'America/Sao_Paulo')
               group by 1) q) passos
          from base b
          group by date_trunc('week', b.criado_em at time zone 'America/Sao_Paulo')
          order by 1 desc limit 12) x)
    )
  );
end $$;
revoke all on function public.admin_ativacao() from public, anon;
grant execute on function public.admin_ativacao() to authenticated;

-- ---------- Receita ----------
-- Só fato: faturas pagas de verdade e a carteira por situação/plano. Sem MRR inventado: a cobrança só
-- começa em 01/01/2027 e a situação 'ativa' hoje vem da ação manual "liberar" do admin.
create function public.admin_receita() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'faturas_pagas', (select jsonb_build_object('qtd', count(*), 'total', coalesce(sum(f.valor), 0)) from public.faturas f where f.status = 'paga'),
    'faturas_abertas', (select jsonb_build_object('qtd', count(*), 'total', coalesce(sum(f.valor), 0)) from public.faturas f where f.status = 'aberta'),
    'por_mes', (select coalesce(jsonb_agg(x order by x.mes desc), '[]') from (
        select to_char(date_trunc('month', f.data), 'YYYY-MM') mes, count(*) qtd, sum(f.valor) total
        from public.faturas f where f.status = 'paga' group by 1 order by 1 desc limit 12) x),
    'carteira', (select coalesce(jsonb_agg(x), '[]') from (
        select case when a.status = 'trial' and a.trial_fim < hoje then 'teste_vencido' else a.status end situacao,
          a.plano, count(*) n
        from public.assinaturas a group by 1, 2 order by 3 desc) x),
    'trial_ate_fim', (select count(*) from public.assinaturas a where a.status = 'trial' and a.trial_fim >= hoje)
  );
end $$;
revoke all on function public.admin_receita() from public, anon;
grant execute on function public.admin_receita() to authenticated;

notify pgrst, 'reload schema';
