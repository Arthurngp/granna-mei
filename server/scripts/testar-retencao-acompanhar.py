"""Testa a função do acompanhamento dos lembretes de retenção (admin_retencao_acompanhar) num Postgres descartável e prova por mutação
(quebra a migration de propósito e confere que o teste cai).
Uso: /usr/bin/python3 server/scripts/testar-retencao-acompanhar.py. Usa o Postgres do Homebrew; cria um cluster temporário e o apaga no fim."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGS = [R + "/supabase/migrations/20261121200000_limite_lancamentos.sql", R + "/supabase/migrations/20261121210000_retencao.sql"]
MIG = R + "/supabase/migrations/20261122120000_retencao_acompanhar.sql"
D = tempfile.mkdtemp(prefix="pg-acompanhar-")
PORTA = "55435"
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
    assert rc == 0, "preparação falhou: %s -> %s" % (sql[:140], e)
    return o


ESQUELETO = """
create role anon nologin; create role authenticated nologin; create role service_role nologin;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
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

H = lambda h: "now() - interval '%d hours'" % h


def monta():
    ok("truncate public.mensagens, public.avisos, public.admin_auditoria, public.lancamentos; delete from public.assinaturas; delete from public.perfis; delete from auth.users;")
    ok("update public.config_retencao set modo = 'desligado', atraso_horas = case regra when 'nunca_mandou' then 24 else 48 end")
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days', ultimo_numero = whatsapp_numero where id = 1")
    ok("insert into auth.users (id) values ('%s'); insert into public.perfis (id, nome, papel) values ('%s', 'Admin', 'admin')" % (ADM, ADM))


def cliente(n, off=False):
    ok("insert into auth.users (id) values ('%s') on conflict do nothing" % uuid(n))
    ok("insert into public.perfis (id, nome, negocio, whats, whats_chave, papel, whats_verificado, avisos_off) values ('%s', 'Pessoa %d', 'Loja %d', '8199999%04d', '8199999%04d', 'cliente', true, %s)"
       % (uuid(n), n, n, n, n, "true" if off else "false"))
    ok("insert into public.assinaturas (user_id, status) values ('%s', 'ativa')" % uuid(n))


def aviso(n, regra, quando_sql, status="enviado", tipo=None):
    t = tipo or ("retencao_nunca" if regra == "nunca_mandou" else "retencao_parou")
    ok("insert into public.avisos (chave, user_id, tipo, status, criado_em, enviado_em) values ('ret:%s:%s', '%s', '%s', '%s', %s, %s)"
       % (regra, uuid(n), uuid(n), t, status, quando_sql, quando_sql if status == "enviado" else "null"))


def msg(n, quando_sql, texto="oi"):
    ok("insert into public.mensagens (user_id, telefone, texto, criado_em) values ('%s', '5581999990000', '%s', %s)" % (uuid(n), texto, quando_sql))


def lanc(n, quando_sql):
    ok("insert into public.lancamentos (user_id, id, criado_em) values ('%s', 'l' || floor(random() * 1000000)::text, %s)" % (uuid(n), quando_sql))


def chama(sql, admin=True):
    return psql("set teste.admin='%s'; set teste.uid='%s'; %s" % ("t" if admin else "f", ADM, sql))


def acompanhar(dias=30):
    rc, o, e = chama("select public.admin_retencao_acompanhar(%s)" % dias)
    assert rc == 0, e
    return json.loads(o.splitlines()[-1])


falhas = 0
EM_TESTE = [""]


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


def regra(j, nome):
    return next((x for x in j["por_regra"] if x["regra"] == nome), None)


def suite():
    global falhas
    falhas = 0
    monta()
    # ---------- os avisos enviados ----------
    cliente(1); aviso(1, "nunca_mandou", H(30)); msg(1, H(20)); lanc(1, H(15))                       # respondeu 10 h depois e lançou
    cliente(2); aviso(2, "nunca_mandou", H(60))                                                       # sem resposta nenhuma
    cliente(3, off=True); aviso(3, "nunca_mandou", H(60)); msg(3, H(59), "SAIR")                      # só pediu SAIR (não é resposta)
    cliente(4); aviso(4, "parou_de_usar", H(60)); msg(4, H(30), "quanto sobrou?"); lanc(4, H(20))   # respondeu 30 h depois (fora das 24 h), lançou 40 h depois
    cliente(5); aviso(5, "parou_de_usar", H(5))                                                       # enviado há 5 h: ainda não dá para medir
    cliente(6); aviso(6, "nunca_mandou", "now() - interval '40 days'")                                # fora dos 30 dias
    cliente(7); aviso(7, "nunca_mandou", H(60), status="enviando")                                    # reservado, nunca enviado
    cliente(8); aviso(8, "x", H(60), tipo="vencimento")                                               # aviso de vencimento: não é retenção
    cliente(9); aviso(9, "nunca_mandou", H(60)); msg(9, H(61), "oi")                                  # a mensagem é ANTERIOR ao aviso
    j = acompanhar(30)
    n = regra(j, "nunca_mandou")
    confere("nunca_mandou: enviados no período (1, 2, 3, 9; o 6 é de 40 dias atrás, o 7 nunca saiu, o 8 é vencimento)", n["enviados"] == 4, n)
    confere("nunca_mandou: medidos em 24 h são todos (todos enviados há mais de 24 h) e responderam só 1", n["medidos_24h"] == 4 and n["responderam_24h"] == 1, n)
    confere("nunca_mandou: SAIR não conta como resposta e mensagem de antes do aviso também não", n["responderam_24h"] == 1, n)
    confere("nunca_mandou: medidos em 48 h são 3 (o 1 foi enviado há 30 h) e ninguém deles lançou", n["medidos_48h"] == 3 and n["lancaram_48h"] == 0, n)
    confere("nunca_mandou: 1 pediu SAIR", n["pediram_sair"] == 1, n)
    p = regra(j, "parou_de_usar")
    confere("parou_de_usar: 2 enviados, só 1 medido (o de 5 horas ainda não deu tempo)", p["enviados"] == 2 and p["medidos_24h"] == 1 and p["medidos_48h"] == 1, p)
    confere("parou_de_usar: a resposta 30 h depois fica FORA da janela de 24 h", p["responderam_24h"] == 0, p)
    confere("parou_de_usar: o lançamento 40 h depois entra na janela de 48 h", p["lancaram_48h"] == 1, p)
    confere("as regras vêm na ordem (nunca_mandou primeiro)", [x["regra"] for x in j["por_regra"]] == ["nunca_mandou", "parou_de_usar"], j["por_regra"])

    # ---------- período ----------
    confere("com 60 dias entra o aviso de 40 dias atrás (6)", regra(acompanhar(60), "nunca_mandou")["enviados"] == 5)
    confere("com 7 dias continua igual (todos os outros são recentes)", regra(acompanhar(7), "nunca_mandou")["enviados"] == 4)
    for v in ("0", "91", "null", "-3"):
        rc, o, e = chama("select public.admin_retencao_acompanhar(%s)" % v)
        confere("período %s é recusado" % v, rc != 0 and "o período vai de 1 a 90" in e, e)

    # ---------- linha do tempo ----------
    t = j["ultimos"]
    confere("a linha do tempo traz os 6 envios (1, 2, 3, 4, 5 e 9), do mais novo ao mais antigo", len(t) == 6 and t[0]["nome"] == "Pessoa 5" and t[1]["nome"] == "Pessoa 1", [x["nome"] for x in t])
    por = {x["nome"]: x for x in t}
    confere("o enviado há 5 h está 'aguardando': nem respondeu nem lançou é nulo, não falso", por["Pessoa 5"]["respondeu"] is None and por["Pessoa 5"]["lancou"] is None, por["Pessoa 5"])
    confere("o enviado há 30 h: respondeu verdadeiro e lançou ainda nulo (faltam 18 h para medir)", por["Pessoa 1"]["respondeu"] is True and por["Pessoa 1"]["lancou"] is None, por["Pessoa 1"])
    confere("o enviado há 60 h sem resposta: falso nos dois, e quem pediu SAIR aparece marcado", por["Pessoa 2"]["respondeu"] is False and por["Pessoa 2"]["lancou"] is False and por["Pessoa 3"]["pediu_sair"] is True and por["Pessoa 2"]["pediu_sair"] is False, (por["Pessoa 2"], por["Pessoa 3"]))

    # ---------- a fila: quem é elegível agora e quem passa a ser nas próximas 24 h ----------
    cliente(20); msg(20, H(30))     # nunca mandou, 30 h: elegível agora
    cliente(21); msg(21, H(10))     # 10 h: faltam 14 h
    cliente(22); msg(22, H(1))      # 1 h: faltam 23 h
    cliente(23); lanc(23, H(2)); msg(23, H(30))   # lançou pelo painel: nunca entra
    f = {x["regra"]: x for x in acompanhar(30)["fila"]}
    nm = lambda lst: sorted(x["nome"] for x in lst)
    confere("fila nunca_mandou, agora: só o 20", nm(f["nunca_mandou"]["agora"]) == ["Pessoa 20"], f["nunca_mandou"]["agora"])
    confere("fila nunca_mandou, a caminho nas próximas 24 h: o 21 e o 22, com as horas que faltam", nm(f["nunca_mandou"]["a_caminho"]) == ["Pessoa 21", "Pessoa 22"], f["nunca_mandou"]["a_caminho"])
    faltam = {x["nome"]: x["faltam_horas"] for x in f["nunca_mandou"]["a_caminho"]}
    confere("as horas que faltam batem (21 falta 14 h, 22 falta 23 h)", faltam.get("Pessoa 21") == 14 and faltam.get("Pessoa 22") == 23, faltam)
    confere("quem já é elegível agora NÃO repete em 'a caminho'", "Pessoa 20" not in nm(f["nunca_mandou"]["a_caminho"]))
    confere("a fila traz o modo e o atraso de cada regra", f["nunca_mandou"]["modo"] == "desligado" and f["nunca_mandou"]["atraso_horas"] == 24 and f["parou_de_usar"]["atraso_horas"] == 48, f)

    # ---------- permissões ----------
    rc, o, e = chama("select public.admin_retencao_acompanhar(30)", admin=False)
    confere("quem não é admin: acesso negado", rc != 0 and "acesso negado" in e, e)
    pv = ok("select has_function_privilege('anon','public.admin_retencao_acompanhar(integer)','execute') || '|' || has_function_privilege('authenticated','public.admin_retencao_acompanhar(integer)','execute')")
    confere("anon não executa e authenticated executa", pv == "false|true", pv)
    ok(EM_TESTE[0])
    confere("rodar a migration de novo não muda nada (idempotente)", regra(acompanhar(30), "nunca_mandou")["enviados"] == 4)
    return falhas


if os.path.isdir(D):
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    psql("create database teste", db="postgres")
    ok(ESQUELETO)
    for m in MIGS:
        ok(open(m, encoding="utf-8").read())
    sql_orig = open(MIG, encoding="utf-8").read()
    ok(sql_orig)
    EM_TESTE[0] = sql_orig
    f0 = suite()
    print("\nFALHAS NA MIGRATION: %d" % f0)

    print("\n== provas por mutação (quebra a migration de propósito e o teste tem que cair) ==")
    muts = [
        ("conta aviso que nunca saiu (reservado)", [("a.tipo in ('retencao_nunca', 'retencao_parou') and a.status = 'enviado' and", "a.tipo in ('retencao_nunca', 'retencao_parou') and")]),
        ("conta o aviso de vencimento como retenção", [("a.tipo in ('retencao_nunca', 'retencao_parou') and a.status = 'enviado'", "a.status = 'enviado'")]),
        ("o período é ignorado", [(" and coalesce(a.enviado_em, a.criado_em) >= desde", "")]),
        ("a palavra SAIR conta como resposta", [("\n                        and m.texto !~* '^\\s*s[aá]ir\\s*[.!?]*\\s*$') as respondeu", ") as respondeu")]),
        ("mensagem de ANTES do aviso conta como resposta", [("where m.user_id = e.user_id and m.criado_em > e.em and m.criado_em <= e.em + interval '24 hours'", "where m.user_id = e.user_id and m.criado_em <= e.em + interval '24 hours'")]),
        ("a janela de resposta é de 48 h em vez de 24 h", [("m.criado_em > e.em and m.criado_em <= e.em + interval '24 hours'", "m.criado_em > e.em and m.criado_em <= e.em + interval '48 hours'")]),
        ("a janela de lançamento é de 24 h em vez de 48 h", [("l.criado_em > e.em and l.criado_em <= e.em + interval '48 hours'", "l.criado_em > e.em and l.criado_em <= e.em + interval '24 hours'")]),
        ("o denominador ignora quem ainda não teve tempo (medido sempre verdadeiro)", [("e.em <= now() - interval '24 hours' as medido_24", "true as medido_24")]),
        ("quem ainda não deu tempo aparece como 'não respondeu' em vez de aguardando", [("case when x.medido_24 then x.respondeu else null end", "x.respondeu")]),
        ("o SAIR é ignorado (pediu_sair sempre falso)", [("coalesce((select p.avisos_off from public.perfis p where p.id = e.user_id), false) as pediu_sair", "false as pediu_sair")]),
        ("a fila repete quem já é elegível em 'a caminho'", [("                                        where not exists (select 1 from public.retencao_elegiveis(c.regra, c.atraso_horas, false) y where y.user_id = x.user_id) limit 20) e))", "                                        limit 20) e))")]),
        ("o acompanhamento não confere se é admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  if p_dias", "  if p_dias")]),
        ("a função fica aberta ao anon", [("grant execute on function public.admin_retencao_acompanhar(integer) to authenticated;", "grant execute on function public.admin_retencao_acompanhar(integer) to anon, authenticated;")]),
    ]
    pegos = 0
    for desc, trocas in muts:
        texto = sql_orig
        for de, para in trocas:
            assert texto.count(de) == 1, "trecho não encontrado exatamente uma vez para: %s\n%s" % (desc, de[:110])
            texto = texto.replace(de, para)
        ok("drop function if exists public.admin_retencao_acompanhar(integer)")
        ok(texto)
        EM_TESTE[0] = texto
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            try:
                f = suite()
            except AssertionError:
                f = 1
        pego = f > 0
        pegos += pego
        print(("PEGO     " if pego else "NÃO PEGO ") + desc)
    print("%d de %d defeitos pegos" % (pegos, len(muts)))
    sys.exit(1 if (f0 or pegos != len(muts)) else 0)
finally:
    sh(PG + "pg_ctl", "-D", D, "-m", "immediate", "stop", check=False)
    shutil.rmtree(D, ignore_errors=True)
