-- Registro dos avisos de conta vencendo que a Granninha manda pelo WhatsApp (fase f4, item f4-vencimento).
--
-- Serve para uma coisa: nunca avisar duas vezes a mesma conta. Quem vai enviar reserva a chave com um insert
-- (`on conflict do nothing`), e só envia se o insert for dele. Sem esta tabela o serviço NÃO envia nada:
-- sem o registro, reinício ou dois processos mandariam em dobro.
--
-- Só o serviço (service_role) enxerga e grava: sem política nenhuma e sem permissão para anon nem authenticated.
-- O cliente que apagar a conta leva os registros junto (on delete cascade).
--
-- Idempotente: pode rodar de novo sem efeito.
create table if not exists public.avisos (
  -- 'venc:<user_id>:<id da conta>:<vencimento>': trocar o vencimento da conta vira um aviso novo, de propósito.
  chave text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null default 'vencimento' check (tipo in ('vencimento')),
  referencia date not null,
  para text not null,
  status text not null default 'enviando' check (status in ('enviando', 'enviado')),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);
create index if not exists avisos_user on public.avisos (user_id, criado_em desc);
create index if not exists avisos_dia on public.avisos (criado_em desc);

alter table public.avisos enable row level security;
revoke all on public.avisos from anon, authenticated;
