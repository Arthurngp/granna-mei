"""Cliente mínimo da API do Coolify. Uso: cool.py GET /caminho | cool.py POST /caminho '<json>' | PATCH ... Nunca imprime o token."""
import json, os, re, sys, urllib.request, urllib.error
zsh = open(os.path.expanduser('~/.zshrc')).read()
def env(k):
    return re.search(r'^export ' + k + r'=["\']?([^"\'\n]+)', zsh, re.M).group(1).strip()
BASE, TOK = env('COOLIFY_URL').rstrip('/'), env('COOLIFY_API_TOKEN')
def call(method, path, body=None):
    r = urllib.request.Request(BASE + '/api/v1' + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    r.add_header('Authorization', 'Bearer ' + TOK); r.add_header('Accept', 'application/json'); r.add_header('Content-Type', 'application/json'); r.add_header('User-Agent', 'curl/8')
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, json.loads(f.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:800]
if __name__ == '__main__':
    m, p = sys.argv[1], sys.argv[2]
    b = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    st, out = call(m, p, b)
    campos = sys.argv[4].split(',') if len(sys.argv) > 4 else None
    if campos and isinstance(out, dict): out = {k: out.get(k) for k in campos}
    if campos and isinstance(out, list): out = [{k: o.get(k) for k in campos} for o in out]
    print(st, json.dumps(out, ensure_ascii=False, indent=1)[:6000])
