-- Permite apagar a conta de quem já foi admin: o histórico de auditoria fica, sem o autor.
-- Antes, admin_auditoria.admin_id era NOT NULL sem ON DELETE, e apagar um admin com ações registradas falhava.

alter table public.admin_auditoria alter column admin_id drop not null;
alter table public.admin_auditoria drop constraint admin_auditoria_admin_id_fkey;
alter table public.admin_auditoria add constraint admin_auditoria_admin_id_fkey
  foreign key (admin_id) references auth.users (id) on delete set null;

create or replace function public.admin_auditoria_listar() returns table (criado_em timestamptz, admin text, acao text, cliente text, detalhes jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return query
  select au.criado_em, coalesce(ad.nome, '(removido)'), au.acao, coalesce(cl.nome || ' · ' || cl.negocio, '(removido)'), au.detalhes
  from public.admin_auditoria au
  left join public.perfis ad on ad.id = au.admin_id
  left join public.perfis cl on cl.id = au.alvo_user_id
  order by au.criado_em desc limit 300;
end $$;
