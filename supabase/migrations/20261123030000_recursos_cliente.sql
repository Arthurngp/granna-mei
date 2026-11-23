-- Recursos de plano superior, liberados POR CLIENTE, SÓ pelo admin (decisão do Arthur em 2026-11-23).
--
-- O primeiro recurso é o "resumo diário de contas": todo dia a Granninha manda no WhatsApp as contas que vencem hoje e avisa se há atrasadas.
-- Não faz parte do plano de R$ 29,90: é de um plano superior que ainda não existe. Até lá ele é liberado cliente a cliente pelo admin, e o
-- cliente NÃO vê nada disso em lugar nenhum (nem no painel, nem no site, nem no WhatsApp).
--
-- Modelo genérico (user_id, recurso) para os próximos recursos pagos caberem sem refazer nada: quando o plano superior existir, a regra de
-- "este cliente tem o recurso X?" entra numa função só do servidor. A lista de recursos é fechada por um check: recurso desconhecido não grava.
--
-- Segurança: a tabela é fechada ao cliente (RLS ligada, sem política, sem permissão para anon e authenticated). Só o serviço (service_role)
-- lê, e só o admin muda, pelas funções abaixo, que conferem eh_admin() (admin com segunda etapa), só valem para papel cliente, exigem motivo
-- e gravam na auditoria o antes e o depois. Por padrão NINGUÉM tem recurso nenhum: sem linha, sem recurso.
--
-- Mesmo liberado, nada é enviado enquanto o interruptor do servidor (AVISOS_RESUMO) estiver desligado, que é o padrão.
-- Idempotente: pode rodar de novo sem efeito.

create table if not exists public.recursos_cliente (
  user_id uuid not null references auth.users (id) on delete cascade,
  recurso text not null check (recurso in ('resumo_diario_contas')),
  motivo text not null check (length(trim(motivo)) >= 3),
  concedido_em timestamptz not null default now(),
  concedido_por uuid references auth.users (id) on delete set null,
  primary key (user_id, recurso)
);

alter table public.recursos_cliente enable row level security;
revoke all on public.recursos_cliente from anon, authenticated;
grant select on public.recursos_cliente to service_role;

-- ---------- Ler: o que este cliente tem liberado ----------
create or replace function public.admin_recursos_cliente(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object('liberados', coalesce((
    select jsonb_agg(jsonb_build_object('recurso', r.recurso, 'motivo', r.motivo, 'desde', r.concedido_em) order by r.recurso)
      from public.recursos_cliente r where r.user_id = p_user), '[]'::jsonb));
end $$;

-- ---------- Liberar ou retirar um recurso de UM cliente ----------
-- Liberar de novo o que já está liberado não muda nada (a data original fica), mas a ação entra na auditoria. Motivo obrigatório.
create or replace function public.admin_recurso_definir(p_user uuid, p_recurso text, p_ativo boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare tinha boolean;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo obrigatório' using errcode = '22023'; end if;
  if p_recurso is null or p_recurso not in ('resumo_diario_contas') then raise exception 'recurso desconhecido' using errcode = '22023'; end if;
  if p_ativo is null then raise exception 'diga se é para liberar ou retirar' using errcode = '22023'; end if;
  if not exists (select 1 from public.perfis p where p.id = p_user and p.papel = 'cliente') then raise exception 'cliente não encontrado' using errcode = '22023'; end if;

  select exists (select 1 from public.recursos_cliente r where r.user_id = p_user and r.recurso = p_recurso) into tinha;
  if p_ativo then
    insert into public.recursos_cliente (user_id, recurso, motivo, concedido_em, concedido_por)
      values (p_user, p_recurso, trim(p_motivo), now(), (select auth.uid()))
      on conflict (user_id, recurso) do nothing;
  else
    delete from public.recursos_cliente where user_id = p_user and recurso = p_recurso;
  end if;

  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
    values ((select auth.uid()), 'recurso_cliente', p_user,
            jsonb_build_object('recurso', p_recurso, 'motivo', p_motivo,
                               'antes', case when tinha then 'liberado' else 'não liberado' end,
                               'depois', case when p_ativo then 'liberado' else 'não liberado' end));
  return jsonb_build_object('ok', true, 'recurso', p_recurso, 'liberado', p_ativo);
end $$;

-- Só quem está logado chama (e a função confere eh_admin() lá dentro).
revoke all on function public.admin_recursos_cliente(uuid) from public, anon;
revoke all on function public.admin_recurso_definir(uuid, text, boolean, text) from public, anon;
grant execute on function public.admin_recursos_cliente(uuid) to authenticated;
grant execute on function public.admin_recurso_definir(uuid, text, boolean, text) to authenticated;
