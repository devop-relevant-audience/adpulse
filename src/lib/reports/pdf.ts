// Server-side PDF rendering: a headless Chrome opens the app's own print page
// (`/print/reports/[id]?t=<signed token>`) and Chrome writes the PDF. Nothing
// here knows what a report looks like — the print page owns the layout and its
// own `@page` rules, which `preferCSSPageSize` then honours.
//
// Two Chrome sources, picked at runtime and loaded with dynamic `import()` so
// neither is pulled into the other environment's bundle:
//   - Vercel / production: `puppeteer-core` + the `@sparticuz/chromium` binary.
//   - Local dev: the full `puppeteer` package's downloaded Chrome, or the
//     binary at PUPPETEER_EXECUTABLE_PATH when that is set.

import type { Browser } from "puppeteer-core";

/** A launch or render failure. The message is safe to return to the caller. */
export class ReportPdfError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReportPdfError";
  }
}

// A4 at 96dpi — matches the print page's own page box, so what Chrome lays out
// on screen is what it paginates.
const VIEWPORT = { width: 794, height: 1123 };
const NAVIGATION_TIMEOUT_MS = 30_000;
const PRINT_READY_TIMEOUT_MS = 10_000;
const SETTLE_MS = 250;
// Below the route's maxDuration (60s) so a hung CDP call fails with a message
// instead of the function budget silently running out.
const PROTOCOL_TIMEOUT_MS = 50_000;

// One browser per warm function instance: launching Chromium costs seconds, so
// it is reused across requests and only relaunched once it has disconnected.
let browserPromise: Promise<Browser> | null = null;

function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

async function launchBrowser(): Promise<Browser> {
  const { default: puppeteerCore } = await import("puppeteer-core");

  // An explicit binary wins everywhere — including a local `npm run start`,
  // where NODE_ENV is production but the Lambda-built @sparticuz binary is not
  // what this machine should run.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (executablePath) {
    return puppeteerCore.launch({ defaultViewport: VIEWPORT, executablePath, headless: true, protocolTimeout: PROTOCOL_TIMEOUT_MS });
  }

  if (isServerlessRuntime()) {
    const { default: chromium } = await import("@sparticuz/chromium");
    // The bundled binary is chrome-headless-shell, so it must be launched in
    // "shell" mode with the args the package prescribes for the runtime.
    return puppeteerCore.launch({
      args: await puppeteerCore.defaultArgs({ args: chromium.args, headless: "shell" }),
      defaultViewport: VIEWPORT,
      executablePath: await chromium.executablePath(),
      headless: "shell",
      protocolTimeout: PROTOCOL_TIMEOUT_MS,
    });
  }

  // Dev only: the full package resolves the Chrome it downloaded on install.
  const { default: puppeteer } = await import("puppeteer");
  return puppeteer.launch({ defaultViewport: VIEWPORT, headless: true, protocolTimeout: PROTOCOL_TIMEOUT_MS });
}

async function getBrowser(): Promise<Browser> {
  const pending = browserPromise;
  if (pending) {
    try {
      const browser = await pending;
      if (browser.connected) return browser;
    } catch {
      // A failed launch must not poison every later request — fall through.
    }
    // Only clear what we awaited: a concurrent caller may already have stored
    // a newer launch here, and nulling it would orphan that Chrome process.
    if (browserPromise === pending) browserPromise = null;
  }

  const next = launchBrowser().catch((error: unknown) => {
    browserPromise = null;
    throw new ReportPdfError("Could not start the PDF renderer", { cause: error });
  });
  browserPromise = next;
  return next;
}

/**
 * Loads `url` in headless Chrome and returns the printed PDF bytes.
 *
 * The page signals it has finished laying out (charts included) by setting
 * `html[data-print-ready="true"]`; if that never arrives we print anyway rather
 * than fail, so a regression in the page degrades the PDF instead of blocking
 * it. No margin is passed: `preferCSSPageSize` hands sizing to the page's own
 * `@page` rule.
 */
export async function renderReportPdf({ url }: { url: string }): Promise<Uint8Array> {
  const browser = await getBrowser();
  let page: Awaited<ReturnType<Browser["newPage"]>> | null = null;

  try {
    page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.emulateMediaType("print");

    // Vercel Authentication walls off *.vercel.app deployment URLs, including
    // production until a custom domain exists. Vercel injects this secret once
    // "Protection Bypass for Automation" is enabled on the project; sending it
    // lets our own browser through without weakening the protection.
    const automationSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (automationSecret) {
      await page.setExtraHTTPHeaders({ "x-vercel-protection-bypass": automationSecret });
    }

    // `load` (scripts + stylesheets), not `networkidle0`: the page inherits the
    // root layout's ClerkProvider, whose session handshake — and, in dev,
    // Turbopack's HMR socket — can hold a connection open for the whole
    // navigation timeout. The readiness selector below is the real gate.
    const response = await page.goto(url, {
      waitUntil: "load",
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    const status = response?.status();
    if (status !== undefined && status >= 400) {
      throw new ReportPdfError(`The print page returned HTTP ${status}`);
    }

    await page
      .waitForSelector('html[data-print-ready="true"]', { timeout: PRINT_READY_TIMEOUT_MS })
      .catch(() => undefined);

    // Awaited inside the page so the FontFaceSet itself is never serialized back.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } catch (error) {
    if (error instanceof ReportPdfError) throw error;
    throw new ReportPdfError("Could not render the report PDF", { cause: error });
  } finally {
    await page?.close().catch(() => undefined);
  }
}
