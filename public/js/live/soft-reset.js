/**
 * Soft-reset (Update CTA) — FP11:
 * abort streams → SW update → activate waiting worker → cache-bust navigate
 * so the browser loads the latest JS/CSS. Durable MEMORY/transcript rehydrate
 * from IndexedDB on boot (never wiped).
 *
 * In-place remount alone does not apply new module graphs; navigation is required.
 */
export function createSoftReset({ chatAgent, onBeforeReload } = {}) {
  let resetting = false;

  async function updateSw() {
    if (!("serviceWorker" in navigator)) return { reg: null, waiting: null };
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
      return { reg: reg || null, waiting: reg?.waiting || null };
    } catch {
      return { reg: null, waiting: null };
    }
  }

  /**
   * Apply latest assets. Resolves only if navigation cannot start (error path).
   * On success the document unloads via location.replace.
   * @returns {{ ok: true, navigated: true } | { ok: false, error: string }}
   */
  async function softReset({ buildId } = {}) {
    if (resetting) return { ok: false, error: "already-resetting" };
    resetting = true;
    const v = buildId || String(Date.now());
    try {
      chatAgent?.abortInflight?.();
      onBeforeReload?.();

      const { waiting } = await updateSw();
      if (waiting) {
        waiting.postMessage({ type: "SKIP_WAITING" });
        // Give the worker a tick to activate before navigation
        await new Promise((r) => setTimeout(r, 50));
      }

      navigate(v);
      return { ok: true, navigated: true };
    } catch (e) {
      resetting = false;
      console.error("[soft-reset]", e);
      try {
        location.reload();
        return { ok: true, navigated: true };
      } catch (e2) {
        return { ok: false, error: String(e2?.message || e2 || e) };
      }
    }
  }

  function navigate(v) {
    const u = new URL(location.href);
    u.searchParams.set("v", v);
    // Signal boot to mark lastSeen only after successful load of this apply
    u.searchParams.set("softApplied", "1");
    location.replace(u.toString());
  }

  return { softReset };
}
