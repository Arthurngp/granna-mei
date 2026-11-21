-- Limite mensal de lançamentos pelo WhatsApp, configurável pelo admin: um PADRÃO para todos os clientes e um valor PRÓPRIO por cliente.
--
-- Decisão do Arthur (2026-11-21): o cliente não vê o número (já fora da tela e do WhatsApp) e o admin muda o limite de todos, ou de um
-- só, para menos ou para mais, quando quiser. O servidor lê estas tabelas a cada mensagem; sem elas (ou se a leitura falhar) ele usa o
-- valor de fábrica (300), então rodar esta migration só TROCA de onde o número vem, sem mudar o comportamento de hoje.
--
-- Segurança: as duas tabelas são fechadas ao cliente (RLS ligada, sem política, sem permissão para anon e authenticated). Só o serviço
-- (service_role) lê, e só o admin muda, pelas funções abaixo, que conferem eh_admin() (admin com segunda etapa) e gravam na auditoria.
-- Faixa de 1 a 100000: zero ou negativo bloquearia todo mundo por engano (para bloquear alguém existe "Bloquear acesso").
--
-- Idempotente: pode rodar de novo sem efeito.

create table if not exists public.config_limite (
  id boolean primary key default true check (id),
  lancamentos integer not null check (lancamentos between 1 and 100000),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null
);
-- Linha única. 300 é o valor de fábrica que o servidor já usava (a variável LIMITE_LANCAMENTOS não está definida em produção).
insert into public.config_limite (id, lancamentos) values (true, 300) on conflict (id) do nothing;

create table if not exists public.limite_cliente (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lancamentos integer not null check (lancamentos between 1 and 100000),
  motivo text not null check (length(trim(motivo)) >= 3),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null
);

alter table public.config_limite enable row level security;
alter table public.limite_cliente enable row level security;
revoke all on public.config_limite from anon, authenticated;
revoke all on public.limite_cliente from anon, authenticated;

-- ---------- Ler: o limite de um cliente e quanto ele já usou no mês ----------
-- "Uso" é a mesma conta do servidor (banco.ts, usoDoMes): mensagens que viraram lançamento (status ok) desde o dia 1, em horário de São Paulo.
create or replace function public.admin_limite_cliente(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare padrao integer; proprio integer; uso integer; inicio timestamptz;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  select c.lancamentos into padrao from public.config_limite c where c.id;
  select l.lancamentos into proprio from public.limite_cliente l where l.user_id = p_user;
  inicio := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select count(*) into uso from public.mensagens m where m.user_id = p_user and m.status = 'ok' and m.criado_em >= inicio;
  padrao := coalesce(padrao, 300);
  return jsonb_build_object('padrao', padrao, 'proprio', proprio, 'efetivo', coalesce(proprio, padrao), 'uso_mes', uso);
end $$;

-- ---------- Mudar: o padrão de todos (p_user nulo) ou o de um cliente ----------
-- p_user nulo: troca o padrão (p_valor obrigatório). p_user informado: define o limite próprio daquele cliente; com p_valor nulo,
-- REMOVE o limite próprio e o cliente volta a seguir o padrão. Motivo obrigatório. Tudo grava na auditoria (antes e depois em texto).
create or replace function public.admin_limite_definir(p_user uuid, p_valor integer, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare padrao integer; proprio integer; antes text; depois text;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo obrigatório' using errcode = '22023'; end if;

  if p_user is null then
    if p_valor is null or p_valor < 1 or p_valor > 100000 then raise exception 'o limite vai de 1 a 100000' using errcode = '22023'; end if;
    select c.lancamentos::text into antes from public.config_limite c where c.id;
    insert into public.config_limite (id, lancamentos, atualizado_em, atualizado_por) values (true, p_valor, now(), (select auth.uid()))
      on conflict (id) do update set lancamentos = excluded.lancamentos, atualizado_em = now(), atualizado_por = (select auth.uid());
    insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
      values ((select auth.uid()), 'limite_global', null, jsonb_build_object('motivo', p_motivo, 'antes', coalesce(antes, 'sem valor'), 'depois', p_valor::text));
  else
    if not exists (select 1 from public.perfis p where p.id = p_user and p.papel = 'cliente') then raise exception 'cliente não encontrado' using errcode = '22023'; end if;
    select l.lancamentos::text into antes from public.limite_cliente l where l.user_id = p_user;
    if p_valor is null then
      delete from public.limite_cliente where user_id = p_user;
    else
      if p_valor < 1 or p_valor > 100000 then raise exception 'o limite vai de 1 a 100000' using errcode = '22023'; end if;
      insert into public.limite_cliente (user_id, lancamentos, motivo, atualizado_em, atualizado_por) values (p_user, p_valor, trim(p_motivo), now(), (select auth.uid()))
        on conflict (user_id) do update set lancamentos = excluded.lancamentos, motivo = excluded.motivo, atualizado_em = now(), atualizado_por = (select auth.uid());
    end if;
    insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
      values ((select auth.uid()), 'limite_cliente', p_user, jsonb_build_object('motivo', p_motivo, 'antes', coalesce(antes, 'padrão'), 'depois', coalesce(p_valor::text, 'padrão')));
  end if;

  select c.lancamentos into padrao from public.config_limite c where c.id;
  if p_user is not null then select l.lancamentos into proprio from public.limite_cliente l where l.user_id = p_user; end if;
  padrao := coalesce(padrao, 300);
  return jsonb_build_object('ok', true, 'padrao', padrao, 'proprio', proprio, 'efetivo', coalesce(proprio, padrao));
end $$;

-- ---------- Prévia: quantos clientes ficariam sem anotar se o padrão virar p_valor ----------
-- Só conta quem segue o padrão (quem tem limite próprio não muda) e que já usou p_valor ou mais neste mês: esses param de anotar na hora.
create or replace function public.admin_limite_previa(p_valor integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare inicio timestamptz; passam integer; total integer;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_valor is null or p_valor < 1 or p_valor > 100000 then raise exception 'o limite vai de 1 a 100000' using errcode = '22023'; end if;
  inicio := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select count(*) filter (where coalesce(u.n, 0) >= p_valor), count(*) into passam, total
    from public.perfis p
    left join (select m.user_id, count(*) n from public.mensagens m where m.status = 'ok' and m.criado_em >= inicio group by m.user_id) u on u.user_id = p.id
   where p.papel = 'cliente' and not exists (select 1 from public.limite_cliente l where l.user_id = p.id);
  return jsonb_build_object('passam', passam, 'total', total);
end $$;

-- Só quem está logado chama (e a função confere eh_admin() lá dentro).
revoke all on function public.admin_limite_cliente(uuid) from public, anon;
revoke all on function public.admin_limite_definir(uuid, integer, text) from public, anon;
revoke all on function public.admin_limite_previa(integer) from public, anon;
grant execute on function public.admin_limite_cliente(uuid) to authenticated;
grant execute on function public.admin_limite_definir(uuid, integer, text) to authenticated;
grant execute on function public.admin_limite_previa(integer) to authenticated;
