-- Admin: "Precisa de você hoje" (ações), Retenção e Público (perfil dos clientes).
--
-- Só leitura, mesma guarda das outras funções do admin (eh_admin, security definer, search_path vazio,
-- sem acesso para anon). A única mudança de estrutura é aditiva: cinco colunas novas em perfis para o
-- Público (nascimento, cidade, uf, faixa de faturamento, ocupação). Elas ficam vazias até o onboarding
-- passar a perguntar; nenhuma permissão de escrita é dada ao cliente aqui, isso entra com a mudança
-- do onboarding. Sem esta migration, as três páginas mostram "função ainda não aplicada no banco".
--
-- Semana = segunda a domingo, dia = America/Sao_Paulo, como em admin_visao_geral.

alter table public.perfis
  add column if not exists nascimento date,
  add column if not exists cidade text not null default '',
  add column if not exists uf text not null default '',
  add column if not exists faturamento_faixa text not null default '' check (faturamento_faixa in ('', 'ate_2', '2_4', '4_6750', 'acima', 'prefiro_nao')),
  add column if not exists ocupacao text not null default '',
  add column if not exists perfil_em timestamptz;

comment on column public.perfis.faturamento_faixa is
  'Faturamento mensal do negócio, por faixa: ate_2, 2_4, 4_6750 (teto do MEI), acima, prefiro_nao. Vazio = não respondeu.';
comment on column public.perfis.ocupacao is 'Texto livre, obrigatório quando o ramo é "outro".';

-- ---------- Ações: quem precisa de contato hoje ----------
-- Cada conta cai em um grupo só, na ordem: sem acesso, sumiu, nunca mandou, parou no WhatsApp.
create function public.admin_acoes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  agora timestamptz := now();
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with u as (
      select p.id, p.nome, p.negocio, p.whats, p.whats_verificado, p.onboarding_feito, p.onboarding_passo, p.criado_em,
        a.status, a.trial_fim,
        (select max(m.criado_em) from public.mensagens m where m.user_id = p.id) ultima,
        (select count(*) from public.mensagens m where m.user_id = p.id) qtd
      from public.perfis p
      left join public.assinaturas a on a.user_id = p.id
      where p.papel = 'cliente' and p.exclusao_em is null
    ), g as (
      select u.*,
        case
          when u.status in ('bloqueada', 'atrasada') or (u.status = 'trial' and u.trial_fim < hoje) then 'bloq'
          when u.qtd > 0 and u.ultima < agora - interval '7 days' then 'sumiu'
          when u.whats_verificado and u.qtd = 0 then 'nunca'
          when not u.onboarding_feito and u.onboarding_passo >= 6 and not u.whats_verificado then 'whats'
        end grupo
      from u
    ), l as (
      select g.id user_id, g.nome, g.negocio, g.whats, g.grupo, g.status, g.onboarding_passo passo, g.criado_em, g.ultima,
        case g.grupo when 'bloq' then 1 when 'sumiu' then 2 when 'nunca' then 3 else 4 end ordem,
        floor(extract(epoch from (agora - case g.grupo when 'sumiu' then g.ultima else g.criado_em end)) / 86400)::int dias
      from g where g.grupo is not null
      order by 10, 11
      limit 200
    )
    select jsonb_build_object(
      'contagem', (select coalesce(jsonb_object_agg(grupo, n), '{}') from (select grupo, count(*) n from g where grupo is not null group by 1) x),
      'itens', (select coalesce(jsonb_agg(to_jsonb(l) - 'ordem' order by l.ordem, l.dias), '[]') from l)
    )
  );
end $$;
revoke all on function public.admin_acoes() from public, anon;
grant execute on function public.admin_acoes() to authenticated;

-- ---------- Retenção ----------
-- Ativo na semana = mandou ao menos uma mensagem nela. Novo = primeira mensagem da vida na semana;
-- voltou = ativo também na semana anterior; reativado = estava fora na anterior mas já tinha usado.
-- Novos + voltaram + reativados = ativos.
create function public.admin_retencao() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  tz text := 'America/Sao_Paulo';
  sem_atual date := date_trunc('week', now() at time zone 'America/Sao_Paulo')::date;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with sem as (
      select g::date semana from generate_series(sem_atual::timestamp - interval '49 days', sem_atual::timestamp, interval '7 days') g
    ), atv as (
      select m.user_id, date_trunc('week', m.criado_em at time zone tz)::date semana
      from public.mensagens m
      join public.perfis p on p.id = m.user_id and p.papel = 'cliente'
      where m.user_id is not null and m.criado_em >= (sem_atual - 56)::timestamp at time zone tz
      group by 1, 2
    ), prim as (
      select m.user_id, date_trunc('week', min(m.criado_em) at time zone tz)::date semana
      from public.mensagens m
      join public.perfis p on p.id = m.user_id and p.papel = 'cliente'
      where m.user_id is not null
      group by 1
    ), semanas as (
      select s.semana,
        count(a.user_id) total,
        count(*) filter (where pr.semana = s.semana) novos,
        count(*) filter (where pr.semana < s.semana and ant.user_id is not null) voltaram,
        count(*) filter (where pr.semana < s.semana and ant.user_id is null) reativados
      from sem s
      left join atv a on a.semana = s.semana
      left join prim pr on pr.user_id = a.user_id
      left join atv ant on ant.user_id = a.user_id and ant.semana = s.semana - 7
      group by s.semana
    ), dias as (
      select m.user_id, count(distinct (m.criado_em at time zone tz)::date) n
      from public.mensagens m
      join public.perfis p on p.id = m.user_id and p.papel = 'cliente'
      where m.user_id is not null and (m.criado_em at time zone tz)::date >= hoje - 6
      group by 1
    ), co as (
      select p.id, date_trunc('week', p.criado_em at time zone tz)::date semana
      from public.perfis p
      where p.papel = 'cliente'
        and p.criado_em >= (sem_atual - 49)::timestamp at time zone tz
        and exists (select 1 from public.mensagens m where m.user_id = p.id)
    ), coh as (
      select semana, count(*) n from co group by 1
    ), cel as (
      select co.semana, k.k, count(distinct a.user_id) ativos
      from co
      cross join generate_series(0, 4) k(k)
      left join atv a on a.user_id = co.id and a.semana = co.semana + 7 * k.k
      where co.semana + 7 * k.k <= sem_atual
      group by 1, 2
    ), par as (
      select
        (select count(*) from atv where semana = sem_atual - 14) base,
        (select count(*) from atv a0 join atv a1 on a1.user_id = a0.user_id and a1.semana = sem_atual - 7 where a0.semana = sem_atual - 14) mantidos
    ), sumiu as (
      select count(*) n from public.perfis p
      left join public.assinaturas a on a.user_id = p.id
      where p.papel = 'cliente' and p.exclusao_em is null
        and coalesce(a.status, '') not in ('bloqueada', 'atrasada')
        and not (a.status = 'trial' and a.trial_fim < hoje)
        and exists (select 1 from public.mensagens m where m.user_id = p.id)
        and not exists (select 1 from public.mensagens m where m.user_id = p.id and m.criado_em >= now() - interval '7 days')
    )
    select jsonb_build_object(
      'semana_atual', sem_atual,
      'semanas', (select coalesce(jsonb_agg(jsonb_build_object('semana', semana, 'total', total, 'novos', novos, 'voltaram', voltaram, 'reativados', reativados) order by semana), '[]') from semanas),
      'ativos_semana', (select total from semanas where semana = sem_atual),
      'confirmados', (select count(*) from public.perfis where papel = 'cliente' and whats_verificado),
      'voltaram_pct', (select case when base > 0 then round(100.0 * mantidos / base)::int end from par),
      'sumiram', (select n from sumiu),
      'habito', (select jsonb_build_object(
          'um', count(*) filter (where n = 1),
          'dois_tres', count(*) filter (where n between 2 and 3),
          'quatro_cinco', count(*) filter (where n between 4 and 5),
          'seis_sete', count(*) filter (where n >= 6),
          'media', round(coalesce(avg(n), 0)::numeric, 1)) from dias),
      'coortes', (select coalesce(jsonb_agg(jsonb_build_object(
          'semana', coh.semana, 'n', coh.n,
          'vals', (select jsonb_agg(round(100.0 * cel.ativos / coh.n)::int order by cel.k) from cel where cel.semana = coh.semana)
        ) order by coh.semana), '[]') from coh)
    )
  );
end $$;
revoke all on function public.admin_retencao() from public, anon;
grant execute on function public.admin_retencao() to authenticated;

-- ---------- Público: quem são os clientes ----------
-- Devolve consumo bruto por grupo (o admin converte em reais com admin/src/custo.ts, única fonte de preço).
-- A data de nascimento nunca sai daqui: só a faixa de idade.
create function public.admin_publico() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  tz text := 'America/Sao_Paulo';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  inicio_mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with st as (
      select m.user_id,
        count(*) filter (where m.criado_em >= now() - interval '7 days') msgs7,
        coalesce(sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) filter (where m.criado_em >= inicio_mes), 0) entrada,
        coalesce(sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) filter (where m.criado_em >= inicio_mes), 0) saida,
        coalesce(sum(coalesce(m.audio_tokens, 0)) filter (where m.criado_em >= inicio_mes), 0) audio_tokens,
        coalesce(sum(coalesce(m.audio_seg, 0)) filter (where m.criado_em >= inicio_mes), 0) audio_seg
      from public.mensagens m
      where m.user_id is not null
      group by 1
    ), b as (
      select p.id, p.nome, p.negocio, p.ramo, p.ocupacao, p.cidade, p.uf, p.faturamento_faixa, p.criado_em, p.whats_verificado,
        case
          when p.nascimento is null then null
          when date_part('year', age(hoje, p.nascimento)) < 25 then 'Até 24'
          when date_part('year', age(hoje, p.nascimento)) < 35 then '25 a 34'
          when date_part('year', age(hoje, p.nascimento)) < 45 then '35 a 44'
          when date_part('year', age(hoje, p.nascimento)) < 55 then '45 a 54'
          else '55 ou mais'
        end faixa_idade,
        (p.nascimento is not null and p.cidade <> '' and p.faturamento_faixa <> '') completo,
        case when a.status = 'trial' and a.trial_fim < hoje then 'teste_vencido' else a.status end situacao,
        coalesce(s.msgs7, 0) msgs7, coalesce(s.entrada, 0) entrada, coalesce(s.saida, 0) saida,
        coalesce(s.audio_tokens, 0) audio_tokens, coalesce(s.audio_seg, 0) audio_seg
      from public.perfis p
      left join public.assinaturas a on a.user_id = p.id
      left join st s on s.user_id = p.id
      where p.papel = 'cliente' and p.exclusao_em is null
    ), seg as (
      select 'ramo' dim, coalesce(nullif(ramo, ''), 'sem_ramo') grupo, b.* from b
      union all select 'idade', faixa_idade, b.* from b where faixa_idade is not null
      union all select 'faturamento', faturamento_faixa, b.* from b where faturamento_faixa not in ('', 'prefiro_nao')
      union all select 'cidade', cidade || case when uf <> '' then ', ' || uf else '' end, b.* from b where cidade <> ''
    )
    select jsonb_build_object(
      'cobertura', (select jsonb_build_object('total', count(*), 'completos', count(*) filter (where completo)) from b),
      'segmentos', (select coalesce(jsonb_agg(x), '[]') from (
          select dim, grupo, count(*) pessoas,
            count(*) filter (where whats_verificado) confirmados,
            count(*) filter (where msgs7 > 0) ativos7,
            coalesce(sum(msgs7), 0) msgs7,
            sum(entrada) entrada, sum(saida) saida, sum(audio_tokens) audio_tokens, sum(audio_seg) audio_seg
          from seg group by dim, grupo order by dim, count(*) desc) x),
      'outros', (select jsonb_build_object(
          'total', count(*),
          'sem_ocupacao', count(*) filter (where trim(ocupacao) = ''),
          'ocupacoes', (select coalesce(jsonb_agg(jsonb_build_object('ocupacao', o, 'n', n) order by n desc, o), '[]') from (
              select lower(trim(ocupacao)) o, count(*) n from b where ramo = 'outro' and trim(ocupacao) <> '' group by 1 limit 30) q))
        from b where ramo = 'outro'),
      'pessoas', (select coalesce(jsonb_agg(x order by x.criado_em desc), '[]') from (
          select id user_id, nome, negocio, ramo, ocupacao, cidade, uf, faixa_idade, faturamento_faixa, criado_em, msgs7, situacao
          from b order by criado_em desc limit 200) x)
    )
  );
end $$;
revoke all on function public.admin_publico() from public, anon;
grant execute on function public.admin_publico() to authenticated;

notify pgrst, 'reload schema';
