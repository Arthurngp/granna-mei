"""Painel: faixa de confirmar WhatsApp, código gerado no banco, recarga ao voltar à tela. Apaga o usuário no fim."""
import sys, os, re, time
sys.path.insert(0, os.path.dirname(__file__))
from supa import http, sql, chave
from playwright.sync_api import sync_playwright
BASE = sys.argv[1].rstrip('/')
OUT = os.environ['CLAUDE_JOB_DIR'] + '/tmp/whats'; os.makedirs(OUT, exist_ok=True)
EMAIL = f'teste-obc-{int(time.time())}@grannamei.test'; SENHA = 'Senha-de-teste-9'
falhas = []
def ok(n, c, d=''):
    print(('  ok   ' if c else '  FALHA') + ' ' + n + ('' if c else ' -> ' + str(d)[:200]))
    if not c: falhas.append(n)
def banco(q):
    st, r = sql(q); assert st == 200, r; return r
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True).new_page()
    erros = []
    page.on('pageerror', lambda e: erros.append(str(e)))
    try:
        page.goto(BASE + '/criar-conta')
        page.get_by_placeholder('Nome e sobrenome').fill('Teste Whats')
        page.get_by_placeholder('voce@email.com').fill(EMAIL)
        page.locator('input[type=password]').fill(SENHA)
        page.locator('input[type=checkbox]').check()
        page.get_by_role('button', name='Começar meu teste grátis').click()
        page.wait_for_url('**/comecar', timeout=20000)
        uid = banco(f"select id from auth.users where email='{EMAIL}'")[0]['id']
        page.get_by_placeholder('Ex.: Studio Camila').fill('Teste Whats'); page.get_by_placeholder('(81) 90000-0000').fill('81999990003')
        page.get_by_role('button', name='Continuar').click(); page.get_by_role('button', name='Serviços').click(); page.get_by_role('button', name='Continuar').click()
        page.get_by_role('button', name='Continuar').click(); page.get_by_role('button', name='Continuar').click(); page.get_by_role('button', name='Concluir').click()
        page.wait_for_timeout(2500)
        link = page.get_by_role('link', name='Abrir o WhatsApp e enviar o código').get_attribute('href')
        cod = banco(f"select codigo from verificacoes where user_id='{uid}'")
        ok('último passo gera código e o botão leva a mensagem com ele', cod and cod[0]['codigo'] in (link or ''), (cod, link))
        page.screenshot(path=OUT + '/01-ob-final.png')
        ok('passo final mostra o código grande e as instruções', page.get_by_text('Esperando sua mensagem chegar').count() == 1 and page.get_by_text(cod[0]['codigo']).count() >= 1)
        # A Granninha confirma pelo servidor: a tela tem que perceber sozinha.
        banco(f"update perfis set whats_verificado=true where id='{uid}'")
        page.get_by_text('Seu número está confirmado').wait_for(timeout=12000)
        ok('a tela percebe a confirmação sozinha e libera o painel', page.get_by_role('button', name='Ver meu painel').count() == 1)
        page.screenshot(path=OUT + '/01b-ob-confirmado.png')
        page.get_by_role('button', name='Ver meu painel').click(); page.wait_for_timeout(2500)
        ok('painel abre sem a faixa de confirmar (número já confirmado)', page.get_by_text('Confirme seu WhatsApp').count() == 0)
        page.screenshot(path=OUT + '/01c-inicio-confirmado.png')
    finally:
        for u in banco(f"select id from auth.users where email like 'teste-obc-%'"): http('DELETE', '/auth/v1/admin/users/' + u['id'], key=chave('service'))
        b.close()
print('RESULTADO:', 'TUDO OK' if not falhas else falhas)
