"""Testa a função admin_acao (ação "desfazer_cortesia") num Postgres descartável e prova por mutação (quebra a função de propósito
e confere que o teste cai). Uso: /usr/bin/python3 server/scripts/testar-desfazer-cortesia.py
Usa o Postgres do Homebrew; cria um cluster temporário fora do repositório e o apaga no fim."""
import os
import re
import shutil
import subprocess
import sys
import tempfile

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIG_ORIG = R + "/supabase/migrations/20261115210000_admin.sql"
MIG_NOVA = R + "/supabase/migrations/20261121173700_admin_desfazer_cortesia.sql"
D = tempfile.mkdtemp(prefix="pg-desfazer-cortesia-")
PORTA = "55432"
PG = "/opt/homebrew/bin/"


def sh(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit("falhou: %s\n%s" % (" ".join(a), r.stderr[-600:]))
    return r


def psql(sql, db="teste", check=False):
    r = subprocess.run([PG + "psql", "-h", "127.0.0.1", "-p", PORTA, "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


# ---------- cluster temporário ----------
if os.path.isdir(D):
    sh(PG + "pg_ctl", "-D", D, "stop", "-m", "immediate", check=False)
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (PORTA, D), "-l", D + "/log.txt", "-w", "start")
try:
    psql("create database teste", db="postgres")

    esqueleto = """
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
    create function public.eh_admin() returns boolean language sql stable as $$ select coalesce(current_setting('teste.admin', true), 'f') = 't' $$;
    create table public.assinaturas (user_id uuid primary key, status text not null, trial_fim date, prox_cobranca date, motivo text, atualizado_em timestamptz, stripe_subscription_id text,
      constraint assinaturas_status_check check (status in ('trial', 'ativa', 'atrasada', 'bloqueada', 'cortesia')));
    create table public.perfis (id uuid primary key, whats_verificado boolean not null default false);
    create table public.admin_auditoria (id bigint generated always as identity primary key, admin_id uuid not null, acao text not null, alvo_user_id uuid, detalhes jsonb not null default '{}'::jsonb, criado_em timestamptz not null default now());
    """
    rc, o, e = psql(esqueleto)
    assert rc == 0, e

    def uuid(n):
        return "00000000-0000-0000-0000-%012d" % n

    ADM = "00000000-0000-0000-0000-0000000000aa"

    def chama(user, acao, motivo="teste", dias=0, admin=True):
        sql = "set teste.admin='%s'; set teste.uid='%s'; select public.admin_acao('%s','%s','%s',%d)" % ("t" if admin else "f", ADM, uuid(user), acao, motivo, dias)
        return psql(sql)

    def deve_ok(user, acao, motivo="teste", dias=0):
        # Passo de preparação do cenário: se falhar, o teste seria vazio (foi o que escondeu duas mutações), então para na hora.
        r = chama(user, acao, motivo, dias)
        assert r[0] == 0, "preparação falhou: %s %s %r -> %s" % (user, acao, motivo, r[2])
        return r

    def estado(user):
        return psql("select status || '|' || coalesce(trial_fim::text, '') || '|' || coalesce((trial_fim - current_date)::text, '') from public.assinaturas where user_id='%s'" % uuid(user))[1]

    def cria(user, status, dias_trial=None):
        t = "null" if dias_trial is None else "current_date + (%d)" % dias_trial
        psql("insert into public.assinaturas (user_id, status, trial_fim, prox_cobranca) values ('%s','%s',%s,%s) on conflict (user_id) do update set status=excluded.status, trial_fim=excluded.trial_fim" % (uuid(user), status, t, t))
        psql("insert into public.perfis (id) values ('%s') on conflict do nothing" % uuid(user))

    def n_aud(user, acao):
        return int(psql("select count(*) from public.admin_auditoria where alvo_user_id='%s' and acao='%s'" % (uuid(user), acao))[1])

    def instala(texto_sql):
        rc, o, e = psql(texto_sql)
        assert rc == 0, e

    orig = open(MIG_ORIG, encoding="utf-8").read()
    bloco = re.search(r"create function public\.admin_acao.*?\nend \$\$;", orig, re.S).group(0)
    perm = "revoke all on function public.admin_acao(uuid,text,text,integer) from public, anon; grant execute on function public.admin_acao(uuid,text,text,integer) to authenticated;"
    nova_sql = open(MIG_NOVA, encoding="utf-8").read()

    # ---------- regressão: as ações que já existiam, na função ORIGINAL ----------
    def regressao():
        for u in range(100, 110):
            psql("delete from public.admin_auditoria where alvo_user_id='%s'" % uuid(u))
            psql("delete from public.assinaturas where user_id='%s'" % uuid(u))
        cria(101, "trial", 3)
        saidas = []
        for acao, dias in (("estender_teste", 10), ("liberar", 0), ("bloquear", 0), ("voltar_teste", 7), ("cortesia", 0)):
            rc, o, e = chama(101, acao, "regressao", dias)
            saidas.append((acao, rc, estado(101)))
        saidas.append(("estender_teste 0 dias", chama(101, "estender_teste", "regressao", 0)[0], estado(101)))
        saidas.append(("acao desconhecida", chama(101, "inventada", "regressao", 0)[0], estado(101)))
        rc, o, e = chama(101, "verificar_numero", "", 0)
        saidas.append(("verificar", rc, psql("select whats_verificado from public.perfis where id='%s'" % uuid(101))[1]))
        rc, o, e = chama(101, "desverificar_numero", "", 0)
        saidas.append(("desverificar", rc, psql("select whats_verificado from public.perfis where id='%s'" % uuid(101))[1]))
        saidas.append(("sem motivo em liberar", chama(101, "liberar", "", 0)[0], estado(101)))
        return saidas

    instala(bloco + "\n" + perm)
    reg_antes = regressao()
    instala(nova_sql)
    reg_depois = regressao()

    falhas = 0

    def confere(nome, ok, det=""):
        global falhas
        print(("  ok     " if ok else "  FALHOU ") + nome + ("" if ok else "  -> " + str(det)))
        falhas += 0 if ok else 1

    def suite(rotulo):
        global falhas
        falhas = 0
        print("\n== %s ==" % rotulo)
        # reinstala o que está em teste
        for u in range(1, 40):
            psql("delete from public.admin_auditoria where alvo_user_id='%s'" % uuid(u))
            psql("delete from public.assinaturas where user_id='%s'" % uuid(u))
        # S1 trial vigente
        cria(1, "trial", 5)
        o0 = estado(1)
        deve_ok(1, "cortesia", "parceiro")
        confere("cortesia põe a conta em cortesia", estado(1).startswith("cortesia"))
        rc, o, e = chama(1, "desfazer_cortesia", "acabou a parceria")
        confere("trial vigente: desfazer volta ao trial com o MESMO fim de teste", rc == 0 and estado(1) == o0, (rc, e, estado(1), o0))
        confere("o retorno traz a situação e o fim do teste", '"situacao": "trial"' in o and '"trial_fim"' in o, o)
        det = psql("select detalhes->>'antes' || '>' || (detalhes->>'depois') || '|' || (detalhes->>'motivo') from public.admin_auditoria where alvo_user_id='%s' and acao='desfazer_cortesia'" % uuid(1))[1]
        confere("auditoria registra antes=cortesia, depois=trial e o motivo", det == "cortesia>trial|acabou a parceria", det)
        # S11 repetir
        rc, o, e = chama(1, "desfazer_cortesia", "de novo")
        confere("desfazer de novo é recusado (já não está em cortesia)", rc != 0 and "não está em cortesia" in e and estado(1) == o0, (rc, e))
        # S2 ativa
        cria(2, "ativa")
        deve_ok(2, "cortesia", "parceiro")
        deve_ok(2, "desfazer_cortesia", "fim")
        confere("em dia: volta a ativa", estado(2).startswith("ativa"), estado(2))
        # S3 trial vencido
        cria(3, "trial", -10)
        deve_ok(3, "cortesia", "parceiro")
        rc, o, e = chama(3, "desfazer_cortesia", "fim")
        confere("teste vencido: volta ao trial JÁ VENCIDO (sem acesso), sem dar dias de graça", rc == 0 and estado(3).startswith("trial") and int(estado(3).split("|")[2]) == -10, estado(3))
        # S4 bloqueada, S5 atrasada
        cria(4, "bloqueada")
        deve_ok(4, "cortesia", "parceiro")
        deve_ok(4, "desfazer_cortesia", "fim")
        confere("bloqueada: volta a bloqueada (não libera quem estava bloqueado)", estado(4).startswith("bloqueada"), estado(4))
        cria(5, "atrasada")
        deve_ok(5, "cortesia", "parceiro")
        deve_ok(5, "desfazer_cortesia", "fim")
        confere("atrasada: volta a atrasada", estado(5).startswith("atrasada"), estado(5))
        # S6 duas cortesias seguidas
        cria(6, "trial", 4)
        o6 = estado(6)
        deve_ok(6, "cortesia", "parceiro um")
        deve_ok(6, "cortesia", "parceiro dois")
        deve_ok(6, "desfazer_cortesia", "fim")
        confere("cortesia aplicada duas vezes: volta ao que era ANTES da primeira (não a 'cortesia')", estado(6) == o6, (estado(6), o6))
        # S7 não está em cortesia
        cria(7, "ativa")
        rc, o, e = chama(7, "desfazer_cortesia", "fim")
        confere("conta que não é cortesia: recusa e não altera nada", rc != 0 and "não está em cortesia" in e and estado(7).startswith("ativa") and n_aud(7, "desfazer_cortesia") == 0, (rc, e, estado(7)))
        # S8 cortesia sem registro
        cria(8, "cortesia")
        rc, o, e = chama(8, "desfazer_cortesia", "fim")
        confere("cortesia SEM registro na auditoria: recusa, NÃO adivinha e NÃO altera", rc != 0 and "não sei como a conta estava" in e and estado(8).startswith("cortesia") and n_aud(8, "desfazer_cortesia") == 0, (rc, e, estado(8)))
        # S9 sem motivo
        cria(9, "ativa")
        deve_ok(9, "cortesia", "parceiro")
        for m in ("", "  a "):
            rc, o, e = chama(9, "desfazer_cortesia", m)
            confere("motivo %r é recusado e a conta segue em cortesia" % m, rc != 0 and "motivo obrigatório" in e and estado(9).startswith("cortesia"), (rc, e))
        # S10 não admin
        rc, o, e = chama(9, "desfazer_cortesia", "fim", admin=False)
        confere("quem não é admin: acesso negado, e a conta segue em cortesia", rc != 0 and "acesso negado" in e and estado(9).startswith("cortesia"), (rc, e))
        # S12 pega o registro MAIS NOVO
        cria(12, "trial", 6)
        deve_ok(12, "cortesia", "cortesia um")
        deve_ok(12, "desfazer_cortesia", "desfeita um")
        deve_ok(12, "liberar", "pagou")
        deve_ok(12, "cortesia", "cortesia dois")
        deve_ok(12, "desfazer_cortesia", "desfeita dois")
        confere("histórico: usa o ÚLTIMO registro de cortesia (volta a ativa, não ao trial antigo)", estado(12).startswith("ativa"), estado(12))
        # S13 assinatura na Stripe: recusa e não altera
        cria(13, "ativa")
        deve_ok(13, "cortesia", "parceiro com stripe")
        psql("update public.assinaturas set stripe_subscription_id='sub_teste' where user_id='%s'" % uuid(13))
        rc, o, e = chama(13, "desfazer_cortesia", "fim")
        confere("assinatura na Stripe: recusa e a conta segue em cortesia", rc != 0 and "Stripe" in e and estado(13).startswith("cortesia") and n_aud(13, "desfazer_cortesia") == 0, (rc, e, estado(13)))
        # permissões
        p = psql("select has_function_privilege('anon','public.admin_acao(uuid,text,text,integer)','execute') || '|' || has_function_privilege('authenticated','public.admin_acao(uuid,text,text,integer)','execute')")[1]
        confere("permissões: anon não executa, authenticated executa", p == "false|true", p)
        return falhas

    f0 = suite("função NOVA")
    print("\n== regressão: as outras ações ficaram idênticas à função original ==")
    iguais = [(a[0], a[1], a[2]) for a in reg_antes] == [(a[0], a[1], a[2]) for a in reg_depois]
    print("  ", "ok     " if iguais else "FALHOU ", "estender, liberar, bloquear, voltar teste, cortesia, verificar e erros: mesmo resultado antes e depois")
    if not iguais:
        for a, b in zip(reg_antes, reg_depois):
            if a != b:
                print("     antes:", a, "| depois:", b)
        f0 += 1

    # ---------- mutação ----------
    print("\n== provas por mutação (quebra a função de propósito e o teste tem que cair) ==")
    muts = [
        ("sem a checagem de que está em cortesia", "    if antes ->> 'status' is distinct from 'cortesia' then\n      raise exception 'a conta não está em cortesia' using errcode = '22023';\n    end if;\n", ""),
        ("aceita 'antes = cortesia' como estado a restaurar (duas cortesias)", "       and au.detalhes ->> 'antes' in ('trial', 'ativa', 'atrasada', 'bloqueada')\n", ""),
        ("pega o registro mais ANTIGO em vez do mais novo", "order by au.criado_em desc, au.id desc", "order by au.criado_em asc, au.id asc"),
        ("motivo deixa de ser exigido no desfazer", ", 'voltar_teste', 'desfazer_cortesia') and", ", 'voltar_teste') and"),
        ("sem registro, ADIVINHA trial em vez de recusar", "      raise exception 'não sei como a conta estava antes da cortesia (sem registro). Use \"Estender o teste grátis\", \"Liberar como em dia\" ou \"Bloquear acesso\".' using errcode = '22023';\n", "      previo := '{\"antes\":\"trial\"}'::jsonb;\n"),
        ("restaura sempre 'ativa' em vez do estado anterior", "      status = previo ->> 'antes',\n", "      status = 'ativa',\n"),
        ("sem a recusa para conta com assinatura na Stripe", "    if antes ->> 'stripe_subscription_id' is not null then", "    if false then"),
    ]
    pegos = 0
    for desc, de, para in muts:
        assert nova_sql.count(de) == 1, (desc, nova_sql.count(de))
        instala(nova_sql.replace(de, para))
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            f = suite("mutação")
        pego = f > 0
        pegos += pego
        print(("PEGO     " if pego else "NÃO PEGO ") + desc)
        if not pego:
            for ln in buf.getvalue().splitlines():
                if "histórico" in ln or "duas vezes" in ln:
                    print("      ", ln.strip())
            print("       estado u6 =", estado(6), "| estado u12 =", estado(12))
            print("       auditoria u6:", psql("select string_agg(acao || ':' || (detalhes->>'antes') || '>' || (detalhes->>'depois'), ' , ' order by id) from public.admin_auditoria where alvo_user_id='%s'" % uuid(6))[1])
            print("       auditoria u12:", psql("select string_agg(acao || ':' || (detalhes->>'antes') || '>' || (detalhes->>'depois'), ' , ' order by id) from public.admin_auditoria where alvo_user_id='%s'" % uuid(12))[1])
    instala(nova_sql)
    print("%d de %d defeitos pegos" % (pegos, len(muts)))
    print("\nFALHAS NA FUNÇÃO NOVA: %d" % f0)
    sys.exit(1 if (f0 or pegos != len(muts)) else 0)
finally:
    sh(PG + "pg_ctl", "-D", D, "stop", "-m", "immediate", check=False)
    shutil.rmtree(D, ignore_errors=True)
