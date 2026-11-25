-- Lembrete "Nunca mandou nada" passa a valer para quem NUNCA LANÇOU, e não só para quem nunca escreveu.
--
-- Por quê (leitura de produção em 24/11): a regra antiga exigia no máximo UMA mensagem (o código que confirma o número). Quem escreveu duas ou
-- mais vezes e nunca lançou nada não entrava em regra nenhuma: "nunca mandou" recusava pelas mensagens e "parou de usar" exige ao menos um
-- lançamento. Dois clientes reais estavam nesse buraco (um perguntou o saldo e saiu, outro travou num erro já corrigido). A tela do admin já
-- descreve a regra como "pessoas que confirmaram o WhatsApp, mas ainda não lançaram nada": agora o banco faz o que a tela diz.
--
-- O que muda, só na função retencao_elegiveis (mesma assinatura: nada de segunda versão, que deixaria o PostgREST em dúvida e o servidor mudo):
--   - nunca_mandou: sai a exigência de no máximo uma mensagem. Fica: nenhum lançamento (pelo WhatsApp ou pelo painel).
--   - O prazo passa a contar da ÚLTIMA atividade, não da primeira mensagem: quem está conversando agora não é interrompido por um lembrete só
--     porque confirmou o número há 24 h. Para quem só mandou o código, última e primeira são a mesma mensagem: nada muda para essas pessoas.
--   - O teto de 30 dias continua contando da primeira mensagem.
-- Tudo o mais é igual: só quem escreveu para o número atual, SAIR, limite do mês, teto de 3 lembretes por pessoa, 48 h entre avisos de qualquer
-- tipo, e a sequência (2ª e 3ª) só para quem não reagiu à anterior. "Parou de usar" não muda.
--
-- Não cria tabela nem coluna e não envia nada sozinha: quem envia é o servidor, pela regra que já está ligada ou desligada no admin.
-- Rodar de novo é inofensivo (create or replace).

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
         floor(extract(epoch from (now() - v.ultima)) / 3600)::integer
    from v
   where (p_ignorar_marco or v.desde_marco >= 1)
     and v.uso_mes < v.limite
     and not v.ja_tem_esta
     and v.total_ret < 3
     and (v.ultimo_aviso is null or v.ultimo_aviso <= now() - interval '48 hours')
     and (p_etapa = 1 or (p_etapa in (2, 3) and v.anterior_em is not null and v.ultima <= v.anterior_em))
     and (   (p_regra = 'nunca_mandou' and v.lancs = 0 and v.ultima <= now() - make_interval(hours => p_atraso) and v.primeira >= now() - interval '30 days')
          or (p_regra = 'parou_de_usar' and v.qtd >= 2 and v.lancs >= 1 and v.ultima <= now() - make_interval(hours => p_atraso) and v.ultima >= now() - interval '30 days'))
   order by v.ultima asc, v.id;
end $$;
-- Só o servidor (service_role) executa: devolve nome e telefone de clientes.
revoke all on function public.retencao_elegiveis(text, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.retencao_elegiveis(text, integer, boolean, integer) to service_role;
