"""Cria (ou confirma) a conta de admin do Arthur na Granninha. Senha aleatória só no arquivo 600.
A segunda etapa (autenticador) ele ativa no primeiro acesso ao /admin."""
import os, sys, secrets
sys.path.insert(0, os.path.dirname(__file__))
from supa import http, sql, chave

EMAIL = 'arthur@amplasoft.me'
DIR = os.path.expanduser('~/.config/granna-mei'); os.makedirs(DIR, mode=0o700, exist_ok=True)
ARQ = DIR + '/admin.env'
cred = dict(l.rstrip('\n').split('=', 1) for l in open(ARQ) if '=' in l) if os.path.exists(ARQ) else {}
if 'ADMIN_SENHA' not in cred:
    cred = {'ADMIN_EMAIL': EMAIL, 'ADMIN_SENHA': secrets.token_urlsafe(18), 'ADMIN_URL': 'https://grannamei.amplasoft.me/admin'}
    open(ARQ, 'w').write('\n'.join(f'{k}={v}' for k, v in cred.items()) + '\n'); os.chmod(ARQ, 0o600)

SVC = chave('service')
st, r = sql(f"select id from auth.users where email = '{EMAIL}'")
if r:
    uid = r[0]['id']; print('conta já existia')
else:
    st, u = http('POST', '/auth/v1/admin/users', key=SVC, body={'email': EMAIL, 'password': cred['ADMIN_SENHA'], 'email_confirm': True, 'user_metadata': {'nome': 'Arthur Oliveira'}})
    assert st in (200, 201), (st, u)
    uid = u['id']; print('conta criada')
st, r = sql(f"update public.perfis set papel = 'admin', nome = coalesce(nullif(nome, ''), 'Arthur Oliveira') where id = '{uid}'; "
            f"update public.assinaturas set status = 'cortesia', motivo = 'conta do dono do produto' where user_id = '{uid}'; "
            f"select p.papel, a.status from public.perfis p join public.assinaturas a on a.user_id = p.id where p.id = '{uid}'")
print('papel e situação:', r)
print('senha guardada em', ARQ)
