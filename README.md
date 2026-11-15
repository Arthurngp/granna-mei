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

Só o front, em modo demonstração: não há backend ligado. Os dados vivem em `localStorage`
(`src/lib/store.tsx`) e a conta de exemplo é gerada em `src/lib/seed.ts`.
Qualquer e-mail, senha ou código de 6 números entra.

Telas: entrar, criar conta, boas-vindas em 6 passos, Início, Lançamentos, Contas, Relatórios,
Meu MEI, Ajustes, Assinatura e a tela de acesso pausado.

## O que trocar quando o backend existir

- `src/lib/store.tsx`: é o único ponto que lê e grava dados. Trocar por Supabase.
- `src/lib/config.ts`: `WHATS_GRANNINHA` é provisório; preços, limite do MEI e uso justo ficam aqui.
- Login, código pelo WhatsApp, pagamento, envio ao contador e exclusão de conta só simulam a ação.
- O bloco "Demonstração" em Ajustes existe para ver os estados da assinatura; remover.

## Marca

- `public/mascote/`: 32 poses da Granninha recortadas com fundo transparente.
- `brand-src/`: arquivos originais e as 66 poses recortadas (`brand-src/poses/`).
- Paleta em `src/styles.css` (`:root`), a partir do índigo `#292D54`.

## Publicar

`Dockerfile` + `nginx.conf` servem o build estático com fallback de rota para o `index.html`.
