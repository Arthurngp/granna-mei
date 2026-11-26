"""Prova a migration 20261126030000_seguranca_exclusao_codigo.sql contra o SCHEMA REAL (todas as migrations em Postgres descartável):
o cliente não antecipa a exclusão (vira hoje + 30 dias), cancelar continua livre, o servidor grava o que precisar, e o código de confirmação
tem 6 dígitos e vem do gerador forte.
Uso: /usr/bin/python3 -I server/scripts/testar-seguranca-exclusao.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_schema_real import Banco  # noqa: E402

CLI = "00000000-0000-0000-0000-000000000001"
SEM = "00000000-0000-0000-0000-000000000002"
falhas = []


def c(nome, ok, extra=""):
    print(("  ok    " if ok else "  FALHA ") + nome + (f"  ({extra})" if extra and not ok else ""))
    if not ok:
        falhas.append(nome)


def como_cliente(uid, sql):
    return f"begin; set local role authenticated; select set_config('teste.uid', '{uid}', true); select set_config('teste.role', 'authenticated', true); {sql}; commit;"


b = Banco()
try:
    b.rodar("insert into auth.users (id, email) values ('%s', 'c@x.com'), ('%s', 's@x.com')" % (CLI, SEM))
    b.rodar("update public.perfis set whats = '(81) 98765-4321' where id = '%s'" % CLI)
    alvo = b.rodar("select ((now() at time zone 'America/Sao_Paulo')::date + 30)::text").strip()

    b.rodar(como_cliente(CLI, "update public.perfis set exclusao_em = '2000-01-01' where id = auth.uid()"))
    v = b.rodar("select exclusao_em::text from public.perfis where id = '%s'" % CLI).strip()
    c("cliente que tenta apagar já (2000-01-01) fica com hoje + 30", v == alvo, v)

    b.rodar(como_cliente(CLI, "update public.perfis set exclusao_em = null where id = auth.uid()"))
    v = b.rodar("select coalesce(exclusao_em::text, 'nulo') from public.perfis where id = '%s'" % CLI).strip()
    c("cliente cancela a exclusão", v == "nulo", v)

    b.rodar("begin; select set_config('teste.role', 'service_role', true); update public.perfis set exclusao_em = '2026-01-02' where id = '%s'; commit;" % CLI)
    v = b.rodar("select exclusao_em::text from public.perfis where id = '%s'" % CLI).strip()
    c("servidor (service_role) grava a data que precisar", v == "2026-01-02", v)

    b.rodar(como_cliente(CLI, "update public.perfis set nome = 'Outro' where id = auth.uid()"))
    v = b.rodar("select exclusao_em::text from public.perfis where id = '%s'" % CLI).strip()
    c("salvar o perfil sem mexer na data não muda a data", v == "2026-01-02", v)

    out = b.rodar(como_cliente(SEM, "select public.gerar_codigo_whats()"))
    c("conta sem número também gera código (cadastro sem digitar o número)", any(x.strip().isdigit() and len(x.strip()) == 6 for x in out.split("\n")), out[:80])
    v = b.rodar("select pg_get_functiondef('public.gerar_codigo_whats'::regproc)")
    c("código vem do gerador forte, não de random()", "gen_random_uuid" in v and "random()" not in v)

    out = b.rodar(como_cliente(CLI, "select public.gerar_codigo_whats()"))
    cod = [x.strip() for x in out.split("\n") if x.strip().isdigit() and len(x.strip()) == 6]
    c("conta com número gera código de 6 dígitos", len(cod) == 1, out[:80])
    v = b.rodar("select codigo from public.verificacoes where user_id = '%s'" % CLI).strip()
    c("o código fica gravado para conferir", bool(cod) and v == cod[0], v)
finally:
    b.fim()

print("\n%d falha(s)" % len(falhas) if falhas else "\nexclusão e código: tudo ok")
sys.exit(1 if falhas else 0)
