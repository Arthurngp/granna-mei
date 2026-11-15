-- Granna Mei: tabelas base, regras de acesso por cliente e gatilho de conta nova.
-- Regra de ouro: cada linha tem user_id e só o dono enxerga. Quem está com a assinatura
-- bloqueada lê os próprios dados (para baixar), mas não grava.

-- ---------- Perfil (um por conta) ----------
create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  negocio text not null default '',
  cnpj text not null default '',
  whats text not null default '',
  -- Só o servidor marca como verificado: é esse número que a Granninha aceita no WhatsApp.
  whats_verificado boolean not null default false,
  ramo text not null default '',
  onboarding_feito boolean not null default false,
  onboarding_passo smallint not null default 0,
  resumo_dia smallint not null default 1 check (resumo_dia between 0 and 6),
  resumo_hora text not null default '08:00',
  lembrete_hora text not null default '09:00',
  antecedencia smallint not null default 1 check (antecedencia between 0 and 7),
  ocultar boolean not null default false,
  contador_nome text not null default '',
  contador_email text not null default '',
  contador_whats text not null default '',
  contador_auto boolean not null default false,
  exclusao_em date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------- Assinatura (só o servidor grava) ----------
create table public.assinaturas (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'trial' check (status in ('trial', 'ativa', 'atrasada', 'bloqueada')),
  plano text not null default 'mensal' check (plano in ('mensal', 'anual')),
  trial_fim date not null default (current_date + 7),
  prox_cobranca date not null default (current_date + 7),
  atualizado_em timestamptz not null default now()
);

create table public.faturas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  data date not null,
  valor numeric(10, 2) not null check (valor > 0),
  status text not null default 'paga' check (status in ('paga', 'aberta'))
);
create index faturas_user on public.faturas (user_id, data desc);

-- ---------- Dados do cliente ----------
create table public.carteiras (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  nome text not null,
  tipo text not null check (tipo in ('banco', 'dinheiro', 'maquininha', 'outro')),
  saldo_inicial numeric(12, 2) not null default 0,
  padrao boolean not null default false,
  primary key (user_id, id)
);

create table public.categorias (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  nome text not null,
  tipo text not null check (tipo in ('entrada', 'saida')),
  cor text not null default '#747EAD',
  natureza text check (natureza in ('servico', 'comercio')),
  pessoal boolean not null default false,
  primary key (user_id, id)
);

create table public.lancamentos (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  tipo text not null check (tipo in ('entrada', 'saida', 'transferencia')),
  valor numeric(12, 2) not null check (valor > 0),
  descricao text not null default '',
  categoria_id text,
  carteira_id text not null,
  carteira_destino_id text,
  data date not null,
  hora text not null default '00:00',
  origem text not null default 'painel' check (origem in ('texto', 'audio', 'foto', 'pdf', 'painel')),
  anexo_path text,
  pessoal boolean not null default false,
  criado_em timestamptz not null default now(),
  primary key (user_id, id)
);
create index lancamentos_data on public.lancamentos (user_id, data desc);

create table public.fixas (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  descricao text not null,
  valor numeric(12, 2) not null check (valor > 0),
  dia smallint not null check (dia between 1 and 28),
  categoria_id text,
  das boolean not null default false,
  primary key (user_id, id)
);

create table public.contas (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  tipo text not null check (tipo in ('pagar', 'receber')),
  descricao text not null,
  valor numeric(12, 2) not null check (valor > 0),
  vencimento date not null,
  status text not null default 'aberta' check (status in ('aberta', 'paga')),
  categoria_id text,
  fixa_id text,
  parcela_n smallint,
  parcela_total smallint,
  das boolean not null default false,
  pago_em date,
  lancamento_id text,
  primary key (user_id, id)
);
create index contas_venc on public.contas (user_id, vencimento);

-- ---------- Quem pode gravar ----------
-- Teste grátis dentro do prazo, em dia ou em atraso (as 24h de carência) gravam. Bloqueado e teste vencido não.
create function public.acesso_liberado() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assinaturas a
    where a.user_id = (select auth.uid())
      and (a.status in ('ativa', 'atrasada') or (a.status = 'trial' and a.trial_fim >= current_date))
  );
$$;
revoke all on function public.acesso_liberado() from public, anon;
grant execute on function public.acesso_liberado() to authenticated;

-- ---------- Regras de acesso (RLS) ----------
alter table public.perfis enable row level security;
alter table public.assinaturas enable row level security;
alter table public.faturas enable row level security;
alter table public.carteiras enable row level security;
alter table public.categorias enable row level security;
alter table public.lancamentos enable row level security;
alter table public.fixas enable row level security;
alter table public.contas enable row level security;

create policy perfil_le on public.perfis for select to authenticated using (id = (select auth.uid()));
create policy perfil_muda on public.perfis for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy assinatura_le on public.assinaturas for select to authenticated using (user_id = (select auth.uid()));
create policy fatura_le on public.faturas for select to authenticated using (user_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['carteiras', 'categorias', 'lancamentos', 'fixas', 'contas'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_le', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()) and public.acesso_liberado())', t || '_cria', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid()) and public.acesso_liberado()) with check (user_id = (select auth.uid()) and public.acesso_liberado())', t || '_muda', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()) and public.acesso_liberado())', t || '_apaga', t);
  end loop;
end $$;

-- ---------- Permissões de tabela ----------
-- Visitante sem login não toca em nada.
revoke all on all tables in schema public from anon;
-- Assinatura e faturas: o cliente só lê. Quem grava é o servidor (pagamento confirmado).
revoke insert, update, delete, truncate on public.assinaturas, public.faturas from authenticated;
-- Perfil: nasce pelo gatilho; o cliente altera só os campos dele (nunca whats_verificado).
revoke insert, update, delete, truncate on public.perfis from authenticated;
grant update (nome, negocio, cnpj, whats, ramo, onboarding_feito, onboarding_passo, resumo_dia, resumo_hora, lembrete_hora,
  antecedencia, ocultar, contador_nome, contador_email, contador_whats, contador_auto, exclusao_em) on public.perfis to authenticated;

-- ---------- Gatilhos ----------
-- Trocar o número derruba a verificação: o número novo precisa ser confirmado de novo.
create function public.perfil_antes_de_mudar() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.whats is distinct from old.whats and coalesce(auth.role(), '') <> 'service_role' then
    new.whats_verificado := false;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger perfil_antes_de_mudar before update on public.perfis for each row execute function public.perfil_antes_de_mudar();

-- Conta nova ganha perfil e 7 dias de teste.
create function public.ao_criar_usuario() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.perfis (id, nome) values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', ''));
  insert into public.assinaturas (user_id) values (new.id);
  return new;
end $$;
revoke all on function public.ao_criar_usuario() from public, anon, authenticated;
revoke all on function public.perfil_antes_de_mudar() from public, anon, authenticated;
create trigger ao_criar_usuario after insert on auth.users for each row execute function public.ao_criar_usuario();

-- ---------- Comprovantes ----------
-- Pasta privada por cliente: comprovantes/<user_id>/arquivo. O cliente só lê os dele; quem grava é o servidor.
insert into storage.buckets (id, name, public) values ('comprovantes', 'comprovantes', false) on conflict (id) do nothing;
create policy comprovante_le on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and (storage.foldername(name))[1] = (select auth.uid())::text);
