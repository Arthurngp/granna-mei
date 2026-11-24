"""Acesso ao Supabase da Granninha. Chaves lidas do Coolify em memória, nunca impressas."""
import json, os, sys, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
from cool import call

U = 'jyrip6777vo8dr6bhugib70a'
URL = 'https://db-grannamei.amplasoft.me'
_envs = None
def _local():
    import os
    r = {}
    for arq in ('~/Desktop/Cerebro-obsidian-mesa/Projetos-Software-Local/granna-mei/.claude/worktrees/fase3/server/.env.local', '~/Desktop/Cerebro-obsidian-mesa/Projetos-Software-Local/granna-mei/.claude/worktrees/fase2/.env.local'):
        p = os.path.expanduser(arq)
        if os.path.exists(p):
            for l in open(p):
                if '=' in l: k, v = l.rstrip('\n').split('=', 1); r[k] = v
    return r

def chave(tipo):
    global _envs
    if _envs is None:
        # Sem depender do Coolify: as chaves já estão nos arquivos locais (fora do git) do serviço e do painel.
        l = _local()
        if l.get('SUPABASE_SERVICE_ROLE_KEY') and l.get('VITE_SUPABASE_ANON_KEY'):
            _envs = [{'key': 'SERVICE_SUPABASESERVICE_KEY', 'value': l['SUPABASE_SERVICE_ROLE_KEY']}, {'key': 'SERVICE_SUPABASEANON_KEY', 'value': l['VITE_SUPABASE_ANON_KEY']}]
        else:
            _, _envs = call('GET', '/services/' + U + '/envs')
    for e in _envs:
        v = e.get('real_value') or e.get('value') or ''
        k = e.get('key', '')
        if v.startswith('eyJ') and v.count('.') == 2 and len(v) > 120:
            if tipo == 'service' and k == 'SERVICE_SUPABASESERVICE_KEY': return v
            if tipo == 'anon' and k == 'SERVICE_SUPABASEANON_KEY': return v
    raise SystemExit('chave ' + tipo + ' nao encontrada')

def http(method, path, key=None, token=None, body=None, extra=None):
    key = key or chave('anon')
    h = {'apikey': key, 'Authorization': 'Bearer ' + (token or key), 'Content-Type': 'application/json', 'User-Agent': 'curl/8'}
    h.update(extra or {})
    r = urllib.request.Request(URL + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            t = f.read().decode()
            return f.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t[:500]

def sql(q):
    return http('POST', '/pg/query', key=chave('service'), body={'query': q})

if __name__ == '__main__':
    if sys.argv[1] == 'file':
        st, out = sql(open(sys.argv[2], encoding='utf-8').read())
    else:
        st, out = sql(sys.argv[1])
    print(st, json.dumps(out, ensure_ascii=False, default=str)[:3000])
