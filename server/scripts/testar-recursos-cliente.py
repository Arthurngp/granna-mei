"""Prova a migration 20261123030000_recursos_cliente.sql num Postgres descartável: a tabela é fechada ao cliente, só o admin libera ou retira,
só para papel cliente, com motivo e auditoria de antes e depois, recurso desconhecido não grava, e reaplicar não quebra. Depois quebra a
migration de 6 jeitos (mutações) e confere que o teste cai em cada um. Uso: /usr/bin/python3 server/scripts/testar-recursos-cliente.py
Usa o Postgres do Homebrew; cria um cluster temporário fora do repositório (porta 55438) e o apaga no fim."""
import os
import re
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIG = R + "/supabase/migrations/20261123030000_recursos_cliente.sql"
D = tempfile.mkdtemp(prefix="pg-recursos-")
PORTA = "55438"
PG = "/opt/homebrew/bin/"
ADM = "00000000-0000-0000-0000-0000000000aa"
CLI = "00000000-0000-0000-0000-000000000001"
OUTRO_ADM = "00000000-0000-0000-0000-0000000000ab"


def sh(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit("falhou: %s\n%s" % (" ".join(a), r.stderr[-600:]))
    return r


def psql(sql, db="teste"):
    r = subprocess.run([PG + "psql", "-h", "127.0.0.1", "-p", PORTA, "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


ESQUELETO = """
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create function public.eh_admin() returns boolean language sql stable as $$ select coalesce(current_setting('teste.admin', true), 'f') = 't' $$;
create table public.perfis (id uuid primary key references auth.users (id), papel text not null default 'cliente');
create table public.admin_auditoria (id bigint generated always as identity primary key, admin_id uuid, acao text not null, alvo_user_id uuid, detalhes jsonb not null default '{}'::jsonb, criado_em timestamptz not null default now());
insert into auth.users values ('%s'), ('%s'), ('%s');
insert into public.perfis values ('%s', 'cliente'), ('%s', 'admin'), ('%s', 'admin');
grant usage on schema public, auth to anon, authenticated, service_role;
-- O Supabase concede tudo nas tabelas novas do schema public a estes papéis: o teste reproduz isso, e a migration tem de fechar.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
""" % (CLI, ADM, OUTRO_ADM, CLI, ADM, OUTRO_ADM)


def banco_novo(nome):
    assert psql("drop database if exists %s" % nome, db="postgres")[0] == 0
    assert psql("create database %s" % nome, db="postgres")[0] == 0
    rc, o, e = psql(ESQUELETO, db=nome)
    assert rc == 0, "preparação do banco falhou: " + e


def como(db, papel, admin, sql, uid=ADM):
    """Roda o SQL como o papel dado (anon, authenticated, service_role), com ou sem eh_admin()."""
    return psql("set teste.admin='%s'; set teste.uid='%s'; set role %s; %s" % ("t" if admin else "f", uid, papel, sql), db=db)


falhas = 0


def confere(nome, ok, det=""):
    global falhas
    print(("  ok    " if ok else "  FALHA ") + nome + ("" if ok else "  -> " + det))
    if not ok:
        falhas += 1


def bateria(db, sql_mig):
    """Roda todas as verificações contra um banco com a migration indicada. Devolve os nomes das que FALHARAM."""
    quebrou = []

    def c(nome, ok):
        if not ok:
            quebrou.append(nome)

    banco_novo(db)
    rc, o, e = psql(sql_mig, db=db)
    c("a migration aplica sem erro", rc == 0)
    if rc != 0:
        return quebrou

    # --- a tabela é fechada ao cliente ---
    c("anon não lê a tabela", como(db, "anon", False, "select count(*) from public.recursos_cliente")[0] != 0)
    c("cliente logado não lê a tabela", como(db, "authenticated", False, "select count(*) from public.recursos_cliente")[0] != 0)
    c("cliente logado não grava a tabela (não se auto-libera)", como(db, "authenticated", False, "insert into public.recursos_cliente (user_id, recurso, motivo) values ('%s', 'resumo_diario_contas', 'eu mesmo')" % CLI)[0] != 0)
    c("o serviço (service_role) lê a tabela", como(db, "service_role", False, "select count(*) from public.recursos_cliente")[0] == 0)
    c("recurso desconhecido não grava nem pelo serviço", como(db, "service_role", False, "insert into public.recursos_cliente (user_id, recurso, motivo) values ('%s', 'recurso_que_nao_existe', 'teste')" % CLI)[0] != 0)

    # --- as funções ---
    c("anon não executa as funções", como(db, "anon", True, "select public.admin_recursos_cliente('%s')" % CLI)[0] != 0 and como(db, "anon", True, "select public.admin_recurso_definir('%s','resumo_diario_contas',true,'teste')" % CLI)[0] != 0)
    c("quem não é admin não libera", como(db, "authenticated", False, "select public.admin_recurso_definir('%s','resumo_diario_contas',true,'tentando')" % CLI)[0] != 0)
    c("quem não é admin não lê o que o cliente tem", como(db, "authenticated", False, "select public.admin_recursos_cliente('%s')" % CLI)[0] != 0)
    c("depois da tentativa de quem não é admin, o cliente segue sem recurso", psql("select count(*) from public.recursos_cliente", db=db)[1] == "0")

    c("admin libera o recurso de um cliente", como(db, "authenticated", True, "select public.admin_recurso_definir('%s','resumo_diario_contas',true,'plano superior combinado')" % CLI)[0] == 0)
    c("a linha existe, com motivo e quem liberou", psql("select count(*) from public.recursos_cliente where user_id = '%s' and recurso = 'resumo_diario_contas' and motivo = 'plano superior combinado' and concedido_por = '%s'" % (CLI, ADM), db=db)[1] == "1")
    c("a auditoria guarda o antes e o depois", psql("select count(*) from public.admin_auditoria where acao = 'recurso_cliente' and alvo_user_id = '%s' and detalhes->>'antes' = 'não liberado' and detalhes->>'depois' = 'liberado' and detalhes->>'recurso' = 'resumo_diario_contas' and admin_id = '%s'" % (CLI, ADM), db=db)[1] == "1")
    c("o admin lê o que o cliente tem", "resumo_diario_contas" in como(db, "authenticated", True, "select public.admin_recursos_cliente('%s')" % CLI)[1])
    c("liberar de novo não duplica nem troca a data, mas entra na auditoria", como(db, "authenticated", True, "select public.admin_recurso_definir('%s','resumo_diario_contas',true,'de novo')" % CLI)[0] == 0
      and psql("select count(*) from public.recursos_cliente", db=db)[1] == "1"
      and psql("select count(*) from public.admin_auditoria where acao = 'recurso_cliente'", db=db)[1] == "2")

    # --- validações ---
    c("motivo curto é recusado", como(db, "authenticated", True, "select public.admin_recurso_definir('%s','resumo_diario_contas',true,'ab')" % CLI)[0] != 0)
    c("recurso desconhecido é recusado", como(db, "authenticated", True, "select public.admin_recurso_definir('%s','outro',true,'teste ok')" % CLI)[0] != 0)
    c("liberar para conta de admin é recusado (só papel cliente)", como(db, "authenticated", True, "select public.admin_recurso_definir('%s','resumo_diario_contas',true,'teste ok')" % OUTRO_ADM)[0] != 0)
    c("liberar para quem não existe é recusado", como(db, "authenticated", True, "select public.admin_recurso_definir('00000000-0000-0000-0000-00000000dead','resumo_diario_contas',true,'teste ok')")[0] != 0)
    c("ativo nulo é recusado", como(db, "authenticated", True, "select public.admin_recurso_definir('%s','resumo_diario_contas',null,'teste ok')" % CLI)[0] != 0)

    # --- retirar ---
    c("admin retira o recurso", como(db, "authenticated", True, "select public.admin_recurso_definir('%s','resumo_diario_contas',false,'cliente saiu do plano')" % CLI)[0] == 0)
    c("depois de retirar, a linha some", psql("select count(*) from public.recursos_cliente", db=db)[1] == "0")
    c("a auditoria da retirada guarda liberado para não liberado", psql("select count(*) from public.admin_auditoria where acao = 'recurso_cliente' and detalhes->>'antes' = 'liberado' and detalhes->>'depois' = 'não liberado'", db=db)[1] == "1")

    # --- idempotência da migration ---
    rc2, _, e2 = psql(sql_mig, db=db)
    c("reaplicar a migration não quebra", rc2 == 0)
    return quebrou


if os.path.isdir(D):
    sh(PG + "pg_ctl", "-D", D, "stop", "-m", "immediate", check=False)
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    # Os papéis são do cluster inteiro (não de um banco): criados uma vez, antes de tudo.
    psql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; "
         "if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; "
         "if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; end $$", db="postgres")
    original = open(MIG, encoding="utf-8").read()

    print("== a migration de verdade ==")
    q = bateria("t_real", original)
    confere("todas as verificações passam com a migration real (%d falharam: %s)" % (len(q), q), not q, str(q))

    print("\n== mutações: cada uma tem que derrubar pelo menos uma verificação ==")
    mutacoes = {
        "sem o revoke da tabela (o cliente leria e se auto-liberaria)": original.replace("revoke all on public.recursos_cliente from anon, authenticated;", ""),
        "a função de liberar não confere eh_admin": original.replace(
            "create or replace function public.admin_recurso_definir(p_user uuid, p_recurso text, p_ativo boolean, p_motivo text) returns jsonb\nlanguage plpgsql security definer set search_path = ''\nas $$\ndeclare tinha boolean;\nbegin\n  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;",
            "create or replace function public.admin_recurso_definir(p_user uuid, p_recurso text, p_ativo boolean, p_motivo text) returns jsonb\nlanguage plpgsql security definer set search_path = ''\nas $$\ndeclare tinha boolean;\nbegin"),
        # Tira o insert INTEIRO da auditoria (várias linhas): a migration continua válida, só deixa de auditar.
        "não grava a auditoria": re.sub(r"insert into public\.admin_auditoria.*?end\)\);", "null;", original, count=1, flags=re.S),
        "libera também para conta de admin": original.replace("p.id = p_user and p.papel = 'cliente'", "p.id = p_user"),
        "a tabela aceita qualquer recurso": original.replace("check (recurso in ('resumo_diario_contas'))", ""),
        "as funções ficam abertas ao anon (sem o revoke)": original.replace("revoke all on function public.admin_recurso_definir(uuid, text, boolean, text) from public, anon;", "grant execute on function public.admin_recurso_definir(uuid, text, boolean, text) to anon;"),
    }
    for i, (nome, sql) in enumerate(mutacoes.items()):
        if sql == original:
            confere("mutação '%s' foi aplicada de fato (texto mudou)" % nome, False, "o texto da migration não mudou: a mutação ficou vazia")
            continue
        q = bateria("t_mut%d" % i, sql)
        confere("mutação '%s' derruba o teste (%d verificações caíram)" % (nome, len(q)), len(q) > 0, "o teste passou com a migration quebrada")
finally:
    sh(PG + "pg_ctl", "-D", D, "-m", "immediate", "stop", check=False)
    shutil.rmtree(D, ignore_errors=True)

print("\nfalhas:", falhas)
sys.exit(1 if falhas else 0)
