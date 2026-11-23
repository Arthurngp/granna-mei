-- Custo de IA no admin: separa o que a IA gasta lendo FOTO e DOCUMENTO (PDF) do resto da leitura (pedido do Arthur em 2026-11-23).
--
-- Foto e PDF vão ao modelo na mesma chamada do texto, então o custo deles sempre esteve DENTRO de `entrada` ("Texto lido"). Esta migration não muda
-- `entrada` nem nenhum outro número: ela só acrescenta, por dia e por cliente, dois campos que são PARTE de `entrada`:
--   entrada_foto = tokens de entrada das mensagens de tipo 'foto'
--   entrada_pdf  = tokens de entrada das mensagens de tipo 'pdf'
-- O admin passa a mostrar "Foto lida" e "Documento lido" e deixa em "Texto lido" o que sobra (texto e áudio). A soma continua a de antes.
-- Atenção ao que o número quer dizer: é a leitura INTEIRA das mensagens com foto/documento, e isso inclui as instruções de sempre que o modelo lê
-- junto (cerca de 2.100 tokens por mensagem), não só a imagem. Mensagens antigas só têm o total e entram estimadas (94% entrada), como já era.
--
-- Só leitura, mesma assinatura, `create or replace` (o admin antigo continua funcionando: os campos novos são ignorados). Idempotente.

create or replace function public.admin_custo_periodo(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ini timestamptz;
  fim timestamptz;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ultimo date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 366 then
    raise exception 'periodo invalido' using errcode = '22023';
  end if;
  ultimo := least(p_fim, hoje);
  ini := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  fim := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
  return jsonb_build_object(
    'inicio', p_inicio,
    'fim', ultimo,
    'dias', (select coalesce(jsonb_agg(x order by x.dia), '[]') from (
        select d::date dia,
          coalesce(s.entrada, 0) entrada, coalesce(s.saida, 0) saida,
          coalesce(s.audio_tokens, 0) audio_tokens, coalesce(s.audio_seg, 0) audio_seg,
          coalesce(s.entrada_foto, 0) entrada_foto, coalesce(s.entrada_pdf, 0) entrada_pdf,
          coalesce(s.mensagens, 0) mensagens, coalesce(s.clientes, 0) clientes
        from generate_series(p_inicio::timestamp, ultimo::timestamp, interval '1 day') d
        left join (
          select (m.criado_em at time zone 'America/Sao_Paulo')::date dia,
            sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) entrada,
            sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) saida,
            sum(coalesce(m.audio_tokens, 0)) audio_tokens,
            sum(coalesce(m.audio_seg, 0)) audio_seg,
            sum(case when m.tipo = 'foto' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_foto,
            sum(case when m.tipo = 'pdf' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_pdf,
            count(*) mensagens,
            count(distinct m.user_id) clientes
          from public.mensagens m
          where m.criado_em >= ini and m.criado_em < fim
          group by 1) s on s.dia = d::date) x),
    'totais', (select jsonb_build_object(
        'mensagens', count(*),
        'clientes', count(distinct m.user_id),
        'estimadas', count(*) filter (where m.tokens_entrada is null and coalesce(m.tokens, 0) > 0),
        'audios_sem_medida', count(*) filter (where m.tipo = 'audio' and m.audio_tokens is null and m.audio_seg is null))
      from public.mensagens m where m.criado_em >= ini and m.criado_em < fim),
    'por_cliente', (select coalesce(jsonb_agg(x order by x.pesagem desc), '[]') from (
        select m.user_id, p.nome, p.negocio, count(*) mensagens,
          sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) entrada,
          sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) saida,
          sum(coalesce(m.audio_tokens, 0)) audio_tokens,
          sum(coalesce(m.audio_seg, 0)) audio_seg,
          sum(case when m.tipo = 'foto' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_foto,
          sum(case when m.tipo = 'pdf' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_pdf,
          sum(coalesce(m.tokens, 0)) + sum(coalesce(m.audio_tokens, 0)) pesagem
        from public.mensagens m join public.perfis p on p.id = m.user_id
        where m.criado_em >= ini and m.criado_em < fim
        group by m.user_id, p.nome, p.negocio
        order by pesagem desc limit 30) x),
    'meses', (select coalesce(jsonb_agg(to_char(mes, 'YYYY-MM') order by mes desc), '[]') from (
        select distinct date_trunc('month', m.criado_em at time zone 'America/Sao_Paulo') mes from public.mensagens m) q)
  );
end $$;

revoke all on function public.admin_custo_periodo(date, date) from public, anon;
grant execute on function public.admin_custo_periodo(date, date) to authenticated;
