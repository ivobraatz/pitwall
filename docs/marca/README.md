# Marca

O pitwall é o muro dos boxes. A marca vem de um objeto desse muro: a **placa de pit**, o quadro
de carbono que o box estende para o piloto, com letras brancas encaixadas em fileiras e, quando
importa, um campo amarelo.

## A ideia

No console, os quatro canais do muro viram os tiles do quadro:

| No muro | No Pitwall |
|---|---|
| Rádio | Chamados |
| Telemetria | Erros do servidor |
| Câmera onboard | Gravações de tela |
| Boletim | Novidades |

E cada sistema é um carro na pista: ele tem uma **cor de equipe** que o acompanha em todas as telas
(a faixa à esquerda na fila, nos erros, nas novidades e na lista de sistemas), como na torre de
cronometragem.

### O selo de cada sistema

Onde um sistema aparece (fila, erros, novidades, chamado, lista de sistemas, torre "Na pista"), ele
vem com o seu **selo**: a logo cadastrada, num quadrado branco (logos são desenhadas para papel
claro), ou, sem logo, as iniciais na cor do sistema (uma letra só abaixo de 28px, para continuar
legível). A cor pode ser escolhida no cadastro; sem escolha, sai do identificador e nunca muda. O
amarelo fica fora da paleta dos sistemas, porque é o sinal da marca. Componentes: `ProductMark`,
`ProductName` e `ProductStripe` em `apps/console/components/product.tsx`.

A logo aceita PNG, JPEG ou WebP até 512 KB, conferidos pelos primeiros bytes do arquivo. SVG não
entra, porque pode carregar script.

## Símbolo e nome

- **Símbolo:** uma placa amarela com três faixas de comprimento decrescente: as linhas da placa de
  pit, e também uma fila ordenada pelo que importa primeiro. Quadrado, plano, uma cor.
  Arquivo: `apps/console/app/icon.svg`; componente: `Mark` em `apps/console/components/brand.tsx`.
- **Nome:** sempre em minúsculas, `pitwall`, em League Spartan 700, tracking −0,035em.
- **Assinatura:** símbolo + nome lado a lado (`Lockup`). O símbolo sozinho serve de favicon e no
  trilho estreito.

## Cores

| Papel | Escuro | Claro |
|---|---|---|
| Fundo | `#0f1112` | `#eef0f1` |
| Tile (um passo acima do fundo) | `#181a1c` | `#ffffff` |
| Texto | `#f5f5f3` | `#0d0f10` |
| Sinal (amarelo da placa) | `#ffd400` com texto `#0b0c0d` | o mesmo |

O amarelo aparece em dois lugares por tela, no máximo: a ação principal e o número que pede ação
(por exemplo, "Aguardando a equipe"). Nunca como fundo de uma área grande.

Situações usam cores próprias, chapadas: aberto azul, em andamento ciano, aguardando cliente
laranja, correção a caminho verde. Resolvido e fechado ficam em tom apagado. Os valores estão
todos em `apps/console/app/globals.css`, e nenhum componente usa cor literal.

## Tipografia

- **Display:** League Spartan 700, para títulos de página, números grandes e o nome.
- **Texto:** Figtree, 400 e 600. Mínimo de 13px em qualquer texto da interface.
- **Código:** a fonte monoespaçada do sistema, só dentro de `<code>`/`<pre>` e em campos que
  guardam código (chaves, segredos, URLs, prefixos de stack trace).

## Regras da casa

- Cantos retos em tudo (uma placa não tem canto arredondado). Avatar é a única forma redonda.
- Superfícies se separam por um passo de tom, não por linha nem por sombra. Sombra só no que
  flutua de verdade: menu, diálogo, aviso.
- Sem gradientes, sem brilho, sem vidro (backdrop blur).
- Listas são faixas preenchidas com 4px entre elas, como um quadro de partidas; a situação fica
  num bloco sólido à direita.
- Sem rótulos pequenos em caixa alta: rótulos em caixa de frase.
- Movimento só com transform e opacity, e tudo respeita `prefers-reduced-motion`.

## Fotografias do login

Fotos reais do mundo do pit, de Wikimedia Commons, creditadas na legenda de cada uma. Não
representam o Pitwall nem seus clientes.

| Arquivo | Origem | Autor | Licença |
|---|---|---|---|
| `public/login/pit-wall.jpg` | [Renault after losing the title sponsor ING 2009 Japan](https://commons.wikimedia.org/wiki/File:Renault_after_losing_the_title_sponsor_ING_2009_Japan.jpg) | Morio | CC BY-SA 3.0 |
| `public/login/pit-board.jpg` | [Pit sign board of ROOKIE Racing](https://commons.wikimedia.org/wiki/File:Pit_sign_board_of_ROOKIE_Racing.jpg) | Tokumeigakarinoaoshima | CC0 |
| `public/login/pit-lane.jpg` | [Pit lane 2014 Singapore GP](https://commons.wikimedia.org/wiki/File:Pit_lane_2014_Singapore_GP.jpg) | Morio | CC BY-SA 4.0 |
| `public/login/pit-building.jpg` | [Singapore F1 Grand Prix Pit Lane](https://commons.wikimedia.org/wiki/File:Singapore_F1_Grand_Prix_Pit_Lane_(4448666252).jpg) | Andy Mitchell | CC BY-SA 2.0 |

As imagens foram só redimensionadas (sem recorte no arquivo nem mudança de cor); o enquadramento é
feito por CSS.
