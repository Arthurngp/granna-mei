"""Prova a migration 20261124120000_admin_dados_reais.sql contra o SCHEMA REAL (todas as migrations aplicadas em ordem, em Postgres descartável).
1) Antes da migration: confirma que os erros existem (admin contado como cliente, mês UTC, erro sem janela...). 2) Depois: confere os números verdadeiros.
3) Quebra a migration de 12 jeitos e confere que o teste cai em cada um. Uso: /usr/bin/python3 -I server/scripts/testar-admin-dados.py"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_schema_real import R, Banco  # noqa: E402

MIG = R + "/supabase/migrations/20261124120000_admin_dados_reais.sql"
ANTES = "20261123160000_envio_manual_contato_frio.sql"
ADM = "00000000-0000-0000-0000-0000000000aa"


def u(n):
    return "00000000-0000-0000-0000-%012d" % n


def cenario(b):
    """9 pessoas: o admin (assinatura bloqueada, como em produção) e 6 clientes com situações diferentes, mais mensagens de todo tipo."""
    hoje = "(now() at time zone 'America/Sao_Paulo')::date"
    b.rodar("insert into auth.users (id, email) values ('%s', 'admin@x.com')" % ADM)
    b.rodar("update public.perfis set papel='admin', nome='Admin' where id='%s'; update public.assinaturas set status='bloqueada' where user_id='%s'" % (ADM, ADM))
    camp = {1: "Black", 2: "black", 3: "Natal"}
    for n in range(1, 7):
        meta = ("'{\"origem\": {\"ultima\": {\"lp\": \"home\", \"utm_campaign\": \"%s\"}}}'::jsonb" % camp[n]) if n in camp else "'{}'::jsonb"
        b.rodar("insert into auth.users (id, email, raw_user_meta_data) values ('%s', 'c%d@x.com', %s)" % (u(n), n, meta))
        b.rodar("update public.perfis set nome='Cliente %d', negocio='Loja %d', whats_verificado=%s where id='%s'" % (n, n, "true" if n in (1, 6) else "false", u(n)))
    sit = {
        1: "status='trial', trial_fim=%s + 5" % hoje,
        2: "status='trial', trial_fim=%s - 1" % hoje,
        3: "status='cortesia', motivo='Parceiro'",
        4: "status='atrasada'",
        5: "status='ativa'",
        6: "status='trial', trial_fim=%s" % hoje,  # último dia do teste: ainda tem acesso
    }
    for n, s in sit.items():
        b.rodar("update public.assinaturas set %s where user_id='%s'" % (s, u(n)))
    b.rodar("update public.perfis set exclusao_em = now() where id='%s'" % u(5))  # pediu exclusão
    ins = "insert into public.mensagens (id, user_id, telefone, texto, status, erro, criado_em) values "
    linhas = []
    k = [0]

    def m(user, status, erro="null", quando="now() - interval '1 minute'"):
        k[0] += 1
        linhas.append("('m%d', %s, '5581900000%02d', 'x', '%s', %s, %s)" % (k[0], ("'%s'" % user) if user else "null", k[0], status, erro, quando))

    for _ in range(3):
        m(u(1), "ok")
    m(u(1), "ok", erro="'resposta não entregue: gateway fora'")
    m(u(1), "pergunta")
    m(u(1), "bloqueada")
    m(u(1), "limite")
    m(u(1), "erro", erro="'falha recente'")
    m(u(1), "erro", erro="'falha antiga'", quando="now() - interval '3 days'")
    # Última hora do mês em UTC = ainda dia anterior em São Paulo: pertence ao mês passado para o dono, mas o mês UTC contaria.
    m(u(1), "ok", quando="date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' + interval '1 hour'")
    m(None, "ignorada")
    m(None, "ignorada")
    b.rodar(ins + ", ".join(linhas))


def lote_de_campanhas(b):
    """64 cadastros em 60 campanhas de 1 cadastro e uma de 5 ('zzz-maior'): a maior não pode sumir no corte de 50."""
    b.rodar("insert into auth.users (id, email, raw_user_meta_data) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'r'||g||'@x.com', "
            "jsonb_build_object('origem', jsonb_build_object('ultima', jsonb_build_object('lp','home','utm_campaign', case when g <= 5 then 'zzz-maior' else 'c'||g end))) from generate_series(1, 64) g")


def j(b, sql):
    return json.loads(b.admin("select (%s)::text" % sql))


def leitura(b):
    return {
        "painel": j(b, "public.admin_painel()"),
        "receita": j(b, "public.admin_receita()"),
        "origens": j(b, "public.admin_origens()"),
        "lista": json.loads(b.admin("select coalesce(jsonb_agg(to_jsonb(c)), '[]')::text from public.admin_clientes('', '') c")),
        "vencidos": json.loads(b.admin("select coalesce(jsonb_agg(c.nome), '[]')::text from public.admin_clientes('', 'teste_vencido') c")),
        "em_teste": json.loads(b.admin("select coalesce(jsonb_agg(c.nome order by c.nome), '[]')::text from public.admin_clientes('', 'trial') c")),
    }


def verdades(b, d):
    """Devolve a lista de verificações que FALHARAM (nomes)."""
    f = []

    def c(nome, ok):
        if not ok:
            f.append(nome)

    p = d["painel"]
    c("painel: Clientes = 5 (sem o admin e sem quem pediu exclusão)", p["clientes"] == 5)
    c("painel: nenhuma 'bloqueada' (a única era o admin)", "bloqueada" not in p["por_situacao"])
    c("painel: situação certa (2 em teste, 1 vencido, 1 cortesia, 1 atrasada)", p["por_situacao"] == {"trial": 2, "teste_vencido": 1, "cortesia": 1, "atrasada": 1})
    c("painel: confirmados só de clientes não excluídos (2)", p["numeros_confirmados"] == 2)
    c("painel: mensagens de hoje só de clientes conhecidos (8 do c1, sem as 2 desconhecidas)", p["mensagens_hoje"] == 8)
    c("painel: erros 24h = erro recente + resposta não entregue (2), sem a antiga", p["erros_24h"] == 2)
    c("painel: últimos erros só das últimas 24h (2)", len(p["ultimos_erros"]) == 2)
    esperado = int(b.rodar("select count(*) from public.mensagens where user_id='%s' and criado_em >= timezone('America/Sao_Paulo', date_trunc('month', timezone('America/Sao_Paulo', now())))" % u(1)))
    c("painel: consumo do mês usa o mês de São Paulo (a mensagem do limite UTC fica de fora)", bool(p["maiores_consumidores"]) and p["maiores_consumidores"][0]["mensagens"] == esperado)
    r = d["receita"]
    c("receita: carteira soma só clientes não excluídos (5)", sum(x["n"] for x in r["carteira"]) == 5)
    c("receita: nenhuma 'bloqueada' na carteira", all(x["situacao"] != "bloqueada" for x in r["carteira"]))
    c("receita: em teste com acesso = 2", r["trial_ate_fim"] == 2)
    c("lista: 6 clientes (sem a linha do admin)", len(d["lista"]) == 6 and all(x["papel"] == "cliente" for x in d["lista"]))
    c("lista: Teste vencido = só o Cliente 2", d["vencidos"] == ["Cliente 2"])
    c("lista: Em teste = Cliente 1 e Cliente 6 (o do último dia ainda usa)", d["em_teste"] == ["Cliente 1", "Cliente 6"])
    c1 = next((x for x in d["lista"] if x["nome"] == "Cliente 1"), {})
    c("lista: mensagens atendidas no mês do Cliente 1 = 4 (ok), sem bloqueada/limite/erro e sem a do mês UTC", c1.get("mensagens_mes") == 4)
    o = d["origens"]
    c("tráfego: cadastros por página = 5 (sem admin nem excluído)", sum(x["cadastros"] for x in o["por_lp"]) == 5)
    camp = {x["campanha"]: x["cadastros"] for x in o["por_campanha"]}
    c("tráfego: Black e black são a mesma campanha (2)", camp.get("black") == 2 and "Black" not in camp)
    # estático: nada de dia UTC (current_date) nas funções do admin que dependem de data
    src = b.rodar("select string_agg(pg_get_functiondef(p.oid), ' ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_clientes','admin_painel','admin_receita')")
    c("estático: nenhuma dessas funções usa current_date (dia UTC)", "current_date" not in src)
    return f


def verdade_do_lote(b):
    lote_de_campanhas(b)
    o = j(b, "public.admin_origens()")
    camp = {x["campanha"]: x["cadastros"] for x in o["por_campanha"]}
    ok = camp.get("zzz-maior") == 5 and len(o["por_campanha"]) <= 50 and o["por_campanha"][0]["campanha"] == "zzz-maior"
    return [] if ok else ["tráfego: a campanha maior (5 cadastros) sobrevive ao corte de 50 e vem em primeiro"]


def montar(sql_mig=None, depois=True):
    b = Banco(ate=ANTES)
    cenario(b)
    antes = leitura(b)
    if sql_mig is not None:
        rc, o, e = b.psql(sql_mig)
        assert rc == 0, "migration falhou: " + e[-500:]
    return b, antes


# ---------- 1) o erro existe ANTES ----------
b, antes = montar()
erros_antes = verdades(b, antes)
b.fim()
print("ANTES da migration, falham %d de 20 verificações (o que prova que os erros existiam):" % len(erros_antes))
for x in erros_antes:
    print("   x", x)
assert len(erros_antes) >= 12, "o cenário precisa reproduzir os erros de antes"

# ---------- 2) depois da migration ----------
sql = open(MIG, encoding="utf-8").read()
b = Banco(ate=ANTES)
cenario(b)
rc, o, e = b.psql(sql)
assert rc == 0, "migration falhou: " + e[-600:]
depois = verdades(b, leitura(b)) + verdade_do_lote(b)
print("\nDEPOIS da migration:")
for x in depois:
    print("  FALHA", x)
falhas = len(depois)
print("  %s" % ("20 de 20 verificações ok (19 do cenário + o lote de campanhas)" if not falhas else "%d falha(s)" % falhas))
# idempotente
rc, o, e = b.psql(sql)
print("  %s reaplicar a migration não dá erro" % ("ok   " if rc == 0 else "FALHA"))
falhas += rc != 0
# segurança: quem não é admin não lê nada
rc, o, e = b.psql("set teste.uid='%s'; set role authenticated; select public.admin_painel()" % u(1))
print("  %s cliente comum chamando admin_painel() é recusado" % ("ok   " if rc != 0 and "acesso negado" in e else "FALHA"))
falhas += not (rc != 0 and "acesso negado" in e)
rc, o, e = b.psql("set role anon; select public.admin_receita()")
print("  %s anônimo não executa admin_receita()" % ("ok   " if rc != 0 else "FALHA"))
falhas += rc == 0
b.fim()

# ---------- 3) mutações ----------
MUT = [
    ("admin aparece na lista de clientes", "where p.papel = 'cliente'\n    and (coalesce(p_busca, '') = ''", "where (coalesce(p_busca, '') = ''"),
    ("teste vencido pelo dia UTC", "a.trial_fim < hoje then 'teste_vencido' else a.status end,\n    a.plano", "a.trial_fim < current_date then 'teste_vencido' else a.status end,\n    a.plano"),
    ("mensagens do mês contam qualquer status", "m.status = 'ok' and m.criado_em >= mes_sp", "m.criado_em >= mes_sp"),
    ("mês de UTC em vez de São Paulo", "date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'", "date_trunc('month', now())"),
    ("painel conta o admin como cliente", "'clientes', (select count(*) from public.perfis where papel = 'cliente' and exclusao_em is null)", "'clientes', (select count(*) from public.perfis)"),
    ("situação inclui a conta do admin", "where p.papel = 'cliente' and p.exclusao_em is null group by 1) x),\n    'novos_7d'", "group by 1) x),\n    'novos_7d'"),
    ("erro de entrega não conta", "(status = 'erro' or erro like 'resposta não entregue%')", "(status = 'erro')"),
    ("últimos erros sem janela de 24h", "and criado_em >= now() - interval '24 hours'\n        order by criado_em desc limit 5", "order by criado_em desc limit 5"),
    ("mensagens de hoje contam desconhecidos", "where user_id is not null and criado_em >= dia_sp", "where criado_em >= dia_sp"),
    ("carteira da receita inclui admin e excluídos", "where p.papel = 'cliente' and p.exclusao_em is null group by 1, 2 order by 3 desc) x),", "group by 1, 2 order by 3 desc) x),"),
    ("campanha sensível a maiúscula", "lower(u.raw_user_meta_data -> 'origem' -> 'ultima' ->> 'utm_campaign') campanha", "u.raw_user_meta_data -> 'origem' -> 'ultima' ->> 'utm_campaign' campanha"),
    ("tráfego conta o admin e excluídos", "where p.papel = 'cliente' and p.exclusao_em is null\n        group by 1) x),", "group by 1) x),"),
]
pegas = 0
for nome, de, para in MUT:
    if de not in sql:
        print("MUTAÇÃO VAZIA (trecho não encontrado):", nome)
        falhas += 1
        continue
    b = Banco(ate=ANTES)
    cenario(b)
    rc, o, e = b.psql(sql.replace(de, para))
    if rc != 0:
        print("MUTAÇÃO NÃO COMPILOU:", nome, e[-200:])
        b.fim()
        falhas += 1
        continue
    quebrou = verdades(b, leitura(b))
    b.fim()
    print("  %s %s" % ("PEGO " if quebrou else "PASSOU", nome))
    pegas += bool(quebrou)
    falhas += not quebrou
print("\n%d de %d defeitos pegos | FALHAS: %d" % (pegas, len(MUT), falhas))
sys.exit(1 if falhas else 0)
