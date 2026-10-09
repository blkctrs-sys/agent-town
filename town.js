// Agent Town — a cozy pixel village where each agent lives in a house.
// Agents are listed in agents.json; each writes its own status JSON file.
(() => {
  'use strict';

  const W = 384, H = 216;
  const REPO_URL = 'https://github.com/blkctrs-sys/agent-town/blob/main/';
  const REFRESH_MS = 2 * 60 * 1000;

  const canvas = document.getElementById('town');
  const ctx = canvas.getContext('2d');
  const labelsEl = document.getElementById('labels');

  // ---------- drawing helpers ----------

  function mulberry(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rect(c, x, y, w, h, col) {
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), w, h);
  }

  function ellipse(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
      const dx = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)) + 0.3);
      c.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
    }
  }

  const disc = (c, cx, cy, r, col) => ellipse(c, cx, cy, r, r, col);

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  // Draws a pixel pattern: rows of '#' (filled) and '.' (empty).
  function glyph(c, x, y, rows, col) {
    c.fillStyle = col;
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') c.fillRect(x + i, y + j, 1, 1);
    });
  }

  // ---------- seasons & time of day ----------

  const SEASONS = {
    spring: { grass: '#8ccf6a', grass2: '#7fc260', tuft: '#69ad4e', crown: ['#4f9f4c', '#6cbb5e', '#f3a9c4'],
      flowers: ['#f7d14c', '#f29bc0', '#ffffff', '#b9a2f0'] },
    summer: { grass: '#79bd56', grass2: '#6fb24d', tuft: '#5c9e40', crown: ['#3f9346', '#55ad52', '#78c867'],
      flowers: ['#f7d14c', '#ef6f6c', '#ffffff', '#7fb6f0'] },
    autumn: { grass: '#a5b45c', grass2: '#99a853', tuft: '#86954a', crown: ['#b8452a', '#dc7a30', '#efb348'],
      flowers: ['#e08a33', '#c8552c', '#f2d06b', '#9c5a3c'] },
    winter: { grass: '#e9eff3', grass2: '#dfe7ed', tuft: '#c9d6df', crown: ['#2f6b4f', '#3c7d5c', '#f4f8fb'],
      flowers: ['#ffffff', '#dde6ec', '#c94a4a', '#ffffff'] },
  };

  function seasonOf(d) {
    const m = d.getMonth();
    if (m === 11 || m < 2) return 'winter';
    if (m < 5) return 'spring';
    if (m < 8) return 'summer';
    return 'autumn';
  }

  // Sky tint keyframes by hour: [hour, [r, g, b, alpha]]
  const SKY = [
    [0, [18, 22, 58, 0.55]], [5, [18, 22, 58, 0.55]], [6.5, [255, 150, 120, 0.18]],
    [8, [255, 220, 180, 0]], [17, [255, 220, 180, 0]], [18.5, [255, 140, 70, 0.16]],
    [20, [60, 40, 90, 0.38]], [21.5, [18, 22, 58, 0.55]], [24, [18, 22, 58, 0.55]],
  ];

  function skyAt(h) {
    for (let i = 0; i < SKY.length - 1; i++) {
      const [h0, a] = SKY[i], [h1, b] = SKY[i + 1];
      if (h >= h0 && h <= h1) {
        const t = (h - h0) / (h1 - h0);
        return a.map((v, k) => v + (b[k] - v) * t);
      }
    }
    return SKY[0][1];
  }

  // Preview a time of day with ?hour=21 in the URL.
  const HOUR_OVERRIDE = parseFloat(new URLSearchParams(location.search).get('hour'));
  function clockNow() {
    const d = new Date();
    if (!isNaN(HOUR_OVERRIDE)) d.setHours(Math.floor(HOUR_OVERRIDE), (HOUR_OVERRIDE % 1) * 60);
    return d;
  }

  // ---------- town layout ----------

  const PATH_Y = 108, PATH_H = 12;
  const COLS = [16, 148, 280], ROWS = [34, 124];
  const PLOTS = [];
  for (const y of ROWS) for (const x of COLS) PLOTS.push({ x, y, top: y === ROWS[0] });

  const door = (P) => ({ x: P.x + 26, y: P.y + 50 });
  const boardSpot = (P) => ({ x: P.x + 71, y: P.y + 50 });

  const trees = [];
  {
    const R = mulberry(42);
    for (let x = -6; x < W + 10; x += 15 + R() * 9) trees.push({ x: x | 0, y: (22 + R() * 8) | 0, r: (8 + R() * 4) | 0, ph: R() * 6 });
    for (let x = -6; x < W + 10; x += 16 + R() * 9) trees.push({ x: x | 0, y: (224 + R() * 6) | 0, r: (8 + R() * 4) | 0, ph: R() * 6 });
    trees.push({ x: 124, y: 74, r: 13, ph: 1.3 }, { x: 262, y: 66, r: 10, ph: 2.1 }, { x: 250, y: 96, r: 7, ph: 4 });
  }

  const LAMPS = [{ x: 126, y: 106 }, { x: 258, y: 106 }, { x: 8, y: 132 }, { x: 376, y: 132 }];
  const POND = { x: 124, y: 162, rx: 17, ry: 10 };
  const WELL = { x: 258, y: 160 };
  const BENCH = { x: 104, y: 186 };

  // ---------- state ----------

  let agents = [];           // [{...config, status, mode, news, v}]
  let season = seasonOf(new Date());
  let bg = null;
  let bgKey = '';
  const particles = [];
  const fireflies = Array.from({ length: 16 }, (_, i) => ({ x: Math.random() * W, y: 40 + Math.random() * 160, ph: i }));
  const butterflies = Array.from({ length: 3 }, (_, i) => ({ x: 60 + i * 120, y: 90 + i * 30, ph: i * 2 }));
  const labels = new Map();

  // ---------- background (static, rebuilt when season or plots change) ----------

  function buildBackground() {
    const S = SEASONS[season];
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = mulberry(7);
    const blocked = [];
    const block = (x, y, w, h) => blocked.push([x, y, w, h]);
    const stone = (x, y) => { rect(g, x, y, 4, 2, '#c9c1b1'); rect(g, x, y, 3, 1, '#ddd6c6'); rect(g, x, y + 2, 4, 1, 'rgba(0,0,0,0.12)'); };
    const isBlocked = (x, y) => blocked.some(([bx, by, bw, bh]) => x >= bx - 2 && x <= bx + bw + 2 && y >= by - 2 && y <= by + bh + 2);

    rect(g, 0, 0, W, H, S.grass);
    for (let i = 0; i < 900; i++) rect(g, R() * W, R() * H, 2, 1, S.grass2);

    // main path
    const dirt = '#d9bb8a', dirtEdge = '#c49f6c';
    rect(g, 0, PATH_Y, W, PATH_H, dirt);
    rect(g, 0, PATH_Y, W, 1, dirtEdge);
    rect(g, 0, PATH_Y + PATH_H - 1, W, 1, dirtEdge);
    for (let i = 0; i < 70; i++) rect(g, R() * W, PATH_Y + 2 + R() * (PATH_H - 4), 1, 1, '#c6a675');
    block(0, PATH_Y, W, PATH_H);

    const occupied = new Set(agents.map((a) => a.plot));
    PLOTS.forEach((P, i) => {
      block(P.x + 3, P.y + 4, 46, 44);       // house
      block(P.x + 58, P.y + 26, 26, 22);     // board / sign
      if (P.top) {
        rect(g, P.x + 23, P.y + 46, 7, PATH_Y - P.y - 46, dirt);
        rect(g, P.x + 23, P.y + 46, 1, PATH_Y - P.y - 46, dirtEdge);
        rect(g, P.x + 29, P.y + 46, 1, PATH_Y - P.y - 46, dirtEdge);
        block(P.x + 23, P.y + 46, 7, PATH_Y - P.y - 46);
      } else {
        for (let y = PATH_Y + PATH_H + 3; y < P.y + 50; y += 6) { stone(P.x + 51, y); block(P.x + 50, y - 1, 4, 3); }
        for (let x = P.x + 52; x >= P.x + 26; x -= 6) { stone(x - 1, P.y + 50); block(x - 2, P.y + 50, 4, 3); }
      }
      if (!occupied.has(i)) {
        // empty plot: a little tilled garden waiting for a new neighbor
        rect(g, P.x + 12, P.y + 22, 30, 18, '#9a7048');
        for (let r = 0; r < 3; r++) {
          rect(g, P.x + 12, P.y + 24 + r * 6, 30, 1, '#7f5a37');
          if (season !== 'winter') for (let k = 0; k < 5; k++) glyph(g, P.x + 15 + k * 6, P.y + 21 + r * 6, ['#.#', '.#.'], '#5fa84a');
        }
      }
    });

    // pond
    ellipse(g, POND.x, POND.y, POND.rx + 2, POND.ry + 2, '#9c9686');
    ellipse(g, POND.x, POND.y, POND.rx, POND.ry, season === 'winter' ? '#cfe6f0' : '#5fa8c9');
    ellipse(g, POND.x + 2, POND.y + 2, POND.rx - 6, POND.ry - 4, season === 'winter' ? '#bcdbe8' : '#4f95b8');
    if (season !== 'winter') {
      ellipse(g, POND.x - 8, POND.y - 2, 3, 2, '#4f9f4c');
      ellipse(g, POND.x + 7, POND.y + 4, 2, 1, '#4f9f4c');
      rect(g, POND.x - 8, POND.y - 3, 1, 1, '#f29bc0');
    }
    block(POND.x - POND.rx - 2, POND.y - POND.ry - 2, POND.rx * 2 + 4, POND.ry * 2 + 4);
    block(WELL.x - 9, WELL.y - 18, 18, 22);
    block(BENCH.x - 1, BENCH.y - 6, 16, 8);

    // fence along the bottom
    for (let x = 2; x < W; x += 7) rect(g, x, 196, 2, 7, '#a07a50');
    rect(g, 0, 198, W, 1, '#b88d5f');
    rect(g, 0, 201, W, 1, '#b88d5f');

    // grass tufts & flowers
    for (let i = 0; i < 160; i++) {
      const x = (R() * W) | 0, y = (30 + R() * 165) | 0;
      if (!isBlocked(x, y)) glyph(g, x, y, ['#.#', '.#.'], S.tuft);
    }
    for (let i = 0; i < 90; i++) {
      const x = (R() * W) | 0, y = (34 + R() * 160) | 0;
      if (isBlocked(x, y)) continue;
      const col = S.flowers[(R() * S.flowers.length) | 0];
      glyph(g, x, y, ['.#.', '#.#', '.#.'], col);
      rect(g, x + 1, y + 1, 1, 1, '#f7e7a0');
    }
    return c;
  }

  // ---------- sprites ----------

  function drawTree(tr, t, S) {
    const sw = Math.round(Math.sin(t * 0.7 + tr.ph) * 0.7);
    const [dark, mid, light] = S.crown;
    ellipse(ctx, tr.x, tr.y, Math.max(3, (tr.r * 0.8) | 0), 2, 'rgba(0,0,0,0.18)');
    rect(ctx, tr.x - 1, tr.y - 7, 3, 7, '#7a5232');
    rect(ctx, tr.x - 1, tr.y - 7, 1, 7, '#5f3f26');
    const cy = tr.y - 6 - tr.r;
    disc(ctx, tr.x + sw, cy, tr.r, dark);
    disc(ctx, tr.x + sw - 1, cy - 2, tr.r - 2, mid);
    disc(ctx, tr.x + sw - 3, cy - 4, Math.max(2, tr.r - 6), light);
  }

  function drawHouse(P, a, lit) {
    const x = P.x + 6, y = P.y;
    const roof = a.color;
    ellipse(ctx, x + 21, y + 47, 23, 2, 'rgba(0,0,0,0.15)');
    // chimney (behind roof)
    rect(ctx, x + 28, y + 5, 6, 9, '#9a5a42');
    rect(ctx, x + 27, y + 4, 8, 2, '#7b4533');
    // walls
    rect(ctx, x, y + 24, 40, 22, '#f1e2c4');
    rect(ctx, x, y + 24, 40, 1, '#d9c39c');
    rect(ctx, x, y + 45, 40, 1, '#c9ad82');
    rect(ctx, x, y + 24, 2, 22, '#b98a5a');
    rect(ctx, x + 38, y + 24, 2, 22, '#b98a5a');
    // roof
    for (let i = 0; i < 17; i++) {
      const inset = Math.round((16 - i) * 0.55);
      const col = i === 16 ? shade(roof, -45) : i % 4 === 3 ? shade(roof, -22) : roof;
      rect(ctx, x - 3 + inset, y + 8 + i, 46 - inset * 2, 1, col);
    }
    rect(ctx, x + 6, y + 8, 28, 1, shade(roof, 25));
    if (season === 'winter') for (let i = 0; i < 4; i++) {
      const inset = Math.round((16 - i) * 0.55);
      rect(ctx, x - 3 + inset, y + 8 + i, 46 - inset * 2, 1, i === 3 ? '#dfe8ee' : '#f7fbfd');
    }
    // windows with flower boxes
    for (const wx of [x + 5, x + 28]) {
      rect(ctx, wx, y + 29, 7, 7, '#8a5a36');
      rect(ctx, wx + 1, y + 30, 5, 5, lit ? '#ffd56b' : '#a9d8ea');
      if (!lit) rect(ctx, wx + 1, y + 30, 2, 1, '#e4f4fa');
      rect(ctx, wx + 3, y + 30, 1, 5, '#8a5a36');
      rect(ctx, wx + 1, y + 32, 5, 1, '#8a5a36');
      rect(ctx, wx - 1, y + 37, 9, 2, '#7a4b2a');
      if (season !== 'winter') for (let k = 0; k < 4; k++) rect(ctx, wx + k * 2, y + 36, 1, 1, SEASONS[season].flowers[k]);
    }
    // door
    rect(ctx, x + 16, y + 34, 8, 12, '#7a4b2a');
    rect(ctx, x + 17, y + 35, 6, 11, '#8f5b34');
    rect(ctx, x + 21, y + 40, 1, 1, '#f2c94c');
    rect(ctx, x + 15, y + 46, 10, 1, '#b8a58a');
  }

  function drawBoard(P, count) {
    const bx = P.x + 60, by = P.y + 28;
    rect(ctx, bx + 2, by + 4, 2, 16, '#6b4428');
    rect(ctx, bx + 18, by + 4, 2, 16, '#6b4428');
    rect(ctx, bx - 1, by - 2, 24, 2, '#6b4428');
    rect(ctx, bx, by, 22, 13, '#9a6a3e');
    rect(ctx, bx + 1, by + 1, 20, 11, '#b8875a');
    for (let i = 0; i < Math.min(count, 10); i++) {
      const px = bx + 2 + (i % 5) * 4, py = by + 2 + Math.floor(i / 5) * 5;
      rect(ctx, px, py, 3, 4, '#fbf3e0');
      rect(ctx, px + 1, py, 1, 1, i % 3 ? '#c94a4a' : '#3f7f86');
    }
  }

  function drawForRentSign(P) {
    const sx = P.x + 64, sy = P.y + 34;
    rect(ctx, sx + 5, sy + 4, 2, 10, '#6b4428');
    rect(ctx, sx, sy, 12, 7, '#b8875a');
    rect(ctx, sx, sy + 6, 12, 1, '#9a6a3e');
    glyph(ctx, sx + 2, sy + 2, ['#.#.###', '###..#.', '#.#.###'], '#5f3f26'); // "HI"
  }

  function drawLamp(L, lit) {
    rect(ctx, L.x, L.y - 14, 1, 14, '#4a3b33');
    rect(ctx, L.x - 1, L.y - 1, 3, 1, '#4a3b33');
    rect(ctx, L.x - 2, L.y - 18, 5, 1, '#4a3b33');
    rect(ctx, L.x - 1, L.y - 17, 3, 3, lit ? '#ffe08a' : '#ddd5bd');
  }

  function drawWell() {
    const { x, y } = WELL;
    ellipse(ctx, x, y, 8, 2, 'rgba(0,0,0,0.15)');
    rect(ctx, x - 7, y - 6, 14, 6, '#9c9686');
    rect(ctx, x - 7, y - 6, 14, 1, '#b6b0a0');
    for (let k = 0; k < 3; k++) rect(ctx, x - 5 + k * 5, y - 4, 3, 1, '#857f70');
    rect(ctx, x - 6, y - 17, 1, 11, '#6b4428');
    rect(ctx, x + 5, y - 17, 1, 11, '#6b4428');
    rect(ctx, x - 9, y - 19, 18, 2, '#b8452a');
    rect(ctx, x - 7, y - 21, 14, 2, '#c8552c');
    rect(ctx, x - 1, y - 14, 2, 3, '#7a5232');
  }

  function drawBench() {
    const { x, y } = BENCH;
    rect(ctx, x, y - 5, 14, 2, '#9a6a3e');
    rect(ctx, x, y - 2, 14, 2, '#b8875a');
    rect(ctx, x + 1, y, 1, 2, '#6b4428');
    rect(ctx, x + 12, y, 1, 2, '#6b4428');
  }

  function drawVillager(a, t) {
    const v = a.v;
    const x = Math.round(v.x), f = v.moving ? Math.floor(t * 8 + v.ph) % 2 : 0;
    const y = Math.round(v.y) + (v.moving && f ? -1 : 0);
    const skin = '#f3cfa6', ink = '#3b2f25';
    ellipse(ctx, Math.round(v.x), Math.round(v.y), 3, 1, 'rgba(0,0,0,0.2)');
    // legs
    rect(ctx, x - 2, y - 2, 1, v.moving && f ? 1 : 2, '#4a3b33');
    rect(ctx, x + 1, y - 2, 1, v.moving && !f ? 1 : 2, '#4a3b33');
    // body & arms
    rect(ctx, x - 3, y - 7, 6, 5, a.color);
    rect(ctx, x - 3, y - 3, 6, 1, shade(a.color, -30));
    rect(ctx, x - 4, y - 6, 1, 3, shade(a.color, -15));
    rect(ctx, x + 3, y - 6, 1, 3, shade(a.color, -15));
    // satchel strap & bag
    rect(ctx, v.dir > 0 ? x - 2 : x + 1, y - 7, 1, 4, '#7a4b2a');
    rect(ctx, v.dir > 0 ? x - 4 : x + 3, y - 4, 2, 2, '#8f5b34');
    // head
    rect(ctx, x - 3, y - 12, 6, 5, skin);
    if (v.moving) rect(ctx, v.dir > 0 ? x + 1 : x - 2, y - 10, 1, 1, ink);
    else { rect(ctx, x - 2, y - 10, 1, 1, ink); rect(ctx, x + 1, y - 10, 1, 1, ink); }
    rect(ctx, v.dir > 0 ? x + 2 : x - 3, y - 9, 1, 1, '#eaa48e');
    // hat
    rect(ctx, x - 4, y - 12, 8, 1, a.hat);
    rect(ctx, x - 3, y - 14, 6, 2, a.hat);
    rect(ctx, x - 3, y - 13, 6, 1, shade(a.hat, -30));
  }

  function drawBubble(x, y, kind, t) {
    const by = Math.round(y - 25 + Math.sin(t * 3) * 1);
    const bx = Math.round(x - 5);
    rect(ctx, bx, by, 11, 8, '#3b2f25');
    rect(ctx, bx + 1, by + 1, 9, 6, '#fffaf0');
    rect(ctx, bx + 4, by + 8, 2, 1, '#3b2f25');
    rect(ctx, bx + 5, by + 9, 1, 1, '#3b2f25');
    if (kind === '!') glyph(ctx, bx + 5, by + 1, ['#', '#', '#', '.', '#'], '#e0662a');
    if (kind === '?') glyph(ctx, bx + 4, by + 1, ['##.', '..#', '.#.', '...', '.#.'], '#b5482f');
    if (kind === '...') for (let k = 0; k < 3; k++) if (Math.floor(t * 3) % 4 > k) rect(ctx, bx + 2 + k * 3, by + 4, 1, 1, '#3b2f25');
  }

  function drawZs(P, t) {
    const x = P.x + 40, y = P.y + 6;
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.35 + k / 3) % 1;
      const zx = Math.round(x + p * 10 + Math.sin(p * 6) * 2), zy = Math.round(y - p * 16);
      ctx.globalAlpha = Math.sin(p * Math.PI);
      glyph(ctx, zx, zy, p > 0.5 ? ['####', '..#.', '.#..', '####'] : ['###', '.#.', '###'], '#f7fbfd');
    }
    ctx.globalAlpha = 1;
  }

  // ---------- villager behaviour ----------

  function modeOf(a, now) {
    const s = a.status || {};
    const hour = now.getHours() + now.getMinutes() / 60;
    const updated = Date.parse(s.updated || s.lastRun || '') || 0;
    const ageH = (now - updated) / 3600000;
    if (s.state === 'working') return ageH > 2 ? 'stuck' : 'working';
    if (s.state === 'error') return 'error';
    if (hour >= 22 || hour < 6) return 'sleeping';
    if (s.state === 'done' && ageH > 72) return 'resting';
    return s.state === 'done' ? 'home' : 'waiting';
  }

  function hasNews(a) {
    const s = a.status || {};
    if (s.state !== 'done' || !s.lastRun) return false;
    if (Date.now() - Date.parse(s.lastRun) > 24 * 3600000) return false;
    try { return localStorage.getItem('seen:' + a.id) !== s.lastRun; } catch { return true; }
  }

  function updateVillager(a, dt) {
    const v = a.v, P = PLOTS[a.plot], d0 = door(P), b0 = boardSpot(P);
    if (a.mode === 'sleeping' || a.mode === 'resting') {
      v.hidden = true; v.x = d0.x; v.y = d0.y; v.tx = d0.x; v.ty = d0.y; v.moving = false;
      return;
    }
    if (v.hidden) { v.hidden = false; v.pause = 0.6; }
    if (v.pause > 0) { v.pause -= dt; v.moving = false; return; }
    const dx = v.tx - v.x, dy = v.ty - v.y, dist = Math.hypot(dx, dy);
    if (dist < 0.6) {
      v.moving = false;
      if (a.mode === 'working') {
        const atBoard = Math.abs(v.x - b0.x) < 3;
        v.tx = atBoard ? d0.x : b0.x; v.ty = d0.y;
        v.pause = atBoard ? 1.2 : 2.5 + Math.random() * 2;
      } else if (a.mode === 'error' || a.mode === 'stuck') {
        v.tx = b0.x - 4; v.ty = b0.y; v.pause = 1;
      } else {
        v.tx = P.x + 10 + Math.random() * 68; v.ty = P.y + 53 + Math.random() * 11;
        v.pause = 1.5 + Math.random() * 3.5;
      }
      return;
    }
    const step = Math.min(dist, (a.mode === 'working' ? 16 : 9) * dt);
    v.x += (dx / dist) * step; v.y += (dy / dist) * step;
    if (Math.abs(dx) > 0.2) v.dir = dx > 0 ? 1 : -1;
    v.moving = true;
  }

  function bubbleFor(a) {
    const v = a.v, b0 = boardSpot(PLOTS[a.plot]);
    if (a.mode === 'error' || a.mode === 'stuck') return '?';
    if (a.mode === 'working' && !v.moving && Math.abs(v.x - b0.x) < 3) return '...';
    if (a.news) return '!';
    return null;
  }

  // ---------- particles ----------

  let smokeTimer = 0, weatherTimer = 0;

  function updateParticles(dt, t, dark) {
    smokeTimer -= dt; weatherTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = 0.45;
      for (const a of agents) {
        const P = PLOTS[a.plot];
        particles.push({ kind: 'smoke', x: P.x + 37 + Math.random() * 2, y: P.y + 3, vx: 2 + Math.random(), vy: -6, life: 0, max: 3.2 });
      }
    }
    if (weatherTimer <= 0 && (season === 'autumn' || season === 'winter')) {
      weatherTimer = season === 'winter' ? 0.08 : 0.5;
      const S = SEASONS[season];
      particles.push(season === 'winter'
        ? { kind: 'snow', x: Math.random() * W, y: -2, vx: 0, vy: 10 + Math.random() * 8, life: 0, max: 30, ph: Math.random() * 6 }
        : { kind: 'leaf', x: Math.random() * W, y: 10 + Math.random() * 20, vx: 3, vy: 7 + Math.random() * 4, life: 0, max: 30, ph: Math.random() * 6,
            col: S.crown[(Math.random() * 3) | 0] });
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      p.x += (p.vx + (p.kind !== 'smoke' ? Math.sin(t * 2 + p.ph) * 6 : 0)) * dt;
      p.y += p.vy * dt;
      if (p.life > p.max || p.y > H + 4 || p.x > W + 4) particles.splice(i, 1);
    }
    for (const ff of fireflies) { ff.x += Math.sin(t * 0.7 + ff.ph) * 6 * dt; ff.y += Math.cos(t * 0.9 + ff.ph * 2) * 5 * dt; }
    for (const bf of butterflies) { bf.x += (Math.sin(t * 0.4 + bf.ph) * 10) * dt; bf.y += Math.cos(t * 1.3 + bf.ph) * 8 * dt; }
  }

  function drawParticles(t) {
    for (const p of particles) {
      if (p.kind === 'smoke') {
        const k = p.life / p.max, s = 1 + Math.round(k * 2);
        ctx.globalAlpha = 0.6 * (1 - k);
        rect(ctx, p.x, p.y, s, s, '#f2efe8');
      } else if (p.kind === 'snow') {
        ctx.globalAlpha = 0.9;
        rect(ctx, p.x, p.y, 1, 1, '#ffffff');
      } else {
        ctx.globalAlpha = 0.95;
        rect(ctx, p.x, p.y, Math.sin(t * 4 + p.ph) > 0 ? 2 : 1, 1, p.col);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- main loop ----------

  function render(t, now) {
    const S = SEASONS[season];
    const hour = now.getHours() + now.getMinutes() / 60;
    const sky = skyAt(hour);
    const dark = sky[3] / 0.55;
    const lampsOn = dark > 0.3;

    const key = season + '|' + agents.map((a) => a.plot).join(',');
    if (key !== bgKey) { bg = buildBackground(); bgKey = key; }
    ctx.drawImage(bg, 0, 0);

    // pond sparkle
    if (season !== 'winter' && Math.sin(t * 2.3) > 0.7) rect(ctx, POND.x + Math.round(Math.sin(t) * 8), POND.y - 3, 2, 1, '#e6f6fb');

    // depth-sorted scene
    const items = [];
    for (const tr of trees) items.push([tr.y, () => drawTree(tr, t, S)]);
    for (const L of LAMPS) items.push([L.y, () => drawLamp(L, lampsOn)]);
    items.push([WELL.y, drawWell], [BENCH.y, drawBench]);
    const occupied = new Map(agents.map((a) => [a.plot, a]));
    PLOTS.forEach((P, i) => {
      const a = occupied.get(i);
      if (!a) { items.push([P.y + 48, () => drawForRentSign(P)]); return; }
      const lit = (lampsOn && a.mode !== 'sleeping') || (dark > 0.6 && a.mode === 'resting') || (a.mode === 'working' && dark > 0.1);
      items.push([P.y + 46, () => drawHouse(P, a, lit)]);
      items.push([P.y + 48, () => drawBoard(P, (a.status && a.status.items || []).length)]);
      if (!a.v.hidden) items.push([a.v.y, () => drawVillager(a, t)]);
    });
    items.sort((p, q) => p[0] - q[0]);
    for (const [, draw] of items) draw();

    drawParticles(t);

    // butterflies on warm days
    if (dark < 0.2 && (season === 'spring' || season === 'summer')) {
      for (const bf of butterflies) {
        const open = Math.sin(t * 14 + bf.ph) > 0;
        glyph(ctx, Math.round(bf.x), Math.round(bf.y), open ? ['#.#'] : ['.#.'], '#fff3a8');
      }
    }

    // time-of-day tint
    if (sky[3] > 0.005) {
      ctx.fillStyle = `rgba(${sky[0] | 0},${sky[1] | 0},${sky[2] | 0},${sky[3].toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // warm glows after dark
    if (lampsOn) {
      ctx.globalCompositeOperation = 'lighter';
      const glow = (x, y, r, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,190,100,${a})`);
        g.addColorStop(1, 'rgba(255,190,100,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      };
      for (const L of LAMPS) glow(L.x, L.y - 15, 16, 0.35 * dark);
      for (const a of agents) {
        if (a.mode === 'sleeping' && hour < 5) continue;
        const P = PLOTS[a.plot];
        glow(P.x + 15, P.y + 33, 9, 0.3 * dark);
        glow(P.x + 38, P.y + 33, 9, 0.3 * dark);
      }
      for (const ff of fireflies) {
        const blink = Math.max(0, Math.sin(t * 2 + ff.ph * 1.7));
        if (blink > 0.1) glow(ff.x, ff.y, 3, 0.7 * blink * dark);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // speech bubbles & Zs stay readable above the tint
    for (const a of agents) {
      if (a.mode === 'sleeping' || a.mode === 'resting') { drawZs(PLOTS[a.plot], t); continue; }
      const b = bubbleFor(a);
      if (b) drawBubble(a.v.x, a.v.y, b, t);
    }
  }

  function updateLabels() {
    for (const a of agents) {
      let el = labels.get(a.id);
      if (!el) { el = document.createElement('div'); el.className = 'label'; labelsEl.appendChild(el); labels.set(a.id, el); }
      el.textContent = a.name;
      const P = PLOTS[a.plot];
      const x = a.v.hidden ? P.x + 26 : a.v.x;
      const y = a.v.hidden ? P.y + 6 : a.v.y - (bubbleFor(a) ? 27 : 16);
      el.style.left = (x / W) * 100 + '%';
      el.style.top = (y / H) * 100 + '%';
    }
    PLOTS.forEach((P, i) => {
      const id = 'plot' + i;
      let el = labels.get(id);
      const taken = agents.some((a) => a.plot === i);
      if (taken) { if (el) el.hidden = true; return; }
      if (!el) { el = document.createElement('div'); el.className = 'label faint'; el.textContent = 'Open plot'; labelsEl.appendChild(el); labels.set(id, el); }
      el.hidden = false;
      el.style.left = ((P.x + 27) / W) * 100 + '%';
      el.style.top = ((P.y + 20) / H) * 100 + '%';
    });
  }

  let last = performance.now();
  function frame(ms) {
    const dt = Math.min(0.05, (ms - last) / 1000);
    last = ms;
    const t = ms / 1000, now = clockNow();
    season = seasonOf(now);
    for (const a of agents) { a.mode = modeOf(a, now); updateVillager(a, dt); }
    updateParticles(dt, t);
    render(t, now);
    updateLabels();
    requestAnimationFrame(frame);
  }

  // ---------- data ----------

  async function getJSON(path) {
    const res = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status + ' ' + path);
    return res.json();
  }

  async function load() {
    let list;
    try { list = await getJSON('agents.json'); } catch (e) { console.warn(e); return; }
    const next = [];
    for (const cfg of list) {
      const prev = agents.find((a) => a.id === cfg.id);
      let status;
      try { status = await getJSON(cfg.status); } catch { status = prev ? prev.status : { state: 'waiting', summary: 'No status yet.' }; }
      const P = PLOTS[cfg.plot] || PLOTS[0];
      const v = prev ? prev.v : { x: door(P).x, y: door(P).y, tx: door(P).x, ty: door(P).y, dir: 1, pause: 1, moving: false, hidden: false, ph: Math.random() * 2 };
      next.push({ ...cfg, status, v, mode: 'waiting', news: false });
    }
    agents = next;
    for (const a of agents) a.news = hasNews(a);
    renderRoster();
    if (openId) openPanel(openId, true);
  }

  // ---------- roster & panel ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ago(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!iso || isNaN(ms)) return 'never';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function statusLine(a) {
    const s = a.status || {};
    switch (modeOf(a, new Date())) {
      case 'working': return ['working', 'Out on a shift right now…'];
      case 'stuck': return ['error', 'Seems stuck. Last update ' + ago(s.updated)];
      case 'error': return ['error', 'Ran into a problem'];
      case 'sleeping': return ['', 'Asleep for the night'];
      case 'resting': return ['', 'Resting. Last shift ' + ago(s.lastRun)];
      case 'home': return ['done', 'Home. Last shift ' + ago(s.lastRun)];
      default: return ['', "Hasn't worked a shift yet"];
    }
  }

  function renderRoster() {
    const el = document.getElementById('roster');
    el.innerHTML = agents.map((a) => {
      const [, text] = statusLine(a);
      return `<button class="card" data-id="${esc(a.id)}">
        <span class="swatch" style="background:${esc(a.color)}"></span>
        <span><strong>${esc(a.name)} · ${esc(a.title)}${a.news ? '<span class="chip">New</span>' : ''}</strong>
        <span class="sub">${esc(text)}</span><br><span class="sub">${esc((a.status || {}).summary || '')}</span></span>
      </button>`;
    }).join('');
    el.querySelectorAll('.card').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.id)));
    const free = PLOTS.length - agents.length;
    document.getElementById('plots').textContent = free > 0
      ? `${free} open plot${free === 1 ? '' : 's'}, waiting for new neighbors.`
      : 'Every plot in town is taken.';
  }

  const CATEGORY_NAMES = { art: 'Game & 3D art', ops: 'Operations & inventory' };
  let openId = null, lastFocus = null;

  function openPanel(id, refresh) {
    const a = agents.find((x) => x.id === id);
    if (!a) return;
    const s = a.status || {};
    const [cls, text] = statusLine(a);
    const groups = {};
    for (const it of s.items || []) (groups[it.category] = groups[it.category] || []).push(it);
    const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

    let html = `<h3 id="panel-title">${esc(a.name)}</h3>
      <p class="role">${esc(a.title)}</p>
      <span class="state ${cls}">${esc(text)}</span>
      <p class="summary">${esc(s.summary || '')}</p>`;
    if (s.message) html += `<p class="meta">Note: ${esc(s.message)}</p>`;
    if (s.lastRun) html += `<p class="meta">Last finished: ${esc(new Date(s.lastRun).toLocaleString())}</p>`;
    for (const [cat, list] of Object.entries(groups)) {
      html += `<h4>${esc(CATEGORY_NAMES[cat] || cat)}</h4><ul class="jobs">` + list.map((it) => `<li>
        <a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener">${esc(it.title)}</a>
        <div class="where">${esc([it.company, it.location, it.source].filter(Boolean).join(' · '))}</div>
        ${it.note ? `<p class="note">${esc(it.note)}</p>` : ''}</li>`).join('') + '</ul>';
    }
    if (s.report) html += `<a class="report-link" href="${esc(REPO_URL + s.report)}" target="_blank" rel="noopener">Read the full report on GitHub →</a>`;
    document.getElementById('panel-body').innerHTML = html;

    if (!refresh) {
      lastFocus = document.activeElement;
      document.getElementById('panel').hidden = false;
      document.getElementById('backdrop').hidden = false;
      document.getElementById('close').focus();
    }
    openId = id;
    if (s.lastRun) { try { localStorage.setItem('seen:' + a.id, s.lastRun); } catch { /* storage unavailable */ } }
    a.news = false;
    renderRoster();
  }

  function closePanel() {
    document.getElementById('panel').hidden = true;
    document.getElementById('backdrop').hidden = true;
    openId = null;
    if (lastFocus) lastFocus.focus();
  }

  document.getElementById('close').addEventListener('click', closePanel);
  document.getElementById('backdrop').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openId) closePanel(); });

  // ---------- clicking the town ----------

  function hitTest(e) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    for (const a of agents) {
      const P = PLOTS[a.plot], v = a.v;
      if (!v.hidden && x > v.x - 6 && x < v.x + 6 && y > v.y - 17 && y < v.y + 2) return a;
      if (x > P.x + 3 && x < P.x + 84 && y > P.y + 4 && y < P.y + 50) return a;
    }
    return null;
  }

  canvas.addEventListener('click', (e) => { const a = hitTest(e); if (a) openPanel(a.id); });
  canvas.addEventListener('mousemove', (e) => { canvas.style.cursor = hitTest(e) ? 'pointer' : 'default'; });

  // ---------- clock ----------

  function tickClock() {
    const now = new Date();
    const s = seasonOf(now);
    document.getElementById('clock').textContent =
      now.toLocaleDateString(undefined, { weekday: 'long' }) + ', ' +
      now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' · ' +
      s[0].toUpperCase() + s.slice(1);
  }

  tickClock();
  setInterval(tickClock, 30000);
  setInterval(() => { load(); }, REFRESH_MS);
  setInterval(renderRoster, 60000);
  load();
  requestAnimationFrame(frame);
})();
