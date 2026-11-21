-- Perfil do público: o que a Granninha pergunta no cadastro. Passo opcional "Quer me contar mais?" (nascimento, cidade e UF,
-- faturamento do negócio, renda pessoal) e a ocupação de quem escolhe "Outro ramo" (obrigatória).
--
-- As colunas nascimento, cidade, uf, faturamento_faixa, ocupacao e perfil_em têm a MESMA definição da migration da página
-- Público do admin (20261121130000_admin_acoes_retencao_publico.sql): com "add column if not exists", a segunda a rodar não
-- faz nada, em qualquer ordem. Só renda_faixa é nova aqui. Idempotente.
--
-- Sem o grant no fim, o PATCH do cliente é recusado (ele só pode alterar as colunas listadas) e o passo opcional não grava.
-- O painel grava estes campos à parte do resto do perfil, então a falta desta migration não trava o cadastro: só perde os dados.

alter table public.perfis
  add column if not exists nascimento date,
  add column if not exists cidade text not null default '',
  add column if not exists uf text not null default '',
  add column if not exists faturamento_faixa text not null default '' check (faturamento_faixa in ('', 'ate_2', '2_4', '4_6750', 'acima', 'prefiro_nao')),
  add column if not exists ocupacao text not null default '',
  add column if not exists perfil_em timestamptz,
  add column if not exists renda_faixa text not null default '' check (renda_faixa in ('', 'ate_2', '2_4', '4_8', 'acima', 'prefiro_nao'));

comment on column public.perfis.renda_faixa is 'Renda pessoal mensal, por faixa: ate_2, 2_4, 4_8, acima, prefiro_nao. Vazio = não respondeu.';
comment on column public.perfis.perfil_em is 'Quando a pessoa respondeu o passo "Quer me contar mais?". Vazio = pulou ou ainda não chegou.';

-- Travas de tamanho: o cliente grava estes campos direto, então o banco não pode aceitar texto sem fim. Em bloco DO porque
-- "add constraint if not exists" não existe; rodar de novo não duplica.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_publico_tamanho' and conrelid = 'public.perfis'::regclass) then
    alter table public.perfis add constraint perfis_publico_tamanho check (
      char_length(cidade) <= 60 and char_length(ocupacao) <= 60 and char_length(uf) <= 2
      and (nascimento is null or nascimento between date '1900-01-01' and date '2100-01-01')
    );
  end if;
end $$;

grant update (nascimento, cidade, uf, faturamento_faixa, ocupacao, perfil_em, renda_faixa) on public.perfis to authenticated;
