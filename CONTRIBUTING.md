# Contribuindo com o Pitwall

Contribuições são bem-vindas: correções, melhorias, documentação e novas integrações.

## Rodar localmente

Requisitos: .NET 10 SDK, Node 22+, Docker.

```bash
corepack pnpm install
corepack pnpm dev        # Postgres + API + console + produto demo
```

Detalhes e portas estão no [README](README.md#rodar-localmente).

## Testes

```bash
dotnet test Pitwall.slnx                       # unitários + integração (Postgres via Testcontainers, precisa de Docker)
corepack pnpm --filter @pitwall/sdk test       # SDK: ponte, assinatura de webhook
```

Antes de abrir um PR, rode os dois e confira que o build do console passa
(`corepack pnpm --filter @pitwall/console build`).

## Commits

Usamos [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/):

- `feat: …` para funcionalidades novas
- `fix: …` para correções
- `docs: …`, `test: …`, `refactor: …`, `chore: …` conforme o caso

Mudanças que afetam o SDK ou o pacote .NET públicos devem dizer isso no corpo do commit.

## Pull requests

- Abra um PR pequeno e focado, com uma descrição do que mudou e por quê.
- Inclua ou atualize testes quando mudar comportamento.
- PRs são bem-vindos, mesmo que ainda estejam em rascunho: abra cedo se quiser feedback.

## Segurança

Não abra issue pública para vulnerabilidades. Veja [SECURITY.md](SECURITY.md).
