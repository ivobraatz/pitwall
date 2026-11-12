# Pitwall

## Documentação e tarefas

- Mudou comportamento, variável, deploy, serviço ou integração: atualize o documento correspondente no mesmo commit.
- Mudou serviço, ambiente, repositório ou integração: atualize também o Atlas da instalação (`register_service`, `link_services`, `register_repo`), não um arquivo.
- Dado de uma instalação (nomes de sistemas, domínios, ids de provedor, rotinas) nunca entra no repositório: código, migração, teste, exemplo e doc usam nomes fictícios.
- Documento fica só com o essencial para operar e entender o sistema. Número público (bancos, canais, redes) vem do código.
- Sem lista de tarefas, pendências, plano ou relatório em markdown. Tarefa manual vai para o Pitwall, com passo a passo completo.

## Atlas (Pitwall MCP)
- Ao começar a trabalhar: start_activity(system="pitwall", component="<serviço>", description="<uma frase>") e guarde o id.
- Antes de encerrar, chame atlas_sync com o resumo do que mudou e os códigos de tarefa.
- Ao terminar: finish_activity(id, status ok|failed, result="<o que mudou>").
