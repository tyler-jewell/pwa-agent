/**
 * Optional rehydrate helper (durable state only).
 * Soft-reset Update path uses cache-bust navigation so new JS loads;
 * this module remains for console remount / tests — never a substitute for
 * loading a new module graph after deploy.
 */
export async function runSoftApply({ remount, buildId }) {
  if (typeof remount !== "function") {
    throw new Error("remount required");
  }
  await remount({ buildId });
}
