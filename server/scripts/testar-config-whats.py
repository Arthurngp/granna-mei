"""Testa a migration da configuração pelo WhatsApp (20261125020000_config_whats.sql) num Postgres descartável, com prova por mutação.
Confere: as duas colunas nascem vazias sem mexer em linha nenhuma, o cliente marca a origem mas NÃO grava o estado da configuração, só os valores
'site' e 'whats' entram, e rodar de novo é inofensivo.
Uso: /usr/bin/python3 server/scripts/testar-config-whats.py (Postgres do Homebrew; cluster temporário, apagado no fim)."""
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIG = R + "/supabase/migrations/20261125020000_config_whats.sql"
D = tempfile.mkdtemp(prefix="pg-config-whats-")
PORTA = "55443"
PG = "/opt/homebrew/bin/"
U = "00000000-0000-0000-0000-000000000001"

ESQUELETO = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
-- Como no Supabase: o servidor ignora as regras de acesso por linha.
alter role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create table public.perfis (id uuid primary key, nome text, whats text, ramo text, onboarding_passo smallint default 0);
alter table public.perfis enable row level security;
create policy perfil_le on public.perfis for select to authenticated using (id = (select auth.uid()));
create policy perfil_muda on public.perfis for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select on public.perfis to authenticated;
grant update (nome, whats, ramo, onboarding_passo) on public.perfis to authenticated;
grant all on public.perfis to service_role;
insert into public.perfis (id, nome, ramo) values ('%s', 'Ana', 'servicos');
""" % U


def sh(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit("falhou: %s\n%s" % (" ".join(a), r.stderr[-600:]))
    return r


def psql(sql):
    r = subprocess.run([PG + "psql", "-h", "127.0.0.1", "-p", PORTA, "-U", "postgres", "-d", "teste", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def ok(sql):
    rc, o, e = psql(sql)
    assert rc == 0, "preparação falhou: %s -> %s" % (sql[:120], e)
    return o


def como_cliente(sql):
    return psql("set role authenticated; set teste.uid = '%s'; %s" % (U, sql))


falhas = 0


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


def banco(texto):
    subprocess.run([PG + "psql", "-h", "127.0.0.1", "-p", PORTA, "-U", "postgres", "-d", "postgres", "-c", "drop database if exists teste with (force)"], capture_output=True)
    rc = subprocess.run([PG + "psql", "-h", "127.0.0.1", "-p", PORTA, "-U", "postgres", "-d", "postgres", "-c", "create database teste"], capture_output=True, text=True)
    assert rc.returncode == 0, rc.stderr
    ok(ESQUELETO)
    rc, o, e = psql(texto)
    return rc, e


def suite(texto):
    global falhas
    falhas = 0
    linha = ok("select coalesce(onboarding_via, '-') || '|' || coalesce(config_whats::text, '-') || '|' || nome || '|' || ramo from public.perfis")
    confere("as colunas nascem vazias e nenhuma linha muda", linha == "-|-|Ana|servicos", linha)
    rc, _, e = como_cliente("update public.perfis set onboarding_via = 'whats' where id = '%s'" % U)
    confere("o cliente marca a origem (onboarding_via)", rc == 0, e)
    rc, _, e = como_cliente("""update public.perfis set config_whats = '{"etapa":"fim"}' where id = '%s'""" % U)
    confere("o cliente NÃO grava o estado da configuração (config_whats)", rc != 0 and "permission" in e, e)
    rc, _, e = como_cliente("update public.perfis set onboarding_via = 'qualquer' where id = '%s'" % U)
    confere("só 'site' e 'whats' entram", rc != 0 and "perfis_onboarding_via_valido" in e, e)
    rc, o, e = como_cliente("select onboarding_via from public.perfis")
    confere("o cliente lê a própria marca", rc == 0 and o.splitlines()[-1] == "whats", (rc, o, e))
    rc, o, e = psql("set role service_role; update public.perfis set config_whats = '{\"etapa\":\"ramo\"}' returning id")
    confere("o servidor grava o estado", rc == 0 and U in o, (rc, o, e))
    rc, _, e = psql(texto)
    confere("rodar de novo é inofensivo", rc == 0, e)
    est = ok("select config_whats->>'etapa' || '|' || onboarding_via from public.perfis")
    confere("e não apaga o que já estava gravado", est == "ramo|whats", est)
    return falhas


if os.path.isdir(D):
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    sql = open(MIG, encoding="utf-8").read()
    rc, e = banco(sql)
    assert rc == 0, e
    f0 = suite(sql)
    print("\nFALHAS NA MIGRATION: %d" % f0)
    print("\n== provas por mutação ==")
    muts = [
        ("o cliente ganha escrita no estado", ("grant update (onboarding_via) on public.perfis to authenticated;", "grant update (onboarding_via, config_whats) on public.perfis to authenticated;")),
        ("o cliente não consegue marcar a origem", ("grant update (onboarding_via) on public.perfis to authenticated;", "")),
        ("qualquer valor entra na origem", ("check (onboarding_via is null or onboarding_via in ('site', 'whats'))", "check (true)")),
        ("não é idempotente", ("alter table public.perfis add column if not exists config_whats jsonb;", "alter table public.perfis add column config_whats jsonb;")),
        ("a coluna nasce com valor", ("alter table public.perfis add column if not exists onboarding_via text;", "alter table public.perfis add column if not exists onboarding_via text default 'site';")),
    ]
    pegos = 0
    import io, contextlib
    for desc, (de, para) in muts:
        assert sql.count(de) == 1, desc
        texto = sql.replace(de, para)
        rc, e = banco(texto)
        if rc != 0:
            print("MUTAÇÃO INVÁLIDA: " + desc + " -> " + e[:120])
            continue
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            f = suite(texto)
        pegos += f > 0
        print(("PEGO     " if f else "NÃO PEGO ") + desc)
    print("%d de %d defeitos pegos" % (pegos, len(muts)))
    sys.exit(1 if (f0 or pegos != len(muts)) else 0)
finally:
    sh(PG + "pg_ctl", "-D", D, "-m", "immediate", "stop", check=False)
    shutil.rmtree(D, ignore_errors=True)
