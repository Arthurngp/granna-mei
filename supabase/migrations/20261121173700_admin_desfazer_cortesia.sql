-- Admin: "Desfazer cortesia". A cortesia (parceiro liberado sem pagar) só troca o status da assinatura e guarda na auditoria o
-- estado de ANTES (status e fim do teste). Desfazer lê esse registro e devolve a conta ao que ela era, em vez de adivinhar:
-- chutar "bloqueada" derrubaria um parceiro, chutar "em dia" liberaria de graça quem nunca pagou.
--
--   - Só vale para conta que está em cortesia agora.
--   - Volta ao estado do ÚLTIMO registro de cortesia da conta cujo "antes" era um estado real (trial, ativa, atrasada ou bloqueada).
--     Se a cortesia foi aplicada duas vezes, o "antes" da segunda é "cortesia" e é ignorado: volta ao que era antes da primeira.
--   - Sem registro (cortesia gravada por fora da auditoria), RECUSA e pede para escolher outra ação. Nada é alterado.
--   - Motivo obrigatório, como em toda ação que muda acesso. Fica na auditoria (antes = cortesia, depois = o estado restaurado).
--
-- Substitui a função admin_acao inteira (create or replace). TODAS as ações que já existiam seguem exatamente como eram; o que muda
-- é só o ramo novo, o "desfazer_cortesia" na lista de ações que exigem motivo, e o retorno, que agora também traz o fim do teste
-- (a tela usa para avisar quando a conta volta com o teste já vencido). Idempotente.

create or replace function public.admin_acao(p_user uuid, p_acao text, p_motivo text default '', p_dias integer default 0) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare antes jsonb; depois jsonb; previo jsonb;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_acao in ('cortesia', 'liberar', 'bloquear', 'estender_teste', 'voltar_teste', 'desfazer_cortesia') and length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'motivo obrigatório' using errcode = '22023';
  end if;
  select to_jsonb(a) into antes from public.assinaturas a where a.user_id = p_user;
  if antes is null and p_acao not in ('verificar_numero', 'desverificar_numero') then raise exception 'cliente sem assinatura' using errcode = '22023'; end if;

  if p_acao = 'estender_teste' then
    if p_dias < 1 or p_dias > 90 then raise exception 'dias entre 1 e 90' using errcode = '22023'; end if;
    update public.assinaturas set status = 'trial', trial_fim = greatest(trial_fim, current_date) + p_dias, prox_cobranca = greatest(trial_fim, current_date) + p_dias, motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'cortesia' then
    update public.assinaturas set status = 'cortesia', motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'desfazer_cortesia' then
    if antes ->> 'status' is distinct from 'cortesia' then
      raise exception 'a conta não está em cortesia' using errcode = '22023';
    end if;
    select au.detalhes into previo
      from public.admin_auditoria au
     where au.alvo_user_id = p_user and au.acao = 'cortesia'
       and au.detalhes ->> 'depois' = 'cortesia'
       and au.detalhes ->> 'antes' in ('trial', 'ativa', 'atrasada', 'bloqueada')
     order by au.criado_em desc, au.id desc
     limit 1;
    if previo is null then
      raise exception 'não sei como a conta estava antes da cortesia (sem registro). Use "Estender o teste grátis", "Liberar como em dia" ou "Bloquear acesso".' using errcode = '22023';
    end if;
    update public.assinaturas set
      status = previo ->> 'antes',
      trial_fim = case when previo ->> 'antes' = 'trial' and previo ->> 'trial_fim_antes' is not null then (previo ->> 'trial_fim_antes')::date else trial_fim end,
      motivo = p_motivo, atualizado_em = now()
    where user_id = p_user;
  elsif p_acao = 'liberar' then
    update public.assinaturas set status = 'ativa', motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'bloquear' then
    update public.assinaturas set status = 'bloqueada', motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'voltar_teste' then
    update public.assinaturas set status = 'trial', trial_fim = current_date + greatest(p_dias, 1), motivo = p_motivo, atualizado_em = now() where user_id = p_user;
  elsif p_acao = 'verificar_numero' then
    update public.perfis set whats_verificado = true where id = p_user;
  elsif p_acao = 'desverificar_numero' then
    update public.perfis set whats_verificado = false where id = p_user;
  else
    raise exception 'ação desconhecida' using errcode = '22023';
  end if;

  select to_jsonb(a) into depois from public.assinaturas a where a.user_id = p_user;
  insert into public.admin_auditoria (admin_id, acao, alvo_user_id, detalhes)
  values ((select auth.uid()), p_acao, p_user, jsonb_build_object('motivo', p_motivo, 'dias', p_dias,
    'antes', antes ->> 'status', 'depois', depois ->> 'status', 'trial_fim_antes', antes ->> 'trial_fim', 'trial_fim_depois', depois ->> 'trial_fim'));
  return jsonb_build_object('ok', true, 'situacao', depois ->> 'status', 'trial_fim', depois ->> 'trial_fim');
end $$;

-- Mesmas permissões de sempre: só quem está logado chama, e a função confere eh_admin() lá dentro.
revoke all on function public.admin_acao(uuid, text, text, integer) from public, anon;
grant execute on function public.admin_acao(uuid, text, text, integer) to authenticated;
