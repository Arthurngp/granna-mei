-- Chaves de API: passa a aceitar também o provedor 'anthropic' (antes só 'openai'). O índice ia_chaves_uma_ativa já é por provedor
-- (no máximo UMA chave ativa de cada provedor), então a OpenAI e a Anthropic podem estar ligadas ao mesmo tempo. Idempotente.
alter table public.ia_chaves drop constraint if exists ia_chaves_provedor_check;
alter table public.ia_chaves add constraint ia_chaves_provedor_check check (provedor in ('openai', 'anthropic'));
notify pgrst, 'reload schema';
