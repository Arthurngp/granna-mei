-- Contatos do cadastro: quem digitou o WhatsApp no cadastro e NÃO confirmou passa a aparecer no admin e pode ser chamado pelo sistema, à mão, um por vez
-- (pedido do Arthur em 2026-11-24: "a gente tem que ter os contatos, mesmo de quem não conectou, para poder reengajar").
--
-- Dois números diferentes, que a tela e o banco nunca misturam:
--   - CONFIRMADO: a pessoa mandou o código de 6 dígitos daquele aparelho. É o número em que ela conversa; o envio usa o telefone da última mensagem.
--   - DIGITADO NO CADASTRO: só foi escrito na primeira tela. Ninguém provou que é dela (pode ter erro de digitação e cair em outra pessoa).
--
-- O que muda:
--   - admin_acoes ganha dois grupos e conserta um buraco:
--       'whats'    = tem telefone, não confirmou, e chegou ao passo do código OU terminou o cadastro. (Antes, quem terminava o cadastro sem confirmar
--                    saía de todos os grupos e sumia da lista.)
--       'cadastro' = tem telefone, não confirmou e parou antes do passo do código.
--       'semfone'  = criou a conta há mais de 1 hora e não deixou telefone. Só aparece (com o e-mail): não há para onde enviar.
--     Cada item traz também verificado, sair (respondeu SAIR), ramo, ocupacao e email. Mesmo formato de antes, com campos a mais.
--   - envio_manual_apto aceita o número DIGITADO, mas só com a autorização própria do admin naquele pedido (p_nao_confirmado) e devolve nao_confirmado = true.
--     Sem autorização continua recusando, como antes. O número sai normalizado com 55; o servidor ainda confere no WhatsApp se ele existe antes de enviar.
--   - admin_envio_pedir aceita os grupos 'whats' e 'cadastro'. Todo envio para número digitado conta no freio do contato frio (10 por dia) e nunca
--     repete para o mesmo número em 24 horas, nem que ele esteja em duas contas.
--
-- O que NÃO se afrouxa, autorizado ou não: quem respondeu SAIR, quem pediu exclusão, número que já está confirmado em OUTRA conta, cadastro sem telefone.
-- O lembrete automático continua sem alcançar essas pessoas: isto é só o envio manual, pedido a pedido, com fila, 5 minutos de espera e janela 9h às 19h.
--
-- Compatível com o servidor e o admin atuais: admin_envio_pedir mantém a assinatura; envio_manual_apto ganha um terceiro parâmetro com padrão falso (a
-- versão antiga é derrubada, para o PostgREST nunca ficar com duas) e uma coluna a mais no retorno. Quem chama do jeito antigo recebe o comportamento antigo. Depende de 20261123160000_envio_manual_contato_frio.sql, de
-- 20261124130000_admin_uso_real.sql e de 20261121160000_perfil_publico.sql (coluna ocupacao). Idempotente: pode rodar de novo sem efeito.

-- ---------- a fila aceita os grupos novos ----------
-- O nome do check não é garantido: acha o que cita "grupo" e troca por um que aceita os dois novos, sem tirar os que já existem.
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.envios_manuais'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%grupo%' loop
    execute format('alter table public.envios_manuais drop constraint %I', c);
  end loop;
  alter table public.envios_manuais add constraint envios_manuais_grupo_check check (grupo in ('nunca', 'sumiu', 'whats', 'cadastro'));
end $$;
-- O pedido foi para um número só digitado no cadastro. O servidor lê isto para conferir o número no WhatsApp antes de enviar.
alter table public.envios_manuais add column if not exists nao_confirmado boolean not null default false;

-- ---------- número digitado -> número para envio ----------
-- "(81) 98765-4321" vira "5581987654321". Devolve null para o que não parece celular ou fixo brasileiro com DDD: em dúvida, não envia.
create or replace function public.whats_para_envio(p_whats text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when length(x.d) in (10, 11) and left(x.d, 1) <> '0' then '55' || x.d
    when length(x.d) in (12, 13) and left(x.d, 2) = '55' then x.d
  end
  from (select regexp_replace(coalesce(p_whats, ''), '\D', '', 'g') as d) x
$$;
revoke all on function public.whats_para_envio(text) from public, anon, authenticated;

-- ---------- esta pessoa pode receber? ----------
-- p_forcar autoriza SÓ o contato frio (como antes). p_nao_confirmado autoriza SÓ o número digitado. Uma autorização nunca vale pela outra: um pedido
-- aprovado para contato frio não sai para número digitado se a pessoa perder a confirmação enquanto espera na fila.
drop function if exists public.envio_manual_apto(uuid, boolean);
drop function if exists public.envio_manual_apto(uuid, boolean, boolean);
create or replace function public.envio_manual_apto(p_user uuid, p_forcar boolean default false, p_nao_confirmado boolean default false)
returns table (telefone text, nome text, recusa text, frio boolean, nao_confirmado boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pf record;
  marco timestamptz;
  tel text;
  desde bigint;
begin
  select p.nome, p.papel, p.whats, p.whats_chave, p.whats_verificado, p.exclusao_em, p.avisos_off into pf from public.perfis p where p.id = p_user;
  if not found or pf.papel is distinct from 'cliente' then
    return query select null::text, null::text, 'cliente não encontrado'::text, false, false; return;
  end if;
  if pf.exclusao_em is not null then
    return query select null::text, pf.nome, 'esta pessoa pediu a exclusão da conta'::text, false, false; return;
  end if;
  if pf.avisos_off then
    return query select null::text, pf.nome, 'esta pessoa respondeu SAIR e não quer receber mensagem'::text, false, false; return;
  end if;

  -- Número só DIGITADO no cadastro. Só sai com a autorização do admin NESTE pedido; o resto das recusas abaixo não tem autorização que valha.
  if not coalesce(pf.whats_verificado, false) then
    tel := public.whats_para_envio(pf.whats);
    if tel is null then
      return query select null::text, pf.nome, 'esta pessoa não deixou um telefone válido no cadastro'::text, false, true; return;
    end if;
    if exists (select 1 from public.perfis o where o.id <> p_user and o.whats_verificado and o.whats_chave = pf.whats_chave) then
      return query select null::text, pf.nome, 'este número já está confirmado em outra conta: fale com a pessoa por lá'::text, false, true; return;
    end if;
    if not coalesce(p_nao_confirmado, false) then
      return query select null::text, pf.nome, 'o WhatsApp desta pessoa não está confirmado: o número foi só digitado no cadastro'::text, true, true; return;
    end if;
    return query select tel, pf.nome, null::text, true, true; return;
  end if;

  select s.numero_desde into marco from public.granninha_saude s where s.id = 1;
  if marco is null then
    return query select null::text, pf.nome, 'não sei desde quando o número atual está no ar'::text, false, false; return;
  end if;
  select count(*) into desde from public.mensagens m where m.user_id = p_user and m.criado_em >= marco;
  -- Contato frio: só passa se o admin autorizou ESTE pedido (p_forcar).
  if desde < 1 and not coalesce(p_forcar, false) then
    return query select null::text, pf.nome, 'esta pessoa nunca escreveu para o número atual: chamar primeiro pode bloquear o número'::text, false, false; return;
  end if;
  select m.telefone into tel from public.mensagens m where m.user_id = p_user order by m.criado_em desc limit 1;
  tel := regexp_replace(coalesce(tel, ''), '\D', '', 'g');
  if length(tel) < 10 then
    return query select null::text, pf.nome, 'sem telefone para responder'::text, false, false; return;
  end if;
  return query select tel, pf.nome, null::text, (desde < 1), false;
end $$;
revoke all on function public.envio_manual_apto(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.envio_manual_apto(uuid, boolean, boolean) to service_role;

-- ---------- Admin: pedir o envio ----------
create or replace function public.admin_envio_pedir(p_user uuid, p_grupo text, p_texto text, p_forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_texto text := trim(coalesce(p_texto, ''));
  v_erro text;
  apto record;
  novo uuid;
  frios_hoje bigint;
  v_chave text;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_grupo is null or p_grupo not in ('nunca', 'sumiu', 'whats', 'cadastro') then
    raise exception 'este grupo não tem envio pelo sistema: use o link do WhatsApp' using errcode = '22023';
  end if;
  v_erro := public.retencao_texto_erro(v_texto);
  if v_erro is not null then raise exception 'texto recusado: %', v_erro using errcode = '22023'; end if;

  -- Número digitado só entra pelos dois grupos de cadastro, e só com a confirmação do admin (p_forcar) naquele pedido.
  select * into apto from public.envio_manual_apto(p_user, coalesce(p_forcar, false), coalesce(p_forcar, false) and p_grupo in ('whats', 'cadastro'));
  if apto.recusa is not null then raise exception '%', apto.recusa using errcode = '22023'; end if;

  if exists (select 1 from public.envios_manuais e where e.user_id = p_user and e.status = 'enviado' and e.enviado_em > now() - interval '24 hours') then
    raise exception 'já mandei uma mensagem para esta pessoa há menos de 24 horas' using errcode = '22023';
  end if;

  -- Número digitado pode estar em duas contas (a pessoa criou outra com outro e-mail): o freio de 24 horas e o de "um pedido ativo" valem por NÚMERO.
  if apto.nao_confirmado then
    v_chave := substr(apto.telefone, 3, 2) || right(apto.telefone, 8);
    if exists (
      select 1 from public.envios_manuais e join public.perfis o on o.id = e.user_id
       where e.user_id <> p_user and o.whats_chave = v_chave
         and (e.status in ('fila', 'enviando') or (e.status = 'enviado' and e.enviado_em > now() - interval '24 hours'))
    ) then
      raise exception 'este mesmo número já recebeu ou está na fila por outra conta nas últimas 24 horas' using errcode = '22023';
    end if;
  end if;

  -- Freio próprio do contato frio (e de todo número só digitado): é o que mais arrisca o número. Conta o que está na fila, enviando ou enviado desde a
  -- meia-noite de São Paulo.
  if apto.frio then
    select count(*) into frios_hoje from public.envios_manuais e
      where e.contato_frio and e.status in ('fila', 'enviando', 'enviado')
        and e.pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
    if frios_hoje >= 10 then
      raise exception 'já há 10 envios para quem nunca escreveu para o número hoje: o resto fica para amanhã' using errcode = '22023';
    end if;
  end if;

  insert into public.envios_manuais (user_id, grupo, texto, pedido_por, contato_frio, nao_confirmado)
    values (p_user, p_grupo, v_texto, (select auth.uid()), coalesce(apto.frio, false), coalesce(apto.nao_confirmado, false))
    on conflict (user_id) where status in ('fila', 'enviando') do nothing
    returning id into novo;

  -- Já havia um pedido ativo para esta pessoa: não é erro, é o mesmo pedido (duplo clique, segunda aba).
  if novo is null then return jsonb_build_object('ok', true, 'ja_na_fila', true); end if;

  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
    values ((select auth.uid()), 'envio_manual_pedido', p_user,
            jsonb_build_object('grupo', p_grupo, 'pedido', novo, 'contato_frio', coalesce(apto.frio, false), 'forcado', coalesce(p_forcar, false),
                               'nao_confirmado', coalesce(apto.nao_confirmado, false)));
  return jsonb_build_object('ok', true, 'ja_na_fila', false, 'id', novo, 'contato_frio', coalesce(apto.frio, false), 'nao_confirmado', coalesce(apto.nao_confirmado, false));
end $$;
revoke all on function public.admin_envio_pedir(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_envio_pedir(uuid, text, text, boolean) to authenticated;

-- ---------- Admin: a lista "Precisa de você hoje", agora com quem ficou pelo caminho no cadastro ----------
create or replace function public.admin_acoes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  agora timestamptz := now();
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (
    with ua as (
      select mu.user_id, max(mu.criado_em) ultima, count(*) qtd from public.mensagens_de_uso() mu group by 1
    ), u as (
      select p.id, p.nome, p.negocio, p.whats, p.whats_verificado, p.onboarding_feito, p.onboarding_passo, p.criado_em,
        coalesce(p.avisos_off, false) sair, p.ramo, p.ocupacao, au.email::text email,
        (public.whats_para_envio(p.whats) is not null) tem_fone,
        a.status, a.trial_fim,
        ua.ultima,
        -- qtd = quantas vezes USOU (sem a confirmação do número, sem SAIR, sem recusa por acesso ou limite)
        coalesce(ua.qtd, 0) qtd
      from public.perfis p
      join auth.users au on au.id = p.id
      left join public.assinaturas a on a.user_id = p.id
      left join ua on ua.user_id = p.id
      where p.papel = 'cliente' and p.exclusao_em is null
    ), g as (
      select u.*,
        case
          when u.status in ('bloqueada', 'atrasada') or (u.status = 'trial' and u.trial_fim < hoje) then 'bloq'
          when u.qtd >= 1 and u.ultima < agora - interval '7 days' then 'sumiu'
          -- carência de 24 h: logo depois de confirmar o número a pessoa ainda está no meio do cadastro, não "nunca usou"
          when u.whats_verificado and u.qtd = 0 and u.criado_em < agora - interval '1 day' then 'nunca'
          -- Daqui para baixo, ninguém confirmou o WhatsApp. O telefone, quando existe, é só o que a pessoa digitou.
          when not u.whats_verificado and u.tem_fone and (u.onboarding_passo >= 6 or u.onboarding_feito) then 'whats'
          when not u.whats_verificado and u.tem_fone then 'cadastro'
          -- carência de 1 h: quem acabou de criar a conta ainda pode estar na primeira tela
          when not u.whats_verificado and not u.tem_fone and u.criado_em < agora - interval '1 hour' then 'semfone'
        end grupo
      from u
    ), l as (
      select g.id user_id, g.nome, g.negocio, g.whats, g.grupo, g.status, g.onboarding_passo passo, g.criado_em, g.ultima,
        case g.grupo when 'bloq' then 1 when 'sumiu' then 2 when 'nunca' then 3 when 'whats' then 4 when 'cadastro' then 5 else 6 end ordem,
        floor(extract(epoch from (agora - case g.grupo when 'sumiu' then g.ultima else g.criado_em end)) / 86400)::int dias,
        g.whats_verificado verificado, g.sair, g.ramo, g.ocupacao, g.email
      from g where g.grupo is not null
      order by 10, 11
      limit 200
    )
    select jsonb_build_object(
      'contagem', (select coalesce(jsonb_object_agg(grupo, n), '{}') from (select grupo, count(*) n from g where grupo is not null group by 1) x),
      'itens', (select coalesce(jsonb_agg(to_jsonb(l) - 'ordem' order by l.ordem, l.dias), '[]') from l)
    )
  );
end $$;
revoke all on function public.admin_acoes() from public, anon;
grant execute on function public.admin_acoes() to authenticated;
