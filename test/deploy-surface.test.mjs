/**
 * One-click Vercel deploy footing — drives shipped validators + live poll.
 * No secrets required for Deploy Button path (FP12 / continuous deploy).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateVersionManifest } from "../public/js/core/schema.js";
import { createVersionPoll } from "../public/js/live/poll.js";
import { on, EVT } from "../public/js/core/events.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function memStorage() {
  const m = new Map();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => {
      m.set(k, v);
    },
  };
}

describe("Deploy Button / continuous deploy surface", () => {
  it("version.json validates via shipped validateVersionManifest", () => {
    const raw = readFileSync(join(root, "public/version.json"), "utf8");
    const data = JSON.parse(raw);
    assert.equal(validateVersionManifest(data), null);
    assert.ok(data.buildId);
    assert.ok(data.changelog?.summary);
  });

  it("vercel.json rewrites static public + protects api paths", () => {
    const v = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
    assert.equal(v.version, 2);
    const dests = (v.rewrites || []).map((r) => r.destination).join(" ");
    assert.match(dests, /public/);
    const sources = (v.rewrites || []).map((r) => r.source).join(" ");
    assert.match(sources, /api/);
  });

  it("api push stubs exist and document zero-secret / degrade path", () => {
    const sub = readFileSync(join(root, "api/subscribe.js"), "utf8");
    const notify = readFileSync(join(root, "api/notify-version.js"), "utf8");
    assert.match(sub, /Deploy Button|no secrets|optional/i);
    assert.match(notify, /vapid-not-configured|VAPID/);
    assert.match(notify, /skipped/);
    assert.ok(existsSync(join(root, "api/_push-store.js")));
  });

  it("README Deploy Button uses clone URL and no required secrets language", () => {
    const md = readFileSync(join(root, "README.md"), "utf8");
    assert.match(md, /vercel\.com\/new\/clone/);
    assert.match(
      md,
      /without required env|without required secrets|No mandatory build secrets/i
    );
    assert.match(md, /VAPID keys optional/i);
  });

  it(".env.example marks push env as optional only", () => {
    const env = readFileSync(join(root, ".env.example"), "utf8");
    assert.match(env, /Optional/i);
    assert.match(env, /VAPID/);
    assert.ok(!/REQUIRED/.test(env));
  });

  it("package.json has zero install deps (static PWA)", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.dependencies, undefined);
    assert.ok(pkg.scripts?.start || pkg.scripts?.serve);
  });

  it("createVersionPoll detects new buildId and emits update-dismiss (FP11)", async () => {
    const storage = memStorage();
    let buildId = "build-a";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        buildId,
        createdAt: "2026-01-01T00:00:00.000Z",
        channel: "prod",
        changelog: { summary: buildId, full: buildId },
      }),
    });

    const updates = [];
    const off = on(EVT.UPDATE, (d) => updates.push(d));

    const poll = createVersionPoll({
      url: "/version.json",
      intervalMs: 999999,
      storage,
    });
    await poll.loadSeen();
    const first = await poll.check({ isFullLoad: false });
    assert.equal(first.changed, false);
    assert.equal(first.manifest.buildId, "build-a");
    assert.equal(poll.lastSeen, "build-a");

    buildId = "build-b";
    const second = await poll.check({ isFullLoad: false });
    assert.equal(second.changed, true);
    assert.equal(second.manifest.buildId, "build-b");
    assert.equal(second.mode, "update-dismiss");
    assert.ok(updates.some((u) => u.mode === "update-dismiss"));

    await poll.markUpdated("build-b");
    assert.equal(poll.lastSeen, "build-b");
    const third = await poll.check({ isFullLoad: false });
    assert.equal(third.changed, false);

    off();
    delete globalThis.fetch;
  });

  it("full-load with newer build uses dismiss-only mode", async () => {
    const storage = memStorage();
    await storage.set("lastSeenBuildId", "old");
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        buildId: "new-build",
        createdAt: "2026-01-02T00:00:00.000Z",
        channel: "prod",
        changelog: { summary: "new", full: "new" },
      }),
    });
    const poll = createVersionPoll({ storage });
    await poll.loadSeen();
    const r = await poll.check({ isFullLoad: true });
    assert.equal(r.changed, true);
    assert.equal(r.mode, "dismiss-only");
    assert.equal(poll.lastSeen, "new-build");
    delete globalThis.fetch;
  });

  it("main.js wires version poll + soft-reset (structural continuous path)", () => {
    const main = readFileSync(join(root, "public/js/main.js"), "utf8");
    assert.match(main, /createVersionPoll/);
    assert.match(main, /createSoftReset/);
    assert.match(main, /softApplied/);
    assert.match(main, /createUpdateBanner/);
  });

  it("git tracks public/, test/, vercel.json (Deploy Button clone surface)", () => {
    // Fail if the PWA is only local untracked — clone would 404.
    assert.ok(existsSync(join(root, "public/index.html")));
    assert.ok(existsSync(join(root, "vercel.json")));
    const tracked = execSync(
      "git ls-files public vercel.json package.json api test",
      { cwd: root, encoding: "utf8" }
    );
    assert.match(tracked, /public\/index\.html/);
    assert.match(tracked, /public\/version\.json/);
    assert.match(tracked, /vercel\.json/);
    assert.match(tracked, /package\.json/);
    assert.match(tracked, /api\/subscribe\.js/);
    assert.match(tracked, /test\/deploy-surface\.test\.mjs/);
  });
});
