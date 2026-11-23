-- Envio manual de mensagem pelo admin: o botão do admin vira "enviar", com fila e espera de 5 minutos (pedido do Arthur em 2026-11-23).
--
-- O botão NÃO fala com o WhatsApp. Ele grava um pedido numa fila (esta migration), e quem envia é o servidor, no mesmo ciclo dos lembretes, com as
-- mesmas proteções do número (janela das 9h às 19h, WhatsApp conectado, um envio por ciclo, espera medida NO BANCO, SAIR no fim). Assim o intervalo
-- vale mesmo com a aba fechada, e dois cliques em menos de 5 minutos viram uma fila que se esvazia sozinha.
--
-- Regras que moram aqui, uma vez só:
--   - Só o admin pede (eh_admin()), só para papel cliente, só nos grupos "nunca usaram" e "sumiram". Quem parou no passo do WhatsApp nunca escreveu
--     para o número (contato frio é o que derruba número não oficial) e quem está sem acesso pede conversa de gente, então os dois seguem pelo link.
--   - Só para quem JÁ ESCREVEU para o número atual, para o telefone em que escreveu por último (a mesma regra de retencao_elegiveis), e nunca para quem
--     respondeu SAIR (avisos_off), pediu a exclusão da conta ou não confirmou o WhatsApp.
--   - O texto passa por retencao_texto_erro (sem link, sem emoji, sem travessão, sem a palavra SAIR). A linha do SAIR é acrescentada pelo servidor.
--   - Uma pessoa só pode ter UM pedido ativo (índice único parcial): duplo clique ou duas abas viram o mesmo pedido, nunca duas mensagens.
--   - Depois de uma mensagem manual enviada, a mesma pessoa só recebe outra pedida à mão depois de 24 horas.
--   - Cancelar só vale enquanto está na fila. Cada pedido e cada cancelamento entram na auditoria.
--
-- Cada envio manual também é gravado em `avisos` (tipo novo 'retencao_manual'), então os lembretes automáticos enxergam: a espera de 3 minutos entre
-- envios e o intervalo de 48 horas por pessoa passam a contar a mensagem manual. O teto de 3 mensagens por pessoa (total_ret) continua contando só as
-- automáticas, de propósito: mexer nele exigiria recriar retencao_elegiveis inteira, e as 48 horas já seguram a rajada.
--
-- Nada muda do que é enviado hoje: sem pedido na fila, o servidor não faz nada. Depende de 20261121210000_retencao.sql e de
-- 20261122150000_retencao_sequencia.sql (retencao_texto_erro). Idempotente: pode rodar de novo sem efeito.

-- ---------- avisos: tipo novo ----------
-- O nome do check não é garantido: acha o que cita "vencimento" e troca por um que aceita o tipo novo, sem tirar nenhum dos que já existem.
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.avisos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%tipo%vencimento%' loop
    execute format('alter table public.avisos drop constraint %I', c);
  end loop;
  alter table public.avisos add constraint avisos_tipo_check check (tipo in ('vencimento', 'retencao_nunca', 'retencao_parou', 'retencao_manual'));
end $$;

-- ---------- a fila ----------
create table if not exists public.envios_manuais (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  grupo text not null check (grupo in ('nunca', 'sumiu')),
  texto text not null check (length(trim(texto)) between 20 and 600),
  status text not null default 'fila' check (status in ('fila', 'enviando', 'enviado', 'falhou', 'cancelado')),
  pedido_em timestamptz not null default now(),
  pedido_por uuid references auth.users (id) on delete set null,
  iniciado_em timestamptz,
  enviado_em timestamptz,
  erro text
);
-- Um pedido ativo por pessoa.
create unique index if not exists envios_manuais_um_ativo on public.envios_manuais (user_id) where status in ('fila', 'enviando');
create index if not exists envios_manuais_recentes on public.envios_manuais (pedido_em desc);

alter table public.envios_manuais enable row level security;
revoke all on public.envios_manuais from anon, authenticated;
grant select, update on public.envios_manuais to service_role;

-- ---------- janela de envio (9h às 19h, São Paulo) ----------
-- Devolve o próprio instante se estiver dentro da janela; senão, o próximo 9h. Só serve para o admin mostrar "sai às 9h".
create or replace function public.envio_manual_na_janela(t timestamptz) returns timestamptz
language plpgsql stable set search_path = ''
as $$
declare
  h time := (t at time zone 'America/Sao_Paulo')::time;
  d date := (t at time zone 'America/Sao_Paulo')::date;
begin
  if h < time '09:00' then return (d + time '09:00') at time zone 'America/Sao_Paulo'; end if;
  if h >= time '19:00' then return ((d + 1) + time '09:00') at time zone 'America/Sao_Paulo'; end if;
  return t;
end $$;
revoke all on function public.envio_manual_na_janela(timestamptz) from public, anon, authenticated;

-- ---------- esta pessoa pode receber? ----------
-- Uma só definição, usada no pedido (para recusar com o motivo na hora) e pelo servidor (que confere DE NOVO no instante de enviar, porque a
-- pessoa pode ter respondido SAIR enquanto esperava na fila). Devolve o telefone em que ela escreveu por último, ou o motivo da recusa.
create or replace function public.envio_manual_apto(p_user uuid) returns table (telefone text, nome text, recusa text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pf record;
  marco timestamptz;
  tel text;
  desde bigint;
begin
  select p.nome, p.papel, p.whats_verificado, p.exclusao_em, p.avisos_off into pf from public.perfis p where p.id = p_user;
  if not found or pf.papel is distinct from 'cliente' then
    return query select null::text, null::text, 'cliente não encontrado'::text; return;
  end if;
  if pf.exclusao_em is not null then
    return query select null::text, pf.nome, 'esta pessoa pediu a exclusão da conta'::text; return;
  end if;
  if pf.avisos_off then
    return query select null::text, pf.nome, 'esta pessoa respondeu SAIR e não quer receber mensagem'::text; return;
  end if;
  if not coalesce(pf.whats_verificado, false) then
    return query select null::text, pf.nome, 'o WhatsApp desta pessoa não está confirmado'::text; return;
  end if;
  select s.numero_desde into marco from public.granninha_saude s where s.id = 1;
  if marco is null then
    return query select null::text, pf.nome, 'não sei desde quando o número atual está no ar'::text; return;
  end if;
  select count(*) into desde from public.mensagens m where m.user_id = p_user and m.criado_em >= marco;
  if desde < 1 then
    return query select null::text, pf.nome, 'esta pessoa nunca escreveu para o número atual: chamar primeiro pode bloquear o número'::text; return;
  end if;
  select m.telefone into tel from public.mensagens m where m.user_id = p_user order by m.criado_em desc limit 1;
  tel := regexp_replace(coalesce(tel, ''), '\D', '', 'g');
  if length(tel) < 10 then
    return query select null::text, pf.nome, 'sem telefone para responder'::text; return;
  end if;
  return query select tel, pf.nome, null::text;
end $$;
revoke all on function public.envio_manual_apto(uuid) from public, anon, authenticated;
grant execute on function public.envio_manual_apto(uuid) to service_role;

-- ---------- Admin: pedir o envio ----------
create or replace function public.admin_envio_pedir(p_user uuid, p_grupo text, p_texto text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_texto text := trim(coalesce(p_texto, ''));
  v_erro text;
  apto record;
  novo uuid;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_grupo is null or p_grupo not in ('nunca', 'sumiu') then
    raise exception 'este grupo não tem envio pelo sistema: use o link do WhatsApp' using errcode = '22023';
  end if;
  v_erro := public.retencao_texto_erro(v_texto);
  if v_erro is not null then raise exception 'texto recusado: %', v_erro using errcode = '22023'; end if;

  select * into apto from public.envio_manual_apto(p_user);
  if apto.recusa is not null then raise exception '%', apto.recusa using errcode = '22023'; end if;

  if exists (select 1 from public.envios_manuais e where e.user_id = p_user and e.status = 'enviado' and e.enviado_em > now() - interval '24 hours') then
    raise exception 'já mandei uma mensagem para esta pessoa há menos de 24 horas' using errcode = '22023';
  end if;

  insert into public.envios_manuais (user_id, grupo, texto, pedido_por)
    values (p_user, p_grupo, v_texto, (select auth.uid()))
    on conflict (user_id) where status in ('fila', 'enviando') do nothing
    returning id into novo;

  -- Já havia um pedido ativo para esta pessoa: não é erro, é o mesmo pedido (duplo clique, segunda aba).
  if novo is null then return jsonb_build_object('ok', true, 'ja_na_fila', true); end if;

  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
    values ((select auth.uid()), 'envio_manual_pedido', p_user, jsonb_build_object('grupo', p_grupo, 'pedido', novo));
  return jsonb_build_object('ok', true, 'ja_na_fila', false, 'id', novo);
end $$;

-- ---------- Admin: cancelar enquanto está na fila ----------
create or replace function public.admin_envio_cancelar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_user uuid;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  update public.envios_manuais set status = 'cancelado' where id = p_id and status = 'fila' returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false, 'motivo', 'já saiu ou já foi cancelado'); end if;
  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
    values ((select auth.uid()), 'envio_manual_cancelado', v_user, jsonb_build_object('pedido', p_id));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Admin: a fila e quando cada um sai ----------
-- O horário previsto é calculado AQUI (e o admin só conta o tempo que falta), para a tela não depender do relógio do navegador. É uma previsão:
-- o servidor confere a cada minuto, então pode sair até 1 minuto depois, e uma mensagem automática no meio empurra a fila.
create or replace function public.admin_envios_fila() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  agora timestamptz := now();
  ultimo timestamptz;
  prox timestamptz;
  itens jsonb := '[]'::jsonb;
  r record;
  k integer := 0;
  wa_ok boolean;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  select max(greatest(av.criado_em, coalesce(av.enviado_em, av.criado_em))) into ultimo from public.avisos av;
  wa_ok := exists (select 1 from public.granninha_saude s where s.id = 1 and s.whatsapp_estado = 'CONNECTED' and s.atualizado_em > agora - interval '3 minutes');
  prox := greatest(agora, coalesce(ultimo, agora - interval '1 day') + interval '5 minutes');
  for r in select e.id, e.user_id, e.status, e.pedido_em from public.envios_manuais e where e.status in ('fila', 'enviando') order by e.pedido_em, e.id loop
    k := k + 1;
    prox := public.envio_manual_na_janela(prox);
    itens := itens || jsonb_build_object('id', r.id, 'user_id', r.user_id, 'status', r.status, 'pedido_em', r.pedido_em, 'posicao', k, 'previsto_em', prox);
    prox := prox + interval '5 minutes';
  end loop;
  return jsonb_build_object(
    'agora', agora,
    'espera_min', 5,
    'ultimo_envio_em', ultimo,
    'whatsapp_ok', wa_ok,
    'itens', itens,
    'recentes', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'status', x.status, 'enviado_em', x.enviado_em, 'erro', x.erro) order by x.quando desc)
        from (select e.*, coalesce(e.enviado_em, e.pedido_em) as quando from public.envios_manuais e
               where e.status in ('enviado', 'falhou') and coalesce(e.enviado_em, e.pedido_em) > agora - interval '24 hours'
               order by coalesce(e.enviado_em, e.pedido_em) desc limit 60) x), '[]'::jsonb));
end $$;

-- Só quem está logado chama (e cada função confere eh_admin() lá dentro).
revoke all on function public.admin_envio_pedir(uuid, text, text) from public, anon;
revoke all on function public.admin_envio_cancelar(uuid) from public, anon;
revoke all on function public.admin_envios_fila() from public, anon;
grant execute on function public.admin_envio_pedir(uuid, text, text) to authenticated;
grant execute on function public.admin_envio_cancelar(uuid) to authenticated;
grant execute on function public.admin_envios_fila() to authenticated;
