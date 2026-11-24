"""Prova a migration 20261124150000_ia_chaves_anthropic.sql contra o SCHEMA REAL: a tabela de chaves passa a aceitar o provedor 'anthropic' (e continua recusando
qualquer outro), a OpenAI e a Anthropic podem estar ligadas ao mesmo tempo (uma ativa POR provedor), duas ativas do mesmo provedor continuam recusadas, o que já
existia (chave da OpenAI) segue valendo, a tabela continua fechada a cliente e anônimo, e reaplicar não quebra. Depois quebra a migration de 4 jeitos e confere
que o teste cai em cada um. Uso: /usr/bin/python3 -I server/scripts/testar-config-ia-anthropic.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_schema_real import R, Banco  # noqa: E402

MIG = R + "/supabase/migrations/20261124150000_ia_chaves_anthropic.sql"
ANTES = "20261124140000_config_ia.sql"


def verdades(b):
    f = []

    def c(nome, ok):
        if not ok:
            f.append(nome)

    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, provedor) values ('Velha', 'v1:a:b:c', 'abcd', 'openai')")
    c("a chave da OpenAI continua aceita", rc == 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4) values ('Padrão', 'v1:a:b:c', 'abcd')")
    c("sem informar o provedor continua valendo openai", rc == 0 and b.rodar("select provedor from public.ia_chaves where nome='Padrão'") == "openai")
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, provedor) values ('Claude', 'v1:a:b:c', 'efgh', 'anthropic')")
    c("a chave da Anthropic é aceita", rc == 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, provedor) values ('Gemini', 'v1:a:b:c', 'efgh', 'gemini')")
    c("provedor desconhecido continua recusado", rc != 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, provedor) values ('X', 'v1:a:b:c', 'efgh', 'OpenAI')")
    c("o provedor é case-sensitive (não aceita variação)", rc != 0)
    rc, o, e = b.psql("update public.ia_chaves set ativa = true where nome = 'Velha'; update public.ia_chaves set ativa = true where nome = 'Claude'")
    c("OpenAI e Anthropic podem estar ligadas ao mesmo tempo", rc == 0 and b.rodar("select count(*) from public.ia_chaves where ativa") == "2")
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, provedor, ativa) values ('Claude 2', 'v1:a:b:c', 'ijkl', 'anthropic', true)")
    c("DUAS ativas da Anthropic são recusadas", rc != 0)
    rc, o, e = b.psql("insert into public.ia_chaves (nome, chave_cifrada, ultimos4, provedor, ativa) values ('OpenAI 2', 'v1:a:b:c', 'ijkl', 'openai', true)")
    c("DUAS ativas da OpenAI continuam recusadas", rc != 0)
    for papel in ("anon", "authenticated"):
        rc, o, e = b.psql("set role %s; select count(*) from public.ia_chaves" % papel)
        c("%s NÃO lê as chaves" % papel, rc != 0)
    return f


def montar(sql):
    b = Banco(ate=ANTES)
    rc, o, e = b.psql(sql)
    assert rc == 0, "migration falhou: " + e[-600:]
    return b


sql = open(MIG, encoding="utf-8").read()
falhas = 0
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

b = Banco(ate=ANTES)
sem = verdades(b)
b.fim()
enxerga = "a chave da Anthropic é aceita" in sem
print("SEM a migration, o teste reprova (%d verificações), inclusive 'a chave da Anthropic é aceita': %s" % (len(sem), "enxerga a falta" if enxerga else "NÃO ENXERGA"))
falhas += not enxerga

MUT = [
    ("continua só openai", "check (provedor in ('openai', 'anthropic'))", "check (provedor in ('openai'))"),
    ("qualquer provedor aceito", "check (provedor in ('openai', 'anthropic'))", "check (true)"),
    ("tira a OpenAI da lista", "check (provedor in ('openai', 'anthropic'))", "check (provedor in ('anthropic'))"),
    ("só uma ativa no total (índice global)", "drop constraint if exists ia_chaves_provedor_check;", "drop constraint if exists ia_chaves_provedor_check;\ndrop index if exists public.ia_chaves_uma_ativa;\ncreate unique index ia_chaves_uma_ativa on public.ia_chaves ((true)) where ativa;"),
    ("sem nenhum limite de ativas", "drop constraint if exists ia_chaves_provedor_check;", "drop constraint if exists ia_chaves_provedor_check;\ndrop index if exists public.ia_chaves_uma_ativa;"),
]
pegas = 0
for nome, de, para in MUT:
    if de not in sql:
        print("MUTAÇÃO VAZIA:", nome)
        falhas += 1
        continue
    b = Banco(ate=ANTES)
    rc, o, e = b.psql(sql.replace(de, para, 1))
    if rc != 0:
        print("MUTAÇÃO NÃO COMPILOU:", nome, e[-160:])
        b.fim()
        falhas += 1
        continue
    q = verdades(b)
    b.fim()
    print("  %s %s" % ("PEGO  " if q else "PASSOU", nome))
    pegas += bool(q)
    falhas += not q
print("\n%d de %d defeitos pegos | FALHAS: %d" % (pegas, len(MUT), falhas))
sys.exit(1 if falhas else 0)
