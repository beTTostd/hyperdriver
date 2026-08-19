# Talishar Local History

Extensão Chrome local-first para registrar partidas do Talishar. Ela não usa conta, servidor, Firebase ou qualquer sincronização externa.

## O que esta versão faz

- Observa exclusivamente o stream de atualizações do Talishar (`GetUpdateSSE.php`), hospedado em `api.talishar.net`.
- Guarda os frames da partida no IndexedDB da extensão.
- Remove campos de autenticação conhecidos antes de persistir os dados.
- Tenta detectar o fim da partida e baixa automaticamente um JSON.
- Permite baixar ou apagar cada partida pelo popup da extensão.

## Como instalar no Chrome

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione esta pasta: `talishar-local-history`.
5. Abra uma partida em `https://talishar.net`.
6. Clique no ícone da extensão para acompanhar e baixar o JSON.

Os arquivos exportados ficam em `Downloads/Talishar Local History/`.

## Privacidade

- A extensão limita seu acesso ao domínio `talishar.net`.
- Nenhum dado é enviado para servidores externos.
- Não são solicitadas permissões de histórico, cookies, abas ou acesso a todos os sites.
- Campos conhecidos como `authKey`, `token`, `cookie`, `password` e IDs de sessão são redigidos antes do armazenamento.

## Limitações conhecidas do MVP

O Talishar não publica um contrato estável para o formato dos eventos. Por isso, esta primeira versão preserva os frames sanitizados e extrai apenas indicadores genéricos, como turno ativo e final de jogo quando disponíveis. A leitura semântica de cartas, pitch, dano e combat chains será a próxima etapa, baseada em arquivos reais capturados.

## Estrutura do JSON

Cada arquivo contém `schemaVersion`, informações da captura, status, resumo e a sequência integral de frames recebidos. Isso permite evoluir o parser sem perder as partidas já registradas.
