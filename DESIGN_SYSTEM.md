# Hyperdriver — Pitwall

> Telemetria de corrida aplicada ao FAB.

## Direção

Brutal, esportivo e extremamente legível. Preto, branco e vermelho de sinalização. Parece uma ferramenta de equipe competitiva.

## Paleta

| Token | Hex | Uso |
|---|---|---|
| Carbon | `#090A0B` | Fundo principal e base da marca |
| Panel | `#121416` | Cards, painéis e superfícies elevadas |
| Paper | `#F2F1EC` | Texto principal e elementos claros da marca |
| Signal Red | `#FF4D3D` | Ação, velocidade, destaque e marca |
| Telemetry Blue | `#6BB8FF` | Informação técnica e dados auxiliares |
| Muted | `#8B9298` | Labels e texto secundário |

## Tipografia

- **Display:** Arial Narrow / DIN Condensed
- **Body:** Inter / system-ui
- **Data:** IBM Plex Mono

Títulos são condensados, fortes e curtos. Dados competitivos e métricas usam fonte monoespaçada para reforçar a linguagem de telemetria.

## Marca e ícone

O ícone oficial do Hyperdriver é composto por **três faixas inclinadas para a direita**:

- duas faixas sólidas em **Signal Red**;
- uma terceira faixa **vazada**, usando **Paper** no contorno;
- fundo **Carbon**;
- todas as faixas possuem a mesma direção e ritmo visual.

A composição comunica **velocidade, progressão e telemetria** sem depender de uma representação literal de cartas, gráficos ou motores.

### Construção

```text
/  /  /
█  █  □
```

As três faixas devem ser percebidas como um único símbolo. A terceira faixa vazada é a assinatura visual que diferencia o Hyperdriver de marcas genéricas de automobilismo.

### Uso no header

No header, usar o símbolo à esquerda do wordmark:

```text
///  HYPERDRIVER
```

- Altura recomendada do símbolo: **28–36 px**.
- Espaço entre símbolo e wordmark: aproximadamente **50% da largura de uma faixa**.
- O símbolo não deve ficar dentro de outro badge, círculo ou container quando usado no header.
- O wordmark pode usar a tipografia Display em caixa alta.

### Uso como favicon

O favicon usa **somente o símbolo**, sem texto.

Tamanhos previstos:

| Contexto | Asset |
|---|---|
| Browser favicon | `brand/favicon.ico` |
| 16 px | `brand/hyperdriver-icon-16.png` |
| 32 px | `brand/hyperdriver-icon-32.png` |
| 48 px | `brand/hyperdriver-icon-48.png` |
| Apple touch icon | `brand/hyperdriver-icon-180.png` |
| PWA | `brand/hyperdriver-icon-192.png` |
| Alta resolução | `brand/hyperdriver-icon-512.png` |

Em tamanhos pequenos, **não adicionar detalhes, sombras, textos ou elementos extras**. O reconhecimento deve depender apenas da silhueta das três faixas.

### Área de proteção

Manter ao redor do símbolo uma área livre equivalente a pelo menos **metade da largura de uma faixa**.

Nenhum texto, borda, card ou outro elemento deve entrar nessa área.

### Cores permitidas

**Primária — dark**

- fundo: Carbon
- faixas sólidas: Signal Red
- faixa vazada: Paper

**Monocromática clara**

- todas as faixas: Paper
- fundo: Carbon

**Monocromática escura**

- todas as faixas: Carbon
- fundo claro

Evitar alterar individualmente as cores das três faixas fora dessas variações.

### Não fazer

- Não rotacionar o símbolo.
- Não alterar a quantidade de faixas.
- Não preencher a terceira faixa na versão principal.
- Não usar gradientes na versão de produção.
- Não adicionar glow ao favicon.
- Não colocar letras dentro das faixas.
- Não usar Telemetry Blue como cor principal da marca.
- Não reduzir o contraste entre o símbolo e o fundo.

## Assinatura visual

**Sector Bars — blocos horizontais que tratam cada turno como um setor de corrida.**

O mesmo ritmo das três faixas pode aparecer discretamente em loaders, divisores, indicadores de progresso e estados ativos, criando continuidade entre marca e produto.

## Regras de interface

- Dados importantes sempre dominam decoração.
- Cor de acento deve indicar estado, seleção ou insight; não preencher a tela inteira.
- Cards usam borda antes de sombra.
- Números competitivos usam fonte monoespaçada.
- Gráficos devem funcionar mesmo sem depender apenas de cor.
- Estados hover/focus precisam ser claros.
- Motion deve comunicar atualização, mudança de turno ou momentum.
- Reduzir animações quando `prefers-reduced-motion` estiver ativo.
- Usar Signal Red com parcimônia: marca, CTA principal, seleção e eventos críticos.
- Telemetry Blue representa informação, nunca a identidade principal.

## Aplicação sugerida

- **Home:** replays recentes + resumo de performance.
- **Match:** timeline da partida, valor por turno e combat chain.
- **Player:** tendências, matchups, hero usage e win rate.
- **Insights:** maiores swings, turnos desperdiçados e eficiência de mão.
