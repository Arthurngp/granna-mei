"""Testa a migration do envio manual (fila, funções do admin, quem pode receber, permissões) num Postgres descartável e prova por mutação. A cada mutação o
banco é refeito do zero (esqueleto, migrations anteriores e a versão quebrada da nova), para um reset parcial não esconder nada.
Uso: /usr/bin/python3 -I server/scripts/testar-envio-manual.py. Usa o Postgres do Homebrew; cria um cluster temporário e o apaga no fim."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANTES = [R + "/supabase/migrations/" + m for m in ("20261121200000_limite_lancamentos.sql", "20261121210000_retencao.sql", "20261122120000_retencao_acompanhar.sql", "20261122150000_retencao_sequencia.sql")]
MIG = R + "/supabase/migrations/20261123120000_envio_manual.sql"
D = tempfile.mkdtemp(prefix="pg-envio-manual-")
PORTA = "55437"
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
    """Refaz o banco do zero: esqueleto e as migrations anteriores. Se isto falhar o teste está quebrado, nunca é 'defeito pego'."""
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


def chama(sql, admin=True):
    return psql("set teste.admin='%s'; set teste.uid='%s'; %s" % ("t" if admin else "f", ADM, sql))


def j(rc_o_e):
    rc, o, e = rc_o_e
    assert rc == 0, e
    return json.loads(o.splitlines()[-1])


def erro(rc_o_e):
    rc, o, e = rc_o_e
    return "" if rc == 0 else e


falhas = 0


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


TXT = "Oi, Pessoa! Aqui é da Granninha. Vi que você já conectou seu WhatsApp, mas ainda não mandou o primeiro lançamento."


def pedir(n, grupo="nunca", texto=TXT, admin=True):
    return chama("select public.admin_envio_pedir('%s', '%s', $t$%s$t$)" % (uuid(n), grupo, texto), admin)


def apto(n):
    rc, o, e = psql("select coalesce(telefone, '') || '|' || coalesce(recusa, '') from public.envio_manual_apto('%s')" % uuid(n))
    assert rc == 0, e
    return o


def suite(texto_mig):
    global falhas
    falhas = 0
    monta()

    print("\n-- o tipo novo em avisos --")
    cliente(901)
    for t in ("vencimento", "retencao_nunca", "retencao_parou", "retencao_manual"):
        rc, o, e = psql("insert into public.avisos (chave, user_id, tipo, status) values ('t:%s', '%s', '%s', 'enviado')" % (t, uuid(901), t))
        confere("avisos aceita o tipo %s" % t, rc == 0, e)
    rc, o, e = psql("insert into public.avisos (chave, user_id, tipo, status) values ('t:lixo', '%s', 'lixo', 'enviado')" % uuid(901))
    confere("avisos continua recusando tipo desconhecido", rc != 0)
    monta()

    print("\n-- quem pode receber (envio_manual_apto) --")
    cliente(1); msg(1)
    confere("quem escreveu para o número atual pode receber, no telefone em que escreveu por último", apto(1) == "5581999990000|", apto(1))
    cliente(2)
    confere("quem NUNCA escreveu para o número atual não pode (contato frio derruba número não oficial)", "nunca escreveu para o número atual" in apto(2), apto(2))
    cliente(3); msg(3, "now() - interval '60 days'")
    confere("escrever só para o número ANTIGO (antes do marco) não conta", "nunca escreveu para o número atual" in apto(3), apto(3))
    cliente(4, off=True); msg(4)
    confere("quem respondeu SAIR não pode receber", "respondeu SAIR" in apto(4), apto(4))
    cliente(5, exclusao=True); msg(5)
    confere("quem pediu a exclusão da conta não pode receber", "exclusão da conta" in apto(5), apto(5))
    cliente(6, verificado=False); msg(6)
    confere("quem não confirmou o WhatsApp não pode receber", "não está confirmado" in apto(6), apto(6))
    cliente(7, papel="admin"); msg(7)
    confere("quem não é cliente não pode receber", "cliente não encontrado" in apto(7), apto(7))
    confere("id que não existe não pode receber", "cliente não encontrado" in apto(99), apto(99))
    cliente(8); msg(8, tel="123")
    confere("telefone curto demais não pode receber", "sem telefone" in apto(8), apto(8))
    cliente(9); msg(9, "now() - interval '5 hours'", tel="5581111111111"); msg(9, "now() - interval '1 hours'", tel="5581222222222")
    confere("vai para o telefone do ÚLTIMO contato (o que o WhatsApp aceita)", apto(9) == "5581222222222|", apto(9))
    ok("update public.granninha_saude set numero_desde = null where id = 1")
    confere("sem marco do número atual ninguém pode receber (não dá para saber quem já falou com este número)", "desde quando o número atual" in apto(1), apto(1))
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days' where id = 1")

    print("\n-- pedir o envio --")
    confere("quem não é admin não pede", "acesso negado" in erro(pedir(1, admin=False)))
    confere("grupo 'whats' (parou no passo do WhatsApp) não tem envio pelo sistema", "use o link do WhatsApp" in erro(pedir(1, "whats")))
    confere("grupo 'bloq' (sem acesso) não tem envio pelo sistema", "use o link do WhatsApp" in erro(pedir(1, "bloq")))
    confere("grupo inventado não passa", "use o link do WhatsApp" in erro(pedir(1, "xyz")))
    for nome, txt in (("link", TXT + " https://exemplo.com"), ("travessão", TXT.replace(",", " —", 1)), ("emoji", TXT + " \U0001F600"), ("a palavra SAIR", TXT + " Responda SAIR se quiser."), ("texto curto", "oi tudo bem")):
        confere("texto recusado: %s" % nome, "texto recusado" in erro(pedir(1, "nunca", txt)), nome)
    confere("nada foi gravado pelos pedidos recusados", ok("select count(*) from public.envios_manuais") == "0")
    confere("pessoa que não pode receber é recusada com o motivo", "nunca escreveu" in erro(pedir(2)))
    confere("e nada é gravado para ela", ok("select count(*) from public.envios_manuais where user_id = '%s'" % uuid(2)) == "0")
    r = j(pedir(1))
    confere("pedido válido entra na fila", r.get("ok") is True and r.get("ja_na_fila") is False and r.get("id"), r)
    confere("a linha está em 'fila', com o grupo, o texto e quem pediu", ok("select status || '|' || grupo || '|' || (pedido_por = '%s')::text from public.envios_manuais where user_id = '%s'" % (ADM, uuid(1))) == "fila|nunca|true")
    confere("o pedido entra na auditoria", ok("select count(*) from public.admin_auditoria where acao = 'envio_manual_pedido' and alvo_user_id = '%s'" % uuid(1)) == "1")
    r2 = j(pedir(1))
    confere("DUPLO CLIQUE: o segundo pedido é o mesmo, não uma segunda mensagem", r2.get("ja_na_fila") is True, r2)
    confere("continua uma linha só e uma auditoria só", ok("select count(*) from public.envios_manuais where user_id = '%s'" % uuid(1)) == "1" and ok("select count(*) from public.admin_auditoria where acao = 'envio_manual_pedido'") == "1")
    rc, o, e = psql("insert into public.envios_manuais (user_id, grupo, texto) values ('%s', 'nunca', $t$%s$t$)" % (uuid(1), TXT))
    confere("o banco recusa dois pedidos ativos da mesma pessoa, mesmo escrevendo direto na tabela", rc != 0)

    print("\n-- depois de enviar, 24 horas --")
    ok("update public.envios_manuais set status = 'enviado', enviado_em = now() - interval '2 hours' where user_id = '%s'" % uuid(1))
    confere("mandou há 2 horas: não manda de novo pelo botão", "menos de 24 horas" in erro(pedir(1)))
    ok("update public.envios_manuais set enviado_em = now() - interval '25 hours' where user_id = '%s'" % uuid(1))
    confere("mandou há 25 horas: pode pedir de novo", j(pedir(1)).get("ja_na_fila") is False)

    print("\n-- cancelar --")
    ok("delete from public.admin_auditoria")
    confere("quem não é admin não cancela", "acesso negado" in erro(chama("select public.admin_envio_cancelar('%s')" % ok("select id from public.envios_manuais where status = 'fila'"), admin=False)))
    pid = ok("select id from public.envios_manuais where status = 'fila'")
    confere("cancela o que está na fila", j(chama("select public.admin_envio_cancelar('%s')" % pid)).get("ok") is True)
    confere("o cancelamento entra na auditoria", ok("select count(*) from public.admin_auditoria where acao = 'envio_manual_cancelado'") == "1")
    confere("cancelar duas vezes não faz nada", j(chama("select public.admin_envio_cancelar('%s')" % pid)).get("ok") is False)
    confere("cancelar libera um pedido novo para a mesma pessoa", j(pedir(1)).get("ja_na_fila") is False)
    pid2 = ok("select id from public.envios_manuais where status = 'fila'")
    ok("update public.envios_manuais set status = 'enviando', iniciado_em = now() where id = '%s'" % pid2)
    confere("o que já está 'enviando' não dá para cancelar", j(chama("select public.admin_envio_cancelar('%s')" % pid2)).get("ok") is False)
    confere("pedido 'enviando' também segura o duplo clique", j(pedir(1)).get("ja_na_fila") is True)

    print("\n-- a fila e quando cada um sai --")
    monta()
    for n in (11, 12, 13):
        cliente(n); msg(n)
    confere("quem não é admin não lê a fila", "acesso negado" in erro(chama("select public.admin_envios_fila()", admin=False)))
    f = j(chama("select public.admin_envios_fila()"))
    confere("fila vazia: sem itens, espera de 5 minutos, WhatsApp ok", f["itens"] == [] and f["espera_min"] == 5 and f["whatsapp_ok"] is True, f)
    for n in (11, 12, 13):
        j(pedir(n))
        ok("update public.envios_manuais set pedido_em = now() - interval '%d minutes' where user_id = '%s'" % (30 - n, uuid(n)))
    ok("insert into public.avisos (chave, user_id, tipo, status, criado_em, enviado_em) values ('v1', '%s', 'vencimento', 'enviado', now() - interval '2 minutes', now() - interval '2 minutes')" % uuid(11))
    f = j(chama("select public.admin_envios_fila()"))
    itens = f["itens"]
    confere("três itens, na ordem do pedido, posições 1, 2 e 3", [i["posicao"] for i in itens] == [1, 2, 3] and [i["user_id"] for i in itens] == [uuid(11), uuid(12), uuid(13)], itens)
    seg = ok("select extract(epoch from ('%s'::timestamptz - '%s'::timestamptz))::int" % (itens[1]["previsto_em"], itens[0]["previsto_em"]))
    ter = ok("select extract(epoch from ('%s'::timestamptz - '%s'::timestamptz))::int" % (itens[2]["previsto_em"], itens[1]["previsto_em"]))
    confere("cada item sai 5 minutos depois do anterior (dentro da janela)", seg == "300" and ter == "300", (seg, ter))
    falta = ok("select extract(epoch from ('%s'::timestamptz - now()))::int" % itens[0]["previsto_em"])
    confere("o primeiro sai 5 minutos depois do último envio de QUALQUER tipo (um vencimento há 2 minutos): faltam ~3 minutos", 150 <= int(falta) <= 200, falta)
    confere("o último envio de qualquer tipo é informado", f["ultimo_envio_em"] is not None)
    ok("update public.granninha_saude set whatsapp_estado = 'DISCONNECTED' where id = 1")
    confere("WhatsApp desconectado aparece na fila", j(chama("select public.admin_envios_fila()"))["whatsapp_ok"] is False)
    ok("update public.granninha_saude set whatsapp_estado = 'CONNECTED', atualizado_em = now() - interval '10 minutes' where id = 1")
    confere("batimento velho (servidor parado) também conta como WhatsApp fora", j(chama("select public.admin_envios_fila()"))["whatsapp_ok"] is False)
    ok("update public.granninha_saude set atualizado_em = now() where id = 1")
    ok("update public.envios_manuais set status = 'enviado', enviado_em = now() where user_id = '%s'" % uuid(11))
    ok("update public.envios_manuais set status = 'falhou', erro = 'gateway recusou', pedido_em = now() where user_id = '%s'" % uuid(12))
    f = j(chama("select public.admin_envios_fila()"))
    confere("os encerrados nas últimas 24 horas vêm em 'recentes' com o motivo da falha", {(r["user_id"], r["status"]) for r in f["recentes"]} == {(uuid(11), "enviado"), (uuid(12), "falhou")} and [r for r in f["recentes"] if r["status"] == "falhou"][0]["erro"] == "gateway recusou", f["recentes"])
    confere("e só o que ainda espera fica em 'itens'", [i["user_id"] for i in f["itens"]] == [uuid(13)])

    print("\n-- a fila respeita a janela, a qualquer hora em que o teste rode --")
    monta()
    for n in (21, 22):
        cliente(n); msg(n)
        j(pedir(n))
        ok("update public.envios_manuais set pedido_em = now() - interval '%d minutes' where user_id = '%s'" % (50 - n, uuid(n)))
    # O último envio fica no futuro (depois de amanhã, 19h55 em São Paulo): o primeiro pedido cairia às 20h00, fora da janela, e tem que ir para as 9h do dia seguinte.
    ok("insert into public.avisos (chave, user_id, tipo, status, criado_em, enviado_em) values ('fut', '%s', 'vencimento', 'enviado', "
       "(((now() at time zone 'America/Sao_Paulo')::date + 2) + time '19:55') at time zone 'America/Sao_Paulo', (((now() at time zone 'America/Sao_Paulo')::date + 2) + time '19:55') at time zone 'America/Sao_Paulo')" % uuid(21))
    itens = j(chama("select public.admin_envios_fila()"))["itens"]
    alvo = ok("select to_char((((now() at time zone 'America/Sao_Paulo')::date + 3) + time '09:00'), 'YYYY-MM-DD HH24:MI')")
    def sp(ts):
        return ok("select to_char('%s'::timestamptz at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')" % ts)
    confere("fora da janela, o primeiro sai às 9h do dia seguinte (não às 20h)", sp(itens[0]["previsto_em"]) == alvo, (sp(itens[0]["previsto_em"]), alvo))
    confere("e o segundo, 5 minutos depois dele", sp(itens[1]["previsto_em"]) == alvo[:-2] + "05", sp(itens[1]["previsto_em"]))

    print("\n-- a janela das 9h às 19h --")
    def janela(h):
        return ok("select to_char(public.envio_manual_na_janela('2026-11-23 %s-03'::timestamptz) at time zone 'America/Sao_Paulo', 'DD HH24:MI')" % h)
    confere("antes das 9h espera até as 9h do mesmo dia", janela("08:59") == "23 09:00" and janela("03:00") == "23 09:00", (janela("08:59"), janela("03:00")))
    confere("às 9h e às 18:59 está dentro", janela("09:00") == "23 09:00" and janela("18:59") == "23 18:59" and janela("12:00") == "23 12:00")
    confere("às 19h e depois espera até as 9h do dia seguinte", janela("19:00") == "24 09:00" and janela("23:30") == "24 09:00", (janela("19:00"), janela("23:30")))

    print("\n-- quem pode chamar o quê --")
    def prv(papel, objeto, tipo, priv):
        return ok("select has_%s_privilege('%s', '%s', '%s')" % (tipo, papel, objeto, priv))
    confere("o cliente (anon e authenticated) não lê nem escreve a fila", all(prv(p, "public.envios_manuais", "table", pv) == "f" for p in ("anon", "authenticated") for pv in ("select", "insert", "update", "delete")))
    confere("só o serviço lê e atualiza a fila", prv("service_role", "public.envios_manuais", "table", "select") == "t" and prv("service_role", "public.envios_manuais", "table", "update") == "t")
    confere("o cliente não executa a conferência da pessoa nem a janela", all(prv(p, fn, "function", "execute") == "f" for p in ("anon", "authenticated") for fn in ("public.envio_manual_apto(uuid)", "public.envio_manual_na_janela(timestamptz)")))
    confere("o serviço executa a conferência da pessoa", prv("service_role", "public.envio_manual_apto(uuid)", "function", "execute") == "t")
    fns = ("public.admin_envio_pedir(uuid,text,text)", "public.admin_envio_cancelar(uuid)", "public.admin_envios_fila()")
    confere("as funções do admin: logado executa (e confere eh_admin lá dentro), anônimo não", all(prv("authenticated", fn, "function", "execute") == "t" and prv("anon", fn, "function", "execute") == "f" for fn in fns))
    confere("RLS ligada na fila", ok("select relrowsecurity from pg_class where oid = 'public.envios_manuais'::regclass") == "t")

    print("\n-- a migration pode rodar de novo --")
    antes = ok("select count(*) from public.envios_manuais")
    rc, o, e = psql(texto_mig)
    confere("rodar de novo não dá erro", rc == 0, e)
    confere("e não apaga nem duplica o que já havia", antes != "0" and ok("select count(*) from public.envios_manuais") == antes, (antes, ok("select count(*) from public.envios_manuais")))
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
        ("o pedido deixa de conferir se é admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  if p_grupo is null", "  if p_grupo is null")]),
        ("a fila deixa de conferir se é admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  select max(greatest", "  select max(greatest")]),
        ("cancelar deixa de conferir se é admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  update public.envios_manuais set status = 'cancelado'", "  update public.envios_manuais set status = 'cancelado'")]),
        ("o grupo 'whats' passa a ter envio pelo sistema", [("p_grupo not in ('nunca', 'sumiu')", "p_grupo not in ('nunca', 'sumiu', 'whats')"), ("check (grupo in ('nunca', 'sumiu'))", "check (grupo in ('nunca', 'sumiu', 'whats'))")]),
        ("o texto deixa de ser validado (link, emoji, travessão, SAIR)", [("  v_erro := public.retencao_texto_erro(v_texto);\n  if v_erro is not null then raise exception 'texto recusado: %', v_erro using errcode = '22023'; end if;\n", "")]),
        ("quem respondeu SAIR pode receber", [("  if pf.avisos_off then", "  if false then")]),
        ("quem pediu a exclusão pode receber", [("  if pf.exclusao_em is not null then", "  if false then")]),
        ("quem não confirmou o WhatsApp pode receber", [("  if not coalesce(pf.whats_verificado, false) then", "  if false then")]),
        ("contato frio: quem nunca escreveu para o número atual pode receber", [("  if desde < 1 then", "  if false then")]),
        ("a conferência conta mensagens do número ANTIGO", [("m.user_id = p_user and m.criado_em >= marco;", "m.user_id = p_user;")]),
        ("o telefone é o primeiro contato em vez do último", [("order by m.criado_em desc limit 1;\n  tel :=", "order by m.criado_em asc limit 1;\n  tel :=")]),
        ("a regra das 24 horas some", [("e.status = 'enviado' and e.enviado_em > now() - interval '24 hours'", "e.status = 'enviado' and e.enviado_em > now() + interval '24 hours'")]),
        ("duplo clique grava duas linhas (o índice único some e o insert vira simples)", [("create unique index if not exists envios_manuais_um_ativo on public.envios_manuais (user_id) where status in ('fila', 'enviando');\n", ""), ("    on conflict (user_id) where status in ('fila', 'enviando') do nothing\n", "")]),
        ("cancelar vale também para o que está enviando", [("where id = p_id and status = 'fila' returning user_id", "where id = p_id and status in ('fila', 'enviando') returning user_id")]),
        ("o pedido não entra na auditoria", [("values ((select auth.uid()), 'envio_manual_pedido', p_user, jsonb_build_object('grupo', p_grupo, 'pedido', novo));", "select 1;")]),
        ("a fila ignora a janela das 9h às 19h", [("    prox := public.envio_manual_na_janela(prox);\n", "")]),
        ("a janela das 19h empurra para o mesmo dia em vez do seguinte", [("return ((d + 1) + time '09:00') at time zone", "return (d + time '09:00') at time zone")]),
        ("a previsão ignora a espera de 5 minutos entre itens", [("    prox := prox + interval '5 minutes';\n  end loop;", "  end loop;")]),
        ("a previsão ignora o último envio de outros tipos", [("select max(greatest(av.criado_em, coalesce(av.enviado_em, av.criado_em))) into ultimo from public.avisos av;", "select max(greatest(av.criado_em, coalesce(av.enviado_em, av.criado_em))) into ultimo from public.avisos av where av.tipo = 'retencao_manual';")]),
        ("WhatsApp parado há minutos ainda aparece como ok", [("and s.atualizado_em > agora - interval '3 minutes'", "")]),
        ("o tipo novo apaga os que já existiam em avisos", [("check (tipo in ('vencimento', 'retencao_nunca', 'retencao_parou', 'retencao_manual'))", "check (tipo in ('retencao_manual'))")]),
        ("a fila fica aberta ao cliente", [("revoke all on public.envios_manuais from anon, authenticated;\n", "")]),
        ("o cliente passa a executar a conferência da pessoa", [("grant execute on function public.envio_manual_apto(uuid) to service_role;", "grant execute on function public.envio_manual_apto(uuid) to service_role, authenticated;")]),
        ("o anônimo passa a executar o pedido", [("revoke all on function public.admin_envio_pedir(uuid, text, text) from public, anon;", "revoke all on function public.admin_envio_pedir(uuid, text, text) from public;")]),
        ("a migration deixa de ser idempotente (recria a fila e apaga os pedidos)", [("create table if not exists public.envios_manuais (", "drop table if exists public.envios_manuais cascade;\ncreate table public.envios_manuais (")]),
    ]
    pegos = 0
    for desc, trocas in muts:
        texto = sql_orig
        for de, para in trocas:
            assert texto.count(de) == 1, "trecho não encontrado exatamente uma vez para: %s\n%s" % (desc, de[:120])
            texto = texto.replace(de, para)
        banco_base()  # se a base falhar, o erro sobe e derruba o teste (não conta como defeito pego)
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
                    f = 1  # a preparação DENTRO do cenário recusou o que a migration quebrada deveria aceitar: também é queda
        pego = f > 0
        pegos += pego
        print(("PEGO     " if pego else "NÃO PEGO ") + desc)
    print("%d de %d defeitos pegos" % (pegos, len(muts)))
    sys.exit(1 if (f0 or pegos != len(muts)) else 0)
finally:
    sh(PG + "pg_ctl", "-D", D, "-m", "immediate", "stop", check=False)
    shutil.rmtree(D, ignore_errors=True)
