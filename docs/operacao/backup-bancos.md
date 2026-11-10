# Backup central dos bancos

Um único job na VM Oracle faz o backup dos Postgres dos sistemas ligados a ele e do próprio Pitwall. Ele não
substitui o snapshot do provedor de cada banco, que restaura mais rápido um erro recente: ele protege contra
a perda do projeto ou da conta no provedor, ou da VM. Os arquivos vão para um bucket do R2 (`R2_BUCKET` no
`backups.env`).

## Como funciona

`deploy/bancos/backup-bancos.sh` roda pelo cron, em `/opt/backups`. Para cada sistema:

1. Faz o `pg_dump` com a mesma versão do servidor, usando o usuário `backup_ro`, que só lê.
2. Confere o tamanho e o conteúdo do dump.
3. Com `--restaurar`, restaura o dump num Postgres sem rede e compara com a origem.
4. Cifra com `age` e envia ao R2. Depois, confere o tamanho do arquivo no bucket.
5. Avisa o Kuma, que alerta se o aviso não chegar no prazo.

O dump só fica sem cifra na pasta temporária, com permissão apenas para o dono, enquanto o job roda.
A VM guarda só a chave pública: quem invadi-la lê os bancos, mas não abre os backups já feitos.

Agende pelo cron. Um ponto de partida:

| Quando | Comando |
|---|---|
| De madrugada, de segunda a sábado | `backup-bancos.sh` (todos os sistemas) |
| De madrugada, aos domingos | `backup-bancos.sh --restaurar` |
| Mais vezes ao dia, se precisar | `backup-bancos.sh <sistema>`, para o sistema que não pode perder um dia de dados |

Os horários seguem o fuso da VM. Evite os picos de uso dos sistemas.

## Retenção

O script nunca apaga nada. Quem expira os arquivos é o bucket, com o bloqueio de 14 dias impedindo a
exclusão dos recentes, mesmo com o token da VM.

| Pasta | Conteúdo | Expira em |
|---|---|---|
| `diario/<sistema>/` | Backups comuns | 30 dias |
| `mensal/<sistema>/` | O backup do dia 1 de cada mês | 365 dias |

Dados de contas apagadas continuam nos backups até eles expirarem. Mantenha esses prazos alinhados com
a política de privacidade de cada sistema.

## Arquivos na VM

| Caminho | Conteúdo |
|---|---|
| `/opt/backups/bin/` | Os scripts de `deploy/bancos` |
| `/opt/backups/backups.env` | Chave pública, token do R2 e URLs do Kuma (modelo em `backups.env.example`) |
| `/opt/backups/bancos/<sistema>.env` | Conexão de cada sistema e, em `TABELAS=`, as tabelas conferidas na restauração |
| `/opt/backups/logs/backup.log` | O que aconteceu em cada execução |

## Ligar um sistema

Na VM, fora do Claude, para a URL de admin não passar por nenhum histórico:

```bash
/opt/backups/bin/preparar-banco.sh acme clientes pedidos
```

O primeiro argumento é o nome do sistema no backup (minúsculas, números, `-` ou `_`); os outros, as tabelas
principais dele. O script pede a URL pública de admin do Postgres (na Railway, Postgres → **Variables** →
`DATABASE_PUBLIC_URL`), cria o `backup_ro` com senha gerada e grava `/opt/backups/bancos/acme.env`. A conexão
exige TLS. A URL de admin não é guardada, e rodar de novo troca a senha do `backup_ro` e mantém as tabelas já
gravadas, a menos que você passe outras. Sem tabelas, o teste de restauração compara só o número de tabelas.
`preparar-banco.sh pitwall` liga o Postgres local do Pitwall, com as tabelas dele.

Depois, acrescente `PUSH_ACME` ao `backups.env` (o nome em maiúsculas, hífen trocado por `_`) com a URL de um
monitor do tipo Push no Kuma.

## Restaurar

Precisa da chave privada do age, guardada no gerenciador de senhas, e dos segredos que cada sistema usa para
cifrar ou assinar o que está no banco (uma chave mestra, o segredo de sessão). Sem eles, o dump volta, mas esses
dados não abrem. No Pitwall, é a `PITWALL_SECRET_KEY`.

1. Baixe o arquivo em **R2** → o bucket do backup → `diario/<sistema>/`.
2. Decifre: `age -d -i chave.txt -o banco.dump <arquivo>.dump.age`.
3. Restaure num banco novo: `pg_restore --no-owner --no-acl -d "<URL do banco novo>" banco.dump`.
4. Aponte o sistema para o banco novo e siga o guia de deploy dele.
5. Apague `chave.txt` e `banco.dump` da máquina.

## Cofre (Vaultwarden)

O Vaultwarden roda na mesma VM e guarda os segredos de que a restauração precisa. Sem ele, os dumps não se
recuperam. O `/opt/vaultwarden/backup.sh` gera todo dia uma cópia consistente do SQLite e da chave RSA
em `/opt/vaultwarden/backups`. Depois dele, `deploy/bancos/backup-cofre.sh` roda como root, pelo
`/etc/cron.d/backup-cofre`, pega a cópia mais recente, cifra e envia para `diario/vaultwarden/`. O log
fica em `/opt/backups/logs/cofre.log`, e o aviso vai para `PUSH_COFRE`.

**A chave privada do age precisa ficar fora do cofre.** Ela abre o backup do cofre, então uma cópia só
dentro dele não serve em um desastre. A ordem de recuperação é:

1. Pegar a chave do age na cópia física.
2. Decifrar o backup do cofre e subir o Vaultwarden.
3. Com os segredos de volta, restaurar os bancos.

Para restaurar o cofre, decifre com `age -d -i chave.txt -o cofre.tar.gz <arquivo>.tar.gz.age`, extraia
na pasta de dados com o Vaultwarden parado e suba o container.

## Quando falha

| Sintoma | O que olhar |
|---|---|
| Monitor do sistema em Down | A mensagem do monitor e `/opt/backups/logs/backup.log` |
| `não conectou no banco` | O provedor trocou host ou porta: rode `preparar-banco.sh <sistema>` de novo |
| `pg_dump falhou` por permissão | Tabela criada com outro dono: confira o `GRANT pg_read_all_data` |
| `envio ao R2 falhou` | Token vencido ou sem acesso ao bucket |
| Monitor de restauração em Down | O log mostra qual tabela não bateu; o backup do dia foi enviado mesmo assim |
| Espaço em disco | `/opt/backups/tmp` precisa de duas vezes o tamanho do maior dump |

Para testar à mão: `/opt/backups/bin/backup-bancos.sh --restaurar <sistema>`.
