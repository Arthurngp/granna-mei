#!/usr/bin/env python3
"""
Mede no banco REAL quanto das falhas da fase "Conversa sem falha" já aconteceu. SÓ LEITURA: nenhum
INSERT, UPDATE ou DELETE. Nenhum valor de variável é impresso.

    /usr/bin/python3 -I server/scripts/medir-conversa.py [dias]

Conta, nos últimos N dias (padrão 30):
  1. mensagens por status, e quantas ficaram presas em 'recebida' (processo morreu no meio);
  2. os erros mais comuns, inclusive resposta não entregue;
  3. lançamentos iguais em poucos minutos (o lançamento em dobro), separando mídia de texto;
  4. DESFAZER logo depois de uma mensagem que não gravou nada (o desfazer que pegava a coisa errada).

Precisa de COOLIFY_URL e COOLIFY_API_TOKEN no ambiente ou no ~/.zshrc.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

APP = "xav797i93gs2kiumpkqhmr4d"  # app "granninha" na Coolify
DIAS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
MIDIA = {"audio", "foto", "pdf"}


def do_zshrc(nome):
    caminho = os.path.expanduser("~/.zshrc")
    if not os.path.exists(caminho):
        return None
    with open(caminho, encoding="utf-8", errors="ignore") as f:
        for linha in f:
            m = re.match(r"\s*export\s+%s=(.+)" % re.escape(nome), linha)
            if m:
                v = m.group(1).strip()
                if v[:1] in "\"'" and v[-1:] == v[:1]:
                    v = v[1:-1]
                return v.strip()
    return None


def http_json(url, headers):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit("%s respondeu %s: %s" % (url.split("?")[0], e.code, e.read().decode()[:300]))


coolify = os.environ.get("COOLIFY_URL") or do_zshrc("COOLIFY_URL")
token = os.environ.get("COOLIFY_API_TOKEN") or do_zshrc("COOLIFY_API_TOKEN")
if not coolify or not token:
    sys.exit("COOLIFY_URL/COOLIFY_API_TOKEN não encontrados no ambiente nem no ~/.zshrc")

envs = http_json("%s/api/v1/applications/%s/envs" % (coolify.rstrip("/"), APP), {"Authorization": "Bearer " + token})
conf = {}
for e in envs:
    chave = e.get("key") or ""
    valor = e.get("real_value") or e.get("value") or ""
    if chave in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") and valor:
        conf[chave] = valor
if len(conf) < 2:
    sys.exit("não achei SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no app granninha")

BASE = conf["SUPABASE_URL"].rstrip("/") + "/rest/v1"
H = {"apikey": conf["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": "Bearer " + conf["SUPABASE_SERVICE_ROLE_KEY"]}
desde = (datetime.now(timezone.utc) - timedelta(days=DIAS)).isoformat()


def tudo(tabela, campos, filtro):
    """Lê a tabela inteira de mil em mil (o PostgREST corta em 1000 por pedido)."""
    saida, passo = [], 1000
    for i in range(200):
        url = "%s/%s?select=%s&%s&order=criado_em.asc&limit=%d&offset=%d" % (BASE, tabela, campos, filtro, passo, i * passo)
        pagina = http_json(url, H)
        saida += pagina
        if len(pagina) < passo:
            break
    return saida


print("Medindo os últimos %d dias (desde %s)\n" % (DIAS, desde[:10]))

msgs = tudo("mensagens", "id,user_id,telefone,tipo,texto,status,intencao,erro,efeitos,criado_em", "criado_em=gte." + urllib.parse.quote(desde))
print("1. MENSAGENS: %d no período" % len(msgs))
for st, n in Counter(m.get("status") for m in msgs).most_common():
    print("   %-10s %d" % (st, n))
presas = [m for m in msgs if m.get("status") == "recebida"]
print("   presas em 'recebida': %d%s" % (len(presas), "" if not presas else "  <= cada uma é uma mensagem que o cliente mandou e nunca teve resposta"))
for m in presas[:10]:
    print("      %s · %s · %s · erro=%s · %s" % (m["criado_em"][:19], m.get("telefone"), m.get("tipo"), m.get("erro"), (m.get("texto") or "")[:40]))

print("\n2. ERROS")
erros = [m for m in msgs if m.get("erro")]
if not erros:
    print("   nenhum erro registrado no período")
for e, n in Counter(re.sub(r"\d+", "N", (m["erro"] or ""))[:90] for m in erros).most_common(12):
    print("   %3dx %s" % (n, e))
nao_entregue = [m for m in erros if "não entregue" in (m["erro"] or "")]
print("   respostas não entregues: %d" % len(nao_entregue))

lancs = tudo("lancamentos", "id,user_id,tipo,valor,descricao,origem,criado_em", "criado_em=gte." + urllib.parse.quote(desde))
print("\n3. LANÇAMENTO EM DOBRO (igual em menos de 5 minutos): %d lançamentos no período" % len(lancs))
por_chave = defaultdict(list)
for l in lancs:
    por_chave[(l.get("user_id"), l.get("tipo"), round(float(l.get("valor") or 0), 2))].append(l)
suspeitos = {"midia": [], "texto": [], "misto": []}
for chave, lista in por_chave.items():
    lista.sort(key=lambda x: x["criado_em"])
    for a, b in zip(lista, lista[1:]):
        ta = datetime.fromisoformat(a["criado_em"].replace("Z", "+00:00"))
        tb = datetime.fromisoformat(b["criado_em"].replace("Z", "+00:00"))
        if (tb - ta).total_seconds() > 300:
            continue
        oa, ob = (a.get("origem") or "texto"), (b.get("origem") or "texto")
        grupo = "midia" if oa in MIDIA and ob in MIDIA else "texto" if oa not in MIDIA and ob not in MIDIA else "misto"
        suspeitos[grupo].append((b["criado_em"][:19], chave[2], a.get("descricao"), oa, ob))
for grupo, lista in suspeitos.items():
    print("   %-6s %d par(es)" % (grupo, len(lista)))
    for x in lista[:8]:
        print("      %s · R$ %s · %s · %s -> %s" % x)
print("   (mídia é o caso que a trava nova pergunta; texto pode ser venda legítima repetida)")

print("\n4. DESFAZER DEPOIS DE MENSAGEM SEM EFEITO")
por_user = defaultdict(list)
for m in msgs:
    if m.get("user_id"):
        por_user[m["user_id"]].append(m)
achados = 0
for uid, lista in por_user.items():
    lista.sort(key=lambda x: x["criado_em"])
    for ant, atual in zip(lista, lista[1:]):
        if atual.get("intencao") != "desfazer":
            continue
        ef = ant.get("efeitos") or {}
        vazio = not any(isinstance(v, list) and v for v in ef.values())
        if vazio:
            achados += 1
            print("   %s · antes: %-30s (intenção %s, sem efeito) · depois: desfazer" % (atual["criado_em"][:19], (ant.get("texto") or "")[:30], ant.get("intencao")))
print("   total: %d. Cada um desses é um DESFAZER que ia na mensagem errada." % achados)
print("\nPronto. Nada foi alterado no banco.")
