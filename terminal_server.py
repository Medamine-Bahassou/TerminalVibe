#!/usr/bin/env python3
"""
Terminus WebSocket PTY server  +  HTTP browser-proxy server.

WebSocket server  ws://127.0.0.1:7681   — PTY multiplexer
HTTP proxy server http://127.0.0.1:7682 — transparent page fetcher for the browser tab

HTTP proxy endpoints
--------------------
  GET /proxy?url=<encoded>        fetch any URL, rewrite sub-resources, return with CORS
  OPTIONS *                       preflight

The proxy:
  - Forwards a real browser User-Agent so sites don't block the request
  - Follows redirects automatically (urllib does this)
  - Rewrites <base>, <link>, <script src>, <img src>, url() in CSS so
    sub-resources also load through the proxy → pages render like a real browser
  - Strips X-Frame-Options / CSP response headers (irrelevant server-side)
  - Returns wide-open CORS headers so the frontend fetch() succeeds
"""

import asyncio
import fcntl
import json
import os
import re
import signal
import socket
import ssl
import struct
import sys
import termios
import threading
import urllib.parse
import warnings

# Bypass system environment proxies for local addresses
os.environ["no_proxy"] = "localhost,127.0.0.1,::1"

# Permissive SSL context for local / self-signed dev servers
_ssl_noverify = ssl._create_unverified_context()
import websockets
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

HOST = "127.0.0.1"
PORT = 7681        # WebSocket PTY
PROXY_PORT = 7682  # HTTP proxy for browser tab
APP_PORT = 6969    # HTTP app server (serves terminal.html + static files)

SESSIONS: dict[str, "PTYSession"] = {}

# ─────────────────────────────────────────────────────────────
#  HTTP PROXY SERVER
# ─────────────────────────────────────────────────────────────

SKIP_RESPONSE_HEADERS = {
    "x-frame-options", "content-security-policy",
    "x-content-type-options", "transfer-encoding",
    "content-encoding",  # we decode on the server side
    "x-xss-protection", "permissions-policy",
    "strict-transport-security",
    "cross-origin-embedder-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
}

BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def make_proxy_url(target_url: str) -> str:
    return f"http://{HOST}:{PROXY_PORT}/proxy?url={urllib.parse.quote(target_url, safe='')}"


def rewrite_html(html: str, base_url: str) -> str:
    """Rewrite resource URLs in HTML so they load through the proxy."""
    parsed = urllib.parse.urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    def abs_url(href: str) -> str:
        if not href or href.startswith("data:") or href.startswith("javascript:"):
            return href
        if href.startswith("//"):
            return parsed.scheme + ":" + href
        if href.startswith("/"):
            return origin + href
        if not href.startswith("http"):
            # relative
            base_path = parsed.path.rsplit("/", 1)[0]
            return f"{origin}{base_path}/{href}"
        return href

    def proxy(href: str) -> str:
        return make_proxy_url(abs_url(href))

    # <base href> — set to our proxy so relative fetches work automatically
    html = re.sub(
        r'(<base\b[^>]*?\bhref\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    # inject <base> if missing so relative URLs resolve through proxy
    if "<base" not in html.lower():
        html = html.replace(
            "<head>", f'<head><base href="{proxy(base_url)}">', 1
        )
        if "<head>" not in html.lower():
            html = f'<base href="{proxy(base_url)}">' + html

    # <link href>
    html = re.sub(
        r'(<link\b[^>]*?\bhref\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    # <script src>
    html = re.sub(
        r'(<script\b[^>]*?\bsrc\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    # <img src>
    html = re.sub(
        r'(<img\b[^>]*?\bsrc\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    # srcset
    def rewrite_srcset(m):
        parts = m.group(2).split(",")
        rewritten = []
        for part in parts:
            part = part.strip()
            if not part:
                continue
            pieces = part.split()
            pieces[0] = proxy(pieces[0])
            rewritten.append(" ".join(pieces))
        return m.group(1) + ", ".join(rewritten) + m.group(3)
    html = re.sub(
        r'(\bsrcset\s*=\s*["\'])([^"\']+)(["\'])',
        rewrite_srcset, html, flags=re.IGNORECASE
    )
    # url() inside <style> blocks only (not JS strings)
    def rewrite_css_url(m):
        q = m.group(1)  # quote char or empty
        href = m.group(2)
        if href.startswith("data:"):
            return m.group(0)
        return f"url({q}{proxy(href)}{q})"
    def rewrite_style_block(m):
        return m.group(1) + re.sub(
            r'url\((["\']?)([^)\'"]+)\1\)', rewrite_css_url, m.group(2)
        ) + m.group(3)
    html = re.sub(
        r'(<style\b[^>]*>)(.*?)(</style>)',
        rewrite_style_block, html, flags=re.I | re.S
    )
    # url() in inline style="..." attributes
    def rewrite_style_attr(m):
        return m.group(1) + re.sub(
            r'url\((["\']?)([^)\'"]+)\1\)', rewrite_css_url, m.group(2)
        ) + m.group(3)
    html = re.sub(
        r'(\bstyle\s*=\s*["\'])(.*?)(["\'])',
        rewrite_style_attr, html, flags=re.I
    )
    # <video src> and poster
    html = re.sub(
        r'(<video\b[^>]*?\b(?:src|poster)\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    # <audio src>
    html = re.sub(
        r'(<audio\b[^>]*?\bsrc\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    # <source src>
    html = re.sub(
        r'(<source\b[^>]*?\bsrc\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    # <embed src>
    html = re.sub(
        r'(<embed\b[^>]*?\bsrc\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    # <object data>
    html = re.sub(
        r'(<object\b[^>]*?\bdata\s*=\s*["\'])([^"\']+)(["\'])',
        lambda m: m.group(1) + proxy(m.group(2)) + m.group(3),
        html, flags=re.IGNORECASE
    )
    return html


def rewrite_css(css: str, base_url: str) -> str:
    parsed = urllib.parse.urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    def abs_url(href: str) -> str:
        if not href or href.startswith("data:"):
            return href
        if href.startswith("//"):
            return parsed.scheme + ":" + href
        if href.startswith("/"):
            return origin + href
        if not href.startswith("http"):
            base_path = parsed.path.rsplit("/", 1)[0]
            return f"{origin}{base_path}/{href}"
        return href

    def rewrite_css_url(m):
        q = m.group(1)
        href = m.group(2)
        if href.startswith("data:"):
            return m.group(0)
        return f"url({q}{make_proxy_url(abs_url(href))}{q})"

    return re.sub(r'url\((["\']?)([^)\'"]+)\1\)', rewrite_css_url, css)


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence access log

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # ── Resolve target URL ──
        if parsed.path.startswith("/proxy"):
            qs = urllib.parse.parse_qs(parsed.query)
            target = qs.get("url", [None])[0]
            if not target:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing ?url=")
                return
            target = urllib.parse.unquote(target)
        else:
            # Asset request (e.g. /style.css) — resolve via Referer
            referer = self.headers.get("Referer", "")
            target = None
            if referer and "/proxy?url=" in referer:
                try:
                    ref_qs = urllib.parse.parse_qs(
                        urllib.parse.urlparse(referer).query)
                    orig = ref_qs.get("url", [None])[0]
                    if orig:
                        target = urllib.parse.urljoin(
                            urllib.parse.unquote(orig), self.path)
                except Exception:
                    pass
            if not target:
                self.send_response(404)
                self.end_headers()
                return

        req = Request(target)
        req.add_header("User-Agent", BROWSER_UA)
        req.add_header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        req.add_header("Accept-Language", "en-US,en;q=0.9")
        req.add_header("Accept-Encoding", "identity")  # no compression — simpler
        req.add_header("Connection", "keep-alive")
        req.add_header("Upgrade-Insecure-Requests", "1")
        # Pass Host and Referer matching the target so local dev servers work
        target_parsed = urllib.parse.urlparse(target)
        if target_parsed.hostname:
            host_header = target_parsed.hostname
            if target_parsed.port:
                host_header += f":{target_parsed.port}"
            req.add_header("Host", host_header)
        req.add_header("Referer", target)

        try:
            with urlopen(req, timeout=15, context=_ssl_noverify) as resp:
                status = resp.getcode() or resp.status or 200
                if status is None:
                    status = 200
                content_type = resp.headers.get("Content-Type", "application/octet-stream")
                body = resp.read()

        except HTTPError as e:
            status = e.code or 500
            content_type = e.headers.get("Content-Type", "text/plain")
            body = e.read()
        except URLError as e:
            self.send_response(502)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(f"Proxy error: {e.reason}".encode())
            return
        except Exception as e:
            self.send_response(502)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(str(e).encode())
            return

        # Rewrite HTML / CSS so sub-resources load through proxy
        ct_base = content_type.split(";")[0].strip().lower()
        charset = "utf-8"
        if "charset=" in content_type:
            charset = content_type.split("charset=")[-1].strip().split(";")[0].strip()

        if ct_base in ("text/html", "application/xhtml+xml"):
            try:
                text = body.decode(charset, errors="replace")
                text = rewrite_html(text, target)
                body = text.encode("utf-8")
                content_type = "text/html; charset=utf-8"
            except Exception:
                pass
        elif ct_base == "text/css":
            try:
                text = body.decode(charset, errors="replace")
                text = rewrite_css(text, target)
                body = text.encode("utf-8")
                content_type = "text/css; charset=utf-8"
            except Exception:
                pass

        try:
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except BrokenPipeError:
            pass  # client disconnected


# ─────────────────────────────────────────────────────────────
#  STATIC APP SERVER  (serves terminal.html, app.js, style.css …)
# ─────────────────────────────────────────────────────────────

APP_DIR = os.path.dirname(os.path.abspath(__file__))

MIME_TYPES = {
    ".html": "text/html",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".woff2": "font/woff2",
    ".woff":  "font/woff",
}


class AppHandler(BaseHTTPRequestHandler):
    """Serve the frontend static files."""

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        path = self.path.split("?")[0].lstrip("/")
        if not path or path == "/":
            path = "terminal.html"

        filepath = os.path.join(APP_DIR, path)
        filepath = os.path.realpath(filepath)

        # security: stay inside APP_DIR
        if not filepath.startswith(APP_DIR):
            self.send_response(403)
            self.end_headers()
            return

        if not os.path.isfile(filepath):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return

        ext = os.path.splitext(filepath)[1].lower()
        content_type = MIME_TYPES.get(ext, "application/octet-stream")

        with open(filepath, "rb") as f:
            body = f.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def run_proxy_server():
    server = ThreadingHTTPServer((HOST, PROXY_PORT), ProxyHandler)
    print(f"Terminus proxy server listening on http://{HOST}:{PROXY_PORT}", flush=True)
    server.serve_forever()


def run_app_server():
    server = ThreadingHTTPServer((HOST, APP_PORT), AppHandler)
    print(f"Terminus app server listening on http://{HOST}:{APP_PORT}", flush=True)
    server.serve_forever()


# ─────────────────────────────────────────────────────────────
#  PTY SESSION
# ─────────────────────────────────────────────────────────────

class PTYSession:
    ID_LEN = 36  # UUID length

    def __init__(self, session_id: str, cols: int, rows: int,
                 send_cb, loop: asyncio.AbstractEventLoop):
        self.id = session_id
        self.cols = cols
        self.rows = rows
        self._send = send_cb
        self._loop = loop
        self.master_fd = None
        self.pid = None
        self._running = False
        self.shell = os.environ.get("SHELL", "/bin/bash")

    def start(self):
        master_fd, slave_fd = os.openpty()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            pid = os.fork()

        if pid == 0:
            os.close(master_fd)
            os.setsid()
            try:
                fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            except Exception:
                pass
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)
            winsize = struct.pack("HHHH", self.rows, self.cols, 0, 0)
            fcntl.ioctl(0, termios.TIOCSWINSZ, winsize)
            env = dict(os.environ)
            env["TERM"] = "xterm-256color"
            env["COLORTERM"] = "truecolor"
            os.execvpe(self.shell, [self.shell, "-l"], env)
            sys.exit(1)
        else:
            os.close(slave_fd)
            self.master_fd = master_fd
            self.pid = pid
            self._running = True
            t = threading.Thread(target=self._read_loop, daemon=True)
            t.start()

    def _read_loop(self):
        sid_bytes = self.id.encode().ljust(self.ID_LEN)[:self.ID_LEN]
        while self._running:
            try:
                data = os.read(self.master_fd, 65536)
                if not data:
                    break
                asyncio.run_coroutine_threadsafe(
                    self._send(sid_bytes + data), self._loop
                )
            except OSError:
                break

        exit_code = None
        if self.pid:
            try:
                _, status = os.waitpid(self.pid, 0)
                if os.WIFEXITED(status):
                    exit_code = os.WEXITSTATUS(status)
                elif os.WIFSIGNALED(status):
                    exit_code = -os.WTERMSIG(status)
            except OSError:
                pass

        asyncio.run_coroutine_threadsafe(
            self._send(json.dumps(
                {"type": "exit", "id": self.id, "code": exit_code}
            ).encode()),
            self._loop,
        )
        self._running = False

    def write(self, data: bytes):
        if self.master_fd and self._running:
            try:
                os.write(self.master_fd, data)
            except OSError:
                pass

    def resize(self, cols: int, rows: int):
        self.cols = cols
        self.rows = rows
        if self.master_fd:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            try:
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
                if self.pid:
                    os.kill(self.pid, signal.SIGWINCH)
            except OSError:
                pass

    def close(self):
        self._running = False
        if self.master_fd:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
        if self.pid:
            try:
                os.kill(self.pid, signal.SIGTERM)
                os.waitpid(self.pid, os.WNOHANG)
            except OSError:
                pass
            self.pid = None


# ─────────────────────────────────────────────────────────────
#  WEBSOCKET HANDLER
# ─────────────────────────────────────────────────────────────

async def handler(websocket):
    loop = asyncio.get_event_loop()
    local_sessions: list[str] = []

    async def send_bytes(data: bytes):
        try:
            await websocket.send(data)
        except Exception:
            pass

    await websocket.send(json.dumps({"type": "ready", "port": PORT}))

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                if len(message) <= PTYSession.ID_LEN:
                    continue
                sid = message[:PTYSession.ID_LEN].decode(errors="replace").strip()
                data = message[PTYSession.ID_LEN:]
                session = SESSIONS.get(sid)
                if session:
                    session.write(data)

            elif isinstance(message, str):
                try:
                    msg = json.loads(message)
                except json.JSONDecodeError:
                    continue

                t = msg.get("type")

                if t == "create":
                    sid = msg.get("id", "")
                    cols = int(msg.get("cols", 80))
                    rows = int(msg.get("rows", 24))
                    if sid and sid not in SESSIONS:
                        session = PTYSession(sid, cols, rows, send_bytes, loop)
                        try:
                            session.start()
                            SESSIONS[sid] = session
                            local_sessions.append(sid)
                        except Exception as e:
                            await websocket.send(json.dumps(
                                {"type": "error", "id": sid, "msg": str(e)}
                            ))

                elif t == "resize":
                    sid = msg.get("id", "")
                    cols = int(msg.get("cols", 80))
                    rows = int(msg.get("rows", 24))
                    session = SESSIONS.get(sid)
                    if session:
                        session.resize(cols, rows)

                elif t == "close":
                    sid = msg.get("id", "")
                    session = SESSIONS.pop(sid, None)
                    if session:
                        session.close()
                        if sid in local_sessions:
                            local_sessions.remove(sid)

                elif t == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        for sid in local_sessions:
            session = SESSIONS.pop(sid, None)
            if session:
                session.close()


# ─────────────────────────────────────────────────────────────
#  BOOT
# ─────────────────────────────────────────────────────────────

async def main():
    # Start HTTP proxy in a background daemon thread
    proxy_thread = threading.Thread(target=run_proxy_server, daemon=True)
    proxy_thread.start()

    # Start static app server in a background daemon thread
    app_thread = threading.Thread(target=run_app_server, daemon=True)
    app_thread.start()

    print(f"Terminus PTY server listening on ws://{HOST}:{PORT}", flush=True)
    print(f"Open http://{HOST}:{APP_PORT} in your browser", flush=True)
    async with websockets.serve(handler, HOST, PORT, max_size=None, ping_interval=20):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.")
