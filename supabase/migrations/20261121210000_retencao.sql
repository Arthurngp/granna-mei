-- Lembretes de retenção: a Granninha chama quem confirmou o WhatsApp e nunca mandou nada, e quem parou de usar.
-- Pedido do Arthur (2026-11-21), nos limites que ele aprovou: no máximo 15 por dia, 3 minutos entre um envio e outro, só das 9h às 19h.
--
-- Esta migration NÃO liga nada. As duas regras nascem DESLIGADAS; o Arthur liga pelo admin (aba Avisos), passando por
-- ensaio (só diz quem receberia), piloto (manda a ele um exemplo) e só então todos. Teto, janela e espera moram no CÓDIGO
-- do servidor (server/src/retencao.ts), de propósito: um clique no admin não pode afrouxar a proteção do número.
--
-- O que ela cria:
--   - perfis.avisos_off: quem responde SAIR. Nunca mais recebe lembrete de uso.
--   - granninha_saude.numero_desde: desde quando o número ATUAL da Granninha está no ar. Um trigger registra sozinho toda troca de
--     número. Só recebe lembrete quem já escreveu para este número: contato frio é o que derruba número não oficial. Hoje
--     (21/11) o número foi trocado, então quem só confirmou pelo chip antigo NÃO é elegível.
--   - config_retencao: uma linha por regra (modo, atraso em horas, texto). Fechada ao cliente.
--   - retencao_elegiveis(): UMA só definição de "quem é elegível", usada pelo servidor e pela prévia do admin. Só o servidor executa.
--   - admin_retencao_config / _previa / _definir: o admin lê, vê a prévia e muda (com motivo e auditoria).
--   - avisos.tipo passa a aceitar os dois tipos novos.
--
-- Depende de 20261121200000_limite_lancamentos.sql (já aplicada em produção): retencao_elegiveis lê config_limite e limite_cliente para
-- não chamar quem já estourou o limite do mês. Sem elas a função falha ao rodar e o servidor, por isso, não envia nada.
--
-- Idempotente: pode rodar de novo sem efeito.

-- ---------- avisos: tipos novos ----------
-- O nome do check não é garantido: acha o que cita "vencimento" e troca por um que aceita os tipos novos.
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.avisos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%tipo%vencimento%' loop
    execute format('alter table public.avisos drop constraint %I', c);
  end loop;
  alter table public.avisos add constraint avisos_tipo_check check (tipo in ('vencimento', 'retencao_nunca', 'retencao_parou'));
end $$;

-- ---------- SAIR ----------
alter table public.perfis add column if not exists avisos_off boolean not null default false;

-- ---------- Desde quando o número atual está no ar ----------
alter table public.granninha_saude
  add column if not exists numero_desde timestamptz,
  add column if not exists ultimo_numero text,
  add column if not exists retencao_ciclo_em timestamptz,
  add column if not exists retencao_erro text;

-- O batimento grava o número a cada minuto e ele some (nulo) quando o chip desconecta. Compara com o ÚLTIMO número visto: o mesmo
-- número voltando de uma queda não conta como troca; outro número conta.
create or replace function public.granninha_saude_numero() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.whatsapp_numero is not null and new.whatsapp_numero <> '' then
    if old.ultimo_numero is not null and old.ultimo_numero <> new.whatsapp_numero then new.numero_desde := now(); end if;
    new.ultimo_numero := new.whatsapp_numero;
  end if;
  return new;
end $$;
drop trigger if exists granninha_saude_numero on public.granninha_saude;
create trigger granninha_saude_numero before update on public.granninha_saude for each row execute function public.granninha_saude_numero();

-- Marco de hoje: a desconexão do número antigo foi registrada às 04:04:14 UTC de 21/11 (admin_auditoria, whatsapp_desconectar). Tudo
-- que chegou depois entrou pelo número novo. Só preenche se ainda estiver vazio.
update public.granninha_saude
   set numero_desde = coalesce(numero_desde, timestamptz '2026-11-21 04:04:14+00'), ultimo_numero = coalesce(ultimo_numero, whatsapp_numero)
 where id = 1;

-- ---------- A configuração de cada regra ----------
create table if not exists public.config_retencao (
  regra text primary key check (regra in ('nunca_mandou', 'parou_de_usar')),
  modo text not null default 'desligado' check (modo in ('desligado', 'ensaio', 'piloto', 'todos')),
  atraso_horas integer not null check (atraso_horas between 1 and 720),
  texto text not null check (length(trim(texto)) between 20 and 600),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null
);

-- Sem emoji, sem travessão, sem link (decisões do Arthur para texto de cliente; link em mensagem automática também chama a atenção do
-- spam do WhatsApp). O "{nome}" vira o primeiro nome. A linha do SAIR o servidor acrescenta sozinho, e o admin não consegue tirar.
insert into public.config_retencao (regra, modo, atraso_horas, texto) values
  ('nunca_mandou', 'desligado', 24,
   'Oi, {nome}! Aqui é a Granninha. Vi que você ainda não me mandou nenhum lançamento. É só escrever do seu jeito, por exemplo "recebi 300 de um serviço" ou "gasolina 60 pro negócio", que eu anoto pra você.'),
  ('parou_de_usar', 'desligado', 48,
   'Oi, {nome}! Faz uns dias que você não me manda nada. Se teve venda ou gasto nesse tempo, me conta por aqui que eu anoto, e você não perde o controle do mês.')
on conflict (regra) do nothing;

alter table public.config_retencao enable row level security;
revoke all on public.config_retencao from anon, authenticated;
grant select on public.config_retencao to service_role;

-- ---------- Quem é elegível ----------
-- Mesma definição da lista "Precisa de você hoje" do admin (20261121161000_admin_segunda_mensagem.sql, admin_acoes): mensagens em
-- `mensagens`, e a PRIMEIRA é só o código que confirma o número (qtd <= 1 = nunca usou pelo WhatsApp). Diferenças de propósito: o
-- atraso é o configurado aqui (24 h e 48 h; a lista manual usa 7 dias para "sumiu"), e só entra quem escreveu para o número ATUAL.
--   nunca_mandou:  confirmou o WhatsApp (qtd <= 1), NÃO lançou nada nem pelo painel, e a primeira mensagem tem pelo menos p_atraso
--                  horas e no máximo 30 dias.
--   parou_de_usar: já usou (qtd >= 2) e a ÚLTIMA atividade, mensagem ou lançamento (pelo painel também), tem pelo menos p_atraso horas
--                  e no máximo 30 dias.
-- "Usou" inclui o painel: quem lança todo dia pelo painel e não escreve no WhatsApp não pode ouvir "faz uns dias que você não me manda
-- nada". Para isso vale o `criado_em` do lançamento (o carimbo real), não a `data`, que o cliente escolhe e pode ser retroativa.
-- Em qualquer caso: cliente (não admin), WhatsApp verificado, sem exclusão pedida, sem SAIR, com acesso liberado (quem está com teste
-- vencido bateria no "acesso pausado"), que ainda não recebeu esta regra (uma vez por pessoa por regra) e que NÃO estourou o limite do
-- mês (quem chegou no limite ouviria "me conta que eu anoto" e, ao responder, "você chegou ao limite"). O limite é o de
-- admin_limite_cliente: o próprio do cliente, senão o padrão, senão 300 (depende da migration 20261121200000_limite_lancamentos.sql).
-- p_ignorar_marco existe só para a prévia contar quem ficaria de fora por ter escrito apenas para o número antigo.
create or replace function public.retencao_elegiveis(p_regra text, p_atraso integer, p_ignorar_marco boolean default false)
returns table (user_id uuid, nome text, negocio text, whats text, whats_chave text, telefone text, qtd bigint, primeira timestamptz, ultima timestamptz, horas integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  marco timestamptz;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  inicio_mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if p_regra not in ('nunca_mandou', 'parou_de_usar') or p_atraso is null or p_atraso < 1 or p_atraso > 720 then return; end if;
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
           coalesce((select lc.lancamentos from public.limite_cliente lc where lc.user_id = u.id), (select cl.lancamentos from public.config_limite cl where cl.id), 300) as limite
      from u
  )
  select v.id, v.nome, v.negocio, v.whats, v.whats_chave, v.telefone, v.qtd, v.primeira, v.ultima,
         floor(extract(epoch from (now() - case p_regra when 'nunca_mandou' then v.primeira else v.ultima end)) / 3600)::integer
    from v
   where (p_ignorar_marco or v.desde_marco >= 1)
     and v.uso_mes < v.limite
     and not exists (select 1 from public.avisos av where av.user_id = v.id and av.chave = 'ret:' || p_regra || ':' || v.id::text)
     and (   (p_regra = 'nunca_mandou' and v.qtd <= 1 and v.lancs = 0 and v.primeira <= now() - make_interval(hours => p_atraso) and v.primeira >= now() - interval '30 days')
          or (p_regra = 'parou_de_usar' and v.qtd >= 2 and v.ultima <= now() - make_interval(hours => p_atraso) and v.ultima >= now() - interval '30 days'))
   order by case p_regra when 'nunca_mandou' then v.primeira else v.ultima end asc, v.id;
end $$;
-- Só o servidor (service_role) executa: devolve nome e telefone de clientes.
revoke all on function public.retencao_elegiveis(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.retencao_elegiveis(text, integer, boolean) to service_role;

-- ---------- Admin: ler ----------
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
                          and a.tipo = case c.regra when 'nunca_mandou' then 'retencao_nunca' else 'retencao_parou' end))
        order by case c.regra when 'nunca_mandou' then 1 else 2 end), '[]'::jsonb)
       from public.config_retencao c),
    'enviados_hoje', (select count(*) from public.avisos a where a.tipo in ('retencao_nunca', 'retencao_parou') and a.criado_em >= inicio),
    'ultimo_envio', (select max(a.enviado_em) from public.avisos a where a.tipo in ('retencao_nunca', 'retencao_parou')),
    'numero_desde', (select s.numero_desde from public.granninha_saude s where s.id = 1),
    'ciclo_em', (select s.retencao_ciclo_em from public.granninha_saude s where s.id = 1),
    'erro', (select s.retencao_erro from public.granninha_saude s where s.id = 1));
end $$;

-- ---------- Admin: prévia (quem receberia agora) ----------
create or replace function public.admin_retencao_previa(p_regra text, p_atraso integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare total integer; sem_marco integer;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if p_regra not in ('nunca_mandou', 'parou_de_usar') then raise exception 'regra desconhecida' using errcode = '22023'; end if;
  if p_atraso is null or p_atraso < 1 or p_atraso > 720 then raise exception 'o atraso vai de 1 a 720 horas' using errcode = '22023'; end if;
  select count(*) into total from public.retencao_elegiveis(p_regra, p_atraso, false);
  select count(*) into sem_marco from public.retencao_elegiveis(p_regra, p_atraso, true);
  return jsonb_build_object(
    'total', total,
    -- Quem seria elegível se não fosse o número novo: escreveu só para o número antigo e, por isso, NÃO recebe.
    'fora_por_numero_antigo', sem_marco - total,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome', e.nome, 'negocio', e.negocio, 'horas', e.horas) order by e.horas desc), '[]'::jsonb)
                from (select * from public.retencao_elegiveis(p_regra, p_atraso, false) limit 30) e));
end $$;

-- ---------- Admin: mudar ----------
-- Motivo obrigatório. Sem emoji, sem travessão e sem link no texto. A auditoria guarda o modo de antes e o de depois.
create or replace function public.admin_retencao_definir(p_regra text, p_modo text, p_atraso integer, p_texto text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare antes public.config_retencao%rowtype; depois public.config_retencao%rowtype;
begin
  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo obrigatório' using errcode = '22023'; end if;
  if p_regra not in ('nunca_mandou', 'parou_de_usar') then raise exception 'regra desconhecida' using errcode = '22023'; end if;
  if p_modo not in ('desligado', 'ensaio', 'piloto', 'todos') then raise exception 'modo desconhecido' using errcode = '22023'; end if;
  if p_atraso is null or p_atraso < 1 or p_atraso > 720 then raise exception 'o atraso vai de 1 a 720 horas' using errcode = '22023'; end if;
  if length(trim(coalesce(p_texto, ''))) < 20 or length(trim(p_texto)) > 600 then raise exception 'o texto precisa ter de 20 a 600 letras' using errcode = '22023'; end if;
  if p_texto ~ '[—–]' then raise exception 'sem travessão no texto' using errcode = '22023'; end if;
  if p_texto ~ '[\U0001F000-\U0001FAFF\u2190-\u27BF\uFE0F]' then raise exception 'sem emoji no texto' using errcode = '22023'; end if;
  if p_texto ~* '(https?://|www\.|\.com\y|\.br\y)' then raise exception 'sem link no texto' using errcode = '22023'; end if;
  -- A linha do SAIR é acrescentada pelo servidor em toda mensagem. O texto do admin não fala de SAIR: não tem como tirá-la nem duplicá-la.
  if p_texto ~* '\ysair\y' then raise exception 'não escreva SAIR no texto: a linha do SAIR entra sozinha' using errcode = '22023'; end if;
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

-- Só quem está logado chama (e cada função confere eh_admin() lá dentro).
revoke all on function public.admin_retencao_config() from public, anon;
revoke all on function public.admin_retencao_previa(text, integer) from public, anon;
revoke all on function public.admin_retencao_definir(text, text, integer, text, text) from public, anon;
grant execute on function public.admin_retencao_config() to authenticated;
grant execute on function public.admin_retencao_previa(text, integer) to authenticated;
grant execute on function public.admin_retencao_definir(text, text, integer, text, text) to authenticated;
