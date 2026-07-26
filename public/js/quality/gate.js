/**
 * Browser-only pre-commit quality gate (README).
 * runQualityGate() → { ok, results, manual }
 */
import { runSelfTests, checkCorePurityFromText } from "./selftests.js";
import { createFolderBind } from "./folder.js";

const MANUAL = [
  "Auto section has zero fails (ok === true).",
  "CHANGELOG.md → ## Unreleased describes this change.",
  "Roadmap ticks only if acceptance truly passed.",
  "No silent memory/reflect failure paths.",
  "Stream path still non-blocking.",
  "Core purity (vendor only in adapters/).",
  "No hardcoded model catalog.",
  "Platform work followed Standards URLs.",
  "AGENTS.md still valid process law.",
  "Browser self-tests cover new pure logic.",
  "No secrets / telemetry / mandatory cloud chat.",
  "Optional host git: clean status; commit message names phase/FP.",
  "UI: keyboard path for chat / MEMORY / run tree.",
];

const folder = createFolderBind();

export function getFolderBind() {
  return folder;
}

export async function runQualityGate({ bindFolder = false } = {}) {
  const results = [];
  const ts = new Date().toISOString();
  results.push({ level: "ok", message: `Quality report @ ${ts}` });

  if (!folder.isBound()) {
    try {
      const restored = await folder.tryRestore?.();
      if (restored) {
        results.push({ level: "ok", message: "Restored project folder handle" });
      }
    } catch {
      /* ignore */
    }
  }

  if (bindFolder && !folder.isBound()) {
    try {
      await folder.bind();
    } catch (e) {
      results.push({ level: "warn", message: `Folder bind skipped: ${e.message || e}` });
    }
  }

  // Contract self-tests always (includes purity fetch without folder)
  const self = await runSelfTests();
  results.push(...self);

  if (!folder.isBound()) {
    results.push({
      level: "warn",
      message: "File-scan checks skipped — bind project folder (Quality with folder / File System Access)",
    });
  } else {
    await runFolderChecks(results);
  }

  // Identity note
  results.push({
    level: "ok",
    message: "Identity: git history is release identity — no product version spam",
  });

  const ok = !results.some((r) => r.level === "fail");
  return { ok, results, manual: MANUAL.slice() };
}

async function runFolderChecks(results) {
  const hasReadme = await folder.exists(["README.md"]);
  const hasAgents = await folder.exists(["AGENTS.md"]);
  if (hasReadme && hasAgents) results.push({ level: "ok", message: "Required docs: README.md + AGENTS.md" });
  else results.push({ level: "fail", message: "Missing README.md or AGENTS.md at project root" });

  if (await folder.hasDocsTree()) {
    results.push({ level: "fail", message: "Forbidden docs/ tree present" });
  } else {
    results.push({ level: "ok", message: "No docs/ tree" });
  }

  try {
    const agents = await folder.readText(["AGENTS.md"]);
    const lines = agents.split(/\n/).length;
    if (lines > 400) results.push({ level: "fail", message: `AGENTS.md exceeds 400 lines (${lines})` });
    else results.push({ level: "ok", message: `AGENTS.md line count ${lines} ≤ 400` });
    const need = ["README.md", "Browser", "Vercel", "quality", "live"];
    for (const n of need) {
      if (!agents.includes(n)) results.push({ level: "warn", message: `AGENTS may miss topic: ${n}` });
    }
  } catch {
    results.push({ level: "fail", message: "Cannot read AGENTS.md" });
  }

  try {
    const readme = await folder.readText(["README.md"]);
    for (const n of [
      "First principles",
      "Public-complete roadmap",
      "Pre-commit",
      "ModelRecord",
      "chat-agent",
      "Standards",
      "contracts",
    ]) {
      if (!readme.toLowerCase().includes(n.toLowerCase())) {
        results.push({ level: "fail", message: `README missing section cue: ${n}` });
      }
    }
    results.push({ level: "ok", message: "README standards cues present" });
  } catch {
    results.push({ level: "fail", message: "Cannot read README.md" });
  }

  try {
    const cl = await folder.readText(["CHANGELOG.md"]);
    if (/##\s+Unreleased/i.test(cl)) results.push({ level: "ok", message: "CHANGELOG.md has ## Unreleased" });
    else results.push({ level: "fail", message: "CHANGELOG.md missing ## Unreleased" });
  } catch {
    results.push({ level: "warn", message: "CHANGELOG.md not readable (create if write allowed)" });
  }

  const sources = await folder.scanSources();
  for (const s of sources) {
    if (s.lines > 280) {
      results.push({ level: "fail", message: `Max lines: ${s.path} has ${s.lines} > 280` });
    }
    if (/\s+$/m.test(s.text) && !s.text.match(/\r\n/)) {
      // trailing whitespace on a line
      const bad = s.text.split(/\n/).some((ln, i, arr) => i < arr.length - 1 && /\s+$/.test(ln));
      if (bad) results.push({ level: "warn", message: `Trailing whitespace: ${s.path}` });
    }
    if (!s.text.endsWith("\n")) {
      results.push({ level: "warn", message: `Missing final newline: ${s.path}` });
    }
    const purity = checkCorePurityFromText(s.path, s.text);
    if (purity) results.push({ level: "fail", message: purity });
  }
  if (sources.length) {
    results.push({ level: "ok", message: `Scanned ${sources.length} source files for line limit + purity` });
  }

  // Hardcoded catalog smell in app (not adapters)
  for (const s of sources) {
    if (/adapters\//.test(s.path)) continue;
    if (/MODEL_CATALOG\s*=|hardcoded model catalog/i.test(s.text)) {
      results.push({ level: "fail", message: `Possible hardcoded catalog: ${s.path}` });
    }
  }
}
