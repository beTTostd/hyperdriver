# Inspeção visual do frontend

O container `browser` executa Chromium com Playwright e acessa o serviço de
desenvolvimento pelo domínio do beta. Ele funciona sem interface gráfica e não
publica portas. A imagem e o pacote Playwright usam a mesma versão fixa.

Com o frontend de desenvolvimento rodando:

```bash
npm run browser:up
npm run browser:capture
npm run browser:capture -- / --mobile
npm run browser:capture -- /login --name login-desktop
```

Os resultados ficam em `outputs/browser/`, ignorado pelo Git: imagem PNG da
página inteira, HTML renderizado, relatório JSON com erros de console,
JavaScript e rede, e trace ZIP com a navegação. O agente pode abrir o PNG
diretamente para conferir o layout. Capturas com o mesmo nome são substituídas.
Os arquivos podem conter dados privados se a navegação usar uma sessão autenticada.

O cenário `scripts/browser/open-login.mjs` já verifica a navegação da página
inicial até o formulário de login. Para criar outras interações, adicione um
módulo em `scripts/browser/` que exporte uma função assíncrona:

```js
export default async function openLogin({ page }) {
  await page.getByRole("link", { name: "Acessar plataforma", exact: true }).click();
  await page.getByRole("button", { name: "Entrar", exact: true }).waitFor();
}
```

Execute o cenário antes da captura:

```bash
npm run browser:capture -- / --scenario /opt/browser/scripts/open-login.mjs --name login-navigation
```

O cenário recebe `page`, `context` e `browser`, permitindo clicar, preencher
formulários, verificar estados e criar capturas adicionais usando Playwright.
O diretório de scripts é montado como somente leitura; alterações não exigem
rebuild da imagem. As capturas usam contextos novos, sem login persistente.

`replay-mobile.mjs` verifica o tabuleiro em 320, 390, 430 e 844 px, incluindo
sobreposição de zonas, navegação entre frames, telemetria e ampliação por toque.
Importe esse cenário após autenticar e abrir um replay em um contexto com
`isMobile: true` e `hasTouch: true`. Use um frame intermediário com cartas
visíveis (por exemplo, `/table?frame=78` na instância de teste com a partida
de exemplo). As capturas são salvas como `replay-*.png` em `outputs/browser/`.

Também é possível passar uma URL completa como primeiro argumento. O endereço
padrão é `https://beta.hyperdriver.com.br`, permitido em `allowedDevOrigins`.
Usar o domínio evita o bloqueio de recursos do Next.js que pode impedir a
hidratação e o funcionamento de formulários pelo nome interno do container.
Para sobrescrevê-lo temporariamente:

```bash
docker compose -f compose.browser.yaml exec -T -e BROWSER_BASE_URL=http://hyperdriver-dev:3101 browser node /opt/browser/scripts/capture.mjs /
```

A rede existente é `hyperdriver_default`; caso o projeto Docker tenha outro
nome, defina `HYPERDRIVER_NETWORK` ao iniciar o container.

```bash
docker compose -f compose.browser.yaml ps
npm run browser:down
```

Este Compose tem seu próprio projeto (`hyperdriver-browser`), para que os
comandos de inspeção iniciem e parem apenas o navegador.
