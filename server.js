#!/usr/bin/env node
/**
 * TerminalVibe WebSocket PTY server + HTTP browser-proxy server.
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
const crypto = require("crypto");
const zlib = require("zlib");
const { WebSocketServer, WebSocket } = require("ws");
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
  "content-security-policy-report-only",
  "x-content-security-policy",
  "x-content-type-options",
  "transfer-encoding",
  "content-encoding",
  "x-xss-protection",
  "permissions-policy",
  "strict-transport-security",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-expose-headers",
]);

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────────────────────
//  LAST-USED TARGET — fallback for requests missing /p/<b64>/
// ─────────────────────────────────────────────────────────────
const _lastTargets = new Map(); // sessionId -> origin

// ─────────────────────────────────────────────────────────────
//  DISK LRU CACHE
// ─────────────────────────────────────────────────────────────

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, "cache");
const CACHE_SIZE_MB = parseInt(process.env.CACHE_SIZE_MB || "512", 10);
const CACHE_SIZE_LIMIT = CACHE_SIZE_MB * 1024 * 1024;

fs.mkdirSync(CACHE_DIR, { recursive: true });

class DiskCache {
  constructor(dir, sizeLimit) {
    this.dir = dir;
    this.sizeLimit = sizeLimit;
    this.indexPath = path.join(dir, "_index.json");
    this.index = {};
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
      this.currentSize -= entry.size || 0;
      delete this.index[key];
      this._save();
      return null;
    }
  }

  set(key, value) {
    const raw = JSON.stringify(value);
    const size = Buffer.byteLength(raw);
    const file = `${key}.json`;

    while (this.currentSize + size > this.sizeLimit && Object.keys(this.index).length > 0) {
      this._evict();
    }

    try { fs.writeFileSync(path.join(this.dir, file), raw); } catch { return; }
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

const diskCache = new DiskCache(CACHE_DIR, CACHE_SIZE_LIMIT);

function cacheKey(targetUrl) {
  return crypto.createHash("sha256").update(targetUrl).digest("hex");
}

// ─────────────────────────────────────────────────────────────
//  PATH-BASED PROXY URL
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

function proxyPathUrl(fullUrl) {
  const u = new URL(fullUrl);
  const origin = u.origin;
  const p = fullUrl.substring(origin.length) || "/";
  return `http://${HOST}:${PROXY_PORT}/p/${toB64url(origin)}${p}`;
}

function resolveProxyPath(pathname, search) {
  const m = pathname.match(/^\/p\/([A-Za-z0-9\-_=]+)(\/.*)?$/);
  if (!m) return null;
  const origin = fromB64url(m[1]);
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) return null;
  const rest = (m[2] || "/") + search;
  return origin.replace(/\/+$/, "") + rest;
}

function proxyAbsPath(absPath, baseUrl) {
  if (!absPath.startsWith("/")) return null;
  try {
    const abs = new URL(absPath, baseUrl).href;
    const u = new URL(abs);
    const rest = abs.substring(u.origin.length) || "/";
    return `/p/${toB64url(u.origin)}${rest}`;
  } catch { return null; }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────
//  HTML / CSS / JS REWRITING
// ─────────────────────────────────────────────────────────────

function rewriteHtml(html, pageUrl) {
  // Strip framing/CSP meta tags
  html = html.replace(
    /<meta\b[^>]*\bhttp-equiv\s*=\s*["'](?:x-frame-options|content-security-policy|content-security-policy-report-only)["'][^>]*>\s*/gi,
    ""
  );

  // Detect existing <base href>
  let baseHref = pageUrl;
  const existing = html.match(/<base\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/i);
  if (existing) {
    try { baseHref = new URL(existing[1], pageUrl).href; } catch {}
  }

  const baseDirUrl = new URL(".", baseHref).href;
  const pb = proxyPathUrl(baseDirUrl);

  // Replace or inject <base>
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

  // Rewrite absolute-path resource attributes
  const RESOURCE_ATTRS = /((?:src|href|poster|data|action)\s*=\s*["'])\/([^"']+)(["'])/gi;
  html = html.replace(RESOURCE_ATTRS, (m, pre, p, post) => {
    const proxied = proxyAbsPath("/" + p, pageUrl);
    return proxied ? pre + proxied + post : m;
  });

  // Rewrite cross-origin URLs: src="https://..."
  const CROSS_ORIGIN_ATTRS = /((?:src|href|poster|data|action)\s*=\s*["'])(https?:\/\/[^"']+)(["'])/gi;
  html = html.replace(CROSS_ORIGIN_ATTRS, (m, pre, attrUrl, post) => {
    try {
      const u = new URL(attrUrl);
      if (u.host === `${HOST}:${PROXY_PORT}`) return m;
      return pre + proxyPathUrl(attrUrl) + post;
    } catch { return m; }
  });

  // Rewrite protocol-relative: src="//..."
  const PROTO_REL_ATTRS = /((?:src|href|poster|data|action)\s*=\s*["'])(\/\/[^"']+)(["'])/gi;
  html = html.replace(PROTO_REL_ATTRS, (m, pre, attrUrl, post) => {
    try {
      const abs = new URL(attrUrl, pageUrl).href;
      return pre + proxyPathUrl(abs) + post;
    } catch { return m; }
  });

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
          if (pieces[0].startsWith("/")) {
            pieces[0] = proxyAbsPath(pieces[0], pageUrl) || pieces[0];
          } else if (pieces[0].startsWith("//")) {
            try { pieces[0] = proxyPathUrl(new URL(pieces[0], pageUrl).href); } catch {}
          } else if (/^https?:/.test(pieces[0])) {
            pieces[0] = proxyPathUrl(pieces[0]);
          }
          return pieces.join(" ");
        })
        .join(", ");
      return pre + rewritten + post;
    }
  );

  // CSS url() in <style> blocks
  html = html.replace(
    /(<style\b[^>]*>)(.*?)(<\/style>)/gis,
    (m, open, body, close) => open + rewriteCssUrls(body, pageUrl) + close
  );

  // CSS url() in inline style=""
  html = html.replace(
    /(\bstyle\s*=\s*["'])(.*?)(["'])/gi,
    (m, pre, body, post) => pre + rewriteCssUrls(body, pageUrl) + post
  );

  // Anti-frame-detection shim + runtime interceptors + nav tracker
  if (/<\/body>/i.test(html)) {
    const injected = `<script>
(function(){
  // ──── Anti-frame-busting ────
  try {
    var _s = window;
    Object.defineProperty(window, 'top',         { get: function(){ return _s; }, configurable: true });
    Object.defineProperty(window, 'parent',      { get: function(){ return _s; }, configurable: true });
    Object.defineProperty(window, 'frameElement',{ get: function(){ return null; }, configurable: true });
    window.close = function(){};
  } catch(e) {}

  // ──── Proxy URL builder ────
  var _po = location.origin;
  var _b64 = function(s){ return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); };

  function _pu(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('data:') || url.startsWith('blob:') ||
        url.startsWith('javascript:') || url.startsWith('about:') ||
        url.startsWith('mailto:') || url.startsWith('tel:')) return url;
    if (url.startsWith(_po + '/p/')) return url;
    if (url.startsWith('/p/')) return _po + url;
    if (!url.startsWith('http') && !url.startsWith('//')) return url;
    if (url.startsWith('//')) url = location.protocol + url;
    try {
      var u = new URL(url, location.href);
      return _po + '/p/' + _b64(u.origin) + u.pathname + u.search;
    } catch(ex) { return url; }
  }

  // ──── Override fetch ────
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string') {
        input = _pu(input);
      } else if (input instanceof Request) {
        var nu = _pu(input.url);
        if (nu !== input.url) input = new Request(nu, input);
      }
    } catch(e) {}
    return _fetch.apply(this, arguments);
  };

  // ──── Override XMLHttpRequest ────
  var _xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try {
      if (typeof url === 'string') arguments[1] = _pu(url);
    } catch(e) {}
    return _xo.apply(this, arguments);
  };

  // ──── Override WebSocket ────
  var _ws = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    try {
      if (typeof url === 'string' && /^wss?:\\/\\//.test(url)) {
        var hu = url.replace(/^ws/, 'http');
        var u = new URL(hu);
        url = 'ws://' + location.host + '/ws/' + _b64(u.origin) + u.pathname + u.search;
      }
    } catch(e) {}
    if (protocols) return new _ws(url, protocols);
    return new _ws(url);
  };
  window.WebSocket.prototype = _ws.prototype;
  window.WebSocket.CONNECTING = _ws.CONNECTING;
  window.WebSocket.OPEN = _ws.OPEN;
  window.WebSocket.CLOSING = _ws.CLOSING;
  window.WebSocket.CLOSED = _ws.CLOSED;

  // ──── Override EventSource ────
  var _es = window.EventSource;
  if (_es) {
    window.EventSource = function(url, opts) {
      try { if (typeof url === 'string') url = _pu(url); } catch(e) {}
      return new _es(url, opts);
    };
  }

  // ──── Override navigator.sendBeacon ────
  var _sb = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function(url, data) {
    try { url = _pu(url); } catch(e) {}
    return _sb(url, data);
  };

  // ──── Override History API ────
  var _ps = history.pushState;
  var _rs = history.replaceState;
  history.pushState = function(st, title, url) {
    try { if (url) url = _pu(url); } catch(e) {}
    return _ps.call(this, st, title, url);
  };
  history.replaceState = function(st, title, url) {
    try { if (url) url = _pu(url); } catch(e) {}
    return _rs.call(this, st, title, url);
  };

  // ──── Override <a> and <area> click to proxy navigation ────
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a, area');
    if (!a) return;
    try {
      var href = a.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        var proxied = _pu(href);
        if (proxied !== href) a.href = proxied;
      }
    } catch(ex) {}
  }, true);

  // ──── Override window.open ────
  var _wo = window.open;
  window.open = function(url) {
    try { if (url) arguments[0] = _pu(url); } catch(e) {}
    return _wo.apply(this, arguments);
  };

  // ──── Navigation tracking for parent ────
  var _lastHref = location.href;
  setInterval(function() {
    var cur = location.href;
    if (cur === _lastHref) return;
    _lastHref = cur;
    try { parent.postMessage({ terminalVibeNav: cur }, '*'); } catch(e) {}
  }, 500);

  // ──── Block script-based frame-busting ────
  window.onbeforeunload = null;
  document.addEventListener('beforeunload', function(e) { e.stopImmediatePropagation(); }, true);
})();
<\/script>`;
    html = html.replace(/<\/body>/i, injected + "</body>");
  }

  return html;
}

function rewriteCssUrls(css, pageUrl) {
  return css.replace(
    /url\(\s*(['"]?)\s*([^)'"]+)\1\s*\)/gi,
    (m, q, inner) => {
      inner = inner.trim();
      try {
        if (inner.startsWith("/")) {
          const abs = new URL(inner, pageUrl).href;
          return `url(${q}${proxyPathUrl(abs)}${q})`;
        } else if (inner.startsWith("//")) {
          const abs = new URL(inner, pageUrl).href;
          return `url(${q}${proxyPathUrl(abs)}${q})`;
        } else if (/^https?:/.test(inner)) {
          return `url(${q}${proxyPathUrl(inner)}${q})`;
        }
      } catch {}
      return m;
    }
  );
}

function rewriteCss(css, cssUrl) {
  return rewriteCssUrls(css, cssUrl);
}

function rewriteJs(jsContent, targetUrl) {
  let hostname;
  try { hostname = new URL(targetUrl).hostname; } catch { return jsContent; }
  const pattern = new RegExp(
    `(["'])https?://${escapeRegex(hostname)}(/[^"']*?)(\\1)`,
    "g"
  );
  const text = jsContent.toString("utf-8");
  return Buffer.from(text.replace(pattern, "$1$2$3"), "utf-8");
}

// ─────────────────────────────────────────────────────────────
//  DNS CACHE + UPSTREAM FETCH
// ─────────────────────────────────────────────────────────────

const _dnsCache = new Map();
const DNS_TTL_MS = 30_000;
const dns = require("dns").promises;

async function resolveHost(hostname) {
  const now = Date.now();
  const cached = _dnsCache.get(hostname);
  if (cached && cached.expires > now) return cached.addrs[0];

  let addrs;
  try {
    addrs = await dns.resolve4(hostname);
  } catch {
    try {
      const v6 = await dns.resolve6(hostname);
      addrs = v6.map((a) => `[${a}]`);
    } catch {
      const result = await dns.lookup(hostname, { family: 0 });
      addrs = [result.address];
    }
  }

  if (!addrs || !addrs.length) throw new Error(`DNS resolution failed for ${hostname}`);
  _dnsCache.set(hostname, { addrs, expires: now + DNS_TTL_MS });
  return addrs[0];
}

function proxyFetch(targetUrl, reqHeaders, method, body, _redirectDepth) {
  const depth = _redirectDepth || 0;
  if (depth > 8) return Promise.reject(new Error("Too many redirects"));

  return new Promise(async (resolve, reject) => {
    let targetParsed;
    try { targetParsed = new URL(targetUrl); }
    catch (e) { return reject(new Error("Invalid URL: " + targetUrl)); }

    const transport = targetParsed.protocol === "https:" ? https : http;
    const reqMethod = (method || "GET").toUpperCase();

    let resolvedIp;
    try {
      resolvedIp = await resolveHost(targetParsed.hostname);
    } catch (e) {
      return reject(new Error(`DNS error for ${targetParsed.hostname}: ${e.message}`));
    }

    const port = targetParsed.port
      ? parseInt(targetParsed.port)
      : targetParsed.protocol === "https:" ? 443 : 80;

    const headers = {
      "User-Agent": BROWSER_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Host": targetParsed.port && targetParsed.port !== "80" && targetParsed.port !== "443"
        ? `${targetParsed.hostname}:${targetParsed.port}`
        : targetParsed.hostname,
    };

    const FORWARD_HEADERS = new Set([
      "cookie", "authorization", "content-type", "content-length",
      "x-requested-with", "x-csrf-token",
    ]);
    if (reqHeaders) {
      for (const [k, v] of Object.entries(reqHeaders)) {
        if (FORWARD_HEADERS.has(k.toLowerCase())) headers[k] = v;
      }
    }

    const opts = {
      hostname: resolvedIp,
      port,
      path: (targetParsed.pathname || "/") + (targetParsed.search || ""),
      method: reqMethod,
      headers,
      rejectUnauthorized: false,
      timeout: 20000,
      servername: targetParsed.hostname,
    };

    const req = transport.request(opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrl).href;
        const nextMethod = [301, 302, 303].includes(res.statusCode) ? "GET" : reqMethod;
        proxyFetch(redirectUrl, reqHeaders, nextMethod, nextMethod === "GET" ? null : body, depth + 1)
          .then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const encoding = (res.headers["content-encoding"] || "").toLowerCase();

        function decompress(buf, enc, cb) {
          const zlib = require("zlib");
          if (enc === "gzip") return zlib.gunzip(buf, cb);
          if (enc === "deflate") return zlib.inflate(buf, (e, d) => e ? zlib.inflateRaw(buf, cb) : cb(null, d));
          if (enc === "br") return zlib.brotliDecompress(buf, cb);
          cb(null, buf);
        }

        decompress(raw, encoding, (err, body) => {
          if (err) body = raw;
          const outHeaders = Object.assign({}, res.headers);
          delete outHeaders["content-encoding"];
          delete outHeaders["transfer-encoding"];
          resolve({ status: res.statusCode || 200, headers: outHeaders, body: body || Buffer.alloc(0) });
        });
      });
      res.on("error", reject);
    });

    req.on("error", (e) => {
      _dnsCache.delete(targetParsed.hostname);
      reject(e);
    });
    req.on("timeout", () => {
      req.destroy();
      _dnsCache.delete(targetParsed.hostname);
      reject(new Error("Request timed out"));
    });

    if (body && !["GET", "HEAD"].includes(reqMethod)) {
      req.write(body);
    }
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
//  SERVICE WORKER
// ─────────────────────────────────────────────────────────────

const SW_SCRIPT = [
  "'use strict';",
  "self.addEventListener('install',function(e){e.waitUntil(self.skipWaiting())});",
  "self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});",
  "var _tb64=function(s){return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')};",
  "self.addEventListener('fetch',function(e){",
  "var u=new URL(e.request.url);",
  // Skip SW itself, already-proxied /p/ requests, and same-origin proxy root requests
  "if(u.pathname==='/sw.js'||u.pathname.indexOf('/p/')===0)return;",
  "if(u.origin===self.location.origin)return;",
  "e.respondWith((async function(){",
  // Get the target origin's b64 from the client URL or referrer
  "var pb64=null;",
  "try{var c=await self.clients.get(e.clientId);if(c&&c.url.indexOf('/p/')>=0){",
  "var m=c.url.match(/\\/p\\/([A-Za-z0-9\\-_=]+)/);if(m)pb64=m[1];",
  "}}catch(ex){}",
  "if(!pb64){var ref=e.request.referrer||'';",
  "var m2=ref.match(/\\/p\\/([A-Za-z0-9\\-_=]+)/);if(m2)pb64=m2[1];}",
  // Route through proxy using the target's b64, or encode the target's own origin
  "var pp=pb64?'/p/'+pb64+u.pathname+u.search:'/p/'+_tb64(u.origin)+u.pathname+u.search;",
  "var opts={method:e.request.method,headers:e.request.headers};",
  "if(e.request.method!=='GET'&&e.request.method!=='HEAD'){",
  "try{opts.body=await e.request.clone().arrayBuffer();}catch(ex){}}",
  "return fetch(pp,opts);",
  "})());",
  "});",
].join("");

// ─────────────────────────────────────────────────────────────
//  PROXY SERVER
// ─────────────────────────────────────────────────────────────

const proxyServer = http.createServer(async (req, res) => {
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

  // Service Worker
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

  // Resolve target URL
  let target;
  target = resolveProxyPath(parsed.pathname, parsed.search || "");

  if (!target && parsed.pathname.startsWith("/proxy")) {
    const q = parsed.query.url;
    if (q) target = decodeURIComponent(q);
  }

  // Fallback 1: extract target origin from Referer header
  if (!target && req.headers.referer) {
    try {
      const refUrl = new URL(req.headers.referer);
      const refTarget = resolveProxyPath(refUrl.pathname, refUrl.search || "");
      if (refTarget) {
        const refOrigin = new URL(refTarget).origin;
        target = refOrigin + parsed.pathname + (parsed.search || "");
      }
    } catch {}
  }

  // Fallback 2: read target from cookie set by previous /p/<b64>/ request
  if (!target && req.headers.cookie) {
    const match = req.headers.cookie.match(/tv-proxy-target=([^;]+)/);
    if (match) {
      try {
        const origin = decodeURIComponent(match[1]);
        if (origin.startsWith("http://") || origin.startsWith("https://")) {
          target = origin + parsed.pathname + (parsed.search || "");
        }
      } catch {}
    }
  }

  if (!target) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Disk cache check (GET only)
  const useCache = req.method === "GET";
  const cKey = useCache ? cacheKey(target) : null;

  if (useCache && cKey) {
    const cached = diskCache.get(cKey);
    if (cached) {
      const body = Buffer.from(cached.body, "base64");
      const outHeaders = { ...cached.headers, "Content-Length": body.length };
      res.writeHead(cached.status, outHeaders);
      res.end(body);
      return;
    }
  }

  try {
    // Collect request body for POST/PUT/PATCH
    let reqBody = null;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      reqBody = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
      });
    }

    // Build upstream request
    let targetParsed;
    try { targetParsed = new URL(target); } catch { res.writeHead(400); res.end("Bad URL"); return; }

    const transport = targetParsed.protocol === "https:" ? https : http;
    const resolvedIp = await resolveHost(targetParsed.hostname);
    const port = targetParsed.port
      ? parseInt(targetParsed.port)
      : targetParsed.protocol === "https:" ? 443 : 80;

    const upstreamHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": req.headers.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Host": targetParsed.hostname + (port !== 80 && port !== 443 ? `:${port}` : ""),
    };

    const FORWARD_REQ_HEADERS = new Set([
      "cookie", "authorization", "content-type", "content-length",
      "x-requested-with", "x-csrf-token", "range", "if-range",
      "if-none-match", "if-modified-since", "accept", "accept-language",
      "origin", "referer",
    ]);
    for (const [k, v] of Object.entries(req.headers)) {
      if (FORWARD_REQ_HEADERS.has(k.toLowerCase())) upstreamHeaders[k] = v;
    }

    const upstreamPath = (targetParsed.pathname || "/") + (targetParsed.search || "");

    const proxyReq = transport.request({
      hostname: resolvedIp,
      port,
      path: upstreamPath,
      method: req.method,
      headers: { ...upstreamHeaders, ...(reqBody ? { "Content-Length": reqBody.length } : {}) },
      rejectUnauthorized: false,
      servername: targetParsed.hostname,
      timeout: 30000,
    }, (proxyRes) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        let redirectUrl;
        try { redirectUrl = new URL(proxyRes.headers.location, target).href; }
        catch { redirectUrl = proxyRes.headers.location; }
        const proxiedRedirect = proxyPathUrl(redirectUrl);
        res.writeHead(proxyRes.statusCode, { "Location": proxiedRedirect });
        res.end();
        proxyRes.resume();
        return;
      }

      const contentType = proxyRes.headers["content-type"] || "application/octet-stream";
      const ct = contentType.toLowerCase();
      const needsRewriting = ct.includes("text/html") || ct.includes("text/css") ||
                             ct.includes("javascript") || ct.includes("text/js");

      // Build outbound headers
      const outHeaders = {};
      for (const [name, value] of Object.entries(proxyRes.headers)) {
        const lk = name.toLowerCase();
        if (SKIP_RESPONSE_HEADERS.has(lk)) continue;
        if (lk === "content-length" && needsRewriting) continue;
        if (lk === "content-encoding") continue;
        outHeaders[name] = value;
      }
      outHeaders["access-control-allow-origin"] = reqOrigin || "*";
      outHeaders["access-control-allow-credentials"] = "true";

      // Set cookie for fallback target resolution
      if (parsed.pathname.startsWith("/p/")) {
        try {
          const targetOrigin = new URL(target).origin;
          outHeaders["Set-Cookie"] =
            `tv-proxy-target=${encodeURIComponent(targetOrigin)}; Path=/; SameSite=Lax; Max-Age=3600`;
        } catch {}
      }

      if (needsRewriting) {
        // Buffer → Decompress → Rewrite → Send
        const chunks = [];
        proxyRes.on("data", c => chunks.push(c));
        proxyRes.on("end", () => {
          let body = Buffer.concat(chunks);

          const encoding = (proxyRes.headers["content-encoding"] || "").toLowerCase();
          if (encoding === "gzip") {
            try { body = zlib.gunzipSync(body); } catch {}
          } else if (encoding === "br") {
            try { body = zlib.brotliDecompressSync(body); } catch {}
          } else if (encoding === "deflate") {
            try { body = zlib.inflateSync(body); } catch { try { body = zlib.inflateRawSync(body); } catch {} }
          }

          const charset = /charset=([^\s;]+)/i.test(contentType)
            ? RegExp.$1.trim() : "utf-8";
          const enc = /utf-?8/i.test(charset) ? "utf-8" : "latin1";
          let text = body.toString(enc);

          if (ct.includes("text/html")) {
            text = rewriteHtml(text, target);
          } else if (ct.includes("text/css")) {
            text = rewriteCss(text, target);
          }

          const outBody = Buffer.from(text, "utf-8");
          outHeaders["Content-Length"] = outBody.length;

          // Cache text responses
          if (req.method === "GET" && proxyRes.statusCode === 200 && cKey) {
            diskCache.set(cKey, {
              status: proxyRes.statusCode,
              headers: outHeaders,
              body: outBody.toString("base64"),
            });
          }

          res.writeHead(proxyRes.statusCode, outHeaders);
          res.end(outBody);
        });
      } else {
        // STREAM binary content directly (video, images, fonts, etc.)
        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.pipe(res);
      }
    });

    proxyReq.on("error", (e) => {
      _dnsCache.delete(targetParsed.hostname);
      if (!res.headersSent) res.writeHead(502);
      res.end(`Proxy error: ${e.message}`);
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      _dnsCache.delete(targetParsed.hostname);
      if (!res.headersSent) res.writeHead(504);
      res.end("Gateway timeout");
    });

    if (reqBody) proxyReq.write(reqBody);
    proxyReq.end();

  } catch (err) {
    if (!res.headersSent) res.writeHead(502);
    res.end(`Proxy error: ${err.message}`);
  }
});

// ─────────────────────────────────────────────────────────────
//  WEBSOCKET PROXY (on proxy server port)
// ─────────────────────────────────────────────────────────────

const wsProxy = new WebSocketServer({ noServer: true });

proxyServer.on("upgrade", (req, socket, head) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // WebSocket proxy: /ws/<b64-origin>/path
  if (pathname.startsWith("/ws/")) {
    const rest = pathname.slice(4);
    const m = rest.match(/^([A-Za-z0-9\-_=]+)(\/.*)?$/);
    if (!m) { socket.destroy(); return; }

    const origin = fromB64url(m[1]);
    if (!/^https?:\/\//.test(origin)) { socket.destroy(); return; }

    const wsOrigin = origin.replace(/^http/, "ws");
    const wsPath = (m[2] || "/") + (parsed.search || "");
    const wsTarget = wsOrigin + wsPath;

    wsProxy.handleUpgrade(req, socket, head, (clientWs) => {
      let upstreamWs;
      try {
        upstreamWs = new WebSocket(wsTarget, {
          headers: { "User-Agent": BROWSER_UA, "Origin": origin },
          rejectUnauthorized: false,
        });
      } catch {
        clientWs.close(1011, "Upstream connection failed");
        return;
      }

      upstreamWs.on("open", () => {
        clientWs.on("message", (data) => {
          if (upstreamWs.readyState === WebSocket.OPEN) upstreamWs.send(data);
        });
        upstreamWs.on("message", (data) => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });
      });

      clientWs.on("close", (code, reason) => upstreamWs.close(code, reason));
      upstreamWs.on("close", (code, reason) => clientWs.close(code, reason));
      clientWs.on("error", () => upstreamWs.close());
      upstreamWs.on("error", () => clientWs.close());
    });
    return;
  }

  // Also handle /p/<b64>/ WebSocket upgrades (some sites use same path)
  if (pathname.startsWith("/p/")) {
    const target = resolveProxyPath(pathname, parsed.search || "");
    if (!target) { socket.destroy(); return; }

    const wsTarget = target.replace(/^http/, "ws");

    wsProxy.handleUpgrade(req, socket, head, (clientWs) => {
      let upstreamWs;
      try {
        upstreamWs = new WebSocket(wsTarget, {
          headers: { "User-Agent": BROWSER_UA, "Origin": new URL(target).origin },
          rejectUnauthorized: false,
        });
      } catch {
        clientWs.close(1011, "Upstream connection failed");
        return;
      }

      upstreamWs.on("open", () => {
        clientWs.on("message", (data) => {
          if (upstreamWs.readyState === WebSocket.OPEN) upstreamWs.send(data);
        });
        upstreamWs.on("message", (data) => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });
      });

      clientWs.on("close", (code, reason) => upstreamWs.close(code, reason));
      upstreamWs.on("close", (code, reason) => clientWs.close(code, reason));
      clientWs.on("error", () => upstreamWs.close());
      upstreamWs.on("error", () => clientWs.close());
    });
    return;
  }

  socket.destroy();
});

// ─────────────────────────────────────────────────────────────
//  STATIC APP SERVER
// ─────────────────────────────────────────────────────────────

const appServer = http.createServer((req, res) => {
  let filePath = url.parse(req.url).pathname.replace(/^\//, "");
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
  console.log(`TerminalVibe proxy server listening on http://${HOST}:${PROXY_PORT}`);
  console.log(`Disk cache: ${path.resolve(CACHE_DIR)} (limit: ${CACHE_SIZE_MB} MB)`);
});

const isTauriMode = process.env.TAURI === "1" || process.env.TAURI_ENV === "1";

if (!isTauriMode) {
  appServer.listen(APP_PORT, HOST, () => {
    console.log(`TerminalVibe app server listening on http://${HOST}:${APP_PORT}`);
  });
  console.log(`Open http://${HOST}:${APP_PORT} in your browser`);
}

console.log(`TerminalVibe PTY server listening on ws://${HOST}:${PORT}`);
