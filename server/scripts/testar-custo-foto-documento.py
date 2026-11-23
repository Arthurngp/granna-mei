"""Testa a migration que separa o custo de FOTO e DOCUMENTO na leitura (admin_custo_periodo) num Postgres descartável e prova por mutação.
O que mais importa: o resultado ANTES e DEPOIS da migration é idêntico em todos os campos antigos (o total do cliente não pode mudar), e os dois campos novos
são PARTE de `entrada`. A cada mutação o banco é refeito do zero.
Uso: /usr/bin/python3 -I server/scripts/testar-custo-foto-documento.py. Usa o Postgres do Homebrew; cria um cluster temporário e o apaga no fim."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANTES = [R + "/supabase/migrations/" + m for m in ("20261116093000_admin_custo.sql", "20261121140000_admin_visao_geral.sql")]
MIG = R + "/supabase/migrations/20261123140000_custo_foto_documento.sql"
D = tempfile.mkdtemp(prefix="pg-custo-midia-")
PORTA = "55438"
PG = "/opt/homebrew/bin/"


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
create table public.perfis (id uuid primary key references auth.users (id), nome text, negocio text, whats text, papel text not null default 'cliente',
  criado_em timestamptz not null default now(), whats_verificado boolean not null default false, onboarding_passo integer not null default 0, onboarding_feito boolean not null default false);
create table public.mensagens (id bigint generated always as identity primary key, user_id uuid not null, tipo text not null default 'texto', status text not null default 'ok',
  tokens integer, tokens_entrada integer, tokens_saida integer, audio_tokens integer, audio_seg integer, criado_em timestamptz not null default now());
"""


def banco_base():
    """Refaz o banco do zero: esqueleto e as migrations anteriores. Se isto falhar o teste está quebrado, nunca é 'defeito pego'."""
    psql("drop database if exists teste with (force)", db="postgres")
    rc, o, e = psql("create database teste", db="postgres")
    assert rc == 0, e
    ok(ESQUELETO)
    for m in ANTES:
        ok(open(m, encoding="utf-8").read())


HOJE = "(now() at time zone 'America/Sao_Paulo')::date"


def chama(admin=True):
    return psql("set teste.admin='%s'; select public.admin_custo_periodo(%s - 3, %s)" % ("t" if admin else "f", HOJE, HOJE))


def j(rc_o_e):
    rc, o, e = rc_o_e
    assert rc == 0, e
    return json.loads(o.splitlines()[-1])


def msg(user, tipo, entrada, saida, quando="now()", audio_tokens="null", tokens="null"):
    ok("insert into public.mensagens (user_id, tipo, tokens, tokens_entrada, tokens_saida, audio_tokens, criado_em) values ('%s', '%s', %s, %s, %s, %s, %s)"
       % (uuid(user), tipo, tokens, entrada, saida, audio_tokens, quando))


def semear():
    ok("truncate public.mensagens; delete from public.perfis; delete from auth.users;")
    for n, nome in ((1, "Ana"), (2, "Bia")):
        ok("insert into auth.users (id) values ('%s'); insert into public.perfis (id, nome, negocio) values ('%s', '%s', 'Loja %s')" % (uuid(n), uuid(n), nome, nome))
    msg(1, "texto", 2000, 150)
    msg(1, "foto", 4400, 200)
    msg(1, "pdf", 4000, 180)
    msg(1, "audio", 3600, 150, audio_tokens=800)
    # Mensagem antiga: só tem o total (1000), entra estimada com 94% de entrada = 940, e é uma foto.
    ok("insert into public.mensagens (user_id, tipo, tokens, criado_em) values ('%s', 'foto', 1000, now())" % uuid(1))
    msg(2, "foto", 5000, 250)
    msg(2, "texto", 2100, 140)
    # Fora do período (10 dias atrás): não pode entrar em nada.
    msg(2, "pdf", 9999, 999, "now() - interval '10 days'")
    # Ontem à noite pelo relógio de São Paulo (ainda hoje em UTC): tem que cair no MESMO dia nas duas contas (entrada e entrada_foto).
    msg(1, "foto", 1111, 11, "(((now() at time zone 'America/Sao_Paulo')::date - 1) + time '23:30') at time zone 'America/Sao_Paulo'")


falhas = 0


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


NOVOS = ("entrada_foto", "entrada_pdf")


def sem_novos(x):
    if isinstance(x, list):
        return [sem_novos(i) for i in x]
    if isinstance(x, dict):
        return {k: sem_novos(v) for k, v in x.items() if k not in NOVOS}
    return x


def suite(texto_mig, antes_json):
    """antes_json: o resultado da função ORIGINAL com os mesmos dados."""
    global falhas
    falhas = 0
    novo = j(chama())

    print("\n-- nada do que existia muda --")
    confere("todos os campos antigos são idênticos aos de antes da migration (dias, totais, por cliente, meses)", sem_novos(novo) == antes_json, (sem_novos(novo), antes_json))
    tot_ent_antes = sum(d["entrada"] for d in antes_json["dias"])
    confere("o total de entrada do período não mudou", sum(d["entrada"] for d in novo["dias"]) == tot_ent_antes, tot_ent_antes)

    print("\n-- os campos novos --")
    dias = novo["dias"]
    confere("todo dia traz os dois campos, mesmo sem mensagem (zero, nunca ausente)", all("entrada_foto" in d and "entrada_pdf" in d for d in dias) and len(dias) == 4, dias)
    foto = sum(d["entrada_foto"] for d in dias)
    pdf = sum(d["entrada_pdf"] for d in dias)
    # fotos: 4400 + 940 (a antiga, estimada) + 5000 + 1111 (ontem à noite)  |  pdf: 4000 (o de 10 dias atrás fica de fora)
    confere("entrada_foto soma só as mensagens de foto, com a antiga estimada em 94%", foto == 4400 + 940 + 5000 + 1111, foto)
    confere("entrada_pdf soma só os documentos do período (o de 10 dias atrás fica de fora)", pdf == 4000, pdf)
    confere("em cada dia foto + documento nunca passa de entrada (são PARTE dela)", all(d["entrada_foto"] + d["entrada_pdf"] <= d["entrada"] for d in dias), dias)
    confere("a foto de ontem à noite cai no MESMO dia nas duas contas (fuso de São Paulo)", all(d["entrada_foto"] <= d["entrada"] for d in dias) and sum(1 for d in dias if d["entrada_foto"] > 0) == 2, [(d["dia"], d["entrada"], d["entrada_foto"]) for d in dias])
    cli = {c["nome"]: c for c in novo["por_cliente"]}
    confere("por cliente: a Ana tem foto 6451 (4400 + 940 + 1111) e documento 4000", cli["Ana"]["entrada_foto"] == 4400 + 940 + 1111 and cli["Ana"]["entrada_pdf"] == 4000, cli["Ana"])
    confere("por cliente: a Bia tem foto 5000 e nenhum documento (o de 10 dias atrás não conta)", cli["Bia"]["entrada_foto"] == 5000 and cli["Bia"]["entrada_pdf"] == 0, cli["Bia"])
    confere("por cliente: texto + foto + documento = entrada (o total do cliente não muda, só se reparte)", all(c["entrada"] - c["entrada_foto"] - c["entrada_pdf"] >= 0 for c in novo["por_cliente"]) and cli["Ana"]["entrada"] - cli["Ana"]["entrada_foto"] - cli["Ana"]["entrada_pdf"] == 2000 + 3600, cli["Ana"])
    confere("a soma por dia bate com a soma por cliente", foto == sum(c["entrada_foto"] for c in novo["por_cliente"]) and pdf == sum(c["entrada_pdf"] for c in novo["por_cliente"]))

    print("\n-- acesso --")
    rc, o, e = chama(admin=False)
    confere("quem não é admin continua barrado", rc != 0 and "acesso negado" in e, e)
    prv = lambda papel: ok("select has_function_privilege('%s', 'public.admin_custo_periodo(date,date)', 'execute')" % papel)
    confere("anônimo não executa, logado executa", prv("anon") == "f" and prv("authenticated") == "t", (prv("anon"), prv("authenticated")))
    confere("continua uma definição só (sem sobrecarga)", ok("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_custo_periodo'") == "1")

    print("\n-- a migration pode rodar de novo --")
    rc, o, e = psql(texto_mig)
    confere("rodar de novo não dá erro e o resultado é o mesmo", rc == 0 and j(chama()) == novo, e)
    return falhas


if os.path.isdir(D):
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    sql_orig = open(MIG, encoding="utf-8").read()

    def cenario(texto):
        """Banco do zero, os dados, o resultado da função ORIGINAL, e só então a migration (a nova ou a quebrada)."""
        banco_base()
        semear()
        antes = j(chama())
        rc, o, e = psql(texto)
        return rc, e, antes

    rc, e, antes = cenario(sql_orig)
    assert rc == 0, "a migration não aplica: " + e
    assert not any("entrada_foto" in d for d in antes["dias"]), "a função original já tinha os campos novos: o teste de antes/depois não prova nada"
    f0 = suite(sql_orig, antes)
    print("\nFALHAS NA MIGRATION: %d" % f0)

    print("\n== provas por mutação (quebra a migration de propósito e o teste tem que cair) ==")
    muts = [
        ("a foto passa a somar o PDF", [("sum(case when m.tipo = 'foto' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_foto,\n            sum(case when m.tipo = 'pdf'", "sum(case when m.tipo in ('foto', 'pdf') then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_foto,\n            sum(case when m.tipo = 'pdf'")]),
        ("o documento passa a somar a foto também (por cliente)", [("          sum(case when m.tipo = 'pdf' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_pdf,\n          sum(coalesce(m.tokens, 0))", "          sum(case when m.tipo in ('pdf', 'foto') then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_pdf,\n          sum(coalesce(m.tokens, 0))")]),
        ("a mensagem antiga (só total) deixa de entrar estimada na foto", [("            sum(case when m.tipo = 'foto' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_foto,\n", "            sum(case when m.tipo = 'foto' then coalesce(m.tokens_entrada, 0) else 0 end) entrada_foto,\n")]),
        ("o campo some do por cliente", [("          sum(case when m.tipo = 'foto' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_foto,\n          sum(case when m.tipo = 'pdf' then coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) else 0 end) entrada_pdf,\n          sum(coalesce(m.tokens, 0))", "          sum(coalesce(m.tokens, 0))")]),
        ("o dia sem mensagem vem sem o campo (nulo em vez de zero)", [("coalesce(s.entrada_foto, 0) entrada_foto, coalesce(s.entrada_pdf, 0) entrada_pdf,", "s.entrada_foto entrada_foto, s.entrada_pdf entrada_pdf,")]),
        ("a entrada total passa a descontar a foto (o total do cliente mudaria)", [("            sum(coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94))) entrada,\n            sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) saida,\n            sum(coalesce(m.audio_tokens, 0)) audio_tokens,\n            sum(coalesce(m.audio_seg, 0)) audio_seg,\n            sum(case when m.tipo = 'foto'", "            sum(case when m.tipo = 'foto' then 0 else coalesce(m.tokens_entrada, round(coalesce(m.tokens, 0) * 0.94)) end) entrada,\n            sum(coalesce(m.tokens_saida, coalesce(m.tokens, 0) - round(coalesce(m.tokens, 0) * 0.94))) saida,\n            sum(coalesce(m.audio_tokens, 0)) audio_tokens,\n            sum(coalesce(m.audio_seg, 0)) audio_seg,\n            sum(case when m.tipo = 'foto'")]),
        ("o período deixa de valer por cliente (conta tudo o que existe)", [("where m.criado_em >= ini and m.criado_em < fim\n        group by m.user_id, p.nome, p.negocio", "where true\n        group by m.user_id, p.nome, p.negocio")]),
        ("o anônimo passa a executar", [("revoke all on function public.admin_custo_periodo(date, date) from public, anon;", "grant execute on function public.admin_custo_periodo(date, date) to anon;")]),
        ("deixa de conferir se é admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n", "")]),
    ]
    pegos = 0
    for desc, trocas in muts:
        texto = sql_orig
        for de, para in trocas:
            assert texto.count(de) == 1, "trecho não encontrado exatamente uma vez para: %s\n%s" % (desc, de[:120])
            texto = texto.replace(de, para)
        rc, e, antes_m = cenario(texto)
        if rc != 0:
            print("MUTAÇÃO INVÁLIDA (o SQL quebrado nem aplica): " + desc + " -> " + e[:160])
            f = 0
        else:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                try:
                    f = suite(texto, antes_m)
                except Exception:
                    f = 1  # o resultado quebrado nem tem a forma esperada: também é queda
        pego = f > 0
        pegos += pego
        print(("PEGO     " if pego else "NÃO PEGO ") + desc)
    print("%d de %d defeitos pegos" % (pegos, len(muts)))
    sys.exit(1 if (f0 or pegos != len(muts)) else 0)
finally:
    sh(PG + "pg_ctl", "-D", D, "-m", "immediate", "stop", check=False)
    shutil.rmtree(D, ignore_errors=True)
