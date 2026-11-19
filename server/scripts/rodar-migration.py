#!/usr/bin/env python3
"""
Aplica uma migration no banco de produção da Granninha, mostrando ANTES e DEPOIS. Quem roda é o
Arthur, pelo terminal (a sessão de IA não aplica DDL em produção).

    /usr/bin/python3 -I server/scripts/rodar-migration.py                 # só mostra o que faria
    /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar evento
    /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar oferta

  evento  20261119120000_mensagens_evento.sql   coluna `evento` + índice: retomada de mensagem presa
          (opcional; sem ela a retomada atende só texto)
  oferta  20261118020000_oferta_ate_31_12.sql   PRAZO 01/12: quem criar conta até 31/12 usa de graça
          até 31/12. Sem ela, cadastro de dezembro pega 7 dias e bate em bloqueio sem como pagar.

Nenhum valor de variável é impresso. Se o endpoint de SQL não existir no self-hosted, o script
imprime o SQL para colar no SQL Editor do Studio.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

APP = "xav797i93gs2kiumpkqhmr4d"  # app "granninha" na Coolify
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = {
    "evento": "20261119120000_mensagens_evento.sql",
    "oferta": "20261118020000_oferta_ate_31_12.sql",
}
# O que olhar antes e depois de cada uma.
CONFERE = {
    "evento": "select count(*) as colunas_evento from information_schema.columns where table_name='mensagens' and column_name='evento'",
    "oferta": "select pg_get_expr(d.adbin, d.adrelid) as default_trial_fim from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum join pg_class c on c.oid=d.adrelid where c.relname='assinaturas' and a.attname='trial_fim'",
}


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


aplicar = "--aplicar" in sys.argv
qual = None
for a in sys.argv[1:]:
    if a in MIGRATIONS:
        qual = a
if not qual:
    sys.exit("diga qual migration: " + " ou ".join(MIGRATIONS) + "  (veja o cabeçalho do arquivo)")

arquivo = os.path.join(RAIZ, "supabase", "migrations", MIGRATIONS[qual])
if not os.path.exists(arquivo):
    sys.exit("não achei " + arquivo)
sql = open(arquivo, encoding="utf-8").read()

coolify = os.environ.get("COOLIFY_URL") or do_zshrc("COOLIFY_URL")
token = os.environ.get("COOLIFY_API_TOKEN") or do_zshrc("COOLIFY_API_TOKEN")
if not coolify or not token:
    sys.exit("COOLIFY_URL/COOLIFY_API_TOKEN não encontrados no ambiente nem no ~/.zshrc")

req = urllib.request.Request("%s/api/v1/applications/%s/envs" % (coolify.rstrip("/"), APP), headers={"Authorization": "Bearer " + token})
try:
    with urllib.request.urlopen(req, timeout=40) as r:
        envs = json.loads(r.read().decode())
except urllib.error.HTTPError as e:
    sys.exit("Coolify respondeu %s ao listar as variáveis do app granninha" % e.code)

conf = {}
for e in envs:
    k = e.get("key") or ""
    v = e.get("real_value") or e.get("value") or ""
    if k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") and v:
        conf[k] = v
if len(conf) < 2:
    sys.exit("não achei SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no app granninha")

BASE = conf["SUPABASE_URL"].rstrip("/")
CHAVE = conf["SUPABASE_SERVICE_ROLE_KEY"]


def consultar(texto_sql):
    """Executa SQL pelo endpoint /pg/query do self-hosted. Devolve (ok, resposta)."""
    pedido = urllib.request.Request(
        BASE + "/pg/query",
        data=json.dumps({"query": texto_sql}).encode(),
        headers={"apikey": CHAVE, "Authorization": "Bearer " + CHAVE, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(pedido, timeout=120) as r:
            return True, r.read().decode()
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode()[:400])
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def mostrar_sql_para_colar():
    print("\nO endpoint de SQL não respondeu. Cole isto no SQL Editor do Studio:")
    print("-" * 70)
    print(sql)
    print("-" * 70)


print("Migration: %s\n" % MIGRATIONS[qual])
ok, antes = consultar(CONFERE[qual])
if not ok:
    print("ANTES: não deu para consultar (%s)" % antes)
    mostrar_sql_para_colar()
    sys.exit(1)
print("ANTES: " + antes.strip()[:400])

if not aplicar:
    print("\nNada foi aplicado. Para aplicar de verdade:")
    print("  /usr/bin/python3 -I server/scripts/rodar-migration.py --aplicar %s" % qual)
    sys.exit(0)

ok, saida = consultar(sql)
print("\nAPLICAR: " + ("ok" if ok else "FALHOU -> " + saida))
if not ok:
    mostrar_sql_para_colar()
    sys.exit(1)

ok, depois = consultar(CONFERE[qual])
print("DEPOIS: " + (depois.strip()[:400] if ok else "não deu para conferir (%s)" % depois))
print("\nPronto. Confira que o DEPOIS mudou em relação ao ANTES.")
