(() => {
  'use strict';

  // ---------- config ----------
  const OWNER = 'blkctrs-sys';
  const PRIVATE_REPO = 'agent-town-private';
  const API = 'https://api.github.com/repos/';
  const BASE = 'brenden/';
  const DRAFTS = BASE + 'drafts/';
  const INBOX = BASE + 'inbox/';
  const SCHEDULE = BASE + 'schedule.md';
  const TEMPLATE = INBOX + 'TEMPLATE.md';
  // Shared with the Reading Room, so one unlock works on both pages.
  const TOKEN_KEY = 'agentTown.readingRoom.token';
  const PREFS_KEY = 'agentTown.studio.prefs';
  // Newsletter every other Wednesday from this date (see brenden/INSTRUCTIONS.md).
  const NEWSLETTER_START = '2026-10-14';

  // ---------- small helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(area, k) { try { return window[area].getItem(k); } catch { return null; } },
    set(area, k, v) { try { window[area].setItem(k, v); } catch { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* storage blocked */ } },
  };
  const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const ghUrl = (path) => `https://github.com/${OWNER}/${PRIVATE_REPO}/blob/main/${path.split('/').map(encodeURIComponent).join('/')}`;
  const GAP_RE = /`?\[\[\s*(?:ADD:\s*)?([^\]]+?)\s*\]\]`?/g;

  function renderMd(text) {
    // [[ADD: …]] gaps become highlighted marks so they're easy to spot.
    const withGaps = String(text || '').replace(GAP_RE, (m, x) => `<mark class="add">✍️ ${esc(x)}</mark>`);
    if (!window.marked || !window.DOMPurify) return `<pre>${esc(text)}</pre>`;
    const html = DOMPurify.sanitize(marked.parse(withGaps, { gfm: true, breaks: true }));
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

  function nextNewsletter() {
    const start = new Date(NEWSLETTER_START + 'T12:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(start);
    while (d < today) d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  }

  // ---------- state ----------
  let token = store.get('localStorage', TOKEN_KEY) || store.get('sessionStorage', TOKEN_KEY) || '';
  const state = { data: null, error: '', loading: false };
  const prefs = Object.assign({ view: 'week' },
    (() => { try { return JSON.parse(store.get('localStorage', PREFS_KEY) || '{}'); } catch { return {}; } })());
  const savePrefs = () => store.set('localStorage', PREFS_KEY, JSON.stringify(prefs));

  // ---------- GitHub access ----------
  async function gh(path, { raw = false } = {}) {
    const headers = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(API + path, { headers, cache: 'no-cache' });
    if (!res.ok) { const err = new Error('GitHub ' + res.status); err.status = res.status; throw err; }
    return raw ? res.text() : res.json();
  }
  const getFile = (p) => gh(`${OWNER}/${PRIVATE_REPO}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=main`, { raw: true });

  // ---------- parsing ----------
  function parseDoc(path, text) {
    const name = path.split('/').pop().replace(/\.md$/, '');
    const date = (name.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
    const kind = /-desk$/.test(name) ? 'desk' : /-package$/.test(name) ? 'package' : 'other';
    const h1 = (text.match(/^#\s+(.+)$/m) || [])[1] || name;
    const title = kind === 'package' ? h1.replace(/^Video package:\s*/i, '') : kind === 'desk' ? 'Content desk' : h1;
    const meta = kind === 'package' ? ((text.match(/^Format:\s*(.+)$/m) || [])[1] || '') : '';
    const gaps = [...new Set([...text.matchAll(GAP_RE)].map((m) => m[1].trim()))];
    return { path, name, date, kind, title, meta, text, gaps };
  }

  // Split a draft into "## sections", each with optional "### cards".
  function parseSections(text) {
    const body = String(text || '')
      .replace(/^\s*# .*\r?\n/, '')        // title (the page shows it)
      .replace(/^Format:.*\r?\n/m, '');    // package meta line (shown in the header)
    const parts = body.split(/^## /m);
    const intro = parts.shift().trim();
    const sections = parts.map((chunk) => {
      const nl = chunk.indexOf('\n');
      const title = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
      const rest = nl < 0 ? '' : chunk.slice(nl + 1);
      const subParts = rest.split(/^### /m);
      const lead = subParts.shift().trim();
      const cards = subParts.map((c) => {
        const n = c.indexOf('\n');
        return { title: (n < 0 ? c : c.slice(0, n)).trim(), body: (n < 0 ? '' : c.slice(n + 1)).trim() };
      });
      return { title, lead, cards };
    });
    return { intro, sections };
  }

  // Pull "Poll: a / b / c" and "Best day to post: …" out of a post so they can be shown on their own.
  function splitPost(body) {
    let poll = null, when = '';
    const lines = body.split(/\r?\n/).filter((line) => {
      const p = line.match(/^Poll:\s*(.+)$/i);
      if (p && p[1].includes(' / ')) { poll = p[1].split(' / ').map((s) => s.trim()); return false; }
      const w = line.match(/^Best day to post:\s*(.+)$/i);
      if (w) { when = w[1].trim(); return false; }
      return true;
    });
    return { text: lines.join('\n').trim(), poll, when };
  }

  // ---------- copy ----------
  const copyStore = [];
  function copyBtn(text, label = 'Copy') {
    copyStore.push(text);
    return `<button class="copy" data-copy="${copyStore.length - 1}" aria-label="${esc(label)}">${esc(label)}</button>`;
  }
  async function doCopy(btn) {
    const text = copyStore[+btn.dataset.copy] || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = 'Copied ✓'; btn.classList.add('done');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1400);
    const t = $('toast'); t.textContent = 'Copied to clipboard'; t.hidden = false;
    clearTimeout(doCopy.timer); doCopy.timer = setTimeout(() => { t.hidden = true; }, 1400);
  }

  // ---------- render: one draft as cards ----------
  function card(title, body, { star = false, solo = false } = {}) {
    const { text, poll, when } = splitPost(body);
    const copyText = poll ? `${text}\n\nPoll options:\n${poll.join('\n')}` : text;
    return `<div class="pcard${star ? ' star' : ''}">
      <div class="pcard-head">${solo ? '<span></span>' : `<h3>${esc(title)}</h3>`}${copyBtn(copyText, solo ? `Copy ${title}` : 'Copy')}</div>
      <div class="md">${renderMd(text)}</div>
      ${poll ? `<div class="poll-label">Poll options</div><ul class="poll">${poll.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      ${when ? `<div class="when">📅 ${esc(when)}</div>` : ''}
    </div>`;
  }

  function renderDraft(doc) {
    const { intro, sections } = parseSections(doc.text);
    let html = intro ? `<div class="md">${renderMd(intro)}</div>` : '';
    html += '<div class="sections">';
    for (const s of sections) {
      html += `<div class="sec"><h2>${esc(s.title)}</h2>`;
      if (s.cards.length) {
        if (s.lead) html += `<div class="md">${renderMd(s.lead)}</div>`;
        html += `<div class="sec-grid">${s.cards.map((c) => card(c.title, c.body, { star: c.title.includes('⭐') })).join('')}</div>`;
      } else {
        html += card(s.title, s.lead, { solo: true });
      }
      html += '</div>';
    }
    return html + '</div>';
  }

  // ---------- load private files ----------
  async function loadPrivate() {
    if (!token) return;
    state.loading = true; state.error = ''; renderAll();
    try {
      const tree = await gh(`${OWNER}/${PRIVATE_REPO}/git/trees/main?recursive=1`);
      const files = tree.tree.filter((t) => t.type === 'blob' && t.path.startsWith(BASE) && t.path.endsWith('.md')).map((t) => t.path);
      const drafts = files.filter((p) => p.startsWith(DRAFTS));
      const inbox = files.filter((p) => p.startsWith(INBOX) && !p.slice(INBOX.length).includes('/') && !/\/(README|TEMPLATE)\.md$/.test(p));
      const done = files.filter((p) => p.startsWith(INBOX + 'done/'));
      const wanted = [...drafts, ...inbox, SCHEDULE, TEMPLATE].filter((p, i, a) => files.includes(p) && a.indexOf(p) === i);
      const texts = await pool(wanted, 6, (p) => getFile(p).catch(() => ''));
      const text = (p) => texts[wanted.indexOf(p)] || '';
      const docs = drafts.map((p) => parseDoc(p, text(p))).sort((a, b) => b.name.localeCompare(a.name));
      state.data = {
        desks: docs.filter((d) => d.kind === 'desk'),
        packages: docs.filter((d) => d.kind !== 'desk'),
        inbox: inbox.map((p) => ({ path: p, name: p.split('/').pop(), text: text(p) })),
        done: done.map((p) => p.split('/').pop()),
        schedule: text(SCHEDULE),
        template: text(TEMPLATE),
      };
    } catch (e) {
      state.data = null;
      state.error = e.status === 401 ? "That token wasn't accepted. It may have expired or been mistyped."
        : e.status === 404 || e.status === 403 ? "The token works, but it can't read the private repo. Give it read access to agent-town-private's contents."
        : "Couldn't reach GitHub just now. Try again in a minute.";
    }
    state.loading = false;
    renderAll();
  }

  // ---------- render: resident ----------
  async function renderResident() {
    const [agents, s] = await Promise.all(['../agents.json', '../status/brenden.json']
      .map((u) => fetch(u, { cache: 'no-cache' }).then((r) => r.json()).catch(() => null)));
    if (!s) { $('residents').innerHTML = ''; return; }
    const a = (agents || []).find((x) => x.id === 'brenden') || {};
    const label = { done: 'done', working: 'working', error: 'needs a look', waiting: 'waiting' }[s.state] || s.state;
    const when = s.lastRun ? new Date(s.lastRun).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    $('residents').innerHTML = `<div><span class="dot" style="background:${esc(a.color || '#7b5cd6')}"></span><div>
      <h3>${esc(a.name || 'Brenden')} <span class="state ${esc(s.state)}">${esc(label)}</span></h3>
      <p>${esc(s.message || s.summary || '')}</p>
      ${when ? `<p>Last run ${esc(when)}</p>` : ''}</div></div>`;
  }

  // ---------- render: unlock ----------
  function renderUnlock() {
    const el = $('unlock');
    const d = state.data;
    if (d) {
      el.className = 'unlock ok';
      el.innerHTML = `<p>🔓 Unlocked: ${plural(d.desks.length, 'content desk')}, ${plural(d.packages.length, 'video package')}.</p>
        <span><button class="btn ghost" id="refresh">Refresh</button> <button class="btn ghost" id="lock">Lock</button></span>`;
      $('lock').onclick = () => { token = ''; store.del(TOKEN_KEY); state.data = null; renderAll(); };
      $('refresh').onclick = loadPrivate;
      return;
    }
    el.className = 'unlock';
    el.innerHTML = `<h2>Unlock Brenden's drafts</h2>
      <p>Brenden's drafts live in your private repo. Paste a read-only GitHub token to show them here.
      It's the same token as the Reading Room, so if you've unlocked that on this device you're already set.
      The token stays in this browser; nothing is saved to the site.</p>
      <form id="unlock-form">
        <input type="password" id="token" placeholder="github_pat_…" autocomplete="off" aria-label="GitHub token" ${state.loading ? 'disabled' : ''}>
        <label class="toggle"><input type="checkbox" id="remember" checked> Remember on this device</label>
        <button class="btn" type="submit" ${state.loading ? 'disabled' : ''}>${state.loading ? 'Unlocking…' : 'Unlock'}</button>
      </form>
      ${state.error ? `<p class="err">${esc(state.error)}</p>` : ''}
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
    const d = state.data;
    const latest = d && d.desks[0];
    const tile = (n, l, locked) => `<div class="${locked ? 'locked' : ''}"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`;
    const nl = nextNewsletter();
    $('stats').innerHTML = tile(d ? d.desks.length : '🔒', 'content desks', !d)
      + tile(d ? d.packages.length : '🔒', 'video packages', !d)
      + tile(d ? d.inbox.length : '🔒', 'notes waiting in the inbox', !d)
      + tile(latest ? latest.gaps.length : (d ? 0 : '🔒'), 'gaps to fill in the latest desk', !d)
      + tile(fmtDay(nl), 'next newsletter');
  }

  // ---------- render: needs your input ----------
  function renderNeeds() {
    const el = $('needs');
    const d = state.data;
    const latest = d && d.desks[0];
    if (!latest || !latest.gaps.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<h2>✍️ Brenden needs from you</h2>
      <p class="w">Gaps in the ${esc(fmtDay(latest.date))} desk. He marks anything he doesn't know instead of guessing.</p>
      <ul>${latest.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`;
  }

  // ---------- render: views ----------
  const lockedNote = (what) => `<p class="locked-note">🔒 Unlock the private repo above to see ${what}.</p>`;

  function renderWeek() {
    const el = $('view-week');
    const d = state.data;
    if (!d) { el.innerHTML = state.loading ? '<p class="empty">Loading…</p>' : lockedNote("this week's posts, Shorts ideas and newsletter"); return; }
    const latest = d.desks[0];
    if (!latest) { el.innerHTML = '<p class="empty">No content desk yet. Brenden writes one every Wednesday.</p>'; return; }
    const fresh = d.packages.filter((p) => p.date && p.date >= latest.date);
    el.innerHTML = `<div class="week-head"><h2>Content desk · ${esc(fmtDay(latest.date))}</h2>
        <span>${copyBtn(latest.text, 'Copy whole desk')} <a class="btn ghost" style="text-decoration:none" href="${esc(ghUrl(latest.path))}" target="_blank" rel="noopener">GitHub ↗</a></span></div>
      ${fresh.length ? `<div class="list" style="margin-bottom:14px">${fresh.map(pkgRow).join('')}</div>` : ''}
      ${renderDraft(latest)}`;
  }

  function pkgRow(p) {
    return `<button class="item pkg" data-doc="${esc(p.path)}">
      <div><div class="t">${esc(p.title)}</div><div class="w">${esc([p.date ? fmtDay(p.date) : '', p.meta].filter(Boolean).join(' · '))}</div></div>
      <div class="r">${p.gaps.length ? `<span class="gap">✍️ ${plural(p.gaps.length, 'gap')}</span>` : 'Ready'}</div></button>`;
  }

  function renderPackages() {
    const el = $('view-packages');
    const d = state.data;
    if (!d) { el.innerHTML = lockedNote('video packages'); return; }
    el.innerHTML = d.packages.length ? `<div class="list">${d.packages.map(pkgRow).join('')}</div>`
      : '<p class="empty">No video packages yet. Drop a note in the inbox and Brenden writes one.</p>';
  }

  function renderDesks() {
    const el = $('view-desks');
    const d = state.data;
    if (!d) { el.innerHTML = lockedNote('past content desks'); return; }
    el.innerHTML = d.desks.length ? `<div class="list">${d.desks.map((x) => {
      const hasNl = /^## Newsletter[\s\S]*?Subject line/m.test(x.text);
      const posts = (x.text.match(/^### Post /gm) || []).length;
      return `<button class="item pkg" data-doc="${esc(x.path)}">
        <div><div class="t">${esc(fmtDay(x.date))}</div><div class="w">${esc([plural(posts, 'post'), hasNl ? 'newsletter' : ''].filter(Boolean).join(' · '))}</div></div>
        <div class="r">${x.gaps.length ? `<span class="gap">✍️ ${plural(x.gaps.length, 'gap')}</span>` : 'Ready'}</div></button>`;
    }).join('')}</div>` : '<p class="empty">No content desks yet.</p>';
  }

  function renderInbox() {
    const el = $('view-inbox');
    const d = state.data;
    const newUrl = `https://github.com/${OWNER}/${PRIVATE_REPO}/new/main/${INBOX}?filename=${encodeURIComponent('my-video.md')}`
      + (d && d.template ? `&value=${encodeURIComponent(d.template)}` : '');
    const actions = `<div class="inbox-actions">
      <a class="btn" href="${esc(newUrl)}" target="_blank" rel="noopener">＋ New video note on GitHub</a>
      <a class="btn ghost" href="https://github.com/${OWNER}/${PRIVATE_REPO}/edit/main/${SCHEDULE}" target="_blank" rel="noopener">✏️ Edit the schedule</a></div>`;
    if (!d) { el.innerHTML = actions + lockedNote('notes waiting in the inbox and your content schedule'); return; }
    el.innerHTML = `${actions}
      <div class="mildred-grid">
        <div><h3>Waiting in the inbox</h3>${d.inbox.length ? `<div class="list">${d.inbox.map((n) =>
          `<div class="pcard"><div class="pcard-head"><h3>${esc(n.name)}</h3></div><div class="md">${renderMd(n.text)}</div></div>`).join('')}</div>`
          : '<p class="empty">Empty. Brenden has packaged every note so far.</p>'}
          ${d.done.length ? `<p class="w" style="color:var(--muted)">Already packaged: ${esc(d.done.join(', '))}</p>` : ''}</div>
        <div><h3>Content schedule</h3><div class="pcard"><div class="md">${renderMd(d.schedule.replace(/^\s*# .*\r?\n/, ''))}</div></div></div>
      </div>`;
  }

  function renderAll() {
    copyStore.length = 0;
    renderUnlock(); renderStats(); renderNeeds();
    renderWeek(); renderPackages(); renderDesks(); renderInbox();
  }

  function setView(v) {
    if (!['week', 'packages', 'desks', 'inbox'].includes(v)) v = 'week';
    prefs.view = v; savePrefs();
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    for (const k of ['week', 'packages', 'desks', 'inbox']) $('view-' + k).hidden = k !== v;
  }

  // ---------- reader ----------
  let lastFocus = null;
  function openDoc(path) {
    const d = state.data;
    const doc = d && [...d.desks, ...d.packages].find((x) => x.path === path);
    if (!doc) return;
    lastFocus = document.activeElement;
    const heading = doc.kind === 'desk' ? `Content desk · ${fmtDay(doc.date)}` : doc.title;
    $('reader-body').innerHTML = `<h2 class="rt" id="reader-title">${esc(heading)}</h2>
      <div class="w">${esc([doc.kind === 'package' && doc.date ? fmtDay(doc.date) : '', doc.meta].filter(Boolean).join(' · '))}</div>
      <div class="actions">${copyBtn(doc.text, 'Copy everything')}
        <a class="btn ghost" href="${esc(ghUrl(doc.path))}" target="_blank" rel="noopener">View on GitHub ↗</a></div>
      ${doc.gaps.length ? `<p class="w">✍️ ${plural(doc.gaps.length, 'gap')} for you to fill, highlighted below.</p>` : ''}
      ${renderDraft(doc)}`;
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

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { doCopy(c); return; }
    const t = e.target.closest('[data-doc]');
    if (t) openDoc(t.dataset.doc);
  });
  $('close').onclick = closeReader;
  $('backdrop').onclick = closeReader;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('reader').hidden) closeReader(); });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // ---------- boot ----------
  setView(prefs.view);
  renderAll();
  renderResident();
  if (token) loadPrivate();
})();
