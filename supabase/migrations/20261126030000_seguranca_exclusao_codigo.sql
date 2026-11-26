-- Auditoria de segurança de 2026-11-26. Duas travas no banco, sem mexer em nenhuma linha existente:
--
-- 1) Prazo de exclusão: o painel grava `exclusao_em` junto do resto do perfil, e a coluna é editável pelo cliente. Com um PATCH direto
--    (`exclusao_em = '2000-01-01'`) a conta seria apagada na próxima varredura, sem os 30 dias de carência (e uma sessão roubada apagaria tudo).
--    Agora o gatilho que já roda antes de cada alteração de perfil força QUALQUER pedido de exclusão feito pelo cliente para hoje + 30 dias
--    (horário de São Paulo). Cancelar (voltar a nulo) continua livre. O servidor (service_role) segue podendo gravar o que precisar.
--    Não tira a permissão da coluna de propósito: o painel salva o perfil inteiro de uma vez e quebraria para todos.
--
-- 2) Código de confirmação do WhatsApp: era sorteado com random(), que não serve para segredo. Agora sai de gen_random_uuid() (gerador forte do
--    Postgres). Conta sem número continua gerando código de propósito: quem cria a conta sem digitar o número confirma mandando o código.
--
-- Mesmas assinaturas, `create or replace`. Idempotente.

create or replace function public.perfil_antes_de_mudar() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.whats is distinct from old.whats and coalesce(auth.role(), '') <> 'service_role' then
    new.whats_verificado := false;
  end if;
  -- Pedido de exclusão pelo cliente: sempre daqui a 30 dias, nunca antes.
  if new.exclusao_em is distinct from old.exclusao_em and new.exclusao_em is not null and coalesce(auth.role(), '') <> 'service_role' then
    new.exclusao_em := (now() at time zone 'America/Sao_Paulo')::date + 30;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
revoke all on function public.perfil_antes_de_mudar() from public, anon, authenticated;

create or replace function public.gerar_codigo_whats() returns text
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'sem login'; end if;
  -- 48 bits do gerador forte, reduzidos a 6 dígitos.
  c := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint % 1000000))::text, 6, '0');
  insert into public.verificacoes (user_id, codigo) values (auth.uid(), c)
  on conflict (user_id) do update set codigo = excluded.codigo, expira_em = now() + interval '30 minutes';
  return c;
end $$;
revoke all on function public.gerar_codigo_whats() from public, anon;
grant execute on function public.gerar_codigo_whats() to authenticated;
