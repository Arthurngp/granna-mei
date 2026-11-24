# Provas da Granninha

Scripts que rodam contra o banco de produção com usuários de teste (`teste-*@grannamei.test`), apagados no fim.
Leem as chaves do Coolify em memória (token em `~/.zshrc`: `COOLIFY_URL`, `COOLIFY_API_TOKEN`); nada é gravado em arquivo.

- `rls.py`: regras de acesso com dois clientes (inclui contraprova desligando a regra).
- `real.py <url>`: cadastro, boas-vindas, gravação, bloqueio e demonstração no navegador (Playwright).
- `supa.py "<sql>"`: SQL no banco pelo `/pg/query` com a service_role.

Testes do serviço da Granninha ficam em `server/test/`: `npm run test:frases`, `npx tsx test/conferir.ts`, `npm run test:fluxo`.
