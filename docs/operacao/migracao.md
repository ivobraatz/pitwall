# Plano de migração

Ordem pensada para arriscar o mínimo: o sistema sem nada vem primeiro, o que está em produção por último.

1. **Pitwall no ar.** `docker-compose.prod.yml` num host próprio (ou API e console no Railway, como o
   DataRunner), Postgres dedicado, bucket R2 privado para anexos, `PITWALL_REQUIRE_TOTP=true`,
   console atrás de Cloudflare Access. Cadastrar os três sistemas e a equipe.
2. **metrifree** — integração do zero (não há dados a migrar). Valida o SDK em Vue e o plugin Fastify.
3. **RH Flex** — ainda fora de produção: migrar os chamados de teste (ou descartar), trocar o módulo
   `Suporte` pela ponte e as telas pelos componentes. Começar a gerar novidades (o RH Flex nunca teve).
4. **DataRunner** — em produção:
   1. Ligar **só** o reporter de erros e o webhook, mantendo o suporte interno (o Pitwall já começa a
      agrupar erros sem mudar nada para o cliente).
   2. Trocar o workflow `release-notes.yml` pela action do Pitwall, com o webhook `release.published`
      espelhando em `ContentPosts` — o site e o `/whats-new` não mudam.
   3. Migrar os chamados (script abaixo) numa janela curta, trocar `MapSupportEndpoints` pela ponte e
      remover `/admin/support`.

## Mapeamento de dados — DataRunner → Pitwall

| DataRunner | Pitwall |
|---|---|
| `SupportTickets.WorkspaceId` | `tickets.customer_ref` (+ `customer_name` de `Workspaces.Name`) |
| `OpenedBy` → `Users` | `opened_by_ref`, `opened_by_name` (`DisplayName ?? Email`), `opened_by_email` |
| `Code, Title, Body, Category, Severity, Status, Route, FixedIn, ResolutionNote` | iguais |
| `DiagnosticsJson`, `TraceIdsJson` | `diagnostics_json`, `trace_ids` (array) |
| `ErrorSignature` | **recalcular** a partir dos `server_errors` migrados, ou deixar nulo (o algoritmo é o mesmo, mas o Pitwall normaliza ids na rota) |
| `AssigneeId` | id do mesmo atendente em `staff` (mapear por e-mail) |
| `LastAdminMessageAt` | `last_team_message_at` |
| `SupportTicketMessages.FromAdmin/Internal/Body` | `from_team`, `internal`, `body`; `author_ref/name` do usuário |
| `SupportTicketAttachments` | copiar o objeto do bucket para `tickets/{product}/{ticket}/{attachment}{ext}` e a linha |
| `ServerErrors` (30 dias) | `server_errors` com `customer_ref = WorkspaceId` |
| `ContentPosts` (kind changelog) | opcional: `releases` + `release_notes` agrupando por `TranslationGroupId` |

O importador já existe: é um subcomando da própria API do Pitwall. Ele lê as tabelas `legacy_*` que a
migração `MoveSupportToPitwall` do DataRunner deixou (ou os nomes originais, se rodar antes), copia
chamados (mesmos ids), mensagens, anexos com os bytes e os erros dos últimos 30 dias, e pode rodar de
novo sem duplicar nada:

```bash
Import__SourceConnectionString="Host=…;Database=datarunner;Username=…;Password=…" \
Import__SourceStorage__Provider=s3 \
Import__SourceStorage__ServiceUrl=https://<conta>.r2.cloudflarestorage.com \
Import__SourceStorage__Bucket=<bucket privado do DataRunner> \
Import__SourceStorage__AccessKey=… \
Import__SourceStorage__SecretKey=… \
dotnet Pitwall.Api.dll import-datarunner --dry-run   # depois sem --dry-run
```

Ordem em produção: Pitwall no ar com o sistema `datarunner` cadastrado → deploy do DataRunner (renomeia
as tabelas) → importador logo em seguida (os chamados antigos ficam invisíveis para o cliente entre os
dois passos) → conferir no console → numa migração futura, `DROP TABLE legacy_*`.

## RH Flex → Pitwall

| RH Flex (`Chamado`) | Pitwall |
|---|---|
| `TenantId` | `customer_ref` |
| `Codigo, Assunto` | `code`, `title` (o corpo vem da primeira `ChamadoMensagem`) |
| `Categoria` duvida/problema/cobranca/sugestao/outro | question/bug/billing/feature/other |
| `Situacao` aberto/em_andamento/aguardando_cliente/resolvido | open/in_progress/waiting_customer/resolved |
| `Rota`, `Navegador`, `NotaInterna` | `route`, `diagnostics_json.context.userAgent`, `resolution_note` |
| `ChamadoMensagem.DoSuporte/Interna` | `from_team`, `internal` |
