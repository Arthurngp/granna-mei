"""Configura o gateway WA-AKG do Granna Mei depois do primeiro deploy:
fecha o cadastro, cria o usuário comum, gera a chave DELE (nunca a do admin), cria a sessão da Granninha
com o robô desligado e o webhook assinado apontando para o serviço. Segredos só no arquivo 600 e no Coolify."""
import os, json, sys, urllib.request, base64
from playwright.sync_api import sync_playwright

ARQ = os.path.expanduser('~/.config/wa-grannamei/credenciais.env')
cred = dict(l.rstrip('\n').split('=', 1) for l in open(ARQ) if '=' in l)
def salvar():
    open(ARQ, 'w').write('\n'.join(f'{k}={v}' for k, v in cred.items()) + '\n'); os.chmod(ARQ, 0o600)
URL = 'https://wa-grannamei.amplasoft.me'
BASIC = {'username': cred['WA_BASIC_USER'], 'password': cred['WA_BASIC_PASS']}
WEBHOOK = 'https://api-grannamei.amplasoft.me/webhook'

def entrar(ctx, email, senha):
    pg = ctx.new_page()
    pg.goto(URL + '/auth/login', timeout=60000)
    pg.fill('input[name=email]', email)
    pg.fill('input[name=password]', senha)
    pg.click('button[type=submit]')
    pg.wait_for_url('**/dashboard**', timeout=60000)
    return pg

def chamar(pg, metodo, caminho, corpo=None):
    return pg.evaluate("""async ([m, c, b]) => { const r = await fetch(c, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json() } catch {}; return { s: r.status, j } }""", [metodo, caminho, corpo])

def api(metodo, caminho, corpo=None):
    h = {'x-api-key': cred['WA_GATEWAY_API_KEY'], 'Content-Type': 'application/json', 'Authorization': 'Basic ' + base64.b64encode(f"{BASIC['username']}:{BASIC['password']}".encode()).decode()}
    r = urllib.request.Request(URL + caminho, method=metodo, headers=h, data=json.dumps(corpo).encode() if corpo is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=30) as f: return f.status, json.loads(f.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:300]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(http_credentials=BASIC)
    pg = entrar(ctx, cred['ADMIN_EMAIL'], cred['ADMIN_PASSWORD'])
    r = chamar(pg, 'POST', '/api/settings/system', {'appName': 'Granna Mei WhatsApp', 'timezone': 'America/Sao_Paulo', 'enableRegistration': False})
    print('cadastro fechado:', r['s'])
    r = chamar(pg, 'POST', '/api/users', {'name': 'App Granninha', 'email': cred['WA_APP_USER_EMAIL'], 'password': cred['WA_APP_USER_PASSWORD'], 'role': 'USER'})
    print('usuário comum:', r['s'], (r['j'] or {}).get('message'))
    ctx.close()
    ctx = b.new_context(http_credentials=BASIC)
    pg = entrar(ctx, cred['WA_APP_USER_EMAIL'], cred['WA_APP_USER_PASSWORD'])
    if not cred.get('WA_GATEWAY_API_KEY'):
        r = chamar(pg, 'POST', '/api/user/api-key')
        cred['WA_GATEWAY_API_KEY'] = r['j']['data']['apiKey']; salvar()
        print('chave do usuário comum gerada:', r['s'])
    ctx.close(); b.close()

st, s = api('GET', '/api/sessions')
print('sessões visíveis ao usuário comum:', st, [x.get('sessionId') for x in (s or {}).get('data', [])] if isinstance(s, dict) else s)
if not any(x.get('sessionId') == 'granninha' for x in (s or {}).get('data', []) if isinstance(s, dict)):
    print('criar sessão:', api('POST', '/api/sessions', {'name': 'Granninha', 'sessionId': 'granninha'})[0])
print('robô desligado:', api('POST', '/api/sessions/granninha/bot-config', {'enabled': False, 'botMode': 'SPECIFIC', 'botAllowedJids': [], 'autoReplyMode': 'SPECIFIC', 'autoReplyAllowedJids': [], 'enableSticker': False, 'enableVideoSticker': False, 'enablePing': False, 'enableUptime': False})[0])
st, ws = api('GET', '/api/webhooks/granninha')
if not any(w.get('url') == WEBHOOK for w in (ws or {}).get('data', []) if isinstance(ws, dict)):
    st, w = api('POST', '/api/webhooks/granninha', {'name': 'Granninha', 'url': WEBHOOK, 'secret': cred['WA_WEBHOOK_SECRET'], 'events': ['message.received']})
    print('webhook:', st, str(w)[:200])
st, ws = api('GET', '/api/webhooks/granninha')
print('webhooks:', [(w.get('url'), w.get('events'), w.get('isActive')) for w in (ws or {}).get('data', [])] if isinstance(ws, dict) else ws)
