-- Cadastros por origem (LP e campanha) para o admin. A origem vem do site (site/origem.js) e é gravada
-- no cadastro em auth.users.raw_user_meta_data -> 'origem' -> 'ultima' (última chegada antes de criar a conta).

create function public.admin_origens() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'por_lp', (select coalesce(jsonb_agg(x order by x.cadastros desc), '[]') from (
        select coalesce(u.raw_user_meta_data -> 'origem' -> 'ultima' ->> 'lp', 'sem origem') lp,
          count(*) cadastros,
          count(*) filter (where p.whats_verificado) confirmados,
          count(*) filter (where a.status = 'ativa') pagantes
        from auth.users u
        join public.perfis p on p.id = u.id
        left join public.assinaturas a on a.user_id = u.id
        group by 1) x),
    'por_campanha', (select coalesce(jsonb_agg(x order by x.cadastros desc), '[]') from (
        select u.raw_user_meta_data -> 'origem' -> 'ultima' ->> 'utm_campaign' campanha,
          count(*) cadastros
        from auth.users u
        join public.perfis p on p.id = u.id
        where u.raw_user_meta_data -> 'origem' -> 'ultima' ->> 'utm_campaign' is not null
        group by 1 limit 50) x)
  );
end $$;
revoke all on function public.admin_origens() from public, anon;
grant execute on function public.admin_origens() to authenticated;
