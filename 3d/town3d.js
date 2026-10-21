// Agent Town 3D: a low-poly diorama of the tech city. Reads the same agents.json and
// status files as the 2D town. Everything is built from simple shapes for now; any
// resident can later be swapped for a Blender export (see below).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = '../';
const REPO_URL = 'https://github.com/blkctrs-sys/agent-town/blob/main/';
const Q = new URLSearchParams(location.search);
const HOUR_PARAM = Q.has('hour') ? parseFloat(Q.get('hour')) : null;
const EVENT_PARAM = Q.get('event');
const FORCE_WITCH = Q.get('witch') === '1';

// Drop-in Blender models: export a .glb (about 2.4 units tall, facing +Z, feet at 0),
// put it in 3d/models/, and add "model": "3d/models/craig.glb" to that resident in
// agents.json. If the file is missing, the blocky version stays.

// ---------- time & season ----------

function clockNow() {
  const d = new Date();
  if (HOUR_PARAM != null && !isNaN(HOUR_PARAM)) d.setHours(Math.floor(HOUR_PARAM), Math.round((HOUR_PARAM % 1) * 60), 0, 0);
  return d;
}
function eventOf(d) {
  if (EVENT_PARAM) return EVENT_PARAM === 'none' ? '' : EVENT_PARAM;
  const m = d.getMonth(), day = d.getDate();
  return m === 9 || (m === 10 && day <= 7) ? 'halloween' : '';
}

// Sky keyframes by hour: [hour, sky, light tint]
const SKY_NORMAL = [
  [0, '#0b1230'], [5, '#0b1230'], [6.5, '#e79a83'], [8, '#8fc3e3'], [17, '#8fc3e3'],
  [18.5, '#ec8a68'], [20, '#3a2a5e'], [21.5, '#0b1230'], [24, '#0b1230'],
];
const SKY_SPOOKY = [
  [0, '#0c0716'], [5, '#0c0716'], [6.5, '#7d4a52'], [8, '#6f6680'], [17, '#6f6680'],
  [18.5, '#b4562c'], [20, '#2d1638'], [21.5, '#0c0716'], [24, '#0c0716'],
];
const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function skyAt(keys, h, out) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, c0] = keys[i], [h1, c1] = keys[i + 1];
    if (h >= h0 && h <= h1) return out.copy(tmpA.set(c0)).lerp(tmpB.set(c1), (h - h0) / (h1 - h0 || 1));
  }
  return out.set(keys[0][1]);
}

// ---------- helpers ----------

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts });
  delete m.unique;
  if (!opts.unique) matCache.set(key, m);
  return m;
}
// Glowing material whose strength follows the night (registered so the clock can dim it).
const glows = [];
function glow(color, base = 0.4, night = 1.6) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: base, flatShading: true, roughness: 0.6 });
  glows.push({ m, base, night });
  return m;
}
function mesh(geo, material, x = 0, y = 0, z = 0, parent) {
  const o = new THREE.Mesh(geo, material);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  if (parent) parent.add(o);
  return o;
}
function box(w, h, d, material, x, y, z, parent) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y + h / 2, z, parent);
}
function cyl(rt, rb, h, material, x, y, z, parent, seg = 8) {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material, x, y + h / 2, z, parent);
}

// ---------- renderer, scene, camera ----------

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#0b1230', 70, 170);
scene.background = new THREE.Color('#0b1230');

const camera = new THREE.PerspectiveCamera(35, 1, 1, 400);
camera.position.set(54, 46, 70);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 7, -1);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 28;
controls.maxDistance = 120;
controls.maxPolarAngle = 1.3;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.addEventListener('start', () => { controls.autoRotate = false; });

const hemi = new THREE.HemisphereLight('#cfe3ff', '#3a2f45', 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1dc', 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const moonLight = new THREE.DirectionalLight('#9fb4ff', 0.4);
scene.add(moonLight);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Pull back on narrow screens so the whole island fits.
  camera.fov = w < h ? 58 : 35;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- the island ----------

const town = new THREE.Group();
scene.add(town);
const S = 22; // half-size of the island

box(S * 2, 3, S * 2, mat('#1c1b26'), 0, -3, 0, town);
box(S * 2 - 0.4, 0.6, S * 2 - 0.4, mat('#2e2d3b'), 0, -0.6, 0, town).receiveShadow = true;
// Underside rock, so it reads as a floating diorama.
const rock = mesh(new THREE.ConeGeometry(S * 1.25, 14, 7), mat('#15141d'), 0, -10, 0, town);
rock.rotation.x = Math.PI;
rock.scale.set(1, 1, 1);

// Road and sidewalks
box(S * 2 - 0.4, 0.05, 7, mat('#191a22'), 0, 0, 0, town);
for (let x = -S + 2; x < S - 1; x += 4) box(1.8, 0.06, 0.25, glow('#e8b84a', 0.3, 0.9), x, 0.01, 0, town);
box(S * 2 - 0.4, 0.25, 1.6, mat('#4a4858'), 0, 0, -4.3, town);
box(S * 2 - 0.4, 0.25, 1.6, mat('#4a4858'), 0, 0, 4.3, town);
for (let i = -2; i <= 2; i++) box(0.7, 0.06, 6.6, mat('#d9d6e6'), i * 1.2, 0.01, 0, town); // crosswalk
// Neon curb strips
box(S * 2 - 0.4, 0.06, 0.12, glow('#6fe3e8', 0.4, 1.8), 0, 0.25, -3.5, town);
box(S * 2 - 0.4, 0.06, 0.12, glow('#ff6fb5', 0.4, 1.8), 0, 0.25, 3.5, town);
// Plaza tiles
box(S * 2 - 0.4, 0.12, 16.4, mat('#3a3848'), 0, 0, 13.4, town);
for (let x = -18; x <= 18; x += 6) for (let z = 8; z <= 20; z += 6) box(5.6, 0.04, 5.6, mat('#433f53'), x, 0.12, z, town);

// ---------- skyline ----------

function windowTextures(cols, rows, seed, wall) {
  const r = rng(seed);
  const make = () => { const c = document.createElement('canvas'); c.width = cols * 8; c.height = rows * 8; return c; };
  const base = make(), emis = make();
  const b = base.getContext('2d'), e = emis.getContext('2d');
  b.fillStyle = wall; b.fillRect(0, 0, base.width, base.height);
  e.fillStyle = '#000'; e.fillRect(0, 0, emis.width, emis.height);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const lit = r() < 0.42;
    const col = r() < 0.7 ? '#ffcf7a' : r() < 0.6 ? '#7fe6ff' : '#ff8fd0';
    b.fillStyle = lit ? col : '#171a24';
    b.fillRect(x * 8 + 2, y * 8 + 2, 4, 5);
    if (lit) { e.fillStyle = col; e.fillRect(x * 8 + 2, y * 8 + 2, 4, 5); }
  }
  const toTex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return [toTex(base, true), toTex(emis, true)];
}

const WALLS = ['#3b3f5c', '#4a3d5e', '#2f4a57', '#53465f', '#36425e'];
const NEON = ['#6fe3e8', '#ff6fb5', '#ffc56b', '#9b7bff'];
const blinkers = [];
function tower(x, z, w, d, h, seed) {
  const wall = WALLS[seed % WALLS.length];
  const [map, emissiveMap] = windowTextures(Math.round(w * 1.2), Math.round(h * 1.1), seed, wall);
  const side = new THREE.MeshStandardMaterial({ color: '#ffffff', map, emissive: '#ffffff', emissiveMap, emissiveIntensity: 0.2, roughness: 0.8 });
  glows.push({ m: side, base: 0.15, night: 1.4 });
  const roof = mat('#262533');
  const b = mesh(new THREE.BoxGeometry(w, h, d), [side, side, roof, roof, side, side], x, h / 2, z, town);
  // Rooftop: neon band, a little cap, an antenna with a blinking light
  const n = NEON[seed % NEON.length];
  box(w + 0.1, 0.25, d + 0.1, glow(n, 0.5, 2.2), x, h - 0.9, z, town);
  box(w * 0.5, 1, d * 0.5, mat('#2c2b3a'), x, h, z, town);
  if (seed % 2 === 0) {
    cyl(0.08, 0.08, 4, mat('#8a879c'), x, h + 1, z, town, 5);
    const bulb = mesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff4f4f' }), x, h + 5.1, z, town);
    blinkers.push({ o: bulb, ph: seed });
  }
  return b;
}
[
  [-18, -16, 6, 6, 22], [-11, -18, 6, 5, 30], [-4, -16, 5, 6, 18], [3, -18, 7, 5, 34],
  [10.5, -16, 5, 6, 24], [17.5, -18, 6, 5, 28], [-18.5, -9.5, 4, 3, 9], [18.5, -9.5, 4, 3, 11],
].forEach(([x, z, w, d, h], i) => tower(x, z, w, d, h, i + 3));

// Holographic billboard between two towers
const billboard = mesh(new THREE.PlaneGeometry(7, 3.2), glow('#ff6fb5', 0.6, 1.6), -7.5, 14, -15.4, town);
billboard.material.transparent = true; billboard.material.opacity = 0.75; billboard.castShadow = false;

// ---------- townhouses (one per plot) ----------

const PLOTS = [-13.5, -4.5, 4.5, 13.5].map((x) => ({ x, z: -8.6 }));
const houses = [];
function townhouse(P, color) {
  const g = new THREE.Group(); g.position.set(P.x, 0, P.z); town.add(g);
  box(6.4, 5.6, 5, mat('#4b4760'), 0, 0, 0, g);
  box(6.8, 0.4, 5.4, mat('#2b2938'), 0, 5.6, 0, g);
  box(6.6, 0.18, 0.12, glow(color, 0.6, 2.4), 0, 5.2, 2.55, g); // neon trim
  box(1.6, 2.6, 0.2, mat(color), 0, 0.25, 2.5, g); // door
  box(1.9, 0.12, 0.3, glow(color, 0.5, 2), 0, 2.85, 2.55, g);
  box(1, 0.25, 1, mat('#5b586c'), 0, 0, 3, g); // step
  const winMat = glow('#ffcf7a', 0.05, 1.8);
  const winL = box(1.5, 1.3, 0.12, winMat, -2, 3, 2.52, g);
  const winR = box(1.5, 1.3, 0.12, winMat, 2, 3, 2.52, g);
  // Rooftop: solar panel and a satellite dish
  const panel = box(2.6, 0.12, 1.6, mat('#2a4a7a', { metalness: 0.4, roughness: 0.4 }), -1.3, 6.2, -0.6, g);
  panel.rotation.x = -0.35;
  cyl(0.06, 0.06, 0.7, mat('#8a879c'), 1.8, 6, 0.6, g, 5);
  const dish = mesh(new THREE.SphereGeometry(0.6, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.5), mat('#c9c6d8', { side: THREE.DoubleSide }), 1.8, 6.9, 0.6, g);
  dish.rotation.x = 2.3;
  return { g, door: new THREE.Vector3(P.x, 0, P.z + 3.6), winMat };
}

// Empty lots: a holo "lot open" sign, or a little graveyard in spooky season.
const emptyLots = [];
function emptyLot(P) {
  const g = new THREE.Group(); g.position.set(P.x, 0, P.z); town.add(g);
  box(6.2, 0.15, 5, mat('#2c3a2f'), 0, 0, 0, g);
  const normal = new THREE.Group(), spooky = new THREE.Group();
  g.add(normal, spooky);
  cyl(0.08, 0.08, 2.2, mat('#8a879c'), 0, 0, 1.5, normal, 5);
  const sign = mesh(new THREE.PlaneGeometry(2.6, 1.1), glow('#7be08a', 0.6, 1.8), 0, 2.6, 1.5, normal);
  sign.castShadow = false;
  const stone = mat('#7d7a8c');
  [[-1.8, -0.8], [0, -1.2], [1.8, -0.6], [-0.9, 0.9], [1, 1]].forEach(([x, z], i) => {
    const h = 1 + (i % 3) * 0.25;
    box(0.9, h, 0.3, stone, x, 0, z, spooky).rotation.z = (i % 2 ? 0.08 : -0.06);
    mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10, 1, false, 0, Math.PI), stone, x, h, z, spooky).rotation.set(Math.PI / 2, 0, Math.PI / 2);
  });
  for (let x = -3; x <= 3; x += 0.75) box(0.12, 0.9, 0.12, mat('#1c1a24'), x, 0, 2.4, spooky);
  box(6.2, 0.1, 0.1, mat('#1c1a24'), 0, 0.75, 2.4, spooky);
  emptyLots.push({ normal, spooky, P });
}

// ---------- plaza props ----------

// Fountain with a spinning holo ring
const fountain = new THREE.Group(); fountain.position.set(0, 0.12, 12); town.add(fountain);
cyl(3.2, 3.4, 0.8, mat('#5b586c'), 0, 0, 0, fountain, 12);
cyl(2.8, 2.8, 0.1, glow('#3fb6d9', 0.5, 1.5), 0, 0.75, 0, fountain, 12);
cyl(0.5, 0.7, 2.6, mat('#6c6980'), 0, 0, 0, fountain, 8);
const holoRing = mesh(new THREE.TorusGeometry(1.4, 0.07, 6, 28), glow('#6fe3e8', 1, 2.5), 0, 3.6, 0, fountain);
const holoRing2 = mesh(new THREE.TorusGeometry(1, 0.05, 6, 24), glow('#ff6fb5', 1, 2.5), 0, 3.6, 0, fountain);

// Noodle cart
const cart = new THREE.Group(); cart.position.set(11, 0.12, 11); cart.rotation.y = -0.5; town.add(cart);
box(3.2, 1.6, 1.6, mat('#b2463c'), 0, 0.4, 0, cart);
box(3.6, 0.15, 2, mat('#e9e1cf'), 0, 2.9, 0, cart);
for (const sx of [-1.5, 1.5]) cyl(0.07, 0.07, 1.0, mat('#3a3848'), sx, 2, 0.8, cart, 5);
for (const sx of [-1, 1]) mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 10), mat('#222'), sx, 0.4, 0.8, cart).rotation.x = Math.PI / 2;
const lantern = mesh(new THREE.SphereGeometry(0.3, 8, 6), glow('#ff6b4a', 0.8, 2.6), 1.3, 2.55, 0.9, cart);
cyl(0.4, 0.3, 0.35, mat('#efe6d6'), -0.6, 2, 0, cart, 10); // steaming bowl

// Holo kiosk
const kiosk = new THREE.Group(); kiosk.position.set(-11, 0.12, 11); town.add(kiosk);
box(1.2, 2.2, 1, mat('#3c3a4e'), 0, 0, 0, kiosk);
box(1, 0.6, 0.1, glow('#7fe6ff', 0.8, 2), 0, 1.3, 0.52, kiosk);
const holo = mesh(new THREE.OctahedronGeometry(0.6, 0), glow('#9b7bff', 0.9, 2.4), 0, 3.4, 0, kiosk);

// Trees (spooky season swaps the canopy colors and drops a few leaves)
const trees = [];
[[-18, 8], [-15, 19], [18, 8], [15, 19], [-5, 20], [6, 20], [-20, 14], [20, 14]].forEach(([x, z], i) => {
  const g = new THREE.Group(); g.position.set(x, 0.12, z); town.add(g);
  cyl(0.25, 0.35, 1.8, mat('#4a3528'), 0, 0, 0, g, 6);
  const canopy = mesh(new THREE.IcosahedronGeometry(1.5 + (i % 3) * 0.3, 0), mat('#3e8f6a', { unique: true }), 0, 2.8, 0, g);
  canopy.scale.y = 1.15;
  trees.push({ canopy, i });
});

// Benches & street lamps
for (const x of [-6, 6]) {
  const b = new THREE.Group(); b.position.set(x, 0.12, 16); town.add(b);
  box(2.4, 0.15, 0.8, mat('#7a5a3e'), 0, 0.55, 0, b);
  box(2.4, 0.6, 0.12, mat('#7a5a3e'), 0, 0.7, -0.35, b);
  for (const sx of [-1, 1]) box(0.12, 0.55, 0.6, mat('#2c2b3a'), sx, 0, 0, b);
}
const lampBulbs = [];
for (const x of [-16, -8, 8, 16]) for (const z of [-5.3, 5.3]) {
  cyl(0.1, 0.12, 4.2, mat('#3a3848'), x, 0.25, z, town, 6);
  box(1, 0.1, 0.1, mat('#3a3848'), x + (z < 0 ? 0 : 0), 4.3, z + (z < 0 ? 0.45 : -0.45), town);
  lampBulbs.push(mesh(new THREE.SphereGeometry(0.22, 8, 6), glow('#ffd896', 0.2, 3), x, 4.2, z + (z < 0 ? 0.9 : -0.9), town));
}
// Two real lights so the plaza gets a warm pool at night (kept to two for phones).
const plazaLight = new THREE.PointLight('#ffb36b', 0, 26, 1.6); plazaLight.position.set(0, 6, 12); town.add(plazaLight);
const streetLight = new THREE.PointLight('#8fd8ff', 0, 30, 1.6); streetLight.position.set(0, 6, -4); town.add(streetLight);

// ---------- traffic & sky things ----------

const cars = [];
const CAR_COLORS = ['#ff6fb5', '#6fe3e8', '#ffc56b', '#9b7bff', '#7be08a'];
for (let i = 0; i < 5; i++) {
  const g = new THREE.Group();
  const c = CAR_COLORS[i % CAR_COLORS.length];
  box(2.6, 0.6, 1.3, mat(c, { metalness: 0.3, roughness: 0.5 }), 0, 0, 0, g);
  box(1.4, 0.45, 1.1, mat('#1d2233', { metalness: 0.5, roughness: 0.2 }), -0.2, 0.6, 0, g);
  box(0.08, 0.2, 1, glow('#fff4d6', 1, 3), 1.32, 0.2, 0, g);
  box(0.08, 0.2, 1, glow('#ff4f4f', 1, 3), -1.32, 0.2, 0, g);
  const under = mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45 }), 0, -0.25, 0, g);
  under.rotation.x = -Math.PI / 2; under.castShadow = false;
  const dir = i % 2 ? 1 : -1;
  g.rotation.y = dir > 0 ? 0 : Math.PI;
  town.add(g);
  cars.push({ g, dir, x: -S + rand() * S * 2, z: dir > 0 ? -1.7 : 1.7, speed: 6 + rand() * 4, ph: rand() * 6 });
}

const drones = [];
for (let i = 0; i < 3; i++) {
  const g = new THREE.Group();
  box(0.8, 0.2, 0.8, mat('#2c2b3a'), 0, 0, 0, g);
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) cyl(0.3, 0.3, 0.04, mat('#8a879c'), x, 0.2, z, g, 8);
  const light = mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: i % 2 ? '#7be08a' : '#ff6fb5' }), 0, -0.1, 0, g);
  town.add(g);
  drones.push({ g, light, r: 10 + i * 5, y: 15 + i * 3, speed: 0.25 + i * 0.07, ph: i * 2 });
}

const moon = mesh(new THREE.SphereGeometry(7, 20, 14), new THREE.MeshBasicMaterial({ color: '#f4efd8', fog: false }), 0, 0, 0, scene);
moon.castShadow = false;
const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('#ffe9a8'), transparent: true, depthWrite: false, fog: false }));
moonHalo.scale.set(48, 48, 1);
scene.add(moonHalo);

const stars = (() => {
  const pts = [];
  for (let i = 0; i < 400; i++) {
    const v = new THREE.Vector3().setFromSphericalCoords(170, Math.acos(rand() * 0.9), rand() * Math.PI * 2);
    pts.push(v.x, Math.abs(v.y) + 10, v.z);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 1.1, sizeAttenuation: false, transparent: true, fog: false }));
  scene.add(p);
  return p;
})();

function radialTexture(color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.globalAlpha = 0.5; x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function textTexture(ch, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 48px Nunito, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = color; x.fillText(ch, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- spooky season ----------

const spookyGroup = new THREE.Group(); scene.add(spookyGroup);
const pumpkins = [];
function pumpkin(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0.12, z); g.scale.setScalar(s); spookyGroup.add(g);
  const body = mesh(new THREE.SphereGeometry(0.55, 10, 7), mat('#e0701f'), 0, 0.45, 0, g);
  body.scale.y = 0.78;
  cyl(0.06, 0.08, 0.25, mat('#4a5e2a'), 0, 0.82, 0, g, 5);
  const face = glow('#ffb13b', 0.6, 3);
  box(0.14, 0.14, 0.05, face, -0.18, 0.5, 0.5, g);
  box(0.14, 0.14, 0.05, face, 0.18, 0.5, 0.5, g);
  box(0.4, 0.08, 0.05, face, 0, 0.3, 0.5, g);
  g.rotation.y = rand() * 0.8 - 0.4;
  pumpkins.push(g);
}
[[-2.2, -5.6], [2.2, -5.6], [-12.5, -5.4], [-14.6, -5.4], [-3.5, -5.4], [-5.5, -5.4],
 [3, 9], [-3, 9], [9.4, 12.6], [-9.4, 12.8], [0, 15.8, 1.4], [-16, 17], [16, 17]].forEach(([x, z, s]) => pumpkin(x, z, s));

const bats = [];
for (let i = 0; i < 7; i++) {
  const g = new THREE.Group();
  const wingMat = new THREE.MeshBasicMaterial({ color: '#120d18', side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.9, 0.1, 0.25, 0.7, 0, -0.35], 3));
  const L = new THREE.Mesh(wingGeo, wingMat), R = new THREE.Mesh(wingGeo, wingMat);
  R.scale.x = -1;
  mesh(new THREE.SphereGeometry(0.16, 5, 4), wingMat, 0, 0, 0, g);
  g.add(L, R);
  spookyGroup.add(g);
  bats.push({ g, L, R, r: 8 + rand() * 12, y: 12 + rand() * 14, speed: 0.4 + rand() * 0.4, ph: rand() * 6, cx: (rand() - 0.5) * 20, cz: -14 + rand() * 6 });
}

const ghosts = [];
const ghostMat = new THREE.MeshStandardMaterial({ color: '#e9f2ff', emissive: '#b8d6ff', emissiveIntensity: 0.5, transparent: true, opacity: 0.7, flatShading: true });
function ghost() {
  const g = new THREE.Group();
  mesh(new THREE.SphereGeometry(0.55, 8, 6), ghostMat, 0, 1.1, 0, g).castShadow = false;
  const tail = mesh(new THREE.ConeGeometry(0.55, 1.1, 8, 1, true), ghostMat, 0, 0.45, 0, g);
  tail.rotation.x = Math.PI; tail.castShadow = false;
  const eye = new THREE.MeshBasicMaterial({ color: '#1b1830' });
  mesh(new THREE.SphereGeometry(0.08, 5, 4), eye, -0.18, 1.2, 0.48, g);
  mesh(new THREE.SphereGeometry(0.08, 5, 4), eye, 0.18, 1.2, 0.48, g);
  spookyGroup.add(g);
  return g;
}

const witch = (() => {
  const g = new THREE.Group();
  const broom = cyl(0.07, 0.07, 3.2, mat('#7a5a3e'), 0, -1.6, 0, g, 5);
  broom.rotation.z = Math.PI / 2; broom.position.set(0, 0, 0);
  const bristles = mesh(new THREE.ConeGeometry(0.4, 1, 7), mat('#c9a14a'), -2, 0, 0, g);
  bristles.rotation.z = -Math.PI / 2;
  const robe = mesh(new THREE.ConeGeometry(0.55, 1.6, 7), glow('#7b3fb0', 0.4, 1), 0.1, 0.75, 0, g);
  robe.rotation.z = 0.25;
  mesh(new THREE.SphereGeometry(0.33, 8, 6), glow('#7ed36b', 0.3, 0.9), 0.35, 1.7, 0, g);
  const brim = cyl(0.65, 0.65, 0.06, mat('#1b1328'), 0.35, 1.9, 0, g, 10);
  const hat = mesh(new THREE.ConeGeometry(0.38, 1, 8), mat('#1b1328'), 0.25, 2.4, 0, g);
  hat.rotation.z = 0.35;
  const cape = mesh(new THREE.PlaneGeometry(1.3, 1.1), mat('#3b1460', { side: THREE.DoubleSide }), -0.5, 1, 0, g);
  cape.rotation.z = -0.5;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('#b77bff'), transparent: true, depthWrite: false }));
  halo.scale.set(6, 6, 1); halo.position.y = 0.8;
  g.add(halo);
  g.scale.setScalar(1.3);
  g.visible = false;
  scene.add(g);
  return { g, cape, t: -1, next: 4 };
})();

// Low ground fog: soft sprites drifting across the island.
const fogSprites = [];
const fogTex = radialTexture('#cbbbe6');
for (let i = 0; i < 14; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogTex, transparent: true, depthWrite: false, opacity: 0.6 }));
  s.scale.set(16, 5, 1);
  s.position.set((rand() - 0.5) * 44, 0.8 + rand() * 1.2, (rand() - 0.5) * 40);
  spookyGroup.add(s);
  fogSprites.push({ s, speed: 0.4 + rand() * 0.5 });
}

// ---------- residents ----------

const loader = new GLTFLoader();
const noteTex = [textTexture('♪', '#ffd76b'), textTexture('♫', '#9be7ff')];
const PLAZA_SPOTS = [[-6, 9], [6, 9], [-4, 17], [4, 17], [-9, 14], [9, 15], [-1, 18.5], [-13, 15], [13, 13]];

function makeResident(cfg) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const skin = mat(cfg.skin || '#c98e62');
  const shirt = mat(cfg.color || '#888');
  const pants = mat('#2c2b3a');
  const legL = box(0.32, 0.75, 0.32, pants, -0.2, 0, 0, body);
  const legR = box(0.32, 0.75, 0.32, pants, 0.2, 0, 0, body);
  for (const leg of [legL, legR]) { leg.geometry.translate(0, -0.375, 0); leg.position.y = 0.75; }
  const torso = mesh(new THREE.CapsuleGeometry(0.45, 0.6, 3, 8), shirt, 0, 1.3, 0, body);
  const head = mesh(new THREE.IcosahedronGeometry(0.46, 1), skin, 0, 2.2, 0, body);
  const eye = new THREE.MeshBasicMaterial({ color: '#1b1830' });
  mesh(new THREE.BoxGeometry(0.08, 0.12, 0.05), eye, -0.16, 2.24, 0.43, body);
  mesh(new THREE.BoxGeometry(0.08, 0.12, 0.05), eye, 0.16, 2.24, 0.43, body);
  if (cfg.hat) {
    cyl(0.6, 0.6, 0.06, mat(cfg.hat), 0, 2.5, 0.05, body, 12);
    cyl(0.36, 0.4, 0.4, mat(cfg.hat), 0, 2.52, 0, body, 10);
  }
  if (cfg.hairStyle === 'emo') {
    // Long sides and a side fringe swept over one eye.
    const hm = mat(cfg.hair || '#1c1820');
    const hair = mesh(new THREE.IcosahedronGeometry(0.5, 1), hm, 0, 2.38, -0.06, body);
    hair.scale.set(1.04, 0.7, 1.04);
    box(0.14, 0.62, 0.62, hm, -0.44, 1.92, -0.06, body);
    box(0.14, 0.62, 0.62, hm, 0.44, 1.92, -0.06, body);
    const fringe = box(0.52, 0.34, 0.12, hm, -0.14, 2.14, 0.42, body);
    fringe.rotation.z = 0.35;
    if (cfg.hairStreak) box(0.16, 0.08, 0.5, mat(cfg.hairStreak), 0.14, 2.66, 0.02, body);
  } else if (cfg.hair) {
    const hair = mesh(new THREE.IcosahedronGeometry(0.5, 1), mat(cfg.hair), 0, 2.4, -0.06, body);
    hair.scale.set(1, 0.62, 1);
    const fringe = box(0.7, 0.16, 0.2, mat(cfg.hair), 0.08, 2.45, 0.33, body);
    fringe.rotation.z = -0.2;
  }
  if (cfg.prop === 'boombox') {
    const bb = new THREE.Group(); bb.position.set(0.72, 1.05, 0.1); body.add(bb);
    box(0.9, 0.5, 0.3, mat('#2b2a36'), 0, -0.25, 0, bb);
    for (const sx of [-0.24, 0.24]) {
      const sp = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 10), glow('#ff6fb5', 0.4, 1.5), sx, 0, 0.16, bb);
      sp.rotation.x = Math.PI / 2;
    }
    box(0.6, 0.06, 0.06, mat('#8a879c'), 0, 0.28, 0, bb);
  }
  if (cfg.prop === 'pumpkin') {
    // A jack-o'-lantern pail carried at the side.
    const pp = new THREE.Group(); pp.position.set(0.72, 0.75, 0.1); body.add(pp);
    const pail = mesh(new THREE.SphereGeometry(0.3, 10, 7), mat('#e0701f'), 0, 0, 0, pp);
    pail.scale.y = 0.8;
    const handle = mesh(new THREE.TorusGeometry(0.22, 0.025, 4, 10, Math.PI), mat('#3b3f4d'), 0, 0.12, 0, pp);
    handle.rotation.y = Math.PI / 2;
    const face = glow('#ffb13b', 0.6, 3);
    for (const sx of [-0.1, 0.1]) box(0.08, 0.08, 0.04, face, sx, 0.03, 0.27, pp);
    box(0.22, 0.05, 0.04, face, 0, -0.1, 0.27, pp);
  }
  g.scale.setScalar(1.4);
  g.traverse((o) => { o.userData.agentId = cfg.id; });

  // Swap in a Blender model if one is listed and loads.
  if (cfg.model) {
    loader.load(BASE + cfg.model, (gltf) => {
      g.remove(body);
      gltf.scene.traverse((o) => { o.castShadow = true; o.userData.agentId = cfg.id; });
      g.add(gltf.scene);
      g.userData.legs = null;
    }, undefined, () => console.warn('Model not found, keeping blocky', cfg.model));
  }
  g.userData.legs = [legL, legR];
  g.userData.bodyGroup = body;
  return g;
}

let agents = [];
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

function nextTarget(a) {
  const pos = a.obj.position;
  const door = a.house.door;
  if (a.mode === 'working' || a.mode === 'waiting') {
    // Out and about: cross at the crosswalk and wander the plaza.
    if (!a.path.length) {
      const north = pos.z < 0;
      if (north) a.path.push([rand() * 4 - 2, -4.6], [rand() * 4 - 2, 4.8]);
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) a.path.push(PLAZA_SPOTS[Math.floor(rand() * PLAZA_SPOTS.length)]);
      if (a.mode === 'waiting' || rand() < 0.35) a.path.push([rand() * 4 - 2, 4.8], [rand() * 4 - 2, -4.6], [door.x, door.z]);
    }
  } else {
    // Home: potter around the front step.
    if (!a.path.length) {
      if (pos.z > 0) a.path.push([rand() * 4 - 2, 4.8], [rand() * 4 - 2, -4.6]);
      a.path.push([door.x + (rand() * 3 - 1.5), door.z + rand() * 0.8]);
    }
  }
  const [x, z] = a.path.shift();
  a.target.set(x, 0.25, z);
  a.pause = a.mode === 'working' ? 0.4 + rand() : 1.5 + rand() * 3;
}

function updateResident(a, dt, t) {
  const o = a.obj;
  const hidden = a.mode === 'sleeping' || a.mode === 'resting';
  o.visible = !hidden;
  a.house.winMat.userData.on = hidden || a.mode === 'home';
  if (hidden) { a.path.length = 0; o.position.set(a.house.door.x, 0.25, a.house.door.z); return; }

  const legs = o.userData.legs;
  const stuck = a.mode === 'error' || a.mode === 'stuck';
  const d = tmpV.subVectors(a.target, o.position); d.y = 0;
  const dist = d.length();
  let moving = false;
  if (stuck) {
    // Stands still, glancing around.
    o.rotation.y = Math.sin(t * 0.8) * 0.8;
  } else if (dist > 0.1) {
    const speed = a.mode === 'working' ? 3.6 : 1.8;
    o.position.addScaledVector(d.normalize(), Math.min(dist, speed * dt));
    const want = Math.atan2(d.x, d.z);
    o.rotation.y += Math.atan2(Math.sin(want - o.rotation.y), Math.cos(want - o.rotation.y)) * Math.min(1, dt * 10);
    moving = true;
  } else if ((a.pause -= dt) <= 0) {
    nextTarget(a);
  }
  const step = moving ? Math.sin(t * (a.mode === 'working' ? 12 : 8)) : 0;
  if (legs) { legs[0].rotation.x = step * 0.6; legs[1].rotation.x = -step * 0.6; }
  if (o.userData.bodyGroup) o.userData.bodyGroup.position.y = moving ? Math.abs(step) * 0.08 : Math.sin(t * 2 + a.ph) * 0.02;

  // Brenden's boombox puts out music notes.
  if (a.prop === 'boombox' && (a.notesT -= dt) <= 0) {
    a.notesT = a.mode === 'working' ? 0.35 : 0.9;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex[Math.floor(rand() * 2)], transparent: true, depthWrite: false }));
    s.scale.setScalar(0.8);
    s.position.copy(o.position).add(new THREE.Vector3(Math.cos(o.rotation.y) * 0.8, 1.5, -Math.sin(o.rotation.y) * 0.8));
    scene.add(s);
    notes.push({ s, life: 2, vx: (rand() - 0.5) * 0.6 });
  }
}
const tmpV = new THREE.Vector3();
const notes = [];

// ---------- data ----------

async function getJSON(path) {
  const res = await fetch(BASE + path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status + ' ' + path);
  return res.json();
}

const builtPlots = new Map();
async function load() {
  let list;
  try { list = await getJSON('agents.json'); } catch (e) { console.warn(e); return; }
  const next = [];
  for (const cfg of list) {
    const prev = agents.find((a) => a.id === cfg.id);
    let status;
    try { status = await getJSON(cfg.status); } catch { status = prev ? prev.status : { state: 'waiting', summary: 'No status yet.' }; }
    if (prev) { prev.status = status; next.push(prev); continue; }
    const P = PLOTS[cfg.plot] || PLOTS[0];
    const house = townhouse(P, cfg.color || '#6fe3e8');
    builtPlots.set(cfg.plot, house);
    const obj = makeResident(cfg);
    obj.position.set(house.door.x, 0.25, house.door.z);
    town.add(obj);
    next.push({ ...cfg, status, obj, house, path: [], target: obj.position.clone(), pause: rand() * 2, ph: rand() * 6, notesT: 0, mode: 'waiting' });
  }
  agents = next;
  if (!emptyLots.length) PLOTS.forEach((P, i) => { if (!builtPlots.has(i)) emptyLot(P); });
  for (const a of agents) a.news = hasNews(a);
  buildLabels();
  if (openId) openPanel(openId, true);
}

// ---------- labels & panel ----------

const labelsEl = document.getElementById('labels');
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function buildLabels() {
  labelsEl.innerHTML = '';
  for (const a of agents) {
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<span class="bubble"></span><span class="name">${esc(a.name)}</span>`;
    labelsEl.appendChild(el);
    a.label = el;
    a.bubble = el.querySelector('.bubble');
  }
}
const proj = new THREE.Vector3();
function updateLabels(t) {
  for (const a of agents) {
    if (!a.label) continue;
    const sleeping = a.mode === 'sleeping' || a.mode === 'resting';
    if (sleeping) proj.set(a.house.door.x, 7.2, a.house.door.z - 3.6);
    else proj.copy(a.obj.position).setY(4.3);
    proj.project(camera);
    const behind = proj.z > 1;
    a.label.style.display = behind ? 'none' : '';
    a.label.style.left = ((proj.x + 1) / 2 * window.innerWidth) + 'px';
    a.label.style.top = ((1 - proj.y) / 2 * window.innerHeight) + 'px';
    let b = '';
    if (a.mode === 'error' || a.mode === 'stuck') b = '?';
    else if (sleeping) b = 'z' + 'z'.repeat(1 + Math.floor(t * 1.5) % 3);
    else if (a.mode === 'working') b = '.'.repeat(1 + Math.floor(t * 3) % 3);
    else if (a.news) b = '!';
    if (a.bubble.textContent !== b) a.bubble.textContent = b;
    a.bubble.classList.toggle('err', b === '?');
  }
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

const CATEGORY_NAMES = { art: 'Games & tech', ops: 'Operations & inventory', video: 'Video packages', post: 'Community posts', newsletter: 'Newsletter' };
let openId = null;
const panel = document.getElementById('panel');
function openPanel(id, refresh) {
  const a = agents.find((x) => x.id === id);
  if (!a) return;
  const s = a.status || {};
  const [cls, text] = statusLine(a);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  const groups = {};
  for (const it of s.items || []) (groups[it.category] = groups[it.category] || []).push(it);
  let html = `<h2 id="panel-title">${esc(a.name)}</h2><p class="role">${esc(a.title)}</p>
    <span class="state ${cls}">${esc(text)}</span><p class="summary">${esc(s.summary || '')}</p>`;
  for (const [cat, list] of Object.entries(groups)) {
    html += `<strong>${esc(CATEGORY_NAMES[cat] || cat)}</strong><ul>` + list.map((it) => `<li>${it.url
      ? `<a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener">${esc(it.title)}</a>`
      : esc(it.title)}${it.company ? ` · ${esc(it.company)}` : ''}</li>`).join('') + '</ul>';
  }
  html += '<div class="links">';
  for (const l of a.links || []) html += `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label)} →</a>`;
  if (s.report) html += `<a href="${esc(REPO_URL + s.report)}" target="_blank" rel="noopener">Full report →</a>`;
  html += '</div>';
  document.getElementById('panel-body').innerHTML = html;
  panel.hidden = false;
  openId = id;
  if (!refresh) controls.autoRotate = false;
  if (s.lastRun) { try { localStorage.setItem('seen:' + a.id, s.lastRun); } catch { /* storage unavailable */ } }
  a.news = false;
}
document.getElementById('close').addEventListener('click', () => { panel.hidden = true; openId = null; });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { panel.hidden = true; openId = null; } });

// Tap/click picking (ignore drags so spinning the camera doesn't open panels).
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  ptr.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const targets = [];
  for (const a of agents) { if (a.obj.visible) targets.push(a.obj); targets.push(a.house.g); }
  const hit = ray.intersectObjects(targets, true)[0];
  if (!hit) return;
  let id = hit.object.userData.agentId;
  if (!id) id = (agents.find((a) => { let p = hit.object; while (p) { if (p === a.house.g) return true; p = p.parent; } return false; }) || {}).id;
  if (id) openPanel(id);
});

// ---------- the clock: light, sky, season ----------

const clockEl = document.getElementById('clock');
const skyCol = new THREE.Color();
let spooky = false;
function applyTime(now, t) {
  const h = now.getHours() + now.getMinutes() / 60;
  spooky = eventOf(now) === 'halloween';
  document.body.classList.toggle('halloween', spooky);
  spookyGroup.visible = spooky;

  skyAt(spooky ? SKY_SPOOKY : SKY_NORMAL, h, skyCol);
  scene.background.copy(skyCol);
  scene.fog.color.copy(skyCol);
  scene.fog.near = spooky ? 45 : 70;
  scene.fog.far = spooky ? 140 : 170;

  // Sun arc: up at 6, peak at noon, down at 18.
  const ang = ((h - 6) / 12) * Math.PI;
  const elev = Math.sin(ang);
  const day = THREE.MathUtils.clamp(elev * 2.5, 0, 1);
  const night = 1 - THREE.MathUtils.clamp(elev * 3 + 0.25, 0, 1);
  sun.position.set(Math.cos(ang) * 60, Math.max(elev, 0.05) * 70, 30);
  sun.intensity = day * (spooky ? 1.5 : 2.3);
  sun.color.set(elev < 0.35 ? '#ffb27a' : '#fff1dc');
  hemi.intensity = 0.4 + day * 0.45;
  hemi.color.set(spooky ? '#c7b3e6' : '#cfe3ff');

  const ma = ang + Math.PI;
  // The camera looks down on the island, so the moon sits low and far off to the left
  // where it shows against the open sky beside the skyline.
  moon.position.set(-125 + Math.cos(ma) * 10, 8 + Math.max(Math.sin(ma), 0) * 6, -45);
  moonHalo.position.copy(moon.position);
  moon.visible = moonHalo.visible = night > 0.05;
  moon.material.color.set(spooky ? '#ffe2a0' : '#f4efd8');
  moon.scale.setScalar(spooky ? 1.5 : 1);
  moonLight.position.set(-40, 60, -40);
  moonLight.intensity = night * (spooky ? 0.7 : 0.45);
  moonLight.color.set(spooky ? '#b3a1ff' : '#9fb4ff');
  stars.material.opacity = night * 0.9;

  for (const g of glows) g.m.emissiveIntensity = g.base + (g.night - g.base) * night;
  for (const a of agents) a.house.winMat.emissiveIntensity = a.house.winMat.userData.on ? 0.2 + night * 2 : 0.05;
  plazaLight.intensity = night * (spooky ? 60 : 45);
  plazaLight.color.set(spooky ? '#ff8a3a' : '#ffb36b');
  streetLight.intensity = night * 35;
  renderer.toneMappingExposure = spooky ? 0.95 : 1.05;

  for (const { canopy, i } of trees) canopy.material.color.set(spooky ? ['#b8541f', '#7a2f4a', '#d38b2a'][i % 3] : ['#3e8f6a', '#4f9d5b', '#2f7d6e'][i % 3]);
  for (const l of emptyLots) { l.normal.visible = !spooky; l.spooky.visible = spooky; }

  const label = now.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  clockEl.textContent = spooky ? `🎃 Spooky season · ${label}` : label;
  return { night };
}

// ---------- spooky motion ----------

let ghostObjs = null;
function updateSpooky(dt, t, night) {
  if (!ghostObjs) ghostObjs = emptyLots.map(() => ghost());
  ghostObjs.forEach((g, i) => {
    const l = emptyLots[i];
    if (!l) return;
    g.position.set(l.P.x + Math.sin(t * 0.5 + i) * 2.2, 0.6 + Math.sin(t * 1.3 + i) * 0.35, l.P.z + Math.cos(t * 0.4 + i) * 1.4);
    g.rotation.y = Math.sin(t * 0.5 + i) * 0.6;
    ghostMat.opacity = 0.35 + night * 0.4;
  });
  for (const b of bats) {
    const a = t * b.speed + b.ph;
    b.g.position.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(a * 2) * 1.5, b.cz + Math.sin(a) * b.r * 0.6);
    b.g.rotation.y = -a;
    const flap = Math.sin(t * 18 + b.ph) * 0.8;
    b.L.rotation.z = flap; b.R.rotation.z = -flap;
    b.g.visible = night > 0.2 || FORCE_WITCH;
  }
  for (const f of fogSprites) {
    f.s.position.x += f.speed * dt;
    if (f.s.position.x > 26) f.s.position.x = -26;
    f.s.material.opacity = 0.25 + night * 0.4;
  }
  for (const p of pumpkins) p.children[0].scale.y = 0.78 + Math.sin(t * 3 + p.position.x) * 0.01;

  // The witch: every so often (always with ?witch=1), she crosses the sky.
  const w = witch;
  if (w.t < 0) {
    w.next -= dt;
    w.g.visible = false;
    if ((night > 0.3 || FORCE_WITCH) && w.next <= 0) { w.t = 0; w.dir = rand() < 0.5 ? 1 : -1; }
  } else {
    w.t += dt / 11;
    const x = THREE.MathUtils.lerp(-60, 60, w.t) * w.dir;
    w.g.position.set(x, 24 + Math.sin(w.t * Math.PI) * 8, -6 + Math.sin(w.t * Math.PI * 2) * 10);
    w.g.rotation.y = w.dir > 0 ? 0 : Math.PI;
    w.g.rotation.z = Math.sin(t * 2) * 0.08;
    w.cape.rotation.z = -0.5 + Math.sin(t * 9) * 0.15;
    w.g.visible = true;
    if (w.t >= 1) { w.t = -1; w.next = FORCE_WITCH ? 1.5 : 35 + rand() * 40; }
  }
}

// ---------- main loop ----------

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = clockNow();
  for (const a of agents) a.mode = modeOf(a, now);
  const { night } = applyTime(now, t);

  for (const c of cars) {
    c.x += c.dir * c.speed * dt;
    if (c.x > S + 4) c.x = -S - 4; else if (c.x < -S - 4) c.x = S + 4;
    const edge = THREE.MathUtils.clamp((S + 2 - Math.abs(c.x)) / 3, 0, 1); // shrink away off the island edge
    c.g.scale.setScalar(Math.max(edge, 0.001));
    c.g.position.set(c.x, 1.1 + Math.sin(t * 3 + c.ph) * 0.12, c.z);
  }
  for (const d of drones) {
    const a = t * d.speed + d.ph;
    d.g.position.set(Math.cos(a) * d.r, d.y + Math.sin(a * 3) * 0.6, Math.sin(a) * d.r * 0.7 + 2);
    d.light.visible = Math.sin(t * 6 + d.ph) > 0;
  }
  for (const b of blinkers) b.o.visible = Math.sin(t * 2.5 + b.ph) > 0.2;
  holoRing.rotation.set(Math.PI / 2 + Math.sin(t) * 0.3, t * 1.2, 0);
  holoRing2.rotation.set(Math.PI / 2, 0, -t * 1.8);
  holo.rotation.y = t * 1.5; holo.position.y = 3.4 + Math.sin(t * 2) * 0.2;
  billboard.material.opacity = 0.55 + Math.sin(t * 5) * 0.05 + (Math.sin(t * 0.7) > 0.97 ? -0.4 : 0);
  lantern.scale.setScalar(1 + Math.sin(t * 7) * 0.04);

  for (const a of agents) updateResident(a, dt, t);
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.life -= dt;
    n.s.position.y += dt * 0.9; n.s.position.x += n.vx * dt;
    n.s.material.opacity = Math.max(0, n.life / 2);
    if (n.life <= 0) { scene.remove(n.s); n.s.material.dispose(); notes.splice(i, 1); }
  }
  if (spooky) updateSpooky(dt, t, night);

  controls.update();
  renderer.render(scene, camera);
  updateLabels(t);
  requestAnimationFrame(frame);
}

load();
setInterval(load, 60000);
requestAnimationFrame(frame);
