(() => {
  'use strict';

  // ---------- config ----------
  const OWNER = 'blkctrs-sys';
  const PUBLIC_REPO = 'agent-town';
  const PRIVATE_REPO = 'agent-town-private';
  const API = 'https://api.github.com/repos/';
  const PRIVATE_DIRS = ['mildred/prep/', 'mildred/drills/', 'tailored/'];
  const INTERVIEWS = 'mildred/interviews.md';
  const TOKEN_KEY = 'agentTown.readingRoom.token';
  const PREFS_KEY = 'agentTown.readingRoom.prefs';
  const RUN_ORDER = { '': 0, morning: 0, midday: 1, afternoon: 2, late: 3 };
  const CAT_NAMES = { art: 'Games & tech', ops: 'Operations' };

  // ---------- small helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  const slug = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const store = {
    get(area, k) { try { return window[area].getItem(k); } catch { return null; } },
    set(area, k, v) { try { window[area].setItem(k, v); } catch { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* storage blocked */ } },
  };
  const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const shortDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const daysAgo =(d) => Math.floor((Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400000);

  function renderMd(text) {
    if (!window.marked || !window.DOMPurify) return `<pre>${esc(text)}</pre>`;
    // Drop the file's own "# Title" line (the reader shows it already) and keep single line breaks.
    const body = String(text || '').replace(/^\s*# .*\r?\n/, '');
    const html = DOMPurify.sanitize(marked.parse(body, { gfm: true, breaks: true }));
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    return div.innerHTML;
  }

  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
    }));
    return out;
  }

  // ---------- state ----------
  let token = store.get('localStorage', TOKEN_KEY) || store.get('sessionStorage', TOKEN_KEY) || '';
  const state = {
    reports: [],   // { file, date, run, text, summary, jobs: [] }
    jobs: [],      // flattened
    priv: null,    // { prep: [], drills: [], tailored: [], interviews: '' } once unlocked
    privError: '',
    loadingPriv: false,
  };
  const prefs = Object.assign({ view: 'board', cat: 'all', range: 'all', verified: false, prepped: false, q: '' },
    (() => { try { return JSON.parse(store.get('localStorage', PREFS_KEY) || '{}'); } catch { return {}; } })());
  const savePrefs = () => store.set('localStorage', PREFS_KEY, JSON.stringify({ ...prefs, q: '' }));

  // ---------- GitHub access ----------
  async function gh(path, { raw = false, auth = false } = {}) {
    const headers = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' };
    if (auth && token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(API + path, { headers, cache: 'no-cache' });
    if (!res.ok) {
      const err = new Error('GitHub ' + res.status);
      err.status = res.status;
      throw err;
    }
    return raw ? res.text() : res.json();
  }

  // ---------- Craig's public reports ----------
  async function listReportFiles() {
    const path = `${OWNER}/${PUBLIC_REPO}/contents/jobs?ref=main`;
    try {
      // With a token first (higher rate limit), then without, in case the token is expired or scoped elsewhere.
      const list = await (token ? gh(path, { auth: true }).catch(() => gh(path)) : gh(path));
      return list.filter((f) => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(f.name)).map((f) => f.name);
    } catch (e) {
      state.partial = true;
      // Rate-limited or offline: fall back to the latest report named in Craig's status file.
      const s = await fetch('../status/job-scout.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => null);
      return s && s.report ? [s.report.replace(/^jobs\//, '')] : [];
    }
  }

  function parseReport(file, text) {
    const m = file.match(/^(\d{4}-\d{2}-\d{2})(?:-(.+))?\.md$/);
    const date = m[1], run = m[2] || '';
    const lines = text.split(/\r?\n/);
    const jobs = [];
    let cat = null, cur = null;
    const summary = (lines.find((l) => /^Found \d+/.test(l)) || '').trim();
    for (const line of lines) {
      const h = line.match(/^##\s+(.*)/);
      if (h) {
        cur = null;
        cat = /oper|invent/i.test(h[1]) ? 'ops' : /game|tech|art/i.test(h[1]) ? 'art' : null;
        continue;
      }
      if (!cat) continue;
      const it = line.match(/^\d+\.\s+\*\*(?:\[(.+?)\]\((\S+?)\)|(.+?))\*\*(?:\s*\([^)]*\))?\s*[—–-]\s*(.*)$/);
      if (it) {
        const parts = it[4].split(' · ').map((s) => s.trim());
        cur = {
          id: `${file}#${jobs.length}`,
          title: it[1] || it[3], url: it[2] || '',
          company: parts[0] || '', location: parts[1] || '', source: parts.slice(2).join(' · '),
          category: cat, date, run, file, note: '',
        };
        jobs.push(cur);
        continue;
      }
      if (cur && /^\s+\S/.test(line)) cur.note += (cur.note ? ' ' : '') + line.trim();
      else if (cur && !line.trim()) cur = null;
    }
    for (const j of jobs) {
      j.note = j.note.replace(/^Why it fits:\s*/i, '');
      j.verified = /verified via/i.test(j.note) && !/unverified/i.test(j.note);
      j.short = j.note.replace(/\s*(Verified via[^.]*\.|Unverified\.?)\s*$/i, '');
    }
    return { file, date, run, text, summary, jobs };
  }

  async function loadReports() {
    const files = await listReportFiles();
    const reports = await pool(files, 6, async (f) => {
      try {
        const text = await fetch('../jobs/' + encodeURIComponent(f), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw 0; return r.text(); });
        return parseReport(f, text);
      } catch { return null; }
    });
    state.reports = reports.filter(Boolean).sort((a, b) =>
      b.date.localeCompare(a.date) || (RUN_ORDER[b.run] ?? 9) - (RUN_ORDER[a.run] ?? 9) || b.run.localeCompare(a.run));
    state.jobs = state.reports.flatMap((r) => r.jobs);
  }

  // ---------- Mildred + tailored (private) ----------
  function headerTitle(text, prefix) {
    const line = (text.match(new RegExp('^#\\s*' + prefix + '\\s*(.+)$', 'mi')) || [])[1] || '';
    const [title, company] = line.split(/\s+[—–]\s+/);
    return { title: (title || '').trim(), company: (company || '').trim() };
  }

  async function loadPrivate() {
    if (!token) return;
    state.loadingPriv = true; state.privError = ''; renderUnlock();
    try {
      const tree = await gh(`${OWNER}/${PRIVATE_REPO}/git/trees/main?recursive=1`, { auth: true });
      const paths = tree.tree.filter((t) => t.type === 'blob' && t.path.endsWith('.md') &&
        (PRIVATE_DIRS.some((d) => t.path.startsWith(d)) || t.path === INTERVIEWS)).map((t) => t.path);
      const texts = await pool(paths, 6, (p) =>
        gh(`${OWNER}/${PRIVATE_REPO}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=main`, { raw: true, auth: true }).catch(() => ''));
      const priv = { prep: [], drills: [], tailored: [], interviews: '' };
      paths.forEach((p, i) => {
        const text = texts[i];
        const name = p.split('/').pop().replace(/\.md$/, '');
        const date = (name.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
        const link = (text.match(/^Job link:\s*(\S+)/mi) || [])[1] || '';
        const doc = { path: p, name, date, text, link };
        if (p === INTERVIEWS) priv.interviews = text;
        else if (p.startsWith('mildred/prep/')) {
          Object.assign(doc, headerTitle(text, 'Prep pack:'));
          doc.source = (text.match(/^Source:\s*(.+)$/mi) || [])[1] || '';
          doc.real = /interview/i.test(doc.source) && !/craig/i.test(doc.source);
          priv.prep.push(doc);
        } else if (p.startsWith('mildred/drills/')) priv.drills.push(doc);
        else priv.tailored.push(Object.assign(doc, headerTitle(text, 'Tailored for:')));
      });
      for (const k of ['prep', 'drills', 'tailored']) priv[k].sort((a, b) => b.name.localeCompare(a.name));
      state.priv = priv;
      linkPrivate();
    } catch (e) {
      state.priv = null;
      state.privError = e.status === 401 ? "That token wasn't accepted. It may have expired or been mistyped."
        : e.status === 404 || e.status === 403 ? "The token works, but it can't read the private repo. Give it read access to agent-town-private's contents."
        : "Couldn't reach GitHub just now. Try again in a minute.";
    }
    state.loadingPriv = false;
    renderAll();
  }

  // Match each role to its tailored resume and prep pack: by job link first, then by date + company in the filename.
  function linkPrivate() {
    const find = (list, j) => list.find((d) => j.url && d.link === j.url)
      || list.find((d) => d.date === j.date && slug(d.company || '') === slug(j.company) && slug(d.title || '') === slug(j.title))
      || list.find((d) => d.date === j.date && d.name.startsWith(`${j.date}-${slug(j.company)}-`));
    for (const j of state.jobs) {
      j.tailored = state.priv ? find(state.priv.tailored, j) || null : null;
      j.prep = state.priv ? find(state.priv.prep, j) || null : null;
    }
  }

  // ---------- render: residents ----------
  async function renderResidents() {
    const [agents, craig, mildred] = await Promise.all(['../agents.json', '../status/job-scout.json', '../status/mildred.json']
      .map((u) => fetch(u, { cache: 'no-cache' }).then((r) => r.json()).catch(() => null)));
    const who = (id) => (agents || []).find((a) => a.id === id) || {};
    const card = (a, s) => {
      if (!s) return '';
      const label = { done: 'done', working: 'working', error: 'needs a look', waiting: 'waiting' }[s.state] || s.state;
      const when = s.lastRun ? new Date(s.lastRun).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
      return `<div><span class="dot" style="background:${esc(a.color || '#888')}"></span><div>
        <h3>${esc(a.name || s.agent)} <span class="state ${esc(s.state)}">${esc(label)}</span></h3>
        <p>${esc(s.message || s.summary || '')}</p>
        ${when ? `<p>Last run ${esc(when)}</p>` : ''}</div></div>`;
    };
    $('residents').innerHTML = card(who('job-scout'), craig) + card(who('mildred'), mildred);
  }

  // ---------- render: unlock ----------
  function renderUnlock() {
    const el = $('unlock');
    if (state.priv) {
      el.className = 'unlock ok';
      el.innerHTML = `<p>🔓 Private files unlocked: ${plural(state.priv.tailored.length, 'tailored resume')}, ${plural(state.priv.prep.length, 'prep pack')}, ${plural(state.priv.drills.length, 'drill')}.</p>
        <span><button class="btn ghost" id="refresh-priv">Refresh</button> <button class="btn ghost" id="lock">Lock</button></span>`;
      $('lock').onclick = () => { token = ''; store.del(TOKEN_KEY); state.priv = null; linkPrivate(); renderAll(); };
      $('refresh-priv').onclick = loadPrivate;
      return;
    }
    el.className = 'unlock';
    el.innerHTML = `<h2>Unlock Mildred's desk</h2>
      <p>Prep packs, drills and Craig's tailored resumes live in your private repo. Paste a read-only GitHub token to show them here.
      The token stays in this browser; nothing is saved to the site.</p>
      <form id="unlock-form">
        <input type="password" id="token" placeholder="github_pat_…" autocomplete="off" aria-label="GitHub token" ${state.loadingPriv ? 'disabled' : ''}>
        <label class="toggle"><input type="checkbox" id="remember" checked> Remember on this device</label>
        <button class="btn" type="submit" ${state.loadingPriv ? 'disabled' : ''}>${state.loadingPriv ? 'Unlocking…' : 'Unlock'}</button>
      </form>
      ${state.privError ? `<p class="err">${esc(state.privError)}</p>` : ''}
      <details><summary>How to make a token</summary><ol>
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained tokens → Generate new token</a>.</li>
        <li>Repository access: <b>Only select repositories</b> → <code>agent-town-private</code>.</li>
        <li>Permissions → Repository → <b>Contents: Read-only</b>. Nothing else.</li>
        <li>Pick an expiry (90 days is fine), generate, and paste it here. Do this once on each device.</li>
      </ol></details>`;
    $('unlock-form').onsubmit = (e) => {
      e.preventDefault();
      const t = $('token').value.trim();
      if (!t) return;
      token = t;
      store.del(TOKEN_KEY);
      store.set($('remember').checked ? 'localStorage' : 'sessionStorage', TOKEN_KEY, t);
      loadPrivate();
    };
  }

  // ---------- render: stats ----------
  function renderStats() {
    const jobs = state.jobs;
    const week = jobs.filter((j) => daysAgo(j.date) < 7).length;
    const ver = jobs.length ? Math.round(100 * jobs.filter((j) => j.verified).length / jobs.length) : 0;
    const p = state.priv;
    const tile = (n, l, locked) => `<div class="${locked ? 'locked' : ''}"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
    $('stats').innerHTML = tile(jobs.length, 'roles found')
      + tile(week, 'in the last 7 days')
      + tile(ver + '%', 'verified')
      + tile(p ? p.tailored.length : '🔒', 'tailored resumes', !p)
      + tile(p ? p.prep.length : '🔒', 'prep packs', !p);
  }

  // ---------- render: chart ----------
  function renderChart() {
    const byDay = {};
    for (const j of state.jobs) {
      const d = (byDay[j.date] = byDay[j.date] || { date: j.date, art: 0, ops: 0 });
      d[j.category]++;
    }
    const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length) { $('chart').innerHTML = '<p class="empty">No reports yet.</p>'; $('chart-table').innerHTML = ''; return; }
    const W = 760, H = 180, padL = 26, padB = 22, padT = 16;
    const max = Math.max(...days.map((d) => d.art + d.ops));
    const step = max <= 10 ? 5 : 10;
    const top = Math.ceil(max / step) * step;
    const y = (v) => H - padB - (v / top) * (H - padB - padT);
    const bw = (W - padL) / days.length;
    const barW = Math.min(40, bw * 0.6);
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Roles found per day, split by games and tech versus operations">`;
    for (let v = 0; v <= top; v += step) {
      svg += `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    const seg = (x, y0, y1, color, roundTop) => {
      const h = Math.max(0, y0 - y1);
      if (h <= 0) return '';
      const r = roundTop ? Math.min(4, h) : 0;
      // Square bottom on the baseline, 4px rounded top on the last segment.
      return `<path class="seg" fill="${color}" d="M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z"/>`;
    };
    days.forEach((d, i) => {
      const x = padL + i * bw + (bw - barW) / 2;
      const base = y(0), artTop = y(d.art), opsTop = y(d.art + d.ops);
      const gap = d.art && d.ops ? 2 : 0;
      svg += `<g class="col" data-i="${i}">`;
      svg += seg(x, base, artTop, 'var(--s-art)', !d.ops);
      svg += seg(x, artTop - gap, opsTop, 'var(--s-ops)', true);
      svg += `<text class="val" x="${x + barW / 2}" y="${opsTop - 4}" text-anchor="middle">${d.art + d.ops}</text>`;
      if (days.length <= 16 || i % 2 === 0) svg += `<text class="axis" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${esc(shortDay(d.date))}</text>`;
      svg += `<rect class="hit" x="${padL + i * bw}" y="0" width="${bw}" height="${H - padB}"/></g>`;
    });
    svg += '</svg>';
    $('chart').innerHTML = svg;
    const tip = $('tip');
    $('chart').querySelectorAll('.col').forEach((g) => {
      const d = days[+g.dataset.i];
      g.addEventListener('mousemove', (e) => {
        tip.innerHTML = `<b>${esc(fmtDay(d.date))}</b>
          <div class="row"><i class="sw sw-art"></i>Games &amp; tech: ${d.art}</div>
          <div class="row"><i class="sw sw-ops"></i>Operations: ${d.ops}</div>`;
        tip.hidden = false;
        const r = tip.getBoundingClientRect();
        tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 8) + 'px';
        tip.style.top = Math.max(8, e.clientY - r.height - 10) + 'px';
      });
      g.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
    $('chart-table').innerHTML = `<table><thead><tr><th>Day</th><th>Games &amp; tech</th><th>Operations</th><th>Total</th></tr></thead><tbody>`
      + days.slice().reverse().map((d) => `<tr><td>${esc(fmtDay(d.date))}</td><td>${d.art}</td><td>${d.ops}</td><td>${d.art + d.ops}</td></tr>`).join('')
      + '</tbody></table>';
  }

  // ---------- render: board ----------
  function filteredJobs() {
    const q = prefs.q.trim().toLowerCase();
    return state.jobs.filter((j) =>
      (prefs.cat === 'all' || j.category === prefs.cat)
      && (prefs.range === 'all' || daysAgo(j.date) < +prefs.range)
      && (!prefs.verified || j.verified)
      && (!prefs.prepped || !state.priv || j.prep)
      && (!q || [j.title, j.company, j.location, j.source, j.note].join(' ').toLowerCase().includes(q)));
  }

  function jobTags(j) {
    return `<span class="tag cat-${j.category}">${esc(CAT_NAMES[j.category])}</span>`
      + (j.verified ? '<span class="tag v">✓ Verified</span>' : '<span class="tag u">Unverified</span>')
      + (j.tailored ? '<span class="tag r">📄 Tailored resume</span>' : '')
      + (j.prep ? '<span class="tag p">🕯 Prep pack</span>' : '');
  }

  function renderBoard() {
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.cat === prefs.cat)));
    document.querySelectorAll('.private-only').forEach((el) => { el.hidden = !state.priv; });
    const jobs = filteredJobs();
    $('count').textContent = `${jobs.length} of ${state.jobs.length} roles`
      + (state.partial ? " · GitHub is busy, so only Craig's latest report loaded. Reload in a few minutes for the full history." : '');
    if (!jobs.length) { $('board').innerHTML = `<p class="empty">${state.jobs.length ? 'Nothing matches those filters.' : 'Loading Craig\'s reports…'}</p>`; return; }
    const days = {};
    for (const j of jobs) (days[j.date] = days[j.date] || []).push(j);
    $('board').innerHTML = Object.keys(days).sort().reverse().map((d) => `<div class="day">
      <h3><span>${esc(fmtDay(d))}</span> · ${days[d].length} role${days[d].length === 1 ? '' : 's'}</h3>
      <div class="grid">${days[d].map((j) => `<button class="item cat-${j.category}" data-job="${esc(j.id)}">
        <div class="t">${esc(j.title)}</div>
        <div class="w">${esc([j.company, j.location, j.source].filter(Boolean).join(' · '))}</div>
        <p class="nt">${esc(j.short)}</p>
        <div class="tags">${jobTags(j)}</div>
      </button>`).join('')}</div></div>`).join('');
  }

  // ---------- render: reports list ----------
  function renderReports() {
    $('report-list').innerHTML = state.reports.length ? state.reports.map((r) => `<button class="item" data-report="${esc(r.file)}">
      <div><div class="t">${esc(fmtDay(r.date))}${r.run ? ` · ${esc(r.run)}` : ''}</div><div class="w">${esc(r.summary)}</div></div>
      <div class="r">${r.jobs.filter((j) => j.category === 'art').length} games &amp; tech · ${r.jobs.filter((j) => j.category === 'ops').length} ops</div>
    </button>`).join('') : '<p class="empty">Loading…</p>';
  }

  // ---------- render: Mildred ----------
  function renderMildred() {
    const el = $('mildred');
    if (!state.priv) {
      el.innerHTML = `<p class="locked-note">🔒 Mildred keeps her work in the private repo. Unlock it above to read her prep packs, drills and your interview list here.</p>`;
      return;
    }
    const p = state.priv;
    const upcoming = (p.interviews.split(/^## Past/m)[0].split(/^## Upcoming/m)[1] || '').match(/^- Company:\s*\S.*$/gm) || [];
    const row = (doc, kind, title, meta) => `<button class="item mildred" data-doc="${esc(doc.path)}" data-kind="${kind}">
      <div><div class="t">${esc(title)}</div><div class="w">${esc(meta)}</div></div></button>`;
    el.innerHTML = `<div class="mildred-grid">
      <div><h3>Prep packs</h3><div class="list">${p.prep.map((d) => row(d, 'prep', [d.title, d.company].filter(Boolean).join(' — ') || d.name,
        `${d.date ? fmtDay(d.date) : ''}${d.source ? ' · ' + d.source : ''}`)).join('') || '<p class="empty">No prep packs yet.</p>'}</div></div>
      <div><h3>Practice drills</h3><div class="list">${p.drills.map((d) => row(d, 'drill', d.date ? fmtDay(d.date) : d.name,
        ((d.text.match(/^## 1\.\s*(.+?)\s*\(/m) || [])[1] || 'Daily drill'))).join('') || '<p class="empty">No drills yet.</p>'}</div>
        <h3 style="margin-top:18px">Interviews</h3>
        <div class="list"><button class="item mildred" data-doc="${INTERVIEWS}" data-kind="interviews">
          <div><div class="t">${upcoming.length ? `${upcoming.length} upcoming` : 'None on the list'}</div><div class="w">Read the list</div></div></button>
          <a class="btn ghost" style="text-align:center;text-decoration:none" href="https://github.com/${OWNER}/${PRIVATE_REPO}/edit/main/${INTERVIEWS}" target="_blank" rel="noopener">＋ Add an interview on GitHub</a>
        </div></div>
    </div>`;
  }

  function renderAll() {
    renderUnlock(); renderStats(); renderChart(); renderBoard(); renderReports(); renderMildred();
  }

  // ---------- views ----------
  function setView(v) {
    prefs.view = v; savePrefs();
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    for (const k of ['board', 'reports', 'mildred']) $('view-' + k).hidden = k !== v;
  }

  // ---------- reader ----------
  let lastFocus = null;
  function openReader(html) {
    lastFocus = document.activeElement;
    $('reader-body').innerHTML = html;
    $('reader').hidden = false; $('backdrop').hidden = false;
    $('reader').scrollTop = 0;
    document.body.style.overflow = 'hidden';
    $('close').focus();
  }
  function closeReader() {
    $('reader').hidden = true; $('backdrop').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  function openJob(j) {
    const tabs = [['note', "Craig's note"]];
    if (j.tailored) tabs.push(['tailored', 'Tailored resume']);
    if (j.prep) tabs.push(['prep', 'Prep pack']);
    const panes = {
      note: `<div class="md"><p>${esc(j.note)}</p><p class="w">From <a href="#" data-report-link="${esc(j.file)}">Craig's ${esc(fmtDay(j.date))}${j.run ? ' ' + esc(j.run) : ''} report</a>.</p>
        ${state.priv ? '' : '<p class="w">🔒 Unlock the private repo to see the tailored resume and prep pack for this role, if there is one.</p>'}</div>`,
      tailored: j.tailored ? `<div class="md">${renderMd(j.tailored.text)}</div>` : '',
      prep: j.prep ? `<div class="md">${renderMd(j.prep.text)}</div>` : '',
    };
    openReader(`<h2 class="rt" id="reader-title">${esc(j.title)}</h2>
      <div class="w">${esc([j.company, j.location, j.source].filter(Boolean).join(' · '))}</div>
      <div class="tags">${jobTags(j)}</div>
      <div class="actions">${j.url ? `<a class="btn" href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener">Open the listing ↗</a>` : ''}</div>
      ${tabs.length > 1 ? `<div class="rtabs" role="tablist">${tabs.map(([k, l], i) => `<button role="tab" data-pane="${k}" aria-selected="${i === 0}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div id="pane">${panes.note}</div>`);
    $('reader-body').querySelectorAll('.rtabs button').forEach((b) => b.addEventListener('click', () => {
      $('reader-body').querySelectorAll('.rtabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $('pane').innerHTML = panes[b.dataset.pane];
    }));
  }

  function openReport(file) {
    const r = state.reports.find((x) => x.file === file);
    if (!r) return;
    openReader(`<h2 class="rt" id="reader-title">Craig · ${esc(fmtDay(r.date))}${r.run ? ' · ' + esc(r.run) : ''}</h2>
      <div class="actions"><a class="btn ghost" href="https://github.com/${OWNER}/${PUBLIC_REPO}/blob/main/jobs/${encodeURIComponent(r.file)}" target="_blank" rel="noopener">View on GitHub ↗</a></div>
      <div class="md">${renderMd(r.text)}</div>`);
  }

  function openDoc(path) {
    const p = state.priv;
    if (!p) return;
    const doc = [...p.prep, ...p.drills, ...p.tailored].find((d) => d.path === path)
      || (path === INTERVIEWS ? { path, text: p.interviews } : null);
    if (!doc) return;
    const job = state.jobs.find((j) => j.prep === doc || j.tailored === doc);
    openReader(`<h2 class="rt" id="reader-title">${esc(doc.title ? `${doc.title}${doc.company ? ' — ' + doc.company : ''}` : (doc.date ? 'Drill · ' + fmtDay(doc.date) : 'Interviews'))}</h2>
      <div class="actions">
        ${job ? `<button class="btn" data-job="${esc(job.id)}">See Craig's listing</button>` : ''}
        ${job && job.tailored && job.tailored !== doc ? `<button class="btn ghost" data-doc="${esc(job.tailored.path)}">Tailored resume</button>` : ''}
        <a class="btn ghost" href="https://github.com/${OWNER}/${PRIVATE_REPO}/blob/main/${esc(path)}" target="_blank" rel="noopener">View on GitHub ↗</a>
      </div>
      <div class="md">${renderMd(doc.text)}</div>`);
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-job],[data-report],[data-doc],[data-report-link]');
    if (!t) return;
    if (t.dataset.reportLink) { e.preventDefault(); openReport(t.dataset.reportLink); }
    else if (t.dataset.job) { const j = state.jobs.find((x) => x.id === t.dataset.job); if (j) openJob(j); }
    else if (t.dataset.report) openReport(t.dataset.report);
    else if (t.dataset.doc) openDoc(t.dataset.doc);
  });
  $('close').onclick = closeReader;
  $('backdrop').onclick = closeReader;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('reader').hidden) closeReader(); });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { prefs.cat = c.dataset.cat; savePrefs(); renderBoard(); }));
  $('q').addEventListener('input', (e) => { prefs.q = e.target.value; renderBoard(); });
  $('range').value = prefs.range;
  $('range').addEventListener('change', (e) => { prefs.range = e.target.value; savePrefs(); renderBoard(); });
  $('verified').checked = prefs.verified;
  $('verified').addEventListener('change', (e) => { prefs.verified = e.target.checked; savePrefs(); renderBoard(); });
  $('prepped').checked = prefs.prepped;
  $('prepped').addEventListener('change', (e) => { prefs.prepped = e.target.checked; savePrefs(); renderBoard(); });

  // ---------- boot ----------
  setView(prefs.view);
  renderAll();
  renderResidents();
  loadReports().then(() => { linkPrivate(); renderAll(); });
  if (token) loadPrivate();
})();
