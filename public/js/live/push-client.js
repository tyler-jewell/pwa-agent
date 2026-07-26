/**
 * Optional Web Push client. Degrades cleanly without VAPID.
 */
export async function trySubscribePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  let vapid = null;
  try {
    const res = await fetch("/api/subscribe", { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      vapid = data.publicKey || data.vapidPublicKey || null;
    }
  } catch {
    return { ok: false, reason: "api-unavailable" };
  }
  if (!vapid) return { ok: false, reason: "no-vapid" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "permission-denied" };

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid),
  });
  await fetch("/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub),
  });
  return { ok: true, subscription: sub };
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
