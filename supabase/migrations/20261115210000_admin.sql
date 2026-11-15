-- Granna Mei: funções do painel admin (/admin).
-- Toda função confere: papel admin no perfil E login com segunda etapa (aal2). Sem isso, nada.
-- Toda ação que muda algo grava em admin_auditoria quem fez, em quem, o quê e por quê.

create function public.eh_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.papel = 'admin');
$$;
revoke all on function public.eh_admin() from public, anon;
grant execute on function public.eh_admin() to authenticated;

-- Só confere papel (sem exigir a segunda etapa): serve para a tela de entrada saber se manda ativar o autenticador.
create function public.admin_papel() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.papel = 'admin'); $$;
revoke all on function public.admin_papel() from public, anon;
grant execute on function public.admin_papel() to authenticated;

-- Saúde da Granninha: o serviço grava aqui a cada minuto; o admin lê.
create table public.granninha_saude (
  id smallint primary key default 1 check (id = 1),
  whatsapp_estado text,
  whatsapp_numero text,
  fila integer,
  atualizado_em timestamptz not null default now()
);
alter table public.granninha_saude enable row level security;
revoke all on public.granninha_saude from anon, authenticated;

-- ---------- Leitura ----------
create function public.admin_clientes(p_busca text default '', p_situacao text default '')
returns table (
  id uuid, nome text, email text, negocio text, whats text, verificado boolean, situacao text, plano text, trial_fim date,
  motivo text, criado_em timestamptz, ultimo_lancamento date, lancamentos bigint, mensagens_mes bigint, onboarding_passo smallint, onboarding_feito boolean, papel text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return query
  select p.id, p.nome, u.email::text, p.negocio, p.whats, p.whats_verificado,
    case when a.status = 'trial' and a.trial_fim < current_date then 'teste_vencido' else a.status end,
    a.plano, a.trial_fim, a.motivo, p.criado_em,
    (select max(l.data) from public.lancamentos l where l.user_id = p.id),
    (select count(*) from public.lancamentos l where l.user_id = p.id),
    (select count(*) from public.mensagens m where m.user_id = p.id and m.criado_em >= date_trunc('month', now())),
    p.onboarding_passo, p.onboarding_feito, p.papel
  from public.perfis p
  join auth.users u on u.id = p.id
  left join public.assinaturas a on a.user_id = p.id
  where (coalesce(p_busca, '') = ''
         or p.nome ilike '%' || p_busca || '%' or p.negocio ilike '%' || p_busca || '%' or u.email ilike '%' || p_busca || '%'
         or regexp_replace(p.whats, '\D', '', 'g') like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%' and regexp_replace(p_busca, '\D', '', 'g') <> '')
    and (coalesce(p_situacao, '') = ''
         or (p_situacao = 'teste_vencido' and a.status = 'trial' and a.trial_fim < current_date)
         or (p_situacao = 'trial' and a.status = 'trial' and a.trial_fim >= current_date)
         or (p_situacao not in ('trial', 'teste_vencido') and a.status = p_situacao))
  order by p.criado_em desc
  limit 500;
end $$;

create function public.admin_cliente(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare r jsonb;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'carteiras', (select coalesce(jsonb_agg(jsonb_build_object('nome', c.nome, 'tipo', c.tipo)), '[]') from public.carteiras c where c.user_id = p_id),
    'lancamentos_por_origem', (select coalesce(jsonb_object_agg(o, n), '{}') from (select l.origem o, count(*) n from public.lancamentos l where l.user_id = p_id group by l.origem) x),
    'contas_abertas', (select count(*) from public.contas c where c.user_id = p_id and c.status = 'aberta'),
    'fixas', (select count(*) from public.fixas f where f.user_id = p_id),
    'ultimas_mensagens', (select coalesce(jsonb_agg(x order by x.criado_em desc), '[]') from (
        select m.criado_em, m.tipo, m.status, m.intencao, left(m.texto, 80) texto from public.mensagens m where m.user_id = p_id order by m.criado_em desc limit 8) x),
    'auditoria', (select coalesce(jsonb_agg(x order by x.criado_em desc), '[]') from (
        select au.criado_em, au.acao, au.detalhes from public.admin_auditoria au where au.alvo_user_id = p_id order by au.criado_em desc limit 20) x)
  ) into r;
  return r;
end $$;

create function public.admin_painel() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'clientes', (select count(*) from public.perfis),
    'por_situacao', (select coalesce(jsonb_object_agg(s, n), '{}') from (
        select case when a.status = 'trial' and a.trial_fim < current_date then 'teste_vencido' else a.status end s, count(*) n
        from public.assinaturas a group by 1) x),
    'novos_7d', (select count(*) from public.perfis where criado_em >= now() - interval '7 days'),
    'numeros_confirmados', (select count(*) from public.perfis where whats_verificado),
    'onboarding', (select coalesce(jsonb_object_agg(passo, n), '{}') from (select onboarding_passo passo, count(*) n from public.perfis group by 1) x),
    'mensagens_hoje', (select count(*) from public.mensagens where criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'respondidas_hoje', (select count(*) from public.mensagens where resposta is not null and resposta <> '' and criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'erros_24h', (select count(*) from public.mensagens where status = 'erro' and criado_em >= now() - interval '24 hours'),
    'ultimos_erros', (select coalesce(jsonb_agg(x order by x.criado_em desc), '[]') from (
        select criado_em, tipo, left(erro, 160) erro from public.mensagens where status = 'erro' order by criado_em desc limit 5) x),
    'ultima_mensagem', (select max(criado_em) from public.mensagens),
    'tokens_hoje', (select coalesce(sum(tokens), 0) from public.mensagens where criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'tokens_mes', (select coalesce(sum(tokens), 0) from public.mensagens where criado_em >= date_trunc('month', now())),
    'midias_mes', (select count(*) from public.mensagens where tipo in ('audio', 'foto', 'pdf') and criado_em >= date_trunc('month', now())),
    'mensagens_por_dia', (select coalesce(jsonb_agg(x order by x.dia), '[]') from (
        select (criado_em at time zone 'America/Sao_Paulo')::date dia, count(*) n, coalesce(sum(tokens), 0) tokens
        from public.mensagens where criado_em >= now() - interval '30 days' group by 1) x),
    'maiores_consumidores', (select coalesce(jsonb_agg(x), '[]') from (
        select p.nome, p.negocio, count(*) mensagens, coalesce(sum(m.tokens), 0) tokens
        from public.mensagens m join public.perfis p on p.id = m.user_id
        where m.criado_em >= date_trunc('month', now()) group by p.id, p.nome, p.negocio order by 4 desc limit 5) x),
    'saude', (select to_jsonb(s) from public.granninha_saude s where s.id = 1)
  );
end $$;

create function public.admin_auditoria_listar() returns table (criado_em timestamptz, admin text, acao text, cliente text, detalhes jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return query
  select au.criado_em, ad.nome, au.acao, coalesce(cl.nome || ' · ' || cl.negocio, '(removido)'), au.detalhes
  from public.admin_auditoria au
  join public.perfis ad on ad.id = au.admin_id
  left join public.perfis cl on cl.id = au.alvo_user_id
  order by au.criado_em desc limit 300;
end $$;

-- ---------- Ações ----------
-- estender_teste (p_dias), cortesia, liberar (ativa), bloquear, voltar_teste, verificar_numero, desverificar_numero.
-- Motivo obrigatório em tudo que muda acesso.
create function public.admin_acao(p_user uuid, p_acao text, p_motivo text default '', p_dias integer default 0) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare antes jsonb; depois jsonb;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_acao in ('cortesia', 'liberar', 'bloquear', 'estender_teste', 'voltar_teste') and length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'motivo obrigatório' using errcode = '22023';
  end if;
  select to_jsonb(a) into antes from public.assinaturas a where a.user_id = p_user;
  if antes is null and p_acao not in ('verificar_numero', 'desverificar_numero') then raise exception 'cliente sem assinatura' using errcode = '22023'; end if;

  if p_acao = 'estender_teste' then
    if p_dias < 1 or p_dias > 90 then raise exception 'dias entre 1 e 90' using errcode = '22023'; end if;
    update public.assinaturas set status = 'trial', trial_fim = greatest(trial_fim, current_date) + p_dias, prox_cobranca = greatest(trial_fim, current_date) + p_dias, motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'cortesia' then
    update public.assinaturas set status = 'cortesia', motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'liberar' then
    update public.assinaturas set status = 'ativa', motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'bloquear' then
    update public.assinaturas set status = 'bloqueada', motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'voltar_teste' then
    update public.assinaturas set status = 'trial', trial_fim = current_date + greatest(p_dias, 1), motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'verificar_numero' then
    update public.perfis set whats_verificado = true where id = p_user;
  elsif p_acao = 'desverificar_numero' then
    update public.perfis set whats_verificado = false where id = p_user;
  else
    raise exception 'ação desconhecida' using errcode = '22023';
  end if;

  select to_jsonb(a) into depois from public.assinaturas a where a.user_id = p_user;
  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
  values ((select auth.uid()), p_acao, p_user, jsonb_build_object('motivo', p_motivo, 'dias', p_dias,
    'antes', antes ->> 'status', 'depois', depois ->> 'status', 'trial_fim_antes', antes ->> 'trial_fim', 'trial_fim_depois', depois ->> 'trial_fim'));
  return jsonb_build_object('ok', true, 'situacao', depois ->> 'status');
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_clientes(text,text)', 'admin_cliente(uuid)', 'admin_painel()', 'admin_auditoria_listar()', 'admin_acao(uuid,text,text,integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
