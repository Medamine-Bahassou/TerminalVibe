#!/usr/bin/env node
/**
 * Mirror proxy — transparently proxies a target site, stripping framing
 * headers and rewriting URLs so the content can be embedded in an <iframe>.
 *
 * Environment variables:
 *   TARGET_URL     Upstream site to mirror (default: https://www.youtube.com)
 *   PORT           Listen port                (default: 5000)
 *   HOST           Bind address               (default: 0.0.0.0)
 *   CACHE_DIR      Disk cache directory        (default: ./cache)
 *   CACHE_SIZE_MB  Max cache size in MB        (default: 512)
 *   REQUEST_TIMEOUT  Upstream timeout in sec   (default: 30)
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TARGET_URL = process.env.TARGET_URL || "https://www.youtube.com";
const TARGET_HOST = new URL(TARGET_URL).hostname;

const CACHE_DIR = process.env.CACHE_DIR || "./cache";
const CACHE_SIZE_MB = parseInt(process.env.CACHE_SIZE_MB || "512", 10);
const CACHE_SIZE_LIMIT = CACHE_SIZE_MB * 1024 * 1024;

const PORT = parseInt(process.env.PORT || "5000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "30", 10) * 1000;

// ---------------------------------------------------------------------------
// Header filter sets
// ---------------------------------------------------------------------------

const STRIP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "x-content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "transfer-encoding",
  "content-encoding",
  "connection",
]);

const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "accept-encoding",
]);

// ---------------------------------------------------------------------------
// Disk cache (simple JSON-file LRU cache)
// ---------------------------------------------------------------------------

fs.mkdirSync(CACHE_DIR, { recursive: true });

class DiskCache {
  constructor(dir, sizeLimit) {
    this.dir = dir;
    this.sizeLimit = sizeLimit;
    this.indexPath = path.join(dir, "_index.json");
    this.index = {};          // key -> { file, size, ts }
    this.currentSize = 0;
    this._load();
  }

  _load() {
    try {
      this.index = JSON.parse(fs.readFileSync(this.indexPath, "utf8"));
      this.currentSize = Object.values(this.index).reduce((s, e) => s + (e.size || 0), 0);
    } catch {
      this.index = {};
      this.currentSize = 0;
    }
  }

  _save() {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index));
  }

  get(key) {
    const entry = this.index[key];
    if (!entry) return null;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(this.dir, entry.file), "utf8"));
      entry.ts = Date.now();
      this._save();
      return data;
    } catch {
      delete this.index[key];
      this._save();
      return null;
    }
  }

  set(key, value) {
    const raw = JSON.stringify(value);
    const size = Buffer.byteLength(raw);
    const file = `${key}.json`;

    // Evict LRU until we have space
    while (this.currentSize + size > this.sizeLimit && Object.keys(this.index).length > 0) {
      this._evict();
    }

    fs.writeFileSync(path.join(this.dir, file), raw);
    this.index[key] = { file, size, ts: Date.now() };
    this.currentSize += size;
    this._save();
  }

  _evict() {
    let oldest = null;
    for (const [k, v] of Object.entries(this.index)) {
      if (!oldest || v.ts < oldest.ts) oldest = { key: k, ...v };
    }
    if (oldest) {
      try { fs.unlinkSync(path.join(this.dir, oldest.file)); } catch {}
      this.currentSize -= oldest.size || 0;
      delete this.index[oldest.key];
    }
  }
}

const cache = new DiskCache(CACHE_DIR, CACHE_SIZE_LIMIT);

// ---------------------------------------------------------------------------
// URL rewriting
// ---------------------------------------------------------------------------

function rewriteUrl(url) {
  if (!url) return url;
  url = url.trim();
  // Protocol-relative
  if (url.startsWith("//")) url = "https:" + url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === TARGET_HOST) {
      let result = parsed.pathname || "/";
      if (parsed.search) result += parsed.search;
      if (parsed.hash) result += parsed.hash;
      return result;
    }
  } catch {}
  return url;
}

function rewriteHtml(content) {
  let text = content.toString("utf8");

  // Remove <meta http-equiv="X-Frame-Options|CSP">
  text = text.replace(
    /<meta\b[^>]*\bhttp-equiv\s*=\s*["'](?:x-frame-options|content-security-policy)["'][^>]*>/gi,
    ""
  );

  // Rewrite href / src / action / data attributes
  const ATTR_RE = /((?:href|src|action|data)\s*=\s*["'])([^"']+)(["'])/gi;
  text = text.replace(ATTR_RE, (m, pre, val, post) => {
    const rewritten = rewriteUrl(val);
    return pre + rewritten + post;
  });

  // srcset
  const SRCSET_RE = /(\bsrcset\s*=\s*["'])([^"']+)(["'])/gi;
  text = text.replace(SRCSET_RE, (m, pre, value, post) => {
    const rewritten = value.split(",").map(part => {
      const tokens = part.trim().split(/\s+/);
      if (tokens[0]) tokens[0] = rewriteUrl(tokens[0]);
      return tokens.join(" ");
    }).join(", ");
    return pre + rewritten + post;
  });

  // CSS url() inside <style> blocks
  text = text.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (m, open, body, close) => {
      const rewritten = body.replace(
        /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
        (m2, q, inner) => {
          const r = rewriteUrl(inner.trim());
          return `url(${q}${r}${q})`;
        }
      );
      return open + rewritten + close;
    }
  );

  // Inline style="…" url()
  text = text.replace(
    /(\bstyle\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, body, post) => {
      const rewritten = body.replace(
        /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
        (m2, q, inner) => {
          const r = rewriteUrl(inner.trim());
          return `url(${q}${r}${q})`;
        }
      );
      return pre + rewritten + post;
    }
  );

  return Buffer.from(text, "utf8");
}

function rewriteCss(content) {
  const text = content.toString("utf8");
  const rewritten = text.replace(
    /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
    (m, q, inner) => {
      const r = rewriteUrl(inner.trim());
      return `url(${q}${r}${q})`;
    }
  );
  return Buffer.from(rewritten, "utf8");
}

function rewriteJs(content) {
  const text = content.toString("utf8");
  const pattern = new RegExp(
    `(["'])https?://${escapeRegex(TARGET_HOST)}(/[^"']*?)(\\1)`,
    "g"
  );
  const rewritten = text.replace(pattern, "$1$2$3");
  return Buffer.from(rewritten, "utf8");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Upstream fetch
// ---------------------------------------------------------------------------

function cacheKey(p, q) {
  const raw = q ? `${p}?${q}` : p;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function buildRequestHeaders(clientHeaders) {
  const headers = {};
  for (const [name, value] of Object.entries(clientHeaders)) {
    if (!STRIP_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  }
  headers["Host"] = TARGET_HOST;
  headers["User-Agent"] =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  return headers;
}

function fetchUpstream(method, fullPath, query, headers, body) {
  return new Promise((resolve, reject) => {
    let url = TARGET_URL + fullPath;
    if (query) url += "?" + query;

    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;

    const req = mod.request(url, {
      method,
      headers,
      timeout: REQUEST_TIMEOUT,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });

    if (body && method !== "GET" && method !== "HEAD") {
      req.write(body);
    }
    req.end();
  });
}

function buildResponse(upstream, clientRes) {
  const contentType = upstream.headers["content-type"] || "application/octet-stream";
  let body = upstream.body;

  const ct = contentType.toLowerCase();
  if (ct.includes("text/html")) {
    body = rewriteHtml(body);
  } else if (ct.includes("text/css")) {
    body = rewriteCss(body);
  } else if (ct.includes("javascript") || ct.includes("text/js")) {
    body = rewriteJs(body);
  }

  // Build outbound headers
  const outHeaders = {};
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (STRIP_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    if (name.toLowerCase() === "location") {
      outHeaders[name] = rewriteUrl(value);
    } else {
      outHeaders[name] = value;
    }
  }

  // Set CORS
  outHeaders["access-control-allow-origin"] = "*";

  clientRes.writeHead(upstream.status, outHeaders);
  clientRes.end(body);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${HOST}:${PORT}`);
  const fullPath = parsed.pathname || "/";
  const query = parsed.search ? parsed.search.slice(1) : "";

  const useCache = req.method === "GET";
  const key = useCache ? cacheKey(fullPath, query) : null;

  // Check cache
  if (useCache && key) {
    const cached = cache.get(key);
    if (cached) {
      console.log(`HIT  ${fullPath}`);
      res.writeHead(cached.status, cached.headers);
      res.end(Buffer.from(cached.body, "base64"));
      return;
    }
  }

  console.log(`MISS ${fullPath}`);

  // Collect request body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : null;

  try {
    const headers = buildRequestHeaders(req.headers);
    const upstream = await fetchUpstream(req.method, fullPath, query, headers, body);

    // Rewrite response
    const contentType = upstream.headers["content-type"] || "application/octet-stream";
    let respBody = upstream.body;

    const ct = contentType.toLowerCase();
    if (ct.includes("text/html")) {
      respBody = rewriteHtml(respBody);
    } else if (ct.includes("text/css")) {
      respBody = rewriteCss(respBody);
    } else if (ct.includes("javascript") || ct.includes("text/js")) {
      respBody = rewriteJs(respBody);
    }

    // Build headers
    const outHeaders = {};
    for (const [name, value] of Object.entries(upstream.headers)) {
      if (STRIP_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
      if (name.toLowerCase() === "location") {
        outHeaders[name] = rewriteUrl(value);
      } else {
        outHeaders[name] = value;
      }
    }
    outHeaders["access-control-allow-origin"] = "*";

    // Cache successful GET responses
    if (useCache && upstream.status === 200) {
      cache.set(key, {
        status: upstream.status,
        headers: outHeaders,
        body: respBody.toString("base64"),
      });
    }

    res.writeHead(upstream.status, outHeaders);
    res.end(respBody);
  } catch (err) {
    console.error(`Upstream error for ${fullPath}: ${err.message}`);
    res.writeHead(502, { "content-type": "text/html" });
    res.end(`<h1>Proxy Error</h1><p>${escapeHtml(err.message)}</p>`);
  }
});

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, HOST, () => {
  console.log(`Mirror proxy → ${TARGET_URL}`);
  console.log(`Disk cache: ${path.resolve(CACHE_DIR)} (limit: ${CACHE_SIZE_MB} MB)`);
  console.log(`Listening on http://${HOST}:${PORT}`);
});
