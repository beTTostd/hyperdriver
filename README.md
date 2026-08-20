# Talishar Match Replay

Página local para reproduzir uma partida capturada pela extensão **Talishar Local History**.

## O que está incluído

- A partida enviada, com 275 snapshots, em `public/replays/recorded-match.json`.
- Controles de reprodução, avanço quadro a quadro e salto entre turnos.
- Estado de vida, mão, arsenal, pitch, equipamentos, banish, permanentes e combat chain.
- Leitura dos eventos recentes do log do Talishar.
- Botão para abrir qualquer outro JSON gerado pela extensão.

## Executar localmente

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

Abra a URL mostrada no terminal.

Para validar e executar o build de produção sem Docker:

```bash
npm run build
npm start
```

O projeto usa o App Router e o servidor Node nativos do Next.js. O build de
produção gera um artefato standalone em `.next/standalone`, sem depender de
Cloudflare Workers, Wrangler, Vite ou Vinext.

## Executar com Docker

Com Docker Compose:

```bash
docker compose up --build
```

Abra [http://localhost:3100](http://localhost:3100). Para executar somente a
imagem diretamente:

```bash
docker build -t hyperdriver .
docker run --rm -p 3100:3100 hyperdriver
```

Para desenvolvimento com hot reload, use a configuração dedicada na porta
3101:

```bash
docker compose -f compose.dev.yaml up --build
```

Abra [http://localhost:3101](http://localhost:3101). As alterações nos arquivos
do projeto serão refletidas automaticamente no container.

## Banco de dados

O projeto usa SQLite local por meio do Drizzle. Os dados persistentes ficam
separados por ambiente:

```text
data/dev/db/       # SQLite do desenvolvimento
data/dev/files/    # uploads do desenvolvimento
data/prod/db/      # SQLite da produção
data/prod/files/   # uploads da produção
```

Nos containers, `DATABASE_FILE=/app/data/hyperdriver.sqlite` é montado na pasta
`db` correspondente e `UPLOADS_DIR=/app/uploads` na pasta `files`. A pasta
`data/` é ignorada pelo Git para não versionar bancos ou arquivos enviados.

O banco ainda não possui tabelas de aplicação: o schema em `db/schema.ts` está
pronto para receber as entidades do projeto. Depois de adicionar tabelas,
gere as migrações com:

```bash
npm run db:generate
```

## Privacidade

Nenhum replay é persistido, autenticado ou enviado ao servidor. Ao abrir outro
replay, o JSON é lido somente no navegador. A interface busca apenas as imagens
públicas das cartas no CDN do Talishar; o conteúdo da partida não é enviado
para esse serviço.
