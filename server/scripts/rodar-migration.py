#!/usr/bin/env python3
"""
Aplica uma migration no banco de produção da Granninha, mostrando ANTES e DEPOIS. Quem roda é o
Arthur, pelo terminal (a sessão de IA não aplica DDL em produção).

    /usr/bin/python3 -I server/scripts/rodar-migration.py                 # só mostra o que faria
    /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar evento
    /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar oferta
    /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar avisos

  recursos 20261123030000_recursos_cliente.sql   recursos de plano superior liberados POR CLIENTE, só pelo admin (o primeiro: resumo diário de contas). Tabela fechada ao
          cliente e 2 funções do admin com auditoria. Ninguém ganha nada: sem a migration ninguém está liberado e nada é enviado.
  fixasdia 20261123020000_fixas_dia_ate_31.sql   conta fixa pode vencer até o dia 31 (o banco só aceitava até 28): troca a regra da coluna dia, sem mexer
          em nenhuma linha. Sem ela o painel e o WhatsApp deixam escolher 29 a 31 e o banco recusa ao gravar. Rodar ANTES de o painel novo subir.
  desfazercortesia 20261121173700_admin_desfazer_cortesia.sql   admin_acao ganha a ação "Desfazer cortesia" (devolve a conta ao
          estado de antes, lido da auditoria; recusa se não souber). Sem ela o botão do admin dá erro. Não cria tabela nem coluna.
  retencaosequencia 20261122150000_retencao_sequencia.sql   sequência de até 3 mensagens por pessoa: etapas 2 e 3 (nascem DESLIGADAS), teto de 3 somando as regras, 48 h entre
          avisos; troca a assinatura de retencao_elegiveis e admin_retencao_previa. Depende de retencao e retencaoacompanhar.
  retencaoacompanhar 20261122120000_retencao_acompanhar.sql   acompanhamento dos lembretes no admin: uma função de leitura. Não muda nada do que é enviado.
  retencao 20261121210000_retencao.sql           lembretes de retenção (nunca mandou / parou de usar): tabela de configuração, função de
          elegíveis, funções do admin, coluna do SAIR e o marco do número atual. NÃO liga nada (as regras nascem desligadas).
  limite  20261121200000_limite_lancamentos.sql  limite mensal de lançamentos configurável no admin: 2 tabelas fechadas ao cliente
          (padrão de todos = 300, e limite próprio por cliente) e 3 funções do admin. Não muda o comportamento de hoje.
          Sem ela, a Granninha segue com o limite de fábrica (300) e as telas de limite do admin avisam que falta a migration.
  adminvisao 20261121140000_admin_visao_geral.sql   funções de leitura do admin: custo por período, ativação, receita
  adminacoes 20261121150000_admin_acoes_retencao_publico.sql   funções de leitura: ações, retenção, público
          (+ 6 colunas novas e vazias em perfis). Rodar adminvisao primeiro.
  cobranca 20261121120000_cobranca_stripe.sql    colunas da Stripe em assinaturas e faturas (só adiciona)
  perfil  20261121160000_perfil_publico.sql      colunas do passo opcional do cadastro (nascimento, cidade, UF, faixas, ocupacao) em perfis,
          o grant para o cliente gravar e as travas de tamanho (só adiciona). Sem ela o passo "Quer me contar mais?" e a
          ocupação de "Outro ramo" não gravam (o cadastro segue normal).
  avisos  20261120100000_avisos.sql              tabela `avisos`: registro de cada aviso de conta vencendo
          enviado, para nunca mandar em dobro. Sem ela o serviço NÃO envia aviso nenhum (de propósito).
  evento  20261119120000_mensagens_evento.sql   coluna `evento` + índice: retomada de mensagem presa
          (opcional; sem ela a retomada atende só texto)
  alerta  20261119200000_alerta_admin.sql       colunas para o aviso no WhatsApp quando a Granninha
          parar (configurado no painel admin). Sem ela a tela "Me avisar se parar" não salva.
  oferta  20261118020000_oferta_ate_31_12.sql   PRAZO 01/12: quem criar conta até 31/12 usa de graça
          até 31/12. Sem ela, cadastro de dezembro pega 7 dias e bate em bloqueio sem como pagar.

Nenhum valor de variável é impresso. Se o endpoint de SQL não existir no self-hosted, o script
imprime o SQL para colar no SQL Editor do Studio.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

APP = "xav797i93gs2kiumpkqhmr4d"  # app "granninha" na Coolify
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = {
    "evento": "20261119120000_mensagens_evento.sql",
    "oferta": "20261118020000_oferta_ate_31_12.sql",
    "alerta": "20261119200000_alerta_admin.sql",
    "avisos": "20261120100000_avisos.sql",
    "cobranca": "20261121120000_cobranca_stripe.sql",
    "perfil": "20261121160000_perfil_publico.sql",
    "origens": "20261116210000_admin_origens.sql",
    "adminsegunda": "20261121161000_admin_segunda_mensagem.sql",
    "adminvisao": "20261121140000_admin_visao_geral.sql",
    "adminacoes": "20261121150000_admin_acoes_retencao_publico.sql",
    "desfazercortesia": "20261121173700_admin_desfazer_cortesia.sql",
    "limite": "20261121200000_limite_lancamentos.sql",
    "retencao": "20261121210000_retencao.sql",
    "retencaoacompanhar": "20261122120000_retencao_acompanhar.sql",
    "retencaosequencia": "20261122150000_retencao_sequencia.sql",
    "fixasdia": "20261123020000_fixas_dia_ate_31.sql",
    "recursos": "20261123030000_recursos_cliente.sql",
}
# O que olhar antes e depois de cada uma.
CONFERE = {
    # Lista as funções admin_* que existem hoje (só leitura) e se admin_origens já está lá.
    "origens": """select
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_origens') as admin_origens,
        (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'admin\\_%') as funcoes_admin""",
    # Recria as 4 funções do admin para contar uso a partir da 2ª mensagem. Só leitura. Conferir que ainda são 4.
    "adminsegunda": """select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('admin_ativacao','admin_acoes','admin_retencao','admin_publico')) as funcoes_de_4,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='admin_ativacao' and pg_get_functiondef(p.oid) like '%offset 1%') as ativacao_ja_na_2a_mensagem""",
    # Só adiciona colunas: confere as 7 colunas, o grant de UPDATE para o cliente nelas e a trava de tamanho. Sem o grant o
    # PATCH do cliente é recusado; sem a trava o cliente poderia gravar texto sem fim.
    "perfil": """select
        (select count(*) from information_schema.columns where table_schema='public' and table_name='perfis'
          and column_name in ('nascimento','cidade','uf','faturamento_faixa','ocupacao','perfil_em','renda_faixa')) as colunas_de_7,
        (select count(*) from information_schema.column_privileges where table_schema='public' and table_name='perfis'
          and grantee='authenticated' and privilege_type='UPDATE'
          and column_name in ('nascimento','cidade','uf','faturamento_faixa','ocupacao','perfil_em','renda_faixa')) as grant_de_7,
        (select count(*) from pg_constraint where conname='perfis_publico_tamanho' and conrelid='public.perfis'::regclass) as trava""",
    # Recria a função admin_acao (ações do admin sobre a conta) com a ação nova "desfazer_cortesia". Não cria tabela nem coluna.
    # Confere: a função existe uma vez só (assinatura única), já traz a ação nova, e as permissões seguem as de sempre:
    # anon NÃO executa, authenticated executa (a função confere eh_admin() lá dentro).
    "desfazercortesia": """select
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_acao') as admin_acao_definicoes,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='admin_acao' and pg_get_functiondef(p.oid) like '%desfazer_cortesia%') as ja_tem_desfazer_cortesia,
        has_function_privilege('anon', 'public.admin_acao(uuid,text,text,integer)', 'execute') as anon_executa,
        has_function_privilege('authenticated', 'public.admin_acao(uuid,text,text,integer)', 'execute') as authenticated_executa,
        -- O que decide se o botão funciona nas contas que existem hoje: só dá para desfazer cortesia que tem registro na auditoria
        -- (mesmo filtro da função). Se "desfaziveis" for menor que "cortesias", as outras caem na recusa e precisam de ação manual.
        (select count(*) from public.assinaturas where status='cortesia') as cortesias,
        (select count(*) from public.assinaturas a where a.status='cortesia' and exists (
          select 1 from public.admin_auditoria au where au.alvo_user_id=a.user_id and au.acao='cortesia'
            and au.detalhes->>'depois'='cortesia' and au.detalhes->>'antes' in ('trial','ativa','atrasada','bloqueada'))) as desfaziveis,
        -- Para onde cada cortesia VOLTARIA (estado e fim do teste de antes, sem nomes). Teste com fim no passado = volta sem acesso.
        (select string_agg(x.destino, ' | ') from (
          select (select au.detalhes->>'antes' || coalesce('@' || (au.detalhes->>'trial_fim_antes'), '')
                    from public.admin_auditoria au where au.alvo_user_id=a.user_id and au.acao='cortesia'
                     and au.detalhes->>'depois'='cortesia' and au.detalhes->>'antes' in ('trial','ativa','atrasada','bloqueada')
                   order by au.criado_em desc, au.id desc limit 1) as destino
            from public.assinaturas a where a.status='cortesia') x) as voltariam_para,
        -- Cortesia que ainda tem assinatura na Stripe (to_jsonb não quebra se a migration cobranca não rodou).
        (select count(*) from public.assinaturas a where a.status='cortesia' and (to_jsonb(a)->>'stripe_subscription_id') is not null) as cortesias_com_stripe""",
    # Sequência de lembretes (até 3 mensagens por pessoa): tabela das etapas 2 e 3 (nasce DESLIGADA), a função de elegíveis e a prévia
    # TROCAM de assinatura. O que importa conferir: cada uma existe UMA vez só (duas versões deixariam o PostgREST em dúvida e, como em
    # dúvida o servidor não envia, os lembretes parariam sem erro), o service_role executa a de elegíveis (4 argumentos) e o cliente não,
    # as etapas nascem desligadas, a tabela é fechada ao cliente e as 5 funções do admin existem, fechadas ao anon.
    "retencaosequencia": """select
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='retencao_elegiveis') as elegiveis_definicoes,
        (select max(p.pronargs) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='retencao_elegiveis') as elegiveis_argumentos,
        (select case when count(*) = 0 then null else bool_and(has_function_privilege('service_role', p.oid, 'execute')) end
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='retencao_elegiveis') as service_role_executa_elegiveis,
        (select case when count(*) = 0 then null else bool_or(has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) end
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='retencao_elegiveis') as cliente_executa_elegiveis,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_retencao_previa') as previa_definicoes,
        (select case when to_regclass('public.config_retencao_etapa') is null then null
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.config_retencao_etapa', false, true, '')))[1]::text end) as etapas,
        (select case when to_regclass('public.config_retencao_etapa') is null then null
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.config_retencao_etapa where ativa', false, true, '')))[1]::text end) as etapas_ligadas,
        (select case when to_regclass('public.config_retencao_etapa') is null then null else has_table_privilege('service_role', 'public.config_retencao_etapa', 'select') end) as service_role_le_etapas,
        (select case when to_regclass('public.config_retencao_etapa') is null then null else has_table_privilege('authenticated', 'public.config_retencao_etapa', 'select') end) as cliente_le_etapas,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('admin_retencao_config','admin_retencao_previa','admin_retencao_definir','admin_retencao_etapa_definir','admin_retencao_acompanhar')) as funcoes_admin_de_5,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('admin_retencao_config','admin_retencao_previa','admin_retencao_definir','admin_retencao_etapa_definir','admin_retencao_acompanhar')
            and has_function_privilege('anon', p.oid, 'execute')) as funcoes_admin_abertas_ao_anon""",
    # Acompanhamento dos lembretes no admin: UMA função de leitura, nenhuma tabela nem coluna. Confere que existe, que o anon não executa e
    # que o authenticated executa (ela confere eh_admin() lá dentro), e o pré-requisito (a função de elegíveis da migration `retencao`).
    "retencaoacompanhar": """select
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_retencao_acompanhar') as funcao,
        (select case when count(*) = 0 then null else bool_or(has_function_privilege('anon', p.oid, 'execute')) end
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_retencao_acompanhar') as anon_executa,
        (select case when count(*) = 0 then null else bool_and(has_function_privilege('authenticated', p.oid, 'execute')) end
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_retencao_acompanhar') as authenticated_executa,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='retencao_elegiveis') as prerequisito_elegiveis""",
    # Lembretes de retenção. NÃO liga nada: as duas regras nascem DESLIGADAS. Confere o que importa: as duas regras existem e estão
    # desligadas, a tabela de configuração é FECHADA ao cliente, o service_role (o servidor) lê a tabela e executa a função de
    # elegíveis (sem isso o Arthur liga "Todos" e nada sai, sem erro nenhum), a função de elegíveis NÃO é executável pelo cliente
    # (devolve nome e telefone), as 3 funções do admin existem e o anon não executa nenhuma, o tipo novo cabe em `avisos`, a coluna
    # do SAIR existe e o marco do número atual está preenchido (sem marco ninguém é elegível, de propósito).
    "retencao": """select
        (select case when to_regclass('public.config_retencao') is null then null
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.config_retencao', false, true, '')))[1]::text end) as regras,
        (select case when to_regclass('public.config_retencao') is null then null
              else (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.config_retencao where modo <> 'desligado'$q$, false, true, '')))[1]::text end) as regras_ligadas,
        (select case when to_regclass('public.config_retencao') is null then null else has_table_privilege('service_role', 'public.config_retencao', 'select') end) as service_role_le_config,
        (select case when to_regclass('public.config_retencao') is null then null else has_table_privilege('authenticated', 'public.config_retencao', 'select') end) as cliente_le_config,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='retencao_elegiveis') as funcao_elegiveis,
        (select case when count(*) = 0 then null else bool_and(has_function_privilege('service_role', p.oid, 'execute')) end
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='retencao_elegiveis') as service_role_executa_elegiveis,
        (select case when count(*) = 0 then null else bool_or(has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) end
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='retencao_elegiveis') as cliente_executa_elegiveis,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('admin_retencao_config','admin_retencao_previa','admin_retencao_definir')) as funcoes_admin_de_3,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('admin_retencao_config','admin_retencao_previa','admin_retencao_definir')
            and has_function_privilege('anon', p.oid, 'execute')) as funcoes_admin_abertas_ao_anon,
        (select count(*) from pg_constraint where conrelid = 'public.avisos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%retencao_nunca%') as avisos_aceita_tipo_novo,
        (select count(*) from information_schema.columns where table_schema='public' and table_name='perfis' and column_name='avisos_off') as coluna_sair,
        -- Pré-requisito: a função de elegíveis lê estas duas tabelas (migration `limite`, já aplicada). Tem que ser 2.
        (select count(*) from information_schema.tables where table_schema='public' and table_name in ('config_limite','limite_cliente')) as tabelas_do_limite_de_2,
        -- to_jsonb em vez de citar a coluna: antes da migration ela não existe, e citá-la faria o ANTES inteiro falhar.
        (select to_jsonb(s) ->> 'numero_desde' from public.granninha_saude s where s.id = 1) as numero_desde""",
    # Limite mensal de lançamentos configurável. Cria 2 tabelas (padrão de todos e limite próprio por cliente) e 3 funções do admin.
    # Confere o que importa: as tabelas existem, estão FECHADAS ao cliente (RLS ligada e sem permissão para anon/authenticated),
    # as 3 funções existem e o anon não executa nenhuma, e qual é o padrão (tem que ser 300, o de fábrica de hoje: nada muda no comportamento).
    "limite": """select
        (select count(*) from information_schema.tables where table_schema='public' and table_name in ('config_limite','limite_cliente')) as tabelas_de_2,
        (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname in ('config_limite','limite_cliente') and c.relrowsecurity) as rls_ligada_em,
        (select count(*) from information_schema.role_table_grants
          where table_schema='public' and table_name in ('config_limite','limite_cliente') and grantee in ('anon','authenticated')) as permissoes_para_cliente,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('admin_limite_cliente','admin_limite_definir','admin_limite_previa')) as funcoes_de_3,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('admin_limite_cliente','admin_limite_definir','admin_limite_previa')
            and has_function_privilege('anon', p.oid, 'execute')) as funcoes_abertas_ao_anon,
        -- O servidor lê estas tabelas com a service_role. Se ela não puder ler, o admin grava o limite mas a regra NÃO vale (o servidor
        -- cai calado no 300). Por isso a conferência: tem que dar true nas duas depois da migration (antes dela, null).
        (case when to_regclass('public.config_limite') is null then null else has_table_privilege('service_role', 'public.config_limite', 'select') end) as service_role_le_padrao,
        (case when to_regclass('public.limite_cliente') is null then null else has_table_privilege('service_role', 'public.limite_cliente', 'select') end) as service_role_le_limite_cliente,
        -- Consulta dinâmica: a tabela ainda não existe antes da migration, e citá-la direto faria o ANTES inteiro falhar.
        (case when to_regclass('public.config_limite') is null then null
              else (xpath('/row/c/text()', query_to_xml('select lancamentos as c from public.config_limite where id', false, true, '')))[1]::text end) as padrao_hoje""",
    # Conta fixa até o dia 31. Mostra a regra que o banco aplica HOJE à coluna dia (antes: between 1 and 28; depois: between 1 and 31) e quantas fixas já passam de 28
    # (tem que ser 0 antes e pode ser maior que 0 depois). Só leitura.
    "fixasdia": """select
        (select string_agg(pg_get_constraintdef(c.oid), ' | ') from pg_constraint c where c.conrelid = 'public.fixas'::regclass and c.contype = 'c'
          and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.fixas'::regclass and attname = 'dia')]) as regra_do_dia,
        (select count(*) from public.fixas where dia > 28) as fixas_acima_de_28""",
    # Recursos de plano superior por cliente. Confere o que importa: a tabela existe, está FECHADA ao cliente (RLS ligada e sem permissão para anon e
    # authenticated), o serviço consegue ler, as 2 funções existem, o anon não executa nenhuma, e quantos clientes têm recurso (tem que ser 0 de início).
    "recursos": """select
        (select count(*) from information_schema.tables where table_schema='public' and table_name='recursos_cliente') as tabela_existe,
        (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='recursos_cliente' and c.relrowsecurity) as rls_ligada,
        (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='recursos_cliente' and grantee in ('anon','authenticated')) as permissoes_para_cliente,
        (case when to_regclass('public.recursos_cliente') is null then null else has_table_privilege('service_role', 'public.recursos_cliente', 'select') end) as service_role_le,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_recursos_cliente','admin_recurso_definir')) as funcoes_de_2,
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_recursos_cliente','admin_recurso_definir')
            and has_function_privilege('anon', p.oid, 'execute')) as funcoes_abertas_ao_anon,
        (case when to_regclass('public.recursos_cliente') is null then null
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.recursos_cliente', false, true, '')))[1]::text end) as clientes_com_recurso""",
    # Só funções de leitura do admin (custo por período, ativação, receita): confere as 3.
    "adminvisao": """select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('admin_custo_periodo','admin_ativacao','admin_receita')) as funcoes_de_3""",
    # Funções de leitura (ações, retenção, público) e 6 colunas novas e vazias em perfis (só adiciona).
    "adminacoes": """select
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('admin_acoes','admin_retencao','admin_publico')) as funcoes_de_3,
        (select count(*) from information_schema.columns where table_schema='public' and table_name='perfis'
          and column_name in ('nascimento','cidade','uf','faturamento_faixa','ocupacao','perfil_em')) as colunas_de_6""",
    # Só adiciona colunas e índices: confere as 5 colunas e o índice único que o upsert de fatura usa.
    "cobranca": """select
        (select count(*) from information_schema.columns where table_schema='public' and
          ((table_name='assinaturas' and column_name in ('stripe_customer_id','stripe_subscription_id','atrasada_desde','cancela_em'))
           or (table_name='faturas' and column_name='stripe_invoice_id'))) as colunas_de_5,
        (select count(*) from pg_indexes where schemaname='public' and indexname='faturas_stripe_invoice') as indice_fatura""",
    # A tabela existir não basta: sem RLS ligada e com permissão para o cliente, qualquer um leria os números
    # de WhatsApp de quem foi avisado. Confere os três efeitos.
    "avisos": """select
        (select count(*) from information_schema.tables where table_schema='public' and table_name='avisos') as tabela_existe,
        (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname='avisos') as rls_ligada,
        (select count(*) from information_schema.role_table_grants
          where table_schema='public' and table_name='avisos' and grantee in ('anon','authenticated')) as permissoes_para_cliente""",
    "evento": "select count(*) as colunas_evento from information_schema.columns where table_name='mensagens' and column_name='evento'",
    # A oferta tem três efeitos: o default do prazo, o prazo de quem já está em teste e o fuso dentro
    # da função de acesso. Conferir só o default deixaria dois terços sem prova.
    "alerta": """select
        (select count(*) from information_schema.columns
          where table_name='granninha_saude' and column_name in ('alerta_whats','alerta_ligado','alerta_tipo','alerta_em')) as colunas_de_alerta""",
    "oferta": """select
        (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
           join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
           join pg_class c on c.oid=d.adrelid
          where c.relname='assinaturas' and a.attname='trial_fim') as default_trial_fim,
        (select count(*) from public.assinaturas where status='trial') as em_trial,
        (select count(*) from public.assinaturas where status='trial' and trial_fim < date '2026-12-31') as trial_fora_da_oferta,
        (select position('Sao_Paulo' in pg_get_functiondef(p.oid)) > 0 from pg_proc p
           join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='acesso_liberado') as acesso_usa_fuso_sp""",
}


def do_zshrc(nome):
    caminho = os.path.expanduser("~/.zshrc")
    if not os.path.exists(caminho):
        return None
    with open(caminho, encoding="utf-8", errors="ignore") as f:
        for linha in f:
            m = re.match(r"\s*export\s+%s=(.+)" % re.escape(nome), linha)
            if m:
                v = m.group(1).strip()
                if v[:1] in "\"'" and v[-1:] == v[:1]:
                    v = v[1:-1]
                return v.strip()
    return None


aplicar = "--aplicar" in sys.argv
qual = None
for a in sys.argv[1:]:
    if a in MIGRATIONS:
        qual = a
if not qual:
    sys.exit("diga qual migration: " + " ou ".join(MIGRATIONS) + "  (veja o cabeçalho do arquivo)")

arquivo = os.path.join(RAIZ, "supabase", "migrations", MIGRATIONS[qual])
if not os.path.exists(arquivo):
    sys.exit("não achei " + arquivo)
sql = open(arquivo, encoding="utf-8").read()

coolify = os.environ.get("COOLIFY_URL") or do_zshrc("COOLIFY_URL")
token = os.environ.get("COOLIFY_API_TOKEN") or do_zshrc("COOLIFY_API_TOKEN")
if not coolify or not token:
    sys.exit("COOLIFY_URL/COOLIFY_API_TOKEN não encontrados no ambiente nem no ~/.zshrc")

req = urllib.request.Request("%s/api/v1/applications/%s/envs" % (coolify.rstrip("/"), APP), headers={"Authorization": "Bearer " + token})
try:
    with urllib.request.urlopen(req, timeout=40) as r:
        envs = json.loads(r.read().decode())
except urllib.error.HTTPError as e:
    sys.exit("Coolify respondeu %s ao listar as variáveis do app granninha" % e.code)

conf = {}
for e in envs:
    k = e.get("key") or ""
    v = e.get("real_value") or e.get("value") or ""
    if k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") and v:
        conf[k] = v
if len(conf) < 2:
    sys.exit("não achei SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no app granninha")

BASE = conf["SUPABASE_URL"].rstrip("/")
CHAVE = conf["SUPABASE_SERVICE_ROLE_KEY"]


def consultar(texto_sql):
    """Executa SQL pelo endpoint /pg/query do self-hosted. Devolve (ok, resposta)."""
    pedido = urllib.request.Request(
        BASE + "/pg/query",
        data=json.dumps({"query": texto_sql}).encode(),
        headers={"apikey": CHAVE, "Authorization": "Bearer " + CHAVE, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(pedido, timeout=120) as r:
            return True, r.read().decode()
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode()[:400])
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def mostrar_sql_para_colar():
    print("\nO endpoint de SQL não respondeu. Cole isto no SQL Editor do Studio:")
    print("-" * 70)
    print(sql)
    print("-" * 70)


print("Migration: %s\n" % MIGRATIONS[qual])
ok, antes = consultar(CONFERE[qual])
if not ok:
    print("ANTES: não deu para consultar (%s)" % antes)
    mostrar_sql_para_colar()
    sys.exit(1)
print("ANTES: " + antes.strip()[:400])

if not aplicar:
    print("\nNada foi aplicado. Para aplicar de verdade:")
    print("  /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar %s" % qual)
    sys.exit(0)

ok, saida = consultar(sql)
print("\nAPLICAR: " + ("ok" if ok else "FALHOU -> " + saida))
if not ok:
    mostrar_sql_para_colar()
    sys.exit(1)

ok, depois = consultar(CONFERE[qual])
print("DEPOIS: " + (depois.strip()[:400] if ok else "não deu para conferir (%s)" % depois))
print("\nPronto. Confira que o DEPOIS mudou em relação ao ANTES.")
