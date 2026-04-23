#!/usr/bin/env node
/**
 * Local HTTPS reverse proxy for Ollama with CORS (no nginx required).
 *
 * Prerequisites: TLS files under .local/ollama-https/ (see repo setup), Ollama on 127.0.0.1:11434.
 *
 * Usage (from frontend/): npm run ollama-https-proxy
 * Or: node scripts/ollama-https-proxy.mjs
 *
 * Env (optional):
 *   OLLAMA_PROXY_TARGET, OLLAMA_PROXY_PORT — upstream Ollama (default 127.0.0.1:11434)
 *   OLLAMA_HTTPS_HOST, OLLAMA_HTTPS_PORT — listen address (default 127.0.0.1:8443)
 *   OLLAMA_PROXY_ALLOWED_ORIGINS — comma-separated extra allowed browser Origins (exact match)
 */

import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CERT_DIR = path.join(ROOT, ".local", "ollama-https");
const KEY = path.join(CERT_DIR, "ollama-local-key.pem");
const CERT = path.join(CERT_DIR, "ollama-local.pem");

const OLLAMA_HOST = process.env.OLLAMA_PROXY_TARGET ?? "127.0.0.1";
const OLLAMA_PORT = Number(process.env.OLLAMA_PROXY_PORT ?? 11434);
const LISTEN_HOST = process.env.OLLAMA_HTTPS_HOST ?? "127.0.0.1";
const LISTEN_PORT = Number(process.env.OLLAMA_HTTPS_PORT ?? 8443);

const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://localhost:3000",
  "https://127.0.0.1:3000",
  "https://cram-academy.vercel.app",
];

const EXTRA = (process.env.OLLAMA_PROXY_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED = new Set([...DEFAULT_ORIGINS, ...EXTRA]);

function corsHeaders(origin) {
  if (!origin || !ALLOWED.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Requested-With, Access-Control-Request-Private-Network",
    "Access-Control-Max-Age": "86400",
    // Chrome: public HTTPS page → 127.0.0.1 requires this on preflight or fetch fails with "Failed to fetch".
    "Access-Control-Allow-Private-Network": "true",
  };
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

/** Strip hop-by-hop headers and browser CORS headers — we validate Origin here; Ollama may 403 if Origin is forwarded. */
function stripRequestHeaders(h) {
  const out = { ...h };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) delete out[key];
    if (lower === "origin" || lower === "referer") delete out[key];
  }
  out.host = `${OLLAMA_HOST}:${OLLAMA_PORT}`;
  return out;
}

function stripResponseHeaders(h) {
  const out = { ...h };
  const conn = Object.keys(out).find((k) => k.toLowerCase() === "connection");
  if (conn) delete out[conn];
  return out;
}

if (!fs.existsSync(KEY) || !fs.existsSync(CERT)) {
  console.error(
    `Missing TLS files. Expected:\n  ${KEY}\n  ${CERT}\n` +
      "Generate with OpenSSL (see docs/nginx-ollama-proxy-https.conf) or recreate .local/ollama-https/."
  );
  process.exit(1);
}

const server = https.createServer(
  {
    key: fs.readFileSync(KEY),
    cert: fs.readFileSync(CERT),
  },
  (req, res) => {
    const origin = req.headers.origin;
    const c = corsHeaders(origin);

    if (req.method === "OPTIONS") {
      if (!c) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }
      res.writeHead(204, c);
      res.end();
      return;
    }

    if (!c) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    const url = new URL(req.url ?? "/", `https://${LISTEN_HOST}:${LISTEN_PORT}`);
    const opts = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: url.pathname + url.search,
      method: req.method,
      headers: stripRequestHeaders(req.headers),
    };

    const proxyReq = http.request(opts, (proxyRes) => {
      const out = stripResponseHeaders(proxyRes.headers);
      Object.assign(out, c);
      res.writeHead(proxyRes.statusCode ?? 502, out);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("[ollama-https-proxy]", err.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", ...c });
        res.end(`Bad Gateway: ${err.message}`);
      }
    });

    req.pipe(proxyReq);
  }
);

server.on("error", (err) => {
  console.error("[ollama-https-proxy]", err.message);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`Ollama HTTPS proxy https://${LISTEN_HOST}:${LISTEN_PORT} -> http://${OLLAMA_HOST}:${OLLAMA_PORT}`);
  console.log(`Set NEXT_PUBLIC_OLLAMA_BASE_URL=https://${LISTEN_HOST}:${LISTEN_PORT}`);
});
