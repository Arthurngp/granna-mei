"""Teste do painel admin no navegador: entrada, segunda etapa (TOTP calculado aqui), clientes, ações com auditoria,
e as barreiras (cliente comum não entra; sem segunda etapa as funções recusam). Apaga os usuários de teste no fim.
Uso: adm_e2e.py <url do admin, ex. https://grannamei.amplasoft.me/admin>"""
import os, sys, time, hmac, hashlib, struct, base64, re
sys.path.insert(0, os.path.dirname(__file__))
from supa import http, sql, chave
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = os.environ['CLAUDE_JOB_DIR'] + '/tmp/admin'; os.makedirs(OUT, exist_ok=True)
SVC = chave('service'); T = int(time.time())
ADM = (f'teste-adm-{T}@grannamei.test', 'Senha-de-teste-9')
CLI = (f'teste-cli-{T}@grannamei.test', 'Senha-de-teste-9')
falhas = []
def ok(n, c, d=''):
    print(('  ok   ' if c else '  FALHA') + ' ' + n + ('' if c else ' -> ' + str(d)[:220]))
    if not c: falhas.append(n)
def banco(q):
    st, r = sql(q); assert st == 200, r; return r
def totp(segredo, t=None):
    k = base64.b32decode(segredo.upper() + '=' * (-len(segredo) % 8))
    c = struct.pack('>Q', int((t or time.time()) // 30))
    h = hmac.new(k, c, hashlib.sha1).digest(); o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1000000).zfill(6)
def criar(email, senha, nome):
    st, u = http('POST', '/auth/v1/admin/users', key=SVC, body={'email': email, 'password': senha, 'email_confirm': True, 'user_metadata': {'nome': nome}})
    assert st in (200, 201), (st, u); return u['id']

adm = criar(*ADM, 'Admin Teste'); cli = criar(*CLI, 'Cliente Teste')
banco(f"update perfis set papel='admin' where id='{adm}'; update perfis set negocio='Loja do Teste', whats='(81) 99999-0009' where id='{cli}'")
try:
    print('1. barreiras pela API')
    st, s = http('POST', '/auth/v1/token?grant_type=password', body={'email': ADM[0], 'password': ADM[1]})
    tok = s['access_token']
    st, r = http('POST', '/rest/v1/rpc/admin_clientes', token=tok, body={})
    ok('admin SEM segunda etapa não lista clientes', st in (400, 401, 403) or 'negado' in str(r), (st, r))
    st, s2 = http('POST', '/auth/v1/token?grant_type=password', body={'email': CLI[0], 'password': CLI[1]})
    st, r = http('POST', '/rest/v1/rpc/admin_acao', token=s2['access_token'], body={'p_user': cli, 'p_acao': 'cortesia', 'p_motivo': 'tentando'})
    ok('cliente comum não executa ação de admin', st in (400, 401, 403) or 'negado' in str(r), (st, r))

    with sync_playwright() as p:
        b = p.chromium.launch()
        for largura, nome in ((390, 'm'), (1280, 'd')):
            ctx = b.new_context(viewport={'width': largura, 'height': 860}, device_scale_factor=2 if largura < 600 else 1, has_touch=largura < 600)
            pg = ctx.new_page(); erros = []
            pg.on('pageerror', lambda e: erros.append(str(e)))
            print(f'2. navegador {largura}px')
            if nome == 'm':
                pg.goto(BASE + '/'); pg.wait_for_timeout(1500)
                pg.fill('input[type=email]', CLI[0]); pg.fill('input[type=password]', CLI[1]); pg.click('button[type=submit]')
                pg.wait_for_timeout(2500)
                ok('cliente comum vê "não é de admin"', pg.get_by_text('não é de admin').count() == 1)
                pg.get_by_role('button', name='Sair').click(); pg.wait_for_timeout(800)
            pg.goto(BASE + '/'); pg.wait_for_timeout(1500)
            pg.screenshot(path=f'{OUT}/01-entrar-{nome}.png')
            pg.fill('input[type=email]', ADM[0]); pg.fill('input[type=password]', ADM[1]); pg.click('button[type=submit]')
            pg.wait_for_timeout(3000)
            if nome == 'm':
                txt = pg.locator('text=Sem câmera').inner_text()
                segredo = re.search(r'chave:\s*([A-Z2-7]+)', txt).group(1)
                pg.screenshot(path=f'{OUT}/02-ativar-2fa-{nome}.png')
                ok('primeiro acesso pede para ativar o autenticador (QR + chave)', bool(segredo))
            else:
                ok('acesso seguinte pede só o código', pg.get_by_text('Código do autenticador').count() == 1)
            pg.fill('input[autocomplete=one-time-code]', totp(segredo)); pg.get_by_role('button', name='Confirmar').click()
            pg.wait_for_timeout(3000)
            ok('com o código, entra na visão geral', pg.get_by_text('WhatsApp confirmado').count() >= 1)
            pg.screenshot(path=f'{OUT}/03-visao-{nome}.png', full_page=True)
            pg.get_by_role('button', name='Clientes').click(); pg.wait_for_timeout(2000)
            pg.fill('input[type=search]', 'Loja do Teste'); pg.wait_for_timeout(2000)
            ok('busca acha o cliente pelo negócio', pg.get_by_text('Loja do Teste').count() >= 1)
            pg.fill('input[type=search]', '99999-0009'); pg.wait_for_timeout(2000)
            ok('busca acha o cliente pelo telefone', pg.get_by_text('Cliente Teste').count() >= 1)
            pg.screenshot(path=f'{OUT}/04-clientes-{nome}.png')
            if nome == 'm':
                pg.get_by_text('Cliente Teste').first.click(); pg.wait_for_timeout(1500)
                pg.get_by_role('button', name='Liberar sem pagamento (cortesia)').click()
                ok('confirmar fica desligado sem motivo', pg.get_by_role('button', name='Confirmar', exact=True).is_disabled())
                pg.fill('input[placeholder="Ex.: parceiro da NGP"]', 'parceiro de teste')
                pg.screenshot(path=f'{OUT}/05-acao-{nome}.png')
                pg.get_by_role('button', name='Confirmar', exact=True).click(); pg.wait_for_timeout(2500)
                r = banco(f"select a.status, a.motivo, (select count(*) from admin_auditoria au where au.alvo_user_id='{cli}' and au.acao='cortesia') aud from assinaturas a where a.user_id='{cli}'")[0]
                ok('cortesia gravada com motivo e auditoria', r['status'] == 'cortesia' and r['motivo'] == 'parceiro de teste' and r['aud'] == 1, r)
                pg.get_by_role('button', name='Auditoria').click(); pg.wait_for_timeout(2000)
                ok('auditoria mostra quem fez e por quê', pg.get_by_text('parceiro de teste').count() >= 1)
                pg.screenshot(path=f'{OUT}/06-auditoria-{nome}.png')
                pg.get_by_role('button', name='Granninha').click(); pg.wait_for_timeout(2500)
                pg.screenshot(path=f'{OUT}/07-granninha-{nome}.png', full_page=True)
                ok('aba Granninha mostra a situação do número', pg.locator('.alerta').count() >= 1)
            sw = pg.evaluate('document.documentElement.scrollWidth'); ok(f'sem rolagem lateral em {largura}px', sw <= largura, sw)
            ok('sem erro de página', not erros, erros)
            pg.get_by_role('button', name='Sair').click(); pg.wait_for_timeout(500)
            ctx.close()
        b.close()
finally:
    for u in banco("select id from auth.users where email like 'teste-adm-%' or email like 'teste-cli-%'"):
        banco(f"delete from admin_auditoria where admin_id='{u['id']}' or alvo_user_id='{u['id']}'")
        http('DELETE', '/auth/v1/admin/users/' + u['id'], key=SVC)
print('RESULTADO:', 'TUDO OK' if not falhas else falhas)
