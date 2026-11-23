"""Testa a migration da sequência de lembretes (até 3 mensagens por pessoa, etapas 2 e 3, teto somado, 48 h entre avisos, funções do admin) num
Postgres descartável e prova por mutação. A cada mutação o banco é refeito do zero (esqueleto, migrations anteriores e a versão quebrada da
nova): esta migration troca assinaturas de função, e um reset parcial esconderia uma versão antiga que ficou para trás.
Uso: /usr/bin/python3 server/scripts/testar-retencao-sequencia.py. Usa o Postgres do Homebrew; cria um cluster temporário e o apaga no fim."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANTES = [R + "/supabase/migrations/" + m for m in ("20261121200000_limite_lancamentos.sql", "20261121210000_retencao.sql", "20261122120000_retencao_acompanhar.sql")]
MIG = R + "/supabase/migrations/20261122150000_retencao_sequencia.sql"
D = tempfile.mkdtemp(prefix="pg-sequencia-")
PORTA = "55436"
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


def banco_base(antes=None):
    """Refaz o banco do zero: esqueleto e as migrations anteriores. Se isto falhar o teste está quebrado, nunca é 'defeito pego'."""
    psql("drop database if exists teste with (force)", db="postgres")
    rc, o, e = psql("create database teste", db="postgres")
    assert rc == 0, e
    ok(ESQUELETO)
    for m in (ANTES if antes is None else antes):
        ok(open(m, encoding="utf-8").read())


def banco_novo(texto_seq, antes=None):
    banco_base(antes)
    ok(texto_seq)


def monta():
    ok("truncate public.mensagens, public.avisos, public.admin_auditoria, public.lancamentos; delete from public.assinaturas; delete from public.perfis; delete from auth.users;")
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days', ultimo_numero = whatsapp_numero where id = 1")
    ok("insert into auth.users (id) values ('%s'); insert into public.perfis (id, nome, papel) values ('%s', 'Admin', 'admin')" % (ADM, ADM))


def cliente(n, off=False):
    ok("insert into auth.users (id) values ('%s') on conflict do nothing" % uuid(n))
    ok("insert into public.perfis (id, nome, negocio, whats, whats_chave, papel, whats_verificado, avisos_off) values ('%s', 'Pessoa %d', 'Loja %d', '8199999%04d', '8199999%04d', 'cliente', true, %s)"
       % (uuid(n), n, n, n, n, "true" if off else "false"))
    ok("insert into public.assinaturas (user_id, status) values ('%s', 'ativa')" % uuid(n))


def msg(n, quando_sql, texto="oi"):
    ok("insert into public.mensagens (user_id, telefone, texto, criado_em) values ('%s', '5581999990000', '%s', %s)" % (uuid(n), texto, quando_sql))


def lanc(n, quando_sql):
    ok("insert into public.lancamentos (user_id, id, criado_em) values ('%s', 'l' || floor(random() * 1000000)::text, %s)" % (uuid(n), quando_sql))


def aviso(n, regra, etapa, quando_sql, status="enviado", tipo=None):
    t = tipo or ("retencao_nunca" if regra == "nunca_mandou" else "retencao_parou")
    chave = "ret:%s:%s%s" % (regra, uuid(n), "" if etapa == 1 else ":%d" % etapa)
    ok("insert into public.avisos (chave, user_id, tipo, status, criado_em, enviado_em) values ('%s', '%s', '%s', '%s', %s, %s)"
       % (chave, uuid(n), t, status, quando_sql, quando_sql if status == "enviado" else "null"))


def aviso_outro(n, tipo, quando_sql):
    ok("insert into public.avisos (chave, user_id, tipo, status, criado_em, enviado_em) values ('outro:%s:%s', '%s', '%s', 'enviado', %s, %s)" % (tipo, uuid(n), uuid(n), tipo, quando_sql, quando_sql))


def el(regra, atraso, etapa=1):
    rc, o, e = psql("select coalesce(string_agg(replace(user_id::text, '00000000-0000-0000-0000-', '')::int::text, ',' order by user_id), '') from public.retencao_elegiveis('%s', %d, false, %d)" % (regra, atraso, etapa))
    assert rc == 0, e
    return sorted(int(x) for x in o.split(",") if x)


def chama(sql, admin=True):
    return psql("set teste.admin='%s'; set teste.uid='%s'; %s" % ("t" if admin else "f", ADM, sql))


def j(rc_o_e):
    rc, o, e = rc_o_e
    assert rc == 0, e
    return json.loads(o.splitlines()[-1])


falhas = 0


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


TEXTO = "Oi, {nome}! Me manda seus lançamentos por aqui, do seu jeito, que eu anoto."


def suite(texto_seq):
    global falhas
    falhas = 0
    # O que a migration semeia, antes de qualquer ajuste: as etapas 2 e 3 nascem DESLIGADAS, com 96 h e 240 h.
    semeado = ok("select string_agg(regra || ':' || etapa || ':' || ativa || ':' || atraso_horas, ',' order by regra desc, etapa) from public.config_retencao_etapa")
    confere("as etapas 2 e 3 nascem DESLIGADAS (4 dias e 10 dias), nas duas regras", semeado == "parou_de_usar:2:false:96,parou_de_usar:3:false:240,nunca_mandou:2:false:96,nunca_mandou:3:false:240", semeado)
    monta()

    # ---------- nunca_mandou, etapa 1 (a de antes) ----------
    cliente(1); msg(1, H(30))                                              # elegível
    cliente(2); msg(2, H(30)); lanc(2, H(10))                              # lança pelo painel
    cliente(3); msg(3, H(30)); aviso_outro(3, "vencimento", H(20))         # recebeu aviso de vencimento há 20 h: tem que esperar 48 h
    cliente(4); msg(4, H(30)); aviso_outro(4, "vencimento", H(60))         # o aviso de vencimento foi há 60 h: pode
    # ---------- nunca_mandou, etapas 2 e 3 ----------
    cliente(10); msg(10, H(120)); aviso(10, "nunca_mandou", 1, H(110))                          # A: não reagiu, etapa 2 elegível
    cliente(11); msg(11, H(120)); aviso(11, "nunca_mandou", 1, H(110)); msg(11, H(100))         # B: respondeu depois do aviso
    cliente(12); msg(12, H(120))                                                                # C: etapa 1 nunca saiu
    cliente(13); msg(13, H(120)); aviso(13, "nunca_mandou", 1, H(10))                           # D: a etapa 1 saiu há 10 h
    cliente(14); msg(14, H(120)); aviso(14, "nunca_mandou", 1, H(110), status="enviando")       # E: a etapa 1 foi reservada e nunca enviada
    cliente(15); msg(15, H(300)); aviso(15, "nunca_mandou", 1, H(280)); aviso(15, "nunca_mandou", 2, H(100))   # F: etapas 1 e 2 enviadas
    cliente(16); msg(16, H(400)); aviso(16, "nunca_mandou", 1, H(380)); aviso(16, "nunca_mandou", 2, H(250)); aviso(16, "nunca_mandou", 3, H(100))   # G: as três enviadas
    cliente(17); msg(17, H(420)); msg(17, H(410)); lanc(17, H(410))                             # H: 3 mensagens já recebidas somando as duas regras
    aviso(17, "nunca_mandou", 1, H(400)); aviso(17, "nunca_mandou", 2, H(300)); aviso(17, "parou_de_usar", 1, H(200))
    cliente(18); msg(18, H(130)); aviso(18, "nunca_mandou", 1, H(120)); msg(18, H(100), "ok")   # I: respondeu "ok" e nunca lançou
    # ---------- parou_de_usar ----------
    cliente(20); msg(20, H(100)); msg(20, H(99)); lanc(20, H(99))                                # usou e parou
    cliente(21); msg(21, H(100)); msg(21, H(99))                                                 # só conversou: nunca lançou
    cliente(22); msg(22, H(200)); msg(22, H(199)); lanc(22, H(199)); aviso(22, "parou_de_usar", 1, H(80))      # etapa 1 enviada, não reagiu
    cliente(23); msg(23, H(200)); msg(23, H(199)); lanc(23, H(199)); aviso(23, "parou_de_usar", 1, H(80)); lanc(23, H(20))   # voltou a lançar depois do aviso
    # Reagiu ao aviso e DEPOIS sumiu de novo: a inatividade já passou dos 96 h, então só a regra "não reagiu" o segura (a de tempo não)
    cliente(24); msg(24, H(400)); msg(24, H(399)); lanc(24, H(399)); aviso(24, "parou_de_usar", 1, H(300)); lanc(24, H(250))
    # Recebeu a etapa 1, nunca recebeu a 2, e já passou do tempo da etapa 3: não pode pular a etapa 2
    cliente(25); msg(25, H(300)); aviso(25, "nunca_mandou", 1, H(280))

    confere("nunca_mandou etapa 1: 1 e 4 (e o 12, que nunca recebeu); fora o 2 (painel) e o 3 (aviso de vencimento há 20 h)", el("nunca_mandou", 24, 1) == [1, 4, 12], el("nunca_mandou", 24, 1))
    confere("etapa 2 (nunca_mandou, 96 h): o 10 e o 25, que receberam a etapa 1 e não reagiram", el("nunca_mandou", 96, 2) == [10, 25], el("nunca_mandou", 96, 2))
    confere("etapa 3 (nunca_mandou, 240 h): só o 15, que recebeu a 1 e a 2 e não reagiu", el("nunca_mandou", 240, 3) == [15], el("nunca_mandou", 240, 3))
    confere("quem respondeu depois do aviso sai da sequência (11)", 11 not in el("nunca_mandou", 96, 2))
    confere("sem a etapa 1 enviada não há etapa 2 (12), e reserva que nunca saiu (14) também não conta", 12 not in el("nunca_mandou", 96, 2) and 14 not in el("nunca_mandou", 96, 2))
    confere("a etapa 1 enviada há menos de 48 h segura a etapa 2 (13)", 13 not in el("nunca_mandou", 96, 2))
    confere("quem já recebeu as três não recebe mais nada (16)", all(16 not in el("nunca_mandou", a, e) for a, e in ((24, 1), (96, 2), (240, 3))))
    confere("TETO de 3 somando as duas regras: quem já recebeu 3 não entra nem na etapa 2 do parou_de_usar (17)", 17 not in el("parou_de_usar", 96, 2), el("parou_de_usar", 96, 2))
    confere("quem só respondeu 'ok' ao primeiro lembrete NÃO vira 'parou de usar' (18): nunca lançou nada", all(18 not in el(r, a, e) for r, a, e in (("parou_de_usar", 48, 1), ("parou_de_usar", 96, 2), ("nunca_mandou", 96, 2))), el("parou_de_usar", 48, 1))
    confere("parou_de_usar etapa 1: só quem já lançou (20); o 21, que só conversou, não é 'parou de usar'", el("parou_de_usar", 48, 1) == [20], el("parou_de_usar", 48, 1))
    confere("o 21 (só conversou, nunca lançou) também não é 'nunca mandou': fica fora das duas regras", 21 not in el("nunca_mandou", 24, 1))
    confere("parou_de_usar etapa 2: só o 22; o 23 voltou a lançar depois do aviso e sai da sequência", el("parou_de_usar", 96, 2) == [22], el("parou_de_usar", 96, 2))
    confere("quem REAGIU ao aviso e depois sumiu de novo (24) não continua na sequência, mesmo passado o atraso", 24 not in el("parou_de_usar", 96, 2), el("parou_de_usar", 96, 2))
    confere("a etapa 3 não pula a etapa 2: o 25 só recebeu a 1 e não entra na 3", 25 not in el("nunca_mandou", 240, 3), el("nunca_mandou", 240, 3))
    confere("e o 25 é elegível para a etapa 2 (passou do tempo, recebeu a 1 e não reagiu)", 25 in el("nunca_mandou", 96, 2), el("nunca_mandou", 96, 2))
    confere("parâmetros inválidos não devolvem ninguém (etapa 0, 4 ou nula; regra inventada)", el("nunca_mandou", 24, 0) == [] and el("nunca_mandou", 24, 4) == [] and el("inventada", 24, 1) == [])

    # ---------- uma função só, sem versão antiga ----------
    contagem = ok("select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'retencao_elegiveis') || '|' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_retencao_previa')")
    confere("retencao_elegiveis e admin_retencao_previa existem UMA vez cada (sobrecarga faria o PostgREST ficar em dúvida)", contagem == "1|1", contagem)
    rc, o, e = psql("select count(*) from public.retencao_elegiveis(p_regra => 'nunca_mandou', p_atraso => 24, p_ignorar_marco => false)")
    confere("a chamada com 3 argumentos nomeados, como o servidor de antes fazia, ainda resolve (etapa 1 por padrão)", rc == 0 and o == "3", (rc, o, e))

    # ---------- admin: configuração ----------
    cfg = j(chama("select public.admin_retencao_config()"))
    nr = {r["regra"]: r for r in cfg["regras"]}
    confere("a configuração traz as etapas 2 e 3 de cada regra, desligadas", all([e["ativa"] for e in nr[r]["etapas"]] == [False, False] and [e["etapa"] for e in nr[r]["etapas"]] == [2, 3] for r in nr), cfg["regras"])

    def etapa(regra="nunca_mandou", n=2, ativa=True, atraso=96, texto=TEXTO, motivo="teste da sequência", admin=True):
        return chama("select public.admin_retencao_etapa_definir('%s', %s, %s, %s, '%s', '%s')" % (regra, n, "true" if ativa else "false", atraso, texto.replace("'", "''"), motivo), admin=admin)

    r = j(etapa())
    confere("ligar a etapa 2: grava", r["ativa"] is True and r["etapa"] == 2, r)
    aud = psql("select detalhes->>'antes' || '>' || (detalhes->>'depois') || '|etapa ' || (detalhes->>'etapa') || '|' || coalesce(alvo_user_id::text, 'sem alvo') from public.admin_auditoria where acao = 'retencao_etapa'")[1]
    confere("auditoria da etapa: antes e depois, qual etapa e sem cliente alvo", aud == "desligada>ligada|etapa 2|sem alvo", aud)
    for desc, kw, trecho in (
        ("etapa 1 não se muda por aqui", dict(n=1), "esta função muda a etapa 2 ou a 3"),
        ("etapa 4", dict(n=4), "esta função muda a etapa 2 ou a 3"),
        ("atraso da etapa 2 igual ao da etapa 1 (24 h)", dict(atraso=24), "maior que o da etapa 1"),
        ("atraso da etapa 2 maior ou igual ao da etapa 3 (240 h)", dict(atraso=240), "menor que o da etapa 3"),
        ("atraso da etapa 3 menor ou igual ao da etapa 2 (96 h)", dict(n=3, atraso=96), "maior que o da etapa 2"),
        ("etapa 3 ligada sem a 2 ligada (a 2 de parou_de_usar segue desligada)", dict(regra="parou_de_usar", n=3, atraso=300), "ligue a etapa 2 antes"),
        ("atraso 0", dict(atraso=0), "o atraso vai de 1 a 720"),
        ("texto com travessão", dict(texto=TEXTO + " Sem pressa — fica à vontade."), "sem travessão"),
        ("texto com emoji", dict(texto=TEXTO + " Obrigada \U0001F60A"), "sem emoji"),
        ("texto com link", dict(texto=TEXTO + " Veja granninha.com.br"), "sem link"),
        ("texto que fala de SAIR", dict(texto=TEXTO + " Se quiser, responda SAIR."), "não escreva SAIR"),
        ("texto curto", dict(texto="Oi, {nome}!"), "o texto precisa ter"),
        ("motivo curto", dict(motivo="ab"), "motivo obrigatório"),
    ):
        rc, o, e = etapa(**kw)
        confere("etapa recusa: %s" % desc, rc != 0 and trecho in e, e)
    j(etapa(n=3, ativa=True, atraso=240))
    rc, o, e = etapa(n=2, ativa=False)
    confere("desligar a etapa 2 com a 3 ligada é recusado", rc != 0 and "desligue a etapa 3 antes" in e, e)
    j(etapa(n=3, ativa=False, atraso=240))
    rc, o, e = etapa(admin=False)
    confere("quem não é admin: acesso negado", rc != 0 and "acesso negado" in e, e)

    def regra_def(regra="nunca_mandou", modo="desligado", atraso=24, texto=TEXTO, motivo="teste da sequência"):
        return chama("select public.admin_retencao_definir('%s', '%s', %s, '%s', '%s')" % (regra, modo, atraso, texto.replace("'", "''"), motivo))

    rc, o, e = regra_def(atraso=96)
    confere("o atraso da etapa 1 não pode alcançar o da etapa 2 (96 h)", rc != 0 and "menor que o da etapa 2" in e, e)
    j(regra_def(atraso=60))
    rc, o, e = regra_def(texto=TEXTO + " Se quiser, responda SAIR.")
    confere("a regra (etapa 1) segue recusando texto com SAIR", rc != 0 and "não escreva SAIR" in e, e)
    j(regra_def(atraso=24))

    # ---------- admin: prévia e acompanhamento por etapa ----------
    p = j(chama("select public.admin_retencao_previa('nunca_mandou', 96, 2)"))
    confere("a prévia da etapa 2 lista quem receberia (o 10 e o 25)", p["total"] == 2 and {x["nome"] for x in p["itens"]} == {"Pessoa 10", "Pessoa 25"}, p)
    p = j(chama("select public.admin_retencao_previa('nunca_mandou', 24)"))
    confere("a prévia sem etapa continua valendo para a etapa 1 (3 pessoas)", p["total"] == 3, p)
    rc, o, e = chama("select public.admin_retencao_previa('nunca_mandou', 24, 4)")
    confere("a prévia recusa etapa 4", rc != 0 and "a etapa vai de 1 a 3" in e, e)
    ac = j(chama("select public.admin_retencao_acompanhar(30)"))
    cont = {(x["regra"], x["etapa"]): x["enviados"] for x in ac["por_regra"]}
    confere("o acompanhamento separa por etapa: nunca_mandou 8, 3 e 1; parou_de_usar 4 na etapa 1", cont == {("nunca_mandou", 1): 8, ("nunca_mandou", 2): 3, ("nunca_mandou", 3): 1, ("parou_de_usar", 1): 4}, cont)
    confere("a linha do tempo diz a etapa de cada envio", {x["etapa"] for x in ac["ultimos"]} == {1, 2, 3}, [x["etapa"] for x in ac["ultimos"]])
    fila = {(x["regra"], x["etapa"]): x for x in ac["fila"]}
    confere("a fila traz a etapa 1 das duas regras e a etapa 2 de nunca_mandou (a única ligada)", set(fila) == {("nunca_mandou", 1), ("parou_de_usar", 1), ("nunca_mandou", 2)}, set(fila))
    confere("a fila da etapa 2 mostra o 10 e o 25 agora", sorted(x["nome"] for x in fila[("nunca_mandou", 2)]["agora"]) == ["Pessoa 10", "Pessoa 25"], fila.get(("nunca_mandou", 2)))

    # ---------- tabelas, funções e permissões ----------
    priv = ok("""select has_table_privilege('anon','public.config_retencao_etapa','select') || '|' || has_table_privilege('authenticated','public.config_retencao_etapa','select')
                 || '|' || has_table_privilege('authenticated','public.config_retencao_etapa','update') || '|' || has_table_privilege('service_role','public.config_retencao_etapa','select')""")
    rls = ok("select relrowsecurity from pg_class where oid = 'public.config_retencao_etapa'::regclass")
    confere("config_retencao_etapa: fechada ao cliente (RLS ligada), mas o service_role lê", priv == "false|false|false|true" and rls == "t", (priv, rls))
    fn = ok("""select has_function_privilege('anon','public.retencao_elegiveis(text,integer,boolean,integer)','execute') || '|' || has_function_privilege('authenticated','public.retencao_elegiveis(text,integer,boolean,integer)','execute')
               || '|' || has_function_privilege('service_role','public.retencao_elegiveis(text,integer,boolean,integer)','execute')""")
    confere("retencao_elegiveis (assinatura nova): só o service_role executa", fn == "false|false|true", fn)
    aux = ok("select has_function_privilege('anon','public.retencao_texto_erro(text)','execute') || '|' || has_function_privilege('authenticated','public.retencao_texto_erro(text)','execute')")
    confere("o auxiliar de validação do texto não é executável pelo cliente", aux == "false|false", aux)
    adm = ok("""select string_agg(f || '=' || has_function_privilege('anon', 'public.' || f, 'execute') || '/' || has_function_privilege('authenticated', 'public.' || f, 'execute'), ' ')
                from unnest(array['admin_retencao_config()', 'admin_retencao_previa(text,integer,integer)', 'admin_retencao_definir(text,text,integer,text,text)',
                                  'admin_retencao_etapa_definir(text,integer,boolean,integer,text,text)', 'admin_retencao_acompanhar(integer)']) f""")
    confere("funções do admin: anon não executa e authenticated executa (as 5)", adm.count("=false/true") == 5, adm)
    for nome, sql in (("ler", "select public.admin_retencao_config()"), ("prévia", "select public.admin_retencao_previa('nunca_mandou', 24, 1)"), ("acompanhar", "select public.admin_retencao_acompanhar(30)")):
        rc, o, e = chama(sql, admin=False)
        confere("quem não é admin: %s dá acesso negado" % nome, rc != 0 and "acesso negado" in e, e)

    # ---------- rodar de novo não desfaz nada ----------
    j(etapa(n=2, ativa=True, atraso=100))
    ok(texto_seq)
    st = ok("select ativa || '|' || atraso_horas from public.config_retencao_etapa where regra = 'nunca_mandou' and etapa = 2")
    confere("rodar a migration de novo preserva o que o admin configurou (idempotente)", st == "true|100", st)
    return falhas


if os.path.isdir(D):
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    sql_orig = open(MIG, encoding="utf-8").read()
    banco_novo(sql_orig)
    f0 = suite(sql_orig)
    print("\nFALHAS NA MIGRATION: %d" % f0)

    # A migration do acompanhamento (20261122120000) pode ser pulada: esta recria a função. Prova com o banco SEM ela.
    print("\n== sem a migration do acompanhamento (esta cria a função sozinha) ==")
    banco_novo(sql_orig, antes=ANTES[:2])
    f1 = suite(sql_orig)
    print("FALHAS SEM A MIGRATION DO ACOMPANHAMENTO: %d" % f1)
    f0 += f1

    print("\n== provas por mutação (quebra a migration de propósito e o teste tem que cair) ==")
    muts = [
        ("o teto de 3 por pessoa deixa de valer", [("     and v.total_ret < 3\n", "")]),
        ("o intervalo de 48 h desaparece", [("     and (v.ultimo_aviso is null or v.ultimo_aviso <= now() - interval '48 hours')\n", "")]),
        ("o intervalo de 48 h só olha os avisos de retenção (vencimento e fim do teste não contam)", [("(select max(coalesce(av.enviado_em, av.criado_em)) from public.avisos av where av.user_id = u.id) as ultimo_aviso", "(select max(coalesce(av.enviado_em, av.criado_em)) from public.avisos av where av.user_id = u.id and av.tipo in ('retencao_nunca', 'retencao_parou')) as ultimo_aviso")]),
        ("parou_de_usar aceita quem nunca lançou", [("v.qtd >= 2 and v.lancs >= 1 and", "v.qtd >= 2 and")]),
        ("a etapa 2 sai sem a etapa 1 ter sido enviada", [("(p_etapa = 1 or (p_etapa in (2, 3) and v.anterior_em is not null and v.ultima <= v.anterior_em))", "(p_etapa = 1 or (p_etapa in (2, 3) and v.ultima <= coalesce(v.anterior_em, now())))")]),
        ("a sequência continua para quem reagiu à mensagem anterior", [(" and v.anterior_em is not null and v.ultima <= v.anterior_em))", " and v.anterior_em is not null))")]),
        ("a etapa 3 olha a etapa 1 em vez da 2 (pula etapa)", [("case p_etapa when 3 then ':2' else '' end) as anterior_em", "'') as anterior_em")]),
        ("a chave da etapa 2 é a da etapa 1 (a pessoa recebe a mesma etapa de novo)", [("case p_etapa when 1 then '' else ':' || p_etapa::text end) as ja_tem_esta", "'') as ja_tem_esta")]),
        ("as etapas nascem LIGADAS", [("('nunca_mandou', 2, false, 96,", "('nunca_mandou', 2, true, 96,")]),
        ("a etapa 3 liga sem a 2 ligada", [("    if p_ativa and not coalesce(outra_ativa, false) then raise exception 'ligue a etapa 2 antes de ligar a etapa 3' using errcode = '22023'; end if;\n", "")]),
        ("desliga a etapa 2 com a 3 ligada", [("    if not p_ativa and coalesce(outra_ativa, false) then raise exception 'desligue a etapa 3 antes de desligar a etapa 2' using errcode = '22023'; end if;\n", "")]),
        ("o atraso da etapa 2 pode ser menor ou igual ao da etapa 1", [("    if p_atraso <= a1 then raise exception 'o atraso da etapa 2 precisa ser maior que o da etapa 1 (% h)', a1 using errcode = '22023'; end if;\n", "")]),
        ("o atraso da etapa 2 pode alcançar o da etapa 3", [("    if outro_atraso is not null and p_atraso >= outro_atraso then raise exception 'o atraso da etapa 2 precisa ser menor que o da etapa 3 (% h)', outro_atraso using errcode = '22023'; end if;\n", "")]),
        ("o atraso da etapa 3 pode ser menor ou igual ao da etapa 2", [("    if p_atraso <= outro_atraso then raise exception 'o atraso da etapa 3 precisa ser maior que o da etapa 2 (% h)', outro_atraso using errcode = '22023'; end if;\n", "")]),
        ("a etapa 1 pode ter atraso maior ou igual ao da etapa 2", [("  if a2 is not null and p_atraso >= a2 then raise exception 'o atraso da etapa 1 (% h) precisa ser menor que o da etapa 2 (% h)', p_atraso, a2 using errcode = '22023'; end if;\n", "")]),
        ("a etapa muda sem ser admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo obrigatório' using errcode = '22023'; end if;\n  if p_regra not in ('nunca_mandou', 'parou_de_usar') then raise exception 'regra desconhecida' using errcode = '22023'; end if;\n  if p_etapa is null", "  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo obrigatório' using errcode = '22023'; end if;\n  if p_regra not in ('nunca_mandou', 'parou_de_usar') then raise exception 'regra desconhecida' using errcode = '22023'; end if;\n  if p_etapa is null")]),
        ("o texto aceita travessão", [("    when p_texto ~ '[—–]' then 'sem travessão no texto'\n", "")]),
        ("o texto aceita falar de SAIR", [("    when p_texto ~* '\\ysair\\y' then 'não escreva SAIR no texto: a linha do SAIR entra sozinha'\n", "")]),
        ("o cliente passa a executar retencao_elegiveis", [("grant execute on function public.retencao_elegiveis(text, integer, boolean, integer) to service_role;", "grant execute on function public.retencao_elegiveis(text, integer, boolean, integer) to service_role, authenticated;")]),
        ("a função antiga de 3 argumentos fica para trás (sobrecarga)", [("drop function if exists public.retencao_elegiveis(text, integer, boolean);\n", "")]),
        ("a prévia antiga de 2 argumentos fica para trás (sobrecarga)", [("drop function if exists public.admin_retencao_previa(text, integer);\n", "")]),
        ("o acompanhamento não separa por etapa", [("case when a.chave ~ ':2$' then 2 when a.chave ~ ':3$' then 3 else 1 end as etapa", "1 as etapa")]),
        ("a fila lista também as etapas desligadas", [(" where e.ativa) f)", ") f)")]),
        ("a tabela das etapas fica aberta ao cliente", [("revoke all on public.config_retencao_etapa from anon, authenticated;\n", "")]),
        ("a migration deixa de ser idempotente (sobrescreve o que o admin configurou)", [("on conflict (regra, etapa) do nothing;", "on conflict (regra, etapa) do update set ativa = false, atraso_horas = excluded.atraso_horas;")]),
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
