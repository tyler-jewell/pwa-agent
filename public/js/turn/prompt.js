/** Build turn prompt: identity + MEMORY head + budgeted transcript. */
import { IDENTITY_SYSTEM } from "../core/schema.js";
import { estimateTokens } from "../core/tokens.js";

/**
 * @param {{ memoryContent: string, messages: object[], contextWindowTokens: number }} opts
 */
export function buildPrompt({ memoryContent, messages, contextWindowTokens }) {
  const W = contextWindowTokens || 2048;
  const identity = IDENTITY_SYSTEM;
  const memoryBlock = `--- MEMORY.md (always injected) ---\n${memoryContent || ""}\n--- end MEMORY.md ---`;
  const system = `${identity}\n\n${memoryBlock}`;

  // Reserve ~30% for completion + system
  const budget = Math.max(256, Math.floor(W * 0.55));
  const sysTokens = estimateTokens(system);
  let remaining = Math.max(64, budget - sysTokens);

  const chronological = (messages || []).filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "summary"
  );
  const picked = [];
  for (let i = chronological.length - 1; i >= 0; i--) {
    const m = chronological[i];
    const t = estimateTokens(m.content || "");
    if (t > remaining && picked.length) break;
    picked.unshift({ role: m.role === "summary" ? "user" : m.role, content: m.content });
    remaining -= t;
  }

  return { system, messages: picked, T_sys: sysTokens };
}
