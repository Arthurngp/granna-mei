#!/usr/bin/env python3
"""
Mede HÁBITO de uso da Granninha: lançamentos por pessoa e por semana. SÓ LEITURA.

    /usr/bin/python3 -I server/scripts/medir-habito.py [dias] [--minimo N]
    /usr/bin/python3 -I server/scripts/medir-habito.py --teste    # prova as contas, sem banco

Existe para responder a pergunta da fase f7 do backlog ("lançamentos por pessoa por semana", o número
que diz se a aposta do produto funciona) sem precisar recrutar os 20 MEIs antes. Mostra:
  1. quantas pessoas têm conta, quantas já lançaram algo e quantas continuam lançando;
  2. por pessoa: lançamentos, semanas e dias ativos, há quantos dias foi o último, de onde vieram;
  3. por semana: pessoas ativas, lançamentos e a média por pessoa ativa;
  4. sequência: quantas semanas seguidas cada pessoa ficou ativa desde o primeiro lançamento.

`--minimo` é quantos lançamentos por semana você considera "hábito" (padrão 3). O valor é uma escolha
sua, não um número do produto: o backlog manda combinar isso antes de olhar o resultado.
Precisa de COOLIFY_URL e COOLIFY_API_TOKEN no ambiente ou no ~/.zshrc.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

APP = "xav797i93gs2kiumpkqhmr4d"
SP = timezone(timedelta(hours=-3))  # as semanas são contadas no fuso de São Paulo


def instante(iso: str) -> datetime:
    """
    Converte o timestamp que o Postgres devolve.

    O `/usr/bin/python3` do macOS é 3.9, e o `fromisoformat` dele só aceita fração de segundo com 3 ou
    6 dígitos. O Postgres manda sem os zeros à direita ("...44.95071+00:00", 5 dígitos) e isso derrubava
    o script inteiro. Normaliza a fração para 6 dígitos e aceita Z, offset sem dois-pontos e sem fuso.
    """
    s = iso.strip().replace("z", "Z").replace("Z", "+00:00")
    m = re.match(r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2}:?\d{2})?$", s)
    if not m:
        raise ValueError("timestamp que não reconheço: %r" % iso)
    base, frac, fuso = m.group(1), m.group(2) or "", m.group(3) or "+00:00"
    if ":" not in fuso:
        fuso = fuso[:3] + ":" + fuso[3:]
    return datetime.fromisoformat("%s.%s%s" % (base.replace(" ", "T"), (frac + "000000")[:6], fuso))


def semana_de(iso: str) -> str:
    """Segunda-feira da semana daquele instante, em São Paulo."""
    d = instante(iso).astimezone(SP).date()
    return (d - timedelta(days=d.weekday())).isoformat()


def dia_de(iso: str) -> str:
    return instante(iso).astimezone(SP).date().isoformat()


def agregar(pessoas, lancs, msgs, hoje: date, minimo: int):
    """Parte pura: recebe listas e devolve o relatório pronto. Testada por --teste."""
    por_pessoa = {}
    for p in pessoas:
        por_pessoa[p["id"]] = {
            "nome": (p.get("nome") or "?").split(" ")[0],
            "ramo": p.get("ramo") or "?",
            "criada": dia_de(p["criado_em"]) if p.get("criado_em") else "?",
            "lancs": 0, "semanas": set(), "dias": set(), "ultimo": None, "msgs": 0,
            "origens": defaultdict(int),
        }
    for l in lancs:
        a = por_pessoa.get(l["user_id"])
        if not a:
            continue
        a["lancs"] += 1
        a["semanas"].add(semana_de(l["criado_em"]))
        a["dias"].add(dia_de(l["criado_em"]))
        a["origens"][l.get("origem") or "painel"] += 1
        d = dia_de(l["criado_em"])
        if a["ultimo"] is None or d > a["ultimo"]:
            a["ultimo"] = d
    for m in msgs:
        a = por_pessoa.get(m.get("user_id"))
        if a:
            a["msgs"] += 1

    # por semana
    semanas = defaultdict(lambda: {"pessoas": set(), "lancs": 0})
    for l in lancs:
        s = semana_de(l["criado_em"])
        semanas[s]["pessoas"].add(l["user_id"])
        semanas[s]["lancs"] += 1

    # sequência de semanas seguidas desde o primeiro lançamento de cada pessoa
    for a in por_pessoa.values():
        if not a["semanas"]:
            a["seguidas"] = 0
            continue
        ordenadas = sorted(a["semanas"])
        maior = atual = 1
        for x, y in zip(ordenadas, ordenadas[1:]):
            dx = date.fromisoformat(x)
            dy = date.fromisoformat(y)
            atual = atual + 1 if (dy - dx).days == 7 else 1
            maior = max(maior, atual)
        a["seguidas"] = maior
    return por_pessoa, semanas


def imprimir(por_pessoa, semanas, hoje: date, minimo: int):
    com_lanc = {k: v for k, v in por_pessoa.items() if v["lancs"] > 0}
    print("1. QUEM ESTÁ USANDO")
    print("   contas: %d · já lançaram algo: %d · nunca lançaram: %d"
          % (len(por_pessoa), len(com_lanc), len(por_pessoa) - len(com_lanc)))
    ativos7 = [v for v in com_lanc.values() if v["ultimo"] and (hoje - date.fromisoformat(v["ultimo"])).days <= 7]
    print("   lançaram nos últimos 7 dias: %d" % len(ativos7))

    print("\n2. POR PESSOA (mais ativa primeiro)")
    print("   %-12s %-12s %-10s %6s %7s %6s %9s %7s" % ("nome", "ramo", "conta de", "lancs", "semanas", "dias", "último", "msgs"))
    for v in sorted(por_pessoa.values(), key=lambda x: -x["lancs"]):
        atraso = "-" if not v["ultimo"] else ("hoje" if (hoje - date.fromisoformat(v["ultimo"])).days == 0 else "há %dd" % (hoje - date.fromisoformat(v["ultimo"])).days)
        print("   %-12s %-12s %-10s %6d %7d %6d %9s %7d   %s"
              % (v["nome"][:12], v["ramo"][:12], v["criada"][5:], v["lancs"], len(v["semanas"]), len(v["dias"]), atraso, v["msgs"],
                 " ".join("%s:%d" % (o, n) for o, n in sorted(v["origens"].items(), key=lambda x: -x[1]))))

    print("\n3. POR SEMANA (segunda a domingo, fuso de São Paulo)")
    for s in sorted(semanas):
        d = semanas[s]
        n = len(d["pessoas"])
        print("   %s  pessoas ativas: %d · lançamentos: %d · por pessoa: %.1f" % (s, n, d["lancs"], d["lancs"] / n if n else 0))

    print("\n4. HÁBITO (seu corte: %d lançamentos na mesma semana)" % minimo)
    print("   %-12s %7s %10s %9s" % ("nome", "semanas", "no corte", "seguidas"))
    for v in sorted(por_pessoa.values(), key=lambda x: -x["lancs"]):
        if not v["lancs"]:
            continue
        print("   %-12s %7d %10d %9d" % (v["nome"][:12], len(v["semanas"]), v["semanas_no_corte"], v["seguidas"]))
    firmes = [v for v in por_pessoa.values() if v["semanas_no_corte"] >= 2]
    print("\n   Passaram do corte em 2 semanas ou mais: %d de %d com conta." % (len(firmes), len(por_pessoa)))
    print("   É esse número que responde à aposta da fase f7, não o total de lançamentos.")


def contar_no_corte(por_pessoa, lancs, minimo):
    """Quantas semanas cada pessoa passou do corte de lançamentos."""
    por_semana = defaultdict(int)
    for l in lancs:
        por_semana[(l["user_id"], semana_de(l["criado_em"]))] += 1
    for uid, a in por_pessoa.items():
        a["semanas_no_corte"] = sum(1 for (u, _s), n in por_semana.items() if u == uid and n >= minimo)


# ---------------------------------------------------------------- teste das contas
if "--teste" in sys.argv:
    hoje = date(2026, 11, 19)  # quinta
    # Os formatos aqui são os REAIS do Postgres, com fração de segundo de tamanho variável. A primeira
    # versão deste teste usava timestamps redondos, passou, e o script quebrou na primeira rodada de
    # verdade com ".95071" (5 dígitos). Formato de dado entra no teste, não só a aritmética.
    erros_formato = []
    for bruto, esperado in [
        ("2026-11-16T15:11:44.95071+00:00", "2026-11-16"),   # 5 dígitos: o que derrubou o script
        ("2026-11-16T15:11:44.9+00:00", "2026-11-16"),       # 1 dígito
        ("2026-11-16T15:11:44.950710+00:00", "2026-11-16"),  # 6 dígitos
        ("2026-11-16T15:11:44+00:00", "2026-11-16"),         # sem fração
        ("2026-11-16T15:11:44.123Z", "2026-11-16"),          # Z no lugar do offset
        ("2026-11-16T15:11:44.123+0000", "2026-11-16"),      # offset sem dois-pontos
        ("2026-11-16T15:11:44.123", "2026-11-16"),           # sem fuso (assume UTC)
        ("2026-11-17T01:30:00+00:00", "2026-11-16"),         # 22h30 em SP: ainda é o dia 16
    ]:
        try:
            veio = dia_de(bruto)
            if veio != esperado:
                erros_formato.append("%s -> %s (esperado %s)" % (bruto, veio, esperado))
        except Exception as e:  # noqa: BLE001
            erros_formato.append("%s -> erro: %s" % (bruto, e))
    if erros_formato:
        print("FALHOU na leitura de timestamp:")
        for e in erros_formato:
            print("  -", e)
        sys.exit(1)
    print("formatos de timestamp do Postgres: 8 ok")

    pessoas = [
        {"id": "u1", "nome": "Ana Souza", "ramo": "beleza", "criado_em": "2026-10-20T12:00:00.95071+00:00"},
        {"id": "u2", "nome": "Bruno Lima", "ramo": "servicos", "criado_em": "2026-11-10T12:00:00.1+00:00"},
        {"id": "u3", "nome": "Carla Dias", "ramo": "comida", "criado_em": "2026-11-18T12:00:00Z"},
    ]
    # u1: 4 lançamentos na semana de 09/11 e 3 na de 16/11 (duas semanas seguidas no corte)
    lancs = [{"user_id": "u1", "criado_em": d, "origem": o} for d, o in [
        ("2026-11-09T13:00:00.95071+00:00", "texto"), ("2026-11-10T13:00:00.1+00:00", "audio"),
        ("2026-11-11T13:00:00Z", "texto"), ("2026-11-12T13:00:00+00:00", "foto"),
        ("2026-11-16T13:00:00.123456+00:00", "texto"), ("2026-11-17T13:00:00.45+00:00", "texto"),
        ("2026-11-18T13:00:00.6789+00:00", "texto"),
    ]]
    # u2: 2 lançamentos numa semana só (não passa do corte de 3)
    lancs += [{"user_id": "u2", "criado_em": "2026-11-10T14:00:00+00:00", "origem": "texto"},
              {"user_id": "u2", "criado_em": "2026-11-11T14:00:00+00:00", "origem": "texto"}]
    # u3 nunca lançou
    msgs = [{"user_id": "u1"}] * 12 + [{"user_id": "u2"}] * 3
    pp, sem = agregar(pessoas, lancs, msgs, hoje, 3)
    contar_no_corte(pp, lancs, 3)
    erros = []
    def conferir(o_que, veio, esperado):
        if veio != esperado:
            erros.append("%s: veio %r, esperado %r" % (o_que, veio, esperado))
    conferir("lancs de u1", pp["u1"]["lancs"], 7)
    conferir("semanas de u1", len(pp["u1"]["semanas"]), 2)
    conferir("dias de u1", len(pp["u1"]["dias"]), 7)
    conferir("semanas seguidas de u1", pp["u1"]["seguidas"], 2)
    conferir("semanas no corte de u1", pp["u1"]["semanas_no_corte"], 2)
    conferir("semanas no corte de u2", pp["u2"]["semanas_no_corte"], 0)
    conferir("u3 sem lancamento", pp["u3"]["lancs"], 0)
    conferir("u3 sem sequencia", pp["u3"]["seguidas"], 0)
    conferir("semana de 09/11 tem 2 pessoas", len(sem["2026-11-09"]["pessoas"]), 2)
    conferir("semana de 09/11 tem 6 lancamentos", sem["2026-11-09"]["lancs"], 6)
    conferir("semana de 16/11 tem 3 lancamentos", sem["2026-11-16"]["lancs"], 3)
    conferir("ultimo de u1", pp["u1"]["ultimo"], "2026-11-18")
    conferir("msgs de u1", pp["u1"]["msgs"], 12)
    conferir("origem audio de u1", pp["u1"]["origens"]["audio"], 1)
    if erros:
        print("FALHOU:")
        for e in erros:
            print("  -", e)
        sys.exit(1)
    print("as contas estão certas (%d conferências)\n" % 14)
    imprimir(pp, sem, hoje, 3)
    sys.exit(0)

# ---------------------------------------------------------------- produção
DIAS = 30
minimo = 3
for i, a in enumerate(sys.argv[1:]):
    if a.isdigit():
        DIAS = int(a)
    if a == "--minimo" and i + 2 <= len(sys.argv) - 1:
        minimo = int(sys.argv[i + 2])


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


print("Hábito de uso nos últimos %d dias (desde %s), semanas no fuso de São Paulo\n" % (DIAS, desde[:10]))
pessoas = tudo("perfis", "id,nome,ramo,criado_em")
f = "criado_em=gte." + urllib.parse.quote(desde)
lancs = tudo("lancamentos", "user_id,criado_em,origem", f)
msgs = tudo("mensagens", "user_id,criado_em", f)
hoje = datetime.now(SP).date()
pp, sem = agregar(pessoas, lancs, msgs, hoje, minimo)
contar_no_corte(pp, lancs, minimo)
imprimir(pp, sem, hoje, minimo)
print("\nPronto. Nada foi alterado no banco.")
