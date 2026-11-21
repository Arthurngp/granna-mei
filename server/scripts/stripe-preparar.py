#!/usr/bin/python3
"""Prepara a Stripe para a Granninha: produto, os dois preços e o webhook. Idempotente (pode rodar de novo).

  /usr/bin/python3 -I server/scripts/stripe-preparar.py            só mostra o que falta (não muda nada)
  /usr/bin/python3 -I server/scripts/stripe-preparar.py --aplicar  cria o que falta, em TESTE
  /usr/bin/python3 -I server/scripts/stripe-preparar.py --aplicar --live   o mesmo em PRODUÇÃO (dinheiro de verdade)

Antes: `stripe login` (o token da CLI vence). O servidor acha os preços pela chave (lookup_key), sem id fixo:
  granninha_mensal = R$ 29,90 por mês · granninha_anual = R$ 299,90 por ano.

O webhook aponta para a API da Granninha (não para o site, que redireciona). O segredo `whsec_...` só aparece UMA vez,
na criação: o script grava num arquivo só seu (600) e NÃO imprime. Quem coloca na Coolify (STRIPE_WEBHOOK_SECRET) lê de lá.
Este script também não toca na chave secreta do servidor: ela é uma chave restrita criada no Dashboard (STRIPE_SECRET_KEY).
"""
import json, os, subprocess, sys

STRIPE = '/opt/homebrew/bin/stripe'
URL_WEBHOOK = 'https://api-grannamei.amplasoft.me/cobranca/webhook'
EVENTOS = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
           'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']
PRECOS = [('granninha_mensal', 2990, 'month'), ('granninha_anual', 29990, 'year')]

aplicar = '--aplicar' in sys.argv
live = ['--live'] if '--live' in sys.argv else []
modo = 'PRODUÇÃO' if live else 'TESTE'


def stripe(*args, texto=False):
    r = subprocess.run([STRIPE, *args, *live], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'A CLI da Stripe falhou ({" ".join(args[:2])}): {r.stdout.strip() or r.stderr.strip()}\nRode `stripe login` e tente de novo.')
    return r.stdout if texto else json.loads(r.stdout)


print(f'Modo: {modo}' + ('  (aplicando)' if aplicar else '  (só conferindo)'))
conta = stripe('get', '/v1/account')
print('Conta:', conta.get('id'), '·', (conta.get('settings', {}).get('dashboard', {}) or {}).get('display_name'), '· cobrança liberada:', conta.get('charges_enabled'))
if live and not conta.get('charges_enabled'):
    sys.exit('A conta ainda não pode cobrar em produção. Termine a ativação no Dashboard da Stripe.')

# Produto + preços
produto = None
ids = {}
for chave, centavos, intervalo in PRECOS:
    achados = stripe('prices', 'list', '-d', f'lookup_keys[]={chave}', '-d', 'active=true', '--limit', '1')['data']
    if achados:
        p = achados[0]
        if p['unit_amount'] != centavos or p['currency'] != 'brl' or p['recurring']['interval'] != intervalo:
            sys.exit(f'O preço {chave} já existe com outro valor/intervalo ({p["unit_amount"]} {p["currency"]}). Não vou mexer: arrume no Dashboard.')
        ids[chave] = p['id']
        produto = p['product']
        print(f'  ok   preço {chave} já existe ({p["id"]})')
    else:
        print(f'  FALTA preço {chave}: R$ {centavos / 100:.2f} por {"mês" if intervalo == "month" else "ano"}')
for chave, centavos, intervalo in PRECOS:
    if chave in ids or not aplicar:
        continue
    if produto is None:
        produto = stripe('products', 'create', '--name', 'Granninha', '-d', 'description=Controle financeiro do MEI pelo WhatsApp')['id']
        print('  criado produto', produto)
    p = stripe('prices', 'create', '--product', produto, '--currency', 'brl', '--unit-amount', str(centavos),
               '-d', f'recurring[interval]={intervalo}', '--lookup-key', chave)
    print(f'  criado preço {chave} ({p["id"]})')

# Webhook
existentes = [w for w in stripe('webhook_endpoints', 'list', '--limit', '100')['data'] if w['url'] == URL_WEBHOOK]
if existentes:
    w = existentes[0]
    faltam = sorted(set(EVENTOS) - set(w['enabled_events']))
    print(f'  ok   webhook já existe ({w["id"]})' + (f' · FALTAM eventos: {faltam}' if faltam else ''))
elif aplicar:
    args = ['webhook_endpoints', 'create', '--url', URL_WEBHOOK, '-d', 'description=Granninha: cobrança']
    for e in EVENTOS:
        args += ['-d', f'enabled_events[]={e}']
    w = stripe(*args)
    pasta = os.path.expanduser('~/.config/granna-mei')
    os.makedirs(pasta, exist_ok=True)
    arq = os.path.join(pasta, f'stripe-webhook-secret-{"live" if live else "test"}')
    fd = os.open(arq, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(w['secret'])
    print(f'  criado webhook {w["id"]}. Segredo gravado em {arq} (não impresso).')
else:
    print(f'  FALTA webhook para {URL_WEBHOOK}')

print('\nFalta no Dashboard (a CLI não faz): portal de cobrança salvo nesse modo, e o que fazer quando todas as tentativas de cobrança falharem.')
