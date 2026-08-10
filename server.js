#!/usr/bin/env node
/**
 * TerminalVibe WebSocket PTY server + static file server.
 *
 * WebSocket server  ws://127.0.0.1:7681   — PTY multiplexer
 * HTTP server       http://127.0.0.1:6969 — serves index.html + static files + local file serving
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


if (!isTauriMode) {
  appServer.listen(APP_PORT, HOST, () => {
    console.log(`TerminalVibe app server listening on http://${HOST}:${APP_PORT}`);
  });
  console.log(`Open http://${HOST}:${APP_PORT} in your browser`);
}

console.log(`TerminalVibe PTY server listening on ws://${HOST}:${PORT}`);
