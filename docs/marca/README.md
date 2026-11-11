# Marca

O pitwall é o muro dos boxes: de lá a equipe acompanha todos os carros ao mesmo tempo. A marca
vem de um objeto desse muro, a **placa de pit**, que o box estende para o piloto com as linhas
encaixadas em fileiras. No console, a placa ficou mais calma: um chão de pedra clara, painéis
brancos de cantos macios e o amarelo da placa só onde a equipe precisa agir.

## A ideia

| No muro | No Pitwall |
|---|---|
| Rádio | Chamados |
| Telemetria | Erros do servidor |
| Câmera onboard | Gravações de tela |
| Boletim | Novidades |
| Torre de cronometragem | "Na pista": cada sistema com seus abertos e erros das últimas 24h |

Cada sistema é um carro na pista e tem um **selo** que o acompanha em todas as telas: a logo
cadastrada num quadrado branco, ou as iniciais na cor do sistema sobre um tom claro dela. A cor
pode ser escolhida no cadastro; sem escolha, sai do identificador e nunca muda. O amarelo fica fora
da paleta dos sistemas, porque é o sinal da marca. Componentes: `ProductMark`, `ProductName` e
`ProductStripe` em `apps/console/components/product.tsx`.

A logo aceita PNG, JPEG ou WebP até 512 KB, conferidos pelos primeiros bytes do arquivo. SVG não
entra, porque pode carregar script.

## Símbolo e nome

- **Símbolo:** uma placa de tinta com cantos arredondados e três faixas amarelas de comprimento
  decrescente: as linhas da placa de pit, e uma fila ordenada pelo que importa primeiro. No tema
  escuro a placa fica amarela e as faixas de tinta. Arquivo: `apps/console/app/icon.svg`;
  componente: `Mark` em `apps/console/components/brand.tsx`.
- **Nome:** `Pitwall`, em Figtree 600, tracking −0,025em.
- **Assinatura:** símbolo + nome lado a lado (`Lockup`). O símbolo sozinho serve de favicon e no
  trilho estreito.

## Cores

| Papel | Claro | Escuro |
|---|---|---|
| Chão | `#ecebe6` | `#121211` |
| Painel | `#ffffff` | `#1a1a19` |
| Bloco dentro do painel | `#f4f3ef` | `#232321` |
| Texto | `#161616` | `#f3f2ee` |
| Ação principal (pílula) | `#161616`, texto branco | `#f3f2ee`, texto `#141414` |
| Sinal (amarelo da placa) | `#f4df4f` com texto `#161616` | o mesmo |

O amarelo aparece no máximo em dois lugares por tela: o número que pede ação (por exemplo,
"Aguardando a equipe") e o cartão da barra lateral que leva até ele. Nunca como fundo de área
grande nem em botão comum. Situações são um ponto colorido dentro de uma pílula cinza: aberto
azul, em andamento petróleo, aguardando cliente âmbar, correção a caminho verde; resolvido e
fechado ficam apagados. Os valores estão todos em `apps/console/app/globals.css`, e nenhum
componente usa cor literal. O tema segue o sistema operacional, e cada pessoa pode fixar claro ou
escuro no menu da conta.

## Tipografia

- **Uma família:** Figtree, 400 a 600. Título de tela 26px/600, título de painel 16px/600,
  números 30px/500 com algarismos tabulares, texto 14px, rótulos 12–13px. Nada acima de 30px
  dentro do app.
- **Código:** a fonte monoespaçada do sistema, só dentro de `<code>`/`<pre>` e em campos que
  guardam código (chaves, segredos, URLs, prefixos de stack trace).

## Regras da casa

- Chão → painel → bloco: no máximo três níveis. Painel 20px de canto, bloco 14px, controles e
  pílulas totalmente arredondados.
- Superfícies se separam por um passo de tom, sem sombra. Sombra só no que flutua de verdade:
  menu, diálogo, aviso. Linha de 1px só entre linhas de uma lista.
- Uma ação principal por tela, em pílula de tinta.
- Sem gradientes, sem brilho, sem vidro (backdrop blur), sem rótulos em caixa alta.
- Movimento só como resposta (passar o mouse, apertar, abrir um menu); nada entra animado. Tudo
  respeita `prefers-reduced-motion`.

## Fotografia do login

Foto real do mundo do pit, de Wikimedia Commons, creditada na legenda. Não representa o Pitwall
nem seus clientes.

| Arquivo | Origem | Autor | Licença |
|---|---|---|---|
| `public/login/pit-building.jpg` | [Singapore F1 Grand Prix Pit Lane](https://commons.wikimedia.org/wiki/File:Singapore_F1_Grand_Prix_Pit_Lane_(4448666252).jpg) | Andy Mitchell | CC BY-SA 2.0 |

A imagem foi só redimensionada (sem recorte no arquivo nem mudança de cor); o enquadramento é
feito por CSS.
