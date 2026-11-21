"""Monta variáveis, acionadores e tags do container CT-8YN6KS7Z (granninha.com.br e o domínio antigo granninha.amplasoft.me).

Funil medido: visita -> clicou em criar conta -> abriu o cadastro -> começou a digitar ->
tentou enviar (com o motivo da recusa) -> conta criada, e depois cada passo do onboarding.
É diagnóstico para saber onde se perde gente. NÃO é evento de anúncio: nenhuma tag base de
Meta/Google é criada aqui. Nunca pôr e-mail, nome ou telefone em parâmetro.

Idempotente por nome. Uso:
    python3 scripts/traqueamento/montar.py            # monta (não publica)
    python3 scripts/traqueamento/montar.py publicar   # monta e publica

Os eventos do painel saem de src/lib/eventos.ts (window.dataLayer). O clique no botão de
criar conta, no site, é um acionador link_click: sem código nas páginas.
Modelo: scripts/traqueamento/montar.py do repo Arthurngp/arcanjo-branco-site.
"""
import json, os, subprocess, sys

MCP = [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcp.py")]


def call(tool, args):
    p = subprocess.run(MCP + ["call", tool, json.dumps(args, ensure_ascii=False)], capture_output=True, text=True)
    out = p.stdout.strip()
    try:
        return json.loads(out)
    except Exception:
        return out


existentes_v = {v["name"]: v["id"] for v in call("listar_variaveis", {})}
existentes_t = {t["name"]: t["id"] for t in call("listar_acionadores", {})}
existentes_g = {t["nome"]: t["id"] for t in call("listar_tags", {})}

# evento do dataLayer: (descrição, nome do evento da TAG, parâmetros)
# O nome da tag PRECISA ser diferente do evento do dataLayer: a ferramenta reemite todo
# trk.track() como custom_event e, com nome igual, a tag se reacionava até 3 vezes.
EVENTOS = {
    "cadastro_aberto": ("tela de criar conta aberta", "CadastroAberto", []),
    "cadastro_iniciado": ("começou a preencher o cadastro", "CadastroIniciado", ["campo"]),
    "cadastro_tentativa": ("clicou em começar o teste grátis", "CadastroTentativa", []),
    "cadastro_erro": ("envio do cadastro barrado", "CadastroErro", ["motivo"]),
    "cadastro_confirmar_email": ("conta criada, mas pede confirmação por e-mail", "CadastroConfirmarEmail", []),
    "cadastro_concluido": ("conta criada", "CadastroConcluido", []),
    "onboarding_passo": ("passo do onboarding alcançado", "OnboardingPasso", ["passo"]),
    "onboarding_concluido": ("onboarding terminado", "OnboardingConcluido", []),
}

# ---------- variáveis (dataLayer) ----------
campos = sorted({c for _, _, ps in EVENTOS.values() for c in ps} | {"pagina"})
var = {}
for c in campos:
    nome = "DL - " + c
    r = call("salvar_variavel", {"dados": {"name": nome, "type": "data_layer", "path": c},
                                 **({"id": existentes_v[nome]} if nome in existentes_v else {})})
    var[c] = nome
    print("var ", nome, "->", r.get("id") if isinstance(r, dict) else r)

# ---------- acionadores ----------
trig = {}
for ev, (desc, _, _) in EVENTOS.items():
    nome = f"Evento: {ev} ({desc})"
    antigo = next((n for n in existentes_t if n.startswith(f"Evento: {ev} (")), None)
    r = call("salvar_acionador", {"dados": {"name": nome, "type": "custom_event", "eventName": ev, "conditions": []},
                                  **({"id": existentes_t[antigo]} if antigo else {})})
    trig[ev] = r["id"] if isinstance(r, dict) else existentes_t.get(antigo)
    print("trig", ev, "->", trig[ev])

# clique no botão de criar conta, em qualquer página do site (sem código nas páginas)
nome_cta = "Clique: link para criar conta"
r = call("salvar_acionador", {"dados": {"name": nome_cta, "type": "link_click",
                                         "conditions": [{"variable": "Click URL", "operator": "contains", "value": "/painel/criar-conta"},
                                                        {"variable": "Page Hostname", "operator": "contains", "value": "granninha."}]},
                              **({"id": existentes_t[nome_cta]} if nome_cta in existentes_t else {})})
trig_cta = r["id"] if isinstance(r, dict) else existentes_t.get(nome_cta)
print("trig", nome_cta, "->", trig_cta)

# ---------- tags de evento (para a própria ferramenta) ----------
for ev, (desc, ev_tag, params) in EVENTOS.items():
    nome = f"Traq. — {desc[0].upper() + desc[1:]}"
    dados = {"name": nome, "type": "trk_event", "eventName": ev_tag,
             "params": [{"key": c, "value": "{{" + var[c] + "}}"} for c in params + ["pagina"]],
             "firingTriggerIds": [trig[ev]], "blockingTriggerIds": [], "consent": "analytics", "firing": "once_per_event"}
    r = call("salvar_tag_evento", {"dados": dados, **({"id": existentes_g[nome]} if nome in existentes_g else {})})
    print("tag ", nome, "->", r.get("id") if isinstance(r, dict) else r)

nome = "Traq. — Clicou em criar conta (site)"
dados = {"name": nome, "type": "trk_event", "eventName": "CliqueCriarConta",
         "params": [{"key": "cta_texto", "value": "{{Click Text}}"}, {"key": "pagina", "value": "{{Page Path}}"}],
         "firingTriggerIds": [trig_cta], "blockingTriggerIds": [], "consent": "analytics", "firing": "once_per_event"}
r = call("salvar_tag_evento", {"dados": dados, **({"id": existentes_g[nome]} if nome in existentes_g else {})})
print("tag ", nome, "->", r.get("id") if isinstance(r, dict) else r)

if len(sys.argv) > 1 and sys.argv[1] == "publicar":
    print("publicar ->", call("publicar", {"nome": "Funil do cadastro (montar.py)",
                                          "notas": "Eventos do cadastro e do onboarding da Granninha. Diagnóstico, sem tag de anúncio."}))
