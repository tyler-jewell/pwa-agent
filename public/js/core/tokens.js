/**
 * Deterministic token estimate (README FP7):
 * estimateTokens(text) = max(1, ceil(utf16Length(text) / 4))
 */
export function estimateTokens(text) {
  const s = text == null ? "" : String(text);
  const len = s.length; // UTF-16 code units
  return Math.max(1, Math.ceil(len / 4));
}

/** Sum tokens across message contents + optional system/MEMORY. */
export function estimateMessagesTokens(messages, extraTexts = []) {
  let t = 0;
  for (const m of messages || []) t += estimateTokens(m.content || "");
  for (const x of extraTexts) t += estimateTokens(x || "");
  return t;
}
