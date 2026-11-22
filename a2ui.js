// A2UI 1.0 renderer (basic catalog) for chat replies. An agent answers with an ```a2ui fence holding A2UI messages
// (a JSON array, one object, or JSON lines); A2UI.mount builds the surfaces as DOM, keeps their data model in sync with
// the inputs, and hands button actions to opts.onAction as A2UI `action` events.
// Spec: https://a2ui.org/specification/v1.0-a2ui/ (schemas also ship in npm @a2ui/web_core, src/v1_0/schemas).
(() => {
  const V = '1.0';
  const KINDS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface', 'callRendererFunction', 'agentFunctionResponse'];

  // Agents' JSON slips: raw line breaks/tabs inside strings (multi-line "text") and trailing commas. Fixed outside of
  // valid JSON's reach only: escapes are copied as they are, so a valid document parses the same.
  function relax(src) {
    let out = '', inStr = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inStr && ch === '\\') { out += ch + (src[++i] ?? ''); continue; }
      if (ch === '"') inStr = !inStr;
      out += inStr && ch === '\n' ? '\\n' : inStr && ch === '\r' ? '' : inStr && ch === '\t' ? '\\t' : ch;
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
  }
  function parse(src) {
    let msgs;
    src = String(src);
    try { msgs = JSON.parse(src); }
    catch {
      try { msgs = JSON.parse(relax(src)); }
      catch { try { msgs = src.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)); } catch { return null; } }
    }
    if (!Array.isArray(msgs)) msgs = [msgs];
    return msgs.length && msgs.every(m => m && typeof m === 'object' && KINDS.some(k => m[k])) ? msgs : null;
  }

  // ── Data model: JSON Pointers, relative to a List template item's path (c.base) when they don't start with "/" ──
  const toks = p => p.split('/').slice(1).map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'));
  const join = (a, k) => (a === '/' ? '' : a) + '/' + k;
  const abs = (p, c) => String(p).startsWith('/') ? String(p) : p === '' || p === '.' ? c.base : join(c.base || '', p);
  function getP(model, p) {
    if (!p || p === '/') return model;
    let v = model;
    for (const t of toks(p)) { if (v == null) return undefined; v = v[t]; }
    return v;
  }
  function setP(s, p, value) {
    if (!p || p === '/') { s.model = value ?? {}; return; }
    const ts = toks(p);
    let o = s.model;
    ts.slice(0, -1).forEach((t, i) => { if (o[t] == null || typeof o[t] !== 'object') o[t] = /^\d+$/.test(ts[i + 1]) ? [] : {}; o = o[t]; });
    const last = ts.at(-1);
    if (value === undefined) Array.isArray(o) ? o.splice(Number(last), 1) : delete o[last];
    else o[last] = value;
  }

  // ── Dynamic values: literal | {"@path"} | {"@call", args} ──
  const str = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function val(v, c) {
    if (isObj(v) && '@path' in v) return getP(c.s.model, abs(v['@path'], c));
    if (isObj(v) && '@call' in v) return call(v, c);
    return v;
  }
  function call(f, c) {
    const fn = FN[f['@call']];
    if (!fn) return undefined;
    const a = {};
    for (const [k, v] of Object.entries(f.args || {})) a[k] = Array.isArray(v) ? v.map(x => val(x, c)) : val(v, c);
    try { return fn(a, c); } catch { return undefined; }
  }
  const dec = d => d == null ? {} : { minimumFractionDigits: Number(d), maximumFractionDigits: Number(d) };
  const FN = {
    required: a => a.value != null && a.value !== '' && a.value !== false && !(Array.isArray(a.value) && !a.value.length),
    regex: a => { try { return new RegExp(a.pattern).test(str(a.value)); } catch { return false; } },
    length: a => { const n = str(a.value).length; return (a.min == null || n >= a.min) && (a.max == null || n <= a.max); },
    numeric: a => { const n = Number(a.value); return a.value !== '' && a.value != null && !Number.isNaN(n) && (a.min == null || n >= a.min) && (a.max == null || n <= a.max); },
    email: a => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(a.value)),
    formatString: (a, c) => interp(str(a.value), c),
    formatNumber: a => new Intl.NumberFormat(undefined, { ...dec(a.decimals), useGrouping: a.grouping !== false }).format(Number(a.value)),
    formatCurrency: a => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: a.currency || 'USD', ...dec(a.decimals), useGrouping: a.grouping !== false }).format(Number(a.value)); } catch { return str(a.value); } },
    formatDate: a => fmtDate(a.value, a.format),
    pluralize: a => { const n = Number(a.value), cat = n === 0 && a.zero != null ? 'zero' : new Intl.PluralRules().select(n); return str(a[cat] ?? a.other); },
    openUrl: (a, c) => c.s.opts.openUrl?.(str(a.url)),
    and: a => (a.values || []).every(Boolean),
    or: a => (a.values || []).some(Boolean),
    not: a => !a.value,
    now: () => new Date().toISOString(),
    '@index': (a, c) => (c.index ?? 0) + (Number(a.offset) || 0),
  };
  // formatString: "${/abs/path}", "${rel/path}", "${fn(name:value, …)}" with nested ${…}, quoted, number or boolean args; "\${" is literal.
  const closeBrace = (s, open) => { let d = 0; for (let j = open; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) return j; } return s.length; };
  function interp(s, c) {
    let out = '';
    for (let i = 0; i < s.length;) {
      if (s[i] === '\\' && s.startsWith('${', i + 1)) { out += '${'; i += 3; }
      else if (s.startsWith('${', i)) { const end = closeBrace(s, i + 1); out += str(expr(s.slice(i + 2, end).trim(), c)); i = end + 1; }
      else out += s[i++];
    }
    return out;
  }
  function splitTop(s) {
    const parts = []; let d = 0, q = '', start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === q) q = ''; continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === '{' || ch === '(') d++;
      else if (ch === '}' || ch === ')') d--;
      else if (ch === ',' && !d) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    return [...parts, s.slice(start)].map(x => x.trim()).filter(Boolean);
  }
  function arg(a, c) {
    if (a.startsWith('${')) return expr(a.slice(2, closeBrace(a, 1)).trim(), c);
    if (/^(['"]).*\1$/s.test(a)) return a.slice(1, -1);
    if (a === 'true' || a === 'false') return a === 'true';
    if (!Number.isNaN(Number(a))) return Number(a);
    return getP(c.s.model, abs(a, c));
  }
  function expr(e, c) {
    const m = /^(@?[A-Za-z_]\w*)\(([\s\S]*)\)$/.exec(e);
    if (!m) return getP(c.s.model, abs(e, c));
    const args = {};
    for (const part of splitTop(m[2])) { const k = part.indexOf(':'); if (k > 0) args[part.slice(0, k).trim()] = arg(part.slice(k + 1).trim(), c); }
    return call({ '@call': m[1], args }, c);
  }
  function fmtDate(v, f) {
    const raw = str(v), d = new Date(typeof v === 'number' ? v : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T00:00' : raw);
    if (Number.isNaN(d.getTime())) return raw;
    if (!f) return d.toLocaleString();
    const p2 = n => String(n).padStart(2, '0'), name = o => new Intl.DateTimeFormat(undefined, o).format(d), h12 = d.getHours() % 12 || 12;
    const T = { yyyy: d.getFullYear(), yy: p2(d.getFullYear() % 100), MMMM: name({ month: 'long' }), MMM: name({ month: 'short' }), MM: p2(d.getMonth() + 1),
      M: d.getMonth() + 1, dd: p2(d.getDate()), d: d.getDate(), EEEE: name({ weekday: 'long' }), EEE: name({ weekday: 'short' }), E: name({ weekday: 'short' }),
      HH: p2(d.getHours()), H: d.getHours(), hh: p2(h12), h: h12, mm: p2(d.getMinutes()), ss: p2(d.getSeconds()), a: d.getHours() < 12 ? 'AM' : 'PM' };
    return str(f).replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|E|HH|H|hh|h|mm|ss|a/g, (m, lit) => lit ?? str(T[m]));
  }
  // A failed check's message, or '' when every check passes (a check returns a boolean or {valid, message}).
  function failed(c, p) {
    for (const r of p.checks || []) {
      const v = val(r.condition, c);
      if (!(v === true || v?.valid === true)) return v?.message || r.message || 'Invalid value';
    }
    return '';
  }

  // ── Rendering: each component registers updaters that re-read its dynamic values when the data model changes ──
  const h = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
  const bind = (c, fn) => { c.s.updaters.push(fn); return fn(); };
  // A bound value follows the data model; a literal one only seeds the control, which then keeps what the user enters.
  const bindValue = (c, v, apply) => isObj(v) ? bind(c, () => apply(val(v, c))) : apply(v);
  const boundPath = (v, c) => isObj(v) && '@path' in v ? abs(v['@path'], c) : null;
  function write(c, v, value) {
    const p = boundPath(v, c);
    if (p != null) setP(c.s, p, value);
    refresh(c.s);
  }
  function render(s) {
    s.updaters = [];
    s.el.replaceChildren(s.comps.has('root') ? build({ s, base: '' }, 'root', 0) : '');
    if (s.locked) lockControls(s);
  }
  // A submitted form is answered: its inputs and buttons stop working (an update in a later reply brings a fresh copy).
  // Only a surface with inputs locks; a row of action buttons alone (Run, one per script) stays usable.
  const hasInputs = s => [...s.comps.values()].some(p => INPUTS.has(p.component));
  function lockControls(s) {
    s.el.classList.add('a2ui-locked');
    s.el.querySelectorAll('input, textarea, button:not(.a2ui-chart-toggle):not(.a2ui-dialog-close)').forEach(el => {
      el.disabled = true;
      if (el.matches('.a2ui-btn')) el.title = 'Already submitted';
    });
  }
  function lock(s) {
    if (!s || s.locked || !hasInputs(s)) return;
    s.locked = true;
    s.updaters = []; // nothing re-enables a control (a Button's checks set disabled on refresh)
    lockControls(s);
  }
  function refresh(s) {
    let rebuild = false;
    for (const u of s.updaters) if (u() === 'rebuild') rebuild = true;
    if (rebuild) render(s);
  }
  function build(c, id, depth) {
    const p = c.s.comps.get(id);
    if (!p || depth > 64) return document.createTextNode('');
    const make = C[p.component];
    const el = make ? make(p, c, depth + 1) : Object.assign(h('div', 'a2ui-unknown'), { textContent: `Unsupported component: ${p.component}` });
    if (p.weight != null) el.style.flexGrow = p.weight;
    const acc = p.accessibility;
    if (acc) bind(c, () => {
      const label = str(val(acc.label, c)), desc = str(val(acc.description, c));
      label ? el.setAttribute('aria-label', label) : el.removeAttribute('aria-label');
      desc ? el.setAttribute('aria-description', desc) : el.removeAttribute('aria-description');
      if (acc.live) el.setAttribute('aria-live', acc.live);
      el.toggleAttribute('aria-hidden', !!val(acc.hidden, c));
    });
    return el;
  }
  // children: ["id", …], or a template {path, componentId} built once per item of the list (or object) at path.
  function kids(c, p, holder, depth) {
    const ch = p.children;
    if (Array.isArray(ch)) { holder.append(...ch.map(id => build(c, id, depth))); return; }
    if (!ch?.path || !ch.componentId) return;
    const path = abs(ch.path, c);
    let sig;
    bind(c, () => {
      const list = getP(c.s.model, path);
      const keys = Array.isArray(list) ? list.map((_, i) => i) : isObj(list) ? Object.keys(list) : [];
      if (keys.join('\u0000') === sig) return;
      if (sig !== undefined) return 'rebuild'; // items added or removed: rebuild the surface
      sig = keys.join('\u0000');
      holder.append(...keys.map((k, i) => build({ s: c.s, base: join(path, k), index: i }, ch.componentId, depth)));
    });
  }
  // A labelled input with its validation message (shown once the user has touched it).
  function field(c, p, control, tag = 'label', after = false) {
    const el = h(tag, 'a2ui-field' + (after ? ' a2ui-field-inline' : '')), lab = h('span', 'a2ui-label'), err = h('span', 'a2ui-error');
    let touched = false;
    bind(c, () => {
      lab.textContent = str(val(p.label, c));
      lab.hidden = !lab.textContent;
      const e = touched ? failed(c, p) : '';
      err.textContent = e; err.hidden = !e;
      control.setAttribute('aria-invalid', String(!!e));
    });
    after ? el.append(control, lab) : el.append(lab, control);
    el.append(err);
    return { el, touch: () => { touched = true; } };
  }
  const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', spaceBetween: 'space-between', spaceAround: 'space-around', spaceEvenly: 'space-evenly', stretch: 'stretch' };
  const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
  const flex = cls => (p, c, d) => {
    const el = h('div', cls + (p.justify === 'stretch' ? ' a2ui-fill' : ''));
    el.style.justifyContent = JUSTIFY[p.justify] || 'flex-start';
    el.style.alignItems = ALIGN[p.align] || 'stretch';
    kids(c, p, el, d);
    return el;
  };
  const safeUrl = u => /^(https?:|data:(image|video|audio)\/)/i.test(u) ? u : '';
  // A local image: absolute, file://, or relative to the chat's folder (resolved by the app).
  const isLocal = u => /^(file:\/\/|\/|~[\\/]|[A-Za-z]:[\\/]|\.{1,2}\/)/.test(u) || /^[^:]+\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(u);
  const media = (tag, cls) => (p, c) => {
    const el = h(tag, cls);
    el.controls = true; el.preload = 'metadata';
    bind(c, () => { const u = safeUrl(str(val(p.url, c))); if (el.getAttribute('src') !== u) el.src = u; if (p.posterUrl) el.poster = safeUrl(str(val(p.posterUrl, c))); });
    return el;
  };
  const C = {
    Text(p, c) {
      const el = h('div', `a2ui-text a2ui-${p.variant === 'caption' ? 'caption' : 'body'}`);
      let last;
      bind(c, () => {
        const t = str(val(p.text, c));
        if (t === last) return;
        last = t;
        if (c.s.opts.markdown) el.innerHTML = c.s.opts.markdown(t); else el.textContent = t;
      });
      return el;
    },
    Image(p, c) {
      const img = h('img', `a2ui-image a2ui-img-${p.variant || 'mediumFeature'}`);
      img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.decoding = 'async';
      // The spec's default is "fill", which stretches a picture into the wide feature box; keep its shape unless asked.
      img.style.objectFit = p.fit === 'scaleDown' ? 'scale-down' : p.fit || 'contain';
      // https / data: load directly; a local file through opts.loadImage (the app reads it).
      let want;
      bind(c, () => {
        const u = str(val(p.url, c));
        img.alt = str(val(p.description, c));
        if (u === want) return;
        want = u;
        if (safeUrl(u)) { img.src = u; return; }
        img.removeAttribute('src');
        if (isLocal(u)) c.s.opts.loadImage?.(u.replace(/^file:\/\//i, '')).then(src => { if (src && want === u) img.src = src; });
      });
      return img;
    },
    Icon(p, c) {
      const el = h('i', 'ph a2ui-icon');
      el.setAttribute('aria-hidden', 'true');
      bind(c, () => { el.className = `ph a2ui-icon ph-a2ui-${str(val(p.name, c)).replace(/[^\w-]/g, '')}`; });
      return el;
    },
    Video: media('video', 'a2ui-video'),
    AudioPlayer(p, c) {
      const el = h('div', 'a2ui-audio'), cap = h('div', 'a2ui-text a2ui-caption');
      bind(c, () => { cap.textContent = str(val(p.description, c)); cap.hidden = !cap.textContent; });
      el.append(cap, media('audio', '')(p, c));
      return el;
    },
    Row: flex('a2ui-row'),
    Column: flex('a2ui-column'),
    List(p, c, d) {
      const el = h('div', `a2ui-list a2ui-list-${p.direction === 'horizontal' ? 'horizontal' : 'vertical'}`);
      el.style.alignItems = ALIGN[p.align] || 'stretch';
      kids(c, p, el, d);
      return el;
    },
    Card(p, c, d) { const el = h('div', 'a2ui-card'); el.append(build(c, p.child, d)); return el; },
    Divider(p) { const el = h('div', `a2ui-divider a2ui-divider-${p.axis === 'vertical' ? 'vertical' : 'horizontal'}`); el.role = 'separator'; return el; },
    Tabs(p, c, d) {
      const el = h('div', 'a2ui-tabs'), bar = h('div', 'a2ui-tabbar');
      bar.role = 'tablist';
      const tabs = (p.tabs || []).map(t => {
        const b = h('button', 'a2ui-tab'), pane = h('div', 'a2ui-tabpane');
        b.type = 'button'; b.role = 'tab'; pane.role = 'tabpanel';
        bind(c, () => { b.textContent = str(val(t.title, c)); });
        pane.append(build(c, t.child, d));
        return { b, pane };
      });
      const pick = i => tabs.forEach((t, k) => { t.b.setAttribute('aria-selected', String(k === i)); t.b.tabIndex = k === i ? 0 : -1; t.pane.hidden = k !== i; });
      tabs.forEach((t, i) => { t.b.onclick = () => pick(i); });
      bar.append(...tabs.map(t => t.b));
      el.append(bar, ...tabs.map(t => t.pane));
      pick(0);
      return el;
    },
    Modal(p, c, d) {
      const el = h('div', 'a2ui-modal'), dlg = h('dialog', 'a2ui-dialog'), close = h('button', 'a2ui-dialog-close');
      close.type = 'button'; close.setAttribute('aria-label', 'Close');
      close.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
      close.onclick = () => dlg.close();
      dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
      dlg.append(close, build(c, p.content, d));
      // The trigger opens the dialog (its own action, if any, doesn't fire).
      el.addEventListener('click', e => { if (!dlg.contains(e.target)) { e.stopPropagation(); dlg.showModal(); } }, true);
      el.append(build(c, p.trigger, d), dlg);
      return el;
    },
    Button(p, c, d) {
      const b = h('button', `a2ui-btn a2ui-btn-${['primary', 'borderless'].includes(p.variant) ? p.variant : 'default'}`);
      b.type = 'button';
      b.append(build(c, p.child, d));
      bind(c, () => { const e = failed(c, p); b.disabled = !!e; b.title = e; });
      b.onclick = () => act(c, p, b);
      return b;
    },
    TextField(p, c) {
      const long = p.variant === 'longText', inp = h(long ? 'textarea' : 'input', 'a2ui-input');
      if (long) inp.rows = 3;
      else inp.type = p.variant === 'number' ? 'number' : p.variant === 'obscured' ? 'password' : 'text';
      const f = field(c, p, inp);
      bind(c, () => { inp.placeholder = str(val(p.placeholder, c)); });
      bindValue(c, p.value, v => { const t = str(v); if (document.activeElement !== inp && inp.value !== t) inp.value = t; });
      inp.addEventListener('input', () => { f.touch(); write(c, p.value, p.variant === 'number' && inp.value !== '' ? Number(inp.value) : inp.value); });
      inp.addEventListener('blur', () => { f.touch(); refresh(c.s); });
      return f.el;
    },
    CheckBox(p, c) {
      const box = h('input', 'a2ui-checkbox');
      box.type = 'checkbox';
      const f = field(c, p, box, 'label', true);
      bindValue(c, p.value, v => { box.checked = !!v; });
      box.addEventListener('change', () => { f.touch(); write(c, p.value, box.checked); });
      return f.el;
    },
    ChoicePicker(p, c) {
      const multi = p.variant === 'multipleSelection', chips = p.displayStyle === 'chips';
      const holder = h('div', 'a2ui-choice-wrap'), list = h('div', chips ? 'a2ui-chips' : 'a2ui-choices');
      list.role = multi ? 'group' : 'radiogroup';
      let sel = [];
      const opts = (p.options || []).map(o => {
        const b = h('button', chips ? 'a2ui-chip' : 'a2ui-choice'), t = h('span');
        b.type = 'button'; b.role = multi ? 'checkbox' : 'radio';
        if (!chips) b.append(h('span', `a2ui-choice-mark${multi ? '' : ' a2ui-radio'}`));
        b.append(t);
        bind(c, () => { t.textContent = str(val(o.label, c)); });
        b.onclick = () => {
          sel = multi ? (sel.includes(o.value) ? sel.filter(x => x !== o.value) : [...sel, o.value]) : [o.value];
          paint(); f.touch(); write(c, p.value, sel);
        };
        return { b, t, o };
      });
      const paint = () => opts.forEach(({ b, o }) => b.setAttribute('aria-checked', String(sel.includes(o.value))));
      bindValue(c, p.value, v => { sel = Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)]; paint(); });
      if (p.filterable) {
        const q = h('input', 'a2ui-input a2ui-filter');
        q.placeholder = 'Filter'; q.setAttribute('aria-label', 'Filter options');
        q.oninput = () => { const s = q.value.toLowerCase(); opts.forEach(({ b, t }) => { b.hidden = !t.textContent.toLowerCase().includes(s); }); };
        holder.append(q);
      }
      list.append(...opts.map(x => x.b));
      holder.append(list);
      const f = field(c, p, holder, 'div');
      return f.el;
    },
    Slider(p, c) {
      const row = h('div', 'a2ui-slider-row'), r = h('input', 'a2ui-slider'), out = h('span', 'a2ui-slider-value');
      const min = Number(p.min ?? 0), max = Number(p.max ?? 100);
      r.type = 'range'; r.min = min; r.max = max; r.step = p.steps ? (max - min) / p.steps : 'any';
      const show = () => { out.textContent = String(+Number(r.value).toFixed(2)); };
      row.append(r, out);
      const f = field(c, p, row);
      bindValue(c, p.value, v => { if (document.activeElement !== r) r.value = v ?? min; show(); });
      r.addEventListener('input', () => { show(); f.touch(); write(c, p.value, Number(r.value)); });
      return f.el;
    },
    DateTimeInput(p, c) {
      const inp = h('input', 'a2ui-input'), date = !!p.enableDate, time = !!p.enableTime;
      inp.type = date && !time ? 'date' : time && !date ? 'time' : 'datetime-local';
      // ISO strings in, the input's own format out (date: YYYY-MM-DD, time: HH:mm, both: YYYY-MM-DDTHH:mm).
      const norm = v => { const s = str(v).replace(' ', 'T'); return inp.type === 'date' ? s.slice(0, 10) : inp.type === 'time' ? (s.includes('T') ? s.split('T')[1] : s).slice(0, 5) : s.slice(0, 16); };
      const f = field(c, p, inp);
      bind(c, () => { inp.min = norm(val(p.min, c)); inp.max = norm(val(p.max, c)); });
      bindValue(c, p.value, v => { if (document.activeElement !== inp) inp.value = norm(v); });
      inp.addEventListener('change', () => { f.touch(); write(c, p.value, inp.value); });
      return f.el;
    },
  };

  // ── Chart (a TerminalVibe extension to the basic catalog) ──
  // {"component":"Chart","type":"bar"|"line"|"area"|"pie"|"donut","stacked":bool,"labels":[…],"series":[{"name","values":[…]}],
  //  "unit":"%","min","max","height"}. Bars and areas grow from zero (grouped, or stacked); a line fits its data; a pie or
  // donut splits series[0] across the labels (8 slices max, the rest folded into "Other").
  // Categorical hues in fixed order (validated light/dark sets, 8 max), thin marks, 2px surface gaps, hairline grid, a
  // legend for 2+ series or slices, a hover/focus tooltip and a table view (the light set's contrast relief).
  const HUES = {
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
    light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  };
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs = {}, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent?.append(el);
    return el;
  };
  function niceScale(lo, hi, n = 4) {
    if (lo === hi) hi = lo + 1;
    const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, ticks = [];
    for (let t = a; t <= b + step / 2; t += step) ticks.push(+t.toFixed(10));
    return { lo: a, hi: b, ticks };
  }
  // A line's points as a path, breaking the line where a value is missing.
  const linePath = pts => pts.reduce((d, q, i) => !q ? d : d + `${!pts[i - 1] ? 'M' : 'L'}${q[0].toFixed(1)},${q[1].toFixed(1)}`, '');
  // A column from the baseline (y0) to y: 4px rounded data end (only the outer segment of a stack), square at the baseline.
  function barPath(x, w, y0, y, round = true) {
    const up = y <= y0, r = round ? Math.min(4, w / 2, Math.abs(y0 - y)) : 0, s = up ? 1 : -1;
    return `M${x},${y0}V${y + s * r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + s * r}V${y0}Z`;
  }
  // The band between a top and a base line (arrays of [x, y] or null), one closed shape per unbroken run.
  function areaPath(top, base) {
    let d = '';
    for (let i = 0; i < top.length;) {
      if (!top[i]) { i++; continue; }
      let j = i;
      while (j + 1 < top.length && top[j + 1]) j++;
      const run = top.slice(i, j + 1), under = base.slice(i, j + 1).reverse();
      d += linePath(run) + under.map(q => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('') + 'Z';
      i = j + 1;
    }
    return d;
  }
  // A pie/donut slice from angle a0 to a1 (radians, clockwise from 12 o'clock).
  function slicePath(cx, cy, r, ri, a0, a1) {
    const pt = (rad, a) => `${(cx + rad * Math.sin(a)).toFixed(2)},${(cy - rad * Math.cos(a)).toFixed(2)}`, large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${pt(r, a0)}A${r},${r} 0 ${large} 1 ${pt(r, a1)}` + (ri ? `L${pt(ri, a1)}A${ri},${ri} 0 ${large} 0 ${pt(ri, a0)}Z` : `L${cx},${cy}Z`);
  }
  C.Chart = (p, c) => {
    const el = h('div', 'a2ui-chart'), legend = h('div', 'a2ui-chart-legend');
    const toggle = h('button', 'a2ui-chart-toggle'), plot = h('div', 'a2ui-chart-plot'), table = h('div', 'thr-table-wrap a2ui-chart-table'), tip = h('div', 'a2ui-chart-tip');
    toggle.type = 'button'; toggle.title = 'Show table'; toggle.setAttribute('aria-label', 'Show table'); toggle.setAttribute('aria-pressed', 'false');
    toggle.innerHTML = '<i class="ph ph-rows" aria-hidden="true"></i>';
    toggle.onclick = () => {
      const on = table.hidden;
      table.hidden = !on; toggle.setAttribute('aria-pressed', String(on));
      toggle.title = on ? 'Hide table' : 'Show table'; toggle.setAttribute('aria-label', toggle.title);
    };
    table.hidden = true; tip.hidden = true;
    plot.append(tip);
    el.append(toggle, legend, plot, table);
    const type = ['line', 'area', 'pie', 'donut'].includes(p.type) ? p.type : 'bar', isPie = type === 'pie' || type === 'donut';
    const stacked = !!p.stacked && (type === 'bar' || type === 'area'), height = Math.max(120, Math.min(480, Number(p.height) || 220));
    const NAMES = { bar: 'Bar', line: 'Line', area: 'Area', pie: 'Pie', donut: 'Donut' };
    let data = { labels: [], series: [] }, width = 0;
    const read = () => {
      const labels = (val(p.labels, c) || []).map(str);
      const raw = val(p.series, c);
      const series = (Array.isArray(raw) ? raw : []).slice(0, 8).map(s => ({
        name: str(val(s?.name, c)),
        values: (Array.isArray(val(s?.values, c)) ? val(s.values, c) : []).map(v => v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)),
      }));
      return { labels, series, unit: str(val(p.unit, c)) };
    };
    const fmt = (v, compact) => {
      if (v == null) return '–';
      const num = new Intl.NumberFormat(undefined, compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }).format(v);
      // A currency leads, the rest follows: "$" → $400, "$B" → $150B, "%" → 12%.
      const cur = /^([$€£¥₹])(.*)$/.exec(data.unit);
      return cur ? (v < 0 ? '-' : '') + cur[1] + num.replace(/^-/, '') + cur[2] : num + data.unit;
    };
    function drawTable() {
      const t = h('table', 'thr-table'), head = h('tr');
      const cell = (tag, text, num) => { const td = h(tag); td.textContent = text; if (num) td.style.textAlign = 'right'; return td; };
      head.append(cell('th', ''), ...data.series.map(s => cell('th', s.name || 'Value', true)));
      const thead = h('thead'), tbody = h('tbody');
      thead.append(head);
      data.labels.forEach((l, i) => { const tr = h('tr'); tr.append(cell('td', l), ...data.series.map(s => cell('td', fmt(s.values[i]), true))); tbody.append(tr); });
      t.append(thead, tbody);
      const scroll = h('div', 'thr-table-scroll');
      scroll.append(t);
      table.replaceChildren(scroll);
    }
    // keys: [{ name, color, note }] (series, or a pie's slices with their share); one key needs no legend (the title names it).
    function drawLegend(keys) {
      legend.replaceChildren();
      legend.hidden = keys.length < 2;
      if (legend.hidden) return;
      for (const k of keys) {
        const item = h('span', 'a2ui-chart-key'), mark = h('span', `a2ui-chart-swatch a2ui-chart-swatch-${type === 'line' ? 'line' : 'bar'}`), name = h('span');
        mark.style.background = k.color; name.textContent = k.name;
        item.append(mark, name);
        if (k.note) { const note = h('span', 'a2ui-chart-key-note'); note.textContent = k.note; item.append(note); }
        legend.append(item);
      }
    }
    // The readout: a title, then rows of [color, value, name] (values lead, names follow), placed beside x.
    function showTip(title, rows, x, W) {
      const head = h('div', 'a2ui-chart-tip-title');
      head.textContent = title;
      tip.replaceChildren(head, ...rows.map(([color, value, name]) => {
        const row = h('div', 'a2ui-chart-tip-row'), key = h('span', 'a2ui-chart-tip-key'), v = h('strong'), n = h('span');
        key.style.background = color; v.textContent = value; n.textContent = name;
        row.append(key, v, n); return row;
      }));
      tip.hidden = false;
      tip.style.left = `${x + 12 + tip.offsetWidth > W ? Math.max(0, x - 12 - tip.offsetWidth) : Math.max(0, x + 12)}px`;
    }
    // Keyboard: Tab focuses the chart, arrows step through x positions or slices; a click never focuses it (no ring).
    function bindHover(svg, count, show, hide) {
      let at = -1;
      const go = i => { at = i; show(i); };
      svg.addEventListener('pointerleave', () => { at = -1; hide(); });
      svg.addEventListener('mousedown', e => e.preventDefault());
      svg.addEventListener('focus', () => go(Math.max(0, at)));
      svg.addEventListener('blur', () => { at = -1; hide(); });
      svg.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        go(Math.min(count - 1, Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1))));
      });
      return go;
    }
    function drawPie(W, H, colors) {
      const values = data.series[0]?.values || [];
      let items = data.labels.map((label, i) => ({ label, v: values[i] })).filter(x => x.v > 0);
      if (items.length > 8) items = [...items.slice(0, 7), { label: 'Other', v: items.slice(7).reduce((a, x) => a + x.v, 0) }];
      const total = items.reduce((a, x) => a + x.v, 0);
      if (!total) return;
      const pct = v => `${+(v / total * 100).toFixed(1)}%`;
      drawLegend(items.map((x, i) => ({ name: x.label, color: colors[i], note: pct(x.v) })));
      const r = Math.min(H, W) / 2 - 8, ri = type === 'donut' ? r * 0.6 : 0, cx = W / 2, cy = H / 2;
      const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'a2ui-chart-svg', role: 'img', tabindex: '0',
        'aria-label': `${NAMES[type]} chart of ${data.series[0]?.name || 'values'} across ${items.length} ${items.length === 1 ? 'part' : 'parts'}. Use the arrow keys or the table for values.` });
      let a = 0;
      const slices = items.map((x, i) => {
        const a0 = a, a1 = (a += x.v / total * Math.PI * 2), mid = (a0 + a1) / 2, rm = (r + ri) / 2 || r / 2;
        const d = items.length === 1 ? `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx - 0.01},${cy - r}Z` + (ri ? `M${cx},${cy - ri}A${ri},${ri} 0 1 0 ${cx - 0.01},${cy - ri}Z` : '') : slicePath(cx, cy, r, ri, a0, a1);
        const path = sv('path', { d, fill: colors[i], 'fill-rule': 'evenodd', class: 'a2ui-chart-slice' }, svg);
        path.addEventListener('pointerenter', () => go(i));
        return { path, x: cx + rm * Math.sin(mid) };
      });
      const show = i => {
        slices.forEach((s, k) => s.path.classList.toggle('hover', k === i));
        showTip(items[i].label, [[colors[i], fmt(items[i].v), pct(items[i].v)]], slices[i].x, W);
      };
      const go = bindHover(svg, items.length, show, () => { tip.hidden = true; slices.forEach(s => s.path.classList.remove('hover')); });
      plot.prepend(svg);
    }
    function draw() {
      width = plot.clientWidth;
      if (!width) return;
      plot.querySelector('svg')?.remove();
      tip.hidden = true;
      const dark = (getComputedStyle(el).color.match(/\d+/g) || [255, 255, 255]).slice(0, 3).reduce((a, n) => a + Number(n), 0) > 382; // light text = dark theme
      const colors = HUES[dark ? 'dark' : 'light'];
      drawTable();
      if (isPie) return drawPie(width, height, colors);
      drawLegend(data.series.map((s, i) => ({ name: s.name, color: colors[i] })));
      const { labels, series } = data, n = labels.length;
      // Stacks: each series' running total above (or below) the ones before it, positives and negatives apart.
      const stack = stacked && (() => {
        const up = Array(n).fill(0), down = Array(n).fill(0);
        return series.map(s => labels.map((_, i) => {
          const v = s.values[i] || 0, base = v < 0 ? down[i] : up[i];
          if (v < 0) down[i] += v; else up[i] += v;
          return [base, base + v];
        }));
      })();
      const all = stack ? stack.flat(2) : series.flatMap(s => s.values.slice(0, n)).filter(v => v != null);
      if (!n || !all.length) return;
      // Bars and areas grow from zero; a line fits its data (a stock at 250–400 shouldn't flatten against a 0 baseline).
      const zero = type === 'line' ? [] : [0];
      const lo = p.min != null ? Number(p.min) : Math.min(...zero, ...all), hi = p.max != null ? Number(p.max) : Math.max(...zero, ...all);
      const sc = niceScale(lo, hi), compact = Math.max(Math.abs(sc.lo), Math.abs(sc.hi)) >= 10000;
      const tickText = sc.ticks.map(t => fmt(t, compact));
      const left = Math.max(...tickText.map(t => t.length)) * 6.5 + 12, top = 8, right = 8, bottom = 24;
      const W = width, H = height, pw = Math.max(10, W - left - right), ph = H - top - bottom;
      const y = v => top + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph, band = pw / n;
      const cx = i => left + band * i + band / 2;
      const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'a2ui-chart-svg', role: 'img', tabindex: '0',
        'aria-label': `${stacked ? 'Stacked ' + NAMES[type].toLowerCase() : NAMES[type]} chart of ${series.map(s => s.name).filter(Boolean).join(', ') || 'values'} over ${n} ${n === 1 ? 'category' : 'categories'}. Use the arrow keys or the table for values.` });
      // Grid and y ticks.
      sc.ticks.forEach((t, k) => {
        sv('line', { x1: left, x2: W - right, y1: y(t), y2: y(t), class: t === 0 ? 'a2ui-chart-base' : 'a2ui-chart-grid' }, svg);
        sv('text', { x: left - 8, y: y(t) + 4, class: 'a2ui-chart-tick', 'text-anchor': 'end' }, svg).textContent = tickText[k];
      });
      // X labels that would collide: a few categories each keep theirs, shortened with "…" (the tooltip has the full
      // name); a long run (dates) shows every k-th.
      const fits = Math.max(1, Math.floor((band - 8) / 6.5)), every = n > 12 ? Math.max(1, Math.ceil((Math.max(...labels.map(l => l.length)) * 6.5 + 8) / band)) : 1;
      labels.forEach((l, i) => {
        if (i % every) return;
        sv('text', { x: cx(i), y: H - 6, class: 'a2ui-chart-tick', 'text-anchor': 'middle' }, svg).textContent = every > 1 || l.length <= fits ? l : l.slice(0, Math.max(1, fits - 1)) + '…';
      });
      const marks = sv('g', {}, svg), groups = [];
      const y0 = y(Math.max(sc.lo, Math.min(0, sc.hi)));
      if (type === 'bar' && stack) {
        // One column per x; segments 2px apart (surface gap), only each direction's outer segment rounded.
        const bw = Math.max(2, Math.min(24, band * 0.6));
        for (let i = 0; i < n; i++) {
          const g = sv('g', { class: 'a2ui-chart-group' }, marks);
          const outer = sign => stack.findLastIndex(s => Math.sign(s[i][1] - s[i][0]) === sign);
          const topUp = outer(1), topDown = outer(-1);
          stack.forEach((s, k) => {
            const [b, t] = s[i];
            if (b === t) return;
            const dir = t > b ? 1 : -1, isOuter = k === (dir > 0 ? topUp : topDown);
            const yb = y(b) - (b ? dir : 0), yt = y(t) + (isOuter ? 0 : dir);
            if (Math.abs(yb - yt) >= 0.5) sv('path', { d: barPath(cx(i) - bw / 2, bw, yb, yt, isOuter), fill: colors[k] }, g);
          });
          groups.push(g);
        }
      } else if (type === 'bar') {
        const m = series.length, bw = Math.max(2, Math.min(24, (band * 0.72 - (m - 1) * 2) / m)), gw = m * bw + (m - 1) * 2;
        for (let i = 0; i < n; i++) {
          const g = sv('g', { class: 'a2ui-chart-group' }, marks);
          series.forEach((s, k) => { const v = s.values[i]; if (v != null) sv('path', { d: barPath(cx(i) - gw / 2 + k * (bw + 2), bw, y0, y(v)), fill: colors[k] }, g); });
          groups.push(g);
        }
      } else {
        // Lines (2px, end dot with a surface ring); an area adds a ~10% wash down to zero, or to the layer below it.
        series.forEach((s, k) => {
          const pts = labels.map((_, i) => stack ? [cx(i), y(stack[k][i][1])] : s.values[i] == null ? null : [cx(i), y(s.values[i])]);
          if (type === 'area') {
            const base = labels.map((_, i) => [cx(i), stack ? y(stack[k][i][0]) : y0]);
            sv('path', { d: areaPath(pts, base), fill: colors[k], 'fill-opacity': stack ? 0.2 : 0.1, stroke: 'none' }, marks);
          }
          sv('path', { d: linePath(pts), fill: 'none', stroke: colors[k], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, marks);
          const last = pts.findLast(Boolean);
          if (last) sv('circle', { cx: last[0], cy: last[1], r: 4, fill: colors[k], class: 'a2ui-chart-dot' }, marks);
        });
      }
      const cross = sv('line', { y1: top, y2: top + ph, class: 'a2ui-chart-cross', visibility: 'hidden' }, svg);
      // Hover / focus: one readout per x, listing every series (a stack adds its total).
      const show = i => {
        groups.forEach((g, k) => g.classList.toggle('hover', k === i));
        if (type !== 'bar') { cross.setAttribute('x1', cx(i)); cross.setAttribute('x2', cx(i)); cross.setAttribute('visibility', 'visible'); }
        const rows = series.map((s, k) => [colors[k], fmt(s.values[i]), s.name]);
        if (stack && series.length > 1) rows.push(['transparent', fmt(series.reduce((a, s) => a + (s.values[i] || 0), 0)), 'Total']);
        showTip(labels[i], rows, cx(i), W);
      };
      const go = bindHover(svg, n, show, () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); groups.forEach(g => g.classList.remove('hover')); });
      for (let i = 0; i < n; i++) {
        const hit = sv('rect', { x: left + band * i, y: top, width: band, height: ph + bottom, class: 'a2ui-chart-hit' }, svg);
        hit.addEventListener('pointerenter', () => go(i));
      }
      plot.prepend(svg);
    }
    plot.style.height = `${height}px`;
    bind(c, () => { const next = read(); if (JSON.stringify(next) === JSON.stringify(data)) return; data = next; draw(); });
    new ResizeObserver(() => { if (plot.clientWidth !== width) draw(); }).observe(plot);
    return el;
  };

  // A button's action: run a function call here, or send an `action` event (with the surface's data model when asked).
  function act(c, p, btn) {
    const a = p.action, s = c.s;
    if (a?.functionCall) { call(a.functionCall, c); return; }
    const ev = a?.event;
    if (!ev?.name) return;
    const context = {};
    for (const [k, v] of Object.entries(ev.context || {})) context[k] = val(v, c);
    const userMessage = ev.userMessage != null ? str(val(ev.userMessage, c)) : '';
    const message = { version: V, action: { name: ev.name, surfaceId: s.id, sourceComponentId: p.id, timestamp: new Date().toISOString(), context, ...(userMessage ? { userMessage } : {}) } };
    if (s.locked) return;
    s.opts.onAction?.({ message, userMessage, dataModel: s.sendDataModel ? { version: V, surfaces: { [s.id]: s.model } } : null, button: btn });
    lock(s);
  }

  // Applies one ```a2ui block's messages to a chat's surfaces (state, from A2UI.state()) and returns its element.
  // A chat shows the UI as it was at each reply: a block that updates a surface from an earlier reply renders an updated
  // copy here (its components and what the user entered carried over), which becomes the live one; the earlier one
  // stays in the history as it was. Deleting a surface removes it.
  function mount(state, msgs, opts = {}) {
    const out = h('div', 'a2ui-block'), here = new Set();
    const surface = (id, from) => {
      const s = { id, sendDataModel: !!from?.sendDataModel, model: from ? structuredClone(from.model) : {}, comps: new Map(from?.comps), opts, updaters: [], el: h('div', 'a2ui-surface') };
      s.el.dataset.surfaceId = id;
      state.surfaces.set(id, s); out.append(s.el); here.add(s);
      return s;
    };
    for (const m of msgs) {
      if (m.createSurface) {
        const cs = m.createSurface, s = surface(cs.surfaceId);
        s.sendDataModel = !!cs.sendDataModel;
        s.model = structuredClone(cs.dataModel || {});
        for (const comp of cs.components || []) s.comps.set(comp.id, comp);
        continue;
      }
      const body = m.updateComponents || m.updateDataModel || m.deleteSurface;
      let s = body && state.surfaces.get(body.surfaceId);
      if (!s) continue; // ponytail: callRendererFunction / agentFunctionResponse are ignored (no function calls over chat)
      if (m.deleteSurface) { s.el.remove(); state.surfaces.delete(s.id); here.delete(s); continue; }
      if (!here.has(s)) s = surface(s.id, s);
      if (m.updateComponents) for (const comp of body.components || []) s.comps.set(comp.id, comp);
      else setP(s, body.path, body.value);
    }
    here.forEach(render);
    return out;
  }

  // A submitted action (an ```a2ui-action block: the action, then the data model when sent), for people: each input of
  // its surface as [label, what was entered], options by their labels. Without the surface or a data model, the action's
  // context as [key, value]. Returns { surfaceId, rows }, or null when the block holds no action.
  const INPUTS = new Set(['TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'DateTimeInput']);
  function answer(state, src) {
    const msgs = String(src).split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const action = msgs.find(m => m?.action)?.action;
    if (!action) return null;
    const model = msgs.find(m => m?.surfaces)?.surfaces?.[action.surfaceId], s = state?.surfaces.get(action.surfaceId), rows = [];
    if (s && isObj(model)) {
      const c = { s: { ...s, model }, base: '' };
      for (const p of s.comps.values()) {
        const path = INPUTS.has(p.component) && isObj(p.value) ? String(p.value['@path'] ?? '') : '';
        if (!path.startsWith('/')) continue;
        const v = getP(model, path);
        const text = p.component === 'CheckBox' ? (v ? 'Yes' : 'No')
          : p.component === 'ChoicePicker' ? [v].flat().filter(x => x != null && x !== '').map(x => str(val((p.options || []).find(o => o.value === x)?.label, c)) || str(x)).join(', ')
          : p.variant === 'obscured' && v ? '••••••' : str(v);
        if (text) rows.push([str(val(p.label, c)) || path.split('/').pop(), text]);
      }
    }
    if (!rows.length) for (const [k, v] of Object.entries(action.context || {})) if (str(v)) rows.push([k, Array.isArray(v) ? v.map(str).join(', ') : str(v)]);
    return { surfaceId: action.surfaceId, rows };
  }

  window.A2UI = { version: V, parse, mount, answer, lock: (state, surfaceId) => lock(state?.surfaces.get(surfaceId)), state: () => ({ surfaces: new Map(), blocks: new Map() }), _test: { interp, fmtDate, getP, setP, call } };
})();
