import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
let application;
let baseUrl;
let serverOutput = "";
let cookie;
let databaseDirectory;

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

before(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databaseDirectory = mkdtempSync(join(tmpdir(), "hyperdriver-test-"));
  const seed = spawnSync(process.execPath, ["scripts/seed.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_FILE: join(databaseDirectory, "test.sqlite"),
      ADMIN_INITIAL_PASSWORD: "TestPassword!123",
    },
    encoding: "utf8",
  });
  assert.equal(seed.status, 0, seed.stderr || seed.stdout);
  application = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        APP_URL: baseUrl,
        DATABASE_FILE: join(databaseDirectory, "test.sqlite"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  application.stdout.on("data", (chunk) => {
    serverOutput += chunk;
  });
  application.stderr.on("data", (chunk) => {
    serverOutput += chunk;
  });

  await waitForServer(new URL("/login", baseUrl));
  const login = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "TestPassword!123" }),
  });
  assert.equal(login.status, 200);
  cookie = getCookie(login);
  assert.ok(cookie);
});

after(async () => {
  if (!application || application.exitCode !== null) return;
  application.kill("SIGTERM");
  await once(application, "exit");
  if (databaseDirectory) rmSync(databaseDirectory, { recursive: true, force: true });
});

test("renders development preview metadata", async () => {
  const response = await fetch(new URL("/", baseUrl), {
    headers: { accept: "text/html" },
  });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /Acompanhe[\s\S]*seus jogos/);
  assert.doesNotMatch(html, /Flesh and Blood|Talishar/);
});

test("redirects authenticated users from the landing page to their profile", async () => {
  const response = await fetch(new URL("/", baseUrl), {
    headers: { cookie },
    redirect: "manual",
  });
  const legacyResponse = await fetch(new URL("/replays", baseUrl), {
    headers: { cookie },
    redirect: "manual",
  });

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/me");
  assert.equal(legacyResponse.status, 307);
  assert.equal(new URL(legacyResponse.headers.get("location"), baseUrl).pathname, "/me");
});

test("requires authentication and supports one-time user invitations", async () => {
  const anonymous = await fetch(new URL("/admin", baseUrl), { redirect: "manual" });
  assert.equal(anonymous.status, 307);
  assert.match(anonymous.headers.get("location") ?? "", /\/login\?returnTo=%2Fadmin/);

  const created = await fetch(new URL("/api/admin/users", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username: "piloto-01", role: "user" }),
  });
  assert.equal(created.status, 201);
  const invitation = await created.json();
  assert.match(invitation.setupUrl, /\/primeira-senha\?token=/);
  assert.ok(invitation.expiresAt - Date.now() > 2 * 60 * 60 * 1000 - 5000);
  assert.ok(invitation.expiresAt - Date.now() <= 2 * 60 * 60 * 1000);

  const setupPage = await fetch(invitation.setupUrl);
  assert.equal(setupPage.status, 200);
  assert.match(await setupPage.text(), /piloto-01/);

  const setup = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: new URL(invitation.setupUrl).searchParams.get("token"),
      password: "PilotPassword!123",
      confirmation: "PilotPassword!123",
    }),
  });
  assert.equal(setup.status, 200);

  const reused = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: new URL(invitation.setupUrl).searchParams.get("token"),
      password: "PilotPassword!123",
      confirmation: "PilotPassword!123",
    }),
  });
  assert.equal(reused.status, 400);

  const userLogin = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "piloto-01", password: "PilotPassword!123" }),
  });
  assert.equal(userLogin.status, 200);
  const userCookie = getCookie(userLogin);
  assert.ok(userCookie);
  const userAdminPage = await fetch(new URL("/admin", baseUrl), {
    headers: { cookie: userCookie },
    redirect: "manual",
  });
  assert.equal(userAdminPage.status, 307);
  assert.equal(new URL(userAdminPage.headers.get("location"), baseUrl).pathname, "/");
});

test("renders the replay and telemetry routes", async () => {
  const [tableResponse, telemetryResponse] = await Promise.all([
    fetch(new URL("/mesa", baseUrl), { headers: { cookie } }),
    fetch(new URL("/valor", baseUrl), { headers: { cookie } }),
  ]);
  const replayLibraryResponse = await fetch(new URL("/me", baseUrl), {
    headers: { cookie },
  });

  assert.equal(tableResponse.status, 200);
  assert.match(await tableResponse.text(), /Montando a mesa/);
  assert.equal(telemetryResponse.status, 200);
  assert.match(await telemetryResponse.text(), /Valor por/);
  assert.equal(replayLibraryResponse.status, 200);
  const replayLibraryHtml = await replayLibraryResponse.text();
  assert.match(replayLibraryHtml, /Replays recentes/);
  assert.match(replayLibraryHtml, /Abrir menu de admin/);
  assert.doesNotMatch(replayLibraryHtml, /Replay telemetry|Importar replay|Perfil \/ avatar/);
});

test("allows authenticated users to choose a FAB card avatar", async () => {
  const initial = await fetch(new URL("/me", baseUrl), { headers: { cookie } });
  assert.match(await initial.text(), /dash_io\.webp/);

  const updated = await fetch(new URL("/api/profile/avatar", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cardId: "crown_of_providence" }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { ok: true, avatarCardId: "crown_of_providence" });

  const afterUpdate = await fetch(new URL("/me", baseUrl), { headers: { cookie } });
  assert.match(await afterUpdate.text(), /crown_of_providence\.webp/);

  const invalid = await fetch(new URL("/api/profile/avatar", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cardId: "not a card" }),
  });
  assert.equal(invalid.status, 400);
});

test("serves the bundled replay fixture", async () => {
  const response = await fetch(new URL("/replays/recorded-match.json", baseUrl), {
    headers: { cookie },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  const replay = await response.json();
  assert.equal(replay.match.frames.length, 275);
});

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (application.exitCode !== null) {
      throw new Error(`Next.js exited before startup.\n${serverOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server has not opened its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Next.js did not start within 30 seconds.\n${serverOutput}`);
}

function getCookie(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return (values[0] ?? response.headers.get("set-cookie"))?.split(";", 1)[0];
}
