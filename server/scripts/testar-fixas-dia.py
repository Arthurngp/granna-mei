"""Prova a migration 20261123020000_fixas_dia_ate_31.sql num Postgres descartável: antes dela o dia 29 a 31 é recusado, depois é aceito e
o 32 e o 0 seguem recusados, as linhas existentes ficam intactas, reaplicar não quebra, e quatro quebras de propósito (mutações) precisam
derrubar o teste. Uso: /usr/bin/python3 server/scripts/testar-fixas-dia.py
Usa o Postgres do Homebrew; cria um cluster temporário fora do repositório (porta 55437) e o apaga no fim."""
import os
import re
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = R + "/supabase/migrations/20261115120000_base.sql"
MIG = R + "/supabase/migrations/20261123020000_fixas_dia_ate_31.sql"
D = tempfile.mkdtemp(prefix="pg-fixas-dia-")
PORTA = "55437"
PG = "/opt/homebrew/bin/"
UID = "00000000-0000-0000-0000-000000000001"


def sh(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit("falhou: %s\n%s" % (" ".join(a), r.stderr[-600:]))
    return r


def psql(sql, db="teste"):
    r = subprocess.run([PG + "psql", "-h", "127.0.0.1", "-p", PORTA, "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def tabela_fixas_da_base():
    """A definição REAL da tabela, copiada da migration base (não reescrita aqui), para o teste não provar outra coisa."""
    t = open(BASE, encoding="utf-8").read()
    m = re.search(r"create table public\.fixas \(.*?\n\);", t, flags=re.S)
    assert m, "não achei create table public.fixas na migration base"
    assert "dia between 1 and 28" in m.group(0), "a base não tem mais o limite de 28: este teste ficou sem sentido"
    return m.group(0)


def banco_novo(nome):
    assert psql("drop database if exists %s" % nome, db="postgres")[0] == 0
    assert psql("create database %s" % nome, db="postgres")[0] == 0
    rc, o, e = psql(
        "create schema auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$; "
        "insert into auth.users values ('%s'); " % UID + tabela_fixas_da_base(), db=nome)
    assert rc == 0, "preparação do banco falhou: " + e


def insere(db, n, dia):
    return psql("insert into public.fixas (user_id, id, descricao, valor, dia) values ('%s', 'f%s', 'Aluguel', 900, %s)" % (UID, n, dia), db=db)


falhas = 0


def confere(nome, ok, det=""):
    global falhas
    print(("  ok    " if ok else "  FALHA ") + nome + ("" if ok else "  -> " + det))
    if not ok:
        falhas += 1


def bateria(db, sql_mig, rotulo):
    """Roda a sequência inteira contra um banco com a migration indicada. Devolve a lista de nomes que FALHARAM."""
    quebrou = []

    def c(nome, ok):
        if not ok:
            quebrou.append(nome)

    banco_novo(db)
    c("antes: dia 28 aceito", insere(db, "a28", 28)[0] == 0)
    c("antes: dia 30 recusado (o defeito)", insere(db, "a30", 30)[0] != 0)
    c("antes: dia 31 recusado (o defeito)", insere(db, "a31", 31)[0] != 0)
    rc, o, e = psql(sql_mig, db=db)
    c("a migration aplica sem erro", rc == 0)
    c("depois: dia 29 aceito", insere(db, "d29", 29)[0] == 0)
    c("depois: dia 30 aceito", insere(db, "d30", 30)[0] == 0)
    c("depois: dia 31 aceito", insere(db, "d31", 31)[0] == 0)
    c("depois: dia 32 recusado", insere(db, "d32", 32)[0] != 0)
    c("depois: dia 0 recusado", insere(db, "d0", 0)[0] != 0)
    c("depois: dia nulo recusado", psql("insert into public.fixas (user_id, id, descricao, valor, dia) values ('%s', 'dn', 'X', 1, null)" % UID, db=db)[0] != 0)
    c("a linha que já existia com dia 28 ficou igual", psql("select count(*) from public.fixas where id = 'fa28' and dia = 28 and valor = 900", db=db)[1] == "1")
    c("ficou UMA regra só na coluna dia (a velha saiu)", psql("select count(*) from pg_constraint where conrelid = 'public.fixas'::regclass and contype = 'c' and conkey = array[(select attnum from pg_attribute where attrelid = 'public.fixas'::regclass and attname = 'dia')]", db=db)[1] == "1")
    rc2, _, e2 = psql(sql_mig, db=db)
    c("reaplicar não quebra (idempotente)", rc2 == 0)
    c("depois de reaplicar: dia 31 segue aceito e 32 recusado", insere(db, "r31", 31)[0] == 0 and insere(db, "r32", 32)[0] != 0)
    return quebrou


# ---------- cluster temporário ----------
if os.path.isdir(D):
    sh(PG + "pg_ctl", "-D", D, "stop", "-m", "immediate", check=False)
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    psql("create database postgres_ok", db="postgres")
    original = open(MIG, encoding="utf-8").read()

    print("== a migration de verdade ==")
    q = bateria("t_real", original, "real")
    confere("todas as verificações passam com a migration real (%d falharam: %s)" % (len(q), q), not q, str(q))

    print("\n== mutações: cada uma tem que derrubar pelo menos uma verificação ==")
    mutacoes = {
        "não remove a regra velha de 28": original.replace("execute format('alter table public.fixas drop constraint %I', c.conname);", "null;"),
        "o novo limite é 30, não 31": original.replace("between 1 and 31", "between 1 and 30"),
        "o novo limite é 32, deixa passar o 32": original.replace("between 1 and 31", "between 1 and 32"),
        "remove a regra velha e não põe nenhuma": original.replace("alter table public.fixas add constraint fixas_dia_check check (dia between 1 and 31);", "null;"),
    }
    for i, (nome, sql) in enumerate(mutacoes.items()):
        if sql == original:
            confere("mutação '%s' foi aplicada de fato (texto mudou)" % nome, False, "o texto da migration não mudou: a mutação ficou vazia")
            continue
        q = bateria("t_mut%d" % i, sql, nome)
        confere("mutação '%s' derruba o teste (%d verificações caíram)" % (nome, len(q)), len(q) > 0, "o teste passou com a migration quebrada")
finally:
    sh(PG + "pg_ctl", "-D", D, "stop", "-m", "immediate", check=False)
    shutil.rmtree(D, ignore_errors=True)

print("\nfalhas:", falhas)
sys.exit(1 if falhas else 0)
