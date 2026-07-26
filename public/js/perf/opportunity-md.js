/** MEMORY markdown section helpers for performance-manager. */

export const SECTION_OPP = "## Areas of opportunity";
export const SECTION_INSTR = "## Standing instructions";

export function extractSection(content, heading) {
  const idx = content.indexOf(heading);
  if (idx < 0) return null;
  const rest = content.slice(idx + heading.length);
  const next = rest.search(/\n## /);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

export function upsertSection(content, heading, sectionBody) {
  const body = sectionBody.trim() + "\n";
  const idx = content.indexOf(heading);
  if (idx < 0) {
    const base = content.trimEnd();
    return (base ? base + "\n\n" : "") + body;
  }
  const before = content.slice(0, idx);
  const rest = content.slice(idx + heading.length);
  const next = rest.search(/\n## /);
  const after = next < 0 ? "" : rest.slice(next);
  return before + body + (after.startsWith("\n") ? after.slice(1) : after);
}

export function renderOpportunitySection(opportunities) {
  const lines = [
    SECTION_OPP,
    "",
    "_Latest improvement targets. Maintained by performance-manager. Progress is tracked over refreshes; mature items may be promoted to Standing instructions after approval._",
    "",
  ];
  if (!opportunities.length) {
    lines.push("_No open opportunities yet._", "");
    return lines.join("\n");
  }
  for (const o of opportunities) {
    lines.push(`### ${o.id} | ${o.agentId} | ${o.title}`);
    lines.push(`- status: ${o.status}`);
    lines.push(`- attempts: ${o.attempts}`);
    lines.push(`- baseline: ${o.baseline}`);
    lines.push(`- lastScore: ${o.lastScore}`);
    lines.push(`- scores: ${(o.scores || []).join(",") || "-"}`);
    lines.push(`- evidence: ${o.evidence?.trim() ? o.evidence : "-"}`);
    lines.push(`- createdAt: ${o.createdAt?.trim() ? o.createdAt : "-"}`);
    lines.push(`- updatedAt: ${o.updatedAt?.trim() ? o.updatedAt : "-"}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderInstructionsSection(map) {
  const lines = [
    SECTION_INSTR,
    "",
    "_Promoted from Areas of opportunity after performance-manager recommendation + user approval._",
    "",
  ];
  const keys = Object.keys(map).sort();
  if (!keys.length) {
    lines.push("_None yet._", "");
    return lines.join("\n");
  }
  for (const agentId of keys) {
    lines.push(`### ${agentId}`);
    for (const b of map[agentId]) lines.push(`- ${b}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function parseOpportunityBlocks(section) {
  if (!section) return [];
  const blocks = section.split(/\n(?=### )/).filter((b) => b.trim().startsWith("### "));
  const out = [];
  for (const block of blocks) {
    const header = block.split("\n")[0] || "";
    const m = header.match(/^###\s+([^|]+)\|([^|]+)\|(.+)$/);
    if (!m) continue;
    // [ \t]* only — never \s* (would swallow newlines on empty values)
    const fields = Object.fromEntries(
      [...block.matchAll(/^- (\w+):[ \t]*(.*)$/gm)].map((x) => [
        x[1],
        (x[2] || "").trim(),
      ])
    );
    const scores = (fields.scores || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    out.push({
      id: m[1].trim(),
      agentId: m[2].trim(),
      title: m[3].trim(),
      status: fields.status || "open",
      attempts: Number(fields.attempts) || scores.length || 0,
      baseline: Number(fields.baseline) || scores[0] || 0,
      lastScore: Number(fields.lastScore) || scores[scores.length - 1] || 0,
      scores,
      evidence: fields.evidence || "",
      createdAt: fields.createdAt || "",
      updatedAt: fields.updatedAt || "",
    });
  }
  return out;
}

export function parseInstructionMap(section) {
  if (!section) return {};
  /** @type {Record<string, string[]>} */
  const map = {};
  let current = null;
  for (const line of section.split("\n")) {
    const h = line.match(/^###\s+(.+)$/);
    if (h) {
      current = h[1].trim();
      map[current] = map[current] || [];
      continue;
    }
    const b = line.match(/^- (.+)$/);
    if (b && current) map[current].push(b[1].trim());
  }
  return map;
}
