#!/usr/bin/env python3
"""
Aplica uma migration no banco de produção da Granninha, mostrando ANTES e DEPOIS. Quem roda é o
Arthur, pelo terminal (a sessão de IA não aplica DDL em produção).

    /usr/bin/python3 -I server/scripts/rodar-migration.py                 # só mostra o que faria
    /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar evento
    /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar oferta
    /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar avisos

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
    "limite": "20261121200000_limite_lancamentos.sql",
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
