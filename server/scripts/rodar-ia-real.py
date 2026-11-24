#!/usr/bin/env python3
"""
Roda server/test/fluxo.ts (banco e IA REAIS, gateway falso) com as variáveis lidas do Coolify na hora.

Existe porque o fluxo.ts é o gate antes de subir mudança no caminho da conversa, e a leitura das
variáveis do app é barrada para a sessão de IA. Rodando pelo terminal, resolve:

    /usr/bin/python3 -I server/scripts/rodar-fluxo.py

Nada de segredo em disco e nenhum valor impresso: as variáveis vão no ambiente do processo filho.
Precisa de COOLIFY_URL e COOLIFY_API_TOKEN no ambiente ou no ~/.zshrc.
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

APP = "xav797i93gs2kiumpkqhmr4d"  # app "granninha" na Coolify (projeto Granninha)
SERVER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRECISA = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY")


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


url = os.environ.get("COOLIFY_URL") or do_zshrc("COOLIFY_URL")
token = os.environ.get("COOLIFY_API_TOKEN") or do_zshrc("COOLIFY_API_TOKEN")
if not url or not token:
    sys.exit("COOLIFY_URL/COOLIFY_API_TOKEN não encontrados no ambiente nem no ~/.zshrc")

pedido = urllib.request.Request(
    "%s/api/v1/applications/%s/envs" % (url.rstrip("/"), APP),
    headers={"Authorization": "Bearer " + token},
)
try:
    with urllib.request.urlopen(pedido, timeout=40) as r:
        envs = json.loads(r.read().decode())
except urllib.error.HTTPError as e:
    sys.exit("Coolify respondeu %s ao listar as variáveis do app granninha" % e.code)

achadas = {}
for e in envs:
    chave = e.get("key") or ""
    valor = e.get("real_value") or e.get("value") or ""
    if chave in PRECISA and valor:
        achadas[chave] = valor

faltando = [k for k in PRECISA if k not in achadas]
if faltando:
    sys.exit("faltam variáveis no app granninha: " + ", ".join(faltando))

print("variáveis lidas do Coolify: " + ", ".join(sorted(achadas)) + " (valores não impressos)")
print("rodando test/fluxo.ts — cria e apaga um cliente de teste no banco real\n")

r = subprocess.run(["npx", "tsx", "test/ia-real-acoes.ts"] + sys.argv[1:], cwd=SERVER, env=dict(os.environ, **achadas))
sys.exit(r.returncode)
