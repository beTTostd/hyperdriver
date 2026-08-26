# Talishar Match Replay

Página local para reproduzir uma partida capturada pela extensão **Talishar Local History**.

## O que está incluído

- A partida enviada, com 275 snapshots, em `public/replays/recorded-match.json`.
- Controles de reprodução, avanço quadro a quadro e salto entre turnos.
- Estado de vida, mão, arsenal, pitch, equipamentos, banish, permanentes e combat chain.
- Persistência somente dos dados necessários para reconstruir a mesa, sem o log de chat.
- Captura sanitizada das escolhas e alternativas apresentadas pelo Talishar.
- Treinador pós-partida que separa potencial da mão, qualidade da execução e sinais recorrentes de deck.
- Marcadores de boa decisão, oportunidade e erro de alto impacto, sempre descritos como a “melhor linha encontrada”.
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
ADMIN_INITIAL_PASSWORD='Troque-esta-senha!123' docker compose up --build
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

## Banco de dados e acesso

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

As tabelas de usuários, sessões e convites ficam no SQLite. Em desenvolvimento,
`npm run dev` aplica a migration automaticamente antes de iniciar o servidor.
Para aplicar manualmente:

```bash
npm run db:migrate
npm run dev
```

O primeiro administrador é criado explicitamente. Use uma senha forte fora do
repositório:

```bash
APP_URL=http://localhost:3000 \\
DATABASE_FILE=data/dev/db/hyperdriver.sqlite \\
ADMIN_INITIAL_PASSWORD='Troque-esta-senha!123' \\
npm run db:seed
```

O seed cria o usuário `admin` apenas se ele ainda não existir. A senha deve ter
no mínimo 12 caracteres, incluindo maiúscula, minúscula, número e símbolo.
Administradores criam os demais usuários em `/admin`; o link de primeira senha
é de uso único e expira em duas horas. Sessões permanecem válidas por 30 dias.

Em produção, o container aplica a migration e garante a existência do usuário
`admin` ao iniciar. No primeiro start, configure `APP_URL` com a URL pública do
serviço e defina `ADMIN_INITIAL_PASSWORD`. Depois que o administrador existir,
essa variável deixa de ser obrigatória e não altera a senha já cadastrada.

## Replays e privacidade

A extensão mantém cada replay no navegador, permite baixar o JSON pelo popup e
sincroniza partidas completas quando o usuário abre o Hyperdriver autenticado.
Beta e produção têm estados de sincronização independentes: enviar uma partida
para um ambiente não impede o envio posterior para o outro. Atualizar uma mesma
URL `/game/play/<id>` concluída também reutiliza a captura local, sem duplicá-la.
Os arquivos enviados ficam em `UPLOADS_DIR`; o SQLite guarda somente metadados e
o vínculo com o proprietário. A biblioteca `/replays`, a análise em
`/replays/<id>` e a mesa em `/replays/<id>/table` filtram sempre pela conta
autenticada. `/me`, `/table/<id>` e `/telemetry/<id>` permanecem como aliases
de compatibilidade. Os replays não são enviados ao CDN do Talishar; a interface
busca nesse CDN apenas as imagens públicas das cartas.

## Treinador pós-partida

Novos uploads recebem uma análise assíncrona sem bloquear a gravação ou a abertura do replay. O avaliador otimiza uma estimativa de probabilidade de vitória; dano, vida, cartas, pitch, arsenal, action points e equipamento são apenas a decomposição explicativa. O valor de telemetria exibido na mesa não é usado como objetivo.

As observações de decisão, análises e versões do avaliador ficam em tabelas separadas do replay, portanto podem ser recalculadas. O treinador, os marcadores e as APIs de análise ficam disponíveis somente para administradores. Exemplos coletivos são pseudonimizados e não incluem username, URL, identificador da partida ou link do deck; desative sua criação com `COLLECTIVE_ANALYSIS_ENABLED=false`.

Replays históricos não são retroalimentados automaticamente. O backfill para aprendizado coletivo depende de avaliação documentada da base legal e de aviso compatível. Consulte a política pública antes de ativar o recurso em produção.
