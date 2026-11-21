-- Cobrança pela Stripe (fase f5). Só ADICIONA colunas e índices: nenhum dado existente muda.
--
-- Regra que não muda: quem grava em `assinaturas` e `faturas` é só o servidor (service_role).
-- O cliente continua só lendo as próprias linhas (policies assinatura_le e fatura_le da migration base).
--
-- O banco não precisa saber da Stripe para o acesso funcionar: o servidor traduz o estado da Stripe para
-- os status que já existem (trial, ativa, atrasada, bloqueada, cortesia), e acesso_liberado() segue igual.

alter table public.assinaturas
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  -- Quando o pagamento falhou. O servidor bloqueia depois da carência (padrão 24 h, a mesma que o painel promete).
  -- Fica nulo para o "atrasada" que o admin marca à mão: esse nunca é bloqueado sozinho.
  add column if not exists atrasada_desde timestamptz,
  -- Data em que a assinatura termina, quando o cliente pediu para cancelar. O acesso vale até ela.
  add column if not exists cancela_em date;

-- Um cliente da Stripe e uma assinatura por conta, e nunca a mesma coisa em duas contas.
create unique index if not exists assinaturas_stripe_customer on public.assinaturas (stripe_customer_id);
create unique index if not exists assinaturas_stripe_subscription on public.assinaturas (stripe_subscription_id);

-- A fatura da Stripe entra uma vez só, mesmo que o webhook chegue repetido. O índice NÃO é parcial de propósito:
-- o upsert (on conflict) do PostgREST não consegue usar índice parcial. Nulos não colidem entre si no Postgres.
alter table public.faturas
  add column if not exists stripe_invoice_id text;
create unique index if not exists faturas_stripe_invoice on public.faturas (stripe_invoice_id);
