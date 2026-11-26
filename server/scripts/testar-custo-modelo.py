"""Prova a migration 20261125120000_custo_por_modelo.sql contra o SCHEMA REAL (todas as migrations em Postgres descartável, ver pg_schema_real.py):
as colunas novas existem, admin_custo_periodo soma o custo medido por dia e por cliente, separa o gasto por modelo e mostra as vezes em que o
modelo escolhido caiu no de fábrica. Mensagem antiga (sem custo_usd) segue contando só pelos tokens, como antes.
Uso: /usr/bin/python3 -I server/scripts/testar-custo-modelo.py"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_schema_real import Banco  # noqa: E402

ADM = "00000000-0000-0000-0000-0000000000aa"
CLI = "00000000-0000-0000-0000-000000000001"
falhas = []


def c(nome, ok):
    print(("  ok    " if ok else "  FALHA ") + nome)
    if not ok:
        falhas.append(nome)


b = Banco()
try:
    b.rodar("insert into auth.users (id, email) values ('%s', 'admin@x.com'), ('%s', 'c@x.com')" % (ADM, CLI))
    b.rodar("update public.perfis set papel='admin', nome='Admin' where id='%s'" % ADM)
    b.rodar("update public.perfis set nome='Cliente', negocio='Loja' where id='%s'" % CLI)
    ch1 = json.dumps([{"tarefa": "interpretacao", "modelo": "gpt-4.1-mini", "entrada": 3000, "saida": 200, "cache": 1000, "usd": 0.00142}])
    ch2 = json.dumps([{"tarefa": "interpretacao", "modelo": "gpt-5.4-mini", "pedido": "gpt-4.1-nano", "entrada": 3000, "saida": 250, "usd": 0.003375},
                      {"tarefa": "resposta", "modelo": "gpt-4.1-mini", "entrada": 1000, "saida": 100, "usd": 0.00056}])
    b.rodar("insert into public.mensagens (id, user_id, telefone, texto, status, tipo, tokens, tokens_entrada, tokens_saida, ia_chamadas, custo_usd) values "
            "('m1', '%s', '5581900000001', 'a', 'ok', 'texto', 3200, 3000, 200, '%s', 0.00142),"
            "('m2', '%s', '5581900000001', 'b', 'ok', 'texto', 4350, 4000, 350, '%s', 0.003935),"
            "('m3', '%s', '5581900000001', 'c', 'ok', 'texto', 1000, 900, 100, null, null)" % (CLI, ch1, CLI, ch2, CLI))
    d = json.loads(b.admin("select public.admin_custo_periodo(current_date - 1, current_date + 1)::text"))
    hoje = [x for x in d["dias"] if x["mensagens"]]
    c("o dia soma o custo medido das 2 mensagens com modelo", len(hoje) == 1 and abs(float(hoje[0]["custo_usd"]) - 0.005355) < 1e-9)
    c("tokens medidos separados dos estimados (3000+4000 de 7900)", hoje and hoje[0]["entrada_medida"] == 7000 and hoje[0]["entrada"] == 7900)
    c("totais contam quantas têm modelo", d["totais"]["com_modelo"] == 2)
    pm = {x["modelo"]: x for x in d["por_modelo"]}
    c("por modelo: gpt-4.1-mini em 2 chamadas", pm.get("gpt-4.1-mini", {}).get("chamadas") == 2)
    c("por modelo: gpt-5.4-mini 1 chamada de reserva, pedida como gpt-4.1-nano", pm.get("gpt-5.4-mini", {}).get("reserva") == 1 and pm["gpt-5.4-mini"].get("pedidos") == ["gpt-4.1-nano"])
    c("por modelo: custo por modelo bate", abs(float(pm["gpt-4.1-mini"]["custo_usd"]) - 0.00198) < 1e-9)
    pc = d["por_cliente"][0]
    c("por cliente: custo medido e tokens medidos", abs(float(pc["custo_usd"]) - 0.005355) < 1e-9 and pc["entrada_medida"] == 7000)
    c("campos de antes continuam (entrada_foto)", "entrada_foto" in pc and "entrada_foto" in hoje[0])
finally:
    b.fim()

print("\n%d falha(s)" % len(falhas) if falhas else "\ncusto por modelo: tudo ok")
sys.exit(1 if falhas else 0)
