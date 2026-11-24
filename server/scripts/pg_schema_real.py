"""Ajudante dos testes do admin: sobe um Postgres descartável (Homebrew) e aplica TODAS as migrations reais em ordem, sobre um esqueleto mínimo do
Supabase (auth, storage e papéis). Assim cada função do admin é testada contra o schema de verdade, não contra uma cópia manual.
Uso: from pg_schema_real import Banco; b = Banco(); b.sql("..."); b.fim()"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PG = "/opt/homebrew/bin/"

ESQUELETO = """
-- A produção roda em UTC (confirmado em 24/11). Sem isto o cluster herda o fuso do Mac (São Paulo) e esconde os erros de fuso.
alter database postgres set timezone to 'UTC';
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; -- como no Supabase: o service_role passa pela RLS
end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('teste.role', true), ''), 'authenticated') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal', 'aal2') $$;
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(n text) returns text[] language sql immutable as $$ select string_to_array(n, '/') $$;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
"""


class Banco:
    def __init__(self, porta=None, ate=None):
        import socket
        if porta is None:
            with socket.socket() as sk:
                sk.bind(("127.0.0.1", 0))
                porta = str(sk.getsockname()[1])
        self.porta = porta
        self.d = tempfile.mkdtemp(prefix="pg-real-")
        self._sh(PG + "initdb", "-D", self.d, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
        self._sh(PG + "pg_ctl", "-D", self.d, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (porta, self.d), "-l", self.d + "/log.txt", "-w", "start")
        self.rodar(ESQUELETO, db="postgres")
        for m in sorted(glob.glob(R + "/supabase/migrations/*.sql")):
            if ate and os.path.basename(m) > ate:
                break
            rc, o, e = self.psql(open(m, encoding="utf-8").read())
            if rc != 0:
                self.fim()
                sys.exit("migration %s falhou ao montar o schema real:\n%s" % (os.path.basename(m), e[-900:]))

    def _sh(self, *a):
        r = subprocess.run(a, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit("falhou: %s\n%s" % (" ".join(a), r.stderr[-600:]))

    def psql(self, sql, db="postgres"):
        r = subprocess.run([PG + "psql", "-h", "127.0.0.1", "-p", self.porta, "-U", "postgres", "-d", db, "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()

    def rodar(self, sql, db="postgres"):
        rc, o, e = self.psql(sql, db)
        assert rc == 0, "SQL falhou: %s\n%s" % (sql[:160], e[-600:])
        return o

    def admin(self, sql, uid="00000000-0000-0000-0000-0000000000aa"):
        """Roda como um admin logado (papel authenticated, auth.uid() = o admin)."""
        return self.rodar("set teste.uid='%s'; set role authenticated; %s" % (uid, sql))

    def fim(self):
        subprocess.run([PG + "pg_ctl", "-D", self.d, "-m", "immediate", "stop"], capture_output=True)
        shutil.rmtree(self.d, ignore_errors=True)
