import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    if (name === "oversized") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ name: "a".repeat(1024 * 1024 + 1) }] }));
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
      ADMIN_INITIAL_PASSWORD: "Test1!xyLong",
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
        COLLECTIVE_ANALYSIS_ENABLED: "true",
        ANALYSIS_PSEUDONYM_SALT: "integration-test-pseudonym-salt-2026-08-25",
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
    body: JSON.stringify({ username: "admin", password: "Test1!xyLong" }),
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

test("renders the extension privacy policy as a public page", async () => {
  const response = await fetch(new URL("/politica-de-privacidade", baseUrl));

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Política de Privacidade/);
  assert.match(html, /25 de agosto de 2026/);
  assert.match(html, /A sincronização é automática/);
  assert.match(html, /Análises e aprendizado coletivo/);
  assert.match(html, /não transforma automaticamente o dado em anônimo/);
  assert.match(html, /Política de Dados do Usuário da Chrome Web Store/);
  assert.match(html, /Legend Story Studios/);
});

test("applies security headers, private caching and health checks", async () => {
  const loginPage = await fetch(new URL("/login", baseUrl));
  const csp = loginPage.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self' 'nonce-[^']+'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(loginPage.headers.get("x-content-type-options"), "nosniff");
  assert.equal(loginPage.headers.get("x-frame-options"), "DENY");
  assert.match(loginPage.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(loginPage.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
  assert.equal(loginPage.headers.get("x-powered-by"), null);
  const html = await loginPage.text();
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.match(html, new RegExp(`nonce=["']${nonce}["']`));

  const setupPage = await fetch(new URL("/set-password", baseUrl));
  assert.equal(setupPage.headers.get("referrer-policy"), "no-referrer");

  const replayLibrary = await fetch(new URL("/replays", baseUrl), { headers: { cookie } });
  assert.match(replayLibrary.headers.get("cache-control") ?? "", /no-store/);

  const live = await fetch(new URL("/api/health/live", baseUrl));
  const ready = await fetch(new URL("/api/health/ready", baseUrl));
  assert.equal(live.status, 200);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ready" });
});

test("rejects cross-origin mutations and always issues a secure production cookie", async () => {
  const rejected = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ username: "admin", password: "Test1!xyLong" }),
  });
  assert.equal(rejected.status, 403);

  const accepted = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ username: "admin", password: "Test1!xyLong" }),
  });
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.get("set-cookie") ?? "", /; Secure(?:;|$)/i);
  assert.match(accepted.headers.get("cache-control") ?? "", /no-store/);
});

test("bounds small JSON APIs and rejects unsafe numeric identifiers", async () => {
  const oversized = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "x".repeat(17 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "BODY_TOO_LARGE");

  const unsupported = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ username: "admin", password: "Test1!xyLong" }),
  });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).code, "UNSUPPORTED_MEDIA_TYPE");

  const malformed = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "INVALID_JSON");

  const hugeId = "9".repeat(100);
  const replay = await fetch(new URL(`/api/replays/${hugeId}`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(replay.status, 404);

  const user = await fetch(new URL(`/api/admin/users/${hugeId}`, baseUrl), {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(user.status, 404);

  const avatar = await fetch(new URL("/api/profile/avatar", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cardId: "a".repeat(129) }),
  });
  assert.equal(avatar.status, 400);

  const missingAvatar = await fetch(new URL("/api/profile/avatar", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  });
  assert.equal(missingAvatar.status, 400);
});

test("redirects authenticated users from the landing page to the replay library", async () => {
  const response = await fetch(new URL("/", baseUrl), {
    headers: { cookie },
    redirect: "manual",
  });
  const legacyResponse = await fetch(new URL("/me", baseUrl), {
    headers: { cookie },
    redirect: "manual",
  });
  const replayLibrary = await fetch(new URL("/replays", baseUrl), {
    headers: { cookie },
  });

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/replays");
  assert.equal(legacyResponse.status, 307);
  assert.equal(new URL(legacyResponse.headers.get("location"), baseUrl).pathname, "/replays");
  assert.equal(replayLibrary.status, 200);
  assert.match(await replayLibrary.text(), /Replays recentes/);
});

test("renders the authenticated statistics page with shareable filters", async () => {
  const anonymous = await fetch(new URL("/me/stats", baseUrl), { redirect: "manual" });
  assert.equal(anonymous.status, 307);
  assert.match(anonymous.headers.get("location") ?? "", /\/login\?returnTo=%2Fme%2Fstats/);

  const response = await fetch(new URL("/me/stats?period=30&mode=all", baseUrl), { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Estatísticas[\s\S]*do jogador/);
  assert.match(html, /name="period"/);
  assert.match(html, /name="mode"/);
  assert.match(html, /Nenhum replay no período/);
  assert.match(html, /href="\/me\/stats"[^>]*>Estatísticas/);
});

test("shows decision analysis and feedback to the replay owner and administrators", async () => {
  const ownerCookie = await createTestUser("analysis-admin-only-owner");
  const document = decisionReplayDocument("e3333333-3333-4333-8333-333333333333");
  const uploaded = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify(document),
  });
  assert.equal(uploaded.status, 201);
  const { replayId } = await uploaded.json();

  const anonymous = await fetch(new URL(`/api/replays/${replayId}/analysis`, baseUrl));
  assert.equal(anonymous.status, 401);

  const ownerAnalysis = await fetch(new URL(`/api/replays/${replayId}/analysis`, baseUrl), {
    headers: { cookie: ownerCookie },
  });
  assert.equal(ownerAnalysis.status, 200);

  const adminAnalysis = await waitForDecisionAnalysis(replayId, ownerCookie);
  assert.equal(adminAnalysis.status, "ready");
  assert.equal(adminAnalysis.recommendationsVisible, true);
  assert.equal(adminAnalysis.methodology.primaryObjective, "heuristic_score");
  assert.equal(adminAnalysis.methodology.usesFinalResult, false);
  assert.equal(adminAnalysis.methodology.simulatorUsed, true);
  assert.equal(adminAnalysis.versions.analysisSchema, "5.0.0");
  assert.equal(adminAnalysis.versions.replaySchema, "0.3.0");
  assert.equal(adminAnalysis.handAnalyses.length, 1);
  assert.equal(adminAnalysis.handAnalyses[0].confidence, "medium");
  assert.equal(adminAnalysis.handAnalyses[0].marker, "opportunity");
  assert.ok(adminAnalysis.handAnalyses[0].regretScore > 0);
  assert.ok(adminAnalysis.handAnalyses[0].alternatives.length > 0);
  assert.ok(adminAnalysis.handAnalyses[0].alternatives.length <= 2);
  assert.equal(adminAnalysis.handAnalyses[0].horizon, "end_of_turn");
  assert.ok(adminAnalysis.handAnalyses[0].bestAction.sequence.some((step) => step.kind === "resolve"));
  assert.equal(adminAnalysis.handAnalyses[0].search.complete, true);
  assert.equal(adminAnalysis.methodology.informationSearchMode, "shadow");
  assert.equal(adminAnalysis.handAnalyses[0].hiddenInformation.affectsRecommendation, false);
  assert.equal(adminAnalysis.handAnalyses[0].hiddenInformation.belief.archetypes.length, 3);
  assert.equal(adminAnalysis.methodology.learningMode, "shadow");
  assert.equal(adminAnalysis.handAnalyses[0].learning.modelId, null);

  assert.equal((await fetch(new URL("/api/training/exercises", baseUrl))).status, 401);
  const exerciseResponse = await fetch(new URL("/api/training/exercises", baseUrl), { headers: { cookie: ownerCookie } });
  assert.equal(exerciseResponse.status, 200);
  assert.match(exerciseResponse.headers.get("cache-control"), /private|no-store/);
  const practice = await exerciseResponse.json();
  assert.equal(practice.exercises.length, 1);
  const exercise = practice.exercises[0];
  for (const key of ["bestAction", "analysis", "regretScore", "chosenAction", "sequence"]) assert.equal(Object.hasOwn(exercise, key), false);
  assert.equal(exercise.practiced, false);
  const attemptUrl = new URL(`/api/training/exercises/${exercise.id}/attempt`, baseUrl);
  const responseBody = { actionKey: adminAnalysis.handAnalyses[0].bestAction.key };
  const otherAttempt = await fetch(attemptUrl, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(responseBody) });
  assert.equal(otherAttempt.status, 404);
  const externalAttempt = await fetch(attemptUrl, { method: "POST", headers: { "content-type": "application/json", cookie: ownerCookie, origin: "https://untrusted.example" }, body: JSON.stringify(responseBody) });
  assert.equal(externalAttempt.status, 403);
  const attempt = await fetch(attemptUrl, { method: "POST", headers: { "content-type": "application/json", cookie: ownerCookie }, body: JSON.stringify(responseBody) });
  assert.equal(attempt.status, 200);
  const comparison = await attempt.json();
  assert.equal(comparison.withinTolerance, true);
  assert.equal(comparison.scoreGap, 0);
  assert.equal(comparison.strategicallyValidated, false);
  assert.ok(comparison.best.sequence.some((step) => step.kind === "resolve"));
  const exerciseFeedback = await fetch(attemptUrl, { method: "POST", headers: { "content-type": "application/json", cookie: ownerCookie }, body: JSON.stringify({ helpful: true }) });
  assert.equal(exerciseFeedback.status, 200);
  const progress = await (await fetch(new URL("/api/training/exercises", baseUrl), { headers: { cookie: ownerCookie } })).json();
  assert.equal(progress.practiced, 1); assert.equal(progress.exercises[0].attempts, 1);
  const trainingPage = await fetch(new URL("/me/training", baseUrl), { headers: { cookie: ownerCookie } });
  assert.equal(trainingPage.status, 200);
  const trainingHtml = await trainingPage.text();
  assert.match(trainingHtml, /Treinar decisões/); assert.match(trainingHtml, /Qual escolha inicia seu plano/);
  assert.doesNotMatch(trainingHtml, /Melhor linha encontrada/);

  const ownerFeedback = await fetch(new URL(`/api/replays/${replayId}/analysis/feedback`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({
      analysisFingerprint: adminAnalysis.handAnalyses[0].stateFingerprint,
      helpful: false,
    }),
  });
  assert.equal(ownerFeedback.status, 200);

  const feedback = await fetch(new URL(`/api/replays/${replayId}/analysis/feedback`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({
      analysisFingerprint: adminAnalysis.handAnalyses[0].stateFingerprint,
      helpful: true,
    }),
  });
  assert.equal(feedback.status, 200);
  assert.deepEqual(await feedback.json(), { ok: true });

  const report = await fetch(new URL(`/replays/${replayId}`, baseUrl), { headers: { cookie } });
  assert.equal(report.status, 200);
  const reportHtml = await report.text();
  assert.match(reportHtml, /Treinador pós-partida/);
  assert.match(reportHtml, /Melhor linha encontrada/);
  assert.match(reportHtml, /Como usar os marcadores/);
  assert.match(reportHtml, /Oportunidade de melhoria/);
  assert.match(reportHtml, /pts\..*pontos heurísticos/);
  assert.match(reportHtml, /Ação realizada/);
  assert.match(reportHtml, /execução/);
  assert.match(reportHtml, /Abrir decisão na mesa/);
  assert.match(reportHtml, /pontuação é heurística/);
  assert.match(reportHtml, /Sequência calculada com cartas conhecidas/);
  assert.match(reportHtml, /Decomposição da pontuação/);
  assert.match(reportHtml, /Informação oculta — experimento/);
  assert.match(reportHtml, /não alteram os marcadores/);
  assert.match(reportHtml, /peso da hipótese/);
  assert.match(reportHtml, /fim do turno/);

  const ownerReport = await fetch(new URL(`/replays/${replayId}`, baseUrl), { headers: { cookie: ownerCookie } });
  assert.equal(ownerReport.status, 200);
  const ownerReportHtml = await ownerReport.text();
  assert.match(ownerReportHtml, /Treinador pós-partida/);
  assert.match(ownerReportHtml, /Melhor linha encontrada/);
  assert.match(ownerReportHtml, /Como usar os marcadores/);
  assert.match(ownerReportHtml, /Abrir decisão na mesa/);
  assert.doesNotMatch(ownerReportHtml, /Meu caderno/);

  const ownerStats = await fetch(new URL("/me/stats?period=all", baseUrl), { headers: { cookie: ownerCookie } });
  assert.equal(ownerStats.status, 200);
  const ownerStatsHtml = await ownerStats.text();
  assert.match(ownerStatsHtml, /Decisões \/ pós-partida/);
  assert.match(ownerStatsHtml, /Potencial das mãos/);
  assert.match(ownerStatsHtml, /Qualidade da execução/);

  const database = new Database(join(databaseDirectory, "test.sqlite"), { readonly: true });
  try {
    const replay = database.prepare("SELECT id FROM replays WHERE source_match_id = ?").get(replayId);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM decision_observations WHERE replay_id = ?").get(replay.id).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM hand_analyses WHERE replay_id = ?").get(replay.id).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM analysis_feedback WHERE replay_id = ?").get(replay.id).count, 1);
    assert.deepEqual(database.prepare("SELECT attempts, helpful FROM training_exercise_attempts WHERE replay_id = ?").get(replay.id), { attempts: 1, helpful: 1 });
    const dataset = database.prepare("SELECT user_cohort AS userCohort, payload_json AS payloadJson FROM decision_dataset_examples WHERE replay_id = ?").get(replay.id);
    assert.match(dataset.userCohort, /^[0-9a-f]{64}$/);
    for (const forbidden of ["analysis-admin-only-owner", replayId, "private-deck"]) {
      assert.equal(dataset.payloadJson.includes(forbidden), false, forbidden);
    }
  } finally {
    database.close();
  }

  const reprocess = await fetch(new URL("/api/admin/analysis-jobs", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ replayId }),
  });
  assert.equal(reprocess.status, 200);
  const queueDatabase = new Database(join(databaseDirectory, "test.sqlite"));
  try {
    const replay = queueDatabase.prepare("SELECT id FROM replays WHERE source_match_id = ?").get(replayId);
    queueDatabase.prepare(`
      UPDATE analysis_jobs
      SET status = 'running', lease_token = 'abandoned-test-worker', lease_expires_at = 1,
          completed_at = NULL, updated_at = 1
      WHERE replay_id = ?
    `).run(replay.id);
  } finally {
    queueDatabase.close();
  }
  assert.equal(await waitForAnalysisJobState(replayId, "ready"), "ready");
});

test("classifies replay participation, protects manual corrections and excludes watched analysis", async () => {
  const ownerCookie = createDatabaseUserSession("participation-owner");
  const strangerCookie = createDatabaseUserSession("participation-stranger");
  const playedId = "c9000000-0000-4000-8000-000000000001";
  const watchedId = "c9000000-0000-4000-8000-000000000002";
  const legacyId = "c9000000-0000-4000-8000-000000000003";
  const playedDocument = decisionReplayDocument(playedId);
  const watchedDocument = decisionReplayDocument(watchedId);
  watchedDocument.match.decisionEvents = [];
  const legacyDocument = replayDocument(legacyId, true);

  for (const document of [playedDocument, watchedDocument, legacyDocument]) {
    const response = await uploadDocument(ownerCookie, document);
    assert.equal(response.status, 201);
  }
  await waitForDecisionAnalysis(playedId, ownerCookie);

  const database = new Database(join(databaseDirectory, "test.sqlite"));
  try {
    assert.deepEqual(
      database.prepare(`
        SELECT source_match_id AS id, participation, participation_source AS source
        FROM replays WHERE source_match_id IN (?, ?, ?) ORDER BY source_match_id
      `).all(playedId, watchedId, legacyId),
      [
        { id: playedId, participation: "played", source: "automatic" },
        { id: watchedId, participation: "watched", source: "automatic" },
        { id: legacyId, participation: "unknown", source: null },
      ],
    );
    const watchedReplay = database.prepare("SELECT id FROM replays WHERE source_match_id = ?").get(watchedId);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM replay_analyses WHERE replay_id = ?").get(watchedReplay.id).count, 0);
  } finally {
    database.close();
  }

  const library = await fetch(new URL("/replays", baseUrl), { headers: { cookie: ownerCookie } });
  const libraryHtml = await library.text();
  assert.match(libraryHtml, /Participação/);
  assert.match(libraryHtml, /Jogada/);
  assert.match(libraryHtml, /Assistida/);
  assert.match(libraryHtml, /Não identificado/);

  const stats = await fetch(new URL("/me/stats?period=all", baseUrl), { headers: { cookie: ownerCookie } });
  assert.match(await stats.text(), /2(?:<!-- -->)? vitórias em (?:<!-- -->)?2(?:<!-- -->)? partidas/);

  const hiddenAnalysis = await fetch(new URL(`/api/replays/${watchedId}/analysis`, baseUrl), { headers: { cookie: ownerCookie } });
  assert.deepEqual(await hiddenAnalysis.json(), {
    status: "insufficient_data",
    observationCount: 0,
    analysisCount: 0,
    versions: null,
    summary: null,
    methodology: null,
    handAnalyses: [],
    recommendationsVisible: false,
    shadowMode: false,
    reason: "watched_replay",
  });

  const anonymous = await fetch(new URL(`/api/replays/${playedId}/participation`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participation: "watched" }),
  });
  assert.equal(anonymous.status, 401);
  const crossOrigin = await fetch(new URL(`/api/replays/${playedId}/participation`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie, origin: "https://evil.example" },
    body: JSON.stringify({ participation: "watched" }),
  });
  assert.equal(crossOrigin.status, 403);
  const invalid = await fetch(new URL(`/api/replays/${playedId}/participation`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ participation: "spectated" }),
  });
  assert.equal(invalid.status, 400);
  const stranger = await fetch(new URL(`/api/replays/${playedId}/participation`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: strangerCookie },
    body: JSON.stringify({ participation: "watched" }),
  });
  assert.equal(stranger.status, 404);

  const manualUnknown = await fetch(new URL(`/api/replays/${legacyId}/participation`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ participation: "unknown" }),
  });
  assert.equal(manualUnknown.status, 200);
  const duplicateWithCapture = structuredClone(legacyDocument);
  duplicateWithCapture.match.decisionEvents = [{ sequence: 1, frameSequence: 1, choice: { action: "0" } }];
  assert.equal((await uploadDocument(ownerCookie, duplicateWithCapture)).status, 200);

  const correctedToPlayed = await fetch(new URL(`/api/replays/${watchedId}/participation`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ participation: "played" }),
  });
  assert.equal(correctedToPlayed.status, 200);
  await waitForDecisionAnalysis(watchedId, ownerCookie);

  const adminCorrection = await fetch(new URL(`/api/replays/${playedId}/participation`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ participation: "watched" }),
  });
  assert.equal(adminCorrection.status, 200);

  const verified = new Database(join(databaseDirectory, "test.sqlite"), { readonly: true });
  try {
    assert.deepEqual(
      verified.prepare("SELECT participation, participation_source AS source FROM replays WHERE source_match_id = ?").get(legacyId),
      { participation: "unknown", source: "manual" },
    );
    const watchedReplay = verified.prepare("SELECT id FROM replays WHERE source_match_id = ?").get(watchedId);
    assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM replay_analyses WHERE replay_id = ?").get(watchedReplay.id).count, 1);
  } finally {
    verified.close();
  }
});

test("persists the player notebook and protects temporary coach links", async () => {
  const ownerCookie = createDatabaseUserSession("workspace-coach-owner");
  const strangerCookie = createDatabaseUserSession("workspace-coach-stranger");
  const replayId = "e4444444-4444-4444-8444-444444444444";
  const uploaded = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify(decisionReplayDocument(replayId)),
  });
  assert.equal(uploaded.status, 201);

  const workspaceUpdate = await fetch(new URL(`/api/replays/${replayId}/workspace`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ note: "Rever a defesa no turno dois.", isFavorite: true, reviewed: true, tags: ["Defesa", "Pitch"] }),
  });
  assert.equal(workspaceUpdate.status, 200);
  const workspace = await workspaceUpdate.json();
  assert.equal(workspace.isFavorite, true);
  assert.ok(workspace.reviewedAt);
  assert.deepEqual(workspace.tags.map((tag) => tag.name).sort(), ["Defesa", "Pitch"]);

  const replayLibrary = await fetch(new URL("/replays", baseUrl), { headers: { cookie: ownerCookie } });
  const replayLibraryHtml = await replayLibrary.text();
  assert.match(replayLibraryHtml, /aria-label="Remover dos favoritos"/);
  assert.match(replayLibraryHtml, /aria-pressed="true"/);
  assert.doesNotMatch(replayLibraryHtml, /★ Favorito|☆ Favoritar/);
  assert.doesNotMatch(replayLibraryHtml, /Marcar revisado|Revisado ✓/);

  const forbiddenWorkspace = await fetch(new URL(`/api/replays/${replayId}/workspace`, baseUrl), { headers: { cookie: strangerCookie } });
  assert.equal(forbiddenWorkspace.status, 404);
  const invalidBookmark = await fetch(new URL(`/api/replays/${replayId}/bookmarks`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ frameIndex: 99999, title: "Fora" }),
  });
  assert.equal(invalidBookmark.status, 400);
  const bookmarkResponse = await fetch(new URL(`/api/replays/${replayId}/bookmarks`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ frameIndex: 0, title: "Início da decisão", note: "Compare as linhas." }),
  });
  assert.equal(bookmarkResponse.status, 201);

  const shareResponse = await fetch(new URL(`/api/replays/${replayId}/shares`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ coachName: "Treinador Teste", durationDays: 7, includeAnalysis: true, includeNote: true, includeBookmarks: true, includeGoals: false }),
  });
  assert.equal(shareResponse.status, 201);
  const createdShare = await shareResponse.json();
  const shareUrl = new URL(createdShare.url, baseUrl);
  const shareId = shareUrl.pathname.split("/").at(-1);
  const token = new URLSearchParams(shareUrl.hash.slice(1)).get("token");
  assert.ok(shareId);
  assert.ok(token);
  assert.doesNotMatch(JSON.stringify(createdShare), /tokenHash|token_hash/);

  const missingToken = await fetch(new URL(`/api/coach/shares/${shareId}`, baseUrl));
  assert.equal(missingToken.status, 404);
  const publicShare = await fetch(new URL(`/api/coach/shares/${shareId}`, baseUrl), { headers: { "x-hyperdriver-coach-token": token } });
  assert.equal(publicShare.status, 200);
  assert.equal(publicShare.headers.get("referrer-policy"), "no-referrer");
  assert.match(publicShare.headers.get("x-robots-tag") ?? "", /noindex/);
  const shared = await publicShare.json();
  assert.equal(shared.note, "Rever a defesa no turno dois.");
  assert.equal(shared.bookmarks.length, 1);
  assert.equal(shared.analysis.recommendationsVisible, true);
  assert.doesNotMatch(JSON.stringify(shared), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const threadResponse = await fetch(new URL(`/api/coach/shares/${shareId}/threads`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-hyperdriver-coach-token": token },
    body: JSON.stringify({ frameIndex: 0, body: "Por que esta linha foi escolhida?" }),
  });
  assert.equal(threadResponse.status, 201);
  const thread = await threadResponse.json();
  const ownerReply = await fetch(new URL(`/api/replays/${replayId}/coaching/threads/${thread.id}/messages`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ body: "Eu estava preservando uma carta azul." }),
  });
  assert.equal(ownerReply.status, 201);
  const resolved = await fetch(new URL(`/api/replays/${replayId}/coaching/threads/${thread.id}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ resolved: true }),
  });
  assert.equal(resolved.status, 200);

  const goalResponse = await fetch(new URL("/api/goals", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ origin: "manual", title: "Planejar o pitch", description: "Revisar antes de confirmar.", targetMatches: 10 }),
  });
  assert.equal(goalResponse.status, 201);
  const goalsPage = await fetch(new URL("/me/goals", baseUrl), { headers: { cookie: ownerCookie } });
  assert.equal(goalsPage.status, 200);
  assert.match(await goalsPage.text(), /Planejar o pitch/);

  const database = new Database(join(databaseDirectory, "test.sqlite"), { readonly: true });
  try {
    const storedShare = database.prepare("SELECT token_hash AS tokenHash FROM replay_shares WHERE id = ?").get(shareId);
    assert.equal(storedShare.tokenHash, createHash("sha256").update(token).digest("hex"));
    assert.notEqual(storedShare.tokenHash, token);
  } finally {
    database.close();
  }
  const revoked = await fetch(new URL(`/api/replays/${replayId}/shares/${shareId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ revoked: true }),
  });
  assert.equal(revoked.status, 200);
  const revokedPublic = await fetch(new URL(`/api/coach/shares/${shareId}`, baseUrl), { headers: { "x-hyperdriver-coach-token": token } });
  assert.equal(revokedPublic.status, 404);
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
  assert.match(invitation.avatarCardId, /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/);
  assert.equal(readUserAvatar("jogador-01"), invitation.avatarCardId);
  assert.match(invitation.setupUrl, /\/set-password#token=/);
  assert.ok(invitation.expiresAt - Date.now() > 2 * 60 * 60 * 1000 - 5000);
  assert.ok(invitation.expiresAt - Date.now() <= 2 * 60 * 60 * 1000);

  const overlongPassword = `A1!${"a".repeat(254)}`;
  const rejectedPassword = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: invitationToken(invitation.setupUrl),
      password: overlongPassword,
      confirmation: overlongPassword,
    }),
  });
  assert.equal(rejectedPassword.status, 400);
  assert.match((await rejectedPassword.json()).error, /no máximo 256 caracteres/);

  const setupPage = await fetch(invitation.setupUrl);
  assert.equal(setupPage.status, 200);
  const setupHtml = await setupPage.text();
  assert.match(setupHtml, /Crie sua/);
  assert.match(setupHtml.replace(/<[^>]*>/g, ""), /Entre 8 e 256 caracteres/);

  const regenerated = await fetch(
    new URL(`/api/admin/users/${invitation.id}/password-link`, baseUrl),
    { method: "POST", headers: { cookie } },
  );
  assert.equal(regenerated.status, 200);
  const regeneratedInvitation = await regenerated.json();
  assert.match(regeneratedInvitation.setupUrl, /\/set-password#token=/);
  assert.notEqual(regeneratedInvitation.setupUrl, invitation.setupUrl);
  const minimumPassword = "Abcd1!xy";

  const staleSetup = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: invitationToken(invitation.setupUrl),
      password: minimumPassword,
      confirmation: minimumPassword,
    }),
  });
  assert.equal(staleSetup.status, 400);

  const setup = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: invitationToken(regeneratedInvitation.setupUrl),
      password: minimumPassword,
      confirmation: minimumPassword,
    }),
  });
  assert.equal(setup.status, 200);

  const reused = await fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: invitationToken(regeneratedInvitation.setupUrl),
      password: minimumPassword,
      confirmation: minimumPassword,
    }),
  });
  assert.equal(reused.status, 400);

  const userLogin = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "jogador-01", password: minimumPassword }),
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
  const userAdminPage = await fetch(new URL("/admin/usuarios", baseUrl), {
    headers: { cookie: userCookie },
    redirect: "manual",
  });
  assert.equal(userAdminPage.status, 307);
  assert.equal(new URL(userAdminPage.headers.get("location"), baseUrl).pathname, "/");
  const userProfilePage = await fetch(new URL("/replays", baseUrl), {
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
      token: invitationToken(resetInvitation.setupUrl),
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
  assert.equal(new URL(expiredSession.headers.get("location"), baseUrl).pathname, "/replays");
  const oldPasswordLogin = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "jogador-01", password: minimumPassword }),
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

  const adminPage = await fetch(new URL("/admin/usuarios", baseUrl), { headers: { cookie } });
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Adicionar usuário/);
  assert.match(adminHtml, /aria-current="page"[^>]*href="\/admin\/usuarios"/);
  assert.match(adminHtml, /href="\/admin\/extensoes"/);
  assert.match(adminHtml, /Versões da extensão/);
  assert.match(adminHtml, /Gerar link de senha/);
  assert.match(adminHtml, />Apagar<\/button>/);
  assert.match(adminHtml, /Último login:/);

  const healthPage = await fetch(new URL("/admin", baseUrl), { headers: { cookie } });
  assert.equal(healthPage.status, 200);
  const healthHtml = await healthPage.text();
  assert.match(healthHtml, /Saúde do sistema/);
  assert.match(healthHtml, /Tentativas por dia/);
  assert.match(healthHtml, /Partidas aceitas/);
  assert.match(healthHtml, /href="\/admin\/usuarios"/);

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

test("lista versões válidas da extensão para administradores", async () => {
  const anonymous = await fetch(new URL("/admin/extensoes", baseUrl), { redirect: "manual" });
  assert.equal(anonymous.status, 307);
  assert.match(anonymous.headers.get("location") ?? "", /\/login\?returnTo=%2Fadmin%2Fextensoes/);

  const response = await fetch(new URL("/admin/extensoes", baseUrl), { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Versões da extensão/);
  assert.match(html, /v1\.5\.0/);
  assert.match(html, /v1\.0\.0/);
  assert.match(html, /v0\.4\.4/);
  assert.match(html, /Data de criação|Arquivo criado em/);
  assert.match(html, /href="\/downloads\/hyperdriver-extension-v1\.5\.2\.zip"/);
  assert.match(html, /download="hyperdriver-extension-v1\.5\.2\.zip"/);
  assert.match(html, /Usuários/);
  assert.doesNotMatch(html, /hyperdriver-extension\.zip/);

  for (const version of ["1.6.0", "1.5.2", "1.5.1", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0", "1.0.0", "0.4.4"]) {
    const download = await fetch(new URL(`/downloads/hyperdriver-extension-v${version}.zip`, baseUrl));
    assert.equal(download.status, 200);
    assert.ok((await download.arrayBuffer()).byteLength > 0);
  }
});

test("consumes a password invitation atomically under a race", async () => {
  const created = await fetch(new URL("/api/admin/users", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username: "token-race", role: "user" }),
  });
  assert.equal(created.status, 201);
  const invitation = await created.json();
  const token = invitationToken(invitation.setupUrl);
  const password = "ConcurrentPassword!123";
  const attempts = await Promise.all([1, 2].map(() => fetch(new URL("/api/auth/setup-password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.80" },
    body: JSON.stringify({ token, password, confirmation: password }),
  })));
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 400]);
});

test("renders canonical replay routes and validates legacy redirects", async () => {
  const [tableResponse, legacyTelemetryResponse, invalidTelemetryResponse, invalidTableResponse, invalidCanonicalTelemetryResponse, invalidCanonicalTableResponse] = await Promise.all([
    fetch(new URL("/table", baseUrl), { headers: { cookie } }),
    fetch(new URL("/valor", baseUrl), { headers: { cookie } }),
    fetch(new URL("/telemetry/not-a-replay", baseUrl), { headers: { cookie } }),
    fetch(new URL("/table/not-a-replay", baseUrl), { headers: { cookie } }),
    fetch(new URL("/replays/not-a-replay", baseUrl), { headers: { cookie } }),
    fetch(new URL("/replays/not-a-replay/table", baseUrl), { headers: { cookie } }),
  ]);
  const replayLibraryResponse = await fetch(new URL("/replays", baseUrl), {
    headers: { cookie },
  });
  const editProfileResponse = await fetch(new URL("/me/profile", baseUrl), {
    headers: { cookie },
  });
  const [legacyTablePage, legacyProfilePage, legacyPasswordPage] = await Promise.all([
    fetch(new URL("/mesa", baseUrl), { headers: { cookie }, redirect: "manual" }),
    fetch(new URL("/perfil/editar", baseUrl), { headers: { cookie }, redirect: "manual" }),
    fetch(new URL("/primeira-senha", baseUrl), { redirect: "manual" }),
  ]);

  assert.equal(tableResponse.status, 200);
  assert.match(await tableResponse.text(), /Montando a mesa/);
  assert.equal(legacyTelemetryResponse.status, 404);
  assert.equal(invalidTelemetryResponse.status, 404);
  assert.equal(invalidTableResponse.status, 404);
  assert.equal(invalidCanonicalTelemetryResponse.status, 404);
  assert.equal(invalidCanonicalTableResponse.status, 404);
  assert.equal(replayLibraryResponse.status, 200);
  const replayLibraryHtml = await replayLibraryResponse.text();
  assert.match(replayLibraryHtml, /Replays recentes/);
  assert.match(replayLibraryHtml, /Abrir menu de admin/);
  assert.match(replayLibraryHtml, /Abrir menu principal/);
  assert.match(replayLibraryHtml, /Pitwall \/ navegação/);
  assert.match(replayLibraryHtml, /href="\/admin"[^>]*>Administração/);
  assert.match(replayLibraryHtml, /href="https:\/\/chromewebstore\.google\.com\/detail\/ahbjlfpiejjlaplcjnipdcplnkoibegn\?utm_source=header"/g);
  assert.doesNotMatch(replayLibraryHtml, /download="hyperdriver-extension-v[\d.]+\.zip"/);
  assert.doesNotMatch(replayLibraryHtml, /Replay telemetry|Importar replay|Perfil \/ avatar/);
  assert.equal(editProfileResponse.status, 200);
  const editProfileHtml = await editProfileResponse.text();
  assert.match(editProfileHtml, /Seu perfil/);
  assert.match(editProfileHtml, /Nome de usuário/);
  assert.match(editProfileHtml, /Alterar foto/);
  assert.match(editProfileHtml, /Abrir menu principal/);
  assert.doesNotMatch(editProfileHtml, /Replays recentes/);
  assert.equal(legacyTablePage.status, 307);
  assert.equal(new URL(legacyTablePage.headers.get("location"), baseUrl).pathname, "/table");
  assert.equal(legacyProfilePage.status, 307);
  assert.equal(new URL(legacyProfilePage.headers.get("location"), baseUrl).pathname, "/me/profile");
  assert.equal(legacyPasswordPage.status, 307);
  assert.equal(new URL(legacyPasswordPage.headers.get("location"), baseUrl).pathname, "/set-password");
});

test("allows authenticated users to choose a FAB card avatar", async () => {
  const initial = await fetch(new URL("/replays", baseUrl), { headers: { cookie } });
  const initialHtml = await initial.text();
  assert.match(initialHtml, /dash_io_cropped\.webp/);

  const updated = await fetch(new URL("/api/profile/avatar", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cardId: "crown_of_providence" }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { ok: true, avatarCardId: "crown_of_providence" });

  const afterUpdate = await fetch(new URL("/replays", baseUrl), { headers: { cookie } });
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
  const afterCatalogUpdate = await fetch(new URL("/replays", baseUrl), { headers: { cookie } });
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

  const oversized = await fetch(new URL("/api/profile/avatar-options?name=oversized", baseUrl), {
    headers: { cookie },
  });
  assert.equal(oversized.status, 502);
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
  assert.match(source, /CardImage/);
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

  const redirectedCompletion = replayDocument("5e666666-6666-4666-8666-666666666666", true);
  redirectedCompletion.match.frames.at(-1).payload.turnPhase = { turnPhase: "DOCRANK" };
  redirectedCompletion.match.result = "defeat";
  redirectedCompletion.match.completion = {
    reason: "manual",
    source: "extension-popup",
    at: redirectedCompletion.match.endedAt,
    result: "defeat",
  };
  const redirectedUpload = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(redirectedCompletion),
  });
  assert.equal(redirectedUpload.status, 201);

  const partialDocument = replayDocument("5f777777-7777-4777-8777-777777777777", true);
  partialDocument.match.frames[0].payload.turnNo = "2";
  const partialUpload = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(partialDocument),
  });
  assert.equal(partialUpload.status, 422);
  assert.equal((await partialUpload.json()).code, "PARTIAL_REPLAY");

  const corruptUpload = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{not-json",
  });
  assert.equal(corruptUpload.status, 400);

  const incompleteUpload = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(replayDocument("6f888888-8888-4888-8888-888888888888", false)),
  });
  assert.equal(incompleteUpload.status, 422);

  const healthResponse = await fetch(new URL("/api/admin/upload-health", baseUrl), { headers: { cookie } });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.deepEqual(health.summary.categories.map((category) => category.key), ["success", "error", "duplicate", "non_t0", "truncated", "corrupt"]);
  assert.ok(health.summary.total >= 2);
  assert.ok(health.summary.categories.find((category) => category.key === "success").total >= 1);
  assert.ok(health.summary.categories.find((category) => category.key === "error").total >= 1);
  assert.ok(health.summary.categories.find((category) => category.key === "corrupt").total >= 1);
  const nonT0Day = health.summary.days.find((day) => day.cells.non_t0.count > 0);
  assert.ok(nonT0Day);
  const nonT0Details = await fetch(new URL(`/api/admin/upload-health?date=${nonT0Day.date}&category=non_t0`, baseUrl), { headers: { cookie } });
  assert.equal(nonT0Details.status, 200);
  const nonT0Payload = await nonT0Details.json();
  assert.ok(nonT0Payload.details.items.some((item) => item.sourceMatchId === partialDocument.match.id && item.errorCode === "PARTIAL_REPLAY"));

  const adminLibrary = await fetch(new URL("/replays", baseUrl), { headers: { cookie } });
  const adminHtml = await adminLibrary.text();
  assert.match(adminHtml, /Alpha Hero/);
  assert.match(adminHtml, /alpha_hero_cropped\.webp/);
  assert.match(adminHtml, /beta_hero_cropped\.webp/);
  assert.match(adminHtml, /Modo de jogo/);
  assert.match(adminHtml, /Classic Constructed/);
  assert.match(adminHtml, /href="\/admin\/replays"[^>]*>Partidas/);
  assert.doesNotMatch(adminHtml, /Snapshots|Origem/);
  assert.match(adminHtml, new RegExp(`/replays/${uploaded.replayId}/table`));
  assert.doesNotMatch(adminHtml, new RegExp(`/table/${uploaded.replayId}`));
  assert.doesNotMatch(adminHtml, /\/table\?replay=/);
  assert.match(adminHtml, new RegExp(`/replays/${uploaded.replayId}`));
  assert.doesNotMatch(adminHtml, new RegExp(`/telemetry/${uploaded.replayId}`));
  assert.match(adminHtml, />Análise <svg/);
  assert.doesNotMatch(adminHtml, /Análise da partida/);
  assert.doesNotMatch(adminHtml, /Ver telemetria/);

  const replayTable = await fetch(new URL(`/replays/${uploaded.replayId}/table`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(replayTable.status, 200);
  assert.match(await replayTable.text(), /Montando a mesa/);

  const legacyTable = await fetch(new URL(`/table/${uploaded.replayId}`, baseUrl), {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(legacyTable.status, 307);
  assert.equal(new URL(legacyTable.headers.get("location"), baseUrl).pathname, `/replays/${uploaded.replayId}/table`);

  const stored = await fetch(new URL(`/api/replays/${uploaded.replayId}`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(stored.status, 200);
  const storedDocument = await stored.json();
  assert.equal(storedDocument.match.id, "4f37f7bb-2747-4f0c-8a7e-1ec3dcae6a01");
  assert.equal(storedDocument.match.frames[0].payload.chatLog, undefined);
  const telemetry = await fetch(new URL(`/replays/${uploaded.replayId}`, baseUrl), {
    headers: { cookie },
  });
  const telemetryHtml = await telemetry.text();
  assert.equal(telemetry.status, 200);
  assert.match(telemetryHtml, /Análise da/);
  assert.match(telemetryHtml, /role="tablist"/);
  assert.match(telemetryHtml, /Treinador/);
  assert.doesNotMatch(telemetryHtml, /Caderno/);
  assert.match(telemetryHtml, /Telemetria/);
  assert.match(telemetryHtml, /Dano recebido/);
  assert.match(telemetryHtml, /Bloqueado por equipamento/);
  assert.match(telemetryHtml, /Bloqueado por carta/);
  assert.match(telemetryHtml, /Dano oferecido/);
  assert.match(telemetryHtml, /Vida ganha/);
  assert.match(telemetryHtml, />Você</);
  assert.match(telemetryHtml, /Alpha Hero/);
  assert.match(telemetryHtml, /Beta Hero/);
  assert.match(telemetryHtml, /Classic Constructed/);
  assert.match(telemetryHtml, /Você(?:<!-- -->)? começou/);
  assert.match(telemetryHtml, /Vitória/);
  assert.match(telemetryHtml, /data-tooltip="Dano oferecido: 7"/);
  assert.doesNotMatch(telemetryHtml, /Início parcial|Fim parcial/);

  const legacyTelemetry = await fetch(new URL(`/telemetry/${uploaded.replayId}`, baseUrl), {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(legacyTelemetry.status, 307);
  assert.equal(new URL(legacyTelemetry.headers.get("location"), baseUrl).pathname, `/replays/${uploaded.replayId}`);

  const telemetryDocument = telemetryReplayDocument("6684ca31-240a-44df-ae6f-5185878bcbf2");
  const telemetryUpload = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(telemetryDocument),
  });
  assert.equal(telemetryUpload.status, 201);
  const telemetryReplay = await telemetryUpload.json();
  const detailedTelemetry = await fetch(
    new URL(`/replays/${telemetryReplay.replayId}`, baseUrl),
    { headers: { cookie } },
  );
  assert.equal(detailedTelemetry.status, 200);
  const detailedTelemetryHtml = await detailedTelemetry.text();
  assert.match(detailedTelemetryHtml, /data-tooltip="Dano recebido: 5"/);
  assert.match(detailedTelemetryHtml, /data-tooltip="Bloqueado por equipamento: 5"/);
  assert.match(detailedTelemetryHtml, /data-tooltip="Bloqueado por carta: 3"/);
  assert.match(detailedTelemetryHtml, /data-tooltip="Dano oferecido: 6"/);
  assert.match(detailedTelemetryHtml, /data-tooltip="Vida ganha: 3"/);
  assert.ok(
    detailedTelemetryHtml.indexOf('data-tooltip="Vida ganha: 3"')
      < detailedTelemetryHtml.indexOf('data-tooltip="Dano oferecido: 6"'),
  );
  assert.match(detailedTelemetryHtml, /cycleTotal[^"]*">22<\/strong>/);
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
    new URL(`/replays/${rollbackReplay.replayId}`, baseUrl),
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
  assert.doesNotMatch(rollbackTelemetryHtml, /data-tooltip="Vida ganha:/);

  const anonymousTelemetry = await fetch(
    new URL(`/replays/${telemetryReplay.replayId}`, baseUrl),
    { redirect: "manual" },
  );
  assert.equal(anonymousTelemetry.status, 307);
  assert.match(anonymousTelemetry.headers.get("location") ?? "", /\/login\?returnTo=%2Freplays%2F/);

  const isolatedCookie = await createTestUser("isolated-user");
  const isolatedLibrary = await fetch(new URL("/replays", baseUrl), {
    headers: { cookie: isolatedCookie },
  });
  const isolatedLibraryHtml = await isolatedLibrary.text();
  assert.doesNotMatch(isolatedLibraryHtml, /Alpha Hero/);
  assert.doesNotMatch(isolatedLibraryHtml, /href="\/admin\/replays"[^>]*>Partidas/);
  const privateReplay = await fetch(new URL(`/api/replays/${uploaded.replayId}`, baseUrl), {
    headers: { cookie: isolatedCookie },
  });
  assert.equal(privateReplay.status, 404);
  const privateTelemetry = await fetch(new URL(`/replays/${uploaded.replayId}`, baseUrl), {
    headers: { cookie: isolatedCookie },
  });
  assert.equal(privateTelemetry.status, 404);
});

test("lets admins list and open replays owned by different users", async () => {
  const alphaCookie = await createTestUser("partidas-alpha");
  const betaCookie = await createTestUser("partidas-beta");
  const forbiddenHealth = await fetch(new URL("/api/admin/upload-health", baseUrl), { headers: { cookie: alphaCookie } });
  assert.equal(forbiddenHealth.status, 403);
  const alphaReplayId = "a1111111-1111-4111-8111-111111111111";
  const betaReplayId = "b2222222-2222-4222-8222-222222222222";

  for (const [userCookie, replayId, startedAt] of [
    [alphaCookie, alphaReplayId, "2026-08-20T12:00:00.000Z"],
    [betaCookie, betaReplayId, "2026-08-21T12:00:00.000Z"],
  ]) {
    const upload = await fetch(new URL("/api/replays", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: userCookie },
      body: JSON.stringify(replayDocument(replayId, true, startedAt)),
    });
    assert.equal(upload.status, 201);
  }

  const adminPage = await fetch(new URL("/admin/replays", baseUrl), { headers: { cookie } });
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Todas as partidas/);
  assert.match(adminHtml, /partidas-alpha/);
  assert.match(adminHtml, /partidas-beta/);
  assert.ok(adminHtml.indexOf("partidas-beta") < adminHtml.indexOf("partidas-alpha"));
  assert.match(adminHtml, new RegExp(`/replays/${alphaReplayId}/table`));
  assert.match(adminHtml, new RegExp(`/replays/${alphaReplayId}`));
  assert.doesNotMatch(adminHtml, /href="\/admin\/partidas"/);

  const legacyAdminPage = await fetch(new URL("/admin/partidas", baseUrl), {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(legacyAdminPage.status, 307);
  assert.equal(new URL(legacyAdminPage.headers.get("location"), baseUrl).pathname, "/admin/replays");

  const userAdminPage = await fetch(new URL("/admin/replays", baseUrl), {
    headers: { cookie: alphaCookie },
    redirect: "manual",
  });
  assert.equal(userAdminPage.status, 307);
  assert.equal(new URL(userAdminPage.headers.get("location"), baseUrl).pathname, "/");

  const adminTable = await fetch(new URL(`/replays/${alphaReplayId}/table`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(adminTable.status, 200);
  assert.match(await adminTable.text(), /Montando a mesa/);

  const adminReplayData = await fetch(new URL(`/api/replays/${alphaReplayId}`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(adminReplayData.status, 200);
  assert.equal((await adminReplayData.json()).match.id, alphaReplayId);

  const adminAnalysis = await fetch(new URL(`/replays/${alphaReplayId}`, baseUrl), {
    headers: { cookie },
  });
  assert.equal(adminAnalysis.status, 200);
  assert.match(await adminAnalysis.text(), /Análise da/);

  const userReplayData = await fetch(new URL(`/api/replays/${alphaReplayId}`, baseUrl), {
    headers: { cookie: betaCookie },
  });
  assert.equal(userReplayData.status, 404);
  const userAnalysis = await fetch(new URL(`/replays/${alphaReplayId}`, baseUrl), {
    headers: { cookie: betaCookie },
  });
  assert.equal(userAnalysis.status, 404);
});

test("stores arbitrary JSON uploads privately and downloads their original bytes", async () => {
  const userCookie = createDatabaseUserSession("json-box-user");
  const bytes = Uint8Array.from([0, 255, 123, 110, 111, 116, 45, 106, 115, 111, 110, 125, 10]);
  const uploadForm = new FormData();
  uploadForm.set("file", new Blob([bytes], { type: "application/json" }), "captura inválida.json");

  const anonymous = await fetch(new URL("/api/admin/json", baseUrl), {
    method: "POST",
    body: uploadForm,
  });
  assert.equal(anonymous.status, 401);
  const forbidden = await fetch(new URL("/api/admin/json", baseUrl), {
    method: "POST",
    headers: { cookie: userCookie },
    body: uploadForm,
  });
  assert.equal(forbidden.status, 403);
  const crossOrigin = await fetch(new URL("/api/admin/json", baseUrl), {
    method: "POST",
    headers: { cookie, origin: "https://evil.example" },
    body: uploadForm,
  });
  assert.equal(crossOrigin.status, 403);

  const invalidNameForm = new FormData();
  invalidNameForm.set("file", new Blob(["{}"]), "captura.txt");
  const invalidName = await fetch(new URL("/api/admin/json", baseUrl), {
    method: "POST",
    headers: { cookie },
    body: invalidNameForm,
  });
  assert.equal(invalidName.status, 400);

  const acceptedForm = new FormData();
  acceptedForm.set("file", new Blob([bytes], { type: "application/json" }), "captura inválida.json");
  const accepted = await fetch(new URL("/api/admin/json", baseUrl), {
    method: "POST",
    headers: { cookie },
    body: acceptedForm,
  });
  assert.equal(accepted.status, 201);
  const record = (await accepted.json()).file;
  assert.equal(record.originalName, "captura inválida.json");
  assert.equal(record.sizeBytes, bytes.byteLength);
  assert.equal(record.adminUsername, "admin");

  const emptyForm = new FormData();
  emptyForm.set("file", new Blob([]), "vazio.json");
  const empty = await fetch(new URL("/api/admin/json", baseUrl), {
    method: "POST",
    headers: { cookie },
    body: emptyForm,
  });
  assert.equal(empty.status, 201);

  const anonymousDownload = await fetch(new URL(`/api/admin/json/${record.id}`, baseUrl));
  assert.equal(anonymousDownload.status, 401);
  const forbiddenDownload = await fetch(new URL(`/api/admin/json/${record.id}`, baseUrl), { headers: { cookie: userCookie } });
  assert.equal(forbiddenDownload.status, 403);
  const download = await fetch(new URL(`/api/admin/json/${record.id}`, baseUrl), { headers: { cookie } });
  assert.equal(download.status, 200);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  assert.match(download.headers.get("content-disposition") ?? "", /captura.*\.json/);
  assert.match(download.headers.get("cache-control") ?? "", /private.*no-store/);

  const page = await fetch(new URL("/admin/json", baseUrl), { headers: { cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Arquivos JSON/);
  assert.match(html, /captura inválida\.json/);
  assert.match(html, /vazio\.json/);
  assert.match(html, /Enviado por.*admin/);
  assert.match(html, /href="\/api\/admin\/json\//);
  assert.ok(html.indexOf("vazio.json") < html.indexOf("captura inválida.json"));

  const userPage = await fetch(new URL("/admin/json", baseUrl), {
    headers: { cookie: userCookie },
    redirect: "manual",
  });
  assert.equal(userPage.status, 307);
  assert.equal(new URL(userPage.headers.get("location"), baseUrl).pathname, "/");
});

test("scores Talishar Elo once, confirms inverted perspectives and audits conflicts", async () => {
  const firstCookie = createDatabaseUserSession("elo-first");
  const secondCookie = createDatabaseUserSession("elo-second");
  const firstReplay = eloReplayDocument(
    "e1000000-0000-4000-8000-000000000001",
    {
      gameGUID: "elo-guid-cc-001",
      format: "cc",
      playerName: "  Alice  ",
      opponentName: "Bob",
      result: "victory",
    },
  );
  firstReplay.match.decisionEvents = [];

  const firstUpload = await uploadDocument(firstCookie, firstReplay);
  assert.equal(firstUpload.status, 201);
  const repeatedUpload = await uploadDocument(firstCookie, firstReplay);
  assert.equal(repeatedUpload.status, 200);

  const confirmation = await uploadDocument(secondCookie, eloReplayDocument(
    "e2000000-0000-4000-8000-000000000002",
    {
      gameGUID: "elo-guid-cc-001",
      format: "CC",
      playerName: "Bob",
      opponentName: "ＡＬＩＣＥ",
      result: "defeat",
    },
  ));
  assert.equal(confirmation.status, 201);

  const database = new Database(join(databaseDirectory, "test.sqlite"));
  const ccRatings = database.prepare(`
    SELECT p.normalized_name AS name, r.rating, r.games, r.wins, r.losses
    FROM elo_ratings r
    INNER JOIN talishar_players p ON p.id = r.player_id
    WHERE r.format = 'cc'
    ORDER BY p.normalized_name
  `).all();
  assert.deepEqual(ccRatings, [
    { name: "alice", rating: 1016, games: 1, wins: 1, losses: 0 },
    { name: "bob", rating: 984, games: 1, wins: 0, losses: 1 },
  ]);
  assert.deepEqual(
    database.prepare(`
      SELECT status, rating_change AS ratingChange
      FROM elo_matches WHERE game_guid = 'elo-guid-cc-001'
    `).get(),
    { status: "confirmed", ratingChange: 16 },
  );
  assert.equal(
    database.prepare("SELECT participation FROM replays WHERE source_match_id = ?").get(firstReplay.match.id).participation,
    "watched",
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM elo_matches WHERE game_guid = 'elo-guid-cc-001'").get().count,
    1,
  );
  database.close();

  const concurrentUploads = await Promise.all([
    uploadDocument(firstCookie, eloReplayDocument(
      "e5000000-0000-4000-8000-000000000005",
      {
        gameGUID: "elo-guid-concurrent-001",
        format: "cc",
        playerName: "Charlie",
        opponentName: "Dana",
        result: "victory",
      },
    )),
    uploadDocument(secondCookie, eloReplayDocument(
      "e6000000-0000-4000-8000-000000000006",
      {
        gameGUID: "elo-guid-concurrent-001",
        format: "cc",
        playerName: "Dana",
        opponentName: "Charlie",
        result: "defeat",
      },
    )),
  ]);
  assert.deepEqual(concurrentUploads.map((response) => response.status), [201, 201]);
  const concurrentDatabase = new Database(join(databaseDirectory, "test.sqlite"));
  assert.equal(
    concurrentDatabase.prepare("SELECT COUNT(*) AS count FROM elo_matches WHERE game_guid = 'elo-guid-concurrent-001'").get().count,
    1,
  );
  assert.deepEqual(
    concurrentDatabase.prepare(`
      SELECT r.games, r.wins
      FROM elo_ratings r
      INNER JOIN talishar_players p ON p.id = r.player_id
      WHERE p.normalized_name = 'charlie' AND r.format = 'cc'
    `).get(),
    { games: 1, wins: 1 },
  );
  concurrentDatabase.close();

  const conflicting = await uploadDocument(secondCookie, eloReplayDocument(
    "e3000000-0000-4000-8000-000000000003",
    {
      gameGUID: "elo-guid-cc-001",
      format: "cc",
      playerName: "Bob",
      opponentName: "Alice",
      result: "victory",
    },
  ));
  assert.equal(conflicting.status, 201);

  const blitz = await uploadDocument(firstCookie, eloReplayDocument(
    "e4000000-0000-4000-8000-000000000004",
    {
      gameGUID: "elo-guid-blitz-001",
      format: "blitz",
      playerName: "Alice",
      opponentName: "Bob",
      result: "victory",
    },
  ));
  assert.equal(blitz.status, 201);

  const after = new Database(join(databaseDirectory, "test.sqlite"));
  assert.equal(
    after.prepare("SELECT status FROM elo_matches WHERE game_guid = 'elo-guid-cc-001'").get().status,
    "conflict",
  );
  assert.deepEqual(
    after.prepare(`
      SELECT rating, games FROM elo_ratings r
      INNER JOIN talishar_players p ON p.id = r.player_id
      WHERE p.normalized_name = 'alice' AND r.format = 'cc'
    `).get(),
    { rating: 1016, games: 1 },
  );
  assert.deepEqual(
    after.prepare(`
      SELECT rating, games FROM elo_ratings r
      INNER JOIN talishar_players p ON p.id = r.player_id
      WHERE p.normalized_name = 'alice' AND r.format = 'blitz'
    `).get(),
    { rating: 1016, games: 1 },
  );
  const firstUserId = after.prepare("SELECT id FROM users WHERE username = 'elo-first'").get().id;
  after.close();

  const adminPage = await fetch(new URL("/admin/elo?format=cc", baseUrl), { headers: { cookie } });
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Elo Talishar/);
  assert.match(adminHtml, /Alice/);
  assert.match(adminHtml, />1016</);
  assert.match(adminHtml, /elo-guid-cc-001/);
  assert.match(adminHtml, /vencedor divergente/);
  assert.match(adminHtml, /href="\/admin\/elo"/);

  const forbidden = await fetch(new URL("/admin/elo", baseUrl), {
    headers: { cookie: secondCookie },
    redirect: "manual",
  });
  assert.equal(forbidden.status, 307);
  assert.equal(new URL(forbidden.headers.get("location"), baseUrl).pathname, "/");

  const deleted = await fetch(new URL(`/api/admin/users/${firstUserId}`, baseUrl), {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(deleted.status, 200);
  const preserved = new Database(join(databaseDirectory, "test.sqlite"), { readonly: true });
  assert.equal(preserved.prepare("SELECT COUNT(*) AS count FROM elo_matches WHERE game_guid LIKE 'elo-guid-%'").get().count, 3);
  assert.equal(preserved.prepare("SELECT COUNT(*) AS count FROM elo_ratings").get().count >= 4, true);
  preserved.close();
});

test("accepts a chunked replay body without Content-Length and enforces login limits", async () => {
  const body = JSON.stringify(replayDocument("c3333333-3333-4333-8333-333333333333", true));
  const stream = new ReadableStream({
    start(controller) {
      const bytes = new TextEncoder().encode(body);
      controller.enqueue(bytes.slice(0, Math.floor(bytes.length / 2)));
      controller.enqueue(bytes.slice(Math.floor(bytes.length / 2)));
      controller.close();
    },
  });
  const uploaded = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: stream,
    duplex: "half",
  });
  assert.equal(uploaded.status, 201);

  const headers = {
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.77",
  };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failure = await fetch(new URL("/api/auth/login", baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "rate-limited-user", password: "WrongPassword!123" }),
    });
    assert.equal(failure.status, 401);
  }
  const limited = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "rate-limited-user", password: "WrongPassword!123" }),
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});

test("accepts a valid replay body above the former 10 MB proxy limit", async () => {
  const document = replayDocument("c4444444-4444-4444-8444-444444444444", true);
  document.padding = Array.from({ length: 21 }, () => "x".repeat(512 * 1024));
  const body = JSON.stringify(document);
  assert.ok(Buffer.byteLength(body) > 10 * 1024 * 1024);
  assert.ok(Buffer.byteLength(body) < 50 * 1024 * 1024);

  const uploaded = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body,
  });
  assert.equal(uploaded.status, 201);
});

test("rejects structural replay abuse and paginates from SQLite without reading files", async () => {
  const deepReplay = replayDocument("e4444444-4444-4444-8444-444444444444", true);
  let nested = deepReplay;
  for (let depth = 0; depth < 45; depth += 1) {
    nested.extra = {};
    nested = nested.extra;
  }
  const structuralLimit = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(deepReplay),
  });
  assert.equal(structuralLimit.status, 400);
  assert.equal((await structuralLimit.json()).code, "STRUCTURE_LIMIT");

  const quotaCookie = await createTestUser("quota-user");
  const database = new Database(join(databaseDirectory, "test.sqlite"));
  try {
    database.pragma("foreign_keys = ON");
    const userId = database.prepare("SELECT id FROM users WHERE username = 'quota-user'").get().id;
    const insert = database.prepare(`
      INSERT INTO replays (
        user_id, source_match_id, storage_key, schema_version, status, result,
        started_at, frame_count, size_bytes
      ) VALUES (?, ?, ?, '0.1.0', 'finished', 'victory', ?, 1, 1)
    `);
    database.transaction(() => {
      for (let index = 0; index < 500; index += 1) {
        const prefix = `d${index.toString(16).padStart(7, "0")}`;
        const suffix = index.toString(16).padStart(12, "0");
        insert.run(
          userId,
          `${prefix}-0000-4000-8000-${suffix}`,
          `quota-${index}.json`,
          Date.parse("2026-08-23T12:00:00.000Z"),
        );
      }
    })();
    const filteredReplay = database.prepare("SELECT id FROM replays WHERE user_id = ? ORDER BY id LIMIT 1").get(userId);
    database.prepare("INSERT INTO replay_workspace (replay_id, user_id, note, is_favorite, reviewed_at) VALUES (?, ?, 'fora da primeira página', 1, ?)").run(filteredReplay.id, userId, Date.now());
    const tag = database.prepare("INSERT INTO user_tags (user_id, name, normalized_name) VALUES (?, 'Defesa', 'defesa') RETURNING id").get(userId);
    database.prepare("INSERT INTO replay_tags (replay_id, tag_id) VALUES (?, ?)").run(filteredReplay.id, tag.id);
  } finally {
    database.close();
  }

  const firstPage = await fetch(new URL("/replays", baseUrl), { headers: { cookie: quotaCookie } });
  const firstPageHtml = await firstPage.text();
  assert.equal(replayIdsInHtml(firstPageHtml).size, 25);
  const cursor = firstPageHtml.match(/href="\/replays\?cursor=([^"]+)"/)?.[1];
  assert.ok(cursor);
  const secondPage = await fetch(new URL(`/replays?cursor=${cursor}`, baseUrl), { headers: { cookie: quotaCookie } });
  assert.equal(secondPage.status, 200);
  assert.equal(replayIdsInHtml(await secondPage.text()).size, 25);

  const favoritePage = await fetch(new URL("/replays?workspace=favorites", baseUrl), { headers: { cookie: quotaCookie } });
  const favoriteHtml = await favoritePage.text();
  assert.equal(replayIdsInHtml(favoriteHtml).size, 1);
  assert.match(favoriteHtml, /Tem notas/);
  assert.doesNotMatch(favoriteHtml, /Carregar mais replays/);

  const taggedPage = await fetch(new URL("/replays?tag=DEFESA", baseUrl), { headers: { cookie: quotaCookie } });
  const taggedHtml = await taggedPage.text();
  assert.equal(replayIdsInHtml(taggedHtml).size, 1);
  assert.match(taggedHtml, /Defesa/);

  const quotaResponse = await fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: quotaCookie },
    body: JSON.stringify(replayDocument("f5555555-5555-4555-8555-555555555555", true)),
  });
  assert.equal(quotaResponse.status, 413);
  assert.equal((await quotaResponse.json()).code, "REPLAY_QUOTA_EXCEEDED");
});

function replayDocument(id, complete, startedAt = "2026-08-20T12:00:00.000Z") {
  const finalPayload = {
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
  };
  return {
    schemaVersion: "0.1.0",
    exportedAt: "2026-08-20T12:01:00.000Z",
    match: {
      id,
      schemaVersion: "0.1.0",
      status: complete ? "finished" : "recording",
      startedAt,
      endedAt: complete ? "2026-08-20T12:01:00.000Z" : null,
      frames: [
        {
          sequence: 1,
          receivedAt: startedAt,
          payload: { ...finalPayload, turnNo: "0", turnPhase: { turnPhase: "A" } },
        },
        {
          sequence: 2,
          receivedAt: "2026-08-20T12:01:00.000Z",
          payload: finalPayload,
        },
      ],
    },
  };
}

function eloReplayDocument(id, options) {
  const document = replayDocument(id, true);
  document.match.frames[0].payload.initialLoad = {
    gameFormat: options.format,
    gameGUID: options.gameGUID,
    playerName: options.playerName,
    opponentName: options.opponentName,
    isOpponentAI: false,
  };
  for (const frame of document.match.frames) {
    frame.payload.playerHealth = options.result === "defeat" ? "0" : "5";
    frame.payload.opponentHealth = options.result === "victory" ? "0" : "5";
  }
  return document;
}

function uploadDocument(requestCookie, document) {
  return fetch(new URL("/api/replays", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: requestCookie },
    body: JSON.stringify(document),
  });
}

function decisionReplayDocument(id) {
  const decisionPayload = {
    initialLoad: {
      gameFormat: "cc",
      deckLink: "https://fabrary.net/decks/private-deck",
    },
    turnNo: 1,
    turnPlayer: "1",
    otherPlayer: "2",
    turnPhase: { turnPhase: "A", caption: "Escolha uma ação" },
    havePriority: true,
    priorityPlayer: "1",
    canPassPhase: true,
    playerAP: 1,
    playerPitchCount: 1,
    opponentPitchCount: 0,
    playerHealth: 20,
    opponentHealth: 20,
    playerDeckCount: 40,
    opponentDeckCount: 40,
    playerEquipment: [{ slot: "Hero", cardNumber: "alpha_hero", controller: "1" }],
    opponentEquipment: [{ slot: "Hero", cardNumber: "beta_hero", controller: "2" }],
    playerHand: [
      { cardNumber: "critical_strike_red", controller: "1", action: 3, actionData: "0", pitchValue: 1 },
      { cardNumber: "wounding_blow_blue", controller: "1", action: 3, actionData: "1", pitchValue: 3 },
    ],
    opponentHand: [{ cardNumber: "CardBack" }, { cardNumber: "CardBack" }, { cardNumber: "CardBack" }, { cardNumber: "CardBack" }],
    playerArse: [],
    opponentArse: [],
  };
  return {
    schemaVersion: "0.3.0",
    exportedAt: "2026-08-25T12:01:00.000Z",
    match: {
      id,
      schemaVersion: "0.3.0",
      status: "finished",
      startedAt: "2026-08-25T12:00:00.000Z",
      endedAt: "2026-08-25T12:01:00.000Z",
      frames: [
        {
          sequence: 1,
          receivedAt: "2026-08-25T11:59:59.000Z",
          payload: { ...decisionPayload, turnNo: 0, havePriority: false },
        },
        { sequence: 2, receivedAt: "2026-08-25T12:00:00.000Z", payload: decisionPayload },
        {
          sequence: 3,
          receivedAt: "2026-08-25T12:01:00.000Z",
          payload: {
            ...decisionPayload,
            turnPhase: { turnPhase: "OVER", caption: "Fim" },
            opponentHealth: 0,
          },
        },
      ],
      decisionEvents: [{
        sequence: 1,
        frameSequence: 2,
        occurredAt: "2026-08-25T12:00:01.000Z",
        choice: { action: "3", zone: "MYHAND", identifier: "1" },
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
        frame(9, 1, 1, null, "A", "inválida"),
        frame(10, 1, 1, attack(1, "player_attack_red", 6, 0)),
        frame(11, 1, 1, null),
        frame(12, 2, 2, attack(2, "lethal_attack_red", 4, 1, [{ cardNumber: "last_block_blue", controller: "1" }]), "OVER"),
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
        frame(0, payload(0, 1, 20, null)),
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
  const token = invitationToken(invitation.setupUrl);
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

function createDatabaseUserSession(username) {
  const token = `test-session-${username}-${Date.now()}`;
  const database = new Database(join(databaseDirectory, "test.sqlite"));
  const user = database.prepare(`
    INSERT INTO users (username, role) VALUES (?, 'user') RETURNING id
  `).get(username);
  database.prepare(`
    INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)
  `).run(
    user.id,
    createHash("sha256").update(token).digest("hex"),
    Date.now() + 60 * 60 * 1000,
  );
  database.close();
  return `hyperdriver_session=${token}`;
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

async function waitForDecisionAnalysis(replayId, requestCookie) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL(`/api/replays/${replayId}/analysis`, baseUrl), {
      headers: { cookie: requestCookie },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    if (payload.status !== "pending") return payload;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Decision analysis did not finish.\n${serverOutput}`);
}

async function waitForAnalysisJobState(replayId, expected) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const database = new Database(join(databaseDirectory, "test.sqlite"), { readonly: true });
    try {
      const job = database.prepare(`
        SELECT j.status
        FROM analysis_jobs j
        INNER JOIN replays r ON r.id = j.replay_id
        WHERE r.source_match_id = ?
      `).get(replayId);
      if (job?.status === expected) return job.status;
    } finally {
      database.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Analysis job did not reach ${expected}.\n${serverOutput}`);
}

function getCookie(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return (values[0] ?? response.headers.get("set-cookie"))?.split(";", 1)[0];
}

function invitationToken(url) {
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token");
}

function replayIdsInHtml(html) {
  return new Set([...html.matchAll(/\/replays\/(d[0-9a-f-]{35})\/table/g)].map((match) => match[1]));
}

function readUserAvatar(username) {
  const database = new Database(join(databaseDirectory, "test.sqlite"), { readonly: true });
  try {
    return database
      .prepare("SELECT avatar_card_id AS avatarCardId FROM users WHERE username = ?")
      .get(username)?.avatarCardId ?? null;
  } finally {
    database.close();
  }
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
