-- Várias contas, cartão de crédito, investimento, categoria "Outros gastos" e custo de IA separado.
-- Só ADITIVA: nada é apagado e o código antigo continua funcionando com o banco novo.

-- Carteira ganha dois tipos: cartão de crédito e investimento.
alter table public.carteiras drop constraint carteiras_tipo_check;
alter table public.carteiras add constraint carteiras_tipo_check
  check (tipo in ('banco', 'dinheiro', 'maquininha', 'outro', 'cartao', 'investimento'));

-- Dados do cartão (vazios para os outros tipos).
alter table public.carteiras
  add column if not exists fechamento smallint check (fechamento between 1 and 31),
  add column if not exists vencimento smallint check (vencimento between 1 and 31),
  add column if not exists conta_pagamento_id text,
  add column if not exists limite numeric(12, 2) check (limite is null or limite >= 0);

-- Compra no cartão é um tipo próprio: não conta como saída até a fatura ser paga.
-- "fatura" é o mês de vencimento da fatura em que a compra cai (AAAA-MM).
alter table public.lancamentos drop constraint lancamentos_tipo_check;
alter table public.lancamentos add constraint lancamentos_tipo_check
  check (tipo in ('entrada', 'saida', 'transferencia', 'compra_cartao'));
alter table public.lancamentos
  add column if not exists fatura text check (fatura is null or fatura ~ '^[0-9]{4}-[0-9]{2}$'),
  add column if not exists parcela_n smallint,
  add column if not exists parcela_total smallint;

-- Categoria de reserva para gastos, para todo cliente que já tem categorias.
insert into public.categorias (user_id, id, nome, tipo, cor)
select distinct user_id, 'outras-saidas', 'Outros gastos', 'saida', '#8A8FA8' from public.categorias
on conflict (user_id, id) do nothing;

-- Custo de IA: entrada e saída separadas (preços diferentes) e duração do áudio transcrito.
alter table public.mensagens
  add column if not exists tokens_entrada integer,
  add column if not exists tokens_saida integer,
  add column if not exists audio_seg numeric(8, 1),
  add column if not exists audio_tokens integer;

-- Foto de perfil: pasta privada por cliente (avatares/<user_id>/...), até 2 MB, só imagem.
alter table public.perfis add column if not exists foto_path text;
grant update (foto_path) on public.perfis to authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy avatar_le on storage.objects for select to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatar_cria on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatar_muda on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatar_apaga on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);
