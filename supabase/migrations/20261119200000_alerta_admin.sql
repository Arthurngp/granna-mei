-- Aviso no WhatsApp do dono quando a Granninha para (configurado no painel admin).
--
-- Em 2026-11-19 a chave da OpenAI ficou sem cota e a Granninha respondeu "tive um problema para anotar
-- agora" para todos os clientes por horas, sem avisar ninguém. Estas colunas guardam para quem avisar
-- e o que já foi avisado, para o alerta não virar ruído repetindo a cada minuto.
--
-- Fica na granninha_saude porque ela já é a linha única (id = 1) que o batimento atualiza a cada minuto.

alter table public.granninha_saude
  add column if not exists alerta_whats text not null default '',
  add column if not exists alerta_ligado boolean not null default false,
  add column if not exists alerta_tipo text,
  add column if not exists alerta_em timestamptz;

comment on column public.granninha_saude.alerta_whats is 'Número que recebe o aviso (só dígitos, com DDI). Vazio = sem alerta.';
comment on column public.granninha_saude.alerta_tipo is 'Último problema avisado, para não repetir o mesmo aviso a cada minuto.';

-- A tabela já é só do service_role (o servidor). O painel admin lê e grava por /admin/alerta, que
-- confere papel admin e segunda etapa, então nenhum grant novo é necessário aqui.

notify pgrst, 'reload schema';
