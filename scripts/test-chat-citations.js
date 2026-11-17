// Cite response text only, then navigate back to its exact source after history redraws.
const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const r = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const root = path.join(__dirname, '..');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { backgroundThrottling: false, offscreen: true } });
  await win.loadURL('about:blank');
  for (const file of ['style.css', 'workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(root, file), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const copyHelpers = source.slice(source.indexOf('  function mdFromDom('), source.indexOf('  // Escape first, then the markdown agents use:'));
  const copyBinding = source.slice(source.indexOf('    if (!flow._copyBound) {'), source.indexOf('    syncWorking(ws, surface);', source.indexOf('    if (!flow._copyBound) {')));
  const privacyCopy = source.slice(source.indexOf('  function copyPrivateWorkSelection('), source.indexOf("  document.addEventListener('copy', copyPrivateWorkSelection"));
  const citations = source.slice(source.indexOf('  let _citationFlash = null;'), source.indexOf('  let _chatCtrl = false;'));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    ${copyHelpers}
    const copyScope = document.createElement('div');
    copyScope.innerHTML = '<div class="thr-msg-text"><button class="thr-link" data-href="/tmp/source.png"><i></i>View the latest screenshot</button> and <strong>bold text</strong></div>';
    const link = copyScope.querySelector('.thr-link'), label = link.lastChild;
    const copyRange = document.createRange();
    copyRange.selectNodeContents(label);
    check(mdFromRange(copyRange, copyScope) === '[View the latest screenshot](/tmp/source.png)', 'Selected link label lost its source path');
    copyRange.setStart(label, 5); copyRange.setEnd(label, 8);
    check(mdFromRange(copyRange, copyScope) === '[the](/tmp/source.png)', 'Partial link label lost its source path');
    copyRange.selectNodeContents(copyScope.querySelector('strong').firstChild);
    check(mdFromRange(copyRange, copyScope) === '**bold text**', 'Selected formatted text lost its markdown');
    copyRange.selectNodeContents(copyScope);
    check(mdFromRange(copyRange, copyScope) === '[View the latest screenshot](/tmp/source.png) and **bold text**', 'Mixed selection changed markdown');
    {
      const flow = document.createElement('div'); document.body.append(flow);
      flow.innerHTML = '<div class="thr-msg assistant" data-key="a"><div class="thr-msg-text">First reply.</div></div><div class="thr-msg user" data-key="b"><div class="thr-msg-text">test</div></div><div class="thr-msg assistant" data-key="c"><div class="thr-msg-text">Last reply.</div></div>';
      ${copyBinding}
      const range = document.createRange();
      range.setStart(flow.querySelector('[data-key="a"] .thr-msg-text').firstChild, 11);
      range.setEnd(flow.querySelector('[data-key="c"] .thr-msg-text').firstChild, 4);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const event = new Event('copy', { bubbles: true, cancelable: true });
      let copied; event.clipboardData = { setData: (_type, value) => copied = value };
      flow.dispatchEvent(event);
      check(copied === ['.', 'test', 'Last'].join(String.fromCharCode(10, 10)), 'Cross-message copy must clip boundary messages and exclude role labels');
      selection.removeAllRanges(); flow.remove();
    }
    {
      const section = document.createElement('div'); document.body.append(section);
      section.innerHTML = '<div class="thr-msg-text">First paragraph</div><div class="thr-actions">15:10 Copy</div><div class="thr-seg">Codex medium</div><details class="thr-tool" open><summary>duplicate command</summary><pre class="thr-tool-detail">echo hello</pre><pre class="thr-tool-output">C:/Users/<span class="thr-work-username">Alice</span>/project</pre></details><div class="thr-msg-text">Last paragraph</div>';
      const range = document.createRange(); range.selectNodeContents(section);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const threadSettings = { usernames: 'blur' };
      let result = '', prevented = false;
      const privateCopyToken = async () => '[user-hidden]';
      const copyPrivateText = async text => { result = text; };
      ${privacyCopy}
      copyPrivateWorkSelection({ target: section, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      check(prevented && result.includes('First paragraph') && result.includes('Last paragraph'), 'Privacy copy must include selected paragraphs');
      check(result.includes('[user-hidden]') && !result.includes('Alice'), 'Privacy copy must mask usernames');
      check(!result.includes('15:10') && !result.includes('Codex medium') && !result.includes('duplicate command'), 'Privacy copy must omit chrome and repeated tool summaries');
      check(result.includes(String.fromCharCode(10, 10)) && result.includes('echo hello'), 'Privacy copy must preserve paragraph and command structure');
      selection.removeAllRanges(); section.remove();
    }
    const tick = ms => new Promise(resolve => setTimeout(resolve, ms || 30));
    document.body.classList.add('ui-animations');
    document.body.innerHTML = '<div id="sbr-thread" style="position:relative;display:flex;width:500px;height:400px"><div class="thr-flow" id="sbr-thread-flow" tabindex="-1" style="height:300px;flex:none;overflow:auto"></div><div class="thr-composer-wrap" style="height:80px"></div><textarea id="draft"></textarea></div><div id="neighbor" style="height:100px;overflow:auto"><div style="height:500px">Other pane</div></div>';
    const thrPage = document.getElementById('sbr-thread'), flow = document.getElementById('sbr-thread-flow'), thrInput = document.getElementById('draft');
    const chat = { id: 'tab', chat: { storeId: 'stable-chat' } }, curChat = () => chat;
    const threadPart = (_, id) => document.getElementById('sbr-thread-' + id);
    const notices = [], zoomBadge = text => notices.push(text), rememberThreadScroll = () => {};
    const _chatFiles = [], renderChatFiles = () => {}, autosizeThreadInput = () => {};
    const insertChatMention = file => { file.mention = '[Citation ' + (_chatFiles.length + 1) + ']'; };
    flow.innerHTML = '<div class="thr-worked">Worked for 2s</div><div class="thr-msg assistant" data-key="0:1"><div class="thr-msg-text">First <strong>shared words</strong> response.</div><div class="thr-actions">Copy 03:54 AM</div></div><div class="thr-seg">Antigravity CLI 03:54 AM</div><div class="thr-note">Started with full history</div><details class="thr-tools" open><summary>shell cat history</summary><pre class="thr-tool-detail">tool output only</pre></details><div class="thr-msg user" data-key="0:2"><div class="thr-msg-text">User prompt only</div></div><div style="height:600px;flex:none"></div><details class="thr-turn" open><summary>Worked for 7s</summary><div class="thr-turn-steps"><div class="thr-msg assistant" data-key="0:9"><div class="thr-msg-text">Second <strong>shared words</strong> target response.</div></div></div></details>';
    ${citations}
    const select = range => { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection; };
    const rangeFor = element => { const range = document.createRange(); range.selectNodeContents(element); return range; };
    const uiRange = rangeFor(flow.querySelector('.thr-worked'));
    select(uiRange); flow.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await tick();
    check(citeBtn.hidden && !selectedResponseCitations(window.getSelection(), flow).length, 'Work labels are citable');
    for (const selector of ['.thr-seg', '.thr-note', '.thr-tool-detail', '.thr-msg.user .thr-msg-text', '.thr-actions']) {
      select(rangeFor(flow.querySelector(selector)));
      check(!selectedResponseCitations(window.getSelection(), flow).length, 'UI or user text is citable: ' + selector);
    }
    const mixed = document.createRange();
    mixed.setStart(flow.firstChild.firstChild, 0);
    const userText = flow.querySelector('.thr-msg.user .thr-msg-text').firstChild;
    mixed.setEnd(userText, userText.length); select(mixed);
    flow.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await tick();
    check(!citeBtn.hidden, 'Mixed selection lost the actual response');
    citeBtn.click();
    check(_chatFiles.length === 1 && _chatFiles[0].cite === 'First shared words response.', 'Mixed selection included UI labels or user text');
    check(_chatFiles[0].source.key === '0:1', 'Citation did not retain its response identity');
    const second = flow.querySelector('[data-key="0:9"] strong');
    select(rangeFor(second));
    const chosen = selectedResponseCitations(window.getSelection(), flow)[0];
    check(chosen.cite === 'shared words' && chosen.source.key === '0:9', 'Formatted partial quote did not capture the exact source');
    const citation = { cite: chosen.cite, source: chosen.source };
    // Replace all DOM nodes as the normal history poll does, and fold the source section.
    flow.innerHTML = flow.innerHTML;
    const turn = flow.querySelector('.thr-turn'); turn.open = false;
    flow.scrollTop = 0;
    const neighbor = document.getElementById('neighbor'); neighbor.scrollTop = 70;
    check(jumpToCitation(citation), 'Citation did not navigate after history redraw');
    check(turn.open, 'Citation source stayed folded');
    const animated = document.body.classList.contains('ui-animations') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animated) {
      check(flow.scrollTop === 0, 'Citation jump skipped smooth scrolling');
      await tick(120);
      check(flow.scrollTop > 0 && _citationFlash.phase === 'scroll', 'Citation jump did not animate through intermediate scroll positions');
      check(flow.style.getPropertyValue('--citation-flash-strength') === '0%', 'Highlight started before scrolling reached the source');
      for (let i = 0; i < 60 && _citationFlash?.phase === 'scroll'; i++) await tick(20);
      check(_citationFlash?.phase === 'pulse', 'Highlight did not start after arriving at the source');
    }
    check(flow.scrollTop > 100 && neighbor.scrollTop === 70, 'Navigation failed to scroll only the owning chat');
    const highlighted = CSS.highlights.get('tv-citation-source');
    check(highlighted && [...highlighted][0].toString() === 'shared words', 'Highlight does not cover the selected text');
    check([...highlighted][0].startContainer.parentElement.closest('[data-key]').dataset.key === '0:9', 'Duplicate text jumped to the wrong response');
    if (animated) {
      await tick(150); const stronger = parseFloat(flow.style.getPropertyValue('--citation-flash-strength'));
      check(stronger > 5 && stronger < 38, 'Highlight did not fade through intermediate opacity');
      await tick(230); const weaker = parseFloat(flow.style.getPropertyValue('--citation-flash-strength'));
      check(weaker < stronger && CSS.highlights.has('tv-citation-source'), 'Highlight blinked abruptly instead of fading');
    }
    clearCitationFlash();
    const originalMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: true });
    check(jumpToCitation(citation) && !_citationFlash.frame && _citationFlash.phase === 'static', 'Reduced motion still animates');
    await tick(230); check(CSS.highlights.has('tv-citation-source'), 'Reduced-motion highlight should stay steady');
    clearCitationFlash(); window.matchMedia = originalMedia;
    check(!jumpToCitation({ ...citation, source: { ...citation.source, chatId: 'another-chat' } }), 'Citation navigated in the wrong chat');
    check(!jumpToCitation({ cite: 'Antigravity CLI 03:54 AM' }), 'Citation navigation matched UI text');
    check(notices.length === 1, 'Missing source did not produce a clear result');
    turn.open = true; select(rangeFor(flow));
    const all = selectedResponseCitations(window.getSelection(), flow);
    check(all.length === 2 && all.every(part => !/Worked|03:54|history|User prompt|tool output/.test(part.cite)), 'Multiple-response selection included interface text');
    const long = flow.querySelector('.thr-msg.assistant .thr-msg-text'); long.textContent = 'a'.repeat(5000);
    select(rangeFor(long));
    check(selectedResponseCitations(window.getSelection(), flow)[0].cite.length === 4000, 'Citation size limit was lost');
    return 'PASS: response-only citations, mixed selections, source navigation after redraw, exact formatted-text highlight, duplicate disambiguation, folded replies and reduced motion.';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
