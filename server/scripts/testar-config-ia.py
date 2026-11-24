"""Prova a migration 20261124140000_config_ia.sql contra o SCHEMA REAL (todas as migrations, Postgres descartável, fuso UTC):
as três tabelas (modelo para todos, modelo por cliente, chaves de API) ficam FECHADAS ao cliente e ao anônimo (a chave guardada é segredo), só o servidor
(service_role) lê e grava, as regras valem (tarefa conhecida, nome de modelo sem lixo, no máximo UMA chave ativa, apagar o cliente apaga o modelo dele) e reaplicar
não quebra. Depois quebra a migration de 8 jeitos e confere que o teste cai em cada um. Uso: /usr/bin/python3 -I server/scripts/testar-config-ia.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_schema_real import R, Banco  # noqa: E402

MIG = R + "/supabase/migrations/20261124140000_config_ia.sql"
ANTES = "20261124130000_admin_uso_real.sql"
U1 = "00000000-0000-0000-0000-000000000011"
TABELAS = ["config_ia_modelo", "ia_modelo_cliente", "ia_chaves"]


def verdades(b):
    """Devolve os NOMES das verificações que falharam."""
    f = []

    def c(nome, ok):
        if not ok:
            f.append(nome)

    def como(papel, sql):
        return b.psql("set role %s; %s" % (papel, sql))

    b.rodar("insert into auth.users (id, email) values ('%s', 'c@x.com')" % U1)
    for t in TABELAS:
        existe = b.rodar("select to_regclass('public.%s') is not null" % t)
        c("existe a tabela " + t, existe == "t")
        c("RLS ligada em " + t, b.rodar("select relrowsecurity from pg_class where oid = 'public.%s'::regclass" % t) == "t")
        for papel in ("anon", "authenticated"):
            rc, o, e = como(papel, "select count(*) from public.%s" % t)
            c("%s NÃO lê %s" % (papel, t), rc != 0)
            rc, o, e = como(papel, "delete from public.%s" % t)
            c("%s NÃO apaga em %s" % (papel, t), rc != 0)
    for papel in ("anon", "authenticated"):
        rc, o, e = como(papel, "insert into public.config_ia_modelo (tarefa, modelo) values ('interpretacao', 'x1')")
        c("%s NÃO grava modelo para todos" % papel, rc != 0)
        rc, o, e = como(papel, "insert into public.ia_chaves (nome, chave_cifrada, ultimos4) values ('a', 'v1:a:b:c', 'abcd')")
        c("%s NÃO grava chave" % papel, rc != 0)
    # o servidor (service_role) lê e grava as três
    rc, o, e = como("service_role", "insert into public.config_ia_modelo (tarefa, modelo) values ('interpretacao', 'gpt-x.1'); select count(*) from public.config_ia_modelo")
    c("service_role grava e lê o modelo para todos", rc == 0 and o.endswith("1"))
    rc, o, e = como("service_role", "insert into public.ia_modelo_cliente (user_id, tarefa, modelo) values ('%s', 'documento', 'visao-x'); select count(*) from public.ia_modelo_cliente" % U1)
    c("service_role grava e lê o modelo por cliente", rc == 0 and o.endswith("1"))
    rc, o, e = como("service_role", "insert into public.ia_chaves (nome, chave_cifrada, ultimos4) values ('Minha', 'v1:a:b:c', 'abcd'); select ativa from public.ia_chaves")
    c("service_role grava chave e ela nasce DESLIGADA", rc == 0 and o.endswith("f"))
    # regras
    rc, o, e = b.psql("insert into public.config_ia_modelo (tarefa, modelo) values ('hackear', 'x1')")
    c("tarefa desconhecida é recusada", rc != 0)
    for ruim in ("x; drop table a", "../etc", "a b", "", "x"):
        rc, o, e = b.psql("insert into public.config_ia_modelo (tarefa, modelo) values ('ajuda', '%s')" % ruim)
        c("nome de modelo com lixo é recusado: %r" % ruim, rc != 0)
    rc, o, e = b.psql("insert into public.config_ia_modelo (tarefa, modelo) values ('resposta', 'gpt-5.4-mini'), ('audio', 'gpt-4o-mini-transcribe')")
    c("nomes de modelo reais são aceitos", rc == 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4) values ('x', 'v1:a:b:c', 'abc')")
    c("ultimos4 precisa ter 4 caracteres", rc != 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4) values ('', 'v1:a:b:c', 'abcd')")
    c("chave sem nome é recusada", rc != 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, ativa) values ('A', 'v1:a:b:c', 'abcd', true)")
    c("uma chave pode ser ligada", rc == 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, ativa) values ('B', 'v1:a:b:c', 'efgh', true)")
    c("DUAS chaves ligadas ao mesmo tempo são recusadas (só uma por provedor)", rc != 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, provedor) values ('C', 'v1:a:b:c', 'efgh', 'anthropic')")
    c("provedor ainda não suportado é recusado", rc != 0)
    # apagar o cliente apaga o modelo individual dele
    b.rodar("delete from auth.users where id = '%s'" % U1)
    c("apagar o cliente apaga o modelo individual dele", b.rodar("select count(*) from public.ia_modelo_cliente") == "0")
    return f


def montar(sql):
    b = Banco(ate=ANTES)
    rc, o, e = b.psql(sql)
    assert rc == 0, "migration falhou: " + e[-600:]
    return b


sql = open(MIG, encoding="utf-8").read()
falhas = 0

# 1) as verificações valem com a migration de verdade
b = montar(sql)
bad = verdades(b)
print("COM a migration:")
for x in bad:
    print("  FALHA", x)
falhas += len(bad)
print("  " + ("todas as verificações ok" if not bad else "%d falha(s)" % len(bad)))
rc, o, e = b.psql(sql)
print("  %s reaplicar a migration não dá erro" % ("ok   " if rc == 0 else "FALHA"))
falhas += rc != 0
b.fim()

# 2) sem a migration, as verificações caem (prova que o teste enxerga)
b = Banco(ate=ANTES)
try:
    sem = verdades(b)
    enxerga = len(sem) >= 5
except AssertionError:
    sem, enxerga = ["(as tabelas nem existem)"], True  # sem a migration as consultas do teste quebram: ele enxerga a falta
b.fim()
print("SEM a migration, o teste reprova (%d verificações): ele enxerga a falta" % len(sem))
falhas += not enxerga

# 3) mutações
MUT = [
    ("anon e authenticated leem as tabelas", "revoke all on public.%I from anon, authenticated, public", "revoke all on public.%I from public"),
    ("RLS desligada", "execute format('alter table public.%I enable row level security', t);", "null;"),
    ("servidor (service_role) perde o acesso por engano", "grant select, insert, update, delete on public.%I to service_role", "revoke all on public.%I from service_role"),
    ("duas chaves ligadas ao mesmo tempo", "create unique index if not exists ia_chaves_uma_ativa on public.ia_chaves (provedor) where ativa;", ""),
    ("nome de modelo aceita lixo", "check (modelo ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$')", "check (true)"),
    ("tarefa qualquer", "check (tarefa in ('interpretacao', 'documento', 'ajuda', 'resposta', 'audio'))", "check (true)"),
    ("chave nasce ligada", "ativa boolean not null default false", "ativa boolean not null default true"),
    ("apagar o cliente deixa o modelo dele", "user_id uuid not null references auth.users (id) on delete cascade,\n  tarefa text not null check (tarefa in ('interpretacao', 'documento', 'ajuda', 'resposta', 'audio')),\n  modelo text not null check (modelo ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$'),\n  atualizado_por", "user_id uuid not null,\n  tarefa text not null check (tarefa in ('interpretacao', 'documento', 'ajuda', 'resposta', 'audio')),\n  modelo text not null check (modelo ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$'),\n  atualizado_por"),
]
pegas = 0
for nome, de, para in MUT:
    if de not in sql:
        print("MUTAÇÃO VAZIA (trecho não encontrado):", nome)
        falhas += 1
        continue
    mut = sql.replace(de, para, 1)
    b = Banco(ate=ANTES)
    rc, o, e = b.psql(mut)
    if rc != 0:
        print("MUTAÇÃO NÃO COMPILOU:", nome, e[-160:])
        b.fim()
        falhas += 1
        continue
    quebrou = verdades(b)
    b.fim()
    print("  %s %s" % ("PEGO  " if quebrou else "PASSOU", nome))
    pegas += bool(quebrou)
    falhas += not quebrou
print("\n%d de %d defeitos pegos | FALHAS: %d" % (pegas, len(MUT), falhas))
sys.exit(1 if falhas else 0)
