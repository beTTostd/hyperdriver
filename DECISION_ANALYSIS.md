# Avaliação de decisões — versão 5

Esta entrega implementa a base auditável da etapa 1, a busca restrita da etapa 2
e experiências de informação oculta da etapa 3 e aprendizado da etapa 4 em shadow mode. A experiência
é exposta em `hiddenInformation` e não altera a nota, a confiança ou os marcadores
da análise principal.
A pontuação permanece experimental: `heuristic_points`, sem transformação em
probabilidade de vitória. Os horizontes suportados são `end_of_turn` e
`known_hand_response_turn`. `current_decision` identifica o diagnóstico de escolhas
para as quais não foi possível construir uma linha completa; ele não gera recomendação.

O catálogo contém nove entradas: Wounding Blow vermelho e azul, Critical Strike
vermelho, Brutal Assault amarelo, Nimblism nas três cores, Goliath Gauntlet e
Quick Clicks. Cada entrada inclui custo, poder, defesa, pitch, tipo, efeitos
implementados e fonte oficial. Nimblism e Goliath respeitam o custo da próxima
carta de ataque elegível; Quick Clicks exige Nimblism no mesmo turno e concede
go again ao próximo ataque. Equipamentos sem blade break ou battleworn retornam
após defender; a ativação dos dois equipamentos modelados os destrói.
Consulte [o catálogo](lib/decision-card-catalog.js) antes de ampliar a cobertura.
As regras de ações e go again seguem o [centro oficial](https://rules.fabtcg.com/en/cr/08-keywords/).
A reposição no primeiro turno segue [CR 4.4.3f](https://rules.fabtcg.com/en/cr/04-game-structure/).
As versões do avaliador refletem o código executado; variáveis de ambiente antigas
não renomeiam uma implementação diferente. Esta cobertura é genérica e não declara
suporte completo a nenhum herói.

## Transições, busca e evidências

[O motor](lib/decision-turn-search.js) enumera linhas por instância física, com poda
de estados equivalentes. Cada passo passa por uma função pura de transição exportada
para reprodução: declarar, fazer pitch, resolver, bloquear, iniciar resposta,
guardar no arsenal, encerrar ou registrar dano letal. Custos, recursos e AP são
verificados em cada passo. Só é permitido fazer pitch durante um pagamento ainda
incompleto. Guardar uma carta no arsenal fecha a fase de ações. O fim do turno
expira recursos, AP e bônus temporários.

A ação capturada fixa o primeiro passo de cada linha comparada. O restante é uma
continuação calculada, não uma reconstrução das escolhas posteriores do jogador.
Em defesa, a busca considera conjuntos de bloqueios adicionais legalmente
selecionáveis e o turno seguinte com a mão conhecida preservada. Exige um ataque
sem continuação adversária conhecida; interrompe a linha quando o dano é letal.
Não compra novas cartas. No turno zero, a reposição da mão impede essa avaliação
de resposta e provoca abstenção.

O limite padrão é 4.096 nós por decisão e 262.144 por replay, distribuídos na ordem
das decisões. Adicionar decisões futuras não muda o orçamento de uma decisão
anterior. A enumeração é determinística (`seed: 0`); orçamento, nós explorados,
estados podados, completude e versão do motor acompanham o resultado. Esgotar
qualquer orçamento impede uma recomendação, mesmo que exista uma linha parcial.

Cada linha fornece a sequência, recursos/AP antes e depois, estado final e uma
decomposição numérica que soma exatamente a nota. Os termos são poder oferecido,
vida preservada, potencial conhecido do arsenal, cartas consumidas, equipamentos
gastos e recursos perdidos no fim; um desfecho letal recebe penalidade explícita.
Os pesos são heurísticos. Poder oferecido não é dano recebido pelo adversário.
O potencial terminal do arsenal usa apenas cartas conhecidas retidas e seu pitch,
sem imaginar as próximas compras. Padrões sobre bloqueio usam a contribuição da
seleção capturada, evitando atribuir movimentos calculados ao jogador.

O avaliador soma as cartas selecionadas por instância, rejeita seleções parciais,
ambíguas, repetidas ou de outra zona/modo e inclui a escolha executada entre as
candidatas. Para seleções compostas de defesa, enumera alternativas da mesma
cardinalidade, modo e zona; respeita dominate e suspende julgamento com overpower.
Há um limite de oito cartas entre mão e arsenal e de 256 candidatas por decisão.
A confiança diminui quando esse orçamento é atingido.

Bloqueio bruto e excesso são separados da vida preservada, limitada pelo dano
restante. Poder impresso é uma entrada heurística, sem simulação de dano recebido
pelo adversário. Continuidade depende das transições de AP e dos efeitos modelados.
A busca calcula o pitch necessário para a sequência declarada. Escolhas capturadas
isoladamente na janela de pitch ainda exigem abstenção: a captura não garante o
contexto completo do pagamento pendente. Não se extrai o custo de uma legenda nem
de uma carta revelada posteriormente.

Reações, instants, cartas desconhecidas, modificadores, efeitos públicos,
restrições capturadas e bônus anteriores não reconstruídos suspendem recomendações.
Uma cadeia já ativa numa decisão de ação também fica fora da cobertura. Decisões inferidas
também recebem baixa confiança. Habilidades de herói e a resposta adversária não
são simuladas; essa limitação aparece na resposta e na interface. Não há confiança
alta antes da validação independente. Os limiares de marcadores e os índices de
potencial/execução continuam sendo convenções heurísticas, não calibração estratégica.

A API fornece unidade, horizonte, candidatas, sequências, estado final, orçamento,
decomposição, cobertura, limitações e motivos de incerteza. O relatório e a mesa
mostram as sequências; o relatório também mostra os termos das duas notas comparadas.
A revisão mostra até três momentos, priorizando as maiores
diferenças e evitando repetir o mesmo fingerprint de mão. Casos sem cobertura são
visíveis como abstenções no relatório. Padrões não são apresentados como evidência
causal de problemas do deck. As contagens públicas preservam cópias nos snapshots;
não constituem por si só uma distribuição inferida da mão adversária ou da lista do deck.

## Informação oculta — experiência da etapa 3

[O histórico público](lib/decision-opponent-knowledge.js) mantém limites inferiores
de cópias simultaneamente observadas, o pitch atual e saídas observadas da zona de
pitch. Repetir frames ou mover uma carta de zona não soma novas cópias. Os snapshots
não demonstram a ordem de reposição nem a localização posterior de cada carta;
essa incerteza é preservada. O histórico segue apenas o caminho canônico, depois
de excluir os ramos abandonados por undo.

[O modelo adversário](lib/decision-opponent-model.js) usa formato, contexto do herói,
contagens de mão/arsenal/deck e cartas públicas disponíveis até a decisão. Na
cobertura atual, aceita CC, Blitz e Commoner, aplicando os limites de cópias dos
[formatos construídos](https://rules.fabtcg.com/en/trp/07-constructed-formats/).
Heróis e equipamentos com habilidades ainda não são simulados. Sem lista conhecida,
há três hipóteses parciais de cartas genéricas: ataques, recursos e Nimblism.
São hipóteses manuais, não arquétipos reais aprendidos do corpus. Seus pesos não
são probabilidades calibradas de um deck. Uma massa explícita de cartas sem
cobertura completa o conjunto oculto, sem inventar propriedades para essas cartas.

Um experimento offline pode fornecer `opponentModel` com `knownAtFrame`, `hero`,
`format` e `initialCounts`. A lista deve já estar disponível antes da decisão,
respeitar as contagens observadas e o total das zonas. Não se lê uma lista final
do replay, um deckLink ou identidades da mão adversária para montar esse modelo.
Nenhuma lista externa é buscada automaticamente. Os modelos parciais continuam
exibindo cobertura incompleta quando admitem cartas sem transições modeladas,
mesmo se algumas amostras aleatórias não contiverem essas cartas.

[A busca](lib/decision-information-search.js) implementa uma variante restrita de
SO-ISMCTS: uma árvore UCT compartilhada entre determinações, com ações que são
planos completos e previamente verificados pela enumeração. A ordem das candidatas
é canônica, sem depender da escolha que o jogador fez. A seleção da linha ocorre
antes da amostragem da mão oculta. A política local se compromete com a linha e
não a adapta à identidade de uma carta ainda oculta. Isso evita a vantagem de
escolher uma continuação diferente para cada mão secreta. É uma busca sobre planos
comprometidos, não um motor completo de FaB nem uma política que reage a todas
as observações de combate. A abordagem segue a preocupação com *strategy fusion*
do [trabalho original de ISMCTS](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf).

A primeira janela suportada é uma ação do jogador sem cadeia ativa, com cartas
auditadas. As mãos são amostradas sem reposição, descontando as cartas atualmente
fora das zonas ocultas. A defesa adversária usa duas políticas heurísticas:
preservar mão e preservar vida. Cada política vê somente a própria mão e o ataque
atualmente revelado; não vê a mão local nem os ataques que ainda virão. Bloqueios
consomem cartas por instância, vida não bloqueada é descontada e dano letal encerra
a simulação antes de atribuir valor a ações futuras. Reações, habilidades de herói,
compras e turnos adversários seguintes continuam fora da cobertura.

O orçamento de busca experimental tem o mesmo teto de 4.096 unidades da busca
principal: parte para enumeração, parte para a árvore. A comparação usa um orçamento
separado de até 2.048 unidades para cenários pareados. Uma unidade conta uma visita
de busca, transição ou alternativa de bloqueio; não equivale a tempo de CPU constante.
O replay limita todo o trabalho experimental adicional a 262.144 unidades. Os
custos reais, orçamento, sementes, amostras cobertas e versões são registrados.

A validação usa sementes separadas das usadas na seleção, mantendo o mesmo cenário
para cada candidata e para a linha da etapa 2. Ela não modifica a linha escolhida
pelo treino da árvore. A API mostra ganho heurístico condicionado à cobertura,
faixa de diferenças amostradas, sensibilidade por hipótese/política e concordância
com tolerância explícita de 0,25 ponto. Essa faixa não é um intervalo de confiança
estatístico. Notas baseadas em dano simulado e gasto de cartas adversárias não são
probabilidades de vitória. Nenhuma recomendação experimental entra nas metas ou
nos marcadores, mesmo quando é estável nos cenários testados.

### Comparação reproduzível

```bash
node scripts/decision-search-benchmark.mjs synthetic /tmp/search-report.json
node scripts/decision-search-benchmark.mjs /tmp/authorized-search-cases.json /tmp/search-report.json
```

O arquivo autorizado é um array de `{ matchKey, observation, opponentModel? }`;
`matchKey` deve ser pseudonimizado e cada observação deve conter apenas o estado
conhecido. O comparador não lê contas, banco ou novos replays. Usa três sementes,
duas políticas adversárias, tetos iguais de busca e validação pareada. Registra
cobertura, estabilidade entre sementes, tempo e trabalho por execução. As médias
são agrupadas por partida; múltiplas decisões e sementes não viram partidas
independentes. O relatório sempre registra `releaseEligible: false` e
`strategicallyValidated: false`: esse benchmark de simulação não substitui revisores.

A suíte sintética inicial tem oito subproblemas com uma mão pequena e uma lista
auditada explícita. Ela demonstra ganho em alguns casos, incluindo uma linha letal
que a heurística de poder/arsenal não prioriza, e detecta sensibilidade a políticas.
Não demonstra ganho em partidas reais. A promoção da etapa 3 permanece condicionada
à cobertura por herói e à validação independente do roteiro.

## Persistência e metas

A migração `0015_decision_score_units.sql` conserva as unidades históricas,
identifica a versão das observações e permite que versões diferentes coexistam
durante o recálculo. O replay original não é alterado. Agregações e recomendações
atuais exigem a identidade completa do modelo e a unidade atual. Análises históricas
são identificadas como metodologia anterior, sem reinterpretar suas notas.
Na etapa 3 não há nova migração SQL: a identidade do avaliador/schema 4 conserva
as análises da versão 3 e impede que a agregação misture suas metodologias.

Novas metas automáticas usam oportunidades relevantes ao padrão (pitch, defesa,
arsenal etc.) e congelam a identidade do modelo. Metas antigas conservam seu
denominador original e sua versão. Uma nova versão não conta como melhora em uma
meta iniciada com outra metodologia. Não há recálculo ou coleta histórica automática
como parte desta entrega.

## Processamento

A fila existente orquestra um processo Node filho para cada análise; a enumeração
síncrona não ocupa o event loop do servidor web. O processo tem timeout de dois
minutos e pode ser cancelado. A fila renova o lease de cinco minutos a cada
30 segundos, cancela o processo se perder a posse e confere token e expiração
dentro da transação antes de persistir. A validação do artefato standalone exige
os arquivos do motor e do processo filho. Os logs não incluem o replay nem erros
brutos do processo de simulação.

## Benchmark com corpus autorizado

O módulo `lib/decision-benchmark.js` recebe exemplos explicitamente fornecidos.
Ele não lê contas, banco ou replays automaticamente. A preparação escolhe dois
heróis por jogadores distintos, partidas distintas e, por último, volume de
decisões; usa rodízio entre herói/tipo e uma decisão por partida. Se faltarem
200 partidas elegíveis, retorna `complete: false`, sem preencher casos artificiais.

O arquivo de entrada é um array de `{ matchKey, playerKey, observation }`, com
chaves já pseudonimizadas e observações produzidas pelo extrator. Não publique
os arquivos do corpus ou da revisão no repositório.

```bash
node scripts/decision-benchmark.mjs prepare /tmp/authorized-examples.json /tmp/benchmark.json
node scripts/decision-benchmark.mjs report /tmp/reviewed-benchmark.json /tmp/benchmark-report.json
```

A preparação retém somente o estado conhecido de cada observação. Cada caso tem
`reviews` e `adjudication`. Os revisores recebem esse estado sem revelações futuras;
cada revisão registra `reviewer`, `acceptedActionKeys`, `legal`,
`futureInformationUsed` e `explanationFaithful`. Pelo menos dois revisores distintos
são necessários. Divergências exigem um terceiro adjudicador. Depois da revisão,
associe a saída do avaliador a `analysis` para medir sua aceitação.

O relatório separa cobertura, abstenção, concordância, divergências e violações.
Calcula Wilson de 95% para a aceitação de recomendações de confiança alta. A liberação
exige 200 casos distintos revisados, nenhuma divergência pendente ou violação e
limite inferior de 90%. `mandatoryScenariosPassed` deve vir da execução documentada
do benchmark obrigatório; seu valor padrão é falso. Este relatório não ativa
automaticamente uma versão na aplicação.

## Etapa 4 — aprendizado e exercícios privados

[O treinador offline](lib/decision-learning-training.js) implementa dois modelos
lineares separados. O primeiro prevê a escolha humana observada entre as ações
legais capturadas; o segundo prevê o resultado observado da partida a partir do
estado conhecido. Uma escolha frequente não recebe rótulo de melhor jogada, e
nenhuma decisão de uma vitória é rotulada automaticamente como correta. O modelo
de resultado não avalia contrafactuais, não fornece recompensa para a busca e não
substitui a pontuação principal por percentuais de vitória.

As entradas são uma lista positiva de atributos do estado e das cartas conhecidas,
com nomes e dimensões versionados em [decision-learning.js](lib/decision-learning.js).
Resultados, avaliações dos revisores, nomes, identificadores de jogador/partida,
datas e identidades de cartas adversárias privadas não entram nos vetores.
Datas servem para separar os conjuntos e controlar a disponibilidade do modelo.
O alvo de escolhas usa apenas decisões capturadas com 2–32 ações individuais,
cartas cobertas e valores necessários conhecidos. Escolhas compostas, decisões
inferidas, modificadores e efeitos sem cobertura são excluídos desta primeira versão.

O treinamento recebe somente um arquivo explicitamente autorizado; não lê o
banco nem amplia a coleta. Cada linha contém:

```json
{
  "playerKey": "codigo-pseudonimo",
  "matchKey": "partida-pseudonima",
  "startedAt": 1767225600000,
  "completedAt": 1767226500000,
  "observation": { "state": {}, "legalActions": [], "chosenAction": {}, "dataQuality": "captured" },
  "outcome": 1
}
```

`observation` deve ser uma observação completa retornada por
`extractDecisionObservations`, com fingerprints e horário do frame; `{}` acima
abrevia apenas a documentação. `outcome` é 0/1 da perspectiva do jogador da linha
e fica fora de `observation.state`. Observações sem resultado podem contribuir
para o alvo humano; o corpus de resultado exige rótulos suficientes em cada conjunto.
O limite operacional inicial é 2.000 linhas e 200 épocas.

```bash
node scripts/decision-learning-train.mjs authorized-corpus.json /tmp/model.json /tmp/report.json 2026-03-01T00:00:00Z 2026-06-01T00:00:00Z
node scripts/decision-learning-train.mjs synthetic /tmp/model-synthetic.json /tmp/report-synthetic.json
```

Jogadores são atribuídos ao período mais recente em que aparecem; suas linhas
anteriores são expurgadas. Partidas nunca atravessam conjuntos e rótulos concluídos
depois do próximo corte temporal são expurgados. Treino, validação e teste têm
respectivamente mínimo de 20/10/10 partidas e 5/3/3 jogadores distintos; ambos os
resultados precisam existir em cada conjunto. Esses mínimos permitem um smoke
test, não representam suficiência estratégica. Corpus insuficiente produz
`insufficient_data` e arquivo de modelo `null`.

Cada partida soma peso 1, inclusive quando contém várias decisões. O ajuste usa
somente treino; a temperatura é escolhida somente em validação; o teste independente
mede log loss e acurácia das escolhas, Brier score, log loss, erro de calibração e
dez faixas de confiabilidade do resultado. O relatório registra cortes, exclusões,
expurgos e contagens por jogador/partida. O artefato contém digest do corpus,
versões, dimensões, faixas de atributos e digest de integridade do próprio artefato,
sem listas de jogadores ou replays. Arquivos são escritos com permissão 0600.

O worker pode carregar explicitamente o artefato pelo caminho configurado em
`HYPERDRIVER_DECISION_LEARNING_MODEL_FILE`. Arquivos ausentes, inválidos, incompatíveis
ou acima de 128 KiB deixam o aprendizado desativado. A inferência se abstém em
domínios herói/formato/janela não observados no treino, efeitos sem cobertura,
atributos fora das faixas e decisões sem horário ou anteriores à disponibilidade
do artefato. Essa disponibilidade é posterior a todos os resultados usados no
relatório; um modelo recém-treinado não reavalia decisões anteriores como se já
existisse naquele momento.

Se o alvo humano melhorar a log loss sobre escolhas uniformes no teste, suas
probabilidades podem orientar a exploração das primeiras ações por PUCT, com
mistura uniforme de 50%. Toda ação continua disponível; a linha é escolhida antes
da amostragem da mão oculta, e a recompensa continua vindo do simulador coberto.
Isso permanece experimental: melhorar previsão humana não promove recomendações.
O identificador do modelo, uso efetivo, motivos de abstenção e alvos separados
ficam em `learning` e `hiddenInformation.guidance` de cada decisão. Os marcadores,
notas, metas e exercícios continuam usando exclusivamente a busca principal.

Para uma ablação pareada, acrescente o arquivo do modelo ao benchmark da busca:

```bash
node scripts/decision-search-benchmark.mjs authorized-cases.json /tmp/ablation.json /tmp/model.json
```

O relatório compara busca sem/com orientação sob os mesmos limites, sementes e
cenários de validação. Só calcula diferenças com cobertura completa e grupos
pareados; agrega por partida. Não aplica estimadores off-policy com probabilidades
humanas desconhecidas. `releaseEligible` continua falso.

A página `/me/training`, acessível pelas metas e estatísticas, oferece até 12
exercícios derivados dos últimos 50 replays próprios analisados pela versão atual
(até 2.000 decisões). Ela exclui replays assistidos, análises antigas, decisões
inferidas, baixa confiança, linhas incompletas e escolhas fora da cobertura.
Prioriza tipos de decisão recorrentes e diferenças acima de 1,5 pontos, agrupa a
mesma mão para evitar repetir o mesmo plano e apresenta ocorrências por oportunidades
e partidas distintas. O enunciado mostra somente o estado conhecido e as opções.
A resposta revela a sequência escolhida, a melhor linha encontrada, a diferença,
a decomposição numérica e as condições que podem mudar a preferência. Linhas
até 1,5 pontos da melhor pontuação são aceitas como próximas.

`GET /api/training/exercises` não envia gabaritos. A tentativa em
`POST /api/training/exercises/:id/attempt` recalcula a elegibilidade e verifica o
proprietário, inclusive para administradores; exige autenticação e valida a origem.
O corpo contém `actionKey`; feedback de utilidade posterior contém apenas
`helpful: true/false`. A migração `0016_training_exercise_attempts.sql` guarda
tentativas, última escolha, diferença, versão e feedback privado, com exclusão
em cascata de replay/conta. Treino de quiz é separado da evolução medida em partidas;
feedback de utilidade não atualiza modelos automaticamente.

Estas escolhas seguem a distinção entre previsão humana e força estratégica
discutida em [Maia-2](https://arxiv.org/abs/2409.20553), a integração de avaliação e
busca explorada em [Hearthstone](https://arxiv.org/abs/1808.04794) e a necessidade de
medir calibração separadamente de acurácia em [Guo et al.](https://proceedings.mlr.press/v70/guo17a.html).
São aplicações experimentais dessas referências, sem validação estratégica em FaB.

## Condições ainda pendentes

As etapas 3 e 4 foram implementadas em modo experimental e ainda precisam
satisfazer os critérios de promoção com corpus real independente e revisão humana.
A utilidade dos exercícios precisa ser medida com jogadores, separadamente de
acertos no quiz. Também faltam
ampliar e validar a cobertura por herói e investigar um adaptador
para o motor Talishar. Os frames não devem ser tratados como o estado interno
completo desse motor. A seleção dos dois primeiros heróis depende de um corpus
autorizado fornecido ao preparador do benchmark; nenhum corpus foi ampliado ou
extraído automaticamente nesta entrega.

Os testes reproduzem as linhas, rejeitam transições ilegais, comparam 192 mãos e
orçamentos de recursos com uma enumeração independente e verificam limites,
informação futura e cancelamento. Os testes da etapa 3 verificam também contagens de cópias,
amostragem sem reposição, legalidade dos bloqueios, dano letal, limites de orçamento,
reprodução das sementes, sensibilidade às políticas e ausência de informação futura.
Isso verifica os cenários modelados; não substitui o benchmark estratégico.
O smoke test da etapa 4 treinou e ajustou temperatura apenas em 100 partidas
sintéticas: 60 de treino, 20 de validação e 20 de teste, com dez jogadores distintos
por conjunto. A ablação sintética orientou quatro de oito casos (os demais ficaram
fora da distribuição), com ganho médio de 0,032 pontos nos casos cobertos e limites
respeitados. Esses resultados verificam o encadeamento, não a qualidade estratégica.
Não foi executado treinamento ou calibração com partidas reais nem benchmark
humano, nem demonstrada melhoria estratégica em partidas. A confiança continua
limitada a média, aguardando a revisão independente prevista no roteiro.
