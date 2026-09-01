# Codex Supervisor

Serviço local persistente para trabalhos longos executados pelo Codex App
Server. Ele controla apenas trabalhos iniciados por esta CLI e não altera o
servidor Next.js nem o banco de dados da aplicação Hyperdriver.

## Requisitos

- Node.js 22.13 ou superior;
- Codex CLI disponível como `codex`;
- login do Codex baseado em uma conta ChatGPT. O modo somente API key não
  retorna as cotas pessoais necessárias para preservar a reserva;
- Linux com `systemd --user`.

O protocolo implementado segue a documentação oficial do
[Codex App Server](https://learn.chatgpt.com/docs/app-server): handshake JSONL
por `stdio`, `account/rateLimits/read`, `account/rateLimits/updated`,
`thread/start`, `thread/resume`, `turn/start` e `turn/interrupt`.

## Instalação

Na raiz do repositório:

```bash
npm run supervisor:build
node codex-supervisor/dist/cli.js install-service
```

O segundo comando cria `~/.local/bin/codex-supervisor`, instala a unidade em
`~/.config/systemd/user/codex-supervisor.service` e a habilita imediatamente.
Garanta que `~/.local/bin` esteja no `PATH`. Como a unidade contém o caminho
absoluto deste checkout, execute novamente `install-service` se mover o
repositório.

Serviços de usuário normalmente iniciam quando a sessão do usuário começa. Para
retomar ainda durante o boot, antes do login, habilite o *linger* uma vez:

```bash
loginctl enable-linger "$USER"
```

Essa configuração é deliberadamente manual porque muda a política de sessão do
usuário.

## Comandos

```bash
codex-supervisor start --cwd /caminho/do/projeto --goal "objetivo completo"
codex-supervisor status
codex-supervisor pause
codex-supervisor resume
codex-supervisor cancel
codex-supervisor logs
codex-supervisor logs --follow
```

É possível retomar uma thread conhecida com `--thread-id <id>` no comando
`start`. Sem um ID acessível, o supervisor não tenta anexar chats arbitrários.

Somente um trabalho não finalizado pode existir por vez. `pause` interrompe o
turno atual e mantém o trabalho em `waiting`; `resume` também libera trabalhos
em `needs_attention`; `cancel` é terminal.

## Cotas e retomada

Antes de cada turno, o supervisor lê todas as janelas retornadas pelo App Server.
As janelas de 300 minutos e 10.080 minutos são identificadas como cinco horas e
semanal. Se qualquer janela estiver com `usedPercent >= 90`, o turno não começa.
Durante o turno, a mesma condição em `account/rateLimits/updated` dispara
`turn/interrupt` uma única vez.

O próximo teste ocorre no maior `resetsAt` bloqueado, mais 30 segundos. Sem
horário de reset, o backoff é 15 minutos, 30 minutos, 1 hora, 2 horas e 6 horas.
Cada tentativa relê as cotas; portanto, um reset alterado pelo servidor substitui
o agendamento anterior.

O supervisor nunca chama `account/rateLimitResetCredit/consume`, nunca compra
créditos e nunca envia solicitações de compra ou cobrança.

## Checkpoints e contexto

Após cada item concluído e ao encerrar ou interromper um turno, é salvo um
checkpoint com objetivo, resumo, decisões, arquivos alterados, `git diff`, commit
atual, testes e próxima ação. O estado fica, por padrão, em:

```text
~/.local/state/codex-supervisor/supervisor.sqlite
```

Defina `CODEX_SUPERVISOR_STATE_DIR` para usar outro diretório. O banco usa WAL,
lease por trabalho e uma restrição de unicidade para impedir duas retomadas
simultâneas.

Quando `thread/tokenUsage/updated` indica 75% da janela de contexto, o turno é
interrompido, um checkpoint compacto é criado e uma thread nova é aberta com
referência à anterior. A linhagem completa permanece na tabela `thread_history`.

Solicitações interativas de aprovação são recusadas em modo não assistido e o
trabalho passa para `needs_attention`. O mesmo ocorre com autenticação expirada,
resultado final inválido ou conflitos Git não resolvidos. Depois de corrigir o
problema, use `codex-supervisor resume`.

## Desenvolvimento e validação

```bash
npm run supervisor:build
node --test tests/codex-supervisor.test.mjs
npm run lint
npm test
```

Os testes simulam as duas janelas de cota, cruzamento do limite durante o turno,
mudanças de reset, backoff, retomada após reinício, exclusão mútua, contexto em
75%, autenticação expirada e conflito Git.
