-- Granna Mei: o que a Granninha (serviço do WhatsApp) e o admin precisam no banco.
-- O serviço usa a service_role, que ignora RLS: toda regra de acesso dele está no código,
-- sempre filtrando pelo user_id descoberto a partir do número que mandou a mensagem.

-- ---------- Papel e cortesia ----------
alter table public.perfis add column papel text not null default 'cliente' check (papel in ('cliente', 'admin'));
-- O cliente não altera o próprio papel: a permissão de update por coluna (fase 1) não inclui "papel".

alter table public.assinaturas drop constraint assinaturas_status_check;
alter table public.assinaturas add constraint assinaturas_status_check check (status in ('trial', 'ativa', 'atrasada', 'bloqueada', 'cortesia'));
alter table public.assinaturas add column motivo text;

-- Cortesia (parceiro liberado pelo admin) grava como quem está em dia, e a cobrança nunca bloqueia.
create or replace function public.acesso_liberado() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assinaturas a
    where a.user_id = (select auth.uid())
      and (a.status in ('ativa', 'atrasada', 'cortesia') or (a.status = 'trial' and a.trial_fim >= current_date))
  );
$$;

-- ---------- Número do WhatsApp ----------
-- Chave para achar o cliente pelo número: DDD + últimos 8 dígitos. Assim "(81) 98765-4321" e o
-- JID "558187654321" (o WhatsApp às vezes manda sem o nono dígito) dão a mesma chave.
alter table public.perfis add column whats_chave text generated always as (
  case when length(regexp_replace(whats, '\D', '', 'g')) >= 10
    then left(regexp_replace(whats, '\D', '', 'g'), 2) || right(regexp_replace(whats, '\D', '', 'g'), 8)
  end
) stored;
-- Um número verificado pertence a uma conta só.
create unique index perfis_whats_verificado on public.perfis (whats_chave) where whats_verificado;

-- Código que o cliente MANDA para a Granninha para provar que o número é dele.
create table public.verificacoes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  codigo text not null,
  expira_em timestamptz not null default now() + interval '30 minutes'
);
alter table public.verificacoes enable row level security;
revoke all on public.verificacoes from anon, authenticated;

create function public.gerar_codigo_whats() returns text
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'sem login'; end if;
  c := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.verificacoes (user_id, codigo) values (auth.uid(), c)
  on conflict (user_id) do update set codigo = excluded.codigo, expira_em = now() + interval '30 minutes';
  return c;
end $$;
revoke all on function public.gerar_codigo_whats() from public, anon;
grant execute on function public.gerar_codigo_whats() to authenticated;

-- ---------- Mensagens (registro, idempotência e desfazer) ----------
-- O id é o da mensagem no WhatsApp: a mesma mensagem entregue duas vezes não vira dois lançamentos.
create table public.mensagens (
  id text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  telefone text not null,
  tipo text not null default 'texto',
  texto text not null default '',
  intencao text,
  status text not null default 'recebida' check (status in ('recebida', 'ok', 'pergunta', 'ignorada', 'bloqueada', 'erro', 'limite')),
  resposta text,
  erro text,
  -- O que esta mensagem criou ou mudou, para o DESFAZER saber o que reverter.
  efeitos jsonb not null default '{}'::jsonb,
  desfeita boolean not null default false,
  ms integer,
  tokens integer,
  criado_em timestamptz not null default now()
);
create index mensagens_user on public.mensagens (user_id, criado_em desc);
create index mensagens_dia on public.mensagens (criado_em desc);
alter table public.mensagens enable row level security;
revoke all on public.mensagens from anon, authenticated;

-- Pergunta em aberto por número (ex.: "qual foi o valor?"), para juntar com a resposta seguinte.
create table public.conversas (
  telefone text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  pendente jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.conversas enable row level security;
revoke all on public.conversas from anon, authenticated;

-- ---------- Auditoria do admin ----------
create table public.admin_auditoria (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users (id),
  acao text not null,
  alvo_user_id uuid references auth.users (id) on delete set null,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
alter table public.admin_auditoria enable row level security;
revoke all on public.admin_auditoria from anon, authenticated;
