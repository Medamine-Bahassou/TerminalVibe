#!/usr/bin/env node
/**
 * TerminalVibe WebSocket PTY server + static file server + minimal iframe proxy.
 *
 * WebSocket server  ws://127.0.0.1:7681   — PTY multiplexer
 * HTTP server       http://127.0.0.1:6969 — serves index.html + static files + local file serving
 * Minimal proxy     http://127.0.0.1:7682 — strips X-Frame-Options/CSP headers only
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const HOST = "127.0.0.1";
const PORT = parseInt(process.env.WS_PORT || "7681", 10); // WebSocket PTY
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7682", 10); // Minimal iframe proxy
const APP_PORT = parseInt(process.env.APP_PORT || "6969", 10); // HTTP app server

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
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

// Headers to strip from upstream responses (framing/CORS blockers)
const STRIP_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-security-policy",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
]);

// Extra headers stripped ONLY for HTML responses (which are modified by the proxy)
const STRIP_HTML_HEADERS = new Set([
  "etag",
  "last-modified",
  "expires",
  "age",
]);

// ─────────────────────────────────────────────────────────────
//  BASE64 URL HELPERS
// ─────────────────────────────────────────────────────────────

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

function proxyAbsPath(absPath, pageUrl) {
  // Convert an absolute path (starting with /) to its /p/<b64>/... proxy form.
  // pageUrl must be the original page URL (e.g. https://site.com/page).
  if (!absPath.startsWith("/")) return null;
  try {
    const abs = new URL(absPath, pageUrl).href;
    const u = new URL(abs);
    const rest = abs.substring(u.origin.length) || "/";
    return `/p/${toB64url(u.origin)}${rest}`;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
//  HTML REWRITING / SW INJECTION
// ─────────────────────────────────────────────────────────────

const SW_SCRIPT = `'use strict';var _pageB64=null;var _tb64=function(s){return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};self.addEventListener('install',function(e){e.waitUntil(self.skipWaiting())});self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});self.addEventListener('message',function(e){if(e.data&&e.data.type==='setB64')_pageB64=e.data.b64;});self.addEventListener('fetch',function(e){var u=new URL(e.request.url);if(u.pathname==='/sw.js'||u.pathname.indexOf('/p/')===0)return;e.respondWith((async function(){var pageB64=_pageB64;try{var c=await self.clients.get(e.clientId);if(c&&c.url.indexOf('/p/')>=0){var m=c.url.match(/\/p\/([A-Za-z0-9_=-]+)/);if(m)pageB64=m[1];}}catch(ex){}if(!pageB64){var ref=e.request.referrer||'';var m2=ref.match(/\/p\/([A-Za-z0-9_=-]+)/);if(m2)pageB64=m2[1];}var pp;if(u.origin===self.location.origin){if(!pageB64)return fetch(e.request);pp='/p/'+pageB64+u.pathname+u.search;}else{pp='/p/'+_tb64(u.origin)+u.pathname+u.search;}var opts={method:e.request.method,headers:e.request.headers};if(e.request.method!=='GET'&&e.request.method!=='HEAD'){try{opts.body=await e.request.clone().arrayBuffer();}catch(ex){}}return fetch(pp,opts);})());});`;

function rewriteHtmlForProxy(html, pageUrl, b64) {
  // 1. Strip framing / CSP meta tags
  html = html.replace(
    /<meta\b[^>]*\bhttp-equiv\s*=\s*["'](?:x-frame-options|content-security-policy|content-security-policy-report-only)["'][^>]*>\s*/gi,
    ""
  );

  // 2. Replace or inject <base href> with the proxy base URL
  const pb = `http://${HOST}:${PROXY_PORT}/p/${b64}/`;
  const hasBase = /<base\b[^>]*>/i.test(html);
  if (hasBase) {
    html = html.replace(
      /(<base\b[^>]*?\bhref\s*=\s*["'])([^"']+)(["'])/gi,
      (m, pre, _href, post) => pre + pb + post
    );
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/(<head[^>]*>)/i, `$1<base href="${pb}">`);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/(<html[^>]*>)/i, `$1<base href="${pb}">`);
  } else {
    html = `<base href="${pb}">` + html;
  }

  // 3. SW registration script (placed right after <head> for earliest activation)
  const swRegScript = `<script>try{navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(function(r){if(r.active)r.active.postMessage({type:'setB64',b64:'${b64}'});var f=function(){if(r.active)r.active.postMessage({type:'setB64',b64:'${b64}'});};r.addEventListener('updatefound',function(){(r.installing||r.waiting)&&(r.installing||r.waiting).addEventListener('statechange',function(){if(this.state==='activated')r.active.postMessage({type:'setB64',b64:'${b64}'});});});})}catch(e){}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/(<head[^>]*>)/i, `$1${swRegScript}`);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/(<html[^>]*>)/i, `$1${swRegScript}`);
  } else {
    html = swRegScript + html;
  }

  // 4. Rewrite absolute-path src/href/poster/data attributes through the proxy
  html = html.replace(
    /((?:src|href|poster|data)\s*=\s*["'])\/([^"']+)(["'])/gi,
    (m, pre, p, post) => {
      const proxied = proxyAbsPath("/" + p, pageUrl);
      return proxied ? pre + proxied + post : m;
    }
  );

  // 5. Rewrite srcset entries
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

  // 6. Rewrite url() references in <style> blocks
  html = html.replace(
    /(<style\b[^>]*>)(.*?)(<\/style>)/gis,
    (m, open, body, close) => {
      const rewritten = body.replace(
        /url\(\s*(['"]?)\s*(\/[^)'"]+)\s*\1\s*\)/gi,
        (m2, q, p) => {
          const proxied = proxyAbsPath(p, pageUrl);
          return proxied ? `url(${q}${proxied}${q})` : m2;
        }
      );
      return open + rewritten + close;
    }
  );

  // 7. Rewrite url() references in inline style="" attributes
  html = html.replace(
    /(\bstyle\s*=\s*["'])(.*?)(["'])/gi,
    (m, pre, body, post) => {
      const rewritten = body.replace(
        /url\(\s*(['"]?)\s*(\/[^)'"]+)\s*\1\s*\)/gi,
        (m2, q, p) => {
          const proxied = proxyAbsPath(p, pageUrl);
          return proxied ? `url(${q}${proxied}${q})` : m2;
        }
      );
      return pre + rewritten + post;
    }
  );

  return html;
}

// ─────────────────────────────────────────────────────────────
//  PROXY SERVER — strips headers + rewrites HTML URLs + SW
// ─────────────────────────────────────────────────────────────

const proxyServer = http.createServer((req, res) => {
  // CORS for local requests
  const reqOrigin = req.headers.origin;
  if (reqOrigin) {
    res.setHeader("Access-Control-Allow-Origin", reqOrigin);
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Service Worker endpoint
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === "/sw.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(SW_SCRIPT);
    return;
  }

  // Resolve target URL from /p/<b64origin>/<path> or /p/<b64origin>?query
  const m = parsed.pathname.match(/^\/p\/([A-Za-z0-9\-_=]+)(\/.*)?$/);
  if (!m) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  let origin;
  try {
    origin = fromB64url(m[1]);
  } catch {
    res.writeHead(400);
    res.end("Bad origin");
    return;
  }
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
    res.writeHead(400);
    res.end("Bad origin");
    return;
  }

  const rest = (m[2] || "/") + (parsed.search || "");
  const target = origin.replace(/\/+$/, "") + rest;

  let targetParsed;
  try { targetParsed = new URL(target); } catch { res.writeHead(400); res.end("Bad URL"); return; }

  const transport = targetParsed.protocol === "https:" ? https : http;
  const port = targetParsed.port ? parseInt(targetParsed.port) : (targetParsed.protocol === "https:" ? 443 : 80);

  const upstreamHeaders = {
    "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": req.headers.accept || "*/*",
    "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
    "Host": targetParsed.hostname + (port !== 80 && port !== 443 ? `:${port}` : ""),
  };
  // Forward relevant incoming headers to upstream
  const forwardedHeaders = ["referer", "cookie", "authorization", "origin", "content-type", "range"];
  // Don't forward if-none-match/if-modified-since for HTML — proxy modifies content
  const isHtmlReq = (req.headers.accept || "").includes("text/html");
  if (!isHtmlReq) {
    forwardedHeaders.push("if-none-match", "if-modified-since");
  }
  for (const h of forwardedHeaders) {
    if (req.headers[h]) upstreamHeaders[h] = req.headers[h];
  }

  const proxyReq = transport.request({
    hostname: targetParsed.hostname,
    port,
    path: targetParsed.pathname + targetParsed.search,
    method: req.method,
    headers: upstreamHeaders,
    rejectUnauthorized: false,
  }, (proxyRes) => {
    const outHeaders = {};
    for (const [name, value] of Object.entries(proxyRes.headers)) {
      if (STRIP_HEADERS.has(name)) continue;
      outHeaders[name] = value;
    }

    const contentType = (outHeaders["content-type"] || "").toLowerCase();
    const isHtml = contentType.includes("text/html");

    if (isHtml) {
      // Strip caching headers — proxy modifies HTML, browser must always get fresh content
      for (const h of STRIP_HTML_HEADERS) delete outHeaders[h];
      // Override cache-control (delete all case variants, set no-store)
      delete outHeaders["cache-control"];
      delete outHeaders["Cache-Control"];
      delete outHeaders["pragma"];
      delete outHeaders["expires"];
      outHeaders["cache-control"] = "no-store, must-revalidate";
      
      // Buffer HTML to rewrite URLs + inject SW
      const chunks = [];
      proxyRes.on("data", c => chunks.push(c));
      proxyRes.on("end", () => {
        let html = Buffer.concat(chunks).toString("utf-8");
        html = rewriteHtmlForProxy(html, target, m[1]);
        delete outHeaders["content-length"];
        outHeaders["content-length"] = Buffer.byteLength(html);
        res.writeHead(proxyRes.statusCode, outHeaders);
        res.end(html);
      });
    } else {
      res.writeHead(proxyRes.statusCode, outHeaders);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Bad gateway");
    }
  });
  req.pipe(proxyReq);
});

// ─────────────────────────────────────────────────────────────
//  STATIC APP SERVER (with local file serving)
// ─────────────────────────────────────────────────────────────

const appServer = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // Local file serving: /local/<encoded-path>
  if (parsed.pathname.startsWith("/local/")) {
    const filePath = decodeURIComponent(parsed.pathname.slice(7));
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Static file serving
  let filePath = parsed.pathname.replace(/^\//, "");
  if (!filePath) filePath = "index.html";

  const fullPath = path.resolve(path.join(APP_DIR, filePath));

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
  constructor(sessionId, cols, rows, sendCb, cwd) {
    this.id = sessionId;
    this.cols = cols;
    this.rows = rows;
    this._send = sendCb;
    this._proc = null;
    this._running = false;
    this.shell = process.env.SHELL || "/bin/bash";
    this.cwd = cwd;
    this._tmpDir = null;
  }

  start() {
    let spawnCwd = this.cwd;
    if (!spawnCwd) {
      spawnCwd = process.env.HOME || "/root";
    } else if (spawnCwd.startsWith("~")) {
      spawnCwd = path.join(process.env.HOME || "/root", spawnCwd.slice(1));
    }
    try {
      if (!fs.existsSync(spawnCwd)) spawnCwd = process.env.HOME || "/root";
    } catch {}

    // ── Shell integration: configure OSC 7 cwd reporting ──
    const shellName = path.basename(this.shell).toLowerCase();
    let shellArgs = ["-l"]; // default: login shell
    const extraEnv = {};

    if (shellName === "bash") {
      // Create a temp rc file that sources user's init and adds OSC 7
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-sh-"));
      this._tmpDir = tmpDir;
      const rcContent = [
        '# TerminalVibe OSC 7 shell integration',
        '# Source user\'s startup files',
        '[ -f ~/.bashrc ] && source ~/.bashrc 2>/dev/null || true',
        '[ -f ~/.bash_profile ] && source ~/.bash_profile 2>/dev/null || true',
        '[ -f ~/.profile ] && source ~/.profile 2>/dev/null || true',
        '',
        '# Report cwd on every prompt via OSC 7',
        '__terminal_vibe_cwd() {',
        '  printf "\\e]7;file://${HOSTNAME:-localhost}${PWD// /%20}\\a"',
        '}',
        'PROMPT_COMMAND="__terminal_vibe_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(tmpDir, "bashrc"), rcContent, "utf-8");
      shellArgs = ["--rcfile", path.join(tmpDir, "bashrc")];
    } else if (shellName === "zsh") {
      // For zsh, set ZDOTDIR to a temp dir with a custom .zshrc
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-zsh-"));
      this._tmpDir = tmpDir;
      const zshrcContent = [
        '# TerminalVibe OSC 7 shell integration',
        '# Source user\'s startup files',
        '[ -f ~/.zshrc ] && source ~/.zshrc 2>/dev/null || true',
        '',
        '# Report cwd on every prompt via OSC 7',
        '__terminal_vibe_cwd() {',
        '  printf "\\e]7;file://${HOST:-localhost}${PWD}\\a"',
        '}',
        'precmd_functions+=(__terminal_vibe_cwd)',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(tmpDir, ".zshrc"), zshrcContent, "utf-8");
      extraEnv.ZDOTDIR = tmpDir;
      shellArgs = ["-l"];
    }

    this._proc = pty.spawn(this.shell, shellArgs, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: spawnCwd,
      env: {
        ...process.env,
        ...extraEnv,
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
    // Clean up temp shell integration files
    if (this._tmpDir) {
      try { fs.rmSync(this._tmpDir, { recursive: true, force: true }); } catch {}
      this._tmpDir = null;
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
          const cwd = msg.cwd || null;
          if (sid && !SESSIONS[sid]) {
            try {
              const session = new PTYSession(sid, cols, rows, (data) => {
                if (ws.readyState === ws.OPEN) ws.send(data);
              }, cwd);
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
//  GRACEFUL SHUTDOWN — close all servers, kill sessions
// ─────────────────────────────────────────────────────────────

function shutdownGracefully() {
  console.log("[server] Shutting down gracefully...");

  // Close all PTY sessions
  for (const sid of Object.keys(SESSIONS)) {
    const session = SESSIONS[sid];
    if (session) {
      delete SESSIONS[sid];
      try { session.close(); } catch {}
    }
  }

  // Close servers
  let remaining = 0;
  function closeServer(server, name) {
    if (!server) return;
    // WebSocketServer uses internal _server; check that for listening state
    const isListening = server.listening || (server._server && server._server.listening);
    if (!isListening) return;
    remaining++;
    server.close(() => {
      console.log(`[server] ${name} closed`);
      remaining--;
      if (remaining === 0) process.exit(0);
    });
  }

  closeServer(proxyServer, "proxy");
  closeServer(appServer, "app");
  closeServer(wss, "websocket");

  // If nothing was listening, exit immediately
  if (remaining === 0) {
    process.exit(0);
  }

  // Safety timeout — force exit after 3 seconds
  setTimeout(() => {
    console.error("[server] Force exit after timeout");
    process.exit(1);
  }, 3000).unref();
}

process.on("SIGTERM", shutdownGracefully);
process.on("SIGINT", shutdownGracefully);
process.on("SIGQUIT", shutdownGracefully);
process.on("SIGHUP", shutdownGracefully);

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────

const isTauriMode = process.env.TAURI === "1" || process.env.TAURI_ENV === "1";

proxyServer.listen(PROXY_PORT, HOST, () => {
  console.log(`TerminalVibe iframe proxy listening on http://${HOST}:${PROXY_PORT}`);
});

if (!isTauriMode) {
  appServer.listen(APP_PORT, HOST, () => {
    console.log(`TerminalVibe app server listening on http://${HOST}:${APP_PORT}`);
  });
  console.log(`Open http://${HOST}:${APP_PORT} in your browser`);
}

console.log(`TerminalVibe PTY server listening on ws://${HOST}:${PORT}`);
