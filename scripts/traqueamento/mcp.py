"""Cliente mínimo do MCP do Traqueamento NGP (HTTP), lendo o token do ~/.claude.json.
Container da Granninha: CT-8YN6KS7Z (MCP traqueamento-ct-8yn6ks7z). O token nunca é impresso.
uso: mcp.py list                       -> lista ferramentas
     mcp.py call <tool> <json-args|@arquivo>
"""
import json, os, sys, urllib.request

cfg = json.load(open(os.path.expanduser("~/.claude.json")))
srv = cfg["mcpServers"][os.environ.get("TRK_MCP", "traqueamento-ct-8yn6ks7z")]
URL, HEAD = srv["url"], srv.get("headers", {})

sessao = None
def rpc(metodo, params=None, ident=1, notificacao=False):
    global sessao
    corpo = {"jsonrpc": "2.0", "method": metodo}
    if params is not None: corpo["params"] = params
    if not notificacao: corpo["id"] = ident
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"}
    h.update(HEAD)
    if sessao: h["Mcp-Session-Id"] = sessao
    req = urllib.request.Request(URL, data=json.dumps(corpo).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            sessao = r.headers.get("Mcp-Session-Id") or sessao
            raw = r.read().decode()
    except urllib.error.HTTPError as e:
        return {"erro_http": e.code, "corpo": e.read().decode()[:800]}
    if notificacao or not raw.strip(): return None
    if raw.lstrip().startswith("{"): return json.loads(raw)
    dados = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")]
    return json.loads(dados[-1]) if dados else {"raw": raw[:500]}

ini = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "claude-code-sessao", "version": "1"}})
if ini and "erro_http" in ini: print(ini); sys.exit(1)
rpc("notifications/initialized", notificacao=True)

if sys.argv[1] == "list":
    r = rpc("tools/list", {}, 2)
    for t in r["result"]["tools"]:
        print("##", t["name"]); print("  ", (t.get("description") or "").replace("\n", " ")[:600])
        print("   args:", json.dumps(t.get("inputSchema", {}).get("properties", {}), ensure_ascii=False)[:900])
elif sys.argv[1] == "call":
    a = sys.argv[3] if len(sys.argv) > 3 else "{}"
    args = json.load(open(a[1:])) if a.startswith("@") else json.loads(a)
    r = rpc("tools/call", {"name": sys.argv[2], "arguments": args}, 3)
    res = r.get("result", r)
    for c in res.get("content", []) if isinstance(res, dict) else []:
        print(c.get("text", c))
    if isinstance(res, dict) and res.get("isError"): print("[isError]")
    if not (isinstance(res, dict) and res.get("content")): print(json.dumps(r, ensure_ascii=False)[:3000])
