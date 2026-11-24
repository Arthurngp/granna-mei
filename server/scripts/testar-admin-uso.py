"""Prova a migration 20261124130000_admin_uso_real.sql contra o SCHEMA REAL (todas as migrations em Postgres descartável): "usou a Granninha" passa a
contar só uso de verdade (sem SAIR, sem recusa por acesso/limite, sem a confirmação do número), exclusão pedida fica de fora, "nunca usaram" tem carência.
1) Antes: confirma que os erros existiam. 2) Depois: confere os números verdadeiros. 3) Quebra a migration de 9 jeitos e confere que o teste cai em cada um.
Uso: /usr/bin/python3 -I server/scripts/testar-admin-uso.py"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_schema_real import R, Banco  # noqa: E402

MIG = R + "/supabase/migrations/20261124130000_admin_uso_real.sql"
ANTES = "20261124120000_admin_dados_reais.sql"
ADM = "00000000-0000-0000-0000-0000000000aa"


def u(n):
    return "00000000-0000-0000-0000-%012d" % n


def cenario(b):
    b.rodar("insert into auth.users (id, email) values ('%s', 'admin@x.com')" % ADM)
    b.rodar("update public.perfis set papel='admin', nome='Admin' where id='%s'" % ADM)
    # (n, criado_em, mensagens [(status, texto, quando)], excluido)
    base = "now()"
    clientes = {
        11: ("interval '3 days'", [("ok", "codigo", "-48 hours"), ("pergunta", "SAIR", "-47 hours"), ("bloqueada", "paguei 10", "-46 hours")], False),
        12: ("interval '3 days'", [("ok", "codigo", "-48 hours"), ("ok", "paguei 20", "-47 hours"), ("ok", "recebi 50", "-1 hour")], False),
        13: ("interval '20 days'", [("ok", "codigo", "-19 days"), ("ok", "paguei 5", "-10 days"), ("ok", "paguei 6", "-9 days"), ("pergunta", "sair.", "-1 hour")], False),
        14: ("interval '2 hours'", [("ok", "codigo", "-90 minutes")], False),
        15: ("interval '3 days'", [("ok", "codigo", "-48 hours"), ("ok", "paguei 1", "-1 hour")], True),
    }
    k = 0
    for n, (idade, msgs, excl) in clientes.items():
        b.rodar("insert into auth.users (id, email) values ('%s', 'k%d@x.com')" % (u(n), n))
        b.rodar("update public.perfis set nome='Cliente %d', ramo='beleza', whats_verificado=true, onboarding_feito=true, onboarding_passo=7, criado_em=now() - %s, exclusao_em=%s where id='%s'"
                % (n, idade, "now()" if excl else "null", u(n)))
        b.rodar("update public.assinaturas set status='ativa' where user_id='%s'" % u(n))
        for status, texto, quando in msgs:
            k += 1
            b.rodar("insert into public.mensagens (id, user_id, telefone, texto, status, criado_em) values ('u%d', '%s', '55819000000%02d', '%s', '%s', now() + interval '%s')" % (k, u(n), n, texto, status, quando))


def j(b, sql):
    return json.loads(b.admin("select (%s)::text" % sql))


def leitura(b):
    return {"ativacao": j(b, "public.admin_ativacao()"), "acoes": j(b, "public.admin_acoes()"), "retencao": j(b, "public.admin_retencao()"), "publico": j(b, "public.admin_publico()")}


def verdades(b, d):
    f = []

    def c(nome, ok):
        if not ok:
            f.append(nome)

    a = d["ativacao"]
    c("ativação: Cadastros = 4 (a conta com exclusão pedida fica de fora)", a["total"] == 4)
    c("ativação: usaram = 2 (só quem usou de verdade: SAIR e recusa não contam)", a["com_mensagem"] == 2)
    c("ativação: terminaram e nunca usaram = 2 (contado no banco)", a.get("terminaram_sem_uso") == 2)
    c("ativação: confirmaram = 4", a["confirmaram"] == 4)
    ac = d["acoes"]
    c("ações: 'nunca usaram' = só o Cliente 11 (SAIR+recusa não é uso; o Cliente 14 ainda está na carência de 24 h)", ac["contagem"].get("nunca") == 1 and [x["nome"] for x in ac["itens"] if x["grupo"] == "nunca"] == ["Cliente 11"])
    c("ações: 'sumiram' = só o Cliente 13 (o SAIR de 1 h atrás não é uso)", ac["contagem"].get("sumiu") == 1 and [x["nome"] for x in ac["itens"] if x["grupo"] == "sumiu"] == ["Cliente 13"])
    r = d["retencao"]
    c("retenção: sumiram = 1", r["sumiram"] == 1)
    c("retenção: confirmados = 4 (sem a exclusão pedida)", r["confirmados"] == 4)
    h = r["habito"]
    c("retenção: quem usou nos últimos 7 dias = 1 (o Cliente 12; a conta com exclusão pedida e o SAIR não entram)", h["um"] + h["dois_tres"] + h["quatro_cinco"] + h["seis_sete"] == 1)
    seg = {(x["dim"], x["grupo"]): x for x in d["publico"]["segmentos"]}
    beleza = seg.get(("ramo", "beleza"), {})
    c("público: ramo beleza tem 4 pessoas", beleza.get("pessoas") == 4)
    c("público: ativos nos últimos 7 dias = 1 (só o Cliente 12; SAIR e recusa não são uso)", beleza.get("ativos7") == 1)
    c("público: mensagens de uso em 7 dias = 2", beleza.get("msgs7") == 2)
    return f


def montar(sql_mig=None):
    b = Banco(ate=ANTES)
    cenario(b)
    antes = leitura(b) if sql_mig is None else None
    if sql_mig is not None:
        rc, o, e = b.psql(sql_mig)
        assert rc == 0, "migration falhou: " + e[-600:]
    return b, antes


# 1) o erro existe antes
b, antes = montar()
erros_antes = verdades(b, antes)
b.fim()
print("ANTES da migration, falham %d de 13 verificações (os erros existiam):" % len(erros_antes))
for x in erros_antes:
    print("   x", x)
assert len(erros_antes) >= 6

# 2) depois
sql = open(MIG, encoding="utf-8").read()
b, _ = montar(sql)
depois = verdades(b, leitura(b))
print("\nDEPOIS da migration:")
for x in depois:
    print("  FALHA", x)
falhas = len(depois)
print("  " + ("13 de 13 verificações ok" if not falhas else "%d falha(s)" % falhas))
rc, o, e = b.psql(sql)
print("  %s reaplicar a migration não dá erro" % ("ok   " if rc == 0 else "FALHA"))
falhas += rc != 0
for papel in ("anon", "authenticated"):
    rc, o, e = b.psql("set role %s; select * from public.mensagens_de_uso()" % papel)
    print("  %s %s não consegue ler mensagens_de_uso() (traria dado de todos os clientes)" % ("ok   " if rc != 0 else "FALHA", papel))
    falhas += rc == 0
rc, o, e = b.psql("set teste.uid='%s'; set role authenticated; select public.admin_ativacao()" % u(12))
print("  %s cliente comum chamando admin_ativacao() é recusado" % ("ok   " if rc != 0 and "acesso negado" in e else "FALHA"))
falhas += not (rc != 0 and "acesso negado" in e)
b.fim()

# 3) mutações
MUT = [
    ("tudo conta como uso", "select p_status in ('ok', 'pergunta')", "select true"),
    ("SAIR conta como uso", "= 'sair'\n    )", "= 'sairx'\n    )"),
    ("recusa (bloqueada, limite) conta como uso", "select p_status in ('ok', 'pergunta')", "select p_status is not null"),
    ("a confirmação do número conta como uso", "where x.rn > 1 and public.mensagem_conta_como_uso", "where public.mensagem_conta_como_uso"),
    ("ativação conta quem pediu exclusão", "where p.papel = 'cliente' and p.exclusao_em is null\n    ), ps as (", "where p.papel = 'cliente'\n    ), ps as ("),
    ("sem carência de 24 h", "and u.criado_em < agora - interval '1 day' then 'nunca'", "then 'nunca'"),
    ("terminaram sem uso errado", "passo = 7 and primeira is null", "passo = 7"),
    ("público sem a regra de uso", " and public.mensagem_conta_como_uso(m.status, m.texto)) msgs7,", ") msgs7,"),
    ("retenção conta quem pediu exclusão", "join public.perfis p on p.id = mu.user_id and p.papel = 'cliente' and p.exclusao_em is null", "join public.perfis p on p.id = mu.user_id and p.papel = 'cliente'"),
]
pegas = 0
for nome, de, para in MUT:
    if de not in sql:
        print("MUTAÇÃO VAZIA (trecho não encontrado):", nome)
        falhas += 1
        continue
    b, _ = montar(sql.replace(de, para, 1))
    quebrou = verdades(b, leitura(b))
    b.fim()
    print("  %s %s" % ("PEGO  " if quebrou else "PASSOU", nome))
    pegas += bool(quebrou)
    falhas += not quebrou
print("\n%d de %d defeitos pegos | FALHAS: %d" % (pegas, len(MUT), falhas))
sys.exit(1 if falhas else 0)
