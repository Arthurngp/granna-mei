-- Fase "Conversa sem falha": nenhuma mensagem perdida em deploy ou queda.
--
-- A chegada passa a ser gravada ANTES de o webhook responder 200 ao gateway (que não reenvia), e uma
-- varredura a cada minuto olha o que ficou com status 'recebida'. Para retomar áudio e foto é preciso
-- o fileUrl, que só existe no evento do gateway — por isso ele fica guardado aqui.
--
-- Sem esta migration o serviço continua funcionando: ele detecta a ausência da coluna e grava sem ela,
-- e a retomada atende só as mensagens de texto.

alter table public.mensagens add column if not exists evento jsonb;

comment on column public.mensagens.evento is
  'Evento bruto do gateway (inclui fileUrl de áudio/foto/PDF), para retomar mensagem que ficou em status recebida.';

-- A varredura roda a cada minuto e só olha quem está preso.
create index if not exists mensagens_presas on public.mensagens (criado_em desc) where status = 'recebida';

-- Sem isto o PostgREST só enxerga a coluna nova no próximo reinício.
notify pgrst, 'reload schema';
