import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, devices } from "playwright";

function readOptions(args) {
  const options = { route: "/", mobile: false, name: undefined, scenario: undefined };
  let hasRoute = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--mobile") {
      options.mobile = true;
    } else if (arg === "--name" || arg === "--scenario") {
      const value = args[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      options[arg.slice(2)] = value;
    } else if (arg.startsWith("--") || hasRoute) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      options.route = arg;
      hasRoute = true;
    }
  }
  if (options.name && !/^[a-zA-Z0-9_-]+$/.test(options.name)) {
    throw new Error("--name must contain only letters, numbers, underscores or hyphens");
  }
  return options;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const baseURL = process.env.BROWSER_BASE_URL || "https://beta.hyperdriver.com.br";
  const url = new URL(options.route, baseURL);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  const mode = options.mobile ? "mobile" : "desktop";
  const routeName = url.pathname.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "home";
  const name = options.name || `${routeName}-${mode}`;
  const outputDirectory = process.env.BROWSER_OUTPUT_DIR || "/output";
  await mkdir(outputDirectory, { recursive: true });

  const report = {
    requestedUrl: url.href,
    mode,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
  };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    ...(options.mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 }),
    locale: "pt-BR",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("requestfailed", (request) => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => {
    if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() });
  });

  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const response = await page.goto(url.href, { waitUntil: "load" });
    report.status = response?.status() ?? null;
    if (options.scenario) {
      const scenario = await import(pathToFileURL(path.resolve(options.scenario)).href);
      await scenario.default({ page, context, browser });
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outputDirectory, `${name}.png`), fullPage: true, animations: "disabled", caret: "initial" });
    await writeFile(path.join(outputDirectory, `${name}.html`), await page.content());
    report.finalUrl = page.url();
    report.title = await page.title();
    report.viewport = page.viewportSize();
    if (report.status >= 400) process.exitCode = 1;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    try {
      await context.tracing.stop({ path: path.join(outputDirectory, `${name}-trace.zip`) });
    } finally {
      await browser.close();
      await writeFile(path.join(outputDirectory, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ ...report, artifacts: `/outputs/browser/${name}` }, null, 2));
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
