# Granna Mei

Painel do Granna Mei: o controle do dinheiro do MEI pelo WhatsApp, com a assistente Granninha.
O lançamento acontece na conversa; o painel serve para ver, conferir e exportar.

## Rodar

```bash
npm install
npm run dev      # http://localhost:5199
npm run build    # confere os tipos e gera dist/
```

## Estado (2026-11-15)

Painel ligado ao banco. Há dois modos:

- **Conta de verdade:** login por e-mail e senha no Supabase próprio (`db-grannamei.amplasoft.me`).
  Tudo que o cliente muda é gravado no banco por `src/lib/remoto.ts`, que compara o estado de antes
  com o de depois e envia só a diferença. As telas não falam com o banco.
- **Demonstração:** botão "Ver uma demonstração" na tela de entrar. Conta de exemplo que vive só no
  navegador (`src/lib/seed.ts`) e nunca toca o banco.

Variáveis: copie `.env.example` para `.env.local` e preencha a chave anon. No Coolify elas entram
no build (`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`).

Banco: `supabase/migrations/`. Cada cliente só enxerga as próprias linhas (RLS em todas as tabelas),
a assinatura só é gravada pelo servidor e conta bloqueada lê mas não grava.

## O que ainda só simula

- Código pelo WhatsApp, cobrança, envio ao contador e a exclusão definitiva da conta.
- E-mail (confirmação e troca de senha) depende do Resend; por enquanto a conta entra sem confirmar e-mail.
- `src/lib/config.ts`: `WHATS_GRANNINHA` é provisório; preços e limite do MEI ficam aqui. O uso justo mensal vive só no servidor (`LIMITE_LANCAMENTOS` e `LIMITE_MIDIAS` em `server/src/granninha.ts`) e o cliente não vê o número, nem na tela nem no WhatsApp (`server/src/limite.ts`).

## Marca

- `public/mascote/`: 32 poses da Granninha recortadas com fundo transparente.
- `brand-src/`: arquivos originais e as 66 poses recortadas (`brand-src/poses/`).
- Paleta em `src/styles.css` (`:root`), a partir do índigo `#292D54`.

## Publicar

`Dockerfile` + `nginx.conf` servem o build estático com fallback de rota para o `index.html`.
