# Talishar Local History

Extensão Chrome do Hyperdriver para registrar partidas do Talishar, manter uma cópia local e sincronizar históricos completos com a conta do usuário.

## O que esta versão faz

- Observa exclusivamente o stream de atualizações do Talishar (`GetUpdateSSE.php`), hospedado em `api.talishar.net`.
- Guarda os frames da partida no IndexedDB da extensão.
- Remove campos de autenticação conhecidos antes de persistir os dados.
- Detecta o fim da partida e deixa o replay pronto para sincronização.
- Permite baixar ou apagar cada partida pelo popup da extensão.
- Permite importar um ou vários JSONs já salvos pelo popup da extensão.
- Permite solicitar a sincronização de todos os replays pendentes de uma vez.
- Ao abrir `hyperdriver.com.br` ou `beta.hyperdriver.com.br` autenticado, envia automaticamente partidas completas ainda não sincronizadas.
- Mantém a cópia local e o arquivo baixado depois do envio.

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
- Partidas incompletas não são enviadas; falhas de autenticação ou conexão mantêm o replay pendente no navegador.
- O upload usa a sessão já aberta no site e passa a pertencer à conta autenticada na primeira sincronização bem-sucedida.
- Não são solicitadas permissões de histórico, cookies, abas ou acesso genérico a todos os sites.
- Campos conhecidos como `authKey`, `token`, `cookie`, `password` e IDs de sessão são redigidos antes do armazenamento.

## Limitações conhecidas

O Talishar não publica um contrato estável para o formato dos eventos. Por isso, esta primeira versão preserva os frames sanitizados e extrai apenas indicadores genéricos, como turno ativo e final de jogo quando disponíveis. A leitura semântica de cartas, pitch, dano e combat chains será a próxima etapa, baseada em arquivos reais capturados.

## Estrutura do JSON

Cada arquivo contém `schemaVersion`, informações da captura, status, resumo e a sequência integral de frames recebidos. Isso permite evoluir o parser sem perder as partidas já registradas.
