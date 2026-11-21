// Chat-tab switch latency in the real app: two heavy Chat tabs, switched the way the user
// does it — spamming Ctrl+PageUp / Ctrl+PageDown. Boots main.js with an isolated profile,
// opens two chat tabs, points them at real (or synthetic) heavy transcripts, and times the
// shortcut path (handler cost + time to the next painted frame) with a V8 CPU profile.
//   node scripts/bench-chat-switch.js                 # synthetic 400-message transcripts
//   TV_BENCH_REAL=1 node scripts/bench-chat-switch.js # copy ~/.terminalvibe, use 2 heaviest real threads
//   TV_BENCH_MSGS=800 node scripts/bench-chat-switch.js
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
if (!process.versions.electron) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-bench-'));
  if (process.env.TV_BENCH_REAL) {
    const src = process.env.TV_BENCH_PROFILE || path.join(os.homedir(), '.terminalvibe');
    fs.cpSync(src, path.join(home, '.terminalvibe'), { recursive: true });
  }
  let server = null;
  try { cp.execSync(`ss -ltn | grep -q ':7769 '`); } catch { server = cp.spawn(process.execPath, [path.join(__dirname, '..', 'electron', 'dev-server.js')], { stdio: 'ignore' }); }
  const r = cp.spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, HOME: home, USERPROFILE: home, ELECTRON_RUN_AS_NODE: '', ELECTRON_ENABLE_LOGGING: '0' },
  });
  server?.kill();
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow, ipcMain } = require('electron');

const REAL = !!process.env.TV_BENCH_REAL;
const MSGS = Number(process.env.TV_BENCH_MSGS || 400);
const TURNS = Number(process.env.TV_BENCH_TURNS || 16);
const CONFIG_DIR = path.join(os.homedir(), '.terminalvibe');
const STATE_FILE = path.join(CONFIG_DIR, 'state.json');

function fakeHistory() {
  const items = [];
  let ts = Date.parse('2026-11-15T00:00:00Z');
  for (let i = 0; i < MSGS; i++) {
    ts += 4000;
    const iso = new Date(ts).toISOString();
    if (i % 4 === 0) {
      items.push({ role: 'user', text: `Prompt ${i}: please refactor the panel switch path and check the result.`, ts: iso });
      items.push({ role: 'thinking', text: ('I should look at the switch path first. '.repeat(12)).trim(), ts: iso });
      items.push({ role: 'tool', name: 'shell', summary: `grep -n activateTerminal app.js # ${i}`, output: Array.from({ length: 14 }, (_, k) => `app.js:${k * 97 + i}:   function activateTerminal(wsId, termId) { // line ${k}`).join('\n'), ts: iso });
      items.push({ role: 'assistant', text: `Done for ${i}.\n\n\`\`\`js\nfunction activateTerminal(wsId, termId) {\n  const wsp = findWs(wsId);\n  if (!wsp) return;\n}\n\`\`\`\n\nThe tab bar geometry is independent of the slot display toggles, so reveal the active tab now.`, ts: iso });
    } else if (i % 4 === 1) {
      items.push({ role: 'user', text: `Follow-up ${i}`, ts: iso });
      items.push({ role: 'assistant', text: `Reply ${i}: `.repeat(3) + 'Content-visibility keeps hidden transcripts cheap, but the promotion still has to relayout the surface.'.repeat(2), ts: iso });
    } else if (i % 4 === 2) {
      items.push({ role: 'tool', name: 'read', summary: `workspace.css #${i}`, output: 'x'.repeat(400), ts: iso });
      items.push({ role: 'assistant', text: `Answer ${i}`.padEnd(300, ' about the stylesheet and its containment rules'), ts: iso });
    } else {
      items.push({ role: 'user', text: `Question ${i}`, ts: iso });
      items.push({ role: 'assistant', text: `Short reply ${i}`, ts: iso });
    }
  }
  return [{ items }];
}

let historyReads = 0;
if (!REAL) {
  const handle = ipcMain.handle;
  ipcMain.handle = function (channel, listener) {
    if (channel === 'threads:history') return handle.call(this, channel, async () => { historyReads++; return fakeHistory(); });
    if (channel === 'threads:history-preview') return handle.call(this, channel, async () => null);
    if (channel === 'usage:limits' || channel === 'chat-sdk:models' || channel === 'git:pull-requests')
      return handle.call(this, channel, async () => null);
    return handle.call(this, channel, listener);
  };
  require('../electron/main.js');
  ipcMain.handle = handle;
} else require('../electron/main.js');

const timeout = setTimeout(() => { console.log('BENCH TIMEOUT'); app.exit(1); }, 300000);
function finish(code, out) { clearTimeout(timeout); console.log(out); app.exit(code); }

// Two heaviest real threads, read from the copied profile's cached history.
function pickRealThreads() {
  const dir = path.join(CONFIG_DIR, 'threads');
  const rows = [];
  for (const name of fs.readdirSync(dir)) {
    const tf = path.join(dir, name, 'thread.json'), hf = path.join(dir, name, 'history.json');
    if (!fs.existsSync(tf) || !fs.existsSync(hf)) continue;
    try {
      const t = JSON.parse(fs.readFileSync(tf, 'utf8'));
      const h = JSON.parse(fs.readFileSync(hf, 'utf8'));
      const segs = (t.segments || []).filter(s => s && s.harness && s.sessionId);
      if (!segs.length) continue;
      const items = (h.segments || []).reduce((n, s) => n + ((s && s.items && s.items.length) || 0), 0);
      rows.push({ id: name, title: t.title || 'Thread', cwd: t.cwd || process.cwd(), createdAt: t.createdAt || Date.now(), segments: segs, items });
    } catch { }
  }
  rows.sort((a, b) => b.items - a.items);
  return rows.slice(0, 2);
}

function patchState(threads) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  let n = 0;
  const walk = node => {
    if (!node) return;
    if (node.type === 'split') return node.children.forEach(walk);
    if (node.type !== 'group') return;
    for (const t of node.terminals || []) {
      if (!t.threadHistory || !threads[n]) continue;
      const src = threads[n++];
      t.chat = { ...(t.chat || {}), title: src.title, storeId: src.id, cwd: src.cwd, createdAt: src.createdAt,
        segments: src.segments.map(s => ({ ...s })) };
      t.cwd = src.cwd;
    }
  };
  (state.workspaces || []).forEach(w => walk(w.layout));
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  return n;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(() => setTimeout(async () => {
  const win = BrowserWindow.getAllWindows().find(w => /index\.html|^http:\/\/127\.0\.0\.1:\d+/.test(w.webContents.getURL()));
  if (!win) return finish(1, 'no main window');
  const cdp = win.webContents.debugger;
  try { cdp.attach('1.3'); } catch { /* already attached */ }

  // 1. In real-profile mode use the two chat tabs already open in the user's profile — no
  //    creation, no patching: their transcripts are real and already wired to real sessions.
  //    In synthetic mode make two fresh Chat tabs from the tab-bar context menu, then close
  //    every shell tab so the shortcut only cycles between the two threads.
  const created = await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    ${REAL ? '' : `
    const bar = document.querySelector('.term-group-tabs');
    if (!bar) return { error: 'no tab bar' };
    for (let n = 0; n < 2; n++) {
      bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
      await wait(60);
      const chat = [...document.querySelectorAll('#ctx .ctx-item.has-sub')].find(el => /Chat/.test(el.textContent));
      const agent = chat && chat.querySelector('.ctx-sub .ctx-item:not(.disabled)');
      if (!agent) return { error: 'no chat menu entry' };
      agent.click();
      await wait(900);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(80);
    }`}
    const isChat = t => !!document.getElementById('slot-' + t.dataset.termid)?.classList.contains('chat-tab');
    const chats = () => [...document.querySelectorAll('.tg-tab')].filter(isChat);
    for (let i = 0; i < 8; i++) {
      const drop = [...document.querySelectorAll('.tg-tab')].find(t => !isChat(t) || (chats().length > 2 && chats().indexOf(t) >= 2));
      if (!drop) break;
      drop.querySelector('.tg-tab-close')?.click();
      await wait(400);
      if (document.getElementById('close-confirm-overlay')?.classList.contains('open')) {
        document.getElementById('cc-close').click();
        await wait(600);
      }
    }
    return { tabs: [...document.querySelectorAll('.tg-tab')].map(t => t.textContent.trim().replace(/\\s+/g, ' ')) };
  })()`).catch(e => ({ error: e.message }));
  if (created?.error) return finish(1, 'create: ' + JSON.stringify(created));
  if ((created.tabs || []).length !== 2) return finish(1, 'expected 2 tabs, got ' + JSON.stringify(created));

  // 2. Synthetic mode only: point the fresh chats at heavy transcripts in state.json, then load
  //    the app. Park the window on about:blank first: the live page's frequent saveState would
  //    overwrite the patch. Real mode keeps the profile exactly as it is.
  if (!REAL) {
    const threads = [{ id: 'bench-1', title: 'Heavy thread 1', cwd: process.cwd(), createdAt: Date.now() - 7200000,
      segments: [{ harness: 'claude', sessionId: 'bench-session-1', cwd: process.cwd(), since: Date.now() - 7200000 }] },
    { id: 'bench-2', title: 'Heavy thread 2', cwd: process.cwd(), createdAt: Date.now() - 7200000,
      segments: [{ harness: 'claude', sessionId: 'bench-session-2', cwd: process.cwd(), since: Date.now() - 7200000 }] }];
    const appUrl = win.webContents.getURL();
    await win.webContents.loadURL('about:blank').catch(() => {});
    await sleep(500);
    const patched = patchState(threads);
    await win.webContents.loadURL(appUrl).catch(() => {});
    await sleep(4000);
    console.log(`threads: ${threads.map(t => t.id).join(', ')}; patched ${patched}; historyReads=${historyReads}`);
  }

  // 3. Visit both chats once so both flows are warm (the user's steady-state switching).
  const loaded = await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const key = k => (document.activeElement || document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }));
    const counts = () => [...document.querySelectorAll('.thr-flow')].map(f => f.querySelectorAll('.thr-msg').length);
    const countsSeen = [];
    for (let i = 0; i < 2; i++) {
      let best = 0;
      for (let t = 0; t < 120; t++) {
        best = Math.max(best, ...counts(), 0);
        if (best > 50) break;
        await wait(100);
      }
      countsSeen.push(best);
      key('PageDown');
      await wait(500);
    }
    return { counts: countsSeen, final: counts(), tabs: document.querySelectorAll('.tg-tab').length,
      pageText: (document.getElementById('sbr-thread')?.textContent || '').slice(0, 100) };
  })()`).catch(e => ({ error: e.message }));
  if (loaded?.error) return finish(1, 'load: ' + JSON.stringify(loaded));
  if (!loaded.counts || loaded.counts.reduce((a, b) => a + b, 0) <= 50) return finish(1, 'no heavy transcripts: ' + JSON.stringify(loaded) + ' historyReads=' + historyReads);

  // 4. Spam the real shortcut and time handler + next painted frame.
  await cdp.sendCommand('Profiler.enable');
  await cdp.sendCommand('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.sendCommand('Profiler.start');
  const traced = [];
  if (process.env.TV_BENCH_TRACE) {
    cdp.on('message', (_e, m, p) => { if (m === 'Tracing.dataCollected') traced.push(...p.value); });
    await cdp.sendCommand('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline', 'devtools.timeline.stack', 'disabled-by-default-devtools.timeline.invalidationTracking'] } });
  }
  const timing = await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const key = k => (document.activeElement || document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }));
    const activeId = () => document.querySelector('.tg-tab.active')?.dataset.termid;
    const samples = [];
    for (let i = 0; i < ${TURNS}; i++) {
      const before = activeId();
      const t0 = performance.now();
      key(i % 2 ? 'PageUp' : 'PageDown');
      const t1 = performance.now();
      if (activeId() === before) samples.push({ skipped: true, js: 0, frame: 0 });
      else {
        await frame();
        const t2 = performance.now();
        samples.push({ js: +(t1 - t0).toFixed(2), frame: +(t2 - t0).toFixed(2) });
      }
      // Fixed 60 ms cadence between key presses, as if the user spams the shortcut.
      const remain = ${Number(process.env.TV_BENCH_GAP || 60)} - (performance.now() - t0);
      if (remain > 0) await wait(remain);
    }
    return { samples, first: activeId() };
  })()`).catch(e => ({ error: e.message }));
  const profile = await cdp.sendCommand('Profiler.stop').catch(() => null);
  let traceOut = '';
  if (process.env.TV_BENCH_TRACE) {
    const done = new Promise(r => cdp.once('message', function f(_e, m) { if (m === 'Tracing.tracingComplete') r(); else cdp.once('message', f); }));
    await cdp.sendCommand('Tracing.end'); await done;
    const sum = {};
    for (const e of traced) if (e.ph === 'X' && e.dur && /^(Layout|UpdateLayoutTree|Paint|PrePaint|Layerize|Commit|UpdateLayer|FunctionCall|EvaluateScript|HitTest|RunTask|IntersectionObserverController::computeIntersections|ResizeObserver::deliverObservations|RecalculateStyles)$/.test(e.name)) sum[e.name] = (sum[e.name] || 0) + e.dur / 1000;
    const inv = {};
    for (const e of traced) if (/InvalidationTracking/.test(e.name)) { const a = e.args?.data || {}; if (/details-content|thr-prompt-tick|#text/.test(a.nodeName||'')) continue; const k = e.name.replace('InvalidationTracking', '') + ' ' + (a.reason || a.invalidationSet || '') + ' <' + (a.nodeName || '').slice(0, 60) + '>'; inv[k] = (inv[k] || 0) + 1; }
    const stk = {};
    for (const e of traced) if (/InvalidationTracking/.test(e.name) && /details-content/.test(e.args?.data?.nodeName || '')) {
      const st = (e.args.data.stackTrace || []).slice(0, 4).map(f => (f.functionName || 'anon') + ':' + f.lineNumber).join(' < ') || '(none)';
      stk[st] = (stk[st] || 0) + 1; }
    const stkOut = Object.entries(stk).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => v + '  ' + k).join('\n');
    const invOut = Object.entries(inv).sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => v + '  ' + k).join('\n');
    const lay = traced.filter(e => e.name === 'Layout' && e.ph === 'X' && e.dur > 3000).slice(0, 14)
      .map(e => `${(e.dur / 1000).toFixed(0)}ms dirty=${e.args?.beginData?.dirtyObjects}/${e.args?.beginData?.totalObjects} root=${e.args?.endData?.root || ''}`).join('\n');
    traceOut = 'STK\n' + stkOut + '\nINV\n' + invOut + '\n' + lay + '\n--- trace (ms, all renderer threads) ---\n' + Object.entries(sum).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v.toFixed(0).padStart(7)}  ${k}`).join('\n');
  }
  if (timing?.error) return finish(1, 'timing: ' + JSON.stringify(timing));

  // 5. Aggregate V8 self time across the switches.
  const nodes = new Map();
  for (const n of profile?.profile?.nodes || []) nodes.set(n.id, n);
  const self = new Map(), deltas = profile?.profile?.timeDeltas || [];
  (profile?.profile?.samples || []).forEach((id, i) => {
    const n = nodes.get(id); if (!n) return;
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anonymous)'} ${(cf.url || '').split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (deltas[i] || 0));
  });
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([k, us]) => `${String((us / 1000).toFixed(1)).padStart(8)} ms  ${k}`);
  const s = timing.samples.filter(x => !x.skipped), skipped = timing.samples.length - s.length;
  const stat = a => a.length ? (() => { const v = [...a].sort((x, y) => x - y); return `min ${v[0]} med ${v[Math.floor(v.length / 2)]} max ${v[v.length - 1]} avg ${(a.reduce((p, c) => p + c, 0) / a.length).toFixed(1)}`; })() : 'n/a';
  finish(0, [
    `${REAL ? 'REAL PROFILE' : 'synthetic'} 2 threads; tabs=${loaded.tabs}; historyReads=${historyReads}; flows=${JSON.stringify(loaded.counts)}`,
    `Ctrl+PageUp/Down × ${TURNS} (skipped ${skipped})`,
    `  JS handler   ${stat(s.map(x => x.js))}`,
    `  to painted   ${stat(s.map(x => x.frame))}`,
    '  samples: ' + JSON.stringify(timing.samples),
    '--- V8 self time during the switch run (ms) ---',
    top.join('\n'),
    traceOut,
  ].join('\n'));
}, 2000));
