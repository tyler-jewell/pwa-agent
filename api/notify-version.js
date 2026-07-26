/**
 * Deploy hook / notify clients of new version via Web Push.
 * Without VAPID keys: returns 200 with skipped reason (Deploy Button safe).
 *
 * Env (optional): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
 * NOTIFY_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN
 */

import {
  loadSubscriptions,
  removeSubscription,
  storageMode,
} from "./_push-store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const secret = process.env.NOTIFY_SECRET;
  if (secret) {
    const hdr = req.headers["x-notify-secret"] || req.headers["authorization"];
    if (hdr !== secret && hdr !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  let body = {};
  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
  } catch {
    res.status(400).json({ error: "invalid json" });
    return;
  }

  const payload = {
    title: "Progressive Web Agent update",
    body: body.summary || body.changelog?.summary || "A new version is available.",
    summary: body.summary || body.changelog?.summary || "",
    buildId: body.buildId || "",
  };

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    res.status(200).json({
      ok: true,
      sent: 0,
      skipped: "vapid-not-configured",
      message: "App runs without push; set VAPID_* to enable.",
      storage: storageMode(),
      payload,
    });
    return;
  }

  let webpush;
  try {
    webpush = await import("web-push");
  } catch {
    res.status(200).json({
      ok: true,
      sent: 0,
      skipped: "web-push-package-missing",
      storage: storageMode(),
      payload,
    });
    return;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:ops@example.com",
    publicKey,
    privateKey
  );

  const subscriptions = await loadSubscriptions();
  let sent = 0;
  const errors = [];
  for (const sub of subscriptions.values()) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent += 1;
    } catch (e) {
      errors.push(String(e.message || e));
      if (e.statusCode === 410) await removeSubscription(sub.endpoint);
    }
  }

  res.status(200).json({
    ok: true,
    sent,
    errors: errors.slice(0, 5),
    storage: storageMode(),
    payload,
  });
}
