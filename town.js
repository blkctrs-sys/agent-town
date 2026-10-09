// Agent Town — a cozy little tech city where each agent lives in a townhouse.
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

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Draws a pixel pattern: rows of '#' (filled) and '.' (empty).
  function glyph(c, x, y, rows, col) {
    c.fillStyle = col;
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') c.fillRect(Math.round(x) + i, Math.round(y) + j, 1, 1);
    });
  }

  const CYAN = '#5ee7df', PINK = '#ff8fc4', AMBER = '#ffcf7a';

  // ---------- seasons & time of day ----------

  const SEASONS = {
    spring: { lawn: '#8ccf6a', lawn2: '#7fc260', tuft: '#69ad4e', crown: ['#4f9f4c', '#6cbb5e', '#f3a9c4'],
      flowers: ['#f7d14c', '#f29bc0', '#ffffff', '#b9a2f0'] },
    summer: { lawn: '#79bd56', lawn2: '#6fb24d', tuft: '#5c9e40', crown: ['#3f9346', '#55ad52', '#78c867'],
      flowers: ['#f7d14c', '#ef6f6c', '#ffffff', '#7fb6f0'] },
    autumn: { lawn: '#a5b45c', lawn2: '#99a853', tuft: '#86954a', crown: ['#b8452a', '#dc7a30', '#efb348'],
      flowers: ['#e08a33', '#c8552c', '#f2d06b', '#9c5a3c'] },
    winter: { lawn: '#e9eff3', lawn2: '#dfe7ed', tuft: '#c9d6df', crown: ['#2f6b4f', '#3c7d5c', '#f4f8fb'],
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
    [0, [26, 20, 66, 0.56]], [5, [26, 20, 66, 0.56]], [6.5, [255, 150, 140, 0.18]],
    [8, [255, 220, 180, 0]], [17, [255, 220, 180, 0]], [18.5, [255, 130, 90, 0.16]],
    [20, [80, 40, 110, 0.4]], [21.5, [26, 20, 66, 0.56]], [24, [26, 20, 66, 0.56]],
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

  // ---------- city layout ----------

  const SKYLINE_H = 30;
  const ROAD_Y = 106, ROAD_H = 16;
  const RAIL_Y = 200;
  const COLS = [16, 148, 280], ROWS = [34, 126];
  const PLOTS = [];
  for (const y of ROWS) for (const x of COLS) PLOTS.push({ x, y, top: y === ROWS[0] });

  const door = (P) => ({ x: P.x + 26, y: P.y + 50 });
  const kioskSpot = (P) => ({ x: P.x + 71, y: P.y + 50 });

  const trees = [
    { x: 124, y: 82, r: 12, ph: 1.3 }, { x: 262, y: 70, r: 9, ph: 2.1 }, { x: 246, y: 96, r: 6, ph: 4 },
    { x: 142, y: 142, r: 7, ph: 0.4 }, { x: 236, y: 186, r: 7, ph: 3.3 }, { x: 8, y: 96, r: 6, ph: 5 }, { x: 376, y: 96, r: 6, ph: 2.6 },
  ];

  const LAMPS = [{ x: 104, y: 104 }, { x: 236, y: 104 }, { x: 368, y: 104 }, { x: 40, y: 126 }, { x: 172, y: 126 }, { x: 304, y: 126 }];
  const FOUNTAIN = { x: 124, y: 166 };
  const CART = { x: 258, y: 160 };
  const BENCH = { x: 100, y: 188 };

  // Skyline: tall buildings along the back of town, with windows that light up at night.
  const skyline = [];
  const skyWindows = [];
  {
    const R = mulberry(11);
    const cols = ['#8e9bb5', '#a3aec4', '#7f8aa6', '#b3a9c2', '#9aa3b8'];
    for (let x = -6; x < W + 6;) {
      const w = 14 + ((R() * 18) | 0), h = 16 + ((R() * 16) | 0);
      const b = { x, w, h, col: cols[(R() * cols.length) | 0], antenna: R() > 0.6, ph: R() * 6 };
      skyline.push(b);
      for (let wy = SKYLINE_H - h + 3; wy < SKYLINE_H - 3; wy += 4)
        for (let wx = x + 2; wx < x + w - 2; wx += 4)
          skyWindows.push({ x: wx, y: wy, lit: R() > 0.45, col: R() > 0.8 ? '#9ff3ff' : AMBER });
      x += w + ((R() * 3) | 0);
    }
  }

  // ---------- state ----------

  let agents = [];           // [{...config, status, mode, news, v}]
  let season = seasonOf(new Date());
  let bg = null, bgKey = '';
  const particles = [];
  const cars = [];
  const drones = Array.from({ length: 2 }, (_, i) => ({ x: i * 200, y: 50 + i * 30, vx: 18 + i * 6, ph: i * 3 }));
  const butterflies = Array.from({ length: 3 }, (_, i) => ({ x: 60 + i * 120, y: 90 + i * 30, ph: i * 2 }));
  const tram = { x: -200, wait: 6 };
  const labels = new Map();

  // ---------- background (static, rebuilt when season or plots change) ----------

  function buildBackground() {
    const S = SEASONS[season];
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = mulberry(7);

    // paving
    rect(g, 0, 0, W, H, '#c9c0b0');
    for (let y = SKYLINE_H; y < H; y += 8) rect(g, 0, y, W, 1, '#bcb2a1');
    for (let y = SKYLINE_H; y < H; y += 8) for (let x = (y / 8) % 2 ? 0 : 6; x < W; x += 12) rect(g, x, y, 1, 8, '#bcb2a1');
    for (let i = 0; i < 400; i++) rect(g, R() * W, SKYLINE_H + R() * (H - SKYLINE_H), 1, 1, '#d6cebf');

    // skyline
    rect(g, 0, 0, W, SKYLINE_H, '#b9c3d6');
    for (const b of skyline) {
      rect(g, b.x, SKYLINE_H - b.h, b.w, b.h, b.col);
      rect(g, b.x, SKYLINE_H - b.h, 1, b.h, shade(b.col, 18));
      rect(g, b.x + b.w - 1, SKYLINE_H - b.h, 1, b.h, shade(b.col, -18));
      if (season === 'winter') rect(g, b.x, SKYLINE_H - b.h, b.w, 1, '#f4f8fb');
    }
    for (const w of skyWindows) rect(g, w.x, w.y, 2, 2, '#d4e3ee');
    rect(g, 0, SKYLINE_H, W, 2, '#6f7891');
    rect(g, 0, SKYLINE_H + 2, W, 1, '#8b93a8');

    // road
    rect(g, 0, ROAD_Y - 2, W, 2, '#9b968e');
    rect(g, 0, ROAD_Y, W, ROAD_H, '#4a4f5e');
    rect(g, 0, ROAD_Y + ROAD_H, W, 2, '#9b968e');
    for (let i = 0; i < 120; i++) rect(g, R() * W, ROAD_Y + 1 + R() * (ROAD_H - 2), 1, 1, '#555a6a');
    for (let x = 4; x < W; x += 14) rect(g, x, ROAD_Y + 7, 7, 1, '#e9d27a');
    for (let x = 0; x < W; x += 1) if (x % 3 === 0) { rect(g, x, ROAD_Y + 1, 1, 1, '#5ee7df55'); }

    // tram rails
    rect(g, 0, RAIL_Y - 4, W, 1, '#7d8496');
    for (let x = 1; x < W; x += 8) rect(g, x, RAIL_Y - 7, 1, 4, '#7d8496');
    rect(g, 0, RAIL_Y, W, 16, '#8f8a82');
    for (let x = 0; x < W; x += 5) rect(g, x, RAIL_Y + 3, 3, 9, '#7a6450');
    rect(g, 0, RAIL_Y + 4, W, 1, '#c8ccd6');
    rect(g, 0, RAIL_Y + 10, W, 1, '#c8ccd6');

    const occupied = new Set(agents.map((a) => a.plot));
    PLOTS.forEach((P, i) => {
      // lawn yard in front of each home
      rect(g, P.x + 4, P.y + 47, 82, 20, S.lawn);
      for (let k = 0; k < 40; k++) rect(g, P.x + 5 + R() * 79, P.y + 48 + R() * 17, 2, 1, S.lawn2);
      for (let k = 0; k < 10; k++) glyph(g, P.x + 6 + R() * 76, P.y + 49 + R() * 15, ['#.#', '.#.'], S.tuft);
      for (let k = 0; k < 7; k++) {
        const fx = P.x + 6 + R() * 76, fy = P.y + 50 + R() * 13;
        glyph(g, fx, fy, ['.#.', '#.#', '.#.'], S.flowers[(R() * 4) | 0]);
      }
      rect(g, P.x + 4, P.y + 67, 82, 1, '#9d9585');
      // walkway from the door to the street
      if (P.top) {
        rect(g, P.x + 23, P.y + 46, 7, ROAD_Y - 2 - P.y - 46, '#ddd5c6');
        for (let y = P.y + 50; y < ROAD_Y - 2; y += 4) rect(g, P.x + 23, y, 7, 1, '#cfc6b5');
      } else {
        rect(g, P.x + 48, ROAD_Y + ROAD_H + 2, 7, P.y + 50 - (ROAD_Y + ROAD_H + 2), '#ddd5c6');
        rect(g, P.x + 23, P.y + 46, 32, 6, '#ddd5c6');
      }
      if (!occupied.has(i)) {
        // empty lot with hazard tape and crates
        rect(g, P.x + 6, P.y + 14, 42, 32, '#b5ac9b');
        for (let x = 0; x < 42; x += 4) rect(g, P.x + 6 + x, P.y + 14, 2, 2, '#e8c547');
        for (let x = 2; x < 42; x += 4) rect(g, P.x + 6 + x, P.y + 14, 2, 2, '#3b3f4d');
        for (const [cx, cy] of [[12, 32], [20, 34], [15, 27]]) {
          rect(g, P.x + cx, P.y + cy, 7, 6, '#b98a5a');
          rect(g, P.x + cx, P.y + cy, 7, 1, '#d0a272');
          rect(g, P.x + cx + 3, P.y + cy, 1, 6, '#94683f');
        }
      }
    });
    return c;
  }

  // ---------- sprites ----------

  function drawTree(tr, t, S) {
    const sw = Math.round(Math.sin(t * 0.7 + tr.ph) * 0.7);
    const [dark, mid, light] = S.crown;
    ellipse(ctx, tr.x, tr.y, Math.max(3, (tr.r * 0.6) | 0) + 1, 2, '#8f8a80');
    ellipse(ctx, tr.x, tr.y, Math.max(2, (tr.r * 0.6) | 0), 1, '#6e5a44');
    rect(ctx, tr.x - 1, tr.y - 7, 3, 7, '#7a5232');
    const cy = tr.y - 6 - tr.r;
    disc(ctx, tr.x + sw, cy, tr.r, dark);
    disc(ctx, tr.x + sw - 1, cy - 2, tr.r - 2, mid);
    disc(ctx, tr.x + sw - 3, cy - 4, Math.max(2, tr.r - 6), light);
  }

  function drawHome(P, a, lit, t) {
    const x = P.x + 6, y = P.y;
    const accent = a.color;
    ellipse(ctx, x + 20, y + 47, 23, 2, 'rgba(0,0,0,0.15)');
    // roof deck
    rect(ctx, x - 1, y + 5, 42, 11, '#5d6275');
    rect(ctx, x - 1, y + 15, 42, 1, '#474b5b');
    for (const px of [x + 2, x + 9]) {
      rect(ctx, px, y + 7, 6, 6, '#3d5a8a');
      rect(ctx, px, y + 9, 6, 1, '#6f8fc2');
      rect(ctx, px + 3, y + 7, 1, 6, '#6f8fc2');
    }
    rect(ctx, x + 19, y + 9, 10, 4, '#7a5232');
    if (season !== 'winter') for (let k = 0; k < 4; k++) disc(ctx, x + 20 + k * 3, y + 8, 1, SEASONS[season].crown[k % 3]);
    rect(ctx, x + 32, y + 8, 4, 3, '#8a8f9e');
    rect(ctx, x + 38, y - 1, 1, 8, '#3b3f4d');
    if (Math.sin(t * 3 + P.x) > 0) rect(ctx, x + 37, y - 2, 3, 1, '#ff5d5d');
    if (season === 'winter') { rect(ctx, x - 1, y + 5, 42, 2, '#f4f8fb'); rect(ctx, x + 2, y + 7, 13, 1, '#f4f8fb'); }
    // facade
    rect(ctx, x, y + 16, 40, 30, '#e6d8c0');
    rect(ctx, x, y + 16, 2, 30, '#f2e6d2');
    rect(ctx, x + 38, y + 16, 2, 30, '#cdbd9f');
    // upstairs windows with plants
    for (const wx of [x + 6, x + 26]) {
      rect(ctx, wx, y + 18, 8, 7, '#4a4f60');
      rect(ctx, wx + 1, y + 19, 6, 5, lit ? AMBER : '#a9d8ea');
      if (!lit) rect(ctx, wx + 1, y + 19, 2, 1, '#e4f4fa');
      rect(ctx, wx + 4, y + 19, 1, 5, '#4a4f60');
      rect(ctx, wx - 1, y + 25, 10, 1, '#8a8f9e');
      if (season !== 'winter') { rect(ctx, wx, y + 24, 1, 1, '#5fa84a'); rect(ctx, wx + 6, y + 24, 1, 1, '#5fa84a'); }
    }
    // neon sign band
    rect(ctx, x + 2, y + 27, 36, 2, lit ? shade(accent, 70) : accent);
    // awning
    for (let k = 0; k < 40; k += 4) {
      rect(ctx, x + k, y + 29, 2, 2, accent);
      rect(ctx, x + k + 2, y + 29, 2, 2, '#f4ecdc');
    }
    rect(ctx, x, y + 31, 40, 1, shade(accent, -40));
    // shop windows with a glowing screen
    for (const wx of [x + 3, x + 27]) {
      rect(ctx, wx, y + 33, 10, 10, '#4a4f60');
      rect(ctx, wx + 1, y + 34, 8, 8, lit ? '#ffe2a8' : '#9fd0de');
      rect(ctx, wx + 2, y + 36, 6, 4, '#24304a');
      rect(ctx, wx + 3, y + 37, (2 + Math.floor(t * 2 + wx) % 4), 1, CYAN);
      rect(ctx, wx + 3, y + 39, 3, 1, PINK);
    }
    // sliding glass door
    rect(ctx, x + 16, y + 33, 8, 13, '#4a4f60');
    rect(ctx, x + 17, y + 34, 6, 12, lit ? '#ffe0a0' : '#7fb3c4');
    rect(ctx, x + 20, y + 34, 1, 12, '#4a4f60');
    rect(ctx, x + 15, y + 46, 10, 1, '#a49d90');
  }

  function drawKiosk(P, a, t) {
    const bx = P.x + 60, by = P.y + 28;
    const items = (a.status && a.status.items) || [];
    rect(ctx, bx + 9, by + 13, 4, 7, '#4a4f60');
    rect(ctx, bx + 6, by + 19, 10, 2, '#3b3f4d');
    rect(ctx, bx, by, 22, 14, '#2a2f3d');
    rect(ctx, bx + 1, by + 1, 20, 12, '#14202c');
    for (let i = 0; i < Math.min(items.length, 10); i++) {
      const px = bx + 2 + (i % 5) * 4, py = by + 2 + Math.floor(i / 5) * 5;
      rect(ctx, px, py, 3, 4, items[i].category === 'ops' ? PINK : CYAN);
      rect(ctx, px, py, 3, 1, '#e9fffd');
    }
    if (a.mode === 'working') rect(ctx, bx + 1, by + 1 + Math.floor(t * 8) % 12, 20, 1, rgba(CYAN, 0.6));
    const light = a.mode === 'working' ? AMBER : (a.mode === 'error' || a.mode === 'stuck') ? '#ff5d5d' : '#7be08a';
    rect(ctx, bx + 10, by - 1, 2, 1, light);
  }

  function drawHoloSign(P, t) {
    const sx = P.x + 64, sy = P.y + 30 + Math.round(Math.sin(t * 2 + P.x) * 1);
    rect(ctx, P.x + 69, P.y + 40, 2, 8, '#4a4f60');
    rect(ctx, P.x + 66, P.y + 47, 8, 1, '#3b3f4d');
    ctx.globalAlpha = 0.75;
    rect(ctx, sx, sy, 12, 7, '#1e4a52');
    ctx.globalAlpha = 1;
    rect(ctx, sx, sy, 12, 1, CYAN);
    glyph(ctx, sx + 2, sy + 2, ['#.#.###', '###..#.', '#.#.###'], CYAN); // "HI"
  }

  function drawLamp(L, lit) {
    rect(ctx, L.x, L.y - 16, 1, 16, '#3b3f4d');
    rect(ctx, L.x - 1, L.y - 1, 3, 1, '#3b3f4d');
    rect(ctx, L.x, L.y - 17, 4, 1, '#3b3f4d');
    rect(ctx, L.x + 2, L.y - 16, 3, 1, lit ? AMBER : '#ddd5bd');
  }

  function drawFountain(t) {
    const { x, y } = FOUNTAIN;
    ellipse(ctx, x, y, 15, 8, '#b9b3a8');
    ellipse(ctx, x, y, 13, 6, season === 'winter' ? '#cfe6f0' : '#7cc3dd');
    ellipse(ctx, x + 2, y + 1, 8, 3, season === 'winter' ? '#bcdbe8' : '#69b2cf');
    rect(ctx, x - 1, y - 8, 3, 8, '#cfc8bb');
    ellipse(ctx, x, y - 8, 3, 1, '#b9b3a8');
    if (season !== 'winter') {
      const s = Math.floor(t * 6) % 3;
      rect(ctx, x, y - 11 - s, 1, 2, '#e6f6fb');
      rect(ctx, x - 3 + s, y - 6, 1, 1, '#e6f6fb');
      rect(ctx, x + 3 - s, y - 6, 1, 1, '#e6f6fb');
    }
  }

  function drawCart(lit) {
    const { x, y } = CART;
    ellipse(ctx, x, y + 1, 11, 2, 'rgba(0,0,0,0.15)');
    rect(ctx, x - 9, y - 9, 18, 9, '#c8553d');
    rect(ctx, x - 9, y - 9, 18, 1, '#e07a5f');
    rect(ctx, x - 7, y - 6, 14, 3, '#f4ecdc');
    rect(ctx, x - 5, y - 5, 2, 1, '#c8553d');
    rect(ctx, x - 1, y - 5, 4, 1, '#3b3f4d');
    disc(ctx, x - 6, y, 2, '#3b3f4d');
    disc(ctx, x + 6, y, 2, '#3b3f4d');
    rect(ctx, x - 9, y - 19, 1, 10, '#6b4428');
    rect(ctx, x + 8, y - 19, 1, 10, '#6b4428');
    for (let k = 0; k < 20; k += 4) { rect(ctx, x - 10 + k, y - 21, 2, 3, '#e8c547'); rect(ctx, x - 8 + k, y - 21, 2, 3, '#f4ecdc'); }
    rect(ctx, x + 9, y - 17, 3, 4, lit ? '#ff7a59' : '#e07a5f');
    rect(ctx, x + 10, y - 18, 1, 1, '#3b3f4d');
  }

  function drawBench() {
    const { x, y } = BENCH;
    rect(ctx, x, y - 5, 14, 2, '#7a8296');
    rect(ctx, x, y - 2, 14, 2, '#b8875a');
    rect(ctx, x + 1, y, 1, 2, '#3b3f4d');
    rect(ctx, x + 12, y, 1, 2, '#3b3f4d');
  }

  function drawCar(c, lit) {
    const x = Math.round(c.x), y = Math.round(c.y + Math.sin(c.ph) * 0.6);
    rect(ctx, x + 1, c.y + 4, 11, 1, 'rgba(0,0,0,0.25)');
    rect(ctx, x + 1, y - 4, 11, 5, c.col);
    rect(ctx, x, y - 3, 13, 3, c.col);
    rect(ctx, x + 1, y - 4, 11, 1, shade(c.col, 40));
    rect(ctx, c.dir > 0 ? x + 6 : x + 2, y - 5, 5, 2, '#9fd8e6');
    rect(ctx, x + 2, y + 1, 9, 1, rgba(CYAN, 0.8));
    rect(ctx, c.dir > 0 ? x + 12 : x, y - 2, 1, 1, lit ? '#fff6c8' : '#e9e1cf');
    rect(ctx, c.dir > 0 ? x : x + 12, y - 2, 1, 1, '#ff5d5d');
  }

  function drawTram(lit) {
    if (tram.x < -100 || tram.x > W + 10) return;
    for (let k = 0; k < 3; k++) {
      const x = Math.round(tram.x) - k * 27;
      rect(ctx, x, RAIL_Y - 4, 25, 12, '#e9e1cf');
      rect(ctx, x, RAIL_Y - 4, 25, 1, '#f7f2e6');
      rect(ctx, x, RAIL_Y + 4, 25, 2, '#3f7f86');
      for (let w = 2; w < 24; w += 6) rect(ctx, x + w, RAIL_Y - 2, 4, 4, lit ? AMBER : '#9fd0de');
      rect(ctx, x + 1, RAIL_Y + 7, 23, 1, '#3b3f4d');
    }
    rect(ctx, Math.round(tram.x) + 24, RAIL_Y - 1, 2, 2, lit ? '#fff6c8' : '#e9e1cf');
  }

  function drawDrone(d, t) {
    const x = Math.round(d.x), y = Math.round(d.y + Math.sin(t * 2 + d.ph) * 2);
    ellipse(ctx, x, y + 16, 3, 1, 'rgba(0,0,0,0.12)');
    rect(ctx, x - 2, y, 5, 2, '#3b3f4d');
    const spin = Math.floor(t * 20) % 2;
    rect(ctx, x - 4, y - 1, 3, 1, spin ? '#c8ccd6' : '#8a8f9e');
    rect(ctx, x + 2, y - 1, 3, 1, spin ? '#8a8f9e' : '#c8ccd6');
    if (Math.sin(t * 5 + d.ph) > 0) rect(ctx, x, y + 2, 1, 1, '#7be08a');
  }

  function drawVillager(a, t) {
    const v = a.v;
    const x = Math.round(v.x), f = v.moving ? Math.floor(t * 8 + v.ph) % 2 : 0;
    const y = Math.round(v.y) + (v.moving && f ? -1 : 0);
    const skin = '#f3cfa6', ink = '#3b2f25';
    ellipse(ctx, Math.round(v.x), Math.round(v.y), 3, 1, 'rgba(0,0,0,0.2)');
    rect(ctx, x - 2, y - 2, 1, v.moving && f ? 1 : 2, '#3b3f4d');
    rect(ctx, x + 1, y - 2, 1, v.moving && !f ? 1 : 2, '#3b3f4d');
    // jacket & arms
    rect(ctx, x - 3, y - 7, 6, 5, a.color);
    rect(ctx, x - 3, y - 3, 6, 1, shade(a.color, -30));
    rect(ctx, x - 4, y - 6, 1, 3, shade(a.color, -15));
    rect(ctx, x + 3, y - 6, 1, 3, shade(a.color, -15));
    rect(ctx, x, y - 7, 1, 4, shade(a.color, 30));
    // messenger bag
    rect(ctx, v.dir > 0 ? x - 2 : x + 1, y - 7, 1, 4, '#7a4b2a');
    rect(ctx, v.dir > 0 ? x - 4 : x + 3, y - 4, 2, 2, '#8f5b34');
    // head
    rect(ctx, x - 3, y - 12, 6, 5, skin);
    if (v.moving) rect(ctx, v.dir > 0 ? x + 1 : x - 2, y - 10, 1, 1, ink);
    else { rect(ctx, x - 2, y - 10, 1, 1, ink); rect(ctx, x + 1, y - 10, 1, 1, ink); }
    rect(ctx, v.dir > 0 ? x + 2 : x - 3, y - 9, 1, 1, '#eaa48e');
    // cap & headset
    rect(ctx, x - 3, y - 14, 6, 2, a.hat);
    rect(ctx, v.dir > 0 ? x + 1 : x - 4, y - 12, 4, 1, shade(a.hat, -25));
    rect(ctx, v.dir > 0 ? x - 4 : x + 3, y - 11, 1, 2, '#3b3f4d');
    rect(ctx, v.dir > 0 ? x - 4 : x + 3, y - 11, 1, 1, CYAN);
  }

  function drawBubble(x, y, kind, t) {
    const by = Math.round(y - 25 + Math.sin(t * 3) * 1);
    const bx = Math.round(x - 5);
    rect(ctx, bx, by, 11, 8, '#2a2f3d');
    rect(ctx, bx + 1, by + 1, 9, 6, '#fffaf0');
    rect(ctx, bx + 4, by + 8, 2, 1, '#2a2f3d');
    rect(ctx, bx + 5, by + 9, 1, 1, '#2a2f3d');
    if (kind === '!') glyph(ctx, bx + 5, by + 1, ['#', '#', '#', '.', '#'], '#e0662a');
    if (kind === '?') glyph(ctx, bx + 4, by + 1, ['##.', '..#', '.#.', '...', '.#.'], '#b5482f');
    if (kind === '...') for (let k = 0; k < 3; k++) if (Math.floor(t * 3) % 4 > k) rect(ctx, bx + 2 + k * 3, by + 4, 1, 1, '#2a2f3d');
  }

  function drawZs(P, t) {
    const x = P.x + 34, y = P.y + 14;
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.35 + k / 3) % 1;
      const zx = Math.round(x + p * 10 + Math.sin(p * 6) * 2), zy = Math.round(y - p * 16);
      ctx.globalAlpha = Math.sin(p * Math.PI);
      glyph(ctx, zx, zy, p > 0.5 ? ['####', '..#.', '.#..', '####'] : ['###', '.#.', '###'], '#e9fffd');
    }
    ctx.globalAlpha = 1;
  }

  // ---------- resident behaviour ----------

  function modeOf(a, now) {
    const s = a.status || {};
    const hour = now.getHours() + now.getMinutes() / 60;
    const updated = Date.parse(s.updated || s.lastRun || '') || 0;
    const ageH = (Date.now() - updated) / 3600000;
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
    const v = a.v, P = PLOTS[a.plot], d0 = door(P), k0 = kioskSpot(P);
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
        const atKiosk = Math.abs(v.x - k0.x) < 3;
        v.tx = atKiosk ? d0.x : k0.x; v.ty = d0.y;
        v.pause = atKiosk ? 1.2 : 2.5 + Math.random() * 2;
      } else if (a.mode === 'error' || a.mode === 'stuck') {
        v.tx = k0.x - 4; v.ty = k0.y; v.pause = 1;
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
    const v = a.v, k0 = kioskSpot(PLOTS[a.plot]);
    if (a.mode === 'error' || a.mode === 'stuck') return '?';
    if (a.mode === 'working' && !v.moving && Math.abs(v.x - k0.x) < 3) return '...';
    if (a.news) return '!';
    return null;
  }

  // ---------- moving things: steam, weather, traffic ----------

  let steamTimer = 0, weatherTimer = 0, carTimer = 1;
  const CAR_COLORS = ['#e07a5f', '#f2cc8f', '#81b29a', '#9b8ec4', '#f4ecdc', '#6fa8dc'];

  function updateWorld(dt, t) {
    steamTimer -= dt; weatherTimer -= dt; carTimer -= dt;
    if (steamTimer <= 0) {
      steamTimer = 0.5;
      for (const a of agents) {
        const P = PLOTS[a.plot];
        particles.push({ kind: 'steam', x: P.x + 39, y: P.y + 7, vx: 2 + Math.random(), vy: -6, life: 0, max: 2.6 });
      }
      particles.push({ kind: 'steam', x: CART.x - 1 + Math.random() * 3, y: CART.y - 7, vx: 1, vy: -5, life: 0, max: 1.8 });
    }
    if (weatherTimer <= 0 && (season === 'autumn' || season === 'winter')) {
      weatherTimer = season === 'winter' ? 0.08 : 0.6;
      const S = SEASONS[season];
      particles.push(season === 'winter'
        ? { kind: 'snow', x: Math.random() * W, y: -2, vx: 0, vy: 10 + Math.random() * 8, life: 0, max: 30, ph: Math.random() * 6 }
        : { kind: 'leaf', x: 100 + Math.random() * 180, y: 40 + Math.random() * 40, vx: 3, vy: 7 + Math.random() * 4, life: 0, max: 14, ph: Math.random() * 6,
            col: S.crown[(Math.random() * 3) | 0] });
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      p.x += (p.vx + (p.kind === 'snow' || p.kind === 'leaf' ? Math.sin(t * 2 + p.ph) * 6 : 0)) * dt;
      p.y += p.vy * dt;
      if (p.life > p.max || p.y > H + 4 || p.x > W + 4) particles.splice(i, 1);
    }

    // hover cars in two lanes
    if (carTimer <= 0) {
      carTimer = 2.5 + Math.random() * 4;
      const right = Math.random() > 0.5;
      cars.push({ x: right ? -14 : W + 1, y: right ? ROAD_Y + 13 : ROAD_Y + 6, dir: right ? 1 : -1,
        speed: 28 + Math.random() * 16, col: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0], ph: Math.random() * 6 });
    }
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      c.x += c.dir * c.speed * dt; c.ph += dt * 4;
      if (c.x < -20 || c.x > W + 20) cars.splice(i, 1);
    }

    // tram glides by every so often
    if (tram.x > W + 90) { tram.wait -= dt; if (tram.wait <= 0) { tram.x = -30; tram.wait = 25 + Math.random() * 20; } }
    else tram.x += 34 * dt;

    for (const d of drones) { d.x += d.vx * dt; if (d.x > W + 10) { d.x = -10; d.y = 44 + Math.random() * 50; } }
    for (const bf of butterflies) { bf.x += Math.sin(t * 0.4 + bf.ph) * 10 * dt; bf.y += Math.cos(t * 1.3 + bf.ph) * 8 * dt; }
  }

  function drawParticles(t) {
    for (const p of particles) {
      if (p.kind === 'steam') {
        const k = p.life / p.max, s = 1 + Math.round(k * 2);
        ctx.globalAlpha = 0.55 * (1 - k);
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
    const dark = sky[3] / 0.56;
    const lightsOn = dark > 0.3;

    const key = season + '|' + agents.map((a) => a.plot).join(',');
    if (key !== bgKey) { bg = buildBackground(); bgKey = key; }
    ctx.drawImage(bg, 0, 0);

    // depth-sorted scene
    const items = [];
    for (const tr of trees) items.push([tr.y, () => drawTree(tr, t, S)]);
    for (const L of LAMPS) items.push([L.y, () => drawLamp(L, lightsOn)]);
    for (const c of cars) items.push([c.y, () => drawCar(c, lightsOn)]);
    items.push([FOUNTAIN.y + 8, () => drawFountain(t)], [CART.y + 2, () => drawCart(lightsOn)], [BENCH.y, drawBench]);
    items.push([RAIL_Y + 8, () => drawTram(lightsOn)]);
    const occupied = new Map(agents.map((a) => [a.plot, a]));
    PLOTS.forEach((P, i) => {
      const a = occupied.get(i);
      if (!a) { items.push([P.y + 48, () => drawHoloSign(P, t)]); return; }
      const lit = (lightsOn && a.mode !== 'sleeping') || (a.mode === 'working' && dark > 0.1);
      items.push([P.y + 46, () => drawHome(P, a, lit, t)]);
      items.push([P.y + 48, () => drawKiosk(P, a, t)]);
      if (!a.v.hidden) items.push([a.v.y, () => drawVillager(a, t)]);
    });
    items.sort((p, q) => p[0] - q[0]);
    for (const [, draw] of items) draw();

    drawParticles(t);
    for (const d of drones) drawDrone(d, t);

    if (dark < 0.2 && (season === 'spring' || season === 'summer')) {
      for (const bf of butterflies) {
        const open = Math.sin(t * 14 + bf.ph) > 0;
        glyph(ctx, bf.x, bf.y, open ? ['#.#'] : ['.#.'], '#fff3a8');
      }
    }

    // time-of-day tint
    if (sky[3] > 0.005) {
      ctx.fillStyle = `rgba(${sky[0] | 0},${sky[1] | 0},${sky[2] | 0},${sky[3].toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // city lights after dark
    if (lightsOn) {
      for (const w of skyWindows) if (w.lit) rect(ctx, w.x, w.y, 2, 2, w.col);
      for (const b of skyline) if (b.antenna && Math.sin(t * 2 + b.ph) > 0.3) rect(ctx, b.x + (b.w >> 1), SKYLINE_H - b.h - 1, 1, 1, '#ff5d5d');
      ctx.globalCompositeOperation = 'lighter';
      const glow = (x, y, r, col, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(col, a));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      };
      for (const L of LAMPS) glow(L.x + 3, L.y - 15, 16, '#ffbe64', 0.35 * dark);
      for (const a of agents) {
        const P = PLOTS[a.plot];
        if (!(a.mode === 'sleeping' && hour < 5)) {
          glow(P.x + 16, P.y + 22, 8, '#ffbe64', 0.28 * dark);
          glow(P.x + 36, P.y + 22, 8, '#ffbe64', 0.28 * dark);
        }
        glow(P.x + 26, P.y + 28, 22, a.color, 0.3 * dark);
        glow(P.x + 71, P.y + 35, 12, CYAN, 0.3 * dark);
      }
      PLOTS.forEach((P, i) => { if (!occupied.has(i)) glow(P.x + 70, P.y + 34, 10, CYAN, 0.25 * dark); });
      for (const c of cars) {
        glow(c.x + (c.dir > 0 ? 16 : -3), c.y - 2, 7, '#fff6c8', 0.35 * dark);
        glow(c.x + 6, c.y + 2, 6, CYAN, 0.3 * dark);
      }
      if (tram.x > -100 && tram.x < W + 90) for (let k = 0; k < 3; k++) glow(tram.x - k * 27 + 12, RAIL_Y, 14, '#ffbe64', 0.25 * dark);
      glow(CART.x + 10, CART.y - 15, 12, '#ff7a59', 0.4 * dark);
      for (const d of drones) glow(d.x, d.y + 2, 4, '#7be08a', 0.5 * dark);
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
      const y = a.v.hidden ? P.y + 4 : a.v.y - (bubbleFor(a) ? 27 : 16);
      el.style.left = (x / W) * 100 + '%';
      el.style.top = (y / H) * 100 + '%';
    }
    PLOTS.forEach((P, i) => {
      const id = 'plot' + i;
      let el = labels.get(id);
      const taken = agents.some((a) => a.plot === i);
      if (taken) { if (el) el.hidden = true; return; }
      if (!el) { el = document.createElement('div'); el.className = 'label faint'; el.textContent = 'Open lot'; labelsEl.appendChild(el); labels.set(id, el); }
      el.hidden = false;
      el.style.left = ((P.x + 27) / W) * 100 + '%';
      el.style.top = ((P.y + 12) / H) * 100 + '%';
    });
  }

  let last = performance.now();
  function frame(ms) {
    const dt = Math.min(0.05, (ms - last) / 1000);
    last = ms;
    const t = ms / 1000, now = clockNow();
    season = seasonOf(now);
    for (const a of agents) { a.mode = modeOf(a, now); updateVillager(a, dt); }
    updateWorld(dt, t);
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
    switch (modeOf(a, clockNow())) {
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
      ? `${free} open lot${free === 1 ? '' : 's'}, waiting for new residents.`
      : 'Every lot in town is taken.';
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
      if (x > P.x + 3 && x < P.x + 84 && y > P.y + 2 && y < P.y + 50) return a;
    }
    return null;
  }

  canvas.addEventListener('click', (e) => { const a = hitTest(e); if (a) openPanel(a.id); });
  canvas.addEventListener('mousemove', (e) => { canvas.style.cursor = hitTest(e) ? 'pointer' : 'default'; });

  // ---------- clock ----------

  function tickClock() {
    const now = clockNow();
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
