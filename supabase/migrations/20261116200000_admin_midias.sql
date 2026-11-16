-- Mídias do mês separadas por tipo para o admin (áudios, fotos e PDFs).
-- Mesmo recorte de mês do admin_painel().midias_mes, para os três somarem o total que já aparecia.

create function public.admin_midias_mes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'audio', count(*) filter (where m.tipo = 'audio'),
      'foto', count(*) filter (where m.tipo = 'foto'),
      'pdf', count(*) filter (where m.tipo = 'pdf'))
    from public.mensagens m
    where m.tipo in ('audio', 'foto', 'pdf') and m.criado_em >= date_trunc('month', now())
  );
end $$;
revoke all on function public.admin_midias_mes() from public, anon;
grant execute on function public.admin_midias_mes() to authenticated;
