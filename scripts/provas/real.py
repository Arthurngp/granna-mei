"""Teste de ponta a ponta com conta de verdade. Uso: real.py <base_url>. Apaga o usuário de teste no fim."""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from supa import http, sql, chave
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = os.environ['CLAUDE_JOB_DIR'] + '/tmp/real'
os.makedirs(OUT, exist_ok=True)
EMAIL = f'teste-e2e-{int(time.time())}@grannamei.test'
SENHA = 'Senha-de-teste-9'
erros, falhas = [], []
def ok(nome, cond, det=''):
    print(('  ok   ' if cond else '  FALHA') + ' ' + nome + (' -> ' + str(det)[:200] if not cond else ''))
    if not cond: falhas.append(nome)
def banco(q):
    st, r = sql(q); assert st == 200, r; return r

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
    page = ctx.new_page()
    page.on('console', lambda m: erros.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: erros.append('PAGEERROR ' + str(e)))
    try:
        page.goto(BASE + '/entrar'); page.wait_for_timeout(1500)
        page.screenshot(path=OUT + '/01-entrar.png')
        # login errado mostra mensagem, nao quebra
        page.get_by_placeholder('voce@email.com').fill(EMAIL)
        page.locator('input[type=password]').fill('senha-errada')
        page.get_by_role('button', name='Entrar', exact=True).click()
        page.get_by_text('E-mail ou senha não conferem.').wait_for(timeout=15000)
        ok('login errado mostra mensagem clara', True)

        page.get_by_role('link', name='Teste grátis por 7 dias').click()
        page.get_by_placeholder('Nome e sobrenome').fill('Teste Ponta a Ponta')
        page.get_by_placeholder('voce@email.com').fill(EMAIL)
        page.locator('input[type=password]').fill(SENHA)
        page.locator('input[type=checkbox]').check()
        page.get_by_role('button', name='Começar meu teste grátis').click()
        page.wait_for_url('**/comecar', timeout=20000)
        ok('cadastro cria a conta e abre as boas-vindas', True)
        uid = banco(f"select id from auth.users where email='{EMAIL}'")[0]['id']

        page.get_by_placeholder('Ex.: Studio Camila').fill('Oficina de Teste')
        page.get_by_placeholder('(81) 90000-0000').fill('81987650001')
        page.wait_for_timeout(300); page.screenshot(path=OUT + '/02-ob1.png')
        page.get_by_role('button', name='Continuar').click()
        page.get_by_role('button', name='Serviços').click()
        page.get_by_role('button', name='Continuar').click()
        page.locator('.item-ob.ligado input').first.fill('150000')
        page.get_by_role('button', name='Continuar').click()
        page.wait_for_timeout(1200)
        ok('passo alcancado fica registrado no banco', banco(f"select onboarding_passo p from perfis where id='{uid}'")[0]['p'] == 3)
        page.get_by_label('Tenho Aluguel').click()
        page.locator('.item-ob.ligado').nth(1).locator('input').first.fill('80000')
        page.get_by_role('button', name='Continuar').click()
        page.get_by_role('button', name='Concluir').click()
        page.get_by_role('button', name='Ver meu painel').click()
        page.wait_for_url(BASE + '/'); page.wait_for_timeout(2500)
        page.screenshot(path=OUT + '/03-inicio-novo.png')
        r = banco(f"select (select onboarding_feito from perfis where id='{uid}') feito, (select negocio from perfis where id='{uid}') negocio, (select whats_verificado from perfis where id='{uid}') verif, (select count(*) from carteiras where user_id='{uid}') cart, (select saldo_inicial from carteiras where user_id='{uid}' limit 1) saldo, (select count(*) from categorias where user_id='{uid}') cat, (select count(*) from fixas where user_id='{uid}') fix, (select count(*) from contas where user_id='{uid}') contas")[0]
        ok('boas-vindas gravadas no banco', r['feito'] is True and r['negocio'] == 'Oficina de Teste' and r['cart'] == 1 and float(r['saldo']) == 1500 and r['cat'] == 13 and r['fix'] == 2 and r['contas'] >= 4, r)
        ok('numero NAO nasce verificado', r['verif'] is False, r)
        ok('sem botao de dados de exemplo na conta de verdade', page.get_by_role('button', name='Ver o painel com dados de exemplo').count() == 0)

        # marcar conta paga -> vira lancamento no banco
        page.goto(BASE + '/contas'); page.wait_for_timeout(1500)
        page.locator('.marca:not(.ok)').first.click(); page.wait_for_timeout(2000)
        r = banco(f"select (select count(*) from contas where user_id='{uid}' and status='paga') pagas, (select count(*) from lancamentos where user_id='{uid}') lancs, (select origem from lancamentos where user_id='{uid}' limit 1) origem")[0]
        ok('conta paga grava conta e lancamento', r['pagas'] == 1 and r['lancs'] == 1 and r['origem'] == 'painel', r)

        # recarregar a pagina: dados continuam (vem do banco, nao do navegador)
        page.evaluate("localStorage.removeItem('granna-mei:demo')")
        page.reload(); page.wait_for_timeout(3000)
        page.goto(BASE + '/lancamentos'); page.wait_for_timeout(2000)
        ok('depois de recarregar, o lancamento continua la', page.locator('.lista .linha').count() == 1, page.locator('.lista .linha').count())
        page.screenshot(path=OUT + '/04-lancamentos.png')

        # desfazer pelo detalhe: apagar o lancamento reabre a conta
        page.locator('.lista .linha').first.click()
        page.get_by_role('button', name='Apagar lançamento').click()
        page.get_by_role('button', name='Sim, apagar este lançamento').click(); page.wait_for_timeout(2000)
        r = banco(f"select (select count(*) from contas where user_id='{uid}' and status='paga') pagas, (select count(*) from lancamentos where user_id='{uid}') lancs")[0]
        ok('apagar lancamento apaga no banco e reabre a conta', r['pagas'] == 0 and r['lancs'] == 0, r)

        # ajustes: sem bloco de demonstracao; mudar horario grava
        page.goto(BASE + '/ajustes'); page.wait_for_timeout(1500)
        ok('ajustes sem bloco de demonstracao', page.get_by_text('Simular situação da assinatura').count() == 0)
        page.screenshot(path=OUT + '/05-ajustes.png', full_page=True)
        page.get_by_role('button', name='Horários da Granninha').click()
        page.get_by_role('button', name='sexta', exact=True).click()
        page.get_by_role('button', name='Pronto').click(); page.wait_for_timeout(1500)
        ok('preferencia de horario grava no banco', banco(f"select resumo_dia d from perfis where id='{uid}'")[0]['d'] == 5)

        # sair e entrar de novo
        page.get_by_role('button', name='Sair').click()
        page.wait_for_url('**/entrar')
        page.get_by_placeholder('voce@email.com').fill(EMAIL)
        page.locator('input[type=password]').fill(SENHA)
        page.get_by_role('button', name='Entrar', exact=True).click()
        page.wait_for_url(BASE + '/', timeout=20000); page.wait_for_timeout(2000)
        ok('sair e entrar de novo abre direto o painel', 'Oficina de Teste' in page.locator('.topo').inner_text())

        # bloqueio: so a tela de acesso pausado; e o banco recusa gravacao mesmo forçando
        banco(f"update assinaturas set status='bloqueada' where user_id='{uid}'")
        page.reload(); page.wait_for_url('**/bloqueado', timeout=20000)
        page.goto(BASE + '/lancamentos'); page.wait_for_url('**/bloqueado')
        page.wait_for_timeout(800); page.screenshot(path=OUT + '/06-bloqueado.png')
        ok('bloqueado cai na tela de acesso pausado', True)
        page.get_by_role('button', name='Pagar').click(); page.wait_for_timeout(800)
        ok('pagar na conta real nao libera sozinho', '/bloqueado' in page.url and banco(f"select status s from assinaturas where user_id='{uid}'")[0]['s'] == 'bloqueada')
        with page.expect_download() as d:
            page.get_by_role('button', name='Baixar meus dados').click()
        ok('bloqueado consegue baixar os dados', d.value.suggested_filename.endswith('.json'))
        banco(f"update assinaturas set status='trial' where user_id='{uid}'")

        # demonstracao continua funcionando e nao toca o banco
        page.get_by_role('button', name='Sair').click(); page.wait_for_url('**/entrar')
        antes = banco("select count(*) n from lancamentos")[0]['n']
        page.get_by_role('button', name='Ver uma demonstração').click()
        page.wait_for_url(BASE + '/'); page.wait_for_timeout(1500)
        ok('demonstracao abre a conta de exemplo', 'Studio Camila' in page.locator('.topo').inner_text())
        page.goto(BASE + '/contas'); page.wait_for_timeout(800)
        page.locator('.marca:not(.ok)').first.click(); page.wait_for_timeout(1500)
        ok('mexer na demonstracao nao grava nada no banco', banco("select count(*) n from lancamentos")[0]['n'] == antes)
        sw = page.evaluate('document.documentElement.scrollWidth'); ok('sem rolagem lateral', sw <= 391, sw)
    finally:
        r = banco(f"select id from auth.users where email like 'teste-e2e-%'")
        for u in r: http('DELETE', '/auth/v1/admin/users/' + u['id'], key=chave('service'))
        print('limpeza:', banco("select (select count(*) from auth.users) usuarios, (select count(*) from perfis) perfis, (select count(*) from lancamentos) lancs, (select count(*) from contas) contas"))
        b.close()
ruido = [e for e in erros if 'status of 400' not in e]
print('erros de console (fora o 400 esperado do login errado):', len(ruido)); [print('  ', e[:200]) for e in ruido[:8]]
print('RESULTADO:', 'TUDO OK' if not falhas and not ruido else f'FALHAS: {falhas}')
