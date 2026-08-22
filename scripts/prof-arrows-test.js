// Headless drive of the profile picker arrow navigation via CDP.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const EL = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron');
const PORT = 9226;
const USERDATA = path.join(__dirname, '..', '.tmp-cdp-test');

function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error',rej);
  });
}

(async () => {
  // Clean temp dir
  const fs = require('fs');
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}

  const child = spawn(EL, [
    '.', '--remote-debugging-port=' + PORT, '--user-data-dir=' + USERDATA, '--no-sandbox', '--disable-gpu',
  ], { cwd: path.join(__dirname, '..'), stdio: 'pipe', env: process.env });

  let stderr = '';
  child.stderr.on('data', c => stderr += c.toString());

  // Wait for CDP endpoint
  let targets;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json`); if (targets.length) break; }
    catch {}
  }
  if (!targets || !targets.length) {
    console.log('FAIL: no CDP targets after 30s'); console.log('stderr:', stderr); child.kill(); process.exit(1);
  }

  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });

  // Find the main page (not devtools, not extensions)
  const page = (await browser.pages()).find(p => {
    const u = p.url();
    return u && u !== 'about:blank' && !u.startsWith('chrome-devtools') && !u.startsWith('chrome-extension');
  });
  if (!page) { console.log('FAIL: no main page'); browser.disconnect(); child.kill(); process.exit(1); }

  await page.waitForFunction(() => {
    const w = document.getElementById('profile-picker');
    return w && w.style.display !== 'none';
  }, { timeout: 15000 }).catch(() => {});
  console.log('main page:', page.url());

  // Wait for boot
  await new Promise(r => setTimeout(r, 3000));

  // Open picker via button
  await page.evaluate(() => document.getElementById('btn-profiles').click());
  await new Promise(r => setTimeout(r, 500));

  const info = await page.evaluate(() => {
    const wrap = document.getElementById('profile-picker');
    const boxes = [...document.querySelectorAll('#pp-grid .pp-box')].map(b => ({
      name: b.querySelector('.pp-name')?.textContent,
      cur: b.classList.contains('current'),
      sel: b.classList.contains('sel'),
    }));
    return { display: wrap.style.display, boxes };
  });
  console.log('picker state:', JSON.stringify(info, null, 2));

  if (!info.boxes.length) { console.log('FAIL: no boxes'); browser.disconnect(); child.kill(); process.exit(1); }

  // Simulate ArrowRight a few times and inspect sel
  for (let n = 0; n < info.boxes.length + 2; n++) {
    await page.keyboard.press('ArrowRight');
    await new Promise(r => setTimeout(r, 100));
    const s = await page.evaluate(() =>
      [...document.querySelectorAll('#pp-grid .pp-box')].map((b, i) => b.classList.contains('sel') ? i : -1).filter(i => i >= 0)
    );
    console.log(`after ArrowRight #${n + 1}, sel indexes:`, s);
  }

  // Test Enter
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 500));
  const afterEnter = await page.evaluate(() => document.getElementById('profile-picker').style.display);
  console.log('picker display after Enter:', afterEnter);

  await browser.disconnect();
  child.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });