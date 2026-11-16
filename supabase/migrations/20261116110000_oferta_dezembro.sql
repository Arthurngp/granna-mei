-- Oferta (decisão do Arthur, 16/11/2026): quem cria a conta até 30/11 usa grátis até 31/12, com tudo liberado.
-- A partir de 01/12 o cadastro novo volta a ter 7 dias de teste.
alter table public.assinaturas alter column trial_fim set default (case when current_date <= date '2026-11-30' then date '2026-12-31' else current_date + 7 end);

-- Quem já está em teste ganha a mesma condição.
update public.assinaturas
   set trial_fim = greatest(trial_fim, date '2026-12-31'), atualizado_em = now()
 where status = 'trial';
