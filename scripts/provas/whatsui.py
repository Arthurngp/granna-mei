"""Painel: faixa de confirmar WhatsApp, código gerado no banco, recarga ao voltar à tela. Apaga o usuário no fim."""
import sys, os, re, time
sys.path.insert(0, os.path.dirname(__file__))
from supa import http, sql, chave
from playwright.sync_api import sync_playwright
BASE = sys.argv[1].rstrip('/')
OUT = os.environ['CLAUDE_JOB_DIR'] + '/tmp/whats'; os.makedirs(OUT, exist_ok=True)
EMAIL = f'teste-whats-{int(time.time())}@grannamei.test'; SENHA = 'Senha-de-teste-9'
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
        page.get_by_role('button', name='Confirmar depois').click(); page.wait_for_url(re.compile(re.escape(BASE) + r'/?$')); page.wait_for_timeout(1500)
        ok('Início mostra a faixa para confirmar o WhatsApp', page.get_by_text('Confirme seu WhatsApp').count() == 1)
        page.screenshot(path=OUT + '/02-inicio-faixa.png')
        page.get_by_role('button', name='Confirmar', exact=True).click()
        page.get_by_role('button', name='Confirmar meu WhatsApp').click(); page.wait_for_timeout(1500)
        cod2 = banco(f"select codigo from verificacoes where user_id='{uid}'")[0]['codigo']
        ok('folha mostra o código gerado no banco', page.get_by_text(cod2).count() >= 1, cod2)
        page.screenshot(path=OUT + '/03-folha-codigo.png')
        page.keyboard.press('Escape')
        # A Granninha confirma pelo servidor; ao voltar para a tela, o painel relê o banco.
        banco(f"update perfis set whats_verificado=true where id='{uid}'")
        banco(f"insert into lancamentos (user_id,id,tipo,valor,descricao,carteira_id,data,origem) values ('{uid}','l-wtest','entrada',77,'Pelo WhatsApp','banco',current_date,'texto')")
        page.wait_for_timeout(16000)
        page.evaluate("document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(3000)
        ok('ao voltar à tela, a faixa some (relido do banco)', page.get_by_text('Confirme seu WhatsApp').count() == 0)
        ok('e aparece o lançamento que a Granninha gravou', page.get_by_text('Pelo WhatsApp').count() >= 1)
        # Edição no painel depois disso não apaga o lançamento da Granninha.
        page.goto(BASE + '/ajustes'); page.wait_for_timeout(1200)
        page.get_by_role('button', name='Horários da Granninha').click(); page.get_by_role('button', name='sexta', exact=True).click(); page.get_by_role('button', name='Pronto').click(); page.wait_for_timeout(1500)
        ok('lançamento da Granninha continua no banco', banco(f"select count(*) n from lancamentos where user_id='{uid}' and id='l-wtest'")[0]['n'] == 1)
        page.get_by_role('button', name='WhatsApp conectado').click(); page.wait_for_timeout(500)
        ok('Ajustes mostra número confirmado', page.get_by_text('Número confirmado').count() == 1)
        page.screenshot(path=OUT + '/04-ajustes-confirmado.png')
        ok('sem erro de página', not erros, erros)
    finally:
        for u in banco(f"select id from auth.users where email like 'teste-whats-%'"): http('DELETE', '/auth/v1/admin/users/' + u['id'], key=chave('service'))
        b.close()
print('RESULTADO:', 'TUDO OK' if not falhas else falhas)
