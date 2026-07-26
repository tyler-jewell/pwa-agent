/**
 * Honest outcome report — achieved vs not-achieved (FP16).
 * Never marks success without evidence of done items.
 * Pure — no DOM.
 */

/**
 * Build honest report from final task state.
 * @param {object} state
 * @param {object} [meta]
 */
export function buildHonestReport(state, meta = {}) {
  const items = state?.items || [];
  const achieved = items
    .filter((i) => i.status === "done")
    .map((i) => ({ id: i.id, title: i.title || i.id }));
  const notAchieved = items
    .filter((i) => i.status !== "done")
    .map((i) => ({
      id: i.id,
      title: i.title || i.id,
      why: whyNot(i, state),
    }));

  const allDone = items.length > 0 && notAchieved.length === 0;
  const forced = state?.status === "exhausted" || state?.status === "stopped";
  let status = "incomplete";
  if (allDone && !forced) status = "complete";
  else if (state?.status === "exhausted") status = "exhausted";
  else if (state?.status === "stopped") status = "stopped";
  else if (allDone) status = "complete";

  // Never claim complete if any item is not done
  if (notAchieved.length > 0 && status === "complete") {
    status = "incomplete";
  }

  const summary = formatSummary({ status, achieved, notAchieved, state, meta });

  return {
    status,
    achieved,
    notAchieved,
    stepsUsed: state?.step ?? 0,
    handoffCount: (state?.handoffs || []).length,
    maxSteps: state?.maxSteps ?? null,
    goal: state?.goal || "",
    honest: true,
    complete: status === "complete" && notAchieved.length === 0,
    summary,
    meta: { ...meta },
  };
}

function whyNot(item, state) {
  if (item.note) return item.note;
  if (item.status === "blocked") return item.why || "blocked";
  if (state?.status === "exhausted") {
    return "step or context budget exhausted before this item finished";
  }
  if (state?.status === "stopped") return "loop stopped before completion";
  if (item.status === "pending") return "still pending when loop ended";
  return "not completed";
}

function formatSummary({ status, achieved, notAchieved, state, meta }) {
  const lines = [
    `Outcome: ${status}`,
    `Goal: ${state?.goal || "(none)"}`,
    `Achieved (${achieved.length}): ${
      achieved.length ? achieved.map((a) => a.title).join("; ") : "—"
    }`,
    `Not achieved (${notAchieved.length}): ${
      notAchieved.length
        ? notAchieved.map((n) => `${n.title} (${n.why})`).join("; ")
        : "—"
    }`,
    `Steps: ${state?.step ?? 0}/${state?.maxSteps ?? "?"}`,
    `Handoffs: ${(state?.handoffs || []).length}`,
  ];
  if (meta?.lastModelId) lines.push(`Last model: ${meta.lastModelId}`);
  return lines.join("\n");
}

/**
 * Format report for chat transcript (human-readable).
 */
export function formatReportForChat(report) {
  if (!report) return "No report.";
  return report.summary || buildHonestReport({ items: [] }).summary;
}
