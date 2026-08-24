# Arquitetura do Hyperdriver

## Visão geral

O Hyperdriver é um monólito modular Next.js, operado em uma única instância com SQLite e um volume local para replays. Essa é uma restrição de implantação deliberada: as transações do banco e as movimentações atômicas no mesmo filesystem fazem parte das garantias de consistência. A aplicação não deve ser escalada horizontalmente enquanto o storage local continuar sendo a implementação ativa.

Os módulos de produto são:

- `auth`: credenciais, convites de primeira senha, sessões, autorização e rate limits;
- `accounts`: administração de contas e perfil;
- `replays`: ingestão, validação, metadados, autorização por proprietário e storage;
- `analytics`: telemetria e estatísticas derivadas das métricas persistidas;
- `catalog`: consulta limitada ao catálogo externo de cartas.

Eles usam a infraestrutura compartilhada em `db/` e `lib/`: configuração, SQLite, HTTP seguro, logs, limites e `ReplayStorage`. Routes e páginas devem seguir o fluxo `HTTP → autorização/validação → serviço → repositório/storage` e não tomar decisões de proprietário com base em valores enviados pelo cliente.

## Limites de confiança

O navegador, a extensão, headers encaminhados pelo proxy e todo replay recebido são entradas não confiáveis. APIs autenticadas resolvem a sessão no servidor; o Proxy existe apenas para melhorar a navegação e nunca é a única barreira de acesso. Replays são localizados por ID somente depois de aplicar o proprietário, exceto para administradores.

Mutações validam `Origin` contra `APP_URL`. Clientes não navegadores sem `Origin` continuam compatíveis, mas requisições de navegador marcadas como cross-site são recusadas. Em produção, `APP_URL` aceita apenas HTTPS (com exceção explícita de loopback para testes locais) e cookies são sempre `Secure`, `HttpOnly`, `SameSite=Lax` e restritos a `/`.

O Proxy cria um nonce por requisição e aplica CSP, bloqueio de frames e objetos, `nosniff`, HSTS, Permissions Policy e Referrer Policy. Páginas e respostas privadas usam `no-store`. Convites usam fragmentos `#token=`, que não são enviados ao servidor, logs ou referrers; o cliente remove o fragmento antes de enviar o token no corpo HTTPS.

Logs HTTP são JSON e contêm request ID, rota, método, status, duração e ID interno do usuário quando conhecido. Senhas, cookies, tokens e conteúdo de replay não podem ser registrados.

## Dados e migrations

As entidades principais são `users`, `sessions`, `password_setup_tokens`, `replays` e `replay_metrics`. `rate_limit_events` persiste janelas de tentativas e `upload_leases` limita processamentos concorrentes. Foreign keys usam cascade somente onde o ciclo de vida pertence integralmente ao usuário/replay.

Toda conexão ativa `foreign_keys=ON`, WAL, `busy_timeout=5000` e `synchronous=NORMAL`. `scripts/migration-runner.mjs` aplica migrations numeradas em transações e registra checksum em `schema_migrations`. Na primeira adoção por uma instalação antiga, somente as migrations `0000–0004` podem ser reconhecidas por inspeção do schema; depois do registro, qualquer alteração em SQL já aplicado interrompe o deploy.

`scripts/backfill-replays.mjs` é idempotente. Ele seleciona somente registros sem tamanho, modo ou métricas, lê cada arquivo selecionado uma vez e preenche metadados e totais. Listagens e estatísticas normais consultam apenas SQLite.

## Ingestão e storage

`POST /api/replays` mantém o protocolo da extensão. O corpo é lido como stream e interrompido após `50 MiB + 1 byte`, mesmo sem `Content-Length`. Antes de gravar, são validados JSON, profundidade, frames, listas, strings, timestamps, conclusão e limites numéricos relevantes.

A quota padrão é 1 GiB e 500 replays por usuário, configurável por `REPLAY_QUOTA_BYTES` e `REPLAY_QUOTA_COUNT`. O rate limit é 100 uploads por hora e existem no máximo dois leases simultâneos por usuário. A implementação local de `ReplayStorage` grava em arquivo temporário, sincroniza e renomeia atomicamente; somente então o banco confirma metadados e métricas. Em exclusões, arquivos são movidos para quarentena antes da transação, restaurados se ela falhar e removidos depois do commit.

`ReplayStorage` é a fronteira para uma futura implementação S3. Uma troca de backend não deve alterar regras de autorização, quotas, parsing ou domínio.

## Extensão

A extensão captura atualizações apenas dos endpoints Talishar permitidos, compacta e redige os campos definidos em `replay-state.js`, retém o histórico localmente e sincroniza pelo content script executado na origem do Hyperdriver. Beta e produção têm estados de sincronização separados. O contrato aceita IDs UUID/números e as rotas legadas permanecem como redirects.

O ZIP publicado deve corresponder byte a byte a `talishar-local-history/`, ter entradas ordenadas e timestamps normalizados. `npm run verify:extension` é o gate determinístico usado pela CI.

## Operação, backup e restauração

Antes de migrations ou backfill:

1. interrompa a instância para obter um snapshot consistente;
2. copie o arquivo SQLite e os arquivos `-wal`/`-shm` quando existirem, ou use a API de backup do SQLite;
3. copie o diretório de uploads preservando nomes e permissões;
4. registre o hash e a versão do artefato implantado.

Para restaurar, mantenha a aplicação parada, restaure banco e uploads do mesmo snapshot, confira a propriedade do usuário do container e execute `npm run db:migrate` e `npm run db:backfill`. Inicie a instância e confirme `/api/health/ready`, login, biblioteca, leitura de replay e sincronização da extensão.

O rollout deve usar primeiro o beta: backup, migration, backfill, readiness, headers, login e sincronização. O mesmo artefato validado é então promovido para produção. Migrations nesta etapa são aditivas, permitindo rollback do código; rollback de dados exige o snapshot.

## Evolução

PostgreSQL, Redis, microserviços e object storage não são necessários para a carga atual. Sinais para reavaliar são múltiplas instâncias obrigatórias, contenção persistente mesmo com WAL, uploads fora de um único volume ou necessidade de processamento assíncrono independente. As interfaces de storage e os limites de serviço existem para permitir essa evolução sem reescrever as regras de domínio.
