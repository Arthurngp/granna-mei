"""Testa a migration dos lembretes de retenção (elegibilidade, número novo, SAIR, config do admin, permissões, trigger) num Postgres
descartável e prova por mutação (quebra a migration de propósito e confere que o teste cai).
Uso: /usr/bin/python3 server/scripts/testar-retencao.py. Usa o Postgres do Homebrew; cria um cluster temporário e o apaga no fim."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIG = R + "/supabase/migrations/20261121210000_retencao.sql"
D = tempfile.mkdtemp(prefix="pg-retencao-")
PORTA = "55434"
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
-- Como no Supabase: tabela nova nasce com permissão para anon e authenticated (por isso a migration tem que revogar).
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create function public.eh_admin() returns boolean language sql stable as $$ select coalesce(current_setting('teste.admin', true), 'f') = 't' $$;
create table public.perfis (id uuid primary key references auth.users (id), nome text, negocio text, whats text, whats_chave text, papel text not null,
  whats_verificado boolean not null default false, exclusao_em timestamptz);
create table public.assinaturas (user_id uuid primary key references auth.users (id), status text not null, trial_fim date);
create table public.mensagens (id bigint generated always as identity primary key, user_id uuid not null, telefone text, status text not null default 'ok', criado_em timestamptz not null default now());
-- O check original, inline, como em 20261120100000_avisos.sql: a migration tem que achá-lo e trocá-lo mesmo sem saber o nome.
create table public.avisos (chave text primary key, user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null default 'vencimento' check (tipo in ('vencimento')), referencia date not null default current_date, para text not null default 'x',
  status text not null default 'enviando' check (status in ('enviando', 'enviado')), criado_em timestamptz not null default now(), enviado_em timestamptz);
create table public.granninha_saude (id integer primary key, whatsapp_estado text, whatsapp_numero text, fila integer, atualizado_em timestamptz default now());
create table public.admin_auditoria (id bigint generated always as identity primary key, admin_id uuid not null references auth.users (id), acao text not null,
  alvo_user_id uuid references auth.users (id) on delete set null, detalhes jsonb not null default '{}'::jsonb, criado_em timestamptz not null default now());
insert into public.granninha_saude (id, whatsapp_estado, whatsapp_numero) values (1, 'CONNECTED', '5511936192452');
"""

H = lambda h: "now() - interval '%d hours'" % h


def monta():
    """Zera os dados do teste. 1 a 40 são clientes possíveis, 99 é o admin. O número atual está no ar há 45 dias (as datas de mensagem
    do teste ficam todas depois disso, salvo nos casos do número antigo)."""
    ok("truncate public.mensagens, public.avisos, public.admin_auditoria; delete from public.assinaturas; delete from public.perfis; delete from auth.users;")
    ok("update public.config_retencao set modo = 'desligado', atraso_horas = case regra when 'nunca_mandou' then 24 else 48 end")
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days', ultimo_numero = whatsapp_numero where id = 1")


def cliente(n, status="ativa", verificado=True, papel="cliente", exclusao=False, off=False, trial_fim=None, tel=None):
    ok("insert into auth.users (id) values ('%s') on conflict do nothing" % uuid(n))
    ok("insert into public.perfis (id, nome, negocio, whats, whats_chave, papel, whats_verificado, exclusao_em, avisos_off) values ('%s', 'Pessoa %d', 'Loja %d', '8199999%04d', '8199999%04d', '%s', %s, %s, %s)"
       % (uuid(n), n, n, n, n, papel, "true" if verificado else "false", "now()" if exclusao else "null", "true" if off else "false"))
    tf = "null" if trial_fim is None else "current_date + (%d)" % trial_fim
    ok("insert into public.assinaturas (user_id, status, trial_fim) values ('%s', '%s', %s)" % (uuid(n), status, tf))


def msg(n, quando_sql, tel=None):
    ok("insert into public.mensagens (user_id, telefone, criado_em) values ('%s', %s, %s)" % (uuid(n), "null" if tel is None else "'%s'" % tel, quando_sql))


def elegiveis(regra, atraso, ignorar=False):
    rc, o, e = psql("select coalesce(string_agg(replace(user_id::text, '00000000-0000-0000-0000-', '')::int::text, ',' order by user_id), '') from public.retencao_elegiveis('%s', %d, %s)" % (regra, atraso, "true" if ignorar else "false"))
    assert rc == 0, e
    return sorted(int(x) for x in o.split(",") if x)


def chama(sql, admin=True):
    return psql("set teste.admin='%s'; set teste.uid='%s'; %s" % ("t" if admin else "f", ADM, sql))


def json_de(r):
    rc, o, e = r
    assert rc == 0, e
    return json.loads(o.splitlines()[-1])


falhas = 0
EM_TESTE = [""]


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


TEXTO_OK = "Oi, {nome}! Aqui é a Granninha. Me manda seus lançamentos por aqui, do seu jeito."


def suite():
    global falhas
    falhas = 0
    # O que a migration semeia, ANTES de o roteiro mexer em qualquer coisa: as regras têm que nascer desligadas, com 24 h e 48 h.
    semeado = ok("select string_agg(regra || ':' || modo || ':' || atraso_horas, ',' order by regra desc) from public.config_retencao")
    confere("as regras nascem DESLIGADAS (24 h e 48 h), antes de qualquer ajuste", semeado == "parou_de_usar:desligado:48,nunca_mandou:desligado:24", semeado)
    monta()
    ok("insert into auth.users (id) values ('%s') on conflict do nothing; insert into public.perfis (id, nome, papel) values ('%s', 'Admin', 'admin') on conflict do nothing" % (ADM, ADM))

    # ---------- nunca_mandou (24 h) ----------
    cliente(1); msg(1, H(30), "5581999990001")                     # elegível
    cliente(2); msg(2, H(10))                                       # menos de 24 h
    cliente(3); msg(3, H(60)); msg(3, H(50))                       # já usou
    cliente(4); msg(4, "now() - interval '40 days'")               # mais de 30 dias
    cliente(5, verificado=False); msg(5, H(30))                     # número não verificado
    cliente(6, exclusao=True); msg(6, H(30))                        # pediu exclusão
    cliente(7, off=True); msg(7, H(30))                             # respondeu SAIR
    cliente(8, papel="admin"); msg(8, H(30))                        # não é cliente
    cliente(9, status="trial", trial_fim=-2); msg(9, H(30))         # teste vencido: sem acesso
    cliente(10, status="bloqueada"); msg(10, H(30))                 # bloqueado
    cliente(11, status="cortesia"); msg(11, H(30))                  # cortesia tem acesso: elegível
    cliente(12, status="atrasada"); msg(12, H(30))                  # atrasada tem acesso (carência): elegível
    cliente(13, status="trial", trial_fim=3); msg(13, H(30))        # teste valendo: elegível
    cliente(14); msg(14, H(30))                                     # já recebeu esta regra
    ok("insert into public.avisos (chave, user_id, tipo, status) values ('ret:nunca_mandou:%s', '%s', 'retencao_nunca', 'enviado')" % (uuid(14), uuid(14)))
    cliente(15)                                                     # verificado à mão, nunca escreveu: sem contato
    r = elegiveis("nunca_mandou", 24)
    confere("nunca_mandou: só quem confirmou, passou de 24 h, tem acesso e não saiu (1, 11, 12 e 13)", r == [1, 11, 12, 13], r)
    confere("nunca_mandou: 14 (já recebeu) e 15 (nunca escreveu) ficam de fora", 14 not in r and 15 not in r, r)
    confere("o atraso é o configurado: com 8 horas entra também o 2 (10 h)", 2 in elegiveis("nunca_mandou", 8))
    confere("e com 100 horas ninguém passou do atraso", elegiveis("nunca_mandou", 100) == [])
    tel = ok("select telefone from public.retencao_elegiveis('nunca_mandou', 24) where user_id = '%s'" % uuid(1))
    confere("o telefone é o da mensagem recebida", tel == "5581999990001", tel)

    # ---------- parou_de_usar (48 h) ----------
    cliente(20); msg(20, H(100)); msg(20, H(90)); msg(20, H(60), "5581999990020")   # elegível: última há 60 h; o telefone é o da ÚLTIMA
    cliente(21); msg(21, H(80)); msg(21, H(30))                     # última há 30 h: ainda não
    cliente(22); msg(22, H(80))                                     # só 1 mensagem: é do outro grupo
    cliente(23); msg(23, "now() - interval '40 days'"); msg(23, "now() - interval '35 days'")   # sumiu há mais de 30 dias
    r = elegiveis("parou_de_usar", 48)
    confere("parou_de_usar: só quem já usou e está há mais de 48 h parado (20; 3 também, última há 50 h)", r == [3, 20], r)
    confere("parou_de_usar: quem tem 1 mensagem não entra, e quem sumiu há mais de 30 dias também", 22 not in r and 23 not in r and 21 not in r, r)
    tel = ok("select telefone from public.retencao_elegiveis('parou_de_usar', 48) where user_id = '%s'" % uuid(20))
    confere("o telefone é o da ÚLTIMA mensagem", tel == "5581999990020", tel)
    confere("as duas regras nunca se misturam: ninguém é elegível às duas", not (set(elegiveis("nunca_mandou", 24)) & set(elegiveis("parou_de_usar", 48))))
    confere("regra ou atraso inválidos não devolvem ninguém", elegiveis("qualquer", 24) == [] and elegiveis("nunca_mandou", 0) == [] and elegiveis("nunca_mandou", 721) == [])
    ordem = ok("select string_agg(replace(user_id::text, '00000000-0000-0000-0000-', '')::int::text, ',') from public.retencao_elegiveis('parou_de_usar', 48)")
    confere("sai primeiro quem está parado há mais tempo (20, parado há 60 h, antes do 3, há 50 h)", ordem == "20,3", ordem)

    # ---------- o número novo ----------
    # Hoje o número foi trocado: quem só escreveu para o número ANTIGO nunca recebeu contato do novo e não pode receber lembrete.
    ok("update public.granninha_saude set numero_desde = now() - interval '35 hours' where id = 1")
    cliente(30); msg(30, H(60)); msg(30, H(50))                    # parou, mas escreveu SÓ antes do número novo
    cliente(31); msg(31, H(60)); msg(31, H(20))                    # nunca... escreveu depois do marco, mas a última é recente
    cliente(32); msg(32, H(60)); msg(32, H(36)); msg(32, H(30))    # escreveu depois do marco e parou há 30 h
    r = elegiveis("parou_de_usar", 24)
    confere("número novo: quem só escreveu para o número antigo NÃO é elegível (30 e 3 e 20 ficam de fora)", 30 not in r and 3 not in r and 20 not in r, r)
    confere("número novo: quem escreveu depois da troca e parou é elegível (32)", 32 in r, r)
    rn = elegiveis("nunca_mandou", 24)
    confere("número novo: nunca_mandou também exige mensagem depois da troca (1 escreveu há 30 h, depois do marco de 35 h: entra; 11, 12, 13 idem)", rn == [1, 11, 12, 13], rn)
    ok("update public.granninha_saude set numero_desde = now() - interval '5 hours' where id = 1")
    confere("trocou o número há 5 h e ninguém escreveu desde então: ninguém é elegível", elegiveis("nunca_mandou", 24) == [] and elegiveis("parou_de_usar", 24) == [])
    p = json_de(chama("select public.admin_retencao_previa('nunca_mandou', 24)"))
    confere("a prévia conta (5) quem ficou de fora só por causa do número antigo", p["total"] == 0 and p["fora_por_numero_antigo"] == 5, p)
    ok("update public.granninha_saude set numero_desde = null where id = 1")
    confere("sem marco do número não dá para saber quem já falou com ele: ninguém é elegível", elegiveis("nunca_mandou", 24) == [])
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days' where id = 1")

    # ---------- o trigger que registra a troca de número ----------
    ok("update public.granninha_saude set whatsapp_numero = '5511900000001' where id = 1")
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days' where id = 1")
    desde = lambda: ok("select (now() - numero_desde) > interval '40 days' from public.granninha_saude where id = 1")
    ok("update public.granninha_saude set fila = 3 where id = 1")
    confere("trigger: mexer em outra coluna não conta como troca", desde() == "t")
    ok("update public.granninha_saude set whatsapp_numero = null where id = 1")
    ok("update public.granninha_saude set whatsapp_numero = '5511900000001' where id = 1")
    confere("trigger: queda de conexão e volta do MESMO número não conta como troca", desde() == "t")
    ok("update public.granninha_saude set whatsapp_numero = null where id = 1")
    ok("update public.granninha_saude set whatsapp_numero = '5511900000002' where id = 1")
    confere("trigger: outro número depois de uma queda (a troca de chip de verdade) marca o momento", desde() == "f", desde())
    ok("update public.granninha_saude set whatsapp_numero = '5511900000001' where id = 1")
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days' where id = 1")

    # ---------- a config e as funções do admin ----------
    cfg = json_de(chama("select public.admin_retencao_config()"))
    confere("as duas regras nascem DESLIGADAS, com 24 h e 48 h", [(x["regra"], x["modo"], x["atraso_horas"]) for x in cfg["regras"]] == [("nunca_mandou", "desligado", 24), ("parou_de_usar", "desligado", 48)], cfg["regras"])
    confere("a config traz o envio de hoje (o do 14) e o marco do número", cfg["enviados_hoje"] == 1 and cfg["numero_desde"] is not None, cfg)
    p = json_de(chama("select public.admin_retencao_previa('nunca_mandou', 24)"))
    confere("a prévia lista quem receberia (5: 1, 11, 12, 13 e o 22, que só tem o código) com nome e horas", p["total"] == 5 and len(p["itens"]) == 5 and {"nome", "negocio", "horas"} <= set(p["itens"][0]), p)

    def definir(regra="nunca_mandou", modo="ensaio", atraso=24, texto=TEXTO_OK, motivo="teste de config", admin=True):
        return chama("select public.admin_retencao_definir('%s', '%s', %s, '%s', '%s')" % (regra, modo, atraso, texto.replace("'", "''"), motivo), admin=admin)

    r = json_de(definir(modo="piloto", atraso=36))
    confere("definir: grava modo e atraso", r["modo"] == "piloto" and r["atraso_horas"] == 36, r)
    aud = psql("select detalhes->>'antes' || '>' || (detalhes->>'depois') || '|' || (detalhes->>'atraso_antes') || '>' || (detalhes->>'atraso_depois') || '|' || (detalhes->>'texto_alterado') || '|' || coalesce(alvo_user_id::text, 'sem alvo') from public.admin_auditoria where acao = 'retencao_regra'")[1]
    confere("auditoria: modo e atraso de antes e depois, texto alterado e sem cliente alvo", aud == "desligado>piloto|24>36|true|sem alvo", aud)
    json_de(definir(modo="desligado", atraso=24, texto=TEXTO_OK))
    for desc, kw, trecho in (
        ("modo desconhecido", dict(modo="liga"), "modo desconhecido"),
        ("regra desconhecida", dict(regra="outra"), "regra desconhecida"),
        ("atraso 0", dict(atraso=0), "o atraso vai de 1 a 720"),
        ("atraso 721", dict(atraso=721), "o atraso vai de 1 a 720"),
        ("texto curto", dict(texto="Oi, {nome}!"), "o texto precisa ter"),
        ("texto com travessão", dict(texto=TEXTO_OK + " Fica à vontade — sem pressa."), "sem travessão"),
        ("texto com emoji (rosto)", dict(texto=TEXTO_OK + " Qualquer coisa me chama \U0001F60A"), "sem emoji"),
        ("texto com emoji (coração)", dict(texto=TEXTO_OK + " Obrigada ❤"), "sem emoji"),
        ("texto com link", dict(texto=TEXTO_OK + " Veja em https://granninha.com.br"), "sem link"),
        ("texto com site sem http", dict(texto=TEXTO_OK + " Entre em granninha.com.br agora"), "sem link"),
        ("texto que fala de SAIR (a linha entra sozinha)", dict(texto=TEXTO_OK + " Se não quiser, responda SAIR."), "não escreva SAIR"),
        ("motivo vazio", dict(motivo=""), "motivo obrigatório"),
        ("motivo curto", dict(motivo="ab"), "motivo obrigatório"),
    ):
        rc, o, e = definir(**kw)
        confere("definir recusa: %s" % desc, rc != 0 and trecho in e, e)
    rc, o, e = definir(admin=False)
    confere("definir: quem não é admin recebe acesso negado", rc != 0 and "acesso negado" in e, e)
    confere("e nada disso mudou a config", [x["modo"] for x in json_de(chama("select public.admin_retencao_config()"))["regras"]] == ["desligado", "desligado"])
    for nome, sql in (("ler", "select public.admin_retencao_config()"), ("prévia", "select public.admin_retencao_previa('nunca_mandou', 24)")):
        rc, o, e = chama(sql, admin=False)
        confere("quem não é admin: %s dá acesso negado" % nome, rc != 0 and "acesso negado" in e, e)

    # ---------- tabela, avisos e permissões ----------
    ok("insert into public.avisos (chave, user_id, tipo, status) values ('t1', '%s', 'retencao_parou', 'enviado'), ('t2', '%s', 'retencao_nunca', 'enviando'), ('t3', '%s', 'vencimento', 'enviado')" % (uuid(1), uuid(1), uuid(1)))
    rc, o, e = psql("insert into public.avisos (chave, user_id, tipo) values ('t4', '%s', 'qualquer')" % uuid(1))
    confere("avisos: aceita os dois tipos novos e o antigo, e continua recusando tipo inventado", rc != 0 and "check" in e, e)
    rc, o, e = psql("insert into public.config_retencao (regra, modo, atraso_horas, texto) values ('x', 'todos', 5, 'texto qualquer com mais de vinte letras')")
    confere("tabela: regra inventada não entra nem direto", rc != 0 and "check" in e, e)
    rc, o, e = psql("update public.config_retencao set modo = 'ligadissimo' where regra = 'nunca_mandou'")
    confere("tabela: modo inventado não entra nem direto", rc != 0 and "check" in e, e)
    priv = ok("""select has_table_privilege('anon','public.config_retencao','select') || '|' || has_table_privilege('authenticated','public.config_retencao','select')
                 || '|' || has_table_privilege('authenticated','public.config_retencao','update') || '|' || has_table_privilege('service_role','public.config_retencao','select')""")
    rls = ok("select relrowsecurity from pg_class where oid = 'public.config_retencao'::regclass")
    confere("config_retencao: fechada ao cliente (RLS ligada), mas o service_role lê", priv == "false|false|false|true" and rls == "t", (priv, rls))
    fn = ok("""select has_function_privilege('anon','public.retencao_elegiveis(text,integer,boolean)','execute') || '|' || has_function_privilege('authenticated','public.retencao_elegiveis(text,integer,boolean)','execute')
               || '|' || has_function_privilege('service_role','public.retencao_elegiveis(text,integer,boolean)','execute')""")
    confere("retencao_elegiveis: só o service_role executa (devolve nome e telefone de clientes)", fn == "false|false|true", fn)
    adm = ok("""select string_agg(f || '=' || has_function_privilege('anon', 'public.' || f, 'execute') || '/' || has_function_privilege('authenticated', 'public.' || f, 'execute'), ' ')
                from unnest(array['admin_retencao_config()', 'admin_retencao_previa(text,integer)', 'admin_retencao_definir(text,text,integer,text,text)']) f""")
    confere("funções do admin: anon não executa e authenticated executa", adm.count("=false/true") == 3, adm)
    # o client escrevendo no próprio perfil: avisos_off não está no grant de colunas (o teste do esqueleto dá tudo, então confere só a existência)
    padrao_off = ok("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'perfis' and column_name = 'avisos_off'")
    confere("perfis.avisos_off existe e nasce falso", padrao_off == "false", padrao_off)

    # ---------- rodar de novo não desfaz nada ----------
    json_de(definir(modo="todos", atraso=30))
    ok(EM_TESTE[0])
    st = ok("select modo || '|' || atraso_horas from public.config_retencao where regra = 'nunca_mandou'")
    confere("rodar a migration de novo preserva a config do admin (idempotente)", st == "todos|30", st)
    confere("e deixa um único check de tipo em avisos", ok("select count(*) from pg_constraint where conrelid = 'public.avisos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%retencao_nunca%'") == "1")
    return falhas


if os.path.isdir(D):
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    psql("create database teste", db="postgres")
    ok(ESQUELETO)
    sql_orig = open(MIG, encoding="utf-8").read()
    ok(sql_orig)
    EM_TESTE[0] = sql_orig
    f0 = suite()
    print("\nFALHAS NA MIGRATION: %d" % f0)

    print("\n== provas por mutação (quebra a migration de propósito e o teste tem que cair) ==")
    muts = [
        ("o marco do número novo deixa de valer (contato frio passa)", [("where (p_ignorar_marco or u.desde_marco >= 1)", "where true")]),
        ("quem respondeu SAIR continua elegível", [("and p.exclusao_em is null and not p.avisos_off", "and p.exclusao_em is null")]),
        ("quem está sem acesso passa", [("       and (a.status in ('ativa', 'atrasada', 'cortesia') or (a.status = 'trial' and a.trial_fim >= hoje))\n", "")]),
        ("a mesma pessoa pode receber a regra de novo", [("     and not exists (select 1 from public.avisos av where av.user_id = u.id and av.chave = 'ret:' || p_regra || ':' || u.id::text)\n", "")]),
        ("nunca_mandou aceita quem já usou (qtd <= 2)", [("p_regra = 'nunca_mandou' and u.qtd <= 1", "p_regra = 'nunca_mandou' and u.qtd <= 2")]),
        ("conta abandonada há mais de 30 dias passa (parou_de_usar)", [(" and u.ultima >= now() - interval '30 days'", "")]),
        ("o atraso configurado é ignorado (fixo em 1 hora)", [("u.primeira <= now() - make_interval(hours => p_atraso)", "u.primeira <= now() - make_interval(hours => 1)")]),
        ("o telefone vem da mensagem mais antiga", [("(array_agg(m.telefone order by m.criado_em desc))[1]", "(array_agg(m.telefone order by m.criado_em asc))[1]")]),
        ("o trigger não percebe a troca de número", [("if old.ultimo_numero is not null and old.ultimo_numero <> new.whatsapp_numero then", "if false then")]),
        ("as regras nascem LIGADAS", [("('nunca_mandou', 'desligado', 24,", "('nunca_mandou', 'todos', 24,")]),
        ("o admin muda a config sem ser admin", [("  if not public.eh_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;\n  if length(trim(coalesce(p_motivo, ''))) < 3", "  if length(trim(coalesce(p_motivo, ''))) < 3")]),
        ("o texto aceita travessão", [("  if p_texto ~ '[—–]' then raise exception 'sem travessão no texto' using errcode = '22023'; end if;\n", "")]),
        ("o texto aceita link", [("  if p_texto ~* '(https?://|www\\.|\\.com\\y|\\.br\\y)' then raise exception 'sem link no texto' using errcode = '22023'; end if;\n", "")]),
        ("o texto aceita emoji", [("  if p_texto ~ '[\\U0001F000-\\U0001FAFF\\u2190-\\u27BF\\uFE0F]' then raise exception 'sem emoji no texto' using errcode = '22023'; end if;\n", "")]),
        ("o texto aceita falar de SAIR (e a linha do SAIR sairia duplicada)", [("  if p_texto ~* '\\ysair\\y' then raise exception 'não escreva SAIR no texto: a linha do SAIR entra sozinha' using errcode = '22023'; end if;\n", "")]),
        ("o cliente passa a executar retencao_elegiveis (nome e telefone de clientes)", [("grant execute on function public.retencao_elegiveis(text, integer, boolean) to service_role;", "grant execute on function public.retencao_elegiveis(text, integer, boolean) to service_role, authenticated;")]),
        ("a config fica aberta ao cliente", [("revoke all on public.config_retencao from anon, authenticated;\n", "")]),
        ("o service_role perde a leitura da config", [("grant select on public.config_retencao to service_role;", "revoke all on public.config_retencao from service_role;")]),
        ("a migration deixa de ser idempotente (sobrescreve a config do admin)", [("  ('nunca_mandou', 'desligado', 24,\n", "  ('nunca_mandou', 'desligado', 24,\n"), ("on conflict (regra) do nothing;", "on conflict (regra) do update set modo = 'desligado', atraso_horas = excluded.atraso_horas;")]),
    ]
    pegos = 0
    for desc, trocas in muts:
        texto = sql_orig
        for de, para in trocas:
            assert texto.count(de) == 1, "trecho não encontrado exatamente uma vez para: %s\n%s" % (desc, de[:100])
            texto = texto.replace(de, para)
        # banco limpo a cada mutação: derruba o que a migration cria e aplica a versão quebrada
        ok("""truncate public.avisos; drop function if exists public.retencao_elegiveis(text, integer, boolean), public.admin_retencao_config(), public.admin_retencao_previa(text, integer),
              public.admin_retencao_definir(text, text, integer, text, text); drop table if exists public.config_retencao;
              drop trigger if exists granninha_saude_numero on public.granninha_saude; alter table public.granninha_saude drop column if exists numero_desde, drop column if exists ultimo_numero,
              drop column if exists retencao_ciclo_em, drop column if exists retencao_erro; alter table public.perfis drop column if exists avisos_off;
              alter table public.avisos drop constraint if exists avisos_tipo_check; alter table public.avisos add constraint avisos_tipo_check check (tipo in ('vencimento'))""")
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
