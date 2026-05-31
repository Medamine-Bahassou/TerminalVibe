#!/usr/bin/env node
/**
 * Terminus WebSocket PTY server + HTTP browser-proxy server.
 *
 * WebSocket server  ws://127.0.0.1:7681   — PTY multiplexer
 * HTTP proxy server http://127.0.0.1:7682 — transparent page fetcher for the browser tab
 * App server        http://127.0.0.1:6969 — serves terminal.html + static files
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
]);

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────────────────────
//  URL REWRITING
// ─────────────────────────────────────────────────────────────

function makeProxyUrl(targetUrl) {
  return `http://${HOST}:${PROXY_PORT}/proxy?url=${encodeURIComponent(targetUrl)}`;
}

function absUrl(href, baseUrl) {
  if (!href || href.startsWith("data:") || href.startsWith("javascript:"))
    return href;
  const parsed = new URL(baseUrl);
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (href.startsWith("//")) return parsed.protocol + href;
  if (href.startsWith("/")) return origin + href;
  if (!href.startsWith("http")) {
    const basePath = parsed.pathname.replace(/\/[^/]*$/, "");
    return `${origin}${basePath}/${href}`;
  }
  return href;
}

function proxy(href, baseUrl) {
  return makeProxyUrl(absUrl(href, baseUrl));
}

function rewriteHtml(html, baseUrl) {
  const parsed = new URL(baseUrl);
  const origin = `${parsed.protocol}//${parsed.host}`;

  // <base href>
  html = html.replace(
    /(<base\b[^>]*?\bhref\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );
  // inject <base> if missing
  if (!/<base\b/i.test(html)) {
    const baseTag = `<base href="${proxy(baseUrl, baseUrl)}">`;
    if (/<head>/i.test(html)) {
      html = html.replace(/<head>/i, `<head>${baseTag}`);
    } else {
      html = baseTag + html;
    }
  }

  // <link href>
  html = html.replace(
    /(<link\b[^>]*?\bhref\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );
  // <script src>
  html = html.replace(
    /(<script\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );
  // <img src>
  html = html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );

  // srcset
  html = html.replace(
    /(\bsrcset\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, value, post) => {
      const rewritten = value
        .split(",")
        .map((part) => {
          part = part.trim();
          if (!part) return "";
          const pieces = part.split(/\s+/);
          pieces[0] = proxy(pieces[0], baseUrl);
          return pieces.join(" ");
        })
        .join(", ");
      return pre + rewritten + post;
    }
  );

  // url() inside <style> blocks
  html = html.replace(
    /(<style\b[^>]*>)(.*?)(<\/style>)/gis,
    (m, open, body, close) => {
      const rewritten = body.replace(
        /url\((["']?)([^)'"]+)\1\)/gi,
        (m2, q, href) => {
          if (href.startsWith("data:")) return m2;
          return `url(${q}${proxy(href, baseUrl)}${q})`;
        }
      );
      return open + rewritten + close;
    }
  );

  // url() in inline style="..."
  html = html.replace(
    /(\bstyle\s*=\s*["'])(.*?)(["'])/gi,
    (m, pre, body, post) => {
      const rewritten = body.replace(
        /url\((["']?)([^)'"]+)\1\)/gi,
        (m2, q, href) => {
          if (href.startsWith("data:")) return m2;
          return `url(${q}${proxy(href, baseUrl)}${q})`;
        }
      );
      return pre + rewritten + post;
    }
  );

  // <video src/poster>, <audio src>, <source src>, <embed src>, <object data>
  html = html.replace(
    /(<video\b[^>]*?\b(?:src|poster)\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );
  html = html.replace(
    /(<audio\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );
  html = html.replace(
    /(<source\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );
  html = html.replace(
    /(<embed\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );
  html = html.replace(
    /(<object\b[^>]*?\bdata\s*=\s*["'])([^"']+)(["'])/gi,
    (m, pre, href, post) => pre + proxy(href, baseUrl) + post
  );

  return html;
}

function rewriteCss(css, baseUrl) {
  return css.replace(
    /url\((["']?)([^)'"]+)\1\)/gi,
    (m, q, href) => {
      if (href.startsWith("data:")) return m;
      return `url(${q}${makeProxyUrl(absUrl(href, baseUrl))}${q})`;
    }
  );
}

// ─────────────────────────────────────────────────────────────
//  HTTP PROXY SERVER
// ─────────────────────────────────────────────────────────────

function proxyFetch(targetUrl, reqHeaders) {
  return new Promise((resolve, reject) => {
    const targetParsed = new URL(targetUrl);
    const transport = targetParsed.protocol === "https:" ? https : http;

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
      method: "GET",
      headers,
      rejectUnauthorized: false, // permissive SSL like Python
      timeout: 15000,
    };

    const req = transport.request(opts, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrl).href;
        proxyFetch(redirectUrl, reqHeaders).then(resolve).catch(reject);
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

const proxyServer = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);

  // ── Resolve target URL ──
  let target;
  if (parsed.pathname.startsWith("/proxy")) {
    target = parsed.query.url;
    if (!target) {
      res.writeHead(400);
      res.end("Missing ?url=");
      return;
    }
    target = decodeURIComponent(target);
  } else {
    // Asset request — resolve via Referer
    const referer = req.headers.referer || "";
    target = null;
    if (referer && referer.includes("/proxy?url=")) {
      try {
        const refParsed = url.parse(referer, true);
        const orig = refParsed.query.url;
        if (orig) {
          target = new URL(parsed.pathname, decodeURIComponent(orig)).href;
        }
      } catch {}
    }
    if (!target) {
      res.writeHead(404);
      res.end();
      return;
    }
  }

  try {
    const result = await proxyFetch(target, req.headers);
    let { status, headers: respHeaders, body } = result;

    const contentType = respHeaders["content-type"] || "application/octet-stream";
    const ctBase = contentType.split(";")[0].trim().toLowerCase();
    let charset = "utf-8";
    if (contentType.includes("charset=")) {
      charset = contentType.split("charset=")[1].trim().split(";")[0].trim();
    }

    // Rewrite HTML/CSS
    if (ctBase === "text/html" || ctBase === "application/xhtml+xml") {
      try {
        let text = body.toString(charset === "utf-8" ? "utf-8" : "latin1");
        text = rewriteHtml(text, target);
        body = Buffer.from(text, "utf-8");
      } catch {}
    } else if (ctBase === "text/css") {
      try {
        let text = body.toString(charset === "utf-8" ? "utf-8" : "latin1");
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
  if (!filePath) filePath = "terminal.html";

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
      cwd: process.env.HOME,
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

appServer.listen(APP_PORT, HOST, () => {
  console.log(`Terminus app server listening on http://${HOST}:${APP_PORT}`);
});

console.log(`Terminus PTY server listening on ws://${HOST}:${PORT}`);
console.log(`Open http://${HOST}:${APP_PORT} in your browser`);
