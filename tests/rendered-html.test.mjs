import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import {
  indicators,
  isCompleteMatch,
  isFinished,
  normalizeCompletion,
} from "../talishar-local-history/replay-state.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
let application;
let baseUrl;
let serverOutput = "";
let cookie;
let databaseDirectory;
let catalogServer;
let catalogRequests = [];

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

before(async () => {
  catalogServer = createHttpServer((request, response) => {
    const url = new URL(request.url, "http://catalog.test");
    const name = url.searchParams.get("name") || "";
    catalogRequests.push(url);

    if (name === "failure") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unavailable" }));
      return;
    }

    const cards = name === "many"
      ? Array.from({ length: 100 }, (_, index) => ({
          name: `Card ${String(index).padStart(3, "0")}`,
          color: "blue",
        }))
      : [
          { name: "Zulu", color: "blue" },
          { name: "Éclair & Élan+ / O'Clock", color: "blue" },
          { name: "Alpha", color: "yellow" },
          { name: "Éclair & Élan+ / O'Clock", color: "red" },
          { name: "Alpha", color: "red" },
          { name: "Alpha", color: "blue" },
          { name: "Zulu", color: "blue" },
        ];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      data: cards,
      meta: { total: name === "many" ? 125 : cards.length },
    }));
  });
  catalogServer.listen(0, "127.0.0.1");
  await once(catalogServer, "listening");
  const catalogAddress = catalogServer.address();
  assert.notEqual(catalogAddress, null);
  assert.equal(typeof catalogAddress, "object");

  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databaseDirectory = mkdtempSync(join(tmpdir(), "hyperdriver-test-"));
  const seed = spawnSync(process.execPath, ["scripts/seed.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_FILE: join(databaseDirectory, "test.sqlite"),
      UPLOADS_DIR: join(databaseDirectory, "uploads"),
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
        UPLOADS_DIR: join(databaseDirectory, "uploads"),
        CARD_CATALOG_API_URL: `http://127.0.0.1:${catalogAddress.port}/cards`,
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
  if (application && application.exitCode === null) {
    application.kill("SIGTERM");
    await once(application, "exit");
  }
  if (catalogServer) {
    catalogServer.close();
    await once(catalogServer, "close");
  }
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
    body: JSON.stringify({ username: "jogador-01", role: "user" }),
  });
  assert.equal(created.status, 201);
  const invitation = await created.json();
  assert.equal(typeof invitation.id, "number");
  assert.match(invitation.setupUrl, /\/set-password\?token=/);
  assert.ok(invitation.expiresAt - Date.now() > 2 * 60 * 60 * 1000 - 5000);
  assert.ok(invitation.expiresAt - Date.now() <= 2 * 60 * 60 * 1000);

  const setupPage = await fetch(invitation.setupUrl);
  assert.equal(setupPage.status, 200);
  assert.match(await setupPage.text(), /jogador-01/);

  const regenerated = await fetch(
    new URL(`/api/admin/users/${invitation.id}/password-link`, baseUrl),
    { method: "POST", headers: { cookie } },
  );
  assert.equal(regenerated.status, 200);
  const regeneratedInvitation = await regenerated.json();
  assert.match(regeneratedInvitation.setupUrl, /\/set-password\?token=/);
  assert.notEqual(regeneratedInvitation.setupUrl, invitation.setupUrl);

  const staleSetup = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: new URL(invitation.setupUrl).searchParams.get("token"),
      password: "PlayerPassword!123",
      confirmation: "PlayerPassword!123",
    }),
  });
  assert.equal(staleSetup.status, 400);

  const setup = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: new URL(regeneratedInvitation.setupUrl).searchParams.get("token"),
      password: "PlayerPassword!123",
      confirmation: "PlayerPassword!123",
    }),
  });
  assert.equal(setup.status, 200);

  const reused = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: new URL(regeneratedInvitation.setupUrl).searchParams.get("token"),
      password: "PlayerPassword!123",
      confirmation: "PlayerPassword!123",
    }),
  });
  assert.equal(reused.status, 400);

  const userLogin = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "jogador-01", password: "PlayerPassword!123" }),
  });
  assert.equal(userLogin.status, 200);
  const userCookie = getCookie(userLogin);
  assert.ok(userCookie);
  const successfulLastLogin = readLastLogin("jogador-01");
  assert.equal(typeof successfulLastLogin, "number");

  const invalidLogin = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "jogador-01", password: "InvalidPassword!123" }),
  });
  assert.equal(invalidLogin.status, 401);
  assert.equal(readLastLogin("jogador-01"), successfulLastLogin);
  const userAdminPage = await fetch(new URL("/admin", baseUrl), {
    headers: { cookie: userCookie },
    redirect: "manual",
  });
  assert.equal(userAdminPage.status, 307);
  assert.equal(new URL(userAdminPage.headers.get("location"), baseUrl).pathname, "/");
  const userProfilePage = await fetch(new URL("/me", baseUrl), {
    headers: { cookie: userCookie },
  });
  assert.equal(userProfilePage.status, 200);
  assert.doesNotMatch(await userProfilePage.text(), />Administração<\/a>/);

  const forbiddenLink = await fetch(
    new URL(`/api/admin/users/${invitation.id}/password-link`, baseUrl),
    { method: "POST", headers: { cookie: userCookie } },
  );
  assert.equal(forbiddenLink.status, 403);
  const forbiddenDelete = await fetch(
    new URL(`/api/admin/users/${invitation.id}`, baseUrl),
    { method: "DELETE", headers: { cookie: userCookie } },
  );
  assert.equal(forbiddenDelete.status, 403);

  const resetLinkResponse = await fetch(
    new URL(`/api/admin/users/${invitation.id}/password-link`, baseUrl),
    { method: "POST", headers: { cookie } },
  );
  assert.equal(resetLinkResponse.status, 200);
  const resetInvitation = await resetLinkResponse.json();
  const resetPassword = "NewPlayerPassword!123";
  const reset = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: new URL(resetInvitation.setupUrl).searchParams.get("token"),
      password: resetPassword,
      confirmation: resetPassword,
    }),
  });
  assert.equal(reset.status, 200);
  const expiredSession = await fetch(new URL("/me", baseUrl), {
    headers: { cookie: userCookie },
    redirect: "manual",
  });
  assert.equal(expiredSession.status, 307);
  assert.match(expiredSession.headers.get("location") ?? "", /\/login/);
  const oldPasswordLogin = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "jogador-01", password: "PlayerPassword!123" }),
  });
  assert.equal(oldPasswordLogin.status, 401);
  const resetLogin = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "jogador-01", password: resetPassword }),
  });
  assert.equal(resetLogin.status, 200);

  const selfDelete = await fetch(new URL("/api/admin/users/1", baseUrl), {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(selfDelete.status, 400);

  const adminPage = await fetch(new URL("/admin", baseUrl), { headers: { cookie } });
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Gerar link de senha/);
  assert.match(adminHtml, />Apagar<\/button>/);
  assert.match(adminHtml, /Último login:/);

  const deleted = await fetch(new URL(`/api/admin/users/${invitation.id}`, baseUrl), {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(deleted.status, 200);
  const deletedLogin = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "jogador-01", password: resetPassword }),
  });
  assert.equal(deletedLogin.status, 401);
});

test("renders the replay route and removes the legacy telemetry route", async () => {
  const [tableResponse, legacyTelemetryResponse, invalidTelemetryResponse] = await Promise.all([
    fetch(new URL("/table", baseUrl), { headers: { cookie } }),
    fetch(new URL("/valor", baseUrl), { headers: { cookie } }),
    fetch(new URL("/telemetry/not-a-replay", baseUrl), { headers: { cookie } }),
  ]);
  const replayLibraryResponse = await fetch(new URL("/me", baseUrl), {
    headers: { cookie },
  });
  const editProfileResponse = await fetch(new URL("/me/profile", baseUrl), {
    headers: { cookie },
  });

  assert.equal(tableResponse.status, 200);
  assert.match(await tableResponse.text(), /Montando a mesa/);
  assert.equal(legacyTelemetryResponse.status, 404);
  assert.equal(invalidTelemetryResponse.status, 404);
  assert.equal(replayLibraryResponse.status, 200);
  const replayLibraryHtml = await replayLibraryResponse.text();
  assert.match(replayLibraryHtml, /Replays recentes/);
  assert.match(replayLibraryHtml, /Abrir menu de admin/);
  assert.match(replayLibraryHtml, /href="\/admin"[^>]*>Administração/);
  assert.match(replayLibraryHtml, /href="\/downloads\/hyperdriver-extension\.zip"/);
  assert.match(replayLibraryHtml, /download="hyperdriver-extension\.zip"/);
  assert.doesNotMatch(replayLibraryHtml, /Replay telemetry|Importar replay|Perfil \/ avatar/);
  assert.equal(editProfileResponse.status, 200);
  const editProfileHtml = await editProfileResponse.text();
  assert.match(editProfileHtml, /Seu perfil/);
  assert.match(editProfileHtml, /Nome de usuário/);
  assert.match(editProfileHtml, /Alterar foto/);
  assert.doesNotMatch(editProfileHtml, /Replays/);
});

test("allows authenticated users to choose a FAB card avatar", async () => {
  const initial = await fetch(new URL("/me", baseUrl), { headers: { cookie } });
  const initialHtml = await initial.text();
  assert.match(initialHtml, /dash_io_cropped\.webp/);

  const updated = await fetch(new URL("/api/profile/avatar", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cardId: "crown_of_providence" }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { ok: true, avatarCardId: "crown_of_providence" });

  const afterUpdate = await fetch(new URL("/me", baseUrl), { headers: { cookie } });
  assert.match(await afterUpdate.text(), /crown_of_providence_cropped\.webp/);

  const invalid = await fetch(new URL("/api/profile/avatar", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cardId: "not a card" }),
  });
  assert.equal(invalid.status, 400);

  const catalogCardId = "eclair_and_elan_plus_oclock_red";
  const catalogUpdate = await fetch(new URL("/api/profile/avatar", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cardId: catalogCardId }),
  });
  assert.equal(catalogUpdate.status, 200);
  assert.deepEqual(await catalogUpdate.json(), { ok: true, avatarCardId: catalogCardId });
  const afterCatalogUpdate = await fetch(new URL("/me", baseUrl), { headers: { cookie } });
  assert.match(await afterCatalogUpdate.text(), /eclair_and_elan_plus_oclock_red_cropped\.webp/);
});

test("validates and authenticates avatar catalog searches", async () => {
  const initialRequestCount = catalogRequests.length;
  const anonymous = await fetch(new URL("/api/profile/avatar-options?name=alpha", baseUrl));
  assert.equal(anonymous.status, 401);

  const tooShort = await fetch(new URL("/api/profile/avatar-options?name=a", baseUrl), {
    headers: { cookie },
  });
  assert.equal(tooShort.status, 400);

  const tooLong = await fetch(new URL(`/api/profile/avatar-options?name=${"a".repeat(81)}`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(tooLong.status, 400);
  assert.equal(catalogRequests.length, initialRequestCount);
});

test("normalizes, groups, sorts and caches avatar catalog results", async () => {
  const searchUrl = new URL("/api/profile/avatar-options?name=normalization", baseUrl);
  const response = await fetch(searchUrl, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    options: [
      { id: "alpha_red", label: "Alpha" },
      { id: "eclair_and_elan_plus_oclock_red", label: "Éclair & Élan+ / O'Clock" },
      { id: "zulu_blue", label: "Zulu" },
    ],
    hasMore: false,
  });

  const repeated = await fetch(searchUrl, { headers: { cookie } });
  assert.equal(repeated.status, 200);
  assert.equal(catalogRequests.filter((url) => url.searchParams.get("name") === "normalization").length, 1);
});

test("reports truncated and unavailable avatar catalog searches", async () => {
  const many = await fetch(new URL("/api/profile/avatar-options?name=many", baseUrl), {
    headers: { cookie },
  });
  assert.equal(many.status, 200);
  const manyPayload = await many.json();
  assert.deepEqual(Object.keys(manyPayload).sort(), ["hasMore", "options"]);
  assert.equal(manyPayload.options.length, 100);
  assert.equal(manyPayload.hasMore, true);

  const failure = await fetch(new URL("/api/profile/avatar-options?name=failure", baseUrl), {
    headers: { cookie },
  });
  assert.equal(failure.status, 502);
});

test("keeps the avatar picker responsive across catalog states", () => {
  const source = readFileSync(join(projectRoot, "app/perfil/editar/profile-editor.tsx"), "utf8");
  assert.match(source, /SEARCH_DELAY_MS = 300/);
  assert.match(source, /SEARCH_CACHE_LIMIT = 20/);
  assert.match(source, /RESULTS_PER_PAGE = 24/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /Tentar novamente/);
  assert.match(source, /Nenhuma arte encontrada/);
  assert.match(source, /Digite mais letras para refinar a busca/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /decoding="async"/);
  assert.match(source, /onError=/);
  assert.doesNotMatch(source, /setCards\(\[\]\)/);
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

test("recognizes Talishar completion indicators in legacy captures", () => {
  const indicator = indicators({
    turnNo: "7",
    turnPlayer: "2",
    turnPhase: { turnPhase: "OVER" },
  });
  assert.equal(indicator.turn, "7");
  assert.equal(indicator.phase, "OVER");
  assert.equal(isFinished({ phase: "over" }), true);
  assert.equal(isFinished({ gameOver: "1" }), true);

  const incomplete = {
    status: "recording",
    updatedAt: "2026-08-20T10:00:00.000Z",
    summary: {},
    frames: [{ receivedAt: "2026-08-20T10:00:00.000Z", payload: { turnPhase: { turnPhase: "A" } } }],
  };
  assert.equal(isCompleteMatch(incomplete), false);
  const complete = structuredClone(incomplete);
  complete.frames.push({ receivedAt: "2026-08-20T10:01:00.000Z", payload: { turnPhase: { turnPhase: "OVER" } } });
  assert.equal(isCompleteMatch(complete), true);
  normalizeCompletion(complete);
  assert.equal(complete.status, "finished");
  assert.equal(complete.endedAt, "2026-08-20T10:01:00.000Z");
});

test("stores complete replays idempotently and isolates them by user", async () => {
  const anonymous = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(anonymous.status, 401);

  const incomplete = replayDocument("8dbf5f5f-4f18-4b23-9a3b-8e2f6bfda614", false);
  const incompleteResponse = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(incomplete),
  });
  assert.equal(incompleteResponse.status, 422);

  const document = replayDocument("4f37f7bb-2747-4f0c-8a7e-1ec3dcae6a01", true);
  const created = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(document),
  });
  assert.equal(created.status, 201);
  const uploaded = await created.json();
  assert.equal(uploaded.duplicate, false);
  assert.equal(uploaded.username, "admin");
  assert.match(uploaded.replayId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  const duplicate = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(document),
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).replayId, uploaded.replayId);

  const adminLibrary = await fetch(new URL("/me", baseUrl), { headers: { cookie } });
  const adminHtml = await adminLibrary.text();
  assert.match(adminHtml, /Alpha Hero/);
  assert.match(adminHtml, /alpha_hero_cropped\.webp/);
  assert.match(adminHtml, /beta_hero_cropped\.webp/);
  assert.match(adminHtml, /Modo de jogo/);
  assert.match(adminHtml, /Classic Constructed/);
  assert.doesNotMatch(adminHtml, /Snapshots|Origem/);
  assert.match(adminHtml, new RegExp(`/table/${uploaded.replayId}`));
  assert.doesNotMatch(adminHtml, /\/table\?replay=/);
  assert.match(adminHtml, new RegExp(`/telemetry/${uploaded.replayId}`));
  assert.match(adminHtml, />Análise <svg/);
  assert.doesNotMatch(adminHtml, /Análise da partida/);
  assert.doesNotMatch(adminHtml, /Ver telemetria/);

  const replayTable = await fetch(new URL(`/table/${uploaded.replayId}`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(replayTable.status, 200);
  assert.match(await replayTable.text(), /Montando a mesa/);

  const stored = await fetch(new URL(`/api/replays/${uploaded.replayId}`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(stored.status, 200);
  const storedDocument = await stored.json();
  assert.equal(storedDocument.match.id, "4f37f7bb-2747-4f0c-8a7e-1ec3dcae6a01");
  assert.equal(storedDocument.match.frames[0].payload.chatLog, undefined);
  const telemetry = await fetch(new URL(`/telemetry/${uploaded.replayId}`, baseUrl), {
    headers: { cookie },
  });
  const telemetryHtml = await telemetry.text();
  assert.equal(telemetry.status, 200);
  assert.match(telemetryHtml, /Análise da/);
  assert.match(telemetryHtml, /Dano recebido/);
  assert.match(telemetryHtml, /Bloqueado por equipamento/);
  assert.match(telemetryHtml, /Bloqueado por carta/);
  assert.match(telemetryHtml, /Dano oferecido/);
  assert.match(telemetryHtml, />Você</);
  assert.match(telemetryHtml, /Alpha Hero/);
  assert.match(telemetryHtml, /Beta Hero/);
  assert.match(telemetryHtml, /Classic Constructed/);
  assert.match(telemetryHtml, /Você(?:<!-- -->)? começou/);
  assert.match(telemetryHtml, /Vitória/);
  assert.match(telemetryHtml, /data-tooltip="Dano oferecido: 7"/);
  assert.doesNotMatch(telemetryHtml, /Início parcial|Fim parcial/);

  const telemetryDocument = telemetryReplayDocument("6684ca31-240a-44df-ae6f-5185878bcbf2");
  const telemetryUpload = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(telemetryDocument),
  });
  assert.equal(telemetryUpload.status, 201);
  const telemetryReplay = await telemetryUpload.json();
  const detailedTelemetry = await fetch(
    new URL(`/telemetry/${telemetryReplay.replayId}`, baseUrl),
    { headers: { cookie } },
  );
  assert.equal(detailedTelemetry.status, 200);
  const detailedTelemetryHtml = await detailedTelemetry.text();
  assert.match(detailedTelemetryHtml, /data-tooltip="Dano recebido: 5"/);
  assert.match(detailedTelemetryHtml, /data-tooltip="Bloqueado por equipamento: 5"/);
  assert.match(detailedTelemetryHtml, /data-tooltip="Bloqueado por carta: 3"/);
  assert.match(detailedTelemetryHtml, /data-tooltip="Dano oferecido: 6"/);
  assert.doesNotMatch(detailedTelemetryHtml, /Início parcial|Fim parcial/);

  const rollbackDocument = rollbackTelemetryReplayDocument("7b2f1374-6c58-4f50-b070-2d69906825dd");
  const rollbackUpload = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(rollbackDocument),
  });
  assert.equal(rollbackUpload.status, 201);
  const rollbackReplay = await rollbackUpload.json();
  const rollbackTelemetry = await fetch(
    new URL(`/telemetry/${rollbackReplay.replayId}`, baseUrl),
    { headers: { cookie } },
  );
  assert.equal(rollbackTelemetry.status, 200);
  const rollbackTelemetryHtml = await rollbackTelemetry.text();
  assert.match(rollbackTelemetryHtml, /T(?:<!-- -->)?2/);
  assert.match(rollbackTelemetryHtml, /data-tooltip="Dano recebido: 11"/);
  assert.match(rollbackTelemetryHtml, /data-tooltip="Bloqueado por equipamento: 2"/);
  assert.match(rollbackTelemetryHtml, /data-tooltip="Dano oferecido: 7"/);
  assert.doesNotMatch(rollbackTelemetryHtml, /data-tooltip="Dano recebido: 33"/);
  assert.doesNotMatch(rollbackTelemetryHtml, /data-tooltip="Bloqueado por equipamento: 6"/);

  const anonymousTelemetry = await fetch(
    new URL(`/telemetry/${telemetryReplay.replayId}`, baseUrl),
    { redirect: "manual" },
  );
  assert.equal(anonymousTelemetry.status, 307);
  assert.match(anonymousTelemetry.headers.get("location") ?? "", /\/login\?returnTo=/);

  const isolatedCookie = await createTestUser("isolated-user");
  const isolatedLibrary = await fetch(new URL("/me", baseUrl), {
    headers: { cookie: isolatedCookie },
  });
  assert.doesNotMatch(await isolatedLibrary.text(), /Alpha Hero/);
  const privateReplay = await fetch(new URL(`/api/replays/${uploaded.replayId}`, baseUrl), {
    headers: { cookie: isolatedCookie },
  });
  assert.equal(privateReplay.status, 404);
  const privateTelemetry = await fetch(new URL(`/telemetry/${uploaded.replayId}`, baseUrl), {
    headers: { cookie: isolatedCookie },
  });
  assert.equal(privateTelemetry.status, 404);
});

function replayDocument(id, complete) {
  return {
    schemaVersion: "0.1.0",
    exportedAt: "2026-08-20T12:01:00.000Z",
    match: {
      id,
      schemaVersion: "0.1.0",
      status: complete ? "finished" : "recording",
      startedAt: "2026-08-20T12:00:00.000Z",
      endedAt: complete ? "2026-08-20T12:01:00.000Z" : null,
      frames: [{
        sequence: 1,
        receivedAt: "2026-08-20T12:01:00.000Z",
        payload: {
          chatLog: "não persistir",
          initialLoad: { gameFormat: "cc" },
          turnNo: "3",
          turnPlayer: "1",
          turnPhase: { turnPhase: complete ? "OVER" : "A" },
          playerHealth: "5",
          opponentHealth: "0",
          playerEquipment: [{ slot: "Hero", cardNumber: "alpha_hero" }],
          opponentEquipment: [{ slot: "Hero", cardNumber: "beta_hero" }],
          activeChainLink: {
            attackingCard: { cardNumber: "final_attack_red" },
            totalPower: 7,
            totalDefense: 3,
          },
        },
      }],
    },
  };
}

function telemetryReplayDocument(id) {
  const equipment = [
    { slot: "Hero", cardNumber: "alpha_hero", controller: "1" },
    { slot: "Head", cardNumber: "test_helmet", controller: "1" },
  ];
  const frame = (sequence, turnNo, turnPlayer, activeChainLink, turnPhase = "A", playerHealth = "20") => ({
    sequence,
    receivedAt: `2026-08-20T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      turnNo: String(turnNo),
      turnPlayer: String(turnPlayer),
      turnPhase: { turnPhase },
      playerHealth: turnPhase === "OVER" ? "0" : playerHealth,
      opponentHealth: "20",
      playerEquipment: equipment,
      opponentEquipment: [{ slot: "Hero", cardNumber: "beta_hero", controller: "2" }],
      activeChainLink,
    },
  });
  const attack = (controller, cardNumber, totalPower, totalDefense, reactions = []) => ({
    attackingCard: { controller: String(controller), cardNumber },
    totalPower,
    totalDefense,
    reactions,
  });

  return {
    schemaVersion: "0.1.0",
    exportedAt: "2026-08-20T12:01:00.000Z",
    match: {
      id,
      schemaVersion: "0.1.0",
      status: "finished",
      startedAt: "2026-08-20T12:00:00.000Z",
      endedAt: "2026-08-20T12:01:00.000Z",
      frames: [
        frame(1, 0, 1, attack(1, "opening_attack_red", 4, 0)),
        frame(2, 0, 1, null),
        frame(3, 1, 2, attack(2, "opponent_attack_red", 10, 0)),
        frame(4, 1, 2, attack(2, "opponent_attack_red", 10, 2, [{ cardNumber: "test_helmet", controller: "1" }])),
        frame(5, 1, 2, attack(2, "opponent_attack_red", 10, 5, [
          { cardNumber: "test_helmet", controller: "1" },
          { cardNumber: "hand_block_blue", controller: "1" },
        ])),
        frame(6, 1, 2, null),
        frame(7, 1, 2, attack(2, "overblock_attack_red", 3, 4, [{ cardNumber: "test_helmet", controller: "1" }])),
        frame(8, 1, 2, null, "A", "17"),
        frame(9, 1, 1, attack(1, "player_attack_red", 6, 0)),
        frame(10, 1, 1, null),
        frame(11, 2, 2, attack(2, "lethal_attack_red", 4, 1, [{ cardNumber: "last_block_blue", controller: "1" }]), "OVER"),
      ],
    },
  };
}

function rollbackTelemetryReplayDocument(id) {
  const equipment = [
    { slot: "Hero", cardNumber: "alpha_hero", controller: "1" },
    { slot: "Head", cardNumber: "test_helmet", controller: "1" },
  ];
  const opponentEquipment = [{ slot: "Hero", cardNumber: "beta_hero", controller: "2" }];
  const attack = (controller, cardNumber, totalPower, totalDefense, reactions = []) => ({
    attackingCard: { controller: String(controller), cardNumber },
    totalPower,
    totalDefense,
    reactions,
  });
  const frame = (sequence, payload) => ({
    sequence,
    receivedAt: `2026-08-20T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
  });
  const payload = (turnNo, turnPlayer, playerHealth, activeChainLink, turnPhase = "A") => ({
    turnNo: String(turnNo),
    turnPlayer: String(turnPlayer),
    turnPhase: { turnPhase },
    playerHealth: String(playerHealth),
    opponentHealth: "20",
    playerEquipment: equipment,
    opponentEquipment,
    activeChainLink,
  });
  const rollbackPoint = payload(2, 2, 20, null);
  const opponentAttack = attack(2, "repeated_attack_red", 13, 0);
  const opponentBlock = attack(2, "repeated_attack_red", 13, 2, [
    { cardNumber: "test_helmet", controller: "1" },
  ]);

  return {
    schemaVersion: "0.1.0",
    exportedAt: "2026-08-20T12:01:00.000Z",
    match: {
      id,
      schemaVersion: "0.1.0",
      status: "finished",
      startedAt: "2026-08-20T12:00:00.000Z",
      endedAt: "2026-08-20T12:01:00.000Z",
      frames: [
        frame(1, payload(1, 1, 20, null)),
        frame(2, payload(2, 2, 20, null)),
        frame(3, payload(2, 2, 20, opponentAttack)),
        frame(4, payload(2, 2, 20, opponentBlock)),
        frame(5, payload(2, 2, 9, null)),
        frame(6, { ...rollbackPoint, turnPlayer: "2", turnNo: "2" }),
        frame(7, payload(2, 2, 20, opponentAttack)),
        frame(8, payload(2, 2, 20, opponentBlock)),
        frame(9, payload(2, 2, 20, opponentBlock)),
        frame(10, payload(2, 2, 9, null)),
        frame(11, { ...rollbackPoint, turnPlayer: "2", turnNo: "2" }),
        frame(12, payload(2, 2, 20, opponentAttack)),
        frame(13, payload(2, 2, 20, opponentBlock)),
        frame(14, payload(2, 2, 9, null)),
        frame(15, payload(2, 1, 9, attack(1, "player_attack_red", 7, 0))),
        frame(16, payload(2, 1, 9, null, "OVER")),
      ],
    },
  };
}

async function createTestUser(username) {
  const created = await fetch(new URL("/api/admin/users", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username, role: "user" }),
  });
  assert.equal(created.status, 201);
  const invitation = await created.json();
  const token = new URL(invitation.setupUrl).searchParams.get("token");
  const password = "IsolatedPassword!123";
  const setup = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password, confirmation: password }),
  });
  assert.equal(setup.status, 200);
  const login = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  return getCookie(login);
}

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

function readLastLogin(username) {
  const database = new Database(join(databaseDirectory, "test.sqlite"), { readonly: true });
  try {
    return database
      .prepare("SELECT last_login_at AS lastLoginAt FROM users WHERE username = ?")
      .get(username)?.lastLoginAt ?? null;
  } finally {
    database.close();
  }
}
