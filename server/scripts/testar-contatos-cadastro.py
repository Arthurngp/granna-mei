"""Prova a migration 20261124160000_contatos_cadastro.sql contra o SCHEMA REAL (todas as migrations em Postgres descartável).

O que está em jogo: o admin passa a poder mandar mensagem, pelo número da Granninha, para um telefone que a pessoa só DIGITOU no cadastro. O teste trava:
  - a lista do admin mostra quem parou no cadastro, quem terminou sem conectar (o buraco de antes) e quem não deixou telefone;
  - número digitado só sai com a autorização PRÓPRIA do admin naquele pedido, e só pelos dois grupos de cadastro (autorizar contato frio não autoriza);
  - SAIR, exclusão pedida, número já confirmado em outra conta e telefone inválido recusam mesmo autorizados;
  - o mesmo número em duas contas não recebe duas vezes, e o freio de 10 por dia do contato frio vale para número digitado;
  - quem já tem o WhatsApp confirmado continua exatamente como antes, e quem chama a função do jeito antigo (2 parâmetros) também.
1) Antes: mostra que a lista não trazia essas pessoas. 2) Depois: confere tudo. 3) Quebra a migration de 13 jeitos e confere que o teste cai em cada um.
Uso: /usr/bin/python3 -I server/scripts/testar-contatos-cadastro.py"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_schema_real import R, Banco  # noqa: E402

MIG = R + "/supabase/migrations/20261124160000_contatos_cadastro.sql"
ANTES = "20261124150000_ia_chaves_anthropic.sql"
ADM = "00000000-0000-0000-0000-0000000000aa"
TXT = "Oi, Pessoa! Aqui é da Granninha. Vi que você começou o cadastro e parou no caminho. Posso te ajudar a terminar?"


def u(n):
    return "00000000-0000-0000-0000-%012d" % n


def pessoa(b, n, idade, fone="", verificado=False, passo=0, feito=False, sair=False, excluida=False, ramo="beleza", ocupacao=None):
    b.rodar("insert into auth.users (id, email) values ('%s', 'k%d@x.com')" % (u(n), n))
    b.rodar("update public.perfis set nome='Pessoa %d', negocio='Loja %d', ramo='%s', ocupacao=%s, whats='%s', onboarding_passo=%d, onboarding_feito=%s, avisos_off=%s, criado_em=now() - interval '%s', exclusao_em=%s where id='%s'"
            % (n, n, ramo, "'%s'" % (ocupacao or ""), fone, passo, "true" if feito else "false", "true" if sair else "false", idade, "now()" if excluida else "null", u(n)))
    if verificado:
        # À parte: o gatilho do perfil derruba a confirmação quando o número muda no mesmo comando.
        b.rodar("update public.perfis set whats_verificado=true where id='%s'" % u(n))
    b.rodar("update public.assinaturas set status='ativa' where user_id='%s'" % u(n))


def cenario(b):
    b.rodar("insert into auth.users (id, email) values ('%s', 'admin@x.com')" % ADM)
    b.rodar("update public.perfis set papel='admin', nome='Admin' where id='%s'" % ADM)
    b.rodar("insert into public.granninha_saude (id, whatsapp_estado, whatsapp_numero) values (1, 'CONNECTED', '5511900002452') on conflict (id) do update set whatsapp_estado='CONNECTED', whatsapp_numero='5511900002452', atualizado_em=now()")
    b.rodar("update public.granninha_saude set numero_desde = now() - interval '45 days' where id = 1")
    # Quem já era da lista (não pode mudar)
    pessoa(b, 21, "30 days", "(81) 97777-0021", verificado=True, passo=7, feito=True)   # usava e sumiu
    pessoa(b, 22, "3 days", "(81) 97777-0022", verificado=True, passo=7, feito=True)    # confirmou e nunca usou
    k = 0
    for n, msgs in ((21, [("ok", "codigo", "-29 days"), ("ok", "paguei 5", "-10 days"), ("ok", "paguei 6", "-9 days")]), (22, [("ok", "codigo", "-2 days")])):
        for status, texto, quando in msgs:
            k += 1
            b.rodar("insert into public.mensagens (id, user_id, telefone, texto, status, criado_em) values ('m%d', '%s', '55819777700%02d', '%s', '%s', now() + interval '%s')" % (k, u(n), n, texto, status, quando))
    # Quem ficou pelo caminho
    pessoa(b, 31, "2 hours", "(81) 98888-0031", passo=2, ramo="outro", ocupacao="tatuador")  # parou no meio do cadastro
    pessoa(b, 32, "5 hours", "(81) 98888-0032", passo=7, feito=True)                        # terminou e não conectou (o buraco)
    pessoa(b, 33, "4 hours", "(81) 98888-0033", passo=6)                                    # parou na tela do código
    pessoa(b, 34, "3 hours")                                                               # criou a conta e não deixou telefone
    pessoa(b, 35, "10 minutes")                                                            # acabou de criar: ainda na primeira tela
    pessoa(b, 36, "2 hours", "(81) 98888-0036", passo=1, sair=True)                         # respondeu SAIR
    pessoa(b, 37, "2 hours", "(81) 98888-0037", passo=1, excluida=True)                     # pediu exclusão
    pessoa(b, 39, "3 hours", "(81) 98888-0038", verificado=True, passo=7, feito=True)       # dona confirmada do número abaixo
    pessoa(b, 38, "2 hours", "(81) 98888-0038", passo=1)                                    # digitou um número que já é de outra conta
    pessoa(b, 40, "1 hours", "81988880031", passo=1)                                        # segunda conta com o MESMO número da 31
    pessoa(b, 41, "3 hours", "12345", passo=1)                                              # telefone inválido
    pessoa(b, 42, "20 days", "(81) 98888-0042", passo=3)                                    # sem acesso (teste vencido)
    b.rodar("update public.assinaturas set status='trial', trial_fim=current_date - 5 where user_id='%s'" % u(42))


def acoes(b):
    return json.loads(b.admin("select (public.admin_acoes())::text"))


def apto(b, n, args=""):
    return b.rodar("select coalesce(telefone, '') || '|' || coalesce(recusa, '') || '|' || frio::text || '|' || coalesce((to_jsonb(x) ->> 'nao_confirmado'), '?') from public.envio_manual_apto('%s'%s) x" % (u(n), args))


def pedir(b, n, grupo, forcar, uid=ADM, texto=TXT):
    rc, o, e = b.psql("set teste.uid='%s'; set role authenticated; select (public.admin_envio_pedir('%s', '%s', $t$%s$t$, %s))::text" % (uid, u(n), grupo, texto, "true" if forcar else "false"))
    return (json.loads(o.splitlines()[-1]) if rc == 0 else None), e


def verdades(b, com_migration=True):
    f = []

    def c(nome, ok, det=""):
        if not ok:
            f.append(nome + ((" -> " + str(det)[:160]) if det != "" else ""))

    a = acoes(b)
    grupo = {x["nome"]: x["grupo"] for x in a["itens"]}
    item = {x["nome"]: x for x in a["itens"]}
    c("lista: quem parou no meio do cadastro com telefone aparece em 'cadastro'", grupo.get("Pessoa 31") == "cadastro", grupo)
    c("lista: quem TERMINOU o cadastro sem confirmar aparece em 'whats' (antes sumia da lista)", grupo.get("Pessoa 32") == "whats", grupo)
    c("lista: quem parou na tela do código continua em 'whats'", grupo.get("Pessoa 33") == "whats", grupo)
    c("lista: quem não deixou telefone aparece em 'semfone', com o e-mail", grupo.get("Pessoa 34") == "semfone" and item.get("Pessoa 34", {}).get("email") == "k34@x.com", item.get("Pessoa 34"))
    c("lista: quem criou a conta há 10 minutos ainda não aparece (carência de 1 hora)", "Pessoa 35" not in grupo, grupo)
    c("lista: telefone inválido conta como sem telefone", grupo.get("Pessoa 41") == "semfone", grupo)
    c("lista: quem pediu exclusão não aparece", "Pessoa 37" not in grupo, grupo)
    c("lista: quem respondeu SAIR aparece marcado (a tela não oferece envio)", item.get("Pessoa 36", {}).get("sair") is True and grupo.get("Pessoa 36") == "cadastro", item.get("Pessoa 36"))
    c("lista: o item diz se o número é confirmado e traz ramo e ocupação", item.get("Pessoa 31", {}).get("verificado") is False and item.get("Pessoa 22", {}).get("verificado") is True
      and item.get("Pessoa 31", {}).get("ocupacao") == "tatuador" and item.get("Pessoa 31", {}).get("ramo") == "outro", item.get("Pessoa 31"))
    c("lista: os grupos de antes não mudaram (sumiu, nunca, sem acesso)", grupo.get("Pessoa 21") == "sumiu" and grupo.get("Pessoa 22") == "nunca" and grupo.get("Pessoa 42") == "bloq", grupo)
    c("lista: a contagem bate com os itens", a["contagem"] == {"sumiu": 1, "nunca": 1, "bloq": 1, "whats": 2, "cadastro": 4, "semfone": 2}, a["contagem"])
    ordem = [x["grupo"] for x in a["itens"]]
    c("lista: sem acesso, sumiram e nunca usaram continuam vindo antes dos grupos de cadastro", ordem[:3] == ["bloq", "sumiu", "nunca"] and ordem[-1] == "semfone", ordem)
    if not com_migration:
        return f

    r = lambda sql: b.rodar("select coalesce(public.whats_para_envio(%s), 'null')" % sql)  # noqa: E731
    c("número: '(81) 98888-0031' vira 5581988880031", r("'(81) 98888-0031'") == "5581988880031")
    c("número: fixo de 10 dígitos ganha o 55", r("'8133334444'") == "558133334444")
    c("número: quem já digitou com 55 não ganha outro", r("'+55 81 98888-0031'") == "5581988880031")
    c("número: lixo, zero na frente e vazio não viram destino", [r("'12345'"), r("'081988880031'"), r("'0819888800'"), r("''"), r("null")] == ["null"] * 5)

    c("conferência: sem autorização, número digitado é recusado", apto(b, 31).startswith("|o WhatsApp desta pessoa não está confirmado"), apto(b, 31))
    c("conferência: a autorização do CONTATO FRIO não libera número digitado", apto(b, 31, ", true").startswith("|o WhatsApp desta pessoa não está confirmado"), apto(b, 31, ", true"))
    c("conferência: com a autorização própria sai o número digitado, com 55, marcado como frio e não confirmado", apto(b, 31, ", false, true") == "5581988880031||true|true", apto(b, 31, ", false, true"))
    c("conferência: SAIR recusa mesmo autorizado", "respondeu SAIR" in apto(b, 36, ", true, true"), apto(b, 36, ", true, true"))
    c("conferência: exclusão pedida recusa mesmo autorizado", "exclusão" in apto(b, 37, ", true, true"), apto(b, 37, ", true, true"))
    c("conferência: número já confirmado em outra conta recusa mesmo autorizado", "outra conta" in apto(b, 38, ", true, true"), apto(b, 38, ", true, true"))
    c("conferência: telefone inválido recusa mesmo autorizado", "telefone válido" in apto(b, 41, ", true, true"), apto(b, 41, ", true, true"))
    c("conferência: quem tem o WhatsApp confirmado continua igual (telefone da última mensagem, do jeito antigo de chamar)", apto(b, 22, ", false") == "5581977770022||false|false", apto(b, 22, ", false"))
    n_def = b.rodar("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('envio_manual_apto','admin_envio_pedir','admin_acoes')")
    c("funções: uma definição só de cada (duas travariam o PostgREST)", n_def == "3", n_def)
    for papel in ("anon", "authenticated"):
        rc, o, e = b.psql("set role %s; select * from public.envio_manual_apto('%s', true, true)" % (papel, u(31)))
        c("permissão: %s não executa a conferência da pessoa (devolve telefone)" % papel, rc != 0)
        rc, o, e = b.psql("set role %s; select public.whats_para_envio('81988880031')" % papel)
        c("permissão: %s não executa whats_para_envio" % papel, rc != 0)
    rc, o, e = b.psql("set role anon; select public.admin_acoes()")
    c("permissão: anônimo não lê a lista", rc != 0)

    ok, e = pedir(b, 31, "cadastro", False)
    c("pedido: sem a confirmação do admin, número digitado é recusado", ok is None and "não está confirmado" in e, e)
    ok, e = pedir(b, 31, "nunca", True)
    c("pedido: 'Enviar mesmo assim' de outro grupo (contato frio) não vale para número digitado", ok is None and "não está confirmado" in e, e)
    ok, e = pedir(b, 31, "cadastro", True, uid=u(22))
    c("pedido: cliente comum não pede envio", ok is None and "acesso negado" in e, e)
    ok, e = pedir(b, 31, "cadastro", True, texto="Oi! Termina seu cadastro em granninha.com.br que eu te ajudo com tudo.")
    c("pedido: texto com link continua recusado", ok is None and "sem link" in e, e)
    ok, e = pedir(b, 31, "semfone", True)
    c("pedido: grupo sem telefone não tem envio", ok is None and "não tem envio" in e, e)
    ok, e = pedir(b, 36, "cadastro", True)
    c("pedido: quem respondeu SAIR não entra na fila nem autorizado", ok is None and "SAIR" in e, e)
    ok, e = pedir(b, 31, "cadastro", True)
    c("pedido: com a confirmação do admin entra na fila", ok is not None and ok.get("ok") and ok.get("nao_confirmado") is True and ok.get("contato_frio") is True, ok or e)
    linha = b.rodar("select grupo || '|' || contato_frio::text || '|' || nao_confirmado::text || '|' || status from public.envios_manuais where user_id='%s'" % u(31))
    c("pedido: a fila guarda o grupo e as duas marcas (o servidor lê para conferir o número antes de enviar)", linha == "cadastro|true|true|fila", linha)
    aud = b.rodar("select detalhes->>'nao_confirmado' from public.admin_auditoria where acao='envio_manual_pedido' and alvo_user_id='%s'" % u(31))
    c("pedido: a auditoria registra que foi para número não confirmado", aud == "true", aud)
    ok, e = pedir(b, 40, "cadastro", True)
    c("pedido: o MESMO número em outra conta não entra na fila de novo", ok is None and "mesmo número" in e, e)
    ok, e = pedir(b, 32, "whats", True)
    c("pedido: quem terminou sem conectar também entra, pelo grupo 'whats'", ok is not None and ok.get("nao_confirmado") is True, ok or e)
    # 8 pedidos frios a mais hoje (2 já existem): o próximo número digitado bate no freio de 10.
    for n in range(101, 109):
        b.rodar("insert into auth.users (id, email) values ('%s', 'f%d@x.com')" % (u(n), n))
        b.rodar("insert into public.envios_manuais (user_id, grupo, texto, contato_frio, status, enviado_em) values ('%s', 'sumiu', $t$%s$t$, true, 'enviado', now())" % (u(n), TXT))
    ok, e = pedir(b, 33, "whats", True)
    c("pedido: número digitado conta no freio de 10 contatos frios por dia", ok is None and "10 envios" in e, ok or e)
    return f


def montar(sql_mig=None):
    b = Banco(ate=ANTES)
    cenario(b)
    if sql_mig is not None:
        rc, o, e = b.psql(sql_mig)
        assert rc == 0, "migration falhou: " + e[-600:]
    return b


# 1) antes: a lista não trazia quem ficou pelo caminho
b = montar()
erros_antes = verdades(b, com_migration=False)
b.fim()
print("ANTES da migration, falham %d verificações da lista (essas pessoas não apareciam):" % len(erros_antes))
for x in erros_antes:
    print("   x", x.split(" -> ")[0])
assert len(erros_antes) >= 5, "o teste não enxerga o problema de antes"

# 2) depois
sql = open(MIG, encoding="utf-8").read()
b = montar(sql)
depois = verdades(b)
print("\nDEPOIS da migration:")
for x in depois:
    print("  FALHA", x)
falhas = len(depois)
print("  " + ("todas as verificações ok" if not falhas else "%d falha(s)" % falhas))
rc, o, e = b.psql(sql)
print("  %s reaplicar a migration não dá erro" % ("ok   " if rc == 0 else "FALHA " + e[-200:]))
falhas += rc != 0
b.fim()

# 3) mutações: cada uma tira UMA trava; o teste tem de cair em todas
MUT = [
    ("número digitado sai sem autorização nenhuma", "    if not coalesce(p_nao_confirmado, false) then", "    if false then"),
    ("a autorização do contato frio libera número digitado", "coalesce(p_forcar, false) and p_grupo in ('whats', 'cadastro'));", "coalesce(p_forcar, false));"),
    ("SAIR deixa de recusar", "  if pf.avisos_off then", "  if false then"),
    ("exclusão pedida deixa de recusar", "  if pf.exclusao_em is not null then", "  if false then"),
    ("número já confirmado em outra conta deixa de recusar", "where o.id <> p_user and o.whats_verificado and o.whats_chave = pf.whats_chave", "where false"),
    ("o mesmo número em duas contas recebe duas vezes", "where e.user_id <> p_user and o.whats_chave = v_chave", "where false"),
    ("número digitado escapa do freio do contato frio", "    return query select tel, pf.nome, null::text, true, true; return;", "    return query select tel, pf.nome, null::text, false, true; return;"),
    ("quem terminou sem confirmar volta a sumir da lista", "and (u.onboarding_passo >= 6 or u.onboarding_feito) then 'whats'", "and (u.onboarding_passo >= 6 and not u.onboarding_feito) then 'whats'"),
    ("sem carência para quem acabou de criar a conta", "and u.criado_em < agora - interval '1 hour' then 'semfone'", "then 'semfone'"),
    ("qualquer sequência de dígitos vira telefone", "when length(x.d) in (10, 11) and left(x.d, 1) <> '0' then '55' || x.d", "when length(x.d) >= 5 then '55' || x.d"),
    ("a fila não aceita os grupos novos", "check (grupo in ('nunca', 'sumiu', 'whats', 'cadastro'))", "check (grupo in ('nunca', 'sumiu'))"),
    ("quem pediu exclusão aparece na lista", "where p.papel = 'cliente' and p.exclusao_em is null\n    ), g as (", "where p.papel = 'cliente'\n    ), g as ("),
    ("a fila não guarda que o número é só digitado", "coalesce(apto.frio, false), coalesce(apto.nao_confirmado, false))\n    on conflict", "coalesce(apto.frio, false), false)\n    on conflict"),
]
pegas = 0
for nome, de, para in MUT:
    if sql.count(de) != 1:
        print("MUTAÇÃO VAZIA (trecho não encontrado, ou mais de um):", nome)
        falhas += 1
        continue
    b = montar(sql.replace(de, para, 1))
    quebrou = verdades(b)
    b.fim()
    print("  %s %s" % ("PEGO  " if quebrou else "PASSOU", nome))
    pegas += bool(quebrou)
    falhas += not quebrou
print("\n%d de %d defeitos pegos | FALHAS: %d" % (pegas, len(MUT), falhas))
sys.exit(1 if falhas else 0)
