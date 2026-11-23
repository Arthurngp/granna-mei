"""Testa a migration que deixa o admin autorizar, de propósito, o envio para quem nunca escreveu para o número atual (contato frio), num Postgres descartável, e
prova por mutação. O que mais importa: a autorização só libera o contato frio (SAIR, exclusão, WhatsApp não confirmado, sem telefone e sem marco continuam
recusando), vale só para o pedido, tem freio próprio de 10 por dia e não deixa funções duplicadas para trás. A cada mutação o banco é refeito do zero.
Uso: /usr/bin/python3 -I server/scripts/testar-envio-manual-frio.py. Usa o Postgres do Homebrew; cria um cluster temporário e o apaga no fim."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANTES = [R + "/supabase/migrations/" + m for m in ("20261121200000_limite_lancamentos.sql", "20261121210000_retencao.sql", "20261122120000_retencao_acompanhar.sql", "20261122150000_retencao_sequencia.sql", "20261123120000_envio_manual.sql")]
MIG = R + "/supabase/migrations/20261123160000_envio_manual_contato_frio.sql"
D = tempfile.mkdtemp(prefix="pg-envio-frio-")
PORTA = "55439"
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


def ok(sql, db="teste"):
    rc, o, e = psql(sql, db)
    assert rc == 0, "preparação falhou: %s -> %s" % (sql[:140], e)
    return o


ESQUELETO = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create function public.eh_admin() returns boolean language sql stable as $$ select coalesce(current_setting('teste.admin', true), 'f') = 't' $$;
create table public.perfis (id uuid primary key references auth.users (id), nome text, negocio text, whats text, whats_chave text, papel text not null,
  whats_verificado boolean not null default false, exclusao_em timestamptz);
create table public.assinaturas (user_id uuid primary key references auth.users (id), status text not null, trial_fim date);
create table public.mensagens (id bigint generated always as identity primary key, user_id uuid not null, telefone text, texto text not null default '', status text not null default 'ok', criado_em timestamptz not null default now());
create table public.avisos (chave text primary key, user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null default 'vencimento' check (tipo in ('vencimento')), referencia date not null default current_date, para text not null default 'x',
  status text not null default 'enviando' check (status in ('enviando', 'enviado')), criado_em timestamptz not null default now(), enviado_em timestamptz);
create table public.granninha_saude (id integer primary key, whatsapp_estado text, whatsapp_numero text, fila integer, atualizado_em timestamptz default now());
create table public.lancamentos (user_id uuid not null, id text not null, criado_em timestamptz not null default now(), origem text not null default 'painel', primary key (user_id, id));
create table public.admin_auditoria (id bigint generated always as identity primary key, admin_id uuid not null references auth.users (id), acao text not null,
  alvo_user_id uuid references auth.users (id) on delete set null, detalhes jsonb not null default '{}'::jsonb, criado_em timestamptz not null default now());
insert into public.granninha_saude (id, whatsapp_estado, whatsapp_numero) values (1, 'CONNECTED', '5511936192452');
"""


def banco_base():
    psql("drop database if exists teste with (force)", db="postgres")
    rc, o, e = psql("create database teste", db="postgres")
    assert rc == 0, e
    ok(ESQUELETO)
    for m in ANTES:
        ok(open(m, encoding="utf-8").read())


def monta():
    ok("truncate public.mensagens, public.avisos, public.admin_auditoria, public.envios_manuais, public.lancamentos; delete from public.assinaturas; delete from public.perfis; delete from auth.users;")
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days', ultimo_numero = whatsapp_numero, whatsapp_estado = 'CONNECTED', atualizado_em = now() where id = 1")
    ok("insert into auth.users (id) values ('%s'); insert into public.perfis (id, nome, papel) values ('%s', 'Admin', 'admin')" % (ADM, ADM))


def cliente(n, verificado=True, off=False, exclusao=False, papel="cliente"):
    ok("insert into auth.users (id) values ('%s') on conflict do nothing" % uuid(n))
    ok("insert into public.perfis (id, nome, negocio, whats, whats_chave, papel, whats_verificado, avisos_off, exclusao_em) values ('%s', 'Pessoa %d', 'Loja %d', '8199999%04d', '8199999%04d', '%s', %s, %s, %s)"
       % (uuid(n), n, n, n, n, papel, "true" if verificado else "false", "true" if off else "false", "now()" if exclusao else "null"))
    ok("insert into public.assinaturas (user_id, status) values ('%s', 'ativa')" % uuid(n))


def msg(n, quando_sql="now() - interval '3 hours'", tel="5581999990000"):
    ok("insert into public.mensagens (user_id, telefone, texto, criado_em) values ('%s', '%s', 'oi', %s)" % (uuid(n), tel, quando_sql))


ANTIGO = "now() - interval '60 days'"  # antes do marco do número atual (45 dias atrás): só falou com o número antigo


def chama(sql, admin=True):
    return psql("set teste.admin='%s'; set teste.uid='%s'; %s" % ("t" if admin else "f", ADM, sql))


def j(rc_o_e):
    rc, o, e = rc_o_e
    assert rc == 0, e
    return json.loads(o.splitlines()[-1])


def erro(rc_o_e):
    rc, o, e = rc_o_e
    return "" if rc == 0 else e


TXT = "Oi, Pessoa! Aqui é da Granninha. Vi que você já conectou seu WhatsApp, mas ainda não mandou o primeiro lançamento."


def pedir(n, forcar=None, admin=True):
    if forcar is None:
        return chama("select public.admin_envio_pedir('%s', 'nunca', $t$%s$t$)" % (uuid(n), TXT), admin)
    return chama("select public.admin_envio_pedir('%s', 'nunca', $t$%s$t$, %s)" % (uuid(n), TXT, "true" if forcar else "false"), admin)


def apto(n, forcar=False):
    rc, o, e = psql("select coalesce(telefone, '') || '|' || coalesce(recusa, '') || '|' || frio::text from public.envio_manual_apto('%s', %s)" % (uuid(n), "true" if forcar else "false"))
    assert rc == 0, e
    return o


falhas = 0


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


FRIA = "nunca escreveu para o número atual"  # o texto que a tela do admin reconhece


def suite(texto_mig):
    global falhas
    falhas = 0
    monta()
    cliente(1); msg(1)                                   # escreveu para o número atual
    cliente(2); msg(2, ANTIGO)                           # só falou com o número antigo (contato frio)
    cliente(3, off=True); msg(3, ANTIGO)                 # respondeu SAIR
    cliente(4, exclusao=True); msg(4, ANTIGO)            # pediu exclusão
    cliente(5, verificado=False); msg(5, ANTIGO)         # WhatsApp não confirmado
    cliente(6); msg(6, ANTIGO, tel="123")                # telefone curto
    cliente(7, papel="admin"); msg(7, ANTIGO)            # não é cliente

    print("\n-- quem pode receber --")
    confere("sem autorização, o contato frio segue recusado, com o texto que a tela reconhece", FRIA in apto(2), apto(2))
    confere("com autorização, o contato frio passa, no telefone do último contato, marcado como frio", apto(2, True) == "5581999990000||true", apto(2, True))
    confere("quem escreveu para o número atual não é frio, com ou sem autorização", apto(1) == "5581999990000||false" and apto(1, True) == "5581999990000||false", (apto(1), apto(1, True)))
    confere("AUTORIZADO, quem respondeu SAIR continua barrado", "respondeu SAIR" in apto(3, True), apto(3, True))
    confere("AUTORIZADO, quem pediu exclusão continua barrado", "exclusão da conta" in apto(4, True), apto(4, True))
    confere("AUTORIZADO, quem não confirmou o WhatsApp continua barrado", "não está confirmado" in apto(5, True), apto(5, True))
    confere("AUTORIZADO, telefone curto continua barrado", "sem telefone" in apto(6, True), apto(6, True))
    confere("AUTORIZADO, quem não é cliente continua barrado", "cliente não encontrado" in apto(7, True), apto(7, True))
    ok("update public.granninha_saude set numero_desde = null where id = 1")
    confere("AUTORIZADO, sem o marco do número atual continua barrado (não dá para saber quem é frio)", "desde quando o número atual" in apto(2, True), apto(2, True))
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days' where id = 1")

    print("\n-- pedir --")
    confere("o pedido antigo (3 argumentos) continua funcionando e continua recusando o contato frio", FRIA in erro(pedir(2)))
    confere("com forcar falso também recusa", FRIA in erro(pedir(2, False)))
    confere("nada foi gravado pelas recusas", ok("select count(*) from public.envios_manuais") == "0")
    r = j(pedir(2, True))
    confere("com forcar, o contato frio entra na fila e vem marcado", r.get("ok") is True and r.get("contato_frio") is True and r.get("ja_na_fila") is False, r)
    confere("a linha guarda contato_frio verdadeiro", ok("select contato_frio from public.envios_manuais where user_id = '%s'" % uuid(2)) == "t")
    aud = json.loads(ok("select detalhes from public.admin_auditoria where acao = 'envio_manual_pedido' and alvo_user_id = '%s'" % uuid(2)))
    confere("a auditoria registra contato_frio e forcado", aud.get("contato_frio") is True and aud.get("forcado") is True, aud)
    confere("duplo clique no contato frio autorizado é o mesmo pedido, não dois", j(pedir(2, True)).get("ja_na_fila") is True and ok("select count(*) from public.envios_manuais where user_id = '%s'" % uuid(2)) == "1")
    r1 = j(pedir(1, True))
    confere("autorizar quem NÃO é frio não o marca como frio (a autorização só vale onde faz falta)", r1.get("contato_frio") is False and ok("select contato_frio from public.envios_manuais where user_id = '%s'" % uuid(1)) == "f", r1)
    confere("autorizado, SAIR continua barrado no pedido", "respondeu SAIR" in erro(pedir(3, True)))
    confere("autorizado, quem pediu exclusão continua barrado no pedido", "exclusão da conta" in erro(pedir(4, True)))
    confere("autorizado, WhatsApp não confirmado continua barrado no pedido", "não está confirmado" in erro(pedir(5, True)))
    confere("quem não é admin não autoriza nada", "acesso negado" in erro(pedir(2, True, admin=False)))

    print("\n-- o freio do contato frio: 10 por dia --")
    monta()
    for n in range(20, 32):
        cliente(n); msg(n, ANTIGO)
    cliente(40); msg(40)
    for n in range(20, 30):
        j(pedir(n, True))
    confere("o 11º pedido de contato frio no dia é recusado, com o motivo", "10 envios para quem nunca escreveu" in erro(pedir(30, True)), erro(pedir(30, True)))
    confere("quem escreveu para o número atual não conta nesse freio", j(pedir(40, True)).get("ok") is True)
    ok("update public.envios_manuais set status = 'cancelado' where user_id = '%s'" % uuid(20))
    confere("cancelar um pedido libera uma vaga do dia", j(pedir(30, True)).get("ok") is True)
    confere("com 10 de novo, o 11º volta a ser recusado", "10 envios para quem nunca escreveu" in erro(pedir(31, True)))
    ok("update public.envios_manuais set status = 'falhou', erro = 'x' where user_id = '%s'" % uuid(21))
    confere("o que falhou também libera a vaga (não saiu mensagem nenhuma)", j(pedir(31, True)).get("ok") is True)
    monta()
    cliente(50); msg(50, ANTIGO)
    for n in range(100, 110):
        cliente(n)
        ok("insert into public.envios_manuais (user_id, grupo, texto, status, contato_frio, pedido_em, enviado_em) values ('%s', 'nunca', $t$%s$t$, 'enviado', true, now() - interval '2 days', now() - interval '2 days')" % (uuid(n), TXT))
    confere("10 envios de contato frio de dois dias atrás não contam no freio de hoje", j(pedir(50, True)).get("ok") is True)

    print("\n-- quem a tela vê como contato frio (campo frios da fila) --")
    monta()
    cliente(1); msg(1)                                   # escreveu para o número atual: NÃO é frio
    cliente(2); msg(2, ANTIGO)                           # só falou com o número antigo: é frio
    cliente(3, off=True); msg(3, ANTIGO)                 # SAIR: não aparece
    cliente(4, exclusao=True); msg(4, ANTIGO)            # exclusão: não aparece
    cliente(5, verificado=False); msg(5, ANTIGO)         # WhatsApp não confirmado: não aparece
    cliente(7, papel="admin"); msg(7, ANTIGO)            # não é cliente: não aparece
    cliente(8)                                           # confirmado, sem nenhuma mensagem: não aparece (não há para quem responder)
    cliente(9); msg(9, ANTIGO); msg(9)                   # falou com o antigo E com o atual: não é frio
    rf = j(chama("select public.admin_envios_fila()"))
    confere("a fila continua com o formato de antes (itens, recentes, espera, WhatsApp) e traz `frios`", all(k in rf for k in ("agora", "espera_min", "ultimo_envio_em", "whatsapp_ok", "itens", "recentes", "frios")), list(rf))
    confere("frios traz SÓ quem confirmou o WhatsApp, não pediu SAIR nem exclusão, tem mensagem e nunca escreveu para o número atual", sorted(rf["frios"]) == [uuid(2)], rf["frios"])
    ok("update public.granninha_saude set numero_desde = null where id = 1")
    confere("sem o marco do número atual ninguém é dado como frio", j(chama("select public.admin_envios_fila()"))["frios"] == [])
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days' where id = 1")
    confere("quem não é admin continua sem ler a fila", "acesso negado" in erro(chama("select public.admin_envios_fila()", admin=False)))
    confere("a definição de frio da fila bate com a do pedido: quem está em frios é aceito com autorização e recusado sem ela", FRIA in apto(2) and apto(2, True).endswith("|true"))

    print("\n-- as funções antigas não ficam para trás --")
    prc = lambda assinatura: ok("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '%s'" % assinatura)
    confere("admin_envio_pedir é UMA função só (sem sobrecarga, que travaria o PostgREST)", prc("admin_envio_pedir") == "1", prc("admin_envio_pedir"))
    confere("envio_manual_apto é UMA função só", prc("envio_manual_apto") == "1", prc("envio_manual_apto"))
    confere("a coluna nova existe e linhas antigas valem como não autorizadas", ok("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'envios_manuais' and column_name = 'contato_frio' and column_default = 'false'") == "1")

    print("\n-- quem pode chamar o quê --")
    prv = lambda papel, objeto: ok("select has_function_privilege('%s', '%s', 'execute')" % (papel, objeto))
    confere("o pedido: logado executa, anônimo não", prv("authenticated", "public.admin_envio_pedir(uuid,text,text,boolean)") == "t" and prv("anon", "public.admin_envio_pedir(uuid,text,text,boolean)") == "f")
    confere("a conferência da pessoa: só o serviço", prv("service_role", "public.envio_manual_apto(uuid,boolean)") == "t" and prv("anon", "public.envio_manual_apto(uuid,boolean)") == "f" and prv("authenticated", "public.envio_manual_apto(uuid,boolean)") == "f")

    print("\n-- a migration pode rodar de novo --")
    rc, o, e = psql(texto_mig)
    confere("rodar de novo não dá erro", rc == 0, e)
    return falhas


if os.path.isdir(D):
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    sql_orig = open(MIG, encoding="utf-8").read()
    banco_base()
    ok(sql_orig)
    f0 = suite(sql_orig)
    print("\nFALHAS NA MIGRATION: %d" % f0)

    print("\n== provas por mutação (quebra a migration de propósito e o teste tem que cair) ==")
    muts = [
        ("a autorização destrava quem respondeu SAIR", [("  if pf.avisos_off then", "  if pf.avisos_off and not coalesce(p_forcar, false) then")]),
        ("a autorização destrava quem pediu exclusão", [("  if pf.exclusao_em is not null then", "  if pf.exclusao_em is not null and not coalesce(p_forcar, false) then")]),
        ("a autorização destrava o WhatsApp não confirmado", [("  if not coalesce(pf.whats_verificado, false) then", "  if not coalesce(pf.whats_verificado, false) and not coalesce(p_forcar, false) then")]),
        ("a autorização destrava a falta de marco do número", [("  if marco is null then", "  if marco is null and not coalesce(p_forcar, false) then")]),
        ("a autorização nunca vale (o contato frio nunca passa)", [("  if desde < 1 and not coalesce(p_forcar, false) then", "  if desde < 1 then")]),
        ("o contato frio passa mesmo sem autorização", [("  if desde < 1 and not coalesce(p_forcar, false) then", "  if desde < 1 and false then")]),
        ("quem escreveu para o número atual vira 'frio'", [("  return query select tel, pf.nome, null::text, (desde < 1);", "  return query select tel, pf.nome, null::text, true;")]),
        ("o pedido não guarda que foi contato frio", [("values (p_user, p_grupo, v_texto, (select auth.uid()), coalesce(apto.frio, false))", "values (p_user, p_grupo, v_texto, (select auth.uid()), false)")]),
        ("a auditoria não registra a autorização", [("'contato_frio', coalesce(apto.frio, false), 'forcado', coalesce(p_forcar, false)));", "'contato_frio', false, 'forcado', false));")]),
        ("o freio de 10 por dia some", [("if frios_hoje >= 10 then", "if frios_hoje >= 100000 then")]),
        ("o freio conta também o que foi cancelado", [("e.status in ('fila', 'enviando', 'enviado')\n        and e.pedido_em", "e.status in ('fila', 'enviando', 'enviado', 'cancelado')\n        and e.pedido_em")]),
        ("o freio só vale para o 11º já na meia-noite errada (conta tudo o que existe)", [("        and e.pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');", "        and true;")]),
        ("a função antiga de conferência fica para trás (sobrecarga)", [("drop function if exists public.envio_manual_apto(uuid);\n", "")]),
        ("o pedido antigo de 3 argumentos fica para trás (sobrecarga)", [("drop function if exists public.admin_envio_pedir(uuid, text, text);\n", "")]),
        ("o anônimo passa a executar o pedido", [("revoke all on function public.admin_envio_pedir(uuid, text, text, boolean) from public, anon;", "grant execute on function public.admin_envio_pedir(uuid, text, text, boolean) to anon;")]),
        ("o logado passa a executar a conferência da pessoa", [("grant execute on function public.envio_manual_apto(uuid, boolean) to service_role;", "grant execute on function public.envio_manual_apto(uuid, boolean) to service_role, authenticated;")]),
        ("frios passa a incluir quem respondeu SAIR", [("where p.papel = 'cliente' and coalesce(p.whats_verificado, false) and not coalesce(p.avisos_off, false) and p.exclusao_em is null", "where p.papel = 'cliente' and coalesce(p.whats_verificado, false) and p.exclusao_em is null")]),
        ("frios passa a incluir quem pediu exclusão", [("where p.papel = 'cliente' and coalesce(p.whats_verificado, false) and not coalesce(p.avisos_off, false) and p.exclusao_em is null", "where p.papel = 'cliente' and coalesce(p.whats_verificado, false) and not coalesce(p.avisos_off, false)")]),
        ("frios passa a incluir quem não confirmou o WhatsApp", [("where p.papel = 'cliente' and coalesce(p.whats_verificado, false) and not coalesce(p.avisos_off, false) and p.exclusao_em is null", "where p.papel = 'cliente' and not coalesce(p.avisos_off, false) and p.exclusao_em is null")]),
        ("frios passa a incluir quem escreveu para o número atual", [("         and not exists (select 1 from public.mensagens m, public.granninha_saude s2 where s2.id = 1 and m.user_id = p.id and m.criado_em >= s2.numero_desde)), '[]'::jsonb),", "         and true), '[]'::jsonb),")]),
        ("frios ignora o marco (conta mensagens do número antigo como se fossem do atual)", [("and m.user_id = p.id and m.criado_em >= s2.numero_desde)), '[]'::jsonb),", "and m.user_id = p.id)), '[]'::jsonb),")]),
        ("frios passa a incluir quem não tem mensagem nenhuma", [("         and exists (select 1 from public.mensagens m0 where m0.user_id = p.id)\n", "")]),
        ("a fila deixa de conferir se é admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  select max(greatest", "  select max(greatest")]),
        ("o pedido deixa de conferir se é admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  if p_grupo is null", "  if p_grupo is null")]),
    ]
    pegos = 0
    for desc, trocas in muts:
        texto = sql_orig
        for de, para in trocas:
            assert texto.count(de) == 1, "trecho não encontrado exatamente uma vez para: %s\n%s" % (desc, de[:120])
            texto = texto.replace(de, para)
        banco_base()
        rc, o, e = psql(texto)
        if rc != 0:
            print("MUTAÇÃO INVÁLIDA (o SQL quebrado nem aplica): " + desc + " -> " + e[:160])
            f = 0
        else:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                try:
                    f = suite(texto)
                except Exception:
                    f = 1
        pego = f > 0
        pegos += pego
        print(("PEGO     " if pego else "NÃO PEGO ") + desc)
    print("%d de %d defeitos pegos" % (pegos, len(muts)))
    sys.exit(1 if (f0 or pegos != len(muts)) else 0)
finally:
    sh(PG + "pg_ctl", "-D", D, "-m", "immediate", "stop", check=False)
    shutil.rmtree(D, ignore_errors=True)
