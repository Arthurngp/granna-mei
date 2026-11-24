-- Configurações da IA (aba "Configurações" do admin): modelo por tarefa para TODOS, modelo por tarefa para UM cliente e chaves de API cadastradas pela tela.
-- Só cria tabelas novas e VAZIAS: nada muda no comportamento de hoje até o dono configurar alguma coisa. Sem esta migration o servidor segue com o modelo de
-- fábrica e a chave do ambiente (ele lê estas tabelas com tolerância a falha).
--
-- As três tabelas são FECHADAS ao cliente e ao anônimo: só o servidor (service_role) lê e grava, porque a chave guardada é segredo. A chave fica CIFRADA
-- (AES-256-GCM, feita no servidor com o segredo IA_SEGREDO): o banco só guarda o texto cifrado e os 4 últimos caracteres para a tela mostrar.
-- Idempotente: pode rodar de novo.

create table if not exists public.config_ia_modelo (
  tarefa text primary key check (tarefa in ('interpretacao', 'documento', 'ajuda', 'resposta', 'audio')),
  modelo text not null check (modelo ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$'),
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.ia_modelo_cliente (
  user_id uuid not null references auth.users (id) on delete cascade,
  tarefa text not null check (tarefa in ('interpretacao', 'documento', 'ajuda', 'resposta', 'audio')),
  modelo text not null check (modelo ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$'),
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, tarefa)
);

create table if not exists public.ia_chaves (
  id uuid primary key default gen_random_uuid(),
  provedor text not null default 'openai' check (provedor in ('openai')),
  nome text not null check (length(btrim(nome)) between 1 and 60),
  chave_cifrada text not null,
  ultimos4 text not null check (length(ultimos4) = 4),
  -- Chave nova nasce DESLIGADA e só vira a usada depois de testada e ativada de propósito.
  ativa boolean not null default false,
  testada_em timestamptz,
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- No máximo UMA chave ativa por provedor.
create unique index if not exists ia_chaves_uma_ativa on public.ia_chaves (provedor) where ativa;

do $$
declare t text;
begin
  foreach t in array array['config_ia_modelo', 'ia_modelo_cliente', 'ia_chaves'] loop
    execute format('alter table public.%I enable row level security', t);
    -- O Supabase concede tudo nas tabelas novas a estes papéis: fechar de propósito.
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
