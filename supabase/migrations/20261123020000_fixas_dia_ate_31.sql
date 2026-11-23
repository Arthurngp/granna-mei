-- Conta fixa pode vencer até o dia 31 (achado do Arthur em 18/11: aluguel, internet e parcela do dia 30 não cabiam, e são das contas mais comuns do MEI).
--
-- A tabela `fixas` nasceu com check (dia between 1 and 28), de propósito, para fugir de fevereiro. A tela e o WhatsApp passam a aceitar 1 a 31 e,
-- no mês que não tem aquele dia, o vencimento vai para o último dia do mês (dia 31 vira 30 em abril, 28 ou 29 em fevereiro). Cada vencimento é
-- calculado a partir do dia configurado, nunca do vencimento anterior, então o 31 de março volta a ser 31.
--
-- Só troca a regra da coluna `dia`: nenhuma linha é lida nem alterada. As fixas que já estão com dia 28 ou menos seguem como estão.
-- Idempotente: pode rodar de novo. Sem esta migration, o painel e o WhatsApp deixam escolher o dia 29 a 31 mas o banco recusa ao gravar.

do $$
declare
  coluna smallint;
  c record;
begin
  select a.attnum into coluna from pg_attribute a
   where a.attrelid = 'public.fixas'::regclass and a.attname = 'dia' and not a.attisdropped;
  -- Remove toda regra de check que olha só a coluna `dia`, qualquer que seja o nome (a original é fixas_dia_check).
  for c in select conname from pg_constraint
            where conrelid = 'public.fixas'::regclass and contype = 'c' and conkey = array[coluna]
  loop
    execute format('alter table public.fixas drop constraint %I', c.conname);
  end loop;
  alter table public.fixas add constraint fixas_dia_check check (dia between 1 and 31);
end $$;
