# Backup central dos bancos

Um único job na VM Oracle faz o backup dos Postgres de RH Flex, DataRunner, metrifree e Pitwall. Cada
sistema continua com o backup próprio do host, e este é a cópia fora dele.

| Camada | Onde | Protege contra |
|---|---|---|
| Snapshot da Railway | Painel do Postgres, em cada projeto | Erro recente, restauração rápida |
| Backup central | Bucket `braatz-backups` no R2 | Perda do projeto ou da conta da Railway, ou da VM |

## Como funciona

`deploy/bancos/backup-bancos.sh` roda pelo cron, em `/opt/backups`. Para cada sistema:

1. Faz o `pg_dump` com a mesma versão do servidor, usando o usuário `backup_ro`, que só lê.
2. Confere o tamanho e o conteúdo do dump.
3. Aos domingos, restaura o dump num Postgres sem rede e compara com a origem.
4. Cifra com `age` e envia ao R2. Depois, confere o tamanho do arquivo no bucket.
5. Avisa o Kuma, que alerta se o aviso não chegar no prazo.

O dump só fica sem cifra na pasta temporária, com permissão apenas para o dono, enquanto o job roda.
A VM guarda só a chave pública: quem invadi-la lê os bancos, mas não abre os backups já feitos.

| Quando | O quê |
|---|---|
| 04:30, de segunda a sábado | Todos os sistemas |
| 04:30, domingo | Todos, com teste de restauração |
| 10:00, 16:00 e 22:00 | RH Flex, para perder no máximo 6 horas de ponto |

Os horários seguem o fuso da VM (`America/Sao_Paulo`) e evitam os picos de ponto do RH Flex.

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
| `/opt/backups/bancos/<sistema>.env` | Conexão e tabelas conferidas de cada sistema |
| `/opt/backups/logs/backup.log` | O que aconteceu em cada execução |

## Ligar um sistema

Na VM, fora do Claude, para a URL de admin não passar por nenhum histórico:

```bash
/opt/backups/bin/preparar-banco.sh rhflex
```

O script pede a URL pública de admin (Railway → Postgres → **Variables** → `DATABASE_PUBLIC_URL`), cria o
`backup_ro` com senha gerada e grava `/opt/backups/bancos/rhflex.env`. A conexão exige TLS. A URL de admin
não é guardada, e rodar de novo troca a senha do `backup_ro`.

Para um sistema novo, acrescente um `case` em `preparar-banco.sh` com as tabelas principais, uma chave
`PUSH_<SISTEMA>` no `backups.env` e um monitor do tipo Push no Kuma.

## Restaurar

Precisa da chave privada do age, guardada no gerenciador de senhas, e do segredo de cada sistema:

| Sistema | Segredo que precisa acompanhar o dump |
|---|---|
| DataRunner | `Encryption__MasterKey` |
| RH Flex | `JWT_SECRET` |
| metrifree | `APP_SECRET` |
| Pitwall | `PITWALL_SECRET_KEY` |

1. Baixe o arquivo em **R2** → `braatz-backups` → `diario/<sistema>/`.
2. Decifre: `age -d -i chave.txt -o banco.dump <arquivo>.dump.age`.
3. Restaure num banco novo: `pg_restore --no-owner --no-acl -d "<URL do banco novo>" banco.dump`.
4. Aponte o sistema para o banco novo e siga o guia de deploy dele.
5. Apague `chave.txt` e `banco.dump` da máquina.

## Quando falha

| Sintoma | O que olhar |
|---|---|
| Monitor do sistema em Down | A mensagem do monitor e `/opt/backups/logs/backup.log` |
| `não conectou no banco` | A Railway trocou host ou porta: rode `preparar-banco.sh` de novo |
| `pg_dump falhou` por permissão | Tabela criada com outro dono: confira o `GRANT pg_read_all_data` |
| `envio ao R2 falhou` | Token vencido ou sem acesso ao bucket |
| Monitor de restauração em Down | O log mostra qual tabela não bateu; o backup do dia foi enviado mesmo assim |
| Espaço em disco | `/opt/backups/tmp` precisa de duas vezes o tamanho do maior dump |

Para testar à mão: `/opt/backups/bin/backup-bancos.sh --restaurar rhflex`.
