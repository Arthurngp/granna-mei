-- Oferta (decisão do Arthur, 18/11/2026): quem cria a conta ATÉ 31/12/2026 usa grátis até 31/12/2026,
-- com tudo liberado. A cobrança passa a valer em 01/01/2027, quando o cadastro novo volta aos 7 dias
-- de teste. Substitui a regra de 16/11, que cortava a promoção em 30/11 e deixava quem entrasse em
-- dezembro com 7 dias e nenhuma forma de pagar.
--
-- Toda data é lida no fuso de São Paulo: o banco pode rodar em UTC, onde o dia vira às 21h e quem
-- criasse a conta às 22h do dia 31 cairia na regra de janeiro.

alter table public.assinaturas
  alter column trial_fim set default (
    case
      when (now() at time zone 'America/Sao_Paulo')::date <= date '2026-12-31' then date '2026-12-31'
      else (now() at time zone 'America/Sao_Paulo')::date + 7
    end
  );

-- Quem já está em teste (inclusive quem se cadastrou depois de 30/11 e pegou só 7 dias) fica com a
-- mesma condição. greatest() nunca encurta o prazo de ninguém.
update public.assinaturas
   set trial_fim = greatest(trial_fim, date '2026-12-31'), atualizado_em = now()
 where status = 'trial';

-- O bloqueio comparava com current_date (UTC). Em 31/12 às 21h de São Paulo o acesso cairia três
-- horas antes do prometido. Passa a comparar com a data de São Paulo.
create or replace function public.acesso_liberado() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assinaturas a
    where a.user_id = (select auth.uid())
      and (
        a.status in ('ativa', 'atrasada', 'cortesia')
        or (a.status = 'trial' and a.trial_fim >= (now() at time zone 'America/Sao_Paulo')::date)
      )
  );
$$;
revoke all on function public.acesso_liberado() from public, anon;
grant execute on function public.acesso_liberado() to authenticated;
