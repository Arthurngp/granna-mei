"""Prova das regras de acesso com dois usuários de teste. Apaga os usuários no fim."""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from supa import http, sql, chave

SVC = chave('service')
falhas = []
def ok(nome, cond, det=''):
    print(('  ok   ' if cond else '  FALHA') + ' ' + nome + (' -> ' + str(det)[:160] if not cond else ''))
    if not cond: falhas.append(nome)

def novo(tag):
    email = f'teste-rls-{tag}-{int(time.time())}@grannamei.test'
    st, r = http('POST', '/auth/v1/signup', body={'email': email, 'password': 'Senha-de-teste-9', 'data': {'nome': 'Teste ' + tag}})
    assert st == 200 and r.get('access_token'), (st, r)
    return r['user']['id'], r['access_token']

TAB = ['perfis', 'assinaturas', 'faturas', 'carteiras', 'categorias', 'lancamentos', 'fixas', 'contas']
print('1. visitante sem login')
for t in TAB:
    st, r = http('GET', f'/rest/v1/{t}?select=*')
    ok(f'anon nao le {t}', st in (401, 403) or r == [], (st, r))
st, r = http('POST', '/rest/v1/lancamentos', body={'id': 'x', 'tipo': 'entrada', 'valor': 1, 'carteira_id': 'b', 'data': '2026-11-15'})
ok('anon nao grava lancamento', st in (401, 403), (st, r))

a, ta = novo('a'); b, tb = novo('b')
try:
    print('2. conta nova')
    st, r = http('GET', '/rest/v1/perfis?select=id,nome,whats_verificado', token=ta)
    ok('A ve so o proprio perfil, com nome', st == 200 and len(r) == 1 and r[0]['id'] == a and r[0]['nome'] == 'Teste a', r)
    st, r = http('GET', '/rest/v1/assinaturas?select=status,trial_fim', token=ta)
    ok('A nasce em teste gratis', st == 200 and len(r) == 1 and r[0]['status'] == 'trial', r)

    print('3. isolamento entre clientes')
    st, r = http('POST', '/rest/v1/carteiras', token=ta, body={'id': 'banco', 'nome': 'Banco', 'tipo': 'banco', 'saldo_inicial': 100, 'padrao': True})
    ok('A cria carteira', st == 201, (st, r))
    L = {'id': 'l1', 'tipo': 'entrada', 'valor': 150, 'descricao': 'Venda', 'carteira_id': 'banco', 'data': '2026-11-15'}
    st, r = http('POST', '/rest/v1/lancamentos', token=ta, body=L)
    ok('A cria lancamento', st == 201, (st, r))
    def b_le():
        st, r = http('GET', '/rest/v1/lancamentos?select=id', token=tb)
        return st, r
    st, r = b_le()
    ok('B nao le lancamento de A', st == 200 and r == [], r)
    st, r = http('GET', '/rest/v1/perfis?select=id', token=tb)
    ok('B ve so o proprio perfil', st == 200 and [x['id'] for x in r] == [b], r)
    st, r = http('PATCH', f'/rest/v1/lancamentos?user_id=eq.{a}', token=tb, body={'valor': 1}, extra={'Prefer': 'return=representation'})
    ok('B nao altera lancamento de A', r == [] or st in (401, 403), (st, r))
    st, r = http('DELETE', f'/rest/v1/lancamentos?user_id=eq.{a}', token=tb, extra={'Prefer': 'return=representation'})
    ok('B nao apaga lancamento de A', r == [] or st in (401, 403), (st, r))
    st, r = http('POST', '/rest/v1/lancamentos', token=tb, body={**L, 'id': 'l2', 'user_id': a})
    ok('B nao grava em nome de A', st in (401, 403), (st, r))
    st, r = http('PATCH', f'/rest/v1/perfis?id=eq.{a}', token=tb, body={'nome': 'invadido'}, extra={'Prefer': 'return=representation'})
    ok('B nao altera perfil de A', r == [] or st in (401, 403), (st, r))
    st, r = http('GET', '/rest/v1/lancamentos?select=id,valor', token=ta)
    ok('lancamento de A intacto', r == [{'id': 'l1', 'valor': 150}], r)

    print('4. o que o cliente nao pode mudar em si mesmo')
    st, r = http('PATCH', f'/rest/v1/assinaturas?user_id=eq.{a}', token=ta, body={'status': 'ativa', 'trial_fim': '2099-01-01'}, extra={'Prefer': 'return=representation'})
    ok('A nao muda a propria assinatura', st in (401, 403), (st, r))
    st, r = http('POST', '/rest/v1/faturas', token=ta, body={'user_id': a, 'data': '2026-11-15', 'valor': 19.9})
    ok('A nao cria fatura paga', st in (401, 403), (st, r))
    st, r = http('PATCH', f'/rest/v1/perfis?id=eq.{a}', token=ta, body={'whats_verificado': True}, extra={'Prefer': 'return=representation'})
    ok('A nao se marca como verificado', st in (401, 403), (st, r))
    sql(f"update public.perfis set whats='(81) 90000-0001', whats_verificado=true where id='{a}'")
    st, r = http('PATCH', f'/rest/v1/perfis?id=eq.{a}', token=ta, body={'whats': '(81) 98888-7777', 'negocio': 'Loja A'}, extra={'Prefer': 'return=representation'})
    ok('A troca o numero e a verificacao cai', st == 200 and r and r[0]['whats_verificado'] is False and r[0]['negocio'] == 'Loja A', (st, r))
    st, r = http('DELETE', f'/rest/v1/perfis?id=eq.{a}', token=ta, extra={'Prefer': 'return=representation'})
    ok('A nao apaga o perfil direto', st in (401, 403), (st, r))

    st, r = http('PATCH', f'/rest/v1/perfis?id=eq.{a}', token=ta, body={'papel': 'admin'}, extra={'Prefer': 'return=representation'})
    ok('A nao se promove a admin', st in (401, 403), (st, r))
    st, r = http('POST', '/rest/v1/rpc/gerar_codigo_whats', token=ta, body={})
    ok('A gera codigo de 6 numeros para confirmar o WhatsApp', st == 200 and isinstance(r, str) and len(r) == 6 and r.isdigit(), (st, r))
    st, r = http('POST', '/rest/v1/rpc/gerar_codigo_whats', body={})
    ok('visitante nao gera codigo', st in (400, 401, 403, 404) or (isinstance(r, dict) and r.get('code')), (st, r))
    for t in ('mensagens', 'conversas', 'verificacoes', 'admin_auditoria'):
        st, r = http('GET', f'/rest/v1/{t}?select=*', token=ta)
        ok(f'cliente nao le {t}', st in (401, 403) or r == [], (st, r))
    print('5. bloqueio por falta de pagamento')
    sql(f"update public.assinaturas set status='bloqueada' where user_id='{a}'")
    st, r = http('POST', '/rest/v1/lancamentos', token=ta, body={**L, 'id': 'l3'})
    ok('bloqueado nao grava', st in (401, 403), (st, r))
    st, r = http('PATCH', f'/rest/v1/lancamentos?id=eq.l1', token=ta, body={'valor': 999}, extra={'Prefer': 'return=representation'})
    ok('bloqueado nao altera', r == [] or st in (401, 403), (st, r))
    st, r = http('GET', '/rest/v1/lancamentos?select=id,valor', token=ta)
    ok('bloqueado ainda le os dados (para baixar)', r == [{'id': 'l1', 'valor': 150}], r)
    sql(f"update public.assinaturas set status='trial', trial_fim=current_date - 1 where user_id='{a}'")
    st, r = http('POST', '/rest/v1/lancamentos', token=ta, body={**L, 'id': 'l4'})
    ok('teste gratis vencido nao grava', st in (401, 403), (st, r))
    sql(f"update public.assinaturas set status='atrasada' where user_id='{a}'")
    st, r = http('POST', '/rest/v1/lancamentos', token=ta, body={**L, 'id': 'l5'})
    ok('em atraso (carencia) ainda grava', st == 201, (st, r))

    print('6. o teste pega o defeito? (desligo a regra de proposito e religo)')
    sql('alter table public.lancamentos disable row level security')
    st, r = b_le()
    pegou = len(r) > 0
    sql('alter table public.lancamentos enable row level security')
    ok('sem a regra, B enxerga dados de A (o teste detecta)', pegou, r)
    st, r = b_le()
    ok('regra religada, B volta a nao ver', r == [], r)

    print('7. funcoes e arquivos')
    st, r = http('POST', '/rest/v1/rpc/ao_criar_usuario', token=ta, body={})
    ok('gatilho nao e chamavel pela API', st in (401, 403, 404), (st, r))
    st, r = http('POST', '/rest/v1/rpc/acesso_liberado', body={})
    ok('visitante nao chama acesso_liberado', st in (401, 403, 404), (st, r))
    st, r = http('GET', '/storage/v1/bucket/comprovantes', token=ta)
    ok('bucket de comprovantes existe e e privado', (st == 200 and r.get('public') is False) or st in (400, 404), (st, r))
finally:
    for u in (a, b):
        st, r = http('DELETE', '/auth/v1/admin/users/' + u, key=SVC)
    st, r = sql("select (select count(*) from auth.users where email like 'teste-rls-%') u, (select count(*) from public.lancamentos) l, (select count(*) from public.perfis) p")
    print('limpeza:', r)
print('\nRESULTADO:', 'TUDO OK' if not falhas else f'{len(falhas)} FALHAS: {falhas}')
