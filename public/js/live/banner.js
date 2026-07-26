/** Update banner: version + summary + expand + Update/Dismiss. */
export function createUpdateBanner({ root, onUpdate, onDismiss }) {
  if (!root) throw new Error("banner root required");

  function hide() {
    root.classList.add("hidden");
    root.innerHTML = "";
  }

  /**
   * @param {{ manifest: object, mode: 'update-dismiss'|'dismiss-only' }} opts
   */
  function show({ manifest, mode }) {
    const summary = manifest?.changelog?.summary || "New version available";
    const full = manifest?.changelog?.full || summary;
    const buildId = manifest?.buildId || "";
    const dismissOnly = mode === "dismiss-only";
    const title = dismissOnly ? "You’re on the latest build" : "Update available";
    const lead = dismissOnly
      ? `Loaded build ${escapeHtml(buildId)}. Durable chat and MEMORY were preserved.`
      : escapeHtml(summary);
    const updateBtn = dismissOnly
      ? ""
      : `<button type="button" class="btn primary" data-act="update">Update</button>`;
    root.innerHTML = `
      <div>
        <strong>${title}</strong>
        <span class="pill muted">${escapeHtml(buildId)}</span>
        <p style="margin:.35rem 0 0">${lead}</p>
        <details>
          <summary>Full notes</summary>
          <p>${escapeHtml(full)}</p>
        </details>
        <div class="actions">
          ${updateBtn}
          <button type="button" class="btn" data-act="dismiss">Dismiss</button>
        </div>
      </div>`;
    root.classList.remove("hidden");
    root.querySelector('[data-act="update"]')?.addEventListener("click", () => {
      onUpdate?.(manifest);
    });
    root.querySelector('[data-act="dismiss"]')?.addEventListener("click", () => {
      hide();
      onDismiss?.(manifest);
    });
  }

  return { show, hide };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
