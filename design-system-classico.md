# Design system "Clássico": especificação para outros sistemas

Um visual de ferramenta de dados densa, com cara de editor SQL profissional: superfícies
neutras em dois níveis, acento roxo-azulado, botões em pílula, cantos pequenos e muito
texto em 13px.

Este documento está completo para implementar o visual em qualquer stack. Ele não
depende do código do DataRunner.

> **Origem e uso.** Os valores foram **medidos** num estudo de mercado (cores, medidas,
> tipografia observadas na tela) e depois implementados do zero. São só números.
> Não leve junto logos, ícones, ilustrações, textos ou código de terceiros.
> Use os seus próprios ícones e a sua marca, e troque o acento se quiser: o sistema
> funciona com qualquer cor de marca no lugar de `accent`.

---

## 1. Princípios

1. **Duas superfícies, não cinco.**
   - Uma *alta*: painéis, barras, cartões, menus.
   - Uma *baixa*: o fundo do app atrás dos painéis.
   - A profundidade vem do contraste entre as duas e de bordas finas, quase sem sombra.
2. **Densidade.** A base é 13px/17px com peso 500, o espaçamento usa 8px na maior parte,
   e as linhas de lista e de árvore têm 28 a 32px.
3. **Acento só para ação e seleção:** foco, item selecionado, link, botão primário em
   destaque. Nunca como fundo de área grande.
4. **Pílula para ação, quadrado para dado.**
   - Botões de ação (Run, Share, Salvar) são pílulas de 34px.
   - Campos, itens e cartões têm cantos de 4 a 8px.
5. **Lista em linhas, não grade de cartões.** Coleções (conexões, agendamentos,
   dashboards, campanhas) são uma caixa com bordas e uma linha por item: ícone, título,
   subtítulo, fatos curtos, estado e menu.
6. **Claro e escuro com o mesmo significado.** Os tokens têm o mesmo nome nos dois
   modos e só o valor muda.
7. **Nenhum valor no componente.**
   - O componente usa só tokens: variáveis CSS ou classes ligadas a elas.
   - Valores literais só existem no arquivo de tokens, e nos lugares onde CSS não chega
     (e-mail, `<meta theme-color>`, tema do editor de código, imagem OG). Nesses casos
     são importados do mesmo arquivo de tokens, nunca digitados.

---

## 2. Tokens de cor

Nomes semânticos (use estes nomes; o valor muda por modo).

### 2.1 Superfícies e texto

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `bg-deep` | `#22262a` | `#eaedf0` | atrás de tudo (borda da janela, faixa mais funda) |
| `bg` | `#2c3136` | `#f8f8f8` | fundo do app (superfície baixa) |
| `bg-alt` | `#22262a` | `#ffffff` | barras e trilho |
| `bg-surface` | `#22262a` | `#ffffff` | painéis e cartões (superfície alta) |
| `bg-overlay` | `#2c3136` | `#ffffff` | menus, popovers e diálogos |
| `bg-well` | `#2c3136` | `#f8f8f8` | poço dentro de um cartão (onde mora o valor) |
| `bg-chip` | `#353b41` | `#eaedf0` | chips e tags |
| `bg-hover` | `#353b41` | `#dfe3e7` | hover de linha ou item |
| `bg-active` | `#4a5158` | `#cfd5db` | item pressionado ou ativo |
| `overlay-scrim` | `rgb(0 0 0 / .5)` | `rgb(0 0 0 / .3)` | véu atrás de modal (com desfoque) |
| `fg-primary` | `#ffffff` | `#22262a` | títulos e texto forte |
| `fg-secondary` | `#cfd5db` | `#4a5158` | texto de corpo |
| `fg-tertiary` | `#adb5bd` | `#68717a` | texto apagado, legendas |
| `fg-quaternary` | `#8b949c` | `#8b949c` | dicas, contadores, placeholders |
| `fg-disabled` | `#68717a` | `#adb5bd` | desabilitado |

### 2.2 Bordas, seleção e foco

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `border-subtle` | `#353b41` | `#eaedf0` | filete entre linhas |
| `border-default` | `#4a5158` | `#cfd5db` | borda de campo, cartão e lista |
| `border-strong` | `#68717a` | `#adb5bd` | hover de campo, divisor forte |
| `border-loud` | `#8b949c` | `#8b949c` | foco sem acento, contorno de ícone ativo |
| `sel` | `rgb(125 105 228 / .15)` | `rgb(176 192 251 / .15)` | fundo do item selecionado (árvore, lista) |
| `sel-hover` | `rgb(125 105 228 / .22)` | `rgb(176 192 251 / .30)` | selecionado com hover |
| `sel-fg` | `rgb(170 153 255)` | `#6447fb` | texto do item selecionado |
| `focus` | `#6447fb` | `#6447fb` | anel de foco de campo |

### 2.3 Acento (rampa)

O mesmo degrau serve de fundo (100) e de texto (600) nos dois modos.

| Degrau | Escuro | Claro |
|---|---|---|
| 50 | `rgb(23 19 51)` | `#fafbff` |
| 100 (fundo de info) | `rgb(28 23 61)` | `#eff2fe` |
| 200 | `rgb(34 27 75)` | `#e8edfe` |
| 300 | `rgb(51 40 110)` | `#d0d9fd` |
| 400 | `rgb(75 62 143)` | `#b0c0fb` |
| **500 (acento)** | **`#6447fb`** | **`#6447fb`** |
| 600 (texto de acento) | `rgb(148 129 244)` | `#6447fb` |
| 700 | `rgb(170 153 255)` | (o do 600) |
| 800 | `#d0d9fd` | (o do 600) |
| 900 | `#eff2fe` | (o do 600) |
| `accent-hover` | `#735afa` | `#735afa` |

Faixa de aviso no topo: gradiente `#6447fb → #ff6767`, texto branco 14px/600.

### 2.4 Botões

| Token | Escuro | Claro |
|---|---|---|
| `button-primary` fundo / texto / hover | `#ffffff` / `#000000` / `#eaedf0` | `#000000` / `#ffffff` / `#2c3136` |
| `button-outline` borda / hover | `#4a5158` / `#68717a` | `#dfe3e7` / `#adb5bd` |
| `button-ghost` hover | `#2c3136` | `#f8f8f8` |

O primário é **monocromático** (branco no escuro, preto no claro). O acento roxo fica
para seleção e foco.

### 2.5 Estados e diff

| Token | Escuro | Claro |
|---|---|---|
| `success` | `rgb(26 191 151)` | `rgb(26 191 151)` |
| `danger` | `rgb(251 85 101)` | `rgb(233 31 4)` |
| `diff-del` | `#532532` | `#fbc8cf` |
| `diff-ins` | `#24582b` | `#ccfbc8` |
| `error-line` (linha com erro no editor) | `danger` a 12% sobre o fundo + barra de 3px `danger` na calha | igual |

Aviso e info usam as rampas: fundo 100 e texto 600.

### 2.6 Gráficos (ordem das séries)

`#79cbf9`, `#4085ec`, `#753087`, `#e56289`, `#ff9869`, `#ffd976`, `#4cb6bd`, `#79d8b6`.

---

## 3. Tipografia

| Uso | Valor |
|---|---|
| Família de UI | `"Inter", ui-sans-serif, system-ui, sans-serif`; pesos 500 (padrão) e 600; 700 só em rótulo de 10px |
| Família de código | `"SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace` |
| Editor de código | 12px |
| Grade de resultados | sans 14px, linha de 25px |
| Corpo padrão | **13px / 17px, peso 500** |

Escala:

| Tamanho/altura | Uso |
|---|---|
| 10/17 | rótulo pequeno; caixa alta só para índice de seção |
| 12/17 | legenda |
| 12/24 | item de menu denso |
| 12/26 | item de menu |
| **13/17** | **padrão** |
| 14/17 | botão e texto de destaque |
| 14/20 | parágrafo |
| 20/24, peso 600 | título de página e de documento |

Regras:
- O rótulo de um valor vai em 13px/500 na cor do texto, não em mono pequeno de caixa
  alta. Caixa alta com `letter-spacing` largo fica só para índice de seção e para o
  rótulo de grupo da árvore.
- A unidade de um número é um elemento separado e apagado: `4,3` em `fg-primary` e `s`
  em `fg-tertiary`.
- Número grande em cartão de estatística: peso 300.

---

## 4. Espaçamento, raio, sombra, movimento, camadas

| Tipo | Valores |
|---|---|
| Espaçamento | base 4px; **8px** (o mais usado), 12, 16, 24, 32, 40 |
| Raio | `xs`/`sm` 4px (campos, itens); `md` 6px (botões, cartões); `lg`/`xl` 8px (menus, popovers, modais); `2xl` 16px; pílula 9999px |
| Sombra de popover e menu | escuro: `0 4px 20px rgb(0 0 0 / .15), 0 0 1px #68717a`; claro: `0 4px 20px rgb(0 0 0 / .08), 0 0 1px #adb5bd` |
| Sombra suave lateral (painel flutuante) | 6 camadas de 0.7px/2.2px até 24px/80px, alpha de .02 a .07 |
| Borda de campo | `inset 0 0 0 1px border-default`; foco com anel `focus` |
| Movimento | transform 150ms `cubic-bezier(.4,0,.2,1)`; fade 700ms; slide 400ms; respeitar `prefers-reduced-motion` |
| z-index | 10 (painéis); 9999 (overlays) |

---

## 5. Layout da aplicação

```
┌──┬──────────────┬───────────────────────────────────────────────┐
│  │ PAINEL 300px │ ABAS 40px  [● doc ×] [doc ×] [+ New]           │
│T │              ├───────────────────────────────────────────────┤
│R │ título  [+]  │ CABEÇALHO: Título 20/24 600   ⋯   (Run ▾)(Share)│
│I │ [filtro    ] │ Details · Comments · Tools · Schedule · Save   │
│L │ ▾ GRUPO   n  ├────────────────────────┬──────────────────────┤
│H │   item       │ EDITOR                 │ RESULTADOS           │
│O │   item ●     │                        │ (cartões empilhados) │
│  │              │        ~50%   ┆ arrastável ┆   ~50%            │
│56│              │                        │                      │
│px│              ├────────────────────────┴──────────────────────┤
│  │              │ BARRA DE STATUS (mono pequeno)                 │
└──┴──────────────┴───────────────────────────────────────────────┘
```

| Elemento | Medida e regra |
|---|---|
| Trilho de navegação | 56px; ícones de 20px; ativo com contorno arredondado e fundo `bg-active`; conta (avatar) no pé |
| Painel lateral | ~300px; título + ação "+"; campo de filtro; grupos recolhíveis com contador |
| Barra de abas | 40px; aba ativa com fundo `bg-surface` (mais claro); ícone do tipo + nome + ×; ponto quando não salvo |
| Cabeçalho de documento | título 20/24 600, editável no lugar; menu ⋯; ações à direita em pílula de 34px |
| Botão de executar | pílula dividida: rótulo com o limite ("Run (limit 1,000)") + seta ▾ para as configurações de execução |
| Editor + resultados | ~50/50 lado a lado (opção: embaixo), divisor arrastável |
| Modal | véu `overlay-scrim` com desfoque; caixa `bg-overlay`, raio 8, título 16–20/600, rodapé com Cancelar (outline) e ação (primária) |
| Faixa de aviso | 60px, gradiente do acento, texto branco, × à direita |

---

## 6. Componentes

### 6.1 Botões
- **Primário:** `button-primary`, pílula de 34px (ou raio 6 em diálogo), texto 13–14/600.
- **Outline:** fundo transparente, borda `button-outline`; hover troca a borda.
- **Ghost / ícone:** sem borda, quadrado de 28px, raio 4, hover `bg-hover`.
- **Destrutivo:** texto e ícone em `danger`. Fundo `danger` só no diálogo de confirmação.

### 6.2 Campos
- Altura de 28 a 32px, raio 4, borda `border-default`, fundo `bg-surface`.
- Foco: anel de 2px `focus`.
- Placeholder em `fg-quaternary`. Os campos de código usam a família mono.

### 6.3 Lista em linhas (coleções)
- Uma caixa: borda `border-default`, raio 6, filetes `border-subtle` entre as linhas.
- Linha de 44 a 52px, padding 12×10:
  `[ícone 32] Título 13/500 + subtítulo 12 apagado ··· fatos 12 tabular ··· ● estado ··· [⋯]`.
- Hover `bg-hover`, título em acento.
- A linha inteira é clicável, mas os botões da direita não abrem o item.
- O estado é um ponto de 6px mais a palavra, na cor do estado.

### 6.4 Árvore (arquivos, schema)
- Grupos com rótulo em caixa alta de 10–11px e contador à direita
  (`TABLES 12`, `VIEWS 3`, `FUNCTIONS`, `PROCEDURES`; dentro de uma tabela: `COLUMNS`,
  `INDEXES`, `TRIGGERS`).
- Item de 28px; o recuo cresce 16px por nível.
- Selecionado: fundo `sel`, texto `sel-fg`. Hover: `bg-hover`.
- Menu por "⋯" e por clique direito, com as mesmas opções nos dois.
- Uma seção "Fixados" no topo, quando houver.

### 6.5 Cartão de estatística (compacto)
- Fundo `bg-surface`, borda `border-default`, raio 6, sem poço.
- Rótulo 13/500, número 20–24 peso 300 com a unidade apagada, contexto 12 apagado.

### 6.6 Cartões de resultado (pilha)
- Cada execução vira um cartão: cabeçalho com status, tempo, linhas e lixeira; abaixo, a
  grade paginada de 10 em 10.
- O mais novo fica no topo, com "Clear all".
- Erro no cartão: título "Falhou · CÓDIGO" (SQLSTATE ou o número do banco), a mensagem
  abaixo, e a linha marcada no editor.

### 6.7 Menus e popovers
- `bg-overlay`, raio 8, a sombra de popover, item de 28px com ícone de 14px, separadores
  `border-subtle`.
- Item destrutivo em `danger`.

### 6.8 Pílulas e chips
- Estado: fundo do degrau 100, texto do degrau 600, raio 9999, 11–12px.
- Chip de variável acima do editor: `nome / valor`, raio 4, fundo `bg-chip`.

### 6.9 Abas de documento
- 40px, fundo `bg`. A ativa tem `bg-surface` e um filete inferior apagado.
- Ícone do tipo de 14px; × aparece no hover; ponto quando não salvo.

### 6.10 Gráficos
- A paleta do item 2.6 na ordem, grade `border-subtle`, eixos 11–12px em `fg-tertiary`.
- Sem sombra nem gradiente.
- Antes de existir configuração, um estado vazio guiado em 3 passos: tipo, eixo X e
  série Y.

---

## 7. E-mail (o visual aplicado a mensagens)

- Só modo claro.
- Sem `<style>`: todo estilo vai inline, e o layout é feito com tabelas.
- Largura máxima de 600px.

| Papel | Valor |
|---|---|
| Página | `#f8f8f8` (`bg` claro) |
| Cartão | `#ffffff`, borda 1px `#cfd5db`, raio 8 |
| Poço / bloco de dado | `#f8f8f8`, raio 6 |
| Filete | `#eaedf0` |
| Texto | título `#22262a`, corpo `#4a5158`, apagado `#68717a`, fraco `#8b949c` |
| Acento e link | `#6447fb` (ou a cor de marca do cliente) |
| Botão principal | fundo `#000000`, texto `#ffffff`, pílula ou raio 6 |
| Sucesso / erro | `rgb(26 191 151)` / `rgb(233 31 4)`; pílula de estado com fundo claro da mesma família |
| Fonte | `Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif` |

Anatomia do cartão:
1. Faixa de identidade: título e pílula de estado.
2. Faixa de dado: o poço, com o valor em peso 300 e a unidade apagada.
3. Faixa de contexto: frase apagada e variação colorida.

---

## 8. Como implementar (qualquer stack)

1. **Um arquivo de tokens em dados** (TS, JSON ou YAML) com os itens 2 a 4, nos dois
   modos. Ele é a única fonte.
2. **Gerar a partir dele:**
   - as variáveis CSS (`:root[data-mode="dark"] { --color-bg: ... }` etc.);
   - os literais para o que não lê CSS: e-mail, `theme-color`, tema do editor,
     imagens OG.
3. **Ligar o framework de estilo às variáveis:** no Tailwind,
   `colors: { bg: 'var(--color-bg)', ... }`; em CSS-in-JS, um `theme` que referencia as
   variáveis.
4. **Proibir literais nos componentes:** uma regra de lint para hex, `rgb()` e
   `[#...]` em JSX/TSX/CSS fora do pacote de tokens, mais um teste de paridade entre o
   arquivo de tokens e o CSS gerado.
5. **Componentes num pacote compartilhado** (botão, campo, lista em linhas, árvore,
   menu, modal, pílula, cartão de estatística). Site, app e qualquer outra superfície
   importam de lá.
6. **Modo e estilo como atributos no `<html>`:** `data-mode="light|dark"` e, se o
   sistema tiver mais de um visual, `data-style="classic"`. Os tokens são definidos por
   combinação de atributos, para um estilo nunca vazar para o outro.

### Modelo de variáveis CSS (para colar)

```css
:root[data-mode="dark"] {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace;
  --color-bg-deep: #22262a;   --color-bg: #2c3136;        --color-bg-alt: #22262a;
  --color-bg-surface: #22262a; --color-bg-overlay: #2c3136; --color-bg-well: #2c3136;
  --color-bg-chip: #353b41;   --color-bg-hover: #353b41;  --color-bg-active: #4a5158;
  --color-overlay-scrim: rgb(0 0 0 / .5);
  --color-fg-primary: #ffffff; --color-fg-secondary: #cfd5db; --color-fg-tertiary: #adb5bd; --color-fg-quaternary: #8b949c;
  --color-border-subtle: #353b41; --color-border-default: #4a5158; --color-border-strong: #68717a; --color-border-loud: #8b949c;
  --color-sel: rgb(125 105 228 / .15); --color-sel-hover: rgb(125 105 228 / .22); --color-sel-fg: rgb(170 153 255);
  --color-accent: #6447fb; --color-accent-hover: #735afa; --color-accent-bg: rgb(28 23 61); --color-accent-fg: rgb(148 129 244);
  --color-focus: #6447fb; --color-success: rgb(26 191 151); --color-danger: rgb(251 85 101);
  --shadow-popover: 0 4px 20px rgb(0 0 0 / .15), 0 0 1px #68717a;
}
:root[data-mode="light"] {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace;
  --color-bg-deep: #eaedf0;   --color-bg: #f8f8f8;        --color-bg-alt: #ffffff;
  --color-bg-surface: #ffffff; --color-bg-overlay: #ffffff; --color-bg-well: #f8f8f8;
  --color-bg-chip: #eaedf0;   --color-bg-hover: #dfe3e7;  --color-bg-active: #cfd5db;
  --color-overlay-scrim: rgb(0 0 0 / .3);
  --color-fg-primary: #22262a; --color-fg-secondary: #4a5158; --color-fg-tertiary: #68717a; --color-fg-quaternary: #8b949c;
  --color-border-subtle: #eaedf0; --color-border-default: #cfd5db; --color-border-strong: #adb5bd; --color-border-loud: #8b949c;
  --color-sel: rgb(176 192 251 / .15); --color-sel-hover: rgb(176 192 251 / .30); --color-sel-fg: #6447fb;
  --color-accent: #6447fb; --color-accent-hover: #735afa; --color-accent-bg: #eff2fe; --color-accent-fg: #6447fb;
  --color-focus: #6447fb; --color-success: rgb(26 191 151); --color-danger: rgb(233 31 4);
  --shadow-popover: 0 4px 20px rgb(0 0 0 / .08), 0 0 1px #adb5bd;
}
:root {
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-2xl: 16px; --radius-pill: 9999px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --ease: cubic-bezier(.4, 0, .2, 1); --dur-fast: 150ms;
  --viz-1: #79cbf9; --viz-2: #4085ec; --viz-3: #753087; --viz-4: #e56289;
  --viz-5: #ff9869; --viz-6: #ffd976; --viz-7: #4cb6bd; --viz-8: #79d8b6;
}
body { font-family: var(--font-sans); font-size: 13px; line-height: 17px; font-weight: 500;
       background: var(--color-bg); color: var(--color-fg-secondary); }
```

### Checklist de aceite
- [ ] Nenhum hex, `rgb()` ou `[#...]` fora do pacote de tokens (lint passando).
- [ ] Claro e escuro conferidos em captura nas telas principais.
- [ ] Contraste AA no texto `fg-secondary` sobre `bg` e `bg-surface` nos dois modos.
- [ ] Foco visível (`focus`) em todo controle; navegação por teclado nos menus e na
  árvore.
- [ ] E-mails conferidos em pelo menos Gmail web, Gmail celular e Outlook.
