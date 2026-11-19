#!/usr/bin/env python3
"""
Onde cada pessoa travou, do cadastro até o primeiro lançamento (item f7-funil do backlog). SÓ LEITURA.

    /usr/bin/python3 -I server/scripts/medir-funil.py [dias]
    /usr/bin/python3 -I server/scripts/medir-funil.py --teste    # prova as contas, sem banco

Existe porque "7 de 9 contas nunca lançaram nada" não diz POR QUE. Os marcos são:
  conta criada -> onboarding terminado -> número confirmado no WhatsApp -> mandou mensagem -> lançou algo
E, para quem conversou e não registrou nada, mostra o que essas mensagens eram (tipo, status, intenção
e um trecho) — é aí que aparece se a pessoa só confirmou o número, se a Granninha não entendeu, ou se
ela bateu em bloqueio.

Telefone sai mascarado e o texto é cortado: é diagnóstico de funil, não leitura de conversa.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

APP = "xav797i93gs2kiumpkqhmr4d"
SP = timezone(timedelta(hours=-3))


def instante(iso):
    """Timestamp do Postgres, tolerante (o python 3.9 do macOS recusa fração de 5 dígitos)."""
    s = str(iso).strip().replace("z", "Z").replace("Z", "+00:00")
    m = re.match(r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2}:?\d{2})?$", s)
    if not m:
        raise ValueError("timestamp que não reconheço: %r" % iso)
    base, frac, fuso = m.group(1), m.group(2) or "", m.group(3) or "+00:00"
    if ":" not in fuso:
        fuso = fuso[:3] + ":" + fuso[3:]
    return datetime.fromisoformat("%s.%s%s" % (base.replace(" ", "T"), (frac + "000000")[:6], fuso))


def dia(iso):
    return instante(iso).astimezone(SP).strftime("%d/%m %Hh")


def mascara(tel):
    t = re.sub(r"\D", "", str(tel or ""))
    return ("…" + t[-4:]) if len(t) >= 4 else (t or "-")


def montar(perfis, assinaturas, msgs, lancs):
    """Parte pura: devolve uma linha por pessoa com os marcos e as mensagens dela."""
    ass = {a["user_id"]: a for a in assinaturas}
    por_user_msgs = defaultdict(list)
    for m in msgs:
        if m.get("user_id"):
            por_user_msgs[m["user_id"]].append(m)
    n_lancs = defaultdict(int)
    for l in lancs:
        n_lancs[l["user_id"]] += 1

    linhas = []
    for p in perfis:
        a = ass.get(p["id"], {})
        minhas = sorted(por_user_msgs.get(p["id"], []), key=lambda x: x["criado_em"])
        linhas.append({
            "id": p["id"],
            "nome": (p.get("nome") or "?").split(" ")[0] or "?",
            "papel": p.get("papel") or "cliente",
            "criada": dia(p["criado_em"]) if p.get("criado_em") else "?",
            "onboarding": "fim" if p.get("onboarding_feito") else "passo %s" % p.get("onboarding_passo", "?"),
            "verificado": bool(p.get("whats_verificado")),
            "whats": mascara(p.get("whats")),
            "assinatura": a.get("status") or "-",
            "msgs": len(minhas),
            "lancs": n_lancs.get(p["id"], 0),
            "detalhe": minhas,
        })
    linhas.sort(key=lambda x: (-x["lancs"], -x["msgs"], x["nome"]))
    return linhas


def onde_parou(l):
    """O marco mais avançado que a pessoa alcançou."""
    if l["lancs"]:
        return "lançou"
    if l["msgs"]:
        return "conversou, não lançou"
    if l["verificado"]:
        return "confirmou o número, nunca falou"
    if l["onboarding"] == "fim":
        return "terminou o cadastro, não confirmou o número"
    return "parou no cadastro (%s)" % l["onboarding"]


def imprimir(linhas):
    clientes = [l for l in linhas if l["papel"] != "admin"]
    print("1. FUNIL (só contas de cliente: %d de %d linhas)" % (len(clientes), len(linhas)))
    marcos = defaultdict(int)
    for l in clientes:
        marcos[onde_parou(l)] += 1
    for marco, n in sorted(marcos.items(), key=lambda x: -x[1]):
        print("   %-45s %d" % (marco, n))

    print("\n2. POR PESSOA")
    print("   %-10s %-8s %-11s %-14s %-5s %-12s %5s %6s  %s" % ("nome", "papel", "conta de", "onboarding", "núm", "assinatura", "msgs", "lancs", "onde parou"))
    for l in linhas:
        print("   %-10s %-8s %-11s %-14s %-5s %-12s %5d %6d  %s"
              % (l["nome"][:10], l["papel"][:8], l["criada"], l["onboarding"], "sim" if l["verificado"] else "não",
                 l["assinatura"][:12], l["msgs"], l["lancs"], onde_parou(l)))

    travados = [l for l in linhas if l["msgs"] and not l["lancs"] and l["papel"] != "admin"]
    print("\n3. QUEM CONVERSOU E NÃO LANÇOU NADA (%d pessoa(s))" % len(travados))
    if not travados:
        print("   ninguém: todo mundo que falou com ela registrou algo")
    for l in travados:
        print("\n   %s (%s · conta de %s · número %s)" % (l["nome"], l["whats"], l["criada"], "confirmado" if l["verificado"] else "NÃO confirmado"))
        for m in l["detalhe"][:8]:
            texto = re.sub(r"\s+", " ", (m.get("texto") or "")).strip()
            if re.fullmatch(r"\D{0,30}\d{6}\D{0,30}", texto or ""):
                texto = "[código de 6 dígitos]"
            print("      %s · %-7s · %-9s · %-10s · %s"
                  % (dia(m["criado_em"]), m.get("tipo") or "?", m.get("status") or "?", m.get("intencao") or "-", texto[:60]))
        if len(l["detalhe"]) > 8:
            print("      (+%d mensagens)" % (len(l["detalhe"]) - 8))


# ---------------------------------------------------------------- teste
if "--teste" in sys.argv:
    erros = []

    def conferir(o_que, veio, esperado):
        if veio != esperado:
            erros.append("%s: veio %r, esperado %r" % (o_que, veio, esperado))

    # formatos reais de timestamp, inclusive o que derrubou o medir-habito
    for bruto in ["2026-11-16T15:11:44.95071+00:00", "2026-11-16T15:11:44.9+00:00", "2026-11-16T15:11:44Z", "2026-11-16T15:11:44.123+0000", "2026-11-16T15:11:44"]:
        try:
            dia(bruto)
        except Exception as e:  # noqa: BLE001
            erros.append("timestamp %s -> %s" % (bruto, e))
    conferir("mascara de telefone", mascara("5581988887777"), "…7777")
    conferir("mascara sem telefone", mascara(""), "-")

    perfis = [
        {"id": "u1", "nome": "Ana Souza", "papel": "cliente", "criado_em": "2026-11-16T12:00:00.95071+00:00", "onboarding_feito": True, "whats_verificado": True, "whats": "5581911112222"},
        {"id": "u2", "nome": "Bruno Lima", "papel": "cliente", "criado_em": "2026-11-16T12:00:00Z", "onboarding_feito": True, "whats_verificado": True, "whats": "5581933334444"},
        {"id": "u3", "nome": "Carla Dias", "papel": "cliente", "criado_em": "2026-11-17T12:00:00Z", "onboarding_feito": True, "whats_verificado": False, "whats": "5581955556666"},
        {"id": "u4", "nome": "Davi Melo", "papel": "cliente", "criado_em": "2026-11-17T12:00:00Z", "onboarding_feito": False, "onboarding_passo": 3, "whats_verificado": False, "whats": ""},
        {"id": "u5", "nome": "Admin Teste", "papel": "admin", "criado_em": "2026-11-15T12:00:00Z", "onboarding_feito": True, "whats_verificado": True, "whats": "5581977778888"},
    ]
    assinaturas = [{"user_id": "u%d" % i, "status": "trial"} for i in range(1, 6)]
    msgs = [
        {"user_id": "u1", "criado_em": "2026-11-16T13:00:00.5+00:00", "tipo": "texto", "status": "ok", "intencao": "acoes", "texto": "paguei 50 de gasolina"},
        {"user_id": "u2", "criado_em": "2026-11-16T13:00:00Z", "tipo": "texto", "status": "ok", "intencao": None, "texto": "meu codigo 123456"},
        {"user_id": "u2", "criado_em": "2026-11-16T14:00:00Z", "tipo": "texto", "status": "ignorada", "intencao": "ajuda", "texto": "como funciona isso aqui?"},
    ]
    lancs = [{"user_id": "u1", "criado_em": "2026-11-16T13:00:00.5+00:00"}]
    linhas = montar(perfis, assinaturas, msgs, lancs)
    por_nome = {l["nome"]: l for l in linhas}
    conferir("Ana lançou", onde_parou(por_nome["Ana"]), "lançou")
    conferir("Bruno conversou e não lançou", onde_parou(por_nome["Bruno"]), "conversou, não lançou")
    conferir("Carla terminou cadastro sem confirmar", onde_parou(por_nome["Carla"]), "terminou o cadastro, não confirmou o número")
    conferir("Davi parou no cadastro", onde_parou(por_nome["Davi"]), "parou no cadastro (passo 3)")
    conferir("Admin é admin", por_nome["Admin"]["papel"], "admin")
    conferir("Bruno tem 2 mensagens", por_nome["Bruno"]["msgs"], 2)
    conferir("Ana tem 1 lançamento", por_nome["Ana"]["lancs"], 1)
    conferir("ordem: quem lançou vem primeiro", linhas[0]["nome"], "Ana")
    conferir("telefone de Bruno mascarado", por_nome["Bruno"]["whats"], "…4444")
    if erros:
        print("FALHOU:")
        for e in erros:
            print("  -", e)
        sys.exit(1)
    print("as contas estão certas (%d conferências)\n" % 16)
    imprimir(linhas)
    sys.exit(0)

# ---------------------------------------------------------------- produção
DIAS = int([a for a in sys.argv[1:] if a.isdigit()][0]) if [a for a in sys.argv[1:] if a.isdigit()] else 60


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
    k = e.get("key") or ""
    v = e.get("real_value") or e.get("value") or ""
    if k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") and v:
        conf[k] = v
if len(conf) < 2:
    sys.exit("não achei SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no app granninha")

BASE = conf["SUPABASE_URL"].rstrip("/") + "/rest/v1"
H = {"apikey": conf["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": "Bearer " + conf["SUPABASE_SERVICE_ROLE_KEY"]}
desde = (datetime.now(timezone.utc) - timedelta(days=DIAS)).isoformat()


def tudo(tabela, campos, filtro=""):
    saida, passo = [], 1000
    for i in range(200):
        url = "%s/%s?select=%s&limit=%d&offset=%d%s" % (BASE, tabela, campos, passo, i * passo, ("&" + filtro if filtro else ""))
        pagina = http_json(url, H)
        saida += pagina
        if len(pagina) < passo:
            break
    return saida


print("Funil do cadastro ao primeiro lançamento (últimos %d dias)\n" % DIAS)
f = "criado_em=gte." + urllib.parse.quote(desde)
perfis = tudo("perfis", "id,nome,papel,criado_em,onboarding_feito,onboarding_passo,whats_verificado,whats")
assinaturas = tudo("assinaturas", "user_id,status,trial_fim")
msgs = tudo("mensagens", "user_id,criado_em,tipo,status,intencao,texto", f)
lancs = tudo("lancamentos", "user_id,criado_em", f)
imprimir(montar(perfis, assinaturas, msgs, lancs))
print("\nPronto. Nada foi alterado no banco.")
