// @ts-check
const { test, expect } = require("@playwright/test");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO = path.resolve(__dirname, "../..");

/**
 * Start msa web with controllable loopback stream.
 * @returns {Promise<{proc: import('child_process').ChildProcess, dataRoot: string, base: string}>}
 */
async function startServer() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "msa-browser-"));
  const port = String(7500 + Math.floor(Math.random() * 400));
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    MSA_WEB_BACKEND: "loopback",
    MSA_WEB_DATA_ROOT: dataRoot,
    MSA_WEB_STREAM_DELAY_MS: "100",
  };
  const proc = spawn(
    "cargo",
    ["run", "-q", "-p", "msa", "--", "web", "--bind", `127.0.0.1:${port}`, "--agent", "admin-agent"],
    { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  let booted = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) {
        booted = true;
        break;
      }
    } catch (_) {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!booted) {
    proc.kill("SIGKILL");
    throw new Error("msa web failed to boot on " + port);
  }
  return { proc, dataRoot, base };
}

function stopServer(proc, dataRoot) {
  try {
    proc.kill("SIGTERM");
  } catch (_) {
    /* ignore */
  }
  try {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
}

test.describe.configure({ mode: "serial" });

test("enter sends, clears compose, thinking then stream", async ({ page }) => {
  const { proc, dataRoot, base } = await startServer();
  try {
    await page.goto(`${base}/a/admin-agent`);
    await page.waitForFunction(() => window.__msaChatReady === true);

    const input = page.locator("#compose-input");
    await input.fill("browser enter token");
    await input.press("Enter");

    await expect(input).toHaveValue("");
    await expect(page.locator('.bubble.user .body').filter({ hasText: "browser enter token" })).toBeVisible();

    // Thinking… must appear before tokens finish (stream delay keeps it visible briefly).
    await expect(page.locator('.bubble.agent .body[data-thinking="1"]')).toBeVisible({
      timeout: 5000,
    });

    await expect(
      page.locator('.bubble.agent .body').filter({ hasText: "Received: browser enter token" })
    ).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.bubble.agent .body[data-thinking="1"]')).toHaveCount(0);
    await expect(input).toHaveValue("");
  } finally {
    stopServer(proc, dataRoot);
  }
});

test("mic mock writes transcript into compose", async ({ page }) => {
  const { proc, dataRoot, base } = await startServer();
  try {
    await page.addInitScript(() => {
      class MockSR {
        constructor() {
          this.onresult = null;
          this.onend = null;
          this.onerror = null;
          this.continuous = false;
          this.interimResults = false;
          this.lang = "en-US";
        }
        start() {
          const self = this;
          setTimeout(() => {
            if (self.onresult) {
              self.onresult({
                results: [[{ transcript: "mic-hello-xyz" }]],
              });
            }
            if (self.onend) self.onend();
          }, 20);
        }
        stop() {}
        abort() {}
      }
      window.SpeechRecognition = MockSR;
      window.webkitSpeechRecognition = MockSR;
    });

    await page.goto(`${base}/a/admin-agent`);
    await page.waitForFunction(() => window.__msaSpeechReady === true);

    const input = page.locator("#compose-input");
    await page.locator("#mic-btn").click();
    await expect(input).toHaveValue(/mic-hello-xyz/, { timeout: 5000 });
    // listening class should clear after onend
    await expect(page.locator("#mic-btn.listening")).toHaveCount(0, { timeout: 5000 });
  } finally {
    stopServer(proc, dataRoot);
  }
});

test("stream tokens grow agent bubble", async ({ page }) => {
  const { proc, dataRoot, base } = await startServer();
  try {
    await page.goto(`${base}/a/admin-agent`);
    await page.waitForFunction(() => window.__msaChatReady === true);
    await page.locator("#compose-input").fill("chunk growth check");
    await page.locator("#send-btn").click();

    await expect(page.locator('.bubble.agent .body[data-thinking="1"]')).toBeVisible({
      timeout: 5000,
    });

    // After first token, thinking attribute clears and body contains Received
    await page.waitForFunction(() => {
      const bodies = [...document.querySelectorAll('.bubble.agent .body')];
      const last = bodies[bodies.length - 1];
      if (!last) return false;
      if (last.getAttribute("data-thinking") === "1") return false;
      return (last.textContent || "").includes("Received");
    }, null, { timeout: 15000 });

    await expect(
      page.locator('.bubble.agent .body').filter({ hasText: "Received: chunk growth check" })
    ).toBeVisible({ timeout: 10000 });
  } finally {
    stopServer(proc, dataRoot);
  }
});
