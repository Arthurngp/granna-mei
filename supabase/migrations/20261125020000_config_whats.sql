-- Configuração da conta pela conversa do WhatsApp (itens at-12 e at-13 do backlog; decisão do Arthur em 24/11: o site pede só o WhatsApp e
-- "completa por lá tudo").
--
-- Duas colunas em perfis:
--   onboarding_via  'whats' para quem entrou pelo cadastro novo (o site grava; o cliente pode gravar só esta coluna, e só com estes valores).
--                   É a marca que faz o servidor começar a configuração pela conversa quando o número é confirmado.
--   config_whats    o estado da configuração (etapa, quando perguntou, saldos postos). SÓ o servidor grava (service_role); o cliente não tem
--                   permissão de escrita nela.
--
-- Não muda nenhuma linha existente: as duas colunas nascem vazias, e quem já tem conta segue exatamente como antes.
-- Compatível nos dois sentidos: o servidor e o site atuais não leem estas colunas; o servidor novo sem a migration não começa a configuração.
-- Rodar de novo é inofensivo.

alter table public.perfis add column if not exists onboarding_via text;
alter table public.perfis add column if not exists config_whats jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_onboarding_via_valido' and conrelid = 'public.perfis'::regclass) then
    alter table public.perfis add constraint perfis_onboarding_via_valido check (onboarding_via is null or onboarding_via in ('site', 'whats'));
  end if;
end $$;

-- O cliente marca de onde veio; o estado da configuração é só do servidor.
grant update (onboarding_via) on public.perfis to authenticated;
