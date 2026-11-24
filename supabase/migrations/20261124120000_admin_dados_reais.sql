-- Admin: os números passam a refletir a realidade (revisão de 24/11/2026, pedido do Arthur: "não queremos dados errados").
-- Só refaz funções de LEITURA com `create or replace` (mesma assinatura, mesmas permissões): nenhum dado é lido nem alterado, nenhuma tabela muda.
-- Compatível com o admin atual: nenhuma coluna ou chave some; só mudam os valores, que passam a ser os verdadeiros.
--
-- O que estava errado (confirmado em produção em 24/11: 10 perfis, 9 clientes e a única conta "bloqueada" era a do próprio admin):
--  1. Totais contavam a conta do admin e as contas com exclusão pedida como se fossem clientes ("Clientes" mostrava 10 para 9; "Sem acesso" mostrava
--     1 e era o admin; "Em teste" e "Carteira" idem).
--  2. "Teste vencido" usava `current_date` (dia UTC): das 21h às 24h em São Paulo o admin já mostrava "Teste vencido" para quem ainda usa o produto.
--  3. "Mensagens no mês", tokens e mídias do mês viravam o mês às 21h de São Paulo (mês UTC).
--  4. "Mensagens hoje" e "Última mensagem" contavam mensagens de número desconhecido e de figurinha como se fossem de clientes.
--  5. "Erros em 24 h" não contava resposta que o gateway não conseguiu entregar, e "Últimos erros" mostrava erros de qualquer data sob o rótulo de 24 h.
--  6. "Cadastros por campanha" cortava 50 campanhas ANTES de ordenar (podia sumir a maior) e tratava "Black" e "black" como duas campanhas.
-- Idempotente: pode rodar de novo.

-- ---------- Clientes (lista) ----------
create or replace function public.admin_clientes(p_busca text default '', p_situacao text default '')
returns table (
  id uuid, nome text, email text, negocio text, whats text, verificado boolean, situacao text, plano text, trial_fim date,
  motivo text, criado_em timestamptz, ultimo_lancamento date, lancamentos bigint, mensagens_mes bigint, onboarding_passo smallint, onboarding_feito boolean, papel text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  mes_sp timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return query
  select p.id, p.nome, u.email::text, p.negocio, p.whats, p.whats_verificado,
    case when a.status = 'trial' and a.trial_fim < hoje then 'teste_vencido' else a.status end,
    a.plano, a.trial_fim, a.motivo, p.criado_em,
    (select max(l.data) from public.lancamentos l where l.user_id = p.id),
    (select count(*) from public.lancamentos l where l.user_id = p.id),
    -- Mensagens ATENDIDAS no mês (mês de São Paulo): é a mesma conta do "uso do limite" da ficha, para a lista e a ficha não discordarem.
    (select count(*) from public.mensagens m where m.user_id = p.id and m.status = 'ok' and m.criado_em >= mes_sp),
    p.onboarding_passo, p.onboarding_feito, p.papel
  from public.perfis p
  join auth.users u on u.id = p.id
  left join public.assinaturas a on a.user_id = p.id
  where p.papel = 'cliente'
    and (coalesce(p_busca, '') = ''
         or p.nome ilike '%' || p_busca || '%' or p.negocio ilike '%' || p_busca || '%' or u.email ilike '%' || p_busca || '%'
         or regexp_replace(p.whats, '\D', '', 'g') like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%' and regexp_replace(p_busca, '\D', '', 'g') <> '')
    and (coalesce(p_situacao, '') = ''
         or (p_situacao = 'teste_vencido' and a.status = 'trial' and a.trial_fim < hoje)
         or (p_situacao = 'trial' and a.status = 'trial' and a.trial_fim >= hoje)
         or (p_situacao not in ('trial', 'teste_vencido') and a.status = p_situacao))
  order by p.criado_em desc
  limit 500;
end $$;

-- ---------- Painel do admin (cabeçalho e Granninha) ----------
create or replace function public.admin_painel() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  dia_sp timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  mes_sp timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    -- Só clientes de verdade: sem a conta do admin e sem quem já pediu exclusão.
    'clientes', (select count(*) from public.perfis where papel = 'cliente' and exclusao_em is null),
    'por_situacao', (select coalesce(jsonb_object_agg(s, n), '{}') from (
        select case when a.status = 'trial' and a.trial_fim < hoje then 'teste_vencido' else a.status end s, count(*) n
        from public.assinaturas a join public.perfis p on p.id = a.user_id
        where p.papel = 'cliente' and p.exclusao_em is null group by 1) x),
    'novos_7d', (select count(*) from public.perfis where papel = 'cliente' and exclusao_em is null and criado_em >= now() - interval '7 days'),
    'numeros_confirmados', (select count(*) from public.perfis where papel = 'cliente' and exclusao_em is null and whats_verificado),
    'onboarding', (select coalesce(jsonb_object_agg(passo, n), '{}') from (
        select onboarding_passo passo, count(*) n from public.perfis where papel = 'cliente' and exclusao_em is null group by 1) x),
    -- De clientes conhecidos: número desconhecido não é cliente (a Granninha fica em silêncio com ele de propósito).
    'mensagens_hoje', (select count(*) from public.mensagens where user_id is not null and criado_em >= dia_sp),
    'respondidas_hoje', (select count(*) from public.mensagens where user_id is not null and resposta is not null and resposta <> '' and criado_em >= dia_sp),
    -- Erro é falha ao processar OU resposta que o gateway não conseguiu entregar (essa fica com status ok e o motivo no campo erro).
    'erros_24h', (select count(*) from public.mensagens where (status = 'erro' or erro like 'resposta não entregue%') and criado_em >= now() - interval '24 hours'),
    'ultimos_erros', (select coalesce(jsonb_agg(x order by x.criado_em desc), '[]') from (
        select criado_em, tipo, left(erro, 160) erro from public.mensagens
        where (status = 'erro' or erro like 'resposta não entregue%') and criado_em >= now() - interval '24 hours'
        order by criado_em desc limit 5) x),
    'ultima_mensagem', (select max(criado_em) from public.mensagens where user_id is not null),
    'tokens_hoje', (select coalesce(sum(tokens), 0) from public.mensagens where criado_em >= dia_sp),
    'tokens_mes', (select coalesce(sum(tokens), 0) from public.mensagens where criado_em >= mes_sp),
    'midias_mes', (select count(*) from public.mensagens where tipo in ('audio', 'foto', 'pdf') and criado_em >= mes_sp),
    'mensagens_por_dia', (select coalesce(jsonb_agg(x order by x.dia), '[]') from (
        select (criado_em at time zone 'America/Sao_Paulo')::date dia, count(*) n, coalesce(sum(tokens), 0) tokens
        from public.mensagens where criado_em >= now() - interval '30 days' group by 1) x),
    'maiores_consumidores', (select coalesce(jsonb_agg(x), '[]') from (
        select p.nome, p.negocio, count(*) mensagens, coalesce(sum(m.tokens), 0) tokens
        from public.mensagens m join public.perfis p on p.id = m.user_id
        where m.criado_em >= mes_sp group by p.id, p.nome, p.negocio order by 4 desc limit 5) x),
    'saude', (select to_jsonb(s) from public.granninha_saude s where s.id = 1)
  );
end $$;

-- ---------- Receita ----------
create or replace function public.admin_receita() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'faturas_pagas', (select jsonb_build_object('qtd', count(*), 'total', coalesce(sum(f.valor), 0)) from public.faturas f where f.status = 'paga'),
    'faturas_abertas', (select jsonb_build_object('qtd', count(*), 'total', coalesce(sum(f.valor), 0)) from public.faturas f where f.status = 'aberta'),
    'por_mes', (select coalesce(jsonb_agg(x order by x.mes desc), '[]') from (
        select to_char(date_trunc('month', f.data), 'YYYY-MM') mes, count(*) qtd, sum(f.valor) total
        from public.faturas f where f.status = 'paga' group by 1 order by 1 desc limit 12) x),
    -- Só clientes de verdade (sem a conta do admin nem quem pediu exclusão).
    'carteira', (select coalesce(jsonb_agg(x), '[]') from (
        select case when a.status = 'trial' and a.trial_fim < hoje then 'teste_vencido' else a.status end situacao,
          a.plano, count(*) n
        from public.assinaturas a join public.perfis p on p.id = a.user_id
        where p.papel = 'cliente' and p.exclusao_em is null group by 1, 2 order by 3 desc) x),
    'trial_ate_fim', (select count(*) from public.assinaturas a join public.perfis p on p.id = a.user_id
                      where a.status = 'trial' and a.trial_fim >= hoje and p.papel = 'cliente' and p.exclusao_em is null)
  );
end $$;

-- ---------- Tráfego (origem dos cadastros) ----------
create or replace function public.admin_origens() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'por_lp', (select coalesce(jsonb_agg(x order by x.cadastros desc), '[]') from (
        select coalesce(u.raw_user_meta_data -> 'origem' -> 'ultima' ->> 'lp', 'sem origem') lp,
          count(*) cadastros,
          count(*) filter (where p.whats_verificado) confirmados,
          count(*) filter (where a.status = 'ativa') pagantes
        from auth.users u
        join public.perfis p on p.id = u.id
        left join public.assinaturas a on a.user_id = u.id
        where p.papel = 'cliente' and p.exclusao_em is null
        group by 1) x),
    -- Maiúscula e minúscula são a mesma campanha, e o corte de 50 vem DEPOIS de ordenar (antes podia sumir a maior).
    'por_campanha', (select coalesce(jsonb_agg(x order by x.cadastros desc), '[]') from (
        select lower(u.raw_user_meta_data -> 'origem' -> 'ultima' ->> 'utm_campaign') campanha,
          count(*) cadastros
        from auth.users u
        join public.perfis p on p.id = u.id
        where u.raw_user_meta_data -> 'origem' -> 'ultima' ->> 'utm_campaign' is not null
          and p.papel = 'cliente' and p.exclusao_em is null
        group by 1 order by 2 desc limit 50) x)
  );
end $$;

notify pgrst, 'reload schema';
