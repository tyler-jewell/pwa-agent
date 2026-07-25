#!/usr/bin/env node
/**
 * Static file server for the isolated PWA-LLM comparison bench.
 * Default port 7430 — never 7420 (msa-web day-2).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "public");
const PORT = Number(process.env.PWA_BENCH_PORT || 7430);

if (PORT === 7420) {
  console.error("FATAL: port 7420 is reserved for msa-web. Use PWA_BENCH_PORT≠7420.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  // No COEP require-corp: CDN ESM (WebLLM / Transformers.js) must load for the bench.
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, `Not found: ${rel}`);
      return;
    }
    const ext = path.extname(filePath);
    send(res, 200, data, MIME[ext] || "application/octet-stream");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`pwa-bench listening http://127.0.0.1:${PORT}/`);
  console.log(`isolated MVP (not msa-web; not port 7420)`);
});
