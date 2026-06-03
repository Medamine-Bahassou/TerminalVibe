#!/usr/bin/env node
/**
 * Terminus WebSocket PTY server + HTTP browser-proxy server.
 *
 * WebSocket server  ws://127.0.0.1:7681   — PTY multiplexer
 * HTTP proxy server http://127.0.0.1:7682 — transparent page fetcher for the browser tab
 * App server        http://127.0.0.1:6969 — serves index.html + static files
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const HOST = "127.0.0.1";
const PORT = 7681; // WebSocket PTY
const PROXY_PORT = 7682; // HTTP proxy for browser tab
const APP_PORT = 6969; // HTTP app server

const SESSIONS = {};
const ID_LEN = 36;

const APP_DIR = __dirname;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const SKIP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "x-content-type-options",
  "transfer-encoding",
  "content-encoding",
  "x-xss-protection",
  "permissions-policy",
  "strict-transport-security",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  // CORS — we set our own so target's values don't leak
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-expose-headers",
]);

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────────────────────
//  PATH-BASED PROXY URL
// ─────────────────────────────────────────────────────────────
//  Format:  /p/<base64url-origin>/<path-and-query>
//  Example: /p/aHR0cHM6Ly9leGFtcGxlLmNvbQ==/css/style.css
//  The <base> tag points to this path so all relative URLs
//  (including JS-created ones) resolve through the proxy.

function toB64url(str) {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(str) {
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf-8");
}

/** Build the proxy base URL for a given full target URL (origin + path). */
function proxyPathUrl(fullUrl) {
  const u = new URL(fullUrl);
  const origin = u.origin;
  const path = fullUrl.substring(origin.length) || "/";
  return `http://${HOST}:${PROXY_PORT}/p/${toB64url(origin)}${path}`;
}

/**
 * Parse a /p/<b64>/<path> request into the full target URL.
 * Returns null if the path doesn't match.
 */
function resolveProxyPath(pathname, search) {
  const m = pathname.match(/^\/p\/([A-Za-z0-9\-_=]+)(\/.*)?$/);
  if (!m) return null;
  const origin = fromB64url(m[1]);
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) return null;
  const rest = (m[2] || "/") + search;
  // Avoid double-slash when origin has a trailing slash
  return origin.replace(/\/+$/, "") + rest;
}

/**
 * Convert an absolute CSS path (`/…`) to a proxy path.
 */
function proxyAbsPath(path, baseUrl) {
  if (!path.startsWith("/")) return null;
  try {
    const abs = new URL(path, baseUrl).href;
    const u = new URL(abs);
    const rest = abs.substring(u.origin.length) || "/";
    return `/p/${toB64url(u.origin)}${rest}`;
  } catch { return null; }
}

/**
 * Rewrite HTML for safe iframe embedding.
 *
 * Strategy:
 *  1. Replace/inject <base href> pointing to our path-based proxy so the
 *     browser resolves all *relative* URLs (including JS-created ones)
 *     through the proxy.
 *  2. Rewrite absolute paths (`/…`) in resource attributes — <base> doesn't
 *     affect these; they'd resolve against the proxy server root instead.
 *  3. Rewrite url() with absolute paths inside <style> / style="…".
 *
 * Absolute URLs (e.g. <img src="https://cdn.example.com/…">) load directly
 * from the original source — no proxying needed.
 */
function rewriteHtml(html, pageUrl) {
  // Detect existing <base href> — use it as the resolution base
  let baseHref = pageUrl;
  const existing = html.match(/<base\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/i);
  if (existing) {
    try {
      baseHref = new URL(existing[1], pageUrl).href;
    } catch {}
  }

  // Directory of the base URL — relative URLs resolve against this
  const baseDirUrl = new URL(".", baseHref).href;
  const pb = proxyPathUrl(baseDirUrl);

  // Replace existing <base> href or inject a new one
  if (existing) {
    html = html.replace(
      /(<base\b[^>]*?\bhref\s*=\s*["'])([^"']+)(["'])/gi,
      (m, pre, _href, post) => pre + pb + post
    );
  } else {
    const tag = `<base href="${pb}">`;
    if (/<head>/i.test(html)) {
      html = html.replace(/<head>/i, `<head>${tag}`);
    } else {
      html = tag + html;
    }
  }

  // ── Resource attributes with absolute paths ──
  // Absolute paths (e.g. <script src="/app.js">) don't follow <base>;
  // they'd resolve against the proxy server root. Rewrite them.
  const RESOURCE_ATTRS = /((?:src|href|poster|data)\s*=\s*["'])\/([^"']+)(["'])/gi;
  html = html.replace(RESOURCE_ATTRS, (m, pre, path, post) => {
    const proxied = proxyAbsPath("/" + path, pageUrl);
    return proxied ? pre + proxied + post : m;
  });

  // srcset — comma-separated list of "/path descriptor" pairs
  html = html.replace(
    /(\bsrcset\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, value, post) => {
      const rewritten = value
        .split(",")
        .map((part) => {
          part = part.trim();
          if (!part) return "";
          const pieces = part.split(/\s+/);
          if (pieces[0].startsWith("/")) {
            pieces[0] = proxyAbsPath(pieces[0], pageUrl) || pieces[0];
          }
          return pieces.join(" ");
        })
        .join(", ");
      return pre + rewritten + post;
    }
  );

  // ── CSS url() with absolute paths ──
  rewriteStyleUrl: {
    // <style> blocks
    html = html.replace(
      /(<style\b[^>]*>)(.*?)(<\/style>)/gis,
      (m, open, body, close) => {
        const rewritten = body.replace(
          /url\(\s*(['"]?)\s*(\/[^)'"]+)\s*\1\s*\)/gi,
          (m2, q, path) => {
            const proxied = proxyAbsPath(path, pageUrl);
            return proxied ? `url(${q}${proxied}${q})` : m2;
          }
        );
        return open + rewritten + close;
      }
    );

    // Inline style="…"
    html = html.replace(
      /(\bstyle\s*=\s*["'])(.*?)(["'])/gi,
      (m, pre, body, post) => {
        const rewritten = body.replace(
          /url\(\s*(['"]?)\s*(\/[^)'"]+)\s*\1\s*\)/gi,
          (m2, q, path) => {
            const proxied = proxyAbsPath(path, pageUrl);
            return proxied ? `url(${q}${proxied}${q})` : m2;
          }
        );
        return pre + rewritten + post;
      }
    );
  }

  // ── Service Worker registration ──
  // Catches absolute-path requests from dynamic JS (import(), fetch(),
  // createElement('script/src="/path"')) that bypass <base>.
  const swReg = `<script>try{navigator.serviceWorker.register('/sw.js')}catch(e){}</script>`;

  // ── Navigation tracker — polls location.href so the parent can sync ──
  // the URL bar, back/fwd buttons, and save-state. Only inject when there
  // is a </body> tag (real HTML pages, not error pages or fragments).
  if (/<\/body>/i.test(html)) {
    const navScript =
      "<script>(function(){var u=location.href;setInterval(function(){if(location.href!==u){u=location.href;parent.postMessage({terminusNav:u},\"*\")}},200)})()<\/script>";
    html = html.replace(/<\/body>/i, swReg + navScript + "</body>");
  }

  return html;
}

/**
 * Rewrite CSS for absolute-path url() references (e.g. /fonts/…).
 * Relative paths resolve correctly since the CSS file URL is a proxy path.
 */
function rewriteCss(css, cssUrl) {
  return css.replace(
    /url\(\s*(['"]?)\s*(\/[^)'"]+)\s*\1\s*\)/gi,
    (m, q, path) => {
      const proxied = proxyAbsPath(path, cssUrl);
      return proxied ? `url(${q}${proxied}${q})` : m;
    }
  );
}

// ─────────────────────────────────────────────────────────────
//  HTTP PROXY SERVER
// ─────────────────────────────────────────────────────────────

function proxyFetch(targetUrl, reqHeaders, method) {
  return new Promise((resolve, reject) => {
    const targetParsed = new URL(targetUrl);
    const transport = targetParsed.protocol === "https:" ? https : http;
    const reqMethod = (method || "GET").toUpperCase();

    const headers = {
      "User-Agent": BROWSER_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      Referer: targetUrl,
    };
    if (targetParsed.hostname) {
      headers["Host"] =
        targetParsed.port && targetParsed.port !== "80" && targetParsed.port !== "443"
          ? `${targetParsed.hostname}:${targetParsed.port}`
          : targetParsed.hostname;
    }

    const opts = {
      hostname: targetParsed.hostname,
      port: targetParsed.port || (targetParsed.protocol === "https:" ? 443 : 80),
      path: targetParsed.pathname + targetParsed.search,
      method: reqMethod,
      headers,
      rejectUnauthorized: false, // permissive SSL like Python
      timeout: 15000,
    };

    const req = transport.request(opts, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrl).href;
        proxyFetch(redirectUrl, reqHeaders, reqMethod).then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 200,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
//  SERVICE WORKER — intercepts dynamic JS requests
// ─────────────────────────────────────────────────────────────
//  Registers on the proxy origin and routes any absolute-path
//  request (e.g. JS import('/_next/static/chunks/file.js') or
//  dynamically created <script src="/path">) through the proxy.
//  Only needed when the iframe sandbox includes allow-same-origin.

const SW_SCRIPT = [
  "'use strict';",
  "self.addEventListener('install',function(e){e.waitUntil(self.skipWaiting())});",
  "self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});",
  "var _tb64=function(s){return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')};",
  "self.addEventListener('fetch',function(e){",
  "var u=new URL(e.request.url);",
  "if(u.pathname==='/sw.js'||u.pathname.indexOf('/p/')===0)return;",
  "e.respondWith((async function(){",
  "var ref=e.request.referrer||'';",
  "var pb64=null;",
  "var i=ref.indexOf('/p/');",
  "if(i>=0){var j=ref.indexOf('/',i+3);pb64=j>0?ref.substring(i+3,j):ref.substring(i+3);}",
  "if(!pb64){try{var c=await self.clients.get(e.clientId);if(c){",
  "i=c.url.indexOf('/p/');",
  "if(i>=0){j=c.url.indexOf('/',i+3);pb64=j>0?c.url.substring(i+3,j):c.url.substring(i+3);",
  "}}}catch(ex){}}",
  // Same-origin: use page's b64. Cross-origin: encode the target's origin.
  "var pp=pb64&&u.origin===self.location.origin?'/p/'+pb64+u.pathname+u.search:'/p/'+_tb64(u.origin)+u.pathname+u.search;",
  "var opts={method:e.request.method,headers:e.request.headers};",
  "if(e.request.method!=='GET'&&e.request.method!=='HEAD'){",
  "try{opts.body=await e.request.clone().arrayBuffer();}catch(ex){}}",
  "return fetch(pp,opts);",
  "})());",
  "});",
].join("");

const proxyServer = http.createServer(async (req, res) => {
  // Echo Origin for credentialed requests (CORS)
  const reqOrigin = req.headers.origin;
  if (reqOrigin) {
    res.setHeader("Access-Control-Allow-Origin", reqOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);

  // ── Service Worker script ──
  if (parsed.pathname === "/sw.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(SW_SCRIPT);
    return;
  }

  // ── Resolve target URL ──
  let target;

  // 1) Path-based: /p/<base64url-origin>/<path>
  target = resolveProxyPath(parsed.pathname, parsed.search || "");

  // 2) Legacy: /proxy?url=<URL>  — fallback
  if (!target && parsed.pathname.startsWith("/proxy")) {
    const q = parsed.query.url;
    if (q) target = decodeURIComponent(q);
  }

  if (!target) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  try {
    const result = await proxyFetch(target, req.headers, req.method);
    let { status, headers: respHeaders, body } = result;

    const contentType = respHeaders["content-type"] || "application/octet-stream";
    const ctBase = contentType.split(";")[0].trim().toLowerCase();
    let charset = "utf-8";
    if (contentType.includes("charset=")) {
      charset = contentType.split("charset=")[1].trim().split(";")[0].trim();
    }

    // Only rewrite HTML — inject/replace <base> for relative URL resolution
    if (ctBase === "text/html" || ctBase === "application/xhtml+xml") {
      try {
        let text = body.toString(/utf-?8/i.test(charset) ? "utf-8" : "latin1");
        text = rewriteHtml(text, target);
        body = Buffer.from(text, "utf-8");
      } catch {}
    } else if (ctBase === "text/css") {
      // Rewrite absolute-path url() references in external CSS
      try {
        let text = body.toString(/utf-?8/i.test(charset) ? "utf-8" : "latin1");
        text = rewriteCss(text, target);
        body = Buffer.from(text, "utf-8");
      } catch {}
    }

    // Forward safe response headers
    const outHeaders = {
      "Content-Type": ctBase.startsWith("text/") ? `${ctBase}; charset=utf-8` : contentType,
      "Content-Length": body.length,
    };
    for (const [key, value] of Object.entries(respHeaders)) {
      if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        outHeaders[key] = value;
      }
    }

    res.writeHead(status, outHeaders);
    res.end(body);
  } catch (err) {
    res.writeHead(502);
    res.end(`Proxy error: ${err.message}`);
  }
});

// ─────────────────────────────────────────────────────────────
//  STATIC APP SERVER
// ─────────────────────────────────────────────────────────────

const appServer = http.createServer((req, res) => {
  let filePath = url.parse(req.url).pathname.replace(/^\//, "");
  if (!filePath) filePath = "index.html";

  const fullPath = path.resolve(path.join(APP_DIR, filePath));

  // security: stay inside APP_DIR
  if (!fullPath.startsWith(APP_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const body = fs.readFileSync(fullPath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
  });
  res.end(body);
});

// ─────────────────────────────────────────────────────────────
//  PTY SESSION
// ─────────────────────────────────────────────────────────────

class PTYSession {
  constructor(sessionId, cols, rows, sendCb) {
    this.id = sessionId;
    this.cols = cols;
    this.rows = rows;
    this._send = sendCb;
    this._proc = null;
    this._running = false;
    this.shell = process.env.SHELL || "/bin/bash";
  }

  start() {
    this._proc = pty.spawn(this.shell, ["-l"], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: process.env.HOME || "/root",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });

    this._running = true;

    const sidBuf = Buffer.alloc(ID_LEN);
    sidBuf.write(this.id, 0, ID_LEN, "utf-8");

    this._proc.onData((data) => {
      if (!this._running) return;
      const dataBuf = Buffer.from(data, "utf-8");
      const msg = Buffer.concat([sidBuf, dataBuf]);
      this._send(msg);
    });

    this._proc.onExit(({ exitCode, signal }) => {
      this._running = false;
      const code =
        exitCode != null ? exitCode : signal != null ? -signal : null;
      this._send(
        JSON.stringify({ type: "exit", id: this.id, code })
      );
    });
  }

  write(data) {
    if (this._proc && this._running) {
      this._proc.write(data);
    }
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    if (this._proc) {
      this._proc.resize(cols, rows);
    }
  }

  close() {
    this._running = false;
    if (this._proc) {
      this._proc.kill();
      this._proc = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  WEBSOCKET HANDLER
// ─────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT, host: HOST, maxPayload: 0 });

wss.on("connection", (ws) => {
  const localSessions = [];

  ws.send(JSON.stringify({ type: "ready", port: PORT }));

  ws.on("message", (message, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
      if (buf.length <= ID_LEN) return;
      const sid = buf.slice(0, ID_LEN).toString("utf-8").trim();
      const data = buf.slice(ID_LEN);
      const session = SESSIONS[sid];
      if (session) session.write(data.toString("utf-8"));
    } else {
      let msg;
      try {
        msg = JSON.parse(message.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "create": {
          const sid = msg.id || "";
          const cols = parseInt(msg.cols) || 80;
          const rows = parseInt(msg.rows) || 24;
          if (sid && !SESSIONS[sid]) {
            try {
              const session = new PTYSession(sid, cols, rows, (data) => {
                if (ws.readyState === ws.OPEN) ws.send(data);
              });
              session.start();
              SESSIONS[sid] = session;
              localSessions.push(sid);
            } catch (e) {
              ws.send(JSON.stringify({ type: "error", id: sid, msg: e.message }));
            }
          }
          break;
        }
        case "resize": {
          const sid = msg.id || "";
          const cols = parseInt(msg.cols) || 80;
          const rows = parseInt(msg.rows) || 24;
          const session = SESSIONS[sid];
          if (session) session.resize(cols, rows);
          break;
        }
        case "close": {
          const sid = msg.id || "";
          const session = SESSIONS[sid];
          if (session) {
            delete SESSIONS[sid];
            session.close();
            const idx = localSessions.indexOf(sid);
            if (idx !== -1) localSessions.splice(idx, 1);
          }
          break;
        }
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
      }
    }
  });

  ws.on("close", () => {
    for (const sid of localSessions) {
      const session = SESSIONS[sid];
      if (session) {
        delete SESSIONS[sid];
        session.close();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────

proxyServer.listen(PROXY_PORT, HOST, () => {
  console.log(`Terminus proxy server listening on http://${HOST}:${PROXY_PORT}`);
});

// Skip static app server in Tauri mode (Tauri serves assets via its own protocol)
const isTauriMode = process.env.TAURI === "1" || process.env.TAURI_ENV === "1";

if (!isTauriMode) {
  appServer.listen(APP_PORT, HOST, () => {
    console.log(`Terminus app server listening on http://${HOST}:${APP_PORT}`);
  });
  console.log(`Open http://${HOST}:${APP_PORT} in your browser`);
}

console.log(`Terminus PTY server listening on ws://${HOST}:${PORT}`);
