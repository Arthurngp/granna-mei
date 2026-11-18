-- Exclusão definitiva de conta pelo admin: o log passa a mostrar quem foi apagado.
-- Depois da exclusão não há mais perfil para juntar, então o nome do cliente vem do que o servidor gravou em detalhes.
-- Opcional: sem esta migration a exclusão funciona igual, só aparece "(removido)" no lugar do nome.

create or replace function public.admin_auditoria_listar() returns table (criado_em timestamptz, admin text, acao text, cliente text, detalhes jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return query
  select au.criado_em, coalesce(ad.nome, '(removido)'), au.acao,
         coalesce(cl.nome || ' · ' || cl.negocio, au.detalhes ->> 'cliente', '(removido)'), au.detalhes
  from public.admin_auditoria au
  left join public.perfis ad on ad.id = au.admin_id
  left join public.perfis cl on cl.id = au.alvo_user_id
  order by au.criado_em desc limit 300;
end $$;
