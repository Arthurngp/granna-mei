-- Acompanhamento dos lembretes de retenção no admin (pedido do Arthur em 2026-11-22: acompanhar e monitorar).
-- Só LEITURA: uma função, nenhuma tabela nem coluna nova, nada muda no que é enviado.
--
-- Por regra, no período: quantos lembretes foram ENVIADOS, quantos responderam em 24 h, quantos lançaram em 48 h e quantos pediram
-- SAIR. Os percentuais só consideram quem já teve tempo de responder (um lembrete de 2 horas atrás ainda não pode contar como "não
-- respondeu"): `medidos_24h` e `medidos_48h` são o denominador. Mais a linha do tempo dos últimos envios e a fila: quem é elegível
-- AGORA (sai aos poucos, no ritmo do teto) e quem passa a ser elegível nas próximas 24 h.
--
--   respondeu: mandou alguma mensagem nas 24 h seguintes ao envio, menos a palavra SAIR (que é pedido para parar, não resposta).
--   lançou:    criou algum lançamento nas 48 h seguintes, pelo WhatsApp ou pelo painel (vale o carimbo `criado_em`).
--   pediu SAIR: a conta está com avisos_off ligado hoje.
--
-- Depende de 20261121210000_retencao.sql (retencao_elegiveis, config_retencao e o tipo dos avisos). Idempotente.

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
             case a.tipo when 'retencao_nunca' then 'nunca_mandou' else 'parou_de_usar' end as regra
        from public.avisos a
       where a.tipo in ('retencao_nunca', 'retencao_parou') and a.status = 'enviado' and coalesce(a.enviado_em, a.criado_em) >= desde
    ), r as (
      select e.regra, e.user_id, e.em,
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
                      'regra', g.regra, 'enviados', g.n, 'medidos_24h', g.m24, 'responderam_24h', g.resp,
                      'medidos_48h', g.m48, 'lancaram_48h', g.lanc, 'pediram_sair', g.sair)
                      order by case g.regra when 'nunca_mandou' then 1 else 2 end), '[]'::jsonb)
                      from (select r.regra, count(*) as n,
                                   count(*) filter (where r.medido_24) as m24, count(*) filter (where r.medido_24 and r.respondeu) as resp,
                                   count(*) filter (where r.medido_48) as m48, count(*) filter (where r.medido_48 and r.lancou) as lanc,
                                   count(*) filter (where r.pediu_sair) as sair
                              from r group by r.regra) g),
      'ultimos', (select coalesce(jsonb_agg(jsonb_build_object(
                    'em', x.em, 'regra', x.regra, 'nome', x.nome, 'negocio', x.negocio,
                    -- null = ainda não deu tempo de medir (a tela mostra "aguardando")
                    'respondeu', case when x.medido_24 then x.respondeu else null end,
                    'lancou', case when x.medido_48 then x.lancou else null end,
                    'pediu_sair', x.pediu_sair) order by x.em desc), '[]'::jsonb)
                    from (select r.*, p.nome, p.negocio from r join public.perfis p on p.id = r.user_id order by r.em desc limit 40) x),
      'fila', (select coalesce(jsonb_agg(jsonb_build_object(
                 'regra', c.regra, 'modo', c.modo, 'atraso_horas', c.atraso_horas,
                 'agora', (select coalesce(jsonb_agg(jsonb_build_object('nome', e.nome, 'negocio', e.negocio, 'horas', e.horas) order by e.horas desc), '[]'::jsonb)
                             from (select * from public.retencao_elegiveis(c.regra, c.atraso_horas, false) limit 20) e),
                 -- quem passa do atraso nas próximas 24 h: elegível com 24 h a menos de espera, e ainda não elegível hoje
                 'a_caminho', (select coalesce(jsonb_agg(jsonb_build_object('nome', e.nome, 'negocio', e.negocio, 'faltam_horas', c.atraso_horas - e.horas) order by c.atraso_horas - e.horas), '[]'::jsonb)
                                 from (select x.* from public.retencao_elegiveis(c.regra, greatest(1, c.atraso_horas - 24), false) x
                                        where not exists (select 1 from public.retencao_elegiveis(c.regra, c.atraso_horas, false) y where y.user_id = x.user_id) limit 20) e))
                 order by case c.regra when 'nunca_mandou' then 1 else 2 end), '[]'::jsonb)
                 from public.config_retencao c)
    )
  );
end $$;

revoke all on function public.admin_retencao_acompanhar(integer) from public, anon;
grant execute on function public.admin_retencao_acompanhar(integer) to authenticated;
