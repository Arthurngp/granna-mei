"""Testa a migration que faz o lembrete "Nunca mandou nada" valer para quem nunca LANÇOU (e não só para quem nunca escreveu), num Postgres
descartável, com prova por mutação. Reaproveita o esqueleto e os ajudantes do teste da sequência (mesmo banco de mentira, mesmas tabelas).
Uso: /usr/bin/python3 server/scripts/testar-retencao-nunca-lancou.py. Usa o Postgres do Homebrew; cria um cluster temporário e o apaga no fim."""
import contextlib
import io
import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(os.path.dirname(AQUI))
# Os ajudantes (esqueleto do banco, cliente, msg, lanc, aviso, el...) moram no teste da sequência. Carrega só a parte de cima dele, antes da suíte.
fonte = open(AQUI + "/testar-retencao-sequencia.py", encoding="utf-8").read()
assert fonte.count("\ndef suite(") == 1, "o teste da sequência mudou de formato: não achei o começo da suíte"
g = {"__file__": AQUI + "/testar-retencao-sequencia.py", "__name__": "ajudantes"}
exec(compile(fonte.split("\ndef suite(")[0], "testar-retencao-sequencia.py (ajudantes)", "exec"), g)
shutil.rmtree(g["D"], ignore_errors=True)
g["D"] = tempfile.mkdtemp(prefix="pg-nunca-lancou-")
g["PORTA"] = "55441"
D, PG, H = g["D"], g["PG"], g["H"]
sh, psql, ok, monta, cliente, msg, lanc, aviso, el, uuid = (g[k] for k in ("sh", "psql", "ok", "monta", "cliente", "msg", "lanc", "aviso", "el", "uuid"))

BASE = g["ANTES"] + [g["MIG"]]
NOVA = R + "/supabase/migrations/20261125010000_retencao_nunca_lancou.sql"

falhas = 0


def confere(nome, cond, det=""):
    global falhas
    print(("  ok     " if cond else "  FALHOU ") + nome + ("" if cond else "  -> " + str(det)))
    falhas += 0 if cond else 1


def banco(texto):
    """Banco do zero: esqueleto, todas as migrations de retenção já em produção e, por cima, a migration nova (ou a versão quebrada dela)."""
    g["banco_base"](BASE)
    ok(texto)


def horas_de(n):
    rc, o, e = psql("select horas from public.retencao_elegiveis('nunca_mandou', 24, false, 1) where user_id = '%s'" % uuid(n))
    assert rc == 0, e
    return int(o) if o else None


def suite(texto):
    global falhas
    falhas = 0
    monta()
    # ---------- quem entra e quem não entra na 1ª mensagem (24 h) ----------
    cliente(1); msg(1, H(30))                                              # só o código, há 30 h: já entrava, continua entrando
    cliente(2); msg(2, H(60)); msg(2, H(50), "saldo")                      # conversou e nunca lançou (o caso real): passa a entrar
    cliente(3); msg(3, H(60)); msg(3, H(2), "saldo")                       # conversando AGORA: não é interrompido
    cliente(4); msg(4, H(80)); msg(4, H(70), "paguei 50"); lanc(4, H(70))  # já lançou pelo WhatsApp: não é "nunca lançou"
    cliente(5); msg(5, H(80)); lanc(5, H(40))                              # lançou só pelo painel: também não
    cliente(6); msg(6, H(24 * 31)); msg(6, H(100), "oi")                   # confirmou há mais de 30 dias: ficou para trás
    cliente(7, off=True); msg(7, H(60)); msg(7, H(50), "oi")               # pediu SAIR
    cliente(8); msg(8, H(60)); msg(8, H(50), "oi")                         # só falou com o número ANTIGO (o marco vem depois)
    ok("update public.mensagens set criado_em = now() - interval '60 days' where user_id = '%s'" % uuid(8))
    cliente(9); msg(9, H(10))                                              # confirmou há 10 h: ainda não deu o prazo
    confere("1ª mensagem: entram o que só mandou o código (1) e o que conversou e nunca lançou (2)", el("nunca_mandou", 24, 1) == [1, 2], el("nunca_mandou", 24, 1))
    confere("quem está conversando agora não recebe lembrete, mesmo tendo confirmado há dias (3)", 3 not in el("nunca_mandou", 24, 1))
    confere("quem já lançou, pelo WhatsApp (4) ou pelo painel (5), não é 'nunca lançou'", not {4, 5} & set(el("nunca_mandou", 24, 1)))
    confere("fora: confirmou há mais de 30 dias (6), pediu SAIR (7), só falou com o número antigo (8), prazo ainda não deu (9)", not {6, 7, 8, 9} & set(el("nunca_mandou", 24, 1)))
    confere("as horas contam da ÚLTIMA atividade: 50 para quem conversou (2) e 30 para quem só mandou o código (1)", (horas_de(2), horas_de(1)) == (50, 30), (horas_de(2), horas_de(1)))

    # Número trocado há 40 h: quem conversou só ANTES da troca (2, há 60 e 50 h) não recebe; quem escreveu depois (1, há 30 h) recebe.
    ok("update public.granninha_saude set numero_desde = now() - interval '40 hours' where id = 1")
    confere("só recebe quem já escreveu para o número ATUAL: com a troca há 40 h, fica o 1 e sai o 2", el("nunca_mandou", 24, 1) == [1], el("nunca_mandou", 24, 1))
    ok("update public.granninha_saude set numero_desde = now() - interval '45 days' where id = 1")

    # ---------- a sequência continua valendo para o grupo novo ----------
    cliente(10); msg(10, H(200)); msg(10, H(190), "oi"); aviso(10, "nunca_mandou", 1, H(120))                       # recebeu a 1ª e não reagiu
    cliente(11); msg(11, H(200)); msg(11, H(190), "oi"); aviso(11, "nunca_mandou", 1, H(120)); msg(11, H(100), "ok")  # respondeu à 1ª
    cliente(12); msg(12, H(200)); msg(12, H(190), "oi"); aviso(12, "nunca_mandou", 1, H(120)); lanc(12, H(100))        # lançou depois da 1ª
    confere("quem já recebeu a 1ª não recebe a 1ª de novo (10, 11, 12)", not {10, 11, 12} & set(el("nunca_mandou", 24, 1)))
    confere("2ª mensagem: só para quem recebeu a 1ª e não reagiu (10); quem respondeu (11) ou lançou (12) sai da sequência", el("nunca_mandou", 96, 2) == [10], el("nunca_mandou", 96, 2))

    # ---------- "parou de usar" não mudou ----------
    cliente(20); msg(20, H(300)); msg(20, H(290), "paguei 50"); lanc(20, H(290))      # usou e sumiu há 12 dias
    cliente(21); msg(21, H(300)); msg(21, H(290), "paguei 50"); lanc(21, H(10))       # lançou há 10 h
    confere("parou de usar: segue pegando só quem já lançou e sumiu (4, 12 e 20); quem lançou há pouco não (21)", el("parou_de_usar", 48, 1) == [4, 12, 20], el("parou_de_usar", 48, 1))
    confere("quem conversou e nunca lançou (2) NÃO entra em 'parou de usar': recebe pela outra regra, uma vez só", 2 not in el("parou_de_usar", 48, 1))

    # ---------- o que não pode mudar por baixo ----------
    n = ok("select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'retencao_elegiveis'")
    confere("existe UMA só versão da função (duas deixariam o servidor mudo)", n == "1", n)
    priv = ok("select has_function_privilege('anon', 'public.retencao_elegiveis(text,integer,boolean,integer)', 'execute') || '|' || has_function_privilege('authenticated', 'public.retencao_elegiveis(text,integer,boolean,integer)', 'execute') || '|' || has_function_privilege('service_role', 'public.retencao_elegiveis(text,integer,boolean,integer)', 'execute')")
    confere("cliente e anônimo não executam (devolve nome e telefone); o servidor executa", priv == "false|false|true", priv)
    rc, o, e = g["chama"]("select (public.admin_retencao_previa('nunca_mandou', 24, 1)) ->> 'total'")
    confere("a prévia do admin enxerga o grupo novo (2 pessoas agora)", rc == 0 and o.splitlines()[-1] == "2", (rc, o, e))
    antes = el("nunca_mandou", 24, 1)
    ok(texto)
    confere("rodar a migration de novo não muda nada", el("nunca_mandou", 24, 1) == antes)
    return falhas


if os.path.isdir(D):
    shutil.rmtree(D)
sh(PG + "initdb", "-D", D, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale")
sh(PG + "pg_ctl", "-D", D, "-o", "-p %s -c listen_addresses=127.0.0.1 -c unix_socket_directories=%s" % (g["PORTA"], D), "-l", D + "/log.txt", "-w", "start")
try:
    sql = open(NOVA, encoding="utf-8").read()

    # Antes da migration, o caso real fica de fora: é o defeito que ela conserta. Se isto não falhar, o teste não prova nada.
    g["banco_base"](BASE)
    monta()
    cliente(2); msg(2, H(60)); msg(2, H(50), "saldo")
    antes = el("nunca_mandou", 24, 1)
    print("antes da migration, quem conversou e nunca lançou recebe? %s" % ("SIM (inesperado)" if antes else "não (é o buraco)"))
    f0 = 1 if antes else 0

    banco(sql)
    f0 += suite(sql)
    print("\nFALHAS NA MIGRATION: %d" % f0)

    print("\n== provas por mutação (quebra a migration de propósito e o teste tem que cair) ==")
    muts = [
        ("volta a exigir no máximo uma mensagem", [("(p_regra = 'nunca_mandou' and v.lancs = 0 and", "(p_regra = 'nunca_mandou' and v.qtd <= 1 and v.lancs = 0 and")]),
        ("deixa de exigir zero lançamentos", [("(p_regra = 'nunca_mandou' and v.lancs = 0 and", "(p_regra = 'nunca_mandou' and")]),
        ("o prazo volta a contar da primeira mensagem (interrompe quem está conversando)", [("v.lancs = 0 and v.ultima <= now() - make_interval(hours => p_atraso) and v.primeira >=", "v.lancs = 0 and v.primeira <= now() - make_interval(hours => p_atraso) and v.primeira >=")]),
        ("some o teto de 30 dias", [(" and v.primeira >= now() - interval '30 days')", ")")]),
        ("as horas voltam a contar da primeira mensagem", [("floor(extract(epoch from (now() - v.ultima)) / 3600)::integer", "floor(extract(epoch from (now() - v.primeira)) / 3600)::integer")]),
        ("parou de usar passa a aceitar quem nunca lançou (a pessoa receberia pelas duas regras)", [("v.qtd >= 2 and v.lancs >= 1 and", "v.qtd >= 2 and")]),
        ("o cliente passa a executar a função", [("grant execute on function public.retencao_elegiveis(text, integer, boolean, integer) to service_role;", "grant execute on function public.retencao_elegiveis(text, integer, boolean, integer) to service_role, authenticated;")]),
        ("SAIR deixa de valer", [(" and p.exclusao_em is null and not p.avisos_off", " and p.exclusao_em is null")]),
        ("quem só falou com o número antigo passa a receber", [("   where (p_ignorar_marco or v.desde_marco >= 1)\n", "   where true\n")]),
        ("a 2ª mensagem sai para quem reagiu à 1ª", [(" and v.anterior_em is not null and v.ultima <= v.anterior_em))", " and v.anterior_em is not null))")]),
    ]
    pegos = 0
    for desc, trocas in muts:
        texto = sql
        for de, para in trocas:
            assert texto.count(de) == 1, "trecho não encontrado exatamente uma vez para: %s\n%s" % (desc, de[:120])
            texto = texto.replace(de, para)
        g["banco_base"](BASE)  # se a base falhar, o erro sobe e derruba o teste (não conta como defeito pego)
        rc, o, e = psql(texto)
        if rc != 0:
            print("MUTAÇÃO INVÁLIDA (o SQL quebrado nem aplica): " + desc + " -> " + e[:160])
            continue
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            f = suite(texto)  # a preparação da suíte não depende do trecho quebrado: se ela falhar, o erro sobe (não é defeito pego)
        pego = f > 0
        pegos += pego
        print(("PEGO     " if pego else "NÃO PEGO ") + desc)
    print("%d de %d defeitos pegos" % (pegos, len(muts)))
    sys.exit(1 if (f0 or pegos != len(muts)) else 0)
finally:
    sh(PG + "pg_ctl", "-D", D, "-m", "immediate", "stop", check=False)
    shutil.rmtree(D, ignore_errors=True)
