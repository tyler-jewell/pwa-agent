/**
 * Web Push subscribe — optional VAPID.
 * GET: { publicKey, pushEnabled, storage } — no secrets required for Deploy Button.
 * POST: stores subscription (KV when configured; else in-memory dev fallback).
 */

import { addSubscription, storageMode } from "./_push-store.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY || null;

  if (req.method === "GET") {
    res.status(200).json({
      publicKey,
      vapidPublicKey: publicKey,
      pushEnabled: Boolean(publicKey),
      storage: storageMode(),
    });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || !body.endpoint) {
        res.status(400).json({ error: "invalid subscription" });
        return;
      }
      await addSubscription(body);
      res.status(201).json({
        ok: true,
        stored: true,
        storage: storageMode(),
        durable: storageMode() === "vercel-kv",
      });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
