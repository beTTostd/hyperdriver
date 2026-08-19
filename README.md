# Talishar Match Replay

Página local para reproduzir uma partida capturada pela extensão **Talishar Local History**.

## O que está incluído

- A partida enviada, com 275 snapshots, em `public/replays/recorded-match.json`.
- Controles de reprodução, avanço quadro a quadro e salto entre turnos.
- Estado de vida, mão, arsenal, pitch, equipamentos, banish, permanentes e combat chain.
- Leitura dos eventos recentes do log do Talishar.
- Botão para abrir qualquer outro JSON gerado pela extensão.

## Executar localmente

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
```

Abra a URL mostrada no terminal.

## Privacidade

Não há banco de dados, autenticação ou upload de arquivos. Ao abrir outro replay, o JSON é lido somente no navegador. A interface busca apenas as imagens públicas das cartas no CDN do Talishar; o conteúdo da partida não é enviado para esse serviço.
