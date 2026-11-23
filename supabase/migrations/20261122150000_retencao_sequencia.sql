-- Sequência de lembretes: até 3 mensagens por pessoa (pedido do Arthur em 2026-11-22: 24 h, 4 dias e 10 dias).
--
-- Etapa 1 é a regra de hoje (config_retencao). As etapas 2 e 3 são NOVAS, moram em config_retencao_etapa e nascem DESLIGADAS: rodar esta
-- migration não muda nada do que é enviado até o Arthur ligar cada etapa na aba Avisos.
--
-- Regras, todas na função SQL retencao_elegiveis (fonte única do servidor e da prévia do admin):
--   - Teto de 3 mensagens por pessoa SOMANDO as duas regras e todas as etapas, para sempre. Sem isso, quem respondesse "ok" ao primeiro
--     lembrete viraria "parou de usar" e a sequência chegaria a 6 mensagens.
--   - No mínimo 48 h entre duas mensagens automáticas à mesma pessoa, de QUALQUER tipo (vencimento e fim do teste também contam).
--   - "Parou de usar" exige pelo menos um lançamento: quem só conversou nunca usou o produto, então não "parou de usar".
--   - Etapa 2 e 3 só saem para quem NÃO reagiu à mensagem anterior (nenhuma mensagem nem lançamento depois dela) e só depois de a
--     anterior ter sido enviada. Responder, mesmo que só "ok", encerra a sequência.
--   - Os atrasos contam desde o gatilho (primeira mensagem, ou a última atividade) e têm que ser crescentes: etapa 1 < etapa 2 < etapa 3.
--
-- Mudanças de assinatura, sem deixar versão antiga para trás (duas versões da mesma função fariam o PostgREST responder "não consegui
-- escolher a função" e, como em dúvida o servidor não envia, os lembretes parariam sem erro nenhum): retencao_elegiveis ganha p_etapa e
-- admin_retencao_previa também. Recria admin_retencao_config, admin_retencao_definir e admin_retencao_acompanhar.
--
-- Depende de 20261121210000_retencao.sql (e do limite). Recria admin_retencao_acompanhar, que 20261122120000_retencao_acompanhar.sql criou: se
-- aquela ainda não foi aplicada, esta a cria, então pode ser pulada. Idempotente.

-- ---------- validação do texto, num lugar só ----------
create or replace function public.retencao_texto_erro(p_texto text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when length(trim(coalesce(p_texto, ''))) < 20 or length(trim(p_texto)) > 600 then 'o texto precisa ter de 20 a 600 letras'
    when p_texto ~ '[—–]' then 'sem travessão no texto'
    when p_texto ~ '[\U0001F000-\U0001FAFF\u2190-\u27BF\uFE0F]' then 'sem emoji no texto'
    when p_texto ~* '(https?://|www\.|\.com\y|\.br\y)' then 'sem link no texto'
    -- A linha do SAIR é acrescentada pelo servidor em toda mensagem: o texto do admin não fala de SAIR.
    when p_texto ~* '\ysair\y' then 'não escreva SAIR no texto: a linha do SAIR entra sozinha'
  end
$$;
revoke all on function public.retencao_texto_erro(text) from public, anon, authenticated;

-- ---------- as etapas 2 e 3 ----------
create table if not exists public.config_retencao_etapa (
  regra text not null check (regra in ('nunca_mandou', 'parou_de_usar')),
  etapa integer not null check (etapa in (2, 3)),
  ativa boolean not null default false,
  atraso_horas integer not null check (atraso_horas between 1 and 720),
  texto text not null check (length(trim(texto)) between 20 and 600),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null,
  primary key (regra, etapa)
);
-- 96 h = 4 dias e 240 h = 10 dias. Nascem desligadas.
insert into public.config_retencao_etapa (regra, etapa, ativa, atraso_horas, texto) values
  ('nunca_mandou', 2, false, 96, 'Oi, {nome}! Tô passando de novo por aqui. Se você recebeu ou pagou alguma coisa e não me contou, me manda que eu anoto, do seu jeito.'),
  ('nunca_mandou', 3, false, 240, 'Oi, {nome}! Essa é a última vez que te chamo por aqui. Quando quiser começar, é só me mandar um gasto ou uma venda, tipo "paguei 80 de material", que eu anoto.'),
  ('parou_de_usar', 2, false, 96, 'Oi, {nome}! Já faz uns dias que não anoto nada seu. Se teve venda ou gasto, me manda por aqui que eu atualizo o seu mês.'),
  ('parou_de_usar', 3, false, 240, 'Oi, {nome}! Essa é a última vez que te chamo por aqui. Quando voltar, é só me mandar o que entrou ou saiu que eu continuo de onde parou.')
on conflict (regra, etapa) do nothing;
alter table public.config_retencao_etapa enable row level security;
revoke all on public.config_retencao_etapa from anon, authenticated;
grant select on public.config_retencao_etapa to service_role;

-- ---------- quem é elegível, agora por etapa ----------
-- Chaves em `avisos`: etapa 1 'ret:<regra>:<usuário>' (a mesma de antes), etapa 2 '...:2', etapa 3 '...:3'.
drop function if exists public.retencao_elegiveis(text, integer, boolean);
create or replace function public.retencao_elegiveis(p_regra text, p_atraso integer, p_ignorar_marco boolean default false, p_etapa integer default 1)
returns table (user_id uuid, nome text, negocio text, whats text, whats_chave text, telefone text, qtd bigint, primeira timestamptz, ultima timestamptz, horas integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  marco timestamptz;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  inicio_mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if p_regra not in ('nunca_mandou', 'parou_de_usar') or p_atraso is null or p_atraso < 1 or p_atraso > 720 or p_etapa is null or p_etapa not in (1, 2, 3) then return; end if;
  select s.numero_desde into marco from public.granninha_saude s where s.id = 1;
  -- Sem marco não dá para saber quem já falou com este número: ninguém é elegível.
  if marco is null then return; end if;
  return query
  with u as (
    select p.id, p.nome, p.negocio, p.whats, p.whats_chave,
           count(m.id) as qtd, min(m.criado_em) as primeira, max(m.criado_em) as ultima_msg,
           count(m.id) filter (where m.criado_em >= marco) as desde_marco,
           (array_agg(m.telefone order by m.criado_em desc))[1] as telefone
      from public.perfis p
      join public.assinaturas a on a.user_id = p.id
      left join public.mensagens m on m.user_id = p.id
     where p.papel = 'cliente' and p.whats_verificado and p.exclusao_em is null and not p.avisos_off
       and (a.status in ('ativa', 'atrasada', 'cortesia') or (a.status = 'trial' and a.trial_fim >= hoje))
     group by p.id, p.nome, p.negocio, p.whats, p.whats_chave
  ), v as (
    select u.*,
           (select count(*) from public.lancamentos l where l.user_id = u.id) as lancs,
           greatest(u.ultima_msg, (select max(l.criado_em) from public.lancamentos l where l.user_id = u.id)) as ultima,
           (select count(*) from public.mensagens mm where mm.user_id = u.id and mm.status = 'ok' and mm.criado_em >= inicio_mes) as uso_mes,
           coalesce((select lc.lancamentos from public.limite_cliente lc where lc.user_id = u.id), (select cl.lancamentos from public.config_limite cl where cl.id), 300) as limite,
           -- Quantas mensagens de retenção a pessoa já recebeu (ou tem reservadas), somando as duas regras e todas as etapas.
           (select count(*) from public.avisos av where av.user_id = u.id and av.tipo in ('retencao_nunca', 'retencao_parou')) as total_ret,
           -- O aviso automático mais recente de QUALQUER tipo (vencimento e fim do teste também), para o intervalo mínimo de 48 h.
           (select max(coalesce(av.enviado_em, av.criado_em)) from public.avisos av where av.user_id = u.id) as ultimo_aviso,
           -- Quando a etapa ANTERIOR foi enviada (etapas 2 e 3).
           (select av.enviado_em from public.avisos av
             where av.status = 'enviado'
               and av.chave = 'ret:' || p_regra || ':' || u.id::text || case p_etapa when 3 then ':2' else '' end) as anterior_em,
           exists (select 1 from public.avisos av where av.chave = 'ret:' || p_regra || ':' || u.id::text || case p_etapa when 1 then '' else ':' || p_etapa::text end) as ja_tem_esta
      from u
  )
  select v.id, v.nome, v.negocio, v.whats, v.whats_chave, v.telefone, v.qtd, v.primeira, v.ultima,
         floor(extract(epoch from (now() - case p_regra when 'nunca_mandou' then v.primeira else v.ultima end)) / 3600)::integer
    from v
   where (p_ignorar_marco or v.desde_marco >= 1)
     and v.uso_mes < v.limite
     and not v.ja_tem_esta
     and v.total_ret < 3
     and (v.ultimo_aviso is null or v.ultimo_aviso <= now() - interval '48 hours')
     and (p_etapa = 1 or (p_etapa in (2, 3) and v.anterior_em is not null and v.ultima <= v.anterior_em))
     and (   (p_regra = 'nunca_mandou' and v.qtd <= 1 and v.lancs = 0 and v.primeira <= now() - make_interval(hours => p_atraso) and v.primeira >= now() - interval '30 days')
          or (p_regra = 'parou_de_usar' and v.qtd >= 2 and v.lancs >= 1 and v.ultima <= now() - make_interval(hours => p_atraso) and v.ultima >= now() - interval '30 days'))
   order by case p_regra when 'nunca_mandou' then v.primeira else v.ultima end asc, v.id;
end $$;
-- Só o servidor (service_role) executa: devolve nome e telefone de clientes.
revoke all on function public.retencao_elegiveis(text, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.retencao_elegiveis(text, integer, boolean, integer) to service_role;

-- ---------- Admin: prévia, agora por etapa ----------
drop function if exists public.admin_retencao_previa(text, integer);
create or replace function public.admin_retencao_previa(p_regra text, p_atraso integer, p_etapa integer default 1) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare total integer; sem_marco integer;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_regra not in ('nunca_mandou', 'parou_de_usar') then raise exception 'regra desconhecida' using errcode = '22023'; end if;
  if p_atraso is null or p_atraso < 1 or p_atraso > 720 then raise exception 'o atraso vai de 1 a 720 horas' using errcode = '22023'; end if;
  if p_etapa is null or p_etapa not in (1, 2, 3) then raise exception 'a etapa vai de 1 a 3' using errcode = '22023'; end if;
  select count(*) into total from public.retencao_elegiveis(p_regra, p_atraso, false, p_etapa);
  select count(*) into sem_marco from public.retencao_elegiveis(p_regra, p_atraso, true, p_etapa);
  return jsonb_build_object(
    'total', total,
    -- Quem seria elegível se não fosse o número novo: escreveu só para o número antigo e, por isso, NÃO recebe.
    'fora_por_numero_antigo', sem_marco - total,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome', e.nome, 'negocio', e.negocio, 'horas', e.horas) order by e.horas desc), '[]'::jsonb)
                from (select * from public.retencao_elegiveis(p_regra, p_atraso, false, p_etapa) limit 30) e));
end $$;
revoke all on function public.admin_retencao_previa(text, integer, integer) from public, anon;
grant execute on function public.admin_retencao_previa(text, integer, integer) to authenticated;

-- ---------- Admin: ler a configuração, com as etapas ----------
create or replace function public.admin_retencao_config() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare inicio timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'regras', (select coalesce(jsonb_agg(jsonb_build_object(
        'regra', c.regra, 'modo', c.modo, 'atraso_horas', c.atraso_horas, 'texto', c.texto, 'atualizado_em', c.atualizado_em,
        'enviados_7d', (select count(*) from public.avisos a where a.status = 'enviado' and a.criado_em >= now() - interval '7 days'
                          and a.tipo = case c.regra when 'nunca_mandou' then 'retencao_nunca' else 'retencao_parou' end),
        'etapas', (select coalesce(jsonb_agg(jsonb_build_object('etapa', e.etapa, 'ativa', e.ativa, 'atraso_horas', e.atraso_horas, 'texto', e.texto, 'atualizado_em', e.atualizado_em) order by e.etapa), '[]'::jsonb)
                     from public.config_retencao_etapa e where e.regra = c.regra))
        order by case c.regra when 'nunca_mandou' then 1 else 2 end), '[]'::jsonb)
       from public.config_retencao c),
    'enviados_hoje', (select count(*) from public.avisos a where a.tipo in ('retencao_nunca', 'retencao_parou') and a.criado_em >= inicio),
    'ultimo_envio', (select max(a.enviado_em) from public.avisos a where a.tipo in ('retencao_nunca', 'retencao_parou')),
    'numero_desde', (select s.numero_desde from public.granninha_saude s where s.id = 1),
    'ciclo_em', (select s.retencao_ciclo_em from public.granninha_saude s where s.id = 1),
    'erro', (select s.retencao_erro from public.granninha_saude s where s.id = 1));
end $$;

-- ---------- Admin: mudar a etapa 1 (a regra) ----------
-- Igual a antes, com a validação do texto no helper e a regra nova: o atraso da etapa 1 tem que ser menor que o da etapa 2.
create or replace function public.admin_retencao_definir(p_regra text, p_modo text, p_atraso integer, p_texto text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare antes public.config_retencao%rowtype; depois public.config_retencao%rowtype; msg text; a2 integer;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo obrigatório' using errcode = '22023'; end if;
  if p_regra not in ('nunca_mandou', 'parou_de_usar') then raise exception 'regra desconhecida' using errcode = '22023'; end if;
  if p_modo not in ('desligado', 'ensaio', 'piloto', 'todos') then raise exception 'modo desconhecido' using errcode = '22023'; end if;
  if p_atraso is null or p_atraso < 1 or p_atraso > 720 then raise exception 'o atraso vai de 1 a 720 horas' using errcode = '22023'; end if;
  msg := public.retencao_texto_erro(p_texto);
  if msg is not null then raise exception '%', msg using errcode = '22023'; end if;
  select e.atraso_horas into a2 from public.config_retencao_etapa e where e.regra = p_regra and e.etapa = 2;
  if a2 is not null and p_atraso >= a2 then raise exception 'o atraso da etapa 1 (% h) precisa ser menor que o da etapa 2 (% h)', p_atraso, a2 using errcode = '22023'; end if;
  select * into antes from public.config_retencao c where c.regra = p_regra;
  if not found then raise exception 'regra desconhecida' using errcode = '22023'; end if;
  update public.config_retencao
     set modo = p_modo, atraso_horas = p_atraso, texto = trim(p_texto), atualizado_em = now(), atualizado_por = (select auth.uid())
   where regra = p_regra
  returning * into depois;
  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
  values ((select auth.uid()), 'retencao_regra', null, jsonb_build_object(
    'motivo', p_motivo, 'regra', p_regra, 'antes', antes.modo, 'depois', depois.modo,
    'atraso_antes', antes.atraso_horas, 'atraso_depois', depois.atraso_horas, 'texto_alterado', antes.texto is distinct from depois.texto));
  return jsonb_build_object('ok', true, 'regra', depois.regra, 'modo', depois.modo, 'atraso_horas', depois.atraso_horas);
end $$;

-- ---------- Admin: mudar a etapa 2 ou 3 ----------
-- Ordem dos atrasos: etapa 1 < etapa 2 < etapa 3, sempre. A etapa 3 só liga com a 2 ligada (a 3 só sai para quem recebeu a 2).
create or replace function public.admin_retencao_etapa_definir(p_regra text, p_etapa integer, p_ativa boolean, p_atraso integer, p_texto text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare antes public.config_retencao_etapa%rowtype; depois public.config_retencao_etapa%rowtype; msg text;
        a1 integer; outro_atraso integer; outra_ativa boolean;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo obrigatório' using errcode = '22023'; end if;
  if p_regra not in ('nunca_mandou', 'parou_de_usar') then raise exception 'regra desconhecida' using errcode = '22023'; end if;
  if p_etapa is null or p_etapa not in (2, 3) then raise exception 'esta função muda a etapa 2 ou a 3' using errcode = '22023'; end if;
  if p_ativa is null then raise exception 'diga se a etapa fica ligada' using errcode = '22023'; end if;
  if p_atraso is null or p_atraso < 1 or p_atraso > 720 then raise exception 'o atraso vai de 1 a 720 horas' using errcode = '22023'; end if;
  msg := public.retencao_texto_erro(p_texto);
  if msg is not null then raise exception '%', msg using errcode = '22023'; end if;
  select * into antes from public.config_retencao_etapa e where e.regra = p_regra and e.etapa = p_etapa;
  if not found then raise exception 'etapa desconhecida' using errcode = '22023'; end if;
  select c.atraso_horas into a1 from public.config_retencao c where c.regra = p_regra;
  if p_etapa = 2 then
    if p_atraso <= a1 then raise exception 'o atraso da etapa 2 precisa ser maior que o da etapa 1 (% h)', a1 using errcode = '22023'; end if;
    select e.atraso_horas, e.ativa into outro_atraso, outra_ativa from public.config_retencao_etapa e where e.regra = p_regra and e.etapa = 3;
    if outro_atraso is not null and p_atraso >= outro_atraso then raise exception 'o atraso da etapa 2 precisa ser menor que o da etapa 3 (% h)', outro_atraso using errcode = '22023'; end if;
    if not p_ativa and coalesce(outra_ativa, false) then raise exception 'desligue a etapa 3 antes de desligar a etapa 2' using errcode = '22023'; end if;
  else
    select e.atraso_horas, e.ativa into outro_atraso, outra_ativa from public.config_retencao_etapa e where e.regra = p_regra and e.etapa = 2;
    if p_atraso <= outro_atraso then raise exception 'o atraso da etapa 3 precisa ser maior que o da etapa 2 (% h)', outro_atraso using errcode = '22023'; end if;
    if p_ativa and not coalesce(outra_ativa, false) then raise exception 'ligue a etapa 2 antes de ligar a etapa 3' using errcode = '22023'; end if;
  end if;
  update public.config_retencao_etapa
     set ativa = p_ativa, atraso_horas = p_atraso, texto = trim(p_texto), atualizado_em = now(), atualizado_por = (select auth.uid())
   where regra = p_regra and etapa = p_etapa
  returning * into depois;
  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
  values ((select auth.uid()), 'retencao_etapa', null, jsonb_build_object(
    'motivo', p_motivo, 'regra', p_regra, 'etapa', p_etapa,
    'antes', case when antes.ativa then 'ligada' else 'desligada' end, 'depois', case when depois.ativa then 'ligada' else 'desligada' end,
    'atraso_antes', antes.atraso_horas, 'atraso_depois', depois.atraso_horas, 'texto_alterado', antes.texto is distinct from depois.texto));
  return jsonb_build_object('ok', true, 'regra', depois.regra, 'etapa', depois.etapa, 'ativa', depois.ativa, 'atraso_horas', depois.atraso_horas);
end $$;

-- ---------- Admin: o acompanhamento, agora por etapa ----------
create or replace function public.admin_retencao_acompanhar(p_dias integer default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare desde timestamptz;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_dias is null or p_dias < 1 or p_dias > 90 then raise exception 'o período vai de 1 a 90 dias' using errcode = '22023'; end if;
  desde := now() - make_interval(days => p_dias);
  return (
    with env as (
      select a.user_id, coalesce(a.enviado_em, a.criado_em) as em,
             case a.tipo when 'retencao_nunca' then 'nunca_mandou' else 'parou_de_usar' end as regra,
             -- a etapa vem do fim da chave: '...:2' e '...:3'; sem sufixo é a etapa 1
             case when a.chave ~ ':2$' then 2 when a.chave ~ ':3$' then 3 else 1 end as etapa
        from public.avisos a
       where a.tipo in ('retencao_nunca', 'retencao_parou') and a.status = 'enviado' and coalesce(a.enviado_em, a.criado_em) >= desde
    ), r as (
      select e.regra, e.etapa, e.user_id, e.em,
             e.em <= now() - interval '24 hours' as medido_24,
             e.em <= now() - interval '48 hours' as medido_48,
             exists (select 1 from public.mensagens m
                      where m.user_id = e.user_id and m.criado_em > e.em and m.criado_em <= e.em + interval '24 hours'
                        and m.texto !~* '^\s*s[aá]ir\s*[.!?]*\s*$') as respondeu,
             exists (select 1 from public.lancamentos l
                      where l.user_id = e.user_id and l.criado_em > e.em and l.criado_em <= e.em + interval '48 hours') as lancou,
             coalesce((select p.avisos_off from public.perfis p where p.id = e.user_id), false) as pediu_sair
        from env e
    )
    select jsonb_build_object(
      'dias', p_dias,
      'por_regra', (select coalesce(jsonb_agg(jsonb_build_object(
                      'regra', g.regra, 'etapa', g.etapa, 'enviados', g.n, 'medidos_24h', g.m24, 'responderam_24h', g.resp,
                      'medidos_48h', g.m48, 'lancaram_48h', g.lanc, 'pediram_sair', g.sair)
                      order by case g.regra when 'nunca_mandou' then 1 else 2 end, g.etapa), '[]'::jsonb)
                      from (select r.regra, r.etapa, count(*) as n,
                                   count(*) filter (where r.medido_24) as m24, count(*) filter (where r.medido_24 and r.respondeu) as resp,
                                   count(*) filter (where r.medido_48) as m48, count(*) filter (where r.medido_48 and r.lancou) as lanc,
                                   count(*) filter (where r.pediu_sair) as sair
                              from r group by r.regra, r.etapa) g),
      'ultimos', (select coalesce(jsonb_agg(jsonb_build_object(
                    'em', x.em, 'regra', x.regra, 'etapa', x.etapa, 'nome', x.nome, 'negocio', x.negocio,
                    -- null = ainda não deu tempo de medir (a tela mostra "aguardando")
                    'respondeu', case when x.medido_24 then x.respondeu else null end,
                    'lancou', case when x.medido_48 then x.lancou else null end,
                    'pediu_sair', x.pediu_sair) order by x.em desc), '[]'::jsonb)
                    from (select r.*, p.nome, p.negocio from r join public.perfis p on p.id = r.user_id order by r.em desc limit 40) x),
      'fila', (select coalesce(jsonb_agg(jsonb_build_object(
                 'regra', f.regra, 'etapa', f.etapa, 'modo', f.modo, 'atraso_horas', f.atraso_horas,
                 'agora', (select coalesce(jsonb_agg(jsonb_build_object('nome', e.nome, 'negocio', e.negocio, 'horas', e.horas) order by e.horas desc), '[]'::jsonb)
                             from (select * from public.retencao_elegiveis(f.regra, f.atraso_horas, false, f.etapa) limit 20) e),
                 -- quem passa do atraso nas próximas 24 h: elegível com 24 h a menos de espera, e ainda não elegível hoje
                 'a_caminho', (select coalesce(jsonb_agg(jsonb_build_object('nome', e.nome, 'negocio', e.negocio, 'faltam_horas', f.atraso_horas - e.horas) order by f.atraso_horas - e.horas), '[]'::jsonb)
                                 from (select x.* from public.retencao_elegiveis(f.regra, greatest(1, f.atraso_horas - 24), false, f.etapa) x
                                        where not exists (select 1 from public.retencao_elegiveis(f.regra, f.atraso_horas, false, f.etapa) y where y.user_id = x.user_id) limit 20) e))
                 order by case f.regra when 'nunca_mandou' then 1 else 2 end, f.etapa), '[]'::jsonb)
                 -- a etapa 1 é a regra; as etapas 2 e 3 só entram na fila quando estão ligadas
                 from (select c.regra, 1 as etapa, c.modo, c.atraso_horas from public.config_retencao c
                       union all
                       select e.regra, e.etapa, c.modo, e.atraso_horas from public.config_retencao_etapa e join public.config_retencao c on c.regra = e.regra where e.ativa) f)
    )
  );
end $$;

-- Só quem está logado chama (e cada função confere eh_admin() lá dentro).
revoke all on function public.admin_retencao_config() from public, anon;
revoke all on function public.admin_retencao_definir(text, text, integer, text, text) from public, anon;
revoke all on function public.admin_retencao_etapa_definir(text, integer, boolean, integer, text, text) from public, anon;
revoke all on function public.admin_retencao_acompanhar(integer) from public, anon;
grant execute on function public.admin_retencao_config() to authenticated;
grant execute on function public.admin_retencao_definir(text, text, integer, text, text) to authenticated;
grant execute on function public.admin_retencao_etapa_definir(text, integer, boolean, integer, text, text) to authenticated;
grant execute on function public.admin_retencao_acompanhar(integer) to authenticated;
