-- Oferta de novembro/2026: quem cria a conta até 30/11 usa grátis até 30/11, com no mínimo 7 dias.
-- A partir de 01/12 a regra volta sozinha a 7 dias, porque current_date + 7 passa a ser sempre maior que 30/11.
alter table public.assinaturas alter column trial_fim set default greatest(current_date + 7, date '2026-11-30');

-- Quem já está em teste ganha a mesma condição.
update public.assinaturas
   set trial_fim = greatest(trial_fim, date '2026-11-30'), atualizado_em = now()
 where status = 'trial';
