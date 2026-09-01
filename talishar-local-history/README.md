# Talishar Local History

Extensão Chrome do Hyperdriver para registrar partidas do Talishar, manter uma cópia local e sincronizar históricos completos com a conta do usuário.

## O que esta versão faz

- Observa o stream de atualizações do Talishar (`GetUpdateSSE.php`) e os endpoints de ação (`ProcessInput.php` e `ProcessInputAPI.php`).
- Guarda snapshots compactos da partida no IndexedDB da extensão.
- Registra a escolha efetiva com uma lista fechada: código da ação, zona e identificador da carta ou opção.
- Remove campos de autenticação conhecidos antes de persistir os dados.
- Detecta o fim da partida e deixa o replay pronto para sincronização.
- Permite baixar ou apagar cada partida pelo popup da extensão.
- Permite importar um ou vários JSONs já salvos pelo popup da extensão.
- Permite solicitar a sincronização de todos os replays pendentes de uma vez.
- Serializa snapshots da mesma partida para evitar perda de quadros em rajadas de eventos.
- Descarta atualizações recebidas depois que a partida já foi concluída.
- Reutiliza a mesma gravação ao atualizar `/game/play/{id}`; outro ID de partida inicia uma captura nova.
- Ao abrir `hyperdriver.com.br` ou `beta.hyperdriver.com.br` autenticado, envia automaticamente partidas completas ainda não sincronizadas naquele ambiente.
- Mostra no popup quantos dos dois ambientes já receberam cada partida (`Sincronizado 1/2` ou `2/2`); antes do primeiro envio, usa os estados `Pronto`, `Baixado` ou `Erro`.
- Mantém a cópia local e o arquivo baixado depois do envio.
- Preserva nos dados do replay o link HTTPS da lista do deck do jogador; o Talishar nunca fornece esse campo a espectadores.

## Como instalar no Chrome

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione esta pasta: `talishar-local-history`.
5. Abra uma partida em `https://talishar.net`.
6. Clique no ícone da extensão para acompanhar e baixar o JSON.
7. Para recuperar arquivos antigos, clique em **Selecionar JSONs** e escolha os arquivos salvos.
8. Entre no Hyperdriver para sincronizar automaticamente as partidas concluídas.

Os arquivos exportados ficam em `Downloads/Talishar Local History/`.

## Privacidade e sincronização

- A extensão acessa somente Talishar e os dois domínios oficiais do Hyperdriver declarados no manifesto.
- Partidas incompletas não são enviadas; cada ambiente mantém seu próprio estado de upload e de erro, portanto uma falha no beta não bloqueia a produção (nem o inverso).
- Importações são limitadas a 50 MB e validadas antes de entrar no histórico local.
- A extensão mantém no máximo 100 partidas e 200 MB de replays compactados. Ao atingir um limite, remove apenas partidas concluídas que já foram exportadas ou sincronizadas; nunca remove silenciosamente um replay sem cópia.
- Atualizações da página passam por validação de origem, endpoint, tamanho e frequência antes de serem encaminhadas ao armazenamento.
- O upload usa a sessão já aberta no site e passa a pertencer à conta autenticada na primeira sincronização bem-sucedida.
- Não são solicitadas permissões de histórico, cookies, abas ou acesso genérico a todos os sites.
- Campos conhecidos como `authKey`, `token`, `cookie`, `password`, nome da partida e IDs de sessão são redigidos antes do armazenamento.
- A extensão nunca persiste o corpo bruto das requisições de ação. Somente `mode`, zona e identificadores sanitizados podem formar um evento de decisão.
- O payload mantém somente o estado usado pelo replay e pelo treinador pós-partida: cartas, zonas, vida, turno, fase, combate, prioridade, recursos, action points, alternativas apresentadas, formato da partida e o link validado da lista do deck do jogador. Chat, inventário, dados de conta e estado de interface são descartados.

## Limitações conhecidas

O Talishar não publica um contrato estável para o formato dos eventos. Por isso, a extensão mantém uma projeção conservadora do estado necessário para a mesa e extrai indicadores genéricos, como turno ativo e final de jogo quando disponíveis.

## Estrutura do JSON

Cada arquivo contém `schemaVersion`, informações da captura, status, resumo, a sequência de snapshots compactos e, desde a versão 0.3.0, `match.decisionEvents`. Na versão 0.4.0, `initialLoad` também conserva somente os identificadores de partida necessários ao Elo administrativo (`gameGUID`, `playerName`, `opponentName` e `isOpponentAI`), além do formato e do link de deck já sanitizado. Cada decisão referencia a quantidade de frames conhecida quando a escolha ocorreu e contém apenas a projeção sanitizada da ação. O campo `match.sync.targets` registra separadamente os envios para `https://beta.hyperdriver.com.br` e `https://hyperdriver.com.br`; o formato antigo com um único `sync` é migrado ao ser lido. Isso reduz o armazenamento e evita transportar autenticação, logs de chat, requisições brutas ou dados de interface que não participam do replay.
