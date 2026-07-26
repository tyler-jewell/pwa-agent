/**
 * Brand identity: Progressive Web Agent (pwa).
 * Drives shipped schema validators — not a reimplementation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateExportBundle,
  IDENTITY_SYSTEM,
} from "../public/js/core/schema.js";
import { buildExportBundle } from "../public/js/core/export.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Progressive Web Agent brand (pwa)", () => {
  it("export app identity is pwa via shipped buildExportBundle", () => {
    const memoryStore = {
      snapshot: () => ({
        memoryHeadId: "mv_1",
        versions: [
          {
            id: "mv_1",
            createdAt: "2026-01-01T00:00:00.000Z",
            content: "# Memory\n",
            source: "seed",
            parentId: null,
            summaryWhy: "",
            diffFromParent: { added: [], removed: [] },
          },
        ],
      }),
    };
    const transcript = {
      snapshot: () => ({ messages: [], updatedAt: "2026-01-01T00:00:00.000Z" }),
    };
    const registry = {
      getPreferred: () => ({ backendId: "mock", id: "m1" }),
      snapshot: () => [],
    };
    const bundle = buildExportBundle({ memoryStore, transcript, registry });
    assert.equal(bundle.app, "pwa");
    assert.equal(validateExportBundle(bundle), null);
  });

  it("accepts legacy export app id for migration only", () => {
    const legacy = {
      schemaVersion: 1,
      app: "pwa-agent",
      memoryVersions: [],
      transcript: { messages: [] },
    };
    assert.equal(validateExportBundle(legacy), null);
  });

  it("rejects unknown app ids", () => {
    const bad = {
      schemaVersion: 1,
      app: "other",
      memoryVersions: [],
      transcript: { messages: [] },
    };
    assert.match(validateExportBundle(bad) || "", /app must be pwa/);
  });

  it("identity system prompt names Progressive Web Agent", () => {
    assert.match(IDENTITY_SYSTEM, /Progressive Web Agent/);
    assert.match(IDENTITY_SYSTEM, /\(pwa\)/);
  });

  it("package.json name is pwa", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.name, "pwa");
  });

  it("manifest and index brand Progressive Web Agent / pwa", () => {
    const man = JSON.parse(
      readFileSync(join(root, "public/manifest.webmanifest"), "utf8")
    );
    assert.equal(man.name, "Progressive Web Agent");
    assert.equal(man.short_name, "pwa");
    const html = readFileSync(join(root, "public/index.html"), "utf8");
    assert.match(html, /<title>Progressive Web Agent<\/title>/);
    assert.match(html, /<strong>Progressive Web Agent<\/strong>/);
  });

  it("README lead states day-one goals including army crew", () => {
    const md = readFileSync(join(root, "README.md"), "utf8");
    const lead = md.slice(0, 3500);
    assert.match(lead, /Progressive Web Agent/);
    assert.match(lead, /`pwa`/);
    assert.match(lead, /[Pp]rogressively load models|tiny.*model|tinier/i);
    assert.match(lead, /[Mm]EMORY|self-improve/i);
    assert.match(lead, /[Cc]reate other agents/i);
    assert.match(lead, /[Tt]ransparent|main agent feed|feed/i);
    assert.match(lead, /Army of small smart people/i);
    assert.match(lead, /handoff/i);
    assert.match(lead, /honest report/i);
  });

  it("identity prompt includes honest capability-aware crew language", () => {
    assert.match(IDENTITY_SYSTEM, /army of small smart people/i);
    assert.match(IDENTITY_SYSTEM, /hand off/i);
    assert.match(IDENTITY_SYSTEM, /honestly/i);
  });
});
