-- Admin: "usou a Granninha" passa a significar USOU de verdade (revisão de 24/11/2026, pedido do Arthur: "não queremos dados errados").
-- Só LEITURA: refaz admin_ativacao, admin_acoes, admin_retencao e admin_publico (`create or replace`, mesma assinatura e permissões) e cria duas funções
-- de apoio. Nenhum dado é lido nem alterado. Compatível com o admin atual (só acrescenta a chave 'terminaram_sem_uso' em admin_ativacao).
--
-- O que estava errado: "uso" era qualquer mensagem depois da primeira. Isso contava "SAIR" (que NÃO é uso: é a pessoa pedindo para não ser lembrada),
-- a recusa por conta bloqueada, o limite estourado, figurinha e erro. Efeito: "Usaram esta semana", "Sumiram", "Hábito" e "Nunca usaram" ficavam
-- otimistas, e quem pediu SAIR contava como ativo. Agora uso = mensagem com status ok ou pergunta, que não é a palavra SAIR, depois da primeira.
-- Também: Ativação e Retenção passam a ignorar contas com exclusão pedida (como Ações e Público já faziam); "Nunca usaram" ganha carência de 24 h
-- (antes aparecia 1 minuto depois de confirmar o número, no meio do cadastro); "Terminaram e nunca usaram" vem contado no banco (a conta da tela
-- subtraía dois grupos que não se aninham); "perfil completo" não aceita mais "prefiro não dizer" como se fosse informação; cidade agrupa sem diferença
-- de maiúscula ou espaço; "Outro: ocupações" ordena antes de cortar em 30. Idempotente.

-- Esta mensagem conta como USO? (ok ou pergunta, e não é a palavra SAIR sozinha, mesma regra do servidor: retencao.ts ehSair)
create or replace function public.mensagem_conta_como_uso(p_status text, p_texto text) returns boolean
language sql immutable set search_path = ''
as $$
  select p_status in ('ok', 'pergunta')
    and not (
      btrim(regexp_replace(coalesce(p_texto, ''), '[.!?,;:]+', '', 'g')) ~ '^\S+$'
      and lower(translate(btrim(regexp_replace(coalesce(p_texto, ''), '[.!?,;:]+', '', 'g')),
            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuuc' || 'AAAAAEEEEIIIIOOOOOUUUUC')) = 'sair'
    )
$$;
revoke all on function public.mensagem_conta_como_uso(text, text) from public, anon, authenticated;

-- Mensagens de USO de todos os clientes (sem a primeira, que é a confirmação do número). Só as funções do admin chamam: devolve dado de todo mundo.
create or replace function public.mensagens_de_uso() returns table (user_id uuid, criado_em timestamptz)
language sql stable set search_path = ''
as $$
  select x.user_id, x.criado_em
  from (select m.user_id, m.criado_em, m.status, m.texto, row_number() over (partition by m.user_id order by m.criado_em) rn
        from public.mensagens m where m.user_id is not null) x
  where x.rn > 1 and public.mensagem_conta_como_uso(x.status, x.texto)
$$;
revoke all on function public.mensagens_de_uso() from public, anon, authenticated;

-- ---------- Ativação ----------
create or replace function public.admin_ativacao() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with base as (
      select p.id, p.criado_em, p.whats_verificado,
        to_char(date_trunc('week', p.criado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') semana,
        case when p.onboarding_feito then 7 else least(p.onboarding_passo, 7) end passo,
        -- primeira mensagem de USO (a 1ª é a confirmação do número; SAIR, recusa por acesso ou limite, ruído e erro não contam)
        ua.primeira
      from public.perfis p
      left join (select mu.user_id, min(mu.criado_em) primeira from public.mensagens_de_uso() mu group by 1) ua on ua.user_id = p.id
      where p.papel = 'cliente' and p.exclusao_em is null
    ), ps as (
      select semana, passo, count(*) n from base group by 1, 2
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'passos', (select coalesce(jsonb_object_agg(passo, n), '{}') from (select passo, count(*) n from base group by 1) x),
      'confirmaram', (select count(*) from base where whats_verificado),
      'com_mensagem', (select count(*) from base where primeira is not null),
      'terminaram_sem_uso', (select count(*) from base where passo = 7 and primeira is null),
      'mediana_horas_ate_primeira', (select round((percentile_cont(0.5) within group (order by extract(epoch from (primeira - criado_em)) / 3600))::numeric, 1) from base where primeira is not null and primeira >= criado_em),
      'coortes', (select coalesce(jsonb_agg(x order by x.semana desc), '[]') from (
          select b.semana,
            count(*) cadastros,
            count(*) filter (where b.whats_verificado) confirmaram,
            count(*) filter (where b.primeira is not null) com_mensagem,
            (select coalesce(jsonb_object_agg(ps.passo, ps.n), '{}') from ps where ps.semana = b.semana) passos
          from base b
          group by b.semana
          order by b.semana desc limit 12) x)
    )
  );
end $$;

-- ---------- Ações ----------
create or replace function public.admin_acoes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  agora timestamptz := now();
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with ua as (
      select mu.user_id, max(mu.criado_em) ultima, count(*) qtd from public.mensagens_de_uso() mu group by 1
    ), u as (
      select p.id, p.nome, p.negocio, p.whats, p.whats_verificado, p.onboarding_feito, p.onboarding_passo, p.criado_em,
        a.status, a.trial_fim,
        ua.ultima,
        -- qtd = quantas vezes USOU (sem a confirmação do número, sem SAIR, sem recusa por acesso ou limite)
        coalesce(ua.qtd, 0) qtd
      from public.perfis p
      left join public.assinaturas a on a.user_id = p.id
      left join ua on ua.user_id = p.id
      where p.papel = 'cliente' and p.exclusao_em is null
    ), g as (
      select u.*,
        case
          when u.status in ('bloqueada', 'atrasada') or (u.status = 'trial' and u.trial_fim < hoje) then 'bloq'
          when u.qtd >= 1 and u.ultima < agora - interval '7 days' then 'sumiu'
          -- carência de 24 h: logo depois de confirmar o número a pessoa ainda está no meio do cadastro, não "nunca usou"
          when u.whats_verificado and u.qtd = 0 and u.criado_em < agora - interval '1 day' then 'nunca'
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

-- ---------- Retenção ----------
create or replace function public.admin_retencao() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  tz text := 'America/Sao_Paulo';
  sem_atual date := date_trunc('week', now() at time zone 'America/Sao_Paulo')::date;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with uso as (
      -- só mensagens de USO de clientes de verdade (sem a confirmação do número, SAIR, recusas e ruído)
      select mu.user_id, mu.criado_em from public.mensagens_de_uso() mu
      join public.perfis p on p.id = mu.user_id and p.papel = 'cliente' and p.exclusao_em is null
    ), sem as (
      select g::date semana from generate_series(sem_atual::timestamp - interval '49 days', sem_atual::timestamp, interval '7 days') g
    ), atv as (
      select u.user_id, date_trunc('week', u.criado_em at time zone tz)::date semana
      from uso u
      where u.criado_em >= (sem_atual - 56)::timestamp at time zone tz
      group by 1, 2
    ), prim as (
      select u.user_id, date_trunc('week', min(u.criado_em) at time zone tz)::date semana
      from uso u group by 1
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
      select u.user_id, count(distinct (u.criado_em at time zone tz)::date) n
      from uso u
      where (u.criado_em at time zone tz)::date >= hoje - 6
      group by 1
    ), co as (
      select p.id, date_trunc('week', p.criado_em at time zone tz)::date semana
      from public.perfis p
      where p.papel = 'cliente' and p.exclusao_em is null
        and p.criado_em >= (sem_atual - 49)::timestamp at time zone tz
        and exists (select 1 from uso u where u.user_id = p.id)
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
        and exists (select 1 from uso u where u.user_id = p.id)
        and not exists (select 1 from uso u where u.user_id = p.id and u.criado_em >= now() - interval '7 days')
    )
    select jsonb_build_object(
      'semana_atual', sem_atual,
      'semanas', (select coalesce(jsonb_agg(jsonb_build_object('semana', semana, 'total', total, 'novos', novos, 'voltaram', voltaram, 'reativados', reativados) order by semana), '[]') from semanas),
      'ativos_semana', (select total from semanas where semana = sem_atual),
      'confirmados', (select count(*) from public.perfis where papel = 'cliente' and exclusao_em is null and whats_verificado),
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

-- ---------- Público ----------
create or replace function public.admin_publico() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  tz text := 'America/Sao_Paulo';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  inicio_mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with m2 as (
      select m.user_id, m.criado_em, m.status, m.texto, m.tokens, m.tokens_entrada, m.tokens_saida, m.audio_tokens, m.audio_seg,
        row_number() over (partition by m.user_id order by m.criado_em) rn
      from public.mensagens m
      where m.user_id is not null
    ), st as (
      select m.user_id,
        -- uso da semana: não conta a mensagem de confirmação (rn = 1). O consumo abaixo soma tudo: o gasto é real.
        count(*) filter (where m.criado_em >= now() - interval '7 days' and m.rn > 1 and public.mensagem_conta_como_uso(m.status, m.texto)) msgs7,
        coalesce(sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) filter (where m.criado_em >= inicio_mes), 0) entrada,
        coalesce(sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) filter (where m.criado_em >= inicio_mes), 0) saida,
        coalesce(sum(coalesce(m.audio_tokens, 0)) filter (where m.criado_em >= inicio_mes), 0) audio_tokens,
        coalesce(sum(coalesce(m.audio_seg, 0)) filter (where m.criado_em >= inicio_mes), 0) audio_seg
      from m2 m
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
        (p.nascimento is not null and p.cidade <> '' and p.faturamento_faixa not in ('', 'prefiro_nao')) completo,
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
      union all select 'cidade', initcap(lower(btrim(cidade))) || case when btrim(uf) <> '' then ', ' || upper(btrim(uf)) else '' end, b.* from b where btrim(cidade) <> ''
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
              select lower(trim(ocupacao)) o, count(*) n from b where ramo = 'outro' and trim(ocupacao) <> '' group by 1 order by 2 desc, 1 limit 30) q))
        from b where ramo = 'outro'),
      'pessoas', (select coalesce(jsonb_agg(x order by x.criado_em desc), '[]') from (
          select id user_id, nome, negocio, ramo, ocupacao, cidade, uf, faixa_idade, faturamento_faixa, criado_em, msgs7, situacao
          from b order by criado_em desc limit 200) x)
    )
  );
end $$;

notify pgrst, 'reload schema';
