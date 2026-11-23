-- Envio manual: o admin pode autorizar, de propósito, o envio para quem nunca escreveu para o número atual (decisão do Arthur em 2026-11-23).
--
-- Até aqui o envio pelo sistema recusava essa pessoa (contato frio é o que derruba número não oficial). O risco continua o mesmo: a mudança é que a decisão
-- passa a ser do admin, MANUAL, uma pessoa por vez, na confirmação "Enviar mesmo assim". O automático (lembretes de retenção) segue pulando essas pessoas.
--
-- O que NÃO se afrouxa: quem respondeu SAIR, pediu exclusão, não confirmou o WhatsApp, está sem telefone ou sem marco do número continua recusado, mesmo
-- autorizado. Isso não é risco de bloqueio, é a pessoa não querer receber. O envio continua passando pela fila: espera de 5 minutos, janela 9h às 19h,
-- WhatsApp conectado, SAIR no fim, uma mensagem manual por pessoa a cada 24 h.
--
-- Mudanças:
--   - envios_manuais.contato_frio: o pedido foi autorizado para alguém que nunca escreveu para o número atual. O servidor lê isso e confere de novo na
--     hora de enviar com a mesma autorização (senão recusaria o que o admin aprovou). Uma autorização vale só para aquele pedido.
--   - admin_envio_pedir ganha p_forcar (padrão falso): sem ele o comportamento é o de antes. Com ele, só o contato frio é liberado.
--   - envio_manual_apto ganha p_forcar e devolve também `frio`.
--   - admin_envios_fila devolve também `frios` (quem é contato frio), para a tela abrir já com o texto certo: a quem nunca escreveu para o número atual se pede
--     para salvar o número novo e começar a lançar, não o lançamento. Mesmo formato de antes, com um campo a mais.
--   - Teto de 10 pedidos por dia só para contato frio: é o que mais arrisca o número, então tem um freio próprio, menor que o teto geral de 15.
--   - Cada pedido de contato frio entra na auditoria com contato_frio e forcado.
--
-- As funções antigas são trocadas (drop das assinaturas antigas), para o PostgREST nunca ficar com duas versões e responder "não consegui escolher a
-- função". Compatível com o servidor e o admin atuais: sem p_forcar eles continuam funcionando como antes. Depende de 20261123120000_envio_manual.sql.
-- Idempotente: pode rodar de novo sem efeito.

alter table public.envios_manuais add column if not exists contato_frio boolean not null default false;

-- ---------- esta pessoa pode receber? ----------
drop function if exists public.envio_manual_apto(uuid);
create or replace function public.envio_manual_apto(p_user uuid, p_forcar boolean default false) returns table (telefone text, nome text, recusa text, frio boolean)
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
    return query select null::text, null::text, 'cliente não encontrado'::text, false; return;
  end if;
  if pf.exclusao_em is not null then
    return query select null::text, pf.nome, 'esta pessoa pediu a exclusão da conta'::text, false; return;
  end if;
  if pf.avisos_off then
    return query select null::text, pf.nome, 'esta pessoa respondeu SAIR e não quer receber mensagem'::text, false; return;
  end if;
  if not coalesce(pf.whats_verificado, false) then
    return query select null::text, pf.nome, 'o WhatsApp desta pessoa não está confirmado'::text, false; return;
  end if;
  select s.numero_desde into marco from public.granninha_saude s where s.id = 1;
  if marco is null then
    return query select null::text, pf.nome, 'não sei desde quando o número atual está no ar'::text, false; return;
  end if;
  select count(*) into desde from public.mensagens m where m.user_id = p_user and m.criado_em >= marco;
  -- Contato frio: só passa se o admin autorizou ESTE pedido (p_forcar). O resto das recusas acima e abaixo não tem autorização que valha.
  if desde < 1 and not coalesce(p_forcar, false) then
    return query select null::text, pf.nome, 'esta pessoa nunca escreveu para o número atual: chamar primeiro pode bloquear o número'::text, false; return;
  end if;
  select m.telefone into tel from public.mensagens m where m.user_id = p_user order by m.criado_em desc limit 1;
  tel := regexp_replace(coalesce(tel, ''), '\D', '', 'g');
  if length(tel) < 10 then
    return query select null::text, pf.nome, 'sem telefone para responder'::text, false; return;
  end if;
  return query select tel, pf.nome, null::text, (desde < 1);
end $$;
revoke all on function public.envio_manual_apto(uuid, boolean) from public, anon, authenticated;
grant execute on function public.envio_manual_apto(uuid, boolean) to service_role;

-- ---------- Admin: pedir o envio ----------
drop function if exists public.admin_envio_pedir(uuid, text, text);
create or replace function public.admin_envio_pedir(p_user uuid, p_grupo text, p_texto text, p_forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_texto text := trim(coalesce(p_texto, ''));
  v_erro text;
  apto record;
  novo uuid;
  frios_hoje bigint;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_grupo is null or p_grupo not in ('nunca', 'sumiu') then
    raise exception 'este grupo não tem envio pelo sistema: use o link do WhatsApp' using errcode = '22023';
  end if;
  v_erro := public.retencao_texto_erro(v_texto);
  if v_erro is not null then raise exception 'texto recusado: %', v_erro using errcode = '22023'; end if;

  select * into apto from public.envio_manual_apto(p_user, coalesce(p_forcar, false));
  if apto.recusa is not null then raise exception '%', apto.recusa using errcode = '22023'; end if;

  if exists (select 1 from public.envios_manuais e where e.user_id = p_user and e.status = 'enviado' and e.enviado_em > now() - interval '24 hours') then
    raise exception 'já mandei uma mensagem para esta pessoa há menos de 24 horas' using errcode = '22023';
  end if;

  -- Freio próprio do contato frio: é o que mais arrisca o número. Conta o que está na fila, enviando ou enviado desde a meia-noite de São Paulo.
  if apto.frio then
    select count(*) into frios_hoje from public.envios_manuais e
      where e.contato_frio and e.status in ('fila', 'enviando', 'enviado')
        and e.pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
    if frios_hoje >= 10 then
      raise exception 'já há 10 envios para quem nunca escreveu para o número hoje: o resto fica para amanhã' using errcode = '22023';
    end if;
  end if;

  insert into public.envios_manuais (user_id, grupo, texto, pedido_por, contato_frio)
    values (p_user, p_grupo, v_texto, (select auth.uid()), coalesce(apto.frio, false))
    on conflict (user_id) where status in ('fila', 'enviando') do nothing
    returning id into novo;

  -- Já havia um pedido ativo para esta pessoa: não é erro, é o mesmo pedido (duplo clique, segunda aba).
  if novo is null then return jsonb_build_object('ok', true, 'ja_na_fila', true); end if;

  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
    values ((select auth.uid()), 'envio_manual_pedido', p_user,
            jsonb_build_object('grupo', p_grupo, 'pedido', novo, 'contato_frio', coalesce(apto.frio, false), 'forcado', coalesce(p_forcar, false)));
  return jsonb_build_object('ok', true, 'ja_na_fila', false, 'id', novo, 'contato_frio', coalesce(apto.frio, false));
end $$;

revoke all on function public.admin_envio_pedir(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_envio_pedir(uuid, text, text, boolean) to authenticated;

-- ---------- Admin: a fila, agora dizendo quem é contato frio ----------
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
    -- Quem é "contato frio": cliente com WhatsApp confirmado, que não pediu SAIR nem exclusão e NÃO escreveu para o número atual. A tela usa isto para abrir já com o texto
    -- certo (pedir para salvar o número novo e começar a lançar), em vez de pedir lançamento a quem nunca falou com o número. É a mesma definição de envio_manual_apto.
    'frios', coalesce((
      select jsonb_agg(p.id) from public.perfis p
       where p.papel = 'cliente' and coalesce(p.whats_verificado, false) and not coalesce(p.avisos_off, false) and p.exclusao_em is null
         and exists (select 1 from public.granninha_saude s where s.id = 1 and s.numero_desde is not null)
         and exists (select 1 from public.mensagens m0 where m0.user_id = p.id)
         and not exists (select 1 from public.mensagens m, public.granninha_saude s2 where s2.id = 1 and m.user_id = p.id and m.criado_em >= s2.numero_desde)), '[]'::jsonb),
    'recentes', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'status', x.status, 'enviado_em', x.enviado_em, 'erro', x.erro) order by x.quando desc)
        from (select e.*, coalesce(e.enviado_em, e.pedido_em) as quando from public.envios_manuais e
               where e.status in ('enviado', 'falhou') and coalesce(e.enviado_em, e.pedido_em) > agora - interval '24 hours'
               order by coalesce(e.enviado_em, e.pedido_em) desc limit 60) x), '[]'::jsonb));
end $$;
revoke all on function public.admin_envios_fila() from public, anon;
grant execute on function public.admin_envios_fila() to authenticated;
