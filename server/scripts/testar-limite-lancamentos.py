"""Testa a migration do limite mensal de lançamentos (tabelas fechadas, funções do admin) num Postgres descartável e prova por mutação
(quebra a migration de propósito e confere que o teste cai). Uso: /usr/bin/python3 server/scripts/testar-limite-lancamentos.py
Usa o Postgres do Homebrew; cria um cluster temporário e o apaga no fim."""
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIG = R + "/supabase/migrations/20261121200000_limite_lancamentos.sql"
D = tempfile.mkdtemp(prefix="pg-limite-")
PORTA = "55433"
PG = "/opt/homebrew/bin/"
ADM = "00000000-0000-0000-0000-0000000000aa"


def uuid(n):
    return "00000000-0000-0000-0000-%012d" % n


def sh(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit("falhou: %s\n%s" % (" ".join(a), r.stderr[-600:]))
    return r


def psql(sql, db="teste"):
    r = subprocess.run([PG + "psql", "-h", "127.0.0.1", "-p", PORTA, "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def ok(sql):
    rc, o, e = psql(sql)
    assert rc == 0, "preparação falhou: %s -> %s" % (sql[:120], e)
    return o


ESQUELETO = """
create role anon nologin; create role authenticated nologin;
-- Como no Supabase: tabela nova nasce com permissão para anon e authenticated (por isso a migration tem que revogar).
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create function public.eh_admin() returns boolean language sql stable as $$ select coalesce(current_setting('teste.admin', true), 'f') = 't' $$;
create table public.perfis (id uuid primary key references auth.users (id), papel text not null);
create table public.mensagens (id bigint generated always as identity primary key, user_id uuid not null, status text not null, criado_em timestamptz not null default now());
create table public.admin_auditoria (id bigint generated always as identity primary key, admin_id uuid not null references auth.users (id), acao text not null,
  alvo_user_id uuid references auth.users (id) on delete set null, detalhes jsonb not null default '{}'::jsonb, criado_em timestamptz not null default now());
"""

INICIO_MES = "(date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')"


def monta():
    """Zera o banco de teste: usuários, mensagens e o estado da migration. 1 a 4 são clientes, 99 é o admin."""
    ok("""truncate public.mensagens, public.admin_auditoria; delete from public.perfis; delete from auth.users;""")
    for n in (1, 2, 3, 4):
        ok("insert into auth.users (id) values ('%s'); insert into public.perfis (id, papel) values ('%s', 'cliente')" % (uuid(n), uuid(n)))
    ok("insert into auth.users (id) values ('%s'); insert into public.perfis (id, papel) values ('%s', 'admin')" % (ADM, ADM))
    ok("delete from public.limite_cliente; update public.config_limite set lancamentos = 300")

    def msgs(user, n, status="ok", quando="now()"):
        for _ in range(n):
            ok("insert into public.mensagens (user_id, status, criado_em) values ('%s', '%s', %s)" % (uuid(user), status, quando))

    msgs(1, 5)  # uso do cliente 1: 5 neste mês
    msgs(1, 2, "erro")  # erro, bloqueada e afins não contam
    msgs(1, 1, "ok", INICIO_MES + " - interval '30 minutes'")  # 30 min antes do dia 1 (SP): mês passado, não conta
    msgs(1, 1, "ok", INICIO_MES + " + interval '30 minutes'")  # 30 min depois do dia 1 (SP): conta
    msgs(2, 3)
    msgs(4, 8)


def chama(sql, admin=True):
    return psql("set teste.admin='%s'; set teste.uid='%s'; %s" % ("t" if admin else "f", ADM, sql))


def json_de(rc_o_e):
    import json
    rc, o, e = rc_o_e
    assert rc == 0, e
    return json.loads(o.splitlines()[-1])


falhas = 0
EM_TESTE = [""]  # o texto da migration que está sendo testado agora (o original, ou uma versão quebrada de propósito)


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


def suite():
    global falhas
    falhas = 0
    monta()
    cli = lambda u: json_de(chama("select public.admin_limite_cliente('%s')" % uuid(u)))
    definir = lambda u, v, m="teste de limite": chama("select public.admin_limite_definir(%s, %s, '%s')" % ("null" if u is None else "'%s'" % uuid(u), "null" if v is None else v, m))
    audit = lambda acao: psql("select string_agg((detalhes->>'antes') || '>' || (detalhes->>'depois') || '|' || coalesce(alvo_user_id::text, 'todos'), ' ; ' order by id) from public.admin_auditoria where acao='%s'" % acao)[1]

    # leitura
    c = cli(1)
    confere("padrão de fábrica 300, sem limite próprio, efetivo 300", c["padrao"] == 300 and c["proprio"] is None and c["efetivo"] == 300, c)
    confere("uso do mês: só mensagens ok deste mês (5 + 1 logo depois do dia 1; erro e mês passado ficam de fora)", c["uso_mes"] == 6, c)

    # padrão de todos
    r = json_de(definir(None, 500, "subiu para todos"))
    confere("mudar o padrão: devolve o novo valor", r["padrao"] == 500 and r["efetivo"] == 500, r)
    confere("mudar o padrão: um cliente sem limite próprio passa a ter 500", cli(2)["efetivo"] == 500)
    confere("auditoria do padrão: antes 300, depois 500, sem cliente alvo", audit("limite_global") == "300>500|todos", audit("limite_global"))

    # limite próprio
    r = json_de(definir(1, 50, "plano reduzido"))
    confere("limite próprio vence o padrão", r["proprio"] == 50 and r["efetivo"] == 50 and cli(1)["efetivo"] == 50 and cli(2)["efetivo"] == 500, r)
    confere("limite próprio não mexe no padrão dos outros", cli(2)["padrao"] == 500 and cli(2)["proprio"] is None)
    json_de(definir(1, 80, "voltou um pouco"))
    confere("auditoria do cliente guarda o antes de cada mudança", audit("limite_cliente") == "padrão>50|%s ; 50>80|%s" % (uuid(1), uuid(1)), audit("limite_cliente"))
    json_de(definir(None, 700, "subiu de novo"))
    confere("mudar o padrão não derruba quem tem limite próprio", cli(1)["efetivo"] == 80 and cli(3)["efetivo"] == 700)

    # remover o limite próprio
    r = json_de(definir(1, None, "voltou ao padrão"))
    confere("remover o limite próprio: volta a seguir o padrão", r["proprio"] is None and r["efetivo"] == 700 and cli(1)["efetivo"] == 700, r)
    confere("remover apaga a linha de verdade", ok("select count(*) from public.limite_cliente where user_id='%s'" % uuid(1)) == "0")
    confere("auditoria registra a volta ao padrão", audit("limite_cliente").endswith("80>padrão|%s" % uuid(1)), audit("limite_cliente"))

    # valores inválidos: nada muda
    antes = ok("select lancamentos from public.config_limite")
    for v in ("0", "-5", "100001", "null"):
        rc, o, e = definir(None, v)
        confere("padrão com valor %s é recusado com a mensagem certa" % v, rc != 0 and "o limite vai de 1 a 100000" in e, e)
    confere("e o padrão segue como estava", ok("select lancamentos from public.config_limite") == antes)
    for v in ("0", "100001", "-1"):
        rc, o, e = definir(2, v)
        confere("limite próprio %s é recusado com a mensagem certa" % v, rc != 0 and "o limite vai de 1 a 100000" in e, e)
    confere("e o cliente segue sem limite próprio", cli(2)["proprio"] is None)
    # motivo
    for m in ("", "ab"):
        rc, o, e = definir(None, 600, m)
        confere("padrão sem motivo (%r): recusado" % m, rc != 0 and "motivo obrigatório" in e, e)
        rc, o, e = definir(2, 40, m)
        confere("limite próprio sem motivo (%r): recusado" % m, rc != 0 and "motivo obrigatório" in e, e)
        rc, o, e = definir(2, None, m)
        confere("remover limite sem motivo (%r): recusado" % m, rc != 0 and "motivo obrigatório" in e, e)
    confere("nada disso gravou limite", cli(2)["proprio"] is None and ok("select lancamentos from public.config_limite") == antes)
    # alvo inexistente ou que não é cliente
    rc, o, e = definir(5, 40)
    confere("cliente que não existe: recusado", rc != 0 and "cliente não encontrado" in e, e)
    rc, o, e = chama("select public.admin_limite_definir('%s', 40, 'teste de limite')" % ADM)
    confere("o próprio admin não é cliente: recusado", rc != 0 and "cliente não encontrado" in e, e)

    # quem não é admin
    for nome, sql in (
        ("ler", "select public.admin_limite_cliente('%s')" % uuid(1)),
        ("definir", "select public.admin_limite_definir(null, 10, 'teste de limite')"),
        ("prévia", "select public.admin_limite_previa(10)"),
    ):
        rc, o, e = chama(sql, admin=False)
        confere("quem não é admin: %s dá acesso negado" % nome, rc != 0 and "acesso negado" in e, e)
    confere("e o padrão não mudou", ok("select lancamentos from public.config_limite") == antes)

    # prévia: clientes 1 (uso 6, sem limite próprio de novo), 2 (uso 3), 3 (uso 0), 4 (uso 8)
    p = json_de(chama("select public.admin_limite_previa(3)"))
    confere("prévia: 3 de 4 clientes já usaram 3 ou mais", p == {"passam": 3, "total": 4}, p)
    json_de(definir(4, 1000, "cliente grande"))
    p = json_de(chama("select public.admin_limite_previa(3)"))
    confere("prévia: quem tem limite próprio não entra na conta", p == {"passam": 2, "total": 3}, p)
    rc, o, e = chama("select public.admin_limite_previa(0)")
    confere("prévia com 0 é recusada", rc != 0 and "o limite vai de 1 a 100000" in e, e)

    # restrições do banco, direto (mesmo se alguém pular as funções)
    rc, o, e = psql("insert into public.limite_cliente (user_id, lancamentos, motivo) values ('%s', 0, 'abc')" % uuid(3))
    confere("tabela: limite 0 não entra nem direto", rc != 0 and "check" in e, e)
    rc, o, e = psql("insert into public.limite_cliente (user_id, lancamentos, motivo) values ('%s', 10, 'x')" % uuid(3))
    confere("tabela: motivo curto não entra nem direto", rc != 0 and "check" in e, e)
    rc, o, e = psql("insert into public.config_limite (id, lancamentos) values (false, 10)")
    confere("tabela do padrão: só existe uma linha", rc != 0, e)
    # apagar a conta leva o limite junto
    ok("delete from public.admin_auditoria; delete from public.mensagens where user_id='%s'; delete from public.perfis where id='%s'; delete from auth.users where id='%s'" % (uuid(4), uuid(4), uuid(4)))
    confere("apagar a conta apaga o limite próprio (cascade)", ok("select count(*) from public.limite_cliente where user_id='%s'" % uuid(4)) == "0")

    # fechado ao cliente
    for t in ("config_limite", "limite_cliente"):
        priv = ok("select has_table_privilege('anon','public.%s','select') || '|' || has_table_privilege('authenticated','public.%s','select') || '|' || has_table_privilege('authenticated','public.%s','insert')" % (t, t, t))
        rls = ok("select relrowsecurity from pg_class where oid = 'public.%s'::regclass" % t)
        confere("%s: fechada (anon e authenticated sem permissão, RLS ligada)" % t, priv == "false|false|false" and rls == "t", (priv, rls))
    fn = ok("""select string_agg(f || '=' || has_function_privilege('anon', 'public.' || f, 'execute') || '/' || has_function_privilege('authenticated', 'public.' || f, 'execute'), ' ')
               from unnest(array['admin_limite_cliente(uuid)', 'admin_limite_definir(uuid,integer,text)', 'admin_limite_previa(integer)']) f""")
    confere("funções: anon não executa e authenticated executa", fn.count("=false/true") == 3, fn)
    # rodar a migration de novo não muda o padrão
    ok("update public.config_limite set lancamentos = 777")
    ok(EM_TESTE[0])
    confere("rodar a migration de novo preserva o padrão (idempotente)", ok("select lancamentos from public.config_limite") == "777")
    return falhas


if os.path.isdir(D):
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    ok_ = psql("create database teste", db="postgres")
    ok(ESQUELETO)
    sql_orig = open(MIG, encoding="utf-8").read()
    ok(sql_orig)
    EM_TESTE[0] = sql_orig
    f0 = suite()
    print("\nFALHAS NA MIGRATION: %d" % f0)

    print("\n== provas por mutação (quebra a migration de propósito e o teste tem que cair) ==")
    VALIDA_GLOBAL = "    if p_valor is null or p_valor < 1 or p_valor > 100000 then raise exception 'o limite vai de 1 a 100000' using errcode = '22023'; end if;\n    select c.lancamentos::text into antes"
    VALIDA_CLIENTE = "      if p_valor < 1 or p_valor > 100000 then raise exception 'o limite vai de 1 a 100000' using errcode = '22023'; end if;\n"
    muts = [
        ("sem a validação de faixa (função e tabela): o 0 passa", [
            (VALIDA_GLOBAL, "    select c.lancamentos::text into antes"),
            (VALIDA_CLIENTE, ""),
            ("lancamentos integer not null check (lancamentos between 1 and 100000),\n  atualizado_em timestamptz not null default now(),\n  atualizado_por uuid references auth.users (id) on delete set null\n);\n-- Linha", "lancamentos integer not null,\n  atualizado_em timestamptz not null default now(),\n  atualizado_por uuid references auth.users (id) on delete set null\n);\n-- Linha"),
        ]),
        ("limite próprio deixa de vencer o padrão", [("'proprio', proprio, 'efetivo', coalesce(proprio, padrao), 'uso_mes', uso)", "'proprio', proprio, 'efetivo', padrao, 'uso_mes', uso)")]),
        ("remover o limite próprio não apaga", [("      delete from public.limite_cliente where user_id = p_user;", "      null;")]),
        ("uso conta mensagem que não virou lançamento", [("where m.user_id = p_user and m.status = 'ok' and m.criado_em >= inicio;", "where m.user_id = p_user and m.criado_em >= inicio;")]),
        ("uso ignora o início do mês", [("where m.user_id = p_user and m.status = 'ok' and m.criado_em >= inicio;", "where m.user_id = p_user and m.status = 'ok';")]),
        ("motivo deixa de ser exigido", [("  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo obrigatório' using errcode = '22023'; end if;\n", "")]),
        ("a prévia conta quem tem limite próprio", [("   where p.papel = 'cliente' and not exists (select 1 from public.limite_cliente l where l.user_id = p.id);", "   where p.papel = 'cliente';")]),
        ("mudança de limite do cliente não vai para a auditoria", [("values ((select auth.uid()), 'limite_cliente', p_user,", "values ((select auth.uid()), 'limite_cliente_sem_registro', p_user,")]),
        ("definir não confere se é admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  if length(trim(coalesce(p_motivo", "  if length(trim(coalesce(p_motivo")]),
        ("a tabela do limite próprio fica aberta ao cliente", [("revoke all on public.limite_cliente from anon, authenticated;\n", "")]),
        ("a função de definir fica aberta ao anon", [("grant execute on function public.admin_limite_definir(uuid, integer, text) to authenticated;", "grant execute on function public.admin_limite_definir(uuid, integer, text) to anon, authenticated;")]),
        ("a migration deixa de ser idempotente (sobrescreve o padrão)", [("values (true, 300) on conflict (id) do nothing;", "values (true, 300) on conflict (id) do update set lancamentos = 300;")]),
    ]
    import contextlib
    import io

    pegos = 0
    for desc, trocas in muts:
        texto = sql_orig
        for de, para in trocas:
            assert texto.count(de) == 1, "trecho não encontrado exatamente uma vez para: %s\n%s" % (desc, de[:90])
            texto = texto.replace(de, para)
        # banco limpo a cada mutação: remove as tabelas e as funções e aplica a versão quebrada
        ok("drop function if exists public.admin_limite_cliente(uuid), public.admin_limite_definir(uuid, integer, text), public.admin_limite_previa(integer); drop table if exists public.limite_cliente, public.config_limite")
        ok(texto)
        EM_TESTE[0] = texto
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            try:
                f = suite()
            except AssertionError:
                f = 1  # a própria preparação quebrou: também é queda
        pego = f > 0
        pegos += pego
        print(("PEGO     " if pego else "NÃO PEGO ") + desc)
    print("%d de %d defeitos pegos" % (pegos, len(muts)))
    sys.exit(1 if (f0 or pegos != len(muts)) else 0)
finally:
    sh(PG + "pg_ctl", "-D", D, "-m", "immediate", "stop", check=False)
    shutil.rmtree(D, ignore_errors=True)
