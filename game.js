'use strict';
/* Tiberian Skirmish – a tiny Command & Conquer-style RTS prototype (Canvas, no dependencies). */
(() => {
const TILE = 32, MAP = 64, W = MAP, H = MAP;
const VW = 960, VH = 600;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');

const DEFS = {
  yard:      { name: 'Construction Yard', w: 3, h: 3, hp: 1500 },
  refinery:  { name: 'Refinery',          w: 3, h: 2, hp: 900 },
  factory:   { name: 'War Factory',       w: 3, h: 2, hp: 1000, cost: 800, time: 10 },
  tank:      { name: 'Tank',      hp: 220, speed: 75, r: 11, range: 150, sight: 224, dmg: 22, cool: 0.9, cost: 400, time: 8 },
  harvester: { name: 'Harvester', hp: 260, speed: 55, r: 12, cost: 500, time: 10, cap: 200, rate: 22 },
};
const COLORS = ['#3b8bff', '#ff4b3b'];
const START_CREDITS = 2000;
const PLACE_RANGE = 8;

// ---------------------------------------------------------------- map generation
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const idx = (x, y) => y * W + x;
const mirrorIdx = i => { const x = i % W, y = (i / W) | 0; return idx(W - 1 - x, H - 1 - y); };

const rockBase = new Uint8Array(W * H);
const crystalBase = new Float32Array(W * H);
const grassNoise = new Float32Array(W * H);
(function genMap() {
  const rnd = mulberry32(1337);
  for (let i = 0; i < W * H; i++) grassNoise[i] = rnd();
  const nearBase = (x, y) => (Math.hypot(x - 6, y - 57) < 13) || (Math.hypot(x - 57, y - 6) < 13);
  const blob = (cx, cy, r, fn) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (Math.hypot(x - cx, y - cy) <= r * (0.75 + rnd() * 0.35)) fn(x, y);
    }
  };
  // crystal fields (player half; mirrored for the enemy) + neutral centre field
  const fields = [[14, 53, 3.2], [8, 44, 2.6], [22, 40, 2.4]];
  for (const [cx, cy, r] of fields) blob(cx, cy, r, (x, y) => { crystalBase[idx(x, y)] = 300 + Math.floor(rnd() * 400); });
  blob(32, 31, 3.5, (x, y) => { crystalBase[idx(x, y)] = 300 + Math.floor(rnd() * 400); });
  // rocks
  let placed = 0, tries = 0;
  while (placed < 14 && tries++ < 400) {
    const cx = 4 + rnd() * 56, cy = 20 + rnd() * 40, r = 1.2 + rnd() * 2.2;
    if (nearBase(cx, cy) || Math.hypot(cx - 32, cy - 32) < 8) continue;
    let bad = false;
    for (const [fx, fy, fr] of fields) if (Math.hypot(cx - fx, cy - fy) < r + fr + 2 || Math.hypot(cx - (63 - fx), cy - (63 - fy)) < r + fr + 2) bad = true;
    if (bad) continue;
    placed++;
    blob(cx, cy, r, (x, y) => { rockBase[idx(x, y)] = 1; });
  }
  // symmetrise: mirror everything from the "player half" onto the other half
  for (let i = 0; i < W * H; i++) {
    const m = mirrorIdx(i);
    if (rockBase[i]) rockBase[m] = 1;
    if (crystalBase[i] > 0) crystalBase[m] = crystalBase[i];
  }
  // rocks never overlap crystals
  for (let i = 0; i < W * H; i++) if (rockBase[i]) crystalBase[i] = 0;
})();

// pre-rendered terrain
const terrain = document.createElement('canvas');
terrain.width = W * TILE; terrain.height = H * TILE;
(function drawTerrain() {
  const t = terrain.getContext('2d');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = grassNoise[idx(x, y)];
    t.fillStyle = `rgb(${50 + n * 18 | 0},${92 + n * 28 | 0},${44 + n * 14 | 0})`;
    t.fillRect(x * TILE, y * TILE, TILE, TILE);
    if (n > 0.8) { t.fillStyle = 'rgba(20,50,20,.35)'; t.fillRect(x * TILE + n * 20, y * TILE + (1 - n) * 90, 3, 3); }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!rockBase[idx(x, y)]) continue;
    const n = grassNoise[idx(x, y)];
    t.fillStyle = `rgb(${95 + n * 30 | 0},${95 + n * 30 | 0},${100 + n * 30 | 0})`;
    t.beginPath(); t.roundRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2, 8); t.fill();
    t.fillStyle = 'rgba(255,255,255,.15)'; t.beginPath(); t.roundRect(x * TILE + 5, y * TILE + 4, 14, 8, 4); t.fill();
    t.strokeStyle = 'rgba(0,0,0,.35)'; t.lineWidth = 2; t.beginPath(); t.roundRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2, 8); t.stroke();
  }
})();
const miniTerrain = document.createElement('canvas');
miniTerrain.width = miniTerrain.height = 160;
miniTerrain.getContext('2d').drawImage(terrain, 0, 0, 160, 160);

// ---------------------------------------------------------------- state
let G = null;
let speedMul = 1, paused = false;

function newGame() {
  G = {
    t: 0, over: null,
    credits: [START_CREDITS, START_CREDITS],
    units: [], buildings: [], projs: [], fx: [],
    crystal: Float32Array.from(crystalBase),
    rock: rockBase,
    bgrid: new Array(W * H).fill(null),
    cam: { x: 0, y: 0 },
    selected: [], placing: null,
    ai: { next: 1, waveSize: 5, lastWave: 0, waves: 0 },
    msgText: '', msgT: 0,
  };
  // player base bottom-left, enemy top-right (mirrored)
  const base = (team, m) => {
    const R = (x, y, w, h) => m ? [W - x - w, H - y - h] : [x, y];
    let p = R(3, 56, 3, 3); addBuilding(team, 'yard', p[0], p[1], true);
    p = R(7, 57, 3, 2); addBuilding(team, 'refinery', p[0], p[1], true);
    const hv = spawnUnit(team, 'harvester', (m ? W - 8 : 8) * TILE, (m ? H - 55 : 55) * TILE + 16);
    hv.hs = 'seek';
  };
  base(0, false); base(1, true);
  const y0 = G.buildings[0];
  G.cam.x = clamp(y0.x - VW / 2, 0, W * TILE - VW);
  G.cam.y = clamp(y0.y - VH / 2, 0, H * TILE - VH);
  document.getElementById('overlay').classList.add('hidden');
  say('Build a War Factory, then Tanks. Destroy the red Construction Yard!');
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function say(t) { G.msgText = t; G.msgT = 5; document.getElementById('msg').textContent = t; }

// ---------------------------------------------------------------- entities
function addBuilding(team, type, tx, ty, instant) {
  const d = DEFS[type];
  const b = { kind: 'b', type, team, tx, ty, w: d.w, h: d.h, rx: tx * TILE, ry: ty * TILE, rw: d.w * TILE, rh: d.h * TILE,
    x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE, hp: d.hp, maxhp: d.hp, done: !!instant, prog: instant ? 1 : 0, queue: [], dead: false, sel: false };
  G.buildings.push(b);
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) G.bgrid[idx(x, y)] = b;
  return b;
}
function spawnUnit(team, type, x, y) {
  const d = DEFS[type];
  const u = { kind: 'u', type, team, x, y, r: d.r, hp: d.hp, maxhp: d.hp, angle: team ? Math.PI * 0.75 : -Math.PI * 0.25, tAngle: 0,
    order: null, target: null, path: null, pi: 0, cool: Math.random() * 0.5, scanT: 0, stuckT: 0, rp: 0, repathCd: 0, chaseT: 0, sel: false, dead: false,
    cargo: 0, hs: null, ct: -1, ut: 0, wave: false, seekCd: 0 };
  u.tAngle = u.angle;
  G.units.push(u);
  return u;
}
function kill(e) {
  if (e.dead) return;
  e.dead = true;
  boom(e.x, e.y, e.kind === 'b' ? Math.max(e.rw, e.rh) * 0.9 : 26);
  if (e.kind === 'b') {
    for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (G.bgrid[idx(x, y)] === e) G.bgrid[idx(x, y)] = null;
    for (let i = 0; i < 3; i++) boom(e.x + (Math.random() - .5) * e.rw, e.y + (Math.random() - .5) * e.rh, 28, i * 0.12);
  }
  if (e.sel) G.selected = G.selected.filter(s => s !== e);
}
function hurt(e, dmg) { if (e.dead) return; e.hp -= dmg; if (e.hp <= 0) kill(e); }
function boom(x, y, r, delay = 0) { G.fx.push({ x, y, r, t: -delay, life: 0.5 }); }

// ---------------------------------------------------------------- grid helpers
const tileOf = v => Math.floor(v / TILE);
function blockedTile(tx, ty) { if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true; const i = idx(tx, ty); return !!G.rock[i] || !!G.bgrid[i]; }
function blockedPx(x, y) { return blockedTile(tileOf(x), tileOf(y)); }
function nearestFree(tx, ty) {
  tx = clamp(tx, 0, W - 1); ty = clamp(ty, 0, H - 1);
  if (!blockedTile(tx, ty)) return [tx, ty];
  for (let r = 1; r < 12; r++) {
    let best = null, bd = 1e9;
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r || blockedTile(x, y)) continue;
      const d = Math.hypot(x - tx, y - ty); if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) return best;
  }
  return null;
}
function distToEntity(x, y, e) {
  if (e.kind === 'b') {
    const dx = Math.max(e.rx - x, 0, x - (e.rx + e.rw)), dy = Math.max(e.ry - y, 0, y - (e.ry + e.rh));
    return Math.hypot(dx, dy);
  }
  return Math.hypot(e.x - x, e.y - y) - e.r;
}

// ---------------------------------------------------------------- A*
const gS = new Float32Array(W * H), came = new Int32Array(W * H), openSt = new Uint32Array(W * H), closedSt = new Uint32Array(W * H);
let stampN = 0;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function heapPush(h, f, i) { h.push([f, i]); let c = h.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (h[p][0] <= h[c][0]) break; [h[p], h[c]] = [h[c], h[p]]; c = p; } }
function heapPop(h) { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let c = 0; for (;;) { let l = c * 2 + 1, r = l + 1, m = c; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === c) break; [h[m], h[c]] = [h[c], h[m]]; c = m; } } return top; }
function astar(sx, sy, gx, gy) {
  stampN++;
  const open = [], si = idx(sx, sy), gi = idx(gx, gy);
  gS[si] = 0; came[si] = -1; openSt[si] = stampN;
  const oct = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  heapPush(open, oct(sx, sy), si);
  while (open.length) {
    const [, ci] = heapPop(open);
    if (closedSt[ci] === stampN) continue;
    closedSt[ci] = stampN;
    if (ci === gi) { const out = []; for (let c = gi; c !== -1; c = came[c]) out.push([c % W, (c / W) | 0]); return out.reverse(); }
    const cx = ci % W, cy = (ci / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (blockedTile(nx, ny)) continue;
      if (dx && dy && (blockedTile(cx + dx, cy) || blockedTile(cx, cy + dy))) continue;
      const ni = idx(nx, ny);
      if (closedSt[ni] === stampN) continue;
      const ng = gS[ci] + (dx && dy ? 1.414 : 1);
      if (openSt[ni] !== stampN || ng < gS[ni]) { openSt[ni] = stampN; gS[ni] = ng; came[ni] = ci; heapPush(open, ng + oct(nx, ny), ni); }
    }
  }
  return null;
}
function los(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 8);
  for (let s = 1; s <= n; s++) {
    const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n;
    if (blockedPx(x - 9, y - 9) || blockedPx(x + 9, y - 9) || blockedPx(x - 9, y + 9) || blockedPx(x + 9, y + 9)) return false;
  }
  return true;
}
function findPath(u, x, y) {
  const g = nearestFree(tileOf(x), tileOf(y)); if (!g) return null;
  const st = [clamp(tileOf(u.x), 0, W - 1), clamp(tileOf(u.y), 0, H - 1)];
  const tiles = astar(st[0], st[1], g[0], g[1]); if (!tiles) return null;
  const pts = [{ x: u.x, y: u.y }];
  for (let i = 1; i < tiles.length; i++) pts.push({ x: (tiles[i][0] + .5) * TILE, y: (tiles[i][1] + .5) * TILE });
  if (g[0] === tileOf(x) && g[1] === tileOf(y) && pts.length > 1) pts[pts.length - 1] = { x, y };
  else if (pts.length === 1) pts.push({ x: (g[0] + .5) * TILE, y: (g[1] + .5) * TILE });
  const out = []; let i = 0;
  while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !los(pts[i].x, pts[i].y, pts[j].x, pts[j].y)) j--; out.push(pts[j]); i = j; }
  return out;
}

// ---------------------------------------------------------------- movement
function followPath(u, dt) {
  const wp = u.path[u.pi];
  if (blockedPx(wp.x, wp.y) && u.pi < u.path.length - 1) return 'blocked';
  const dx = wp.x - u.x, dy = wp.y - u.y, d = Math.hypot(dx, dy), step = DEFS[u.type].speed * dt;
  if (d <= step + 0.5) { u.x = wp.x; u.y = wp.y; u.pi++; if (u.pi >= u.path.length) { u.path = null; return 'arrived'; } return 'moving'; }
  const ox = u.x, oy = u.y;
  const nx = u.x + dx / d * step, ny = u.y + dy / d * step;
  if (!blockedPx(nx, u.y)) u.x = nx;
  if (!blockedPx(u.x, ny)) u.y = ny;
  u.angle = Math.atan2(dy, dx);
  if (Math.hypot(u.x - ox, u.y - oy) < step * 0.25) { u.stuckT += dt; if (u.stuckT > 0.7) { u.stuckT = 0; return 'stuck'; } } else u.stuckT = 0;
  return 'moving';
}
function goTo(u, x, y, dt) {
  if (!u.path) {
    if (u.repathCd > 0) { u.repathCd -= dt; return 'moving'; }
    const p = findPath(u, x, y);
    if (!p) { u.repathCd = 0.6; return 'fail'; }
    u.path = p; u.pi = 0; u.stuckT = 0;
  }
  const r = followPath(u, dt);
  if (r === 'arrived') return 'arrived';
  if (r === 'blocked' || r === 'stuck') {
    u.path = null; u.rp++;
    if (Math.hypot(x - u.x, y - u.y) < 70 || u.rp > 5) return 'arrived';
  }
  return 'moving';
}
function separate() {
  const us = G.units;
  for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
    const a = us[i], b = us[j];
    const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
    if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
    let d = Math.hypot(dx, dy); if (d >= min) continue;
    let nx, ny; if (d < 0.01) { nx = Math.random() - .5; ny = Math.random() - .5; d = Math.hypot(nx, ny); nx /= d; ny /= d; } else { nx = dx / d; ny = dy / d; }
    const p = (min - d) * 0.35;
    if (!blockedPx(a.x - nx * p, a.y - ny * p)) { a.x -= nx * p; a.y -= ny * p; }
    if (!blockedPx(b.x + nx * p, b.y + ny * p)) { b.x += nx * p; b.y += ny * p; }
  }
}

// ---------------------------------------------------------------- unit AI
function findEnemy(u, range) {
  let best = null, bs = 1e9;
  for (const e of G.units) { if (e.dead || e.team === u.team) continue; const d = distToEntity(u.x, u.y, e); if (d > range) continue; const s = d * (e.type === 'tank' ? 0.7 : 1); if (s < bs) { bs = s; best = e; } }
  for (const e of G.buildings) { if (e.dead || e.team === u.team) continue; const d = distToEntity(u.x, u.y, e); if (d > range) continue; if (d * 1.15 < bs) { bs = d * 1.15; best = e; } }
  return best;
}
function setMove(u, x, y, amove) {
  u.order = { t: amove ? 'amove' : 'move', x, y }; u.path = null; u.target = null; u.rp = 0; u.repathCd = 0;
  if (u.type === 'harvester') u.hs = null;
}
function setAttack(u, target) { u.order = { t: 'attack', target }; u.path = null; u.target = target; u.rp = 0; u.repathCd = 0; u.chaseT = 0; }

function updateTank(u, dt) {
  const D = DEFS.tank, o = u.order;
  u.cool -= dt; u.scanT -= dt; u.chaseT -= dt;
  if (u.target && u.target.dead) { u.target = null; u.path = null; }
  if (o && o.t === 'attack') { if (o.target.dead) { u.order = null; u.target = null; } else u.target = o.target; }
  else if (!o || o.t === 'amove') {
    if (!u.target && u.scanT <= 0) { u.scanT = 0.25; u.target = findEnemy(u, D.sight); u.path = null; u.chaseT = 0; }
  } else u.target = null;
  if (u.target) {
    const t = u.target, d = distToEntity(u.x, u.y, t);
    const forced = u.order && u.order.t === 'attack';
    if (!forced && d > D.sight * 1.6) { u.target = null; u.path = null; return; }
    u.tAngle = Math.atan2(t.y - u.y, t.x - u.x);
    if (d <= D.range) {
      u.path = null;
      if (u.cool <= 0) {
        u.cool = D.cool;
        const mx = u.x + Math.cos(u.tAngle) * 18, my = u.y + Math.sin(u.tAngle) * 18;
        G.projs.push({ x: mx, y: my, target: t, tx: t.x, ty: t.y, dmg: D.dmg, team: u.team });
        G.fx.push({ x: mx, y: my, r: 7, t: 0, life: 0.12, flash: true });
      }
    } else {
      if (u.chaseT <= 0) { u.path = null; u.chaseT = 0.7; }
      const ex = t.kind === 'b' ? t.x : t.x, ey = t.y;
      const r = goTo(u, ex, ey, dt);
      if (r === 'arrived' && distToEntity(u.x, u.y, t) > D.range) { u.chaseT = 0; }
    }
    return;
  }
  if (o && (o.t === 'move' || o.t === 'amove')) {
    u.tAngle = u.angle;
    const r = goTo(u, o.x, o.y, dt);
    if (r === 'arrived') { u.order = null; u.path = null; }
  }
}

function nearestCrystal(u) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < W * H; i++) {
    if (G.crystal[i] <= 0) continue;
    const x = (i % W + .5) * TILE, y = ((i / W | 0) + .5) * TILE;
    let d = Math.hypot(x - u.x, y - u.y);
    for (const o of G.units) if (o !== u && o.type === 'harvester' && o.team === u.team && o.ct === i && (o.hs === 'goto' || o.hs === 'harvest')) d += 70;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function nearestDepot(u) {
  let best = null, bd = 1e9;
  for (const b of G.buildings) { if (b.dead || b.team !== u.team || !b.done || (b.type !== 'refinery' && b.type !== 'yard')) continue; const d = Math.hypot(b.x - u.x, b.y - u.y) - (b.type === 'refinery' ? 40 : 0); if (d < bd) { bd = d; best = b; } }
  return best;
}
function adjacentTile(b, u) {
  let best = null, bd = 1e9;
  for (let y = b.ty - 1; y <= b.ty + b.h; y++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) {
    if (x >= b.tx && x < b.tx + b.w && y >= b.ty && y < b.ty + b.h) continue;
    if (blockedTile(x, y)) continue;
    const d = Math.hypot((x + .5) * TILE - u.x, (y + .5) * TILE - u.y); if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}
function updateHarvester(u, dt) {
  const D = DEFS.harvester, o = u.order;
  if (o && o.t !== 'attack') {
    const r = goTo(u, o.x, o.y, dt);
    if (r !== 'moving') { u.order = null; u.path = null; u.hs = u.cargo > 0 && u.cargo >= D.cap ? 'return' : 'seek'; }
    return;
  }
  if (o) u.order = null;
  if (!u.hs) u.hs = 'seek';
  switch (u.hs) {
    case 'seek': {
      u.seekCd -= dt; if (u.seekCd > 0) return;
      if (u.cargo >= D.cap - 0.5) { u.hs = 'return'; u.dest = null; u.path = null; return; }
      const c = nearestCrystal(u);
      if (c < 0) { u.seekCd = 1; if (u.cargo > 0) { u.hs = 'return'; u.dest = null; u.path = null; } return; }
      u.ct = c; u.hs = 'goto'; u.path = null; u.rp = 0; return;
    }
    case 'goto': {
      if (G.crystal[u.ct] <= 0) { u.hs = 'seek'; u.seekCd = 0; return; }
      const cx = (u.ct % W + .5) * TILE, cy = ((u.ct / W | 0) + .5) * TILE;
      const r = goTo(u, cx, cy, dt);
      if (r === 'arrived') { if (Math.hypot(u.x - cx, u.y - cy) < 36) u.hs = 'harvest'; else { u.hs = 'seek'; u.seekCd = 0.3; } }
      return;
    }
    case 'harvest': {
      if (G.crystal[u.ct] <= 0) { u.hs = u.cargo >= D.cap - 0.5 ? 'return' : 'seek'; u.seekCd = 0; u.dest = null; return; }
      const amt = Math.min(D.rate * dt, G.crystal[u.ct], D.cap - u.cargo);
      G.crystal[u.ct] -= amt; u.cargo += amt;
      if (G.crystal[u.ct] < 0.5) G.crystal[u.ct] = 0;
      if (u.cargo >= D.cap - 0.5) { u.hs = 'return'; u.dest = null; u.path = null; }
      return;
    }
    case 'return': {
      const dep = nearestDepot(u);
      if (!dep) { u.seekCd = 1; return; }
      if (distToEntity(u.x, u.y, dep) <= 40) { u.hs = 'unload'; u.ut = 1.2; u.path = null; return; }
      if (!u.dest) { const a = adjacentTile(dep, u); if (!a) return; u.dest = { x: (a[0] + .5) * TILE, y: (a[1] + .5) * TILE }; u.rp = 0; }
      const r = goTo(u, u.dest.x, u.dest.y, dt);
      if (r === 'arrived') { if (distToEntity(u.x, u.y, dep) <= 44) { u.hs = 'unload'; u.ut = 1.2; u.path = null; } else u.dest = null; }
      return;
    }
    case 'unload': {
      u.ut -= dt;
      if (u.ut <= 0) { G.credits[u.team] += Math.floor(u.cargo); u.cargo = 0; u.hs = 'seek'; u.seekCd = 0; u.dest = null; }
      return;
    }
  }
}

// ---------------------------------------------------------------- production & placement
function canPlace(team, type, tx, ty) {
  const d = DEFS[type];
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = idx(x, y);
    if (G.rock[i] || G.bgrid[i] || G.crystal[i] > 0) return false;
  }
  for (let y = ty - 1; y <= ty + d.h; y++) for (let x = tx - 1; x <= tx + d.w; x++) if (x >= 0 && y >= 0 && x < W && y < H && G.bgrid[idx(x, y)]) return false; // keep 1-tile gaps
  for (const u of G.units) { if (u.x > (tx - 0.4) * TILE && u.x < (tx + d.w + 0.4) * TILE && u.y > (ty - 0.4) * TILE && u.y < (ty + d.h + 0.4) * TILE) return false; }
  let near = false;
  for (const b of G.buildings) {
    if (b.dead || b.team !== team || !b.done) continue;
    const gx = Math.max(b.tx - (tx + d.w), tx - (b.tx + b.w), 0), gy = Math.max(b.ty - (ty + d.h), ty - (b.ty + b.h), 0);
    if (Math.max(gx, gy) <= PLACE_RANGE) { near = true; break; }
  }
  return near;
}
function placeBuilding(team, type, tx, ty) {
  const cost = DEFS[type].cost;
  if (G.credits[team] < cost) { if (team === 0) say('Not enough credits.'); return null; }
  if (!canPlace(team, type, tx, ty)) { if (team === 0) say('Cannot build there.'); return null; }
  G.credits[team] -= cost;
  return addBuilding(team, type, tx, ty, false);
}
function producersFor(team, type) {
  const want = type === 'tank' ? 'factory' : 'yard';
  return G.buildings.filter(b => !b.dead && b.team === team && b.done && b.type === want);
}
function queueUnit(team, type, preferred) {
  const ps = producersFor(team, type);
  if (!ps.length) { if (team === 0) say(type === 'tank' ? 'Build a War Factory first.' : 'No Construction Yard.'); return false; }
  if (G.credits[team] < DEFS[type].cost) { if (team === 0) say('Not enough credits.'); return false; }
  let p = preferred && ps.includes(preferred) ? preferred : ps.slice().sort((a, b) => a.queue.length - b.queue.length)[0];
  if (p.queue.length >= 5) { if (team === 0) say('Queue is full.'); return false; }
  G.credits[team] -= DEFS[type].cost;
  p.queue.push({ type, prog: 0 });
  return true;
}
function spawnFromBuilding(b, type) {
  const toC = Math.atan2(H * TILE / 2 - b.y, W * TILE / 2 - b.x);
  for (let ring = 1; ring <= 3; ring++) {
    const cands = [];
    for (let y = b.ty - ring; y <= b.ty + b.h - 1 + ring; y++) for (let x = b.tx - ring; x <= b.tx + b.w - 1 + ring; x++) {
      if (x > b.tx - ring && x < b.tx + b.w - 1 + ring && y > b.ty - ring && y < b.ty + b.h - 1 + ring) continue;
      if (blockedTile(x, y)) continue;
      const px = (x + .5) * TILE, py = (y + .5) * TILE;
      if (G.units.some(o => Math.hypot(o.x - px, o.y - py) < 22)) continue;
      cands.push([px, py, Math.abs(Math.atan2(py - b.y, px - b.x) - toC)]);
    }
    if (cands.length) {
      cands.sort((a, c) => a[2] - c[2]);
      const u = spawnUnit(b.team, type, cands[0][0], cands[0][1]);
      if (type === 'harvester') u.hs = 'seek';
      else {
        const rx = u.x + Math.cos(toC) * 3.5 * TILE + (Math.random() - .5) * 90, ry = u.y + Math.sin(toC) * 3.5 * TILE + (Math.random() - .5) * 90;
        setMove(u, clamp(rx, 40, W * TILE - 40), clamp(ry, 40, H * TILE - 40));
      }
      return u;
    }
  }
  return null;
}
function updateBuildings(dt) {
  for (const b of G.buildings) {
    if (b.dead) continue;
    if (!b.done) {
      b.prog += dt / DEFS[b.type].time;
      if (b.prog >= 1) { b.prog = 1; b.done = true; if (b.team === 0) say(DEFS[b.type].name + ' ready.'); }
      continue;
    }
    if (b.queue.length) {
      const q = b.queue[0];
      q.prog += dt / DEFS[q.type].time;
      if (q.prog >= 1) { if (spawnFromBuilding(b, q.type)) b.queue.shift(); else q.prog = 1; }
    }
  }
}

// ---------------------------------------------------------------- enemy commander
function aiThink() {
  const A = G.ai, T = 1;
  const mine = G.buildings.filter(b => !b.dead && b.team === T);
  const yard = mine.find(b => b.type === 'yard');
  if (!yard) return;
  const factories = mine.filter(b => b.type === 'factory');
  const harvs = G.units.filter(u => !u.dead && u.team === T && u.type === 'harvester').length;
  const qh = yard.queue.filter(q => q.type === 'harvester').length;
  if (harvs + qh < (G.t > 200 ? 3 : 2) && G.credits[T] >= DEFS.harvester.cost) queueUnit(T, 'harvester');
  const wantFactories = G.t > 160 ? 2 : 1;
  if (factories.length < wantFactories && G.credits[T] >= DEFS.factory.cost + (factories.length ? 300 : 0)) aiPlaceFactory(yard);
  for (const f of factories) if (f.done && f.queue.length < 2 && G.credits[T] >= DEFS.tank.cost) queueUnit(T, 'tank', f);
  const tanks = G.units.filter(u => !u.dead && u.team === T && u.type === 'tank');
  const army = tanks.filter(u => !u.wave);
  // defend the base
  let threat = null;
  for (const e of G.units) if (!e.dead && e.team === 0 && Math.hypot(e.x - yard.x, e.y - yard.y) < 11 * TILE) { threat = e; break; }
  if (threat) for (const u of army) if (!u.target && (!u.order || u.order.t === 'move')) setMove(u, threat.x, threat.y, true);
  // attack waves
  if (G.t >= 110 && G.t - A.lastWave > 40 && army.length >= A.waveSize) {
    const tgt = G.buildings.find(b => !b.dead && b.team === 0 && b.type === 'yard') || G.buildings.find(b => !b.dead && b.team === 0);
    if (tgt) {
      for (const u of army) { u.wave = true; setMove(u, tgt.x, tgt.y, true); }
      A.lastWave = G.t; A.waves++; A.waveSize = Math.min(A.waveSize + 2, 14);
      say(`Enemy attack wave #${A.waves} incoming (${army.length} tanks)!`);
    }
  }
  // wave units that went idle keep hunting
  for (const u of tanks) if (u.wave && !u.order && !u.target) {
    let best = null, bd = 1e9;
    for (const e of G.buildings.concat(G.units)) if (!e.dead && e.team === 0) { const d = Math.hypot(e.x - u.x, e.y - u.y); if (d < bd) { bd = d; best = e; } }
    if (best) setMove(u, best.x, best.y, true);
  }
}
function aiPlaceFactory(yard) {
  let best = null, bs = 1e9;
  for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
    const tx = yard.tx + dx, ty = yard.ty + dy;
    if (!canPlace(1, 'factory', tx, ty)) continue;
    const s = Math.hypot(dx, dy) + Math.random() * 3;
    if (s < bs) { bs = s; best = [tx, ty]; }
  }
  if (best) placeBuilding(1, 'factory', best[0], best[1]);
}

// ---------------------------------------------------------------- main update
function update(dt) {
  if (G.over) return;
  G.t += dt;
  updateBuildings(dt);
  for (const u of G.units) {
    if (u.dead) continue;
    if (u.type === 'tank') updateTank(u, dt); else updateHarvester(u, dt);
  }
  separate();
  for (const p of G.projs) {
    if (p.target && !p.target.dead) { p.tx = p.target.x; p.ty = p.target.y; }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = 460 * dt;
    if (p.target && !p.target.dead && distToEntity(p.x, p.y, p.target) <= 5) { hurt(p.target, p.dmg); boom(p.x, p.y, 12); p.done = true; }
    else if (d <= step) { p.done = true; if (!p.target || p.target.dead) boom(p.tx, p.ty, 10); else { hurt(p.target, p.dmg); boom(p.tx, p.ty, 12); } }
    else { p.x += dx / d * step; p.y += dy / d * step; }
  }
  G.projs = G.projs.filter(p => !p.done);
  for (const f of G.fx) f.t += dt;
  G.fx = G.fx.filter(f => f.t < f.life);
  G.units = G.units.filter(u => !u.dead);
  G.buildings = G.buildings.filter(b => !b.dead);
  G.selected = G.selected.filter(s => !s.dead);
  G.ai.next -= dt; if (G.ai.next <= 0) { G.ai.next = 0.5; aiThink(); }
  if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) document.getElementById('msg').textContent = ''; }
  // victory / defeat
  const hasYard = t => G.buildings.some(b => b.team === t && b.type === 'yard' && !b.dead);
  if (!hasYard(1)) endGame('win'); else if (!hasYard(0)) endGame('lose');
}
function endGame(r) {
  G.over = r; G.placing = null;
  const o = document.getElementById('overlay');
  document.getElementById('overlayTitle').textContent = r === 'win' ? 'VICTORY' : 'DEFEAT';
  document.getElementById('overlayTitle').style.color = r === 'win' ? '#7f7' : '#f55';
  document.getElementById('overlaySub').textContent = r === 'win' ? 'The enemy Construction Yard has been destroyed.' : 'Your Construction Yard has been destroyed.';
  o.classList.remove('hidden');
}

// ---------------------------------------------------------------- input
const keys = {};
const mouse = { x: 0, y: 0, inside: false, down: false, sx: 0, sy: 0, drag: false };
const wx = () => mouse.x + G.cam.x, wy = () => mouse.y + G.cam.y;
function setSel(list) { for (const e of G.selected) e.sel = false; G.selected = list; for (const e of list) e.sel = true; }
function entityAt(x, y) {
  for (let i = G.units.length - 1; i >= 0; i--) { const u = G.units[i]; if (!u.dead && Math.hypot(u.x - x, u.y - y) <= u.r + 4) return u; }
  for (const b of G.buildings) if (!b.dead && x >= b.rx && x < b.rx + b.rw && y >= b.ry && y < b.ry + b.rh) return b;
  return null;
}
function placeTile() { const d = DEFS[G.placing]; return [Math.round(wx() / TILE - d.w / 2), Math.round(wy() / TILE - d.h / 2)]; }
function toggleFactoryPlacing() {
  if (G.over) return;
  if (G.placing) { G.placing = null; return; }
  if (G.credits[0] < DEFS.factory.cost) { say('Not enough credits.'); return; }
  G.placing = 'factory'; say('Click near your base to place the War Factory (right-click/Esc cancels).');
}
function orderSelected() {
  const units = G.selected.filter(s => s.kind === 'u' && s.team === 0);
  if (!units.length) return;
  const x = wx(), y = wy(), e = entityAt(x, y);
  if (e && e.team === 1) {
    for (const u of units) { if (u.type === 'tank') setAttack(u, e); else setMove(u, x, y); }
    G.fx.push({ x: e.x, y: e.y, r: 20, t: 0, life: 0.3, ring: '#f55' });
    return;
  }
  const ti = idx(clamp(tileOf(x), 0, W - 1), clamp(tileOf(y), 0, H - 1));
  const n = units.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  units.forEach((u, i) => {
    if (u.type === 'harvester' && G.crystal[ti] > 0) { u.order = null; u.path = null; u.ct = ti; u.hs = 'goto'; u.rp = 0; return; }
    const ox = ((i % cols) - (cols - 1) / 2) * 30, oy = (Math.floor(i / cols) - (rows - 1) / 2) * 30;
    setMove(u, clamp(x + ox, 16, W * TILE - 16), clamp(y + oy, 16, H * TILE - 16));
  });
  G.fx.push({ x, y, r: 16, t: 0, life: 0.3, ring: '#7f7' });
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousemove', e => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.inside = true; if (mouse.down && Math.hypot(mouse.x - mouse.sx, mouse.y - mouse.sy) > 5) mouse.drag = true; });
canvas.addEventListener('mouseleave', () => { mouse.inside = false; });
canvas.addEventListener('mousedown', e => {
  const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  if (G.over) return;
  if (e.button === 0) {
    if (G.placing) { const [tx, ty] = placeTile(); if (placeBuilding(0, G.placing, tx, ty)) { G.placing = null; say('Construction started.'); } return; }
    mouse.down = true; mouse.drag = false; mouse.sx = mouse.x; mouse.sy = mouse.y;
  } else if (e.button === 2) {
    if (G.placing) { G.placing = null; return; }
    orderSelected();
  }
});
window.addEventListener('mouseup', e => {
  if (e.button !== 0 || !mouse.down) return;
  mouse.down = false;
  if (G.over) return;
  const add = e.shiftKey;
  if (mouse.drag) {
    const x0 = Math.min(mouse.sx, mouse.x) + G.cam.x, x1 = Math.max(mouse.sx, mouse.x) + G.cam.x, y0 = Math.min(mouse.sy, mouse.y) + G.cam.y, y1 = Math.max(mouse.sy, mouse.y) + G.cam.y;
    const hit = G.units.filter(u => !u.dead && u.team === 0 && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
    if (hit.length || !add) setSel(add ? [...new Set([...G.selected, ...hit])] : hit);
  } else {
    const x = mouse.x + G.cam.x, y = mouse.y + G.cam.y, e2 = entityAt(x, y);
    if (e2 && e2.team === 0) setSel(add ? [...new Set([...G.selected, e2])] : [e2]);
    else if (!add) setSel([]);
  }
  mouse.drag = false;
});
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (!G) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { G.placing = null; setSel([]); }
  else if (k === 'x') { for (const u of G.selected) if (u.kind === 'u' && u.type === 'tank') { u.order = null; u.target = null; u.path = null; } }
  else if (k === ' ') { const y = G.buildings.find(b => b.team === 0 && b.type === 'yard'); if (y) { G.cam.x = clamp(y.x - VW / 2, 0, W * TILE - VW); G.cam.y = clamp(y.y - VH / 2, 0, H * TILE - VH); } e.preventDefault(); }
  else if (k === 'f') { speedMul = speedMul === 1 ? 3 : 1; say('Game speed x' + speedMul); }
  else if (k === 'p') { paused = !paused; say(paused ? 'Paused' : 'Resumed'); }
  else if (k === 'b') toggleFactoryPlacing();
  else if (k === 't') clickTank();
  else if (k === 'h') clickHarv();
  if (k.startsWith('arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
let miniDown = false;
function miniMove(e) { const r = mini.getBoundingClientRect(); const mx = (e.clientX - r.left) / r.width * W * TILE, my = (e.clientY - r.top) / r.height * H * TILE; G.cam.x = clamp(mx - VW / 2, 0, W * TILE - VW); G.cam.y = clamp(my - VH / 2, 0, H * TILE - VH); }
mini.addEventListener('mousedown', e => { miniDown = true; miniMove(e); });
window.addEventListener('mousemove', e => { if (miniDown) miniMove(e); });
window.addEventListener('mouseup', () => { miniDown = false; });
function clickTank() { if (G.over) return; const sel = G.selected.find(s => s.kind === 'b' && s.type === 'factory'); if (queueUnit(0, 'tank', sel)) say('Tank queued.'); }
function clickHarv() { if (G.over) return; if (queueUnit(0, 'harvester')) say('Harvester queued.'); }
document.getElementById('btnFactory').addEventListener('click', toggleFactoryPlacing);
document.getElementById('btnTank').addEventListener('click', clickTank);
document.getElementById('btnHarv').addEventListener('click', clickHarv);
document.getElementById('btnRestart').addEventListener('click', () => { newGame(); });
document.getElementById('costFactory').textContent = DEFS.factory.cost;
document.getElementById('costTank').textContent = DEFS.tank.cost;
document.getElementById('costHarv').textContent = DEFS.harvester.cost;

function updateCamera(dt) {
  const sp = 700 * dt; let dx = 0, dy = 0;
  if (keys['arrowleft'] || keys['a']) dx -= 1;
  if (keys['arrowright'] || keys['d']) dx += 1;
  if (keys['arrowup'] || keys['w']) dy -= 1;
  if (keys['arrowdown'] || keys['s']) dy += 1;
  if (mouse.inside && !mouse.down) { if (mouse.x < 10) dx -= 1; if (mouse.x > VW - 10) dx += 1; if (mouse.y < 10) dy -= 1; if (mouse.y > VH - 10) dy += 1; }
  G.cam.x = clamp(G.cam.x + dx * sp, 0, W * TILE - VW); G.cam.y = clamp(G.cam.y + dy * sp, 0, H * TILE - VH);
}

// ---------------------------------------------------------------- HUD
const $ = id => document.getElementById(id);
function updateHUD() {
  $('creditsVal').textContent = Math.floor(G.credits[0]);
  $('unitCount').textContent = G.units.filter(u => u.team === 0).length + ' (enemy ' + G.units.filter(u => u.team === 1).length + ')';
  const mine = G.buildings.filter(b => b.team === 0);
  const factDone = mine.some(b => b.type === 'factory' && b.done), yardOk = mine.some(b => b.type === 'yard');
  $('btnFactory').classList.toggle('disabled', G.credits[0] < DEFS.factory.cost && !G.placing);
  $('btnFactory').classList.toggle('active', G.placing === 'factory');
  $('btnTank').classList.toggle('disabled', !factDone || G.credits[0] < DEFS.tank.cost);
  $('btnHarv').classList.toggle('disabled', !yardOk || G.credits[0] < DEFS.harvester.cost);
  const prog = type => { let m = 0, n = 0; for (const b of mine) for (const [i, q] of b.queue.entries()) if (q.type === type) { n++; if (i === 0) m = Math.max(m, q.prog); } return [m, n]; };
  const fb = Math.max(0, ...mine.filter(b => b.type === 'factory' && !b.done).map(b => b.prog));
  $('barFactory').style.width = (fb * 100) + '%';
  const [tp, tn] = prog('tank'), [hp, hn] = prog('harvester');
  $('barTank').style.width = (tp * 100) + '%'; $('barHarv').style.width = (hp * 100) + '%';
  $('btnTank').firstChild.textContent = 'Tank' + (tn ? ' x' + tn : '');
  $('btnHarv').firstChild.textContent = 'Harvester' + (hn ? ' x' + hn : '');
}

// ---------------------------------------------------------------- rendering
function drawBuilding(b) {
  const x = b.rx - G.cam.x, y = b.ry - G.cam.y, col = COLORS[b.team];
  ctx.save();
  if (!b.done) ctx.globalAlpha = 0.45 + 0.4 * b.prog;
  ctx.fillStyle = '#3c3f44'; ctx.fillRect(x + 1, y + 1, b.rw - 2, b.rh - 2);
  ctx.fillStyle = '#5a5f66'; ctx.fillRect(x + 4, y + 4, b.rw - 8, b.rh - 8);
  ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, b.rw - 2, 5);
  if (b.type === 'yard') {
    ctx.fillStyle = '#8a9099'; ctx.fillRect(x + 20, y + 20, b.rw - 40, b.rh - 40);
    ctx.fillStyle = col; ctx.fillRect(x + b.rw / 2 - 8, y + b.rh / 2 - 8, 16, 16);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.strokeRect(x + 20, y + 20, b.rw - 40, b.rh - 40);
  } else if (b.type === 'refinery') {
    ctx.fillStyle = '#b9a23a'; ctx.beginPath(); ctx.arc(x + 28, y + b.rh / 2 + 2, 18, 0, 7); ctx.fill();
    ctx.fillStyle = '#333'; ctx.fillRect(x + 54, y + 22, b.rw - 64, 20);
    ctx.fillStyle = '#3fe0c0'; ctx.fillRect(x + 58, y + 26, b.rw - 72, 12);
  } else {
    ctx.fillStyle = '#23262a'; ctx.fillRect(x + 12, y + b.rh - 30, b.rw - 24, 22);
    ctx.strokeStyle = '#6a7078'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 12, y + b.rh - 28 + i * 5); ctx.lineTo(x + b.rw - 12, y + b.rh - 28 + i * 5); ctx.stroke(); }
    ctx.fillStyle = col; ctx.fillRect(x + b.rw - 24, y + 14, 12, 12);
  }
  ctx.restore();
  ctx.strokeStyle = b.sel ? '#7f7' : '#111'; ctx.lineWidth = b.sel ? 3 : 1; ctx.strokeRect(x + 0.5, y + 0.5, b.rw - 1, b.rh - 1);
  if (!b.done) { ctx.fillStyle = '#000a'; ctx.fillRect(x + 8, y + b.rh / 2 - 5, b.rw - 16, 10); ctx.fillStyle = '#fd4'; ctx.fillRect(x + 9, y + b.rh / 2 - 4, (b.rw - 18) * b.prog, 8); }
  else if (b.queue.length) { ctx.fillStyle = '#000a'; ctx.fillRect(x + 8, y + 10, b.rw - 16, 6); ctx.fillStyle = '#6f6'; ctx.fillRect(x + 8, y + 10, (b.rw - 16) * b.queue[0].prog, 6); }
  if (b.hp < b.maxhp || b.sel) healthBar(x, y - 8, b.rw, b.hp / b.maxhp);
}
function healthBar(x, y, w, f) { ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, 5); ctx.fillStyle = f > 0.5 ? '#4f4' : f > 0.25 ? '#fd3' : '#f44'; ctx.fillRect(x + 1, y + 1, (w - 2) * Math.max(0, f), 3); }
function drawUnit(u) {
  const x = u.x - G.cam.x, y = u.y - G.cam.y, col = COLORS[u.team];
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 4, u.r + 3, u.r, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(u.angle);
  if (u.type === 'tank') {
    ctx.fillStyle = '#222'; ctx.fillRect(-13, -11, 26, 5); ctx.fillRect(-13, 6, 26, 5);
    ctx.fillStyle = u.team ? '#8a3a32' : '#3a5f9a'; ctx.fillRect(-12, -8, 24, 16);
    ctx.restore(); ctx.save(); ctx.translate(x, y); ctx.rotate(u.tAngle);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#ddd'; ctx.fillRect(0, -2, 18, 4);
  } else {
    ctx.fillStyle = '#222'; ctx.fillRect(-14, -12, 28, 5); ctx.fillRect(-14, 7, 28, 5);
    ctx.fillStyle = '#c9b032'; ctx.fillRect(-13, -9, 26, 18);
    ctx.fillStyle = col; ctx.fillRect(8, -9, 5, 18);
    ctx.fillStyle = '#3fe0c0'; ctx.fillRect(-11, -6, 16 * (u.cargo / DEFS.harvester.cap), 12);
    ctx.strokeStyle = '#432'; ctx.lineWidth = 1; ctx.strokeRect(-11, -6, 16, 12);
  }
  ctx.restore();
  if (u.sel) { ctx.strokeStyle = '#7f7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, u.r + 5, 0, 7); ctx.stroke(); }
  if (u.sel || u.hp < u.maxhp) healthBar(x - 14, y - u.r - 12, 28, u.hp / u.maxhp);
}
function render() {
  const cx = G.cam.x, cy = G.cam.y;
  ctx.drawImage(terrain, cx, cy, VW, VH, 0, 0, VW, VH);
  // crystals
  const x0 = Math.max(0, tileOf(cx)), x1 = Math.min(W - 1, tileOf(cx + VW)), y0 = Math.max(0, tileOf(cy)), y1 = Math.min(H - 1, tileOf(cy + VH));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const a = G.crystal[idx(tx, ty)]; if (a <= 0) continue;
    const s = 5 + 9 * Math.min(1, a / 600), px = tx * TILE - cx, py = ty * TILE - cy, n = grassNoise[idx(tx, ty)];
    for (let k = 0; k < 3; k++) {
      const ox = 6 + ((n * 97 + k * 31) % 20), oy = 6 + ((n * 53 + k * 47) % 20), sz = s * (0.7 + 0.3 * ((k + 1) / 3));
      ctx.fillStyle = k === 1 ? '#8ff5e0' : '#2fc8a8';
      ctx.beginPath(); ctx.moveTo(px + ox, py + oy - sz); ctx.lineTo(px + ox + sz * 0.6, py + oy); ctx.lineTo(px + ox, py + oy + sz * 0.7); ctx.lineTo(px + ox - sz * 0.6, py + oy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0a6a58'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  for (const b of G.buildings) if (b.rx + b.rw > cx && b.rx < cx + VW && b.ry + b.rh > cy && b.ry < cy + VH) drawBuilding(b);
  for (const u of G.units) if (u.x > cx - 30 && u.x < cx + VW + 30 && u.y > cy - 30 && u.y < cy + VH + 30) drawUnit(u);
  for (const p of G.projs) { ctx.fillStyle = '#ffe97a'; ctx.beginPath(); ctx.arc(p.x - cx, p.y - cy, 3, 0, 7); ctx.fill(); }
  for (const f of G.fx) {
    if (f.t < 0) continue; const k = f.t / f.life;
    if (f.flash) { ctx.fillStyle = `rgba(255,230,120,${1 - k})`; ctx.beginPath(); ctx.arc(f.x - cx, f.y - cy, f.r, 0, 7); ctx.fill(); }
    else if (f.ring) { ctx.strokeStyle = f.ring; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x - cx, f.y - cy, f.r * (0.5 + k * 0.5), 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
    else { ctx.fillStyle = `rgba(255,${150 - k * 100 | 0},30,${1 - k})`; ctx.beginPath(); ctx.arc(f.x - cx, f.y - cy, f.r * (0.4 + k * 0.8), 0, 7); ctx.fill(); }
  }
  // placement ghost
  if (G.placing && mouse.inside) {
    const d = DEFS[G.placing], [tx, ty] = placeTile(), ok = canPlace(0, G.placing, tx, ty);
    ctx.fillStyle = ok ? 'rgba(80,255,80,.4)' : 'rgba(255,60,60,.4)'; ctx.fillRect(tx * TILE - cx, ty * TILE - cy, d.w * TILE, d.h * TILE);
    ctx.strokeStyle = ok ? '#7f7' : '#f66'; ctx.lineWidth = 2; ctx.strokeRect(tx * TILE - cx, ty * TILE - cy, d.w * TILE, d.h * TILE);
  }
  if (mouse.down && mouse.drag) { ctx.strokeStyle = '#7f7'; ctx.lineWidth = 1; ctx.strokeRect(mouse.sx, mouse.sy, mouse.x - mouse.sx, mouse.y - mouse.sy); }
  // overlay text
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, 250, 24);
  ctx.fillStyle = '#fff'; ctx.font = '13px monospace'; ctx.textBaseline = 'middle';
  ctx.fillText(`$ ${Math.floor(G.credits[0])}   time ${Math.floor(G.t / 60)}:${String(Math.floor(G.t % 60)).padStart(2, '0')}${speedMul > 1 ? '  x' + speedMul : ''}${paused ? '  PAUSED' : ''}`, 8, 12);
  const sel = G.selected;
  if (sel.length) {
    const s = sel[0], label = sel.length > 1 ? `${sel.length} units selected` : `${DEFS[s.type].name}  HP ${Math.ceil(s.hp)}/${s.maxhp}`;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, VH - 22, 280, 22); ctx.fillStyle = '#cfc'; ctx.fillText(label, 8, VH - 11);
  }
  // minimap
  mctx.drawImage(miniTerrain, 0, 0);
  const sc = 160 / (W * TILE);
  mctx.fillStyle = '#3fe0c0'; for (let i = 0; i < W * H; i += 1) if (G.crystal[i] > 0) mctx.fillRect((i % W) * 2.5, ((i / W) | 0) * 2.5, 2.5, 2.5);
  for (const b of G.buildings) { mctx.fillStyle = COLORS[b.team]; mctx.fillRect(b.rx * sc, b.ry * sc, b.rw * sc, b.rh * sc); }
  for (const u of G.units) { mctx.fillStyle = COLORS[u.team]; mctx.fillRect(u.x * sc - 1, u.y * sc - 1, 3, 3); }
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1; mctx.strokeRect(cx * sc, cy * sc, VW * sc, VH * sc);
}

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  updateCamera(dt);
  if (!paused) { acc += dt * speedMul; while (acc >= 1 / 30) { update(1 / 30); acc -= 1 / 30; } }
  updateHUD(); render();
  requestAnimationFrame(frame);
}
newGame();
requestAnimationFrame(frame);

// handy hooks for tests / debugging
window.__game = {
  get state() { return G; }, update, newGame, DEFS, canPlace, placeBuilding, queueUnit, spawnUnit, setMove, setAttack, kill, findPath, setSel, astar,
  tick(sec) { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) update(1 / 30); },
  setPaused(p) { paused = p; },
};
})();
