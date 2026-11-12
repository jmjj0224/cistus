import * as THREE from 'three';
import { CFG } from './config.js';
import { LINES, DEATH_RECORD, APPROACH_RECORD, CREDITS, POCKET_LINE_INDEX, TEXT } from './script.js';
import { GameAudio } from './audio.js';

// PS1처럼 색 보정 없이 텍스처 색 × 조명을 그대로 화면에 내보내요.
THREE.ColorManagement.enabled = false;

const W = CFG.renderW;
const H = CFG.renderH;
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug'); // ?debug : 마우스 잠금 없이 실행 (자동 점검용)

const $ = (id) => document.getElementById(id);
const el = {
  frame: $('frame'), canvas: $('c'), ui: $('ui'), sub: $('sub'), prompt: $('prompt'),
  title: $('title'), titleMain: $('titleMain'), titleStart: $('titleStart'), titleHelp: $('titleHelp'),
  pause: $('pause'), pauseTitle: $('pauseTitle'), pauseResume: $('pauseResume'), pauseShake: $('pauseShake'),
  scroll: $('scroll'), scrollInner: $('scrollInner'),
  end: $('end'), endCover: $('endCover'), endTitle: $('endTitle'), endArtist: $('endArtist'), endLink: $('endLink'), endUrl: $('endUrl'), endRestart: $('endRestart'),
  stage: $('stage'), touch: $('touch'), joy: $('joy'), knob: $('knob'), joyGhost: $('joyGhost'), fireBtn: $('fireBtn'), pauseBtn: $('pauseBtn'),
  err: $('err'),
};
window.addEventListener('error', (e) => {
  el.err.style.display = 'block';
  el.err.textContent += `${e.message}\n`;
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(CFG.seed);
const rr = (a, b) => a + (b - a) * rnd();

// ------------------------------------------------------------------ 렌더러
const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
const rt = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

// 스마트폰(터치 화면)인지. 터치가 한 번이라도 들어오면 그때도 켜요.
let TOUCH = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
const SCREEN = { w: 0, h: 0, rot: false }; // 돌린 뒤의 화면 크기
function fitUi() {
  const vw = window.innerWidth, vh = window.innerHeight;
  SCREEN.rot = TOUCH && vh > vw; // 세로로 들고 있으면 화면을 돌려서 가로로 보여 줘요
  SCREEN.w = SCREEN.rot ? vh : vw; SCREEN.h = SCREEN.rot ? vw : vh;
  el.stage.style.setProperty('--sw', SCREEN.w + 'px'); el.stage.style.setProperty('--sh', SCREEN.h + 'px');
  el.stage.classList.toggle('rot', SCREEN.rot); el.stage.classList.toggle('touch', TOUCH);
  const h = el.frame.clientHeight;
  // 글자 배율: 스마트폰은 화면이 작아서 조금 더 크게 잡아요
  el.ui.style.setProperty('--k', TOUCH ? Math.max(1.25, Math.round((h / 260) * 4) / 4) : Math.max(1, Math.round(h / 330)));
}
window.addEventListener('resize', fitUi);
window.addEventListener('orientationchange', () => setTimeout(fitUi, 250));
fitUi();

// 꼭짓점을 화면 격자에 맞춰 PS1처럼 덜덜 떨리게 해요.
const snapRes = { value: new THREE.Vector2(W / 2, H / 2) };
function ps1(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = snapRes;
    shader.vertexShader = 'uniform vec2 uSnap;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      if (gl_Position.w > 0.02) { vec4 sp = gl_Position; sp.xyz /= sp.w; sp.xy = floor(sp.xy * uSnap + 0.5) / uSnap; sp.xyz *= sp.w; gl_Position = sp; }`
    );
  };
  mat.customProgramCacheKey = () => 'ps1';
  return mat;
}
const lam = (o) => ps1(new THREE.MeshLambertMaterial(o));
const bas = (o) => ps1(new THREE.MeshBasicMaterial(o));

// ------------------------------------------------------------------ 텍스처
const TEX = {};
const BBOX = {}; // 그림에서 투명하지 않은 영역 (0~1)
const SMALL = [
  'ground_leaves', 'ground_sun', 'ground_path', 'bark', 'rock',
  'canopy_a', 'canopy_b', 'fern', 'far_trees', 'stump_top', 'sign_wood',
  'hand_open', 'hand_strike', 'flame_1', 'flame_2', 'flame_3',
  'cicada_alive', 'cicada_burning', 'cicada_dead', 'cicada_shell',
  'monster_stage0', 'monster_stage1', 'monster_stage2', 'monster_stage3',
  'part_gate_inside', 'part_shell_door', 'part_wing', 'veil_1', 'veil_2', 'veil_3',
];
const STILLS = ['title_keyart', 'mint_start', 'ending_run', 'pocket_contents', 'membrane_start', 'ending_swallow_mid', 'ending_swallow'];

function alphaBBox(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 127) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0: x0 / c.width, y0: y0 / c.height, x1: (x1 + 1) / c.width, y1: (y1 + 1) / c.height };
}

async function loadTextures() {
  const loader = new THREE.TextureLoader();
  await Promise.all([
    ...SMALL.map(async (n) => {
      const t = await loader.loadAsync(`assets/${n}.png`);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      TEX[n] = t; BBOX[n] = alphaBBox(t.image);
    }),
    ...STILLS.map(async (n) => {
      const t = await loader.loadAsync(`assets/${n}.png`);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      TEX[n] = t;
    }),
  ]);
  for (const n of ['ground_leaves', 'ground_sun', 'ground_path']) TEX[n].wrapS = TEX[n].wrapT = THREE.MirroredRepeatWrapping;
  for (const n of ['bark', 'rock']) TEX[n].wrapS = TEX[n].wrapT = THREE.RepeatWrapping;
}

// 있으면 쓰는 파일 (영상, 앨범 자켓)
async function exists(url) {
  try { const r = await fetch(url, { headers: { Range: 'bytes=0-1' } }); return r.ok; } catch { return false; }
}
const VIDEO = {};
async function loadVideo(key, url) {
  if (!(await exists(url))) return;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  // 아이폰은 화면을 누르기 전에는 영상을 미리 받아 두지 않을 때가 있어서, 4초만 기다리고 넘어가요.
  const ok = await new Promise((res) => {
    v.addEventListener('loadeddata', () => res(true), { once: true });
    v.addEventListener('error', () => res(false), { once: true });
    setTimeout(() => res(true), 4000);
    v.src = url; v.load();
  });
  if (!ok || v.error) return;
  const t = new THREE.VideoTexture(v);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  VIDEO[key] = { v, t };
}

// ------------------------------------------------------------------ 숲
const scene = new THREE.Scene();
const FOG_A = new THREE.Color(0xa59c50);
const FOG_B = new THREE.Color(0xcda92a); // 괴물이 나온 뒤
scene.fog = new THREE.FogExp2(FOG_A.getHex(), 0.062);
const camera = new THREE.PerspectiveCamera(62, W / H, 0.08, 90);
camera.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xfff3c4, 0x6a5a30, 3.0);
const sun = new THREE.DirectionalLight(0xffe9a0, 0.9);
sun.position.set(0.4, 1, 0.3);
const lighterLight = new THREE.PointLight(0xff9a3c, 0, 7, 1.6);
scene.add(hemi, sun, lighterLight);

const colliders = []; // {x,z,r}
const trees = [];
const cicadas = [];
const pathR = (a) => 15 + 3.5 * Math.sin(3 * a + 0.6);
function pathDist(x, z) { return Math.abs(Math.hypot(x, z) - pathR(Math.atan2(z, x))); }
const START_A = -Math.PI / 2;
// 숲 밖으로 나가는 길: 출발 지점 뒤쪽으로 곧게 뻗어요. 괴물이 나오기 전에는 밧줄로 막혀 있어요.
const XC = -1.1;      // 길 한가운데의 x
const ZG = -29.4;     // 숲 구역이 끝나는 곳
const ZP0 = -31.4;    // 여기부터 같은 풍경이 PERIOD(m)마다 되풀이돼요
const PERIOD = 8;
const WRAP_S = 48;    // 이만큼 들어가면 한 주기 뒤로 되돌려서 길이 끝나지 않게 해요
const onSpur = (x, z, w) => Math.abs(x - XC) < w && z < -16.5;
const START = { x: Math.cos(START_A) * pathR(START_A), z: Math.sin(START_A) * pathR(START_A) };

class Batch {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  add(geo, m, us = 1, vs = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array;
    for (let i = 0; i < P.length; i++) { this.p.push(P[i]); this.n.push(N[i]); }
    for (let i = 0; i < U.length; i += 2) this.uv.push(U[i] * us, U[i + 1] * vs);
    g.dispose();
  }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    return m;
  }
}
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
function mat(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
  return M4.compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(sx, sy, sz)).clone();
}
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash2(xi, zi), hash2(xi + 1, zi), u), lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), u), v);
}

// 나무줄기는 육각기둥이고 위로 갈수록 가늘어지며 조금 기울어 있어요.
// 매미와 허물이 떠 보이지 않게, 원하는 방향에 가장 가까운 면을 골라 그 면에 딱 붙는 자리를 돌려줘요.
function trunkFace(t, y, wantX, wantZ) {
  let best = null, bd = -2, bth = 0;
  for (let i = 0; i < 6; i++) {
    const th = (i + 0.5) * Math.PI / 3;
    const n = new THREE.Vector3(Math.sin(th), 0, Math.cos(th)).transformDirection(t.m);
    const d = n.x * wantX + n.z * wantZ;
    if (d > bd) { bd = d; best = n; bth = th; }
  }
  const r = (t.r + (t.rtop - t.r) * (y / t.h)) * Math.cos(Math.PI / 6);
  const pos = new THREE.Vector3(Math.sin(bth) * r, y, Math.cos(bth) * r).applyMatrix4(t.m).addScaledVector(best, 0.012);
  return { pos, normal: best };
}
const exitGate = { rope: null, light: null, open: false, t: 0 };
function buildExitLight() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 96;
  const g = c.getContext('2d');
  g.translate(32, 48); g.scale(1, 1.5);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,250,0.95)');
  gr.addColorStop(0.65, 'rgba(255,252,225,0.35)'); gr.addColorStop(1, 'rgba(255,250,210,0)');
  g.fillStyle = gr; g.fillRect(-32, -32, 64, 64);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
  m.scale.set(12, 17, 1); m.visible = false; m.renderOrder = 5; scene.add(m);
  exitGate.light = m;
}
function openExit() {
  if (exitGate.open) return;
  exitGate.open = true; exitGate.t = 0;
  exitGate.rope.visible = false; exitGate.light.visible = true;
}
// 흰 빛은 늘 같은 거리만큼 앞에 있어서, 아무리 걸어도 가까워지지 않아요.
function updateExit(dt) {
  if (!exitGate.open) return;
  exitGate.t += dt;
  const m = exitGate.light, z = Math.min(ZG - 24, player.z - CFG.corridor.lightDist);
  m.position.set(XC, 5.2, z);
  m.rotation.y = Math.atan2(player.x - XC, player.z - z);
  m.material.opacity = smooth(exitGate.t / 4) * (0.9 + 0.1 * Math.sin(S.clock * 1.3));
}
function buildWorld() {
  // --- 바닥: 4m 타일. 흙길 / 햇빛 든 풀 / 풀과 이끼
  const g = { ground_leaves: new Batch(), ground_sun: new Batch(), ground_path: new Batch() };
  const tile = new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2);
  for (let x = -46; x <= 46; x += 4) for (let z = -46; z <= 46; z += 4) {
    if (Math.hypot(x, z) > 50) continue;
    const tx = x + 0.9, tz = z + 0.6;
    if (tz < -31 && Math.abs(tx - XC) < 8.5) continue; // 끝없는 길 쪽 바닥은 아래에서 따로 깔아요
    let type = 'ground_leaves';
    if (pathDist(tx, tz) < 2.4 || (Math.abs(tx - XC) < 0.5 && tz < -17)) type = 'ground_path';
    else if (vnoise(x * 0.09 + 3.1, z * 0.09 + 7.7) > 0.6) type = 'ground_sun';
    // 타일 경계가 시작 위치 바로 아래를 지나면 발밑이 단색으로 뭉개져서, 격자를 조금 밀어 놓았어요.
    g[type].add(tile, mat(x + 0.9, 0, z + 0.6, Math.floor(rnd() * 4) * Math.PI / 2), 2, 2);
  }
  for (let j = 0; j < 30; j++) for (const cx of [-8, -4, 0, 4, 8]) { // 끝없는 길: 두 줄(8m)마다 같은 무늬
    g[cx === 0 ? 'ground_path' : 'ground_leaves'].add(tile, mat(XC + cx, 0, ZP0 - 2 - j * 4, (j % 2) * Math.PI), 2, 2);
  }
  for (const k in g) scene.add(g[k].mesh(lam({ map: TEX[k] })));

  // --- 나무
  const pts = [];
  let tries = 0;
  while (pts.length < 115 && tries++ < 8000) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 29.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pathDist(x, z) < 1.9 || onSpur(x, z, 2.7)) continue;
    if (Math.hypot(x - START.x, z - START.z) < 3.5) continue;
    if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < 2.7)) continue;
    pts.push({ x, z, ring: false });
  }
  for (let a = 0; a < Math.PI * 2; a += 0.055) { // 구역을 둘러싼 빽빽한 나무 벽
    const r = 31 + rnd() * 5;
    if (onSpur(Math.cos(a) * r, Math.sin(a) * r, 3.3)) continue; // 나가는 길 자리는 비워 둬요
    pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, ring: true });
  }
  const trunk = new Batch(), canA = new Batch(), canB = new Batch();
  const card = new THREE.PlaneGeometry(1, 1);
  const addTree = (p, R = rnd, collide = true) => {
    const q = (a, b) => a + (b - a) * R();
    const h = q(7, 11), rb = q(0.28, 0.46), rtop = rb * 0.7;
    const geo = new THREE.CylinderGeometry(rtop, rb, h, 6, 1, true).translate(0, h / 2, 0);
    const tm = mat(p.x, 0, p.z, R() * 6.28, 1, 1, 1, q(-0.04, 0.04), q(-0.04, 0.04)).clone();
    trunk.add(geo, tm, 2, h / 2.6);
    const can = R() < 0.5 ? canA : canB;
    for (let k = 0; k < 3; k++) {
      const s = q(4.5, 7);
      can.add(card, mat(p.x + q(-0.6, 0.6), h - q(0.4, 2.6), p.z + q(-0.6, 0.6), R() * 3.14, s, s, 1));
    }
    can.add(card, mat(p.x, h - q(1.2, 2.2), p.z, R() * 6.28, 7.5, 7.5, 1, -Math.PI / 2));
    if (!p.ring && R() < 0.4) {
      const s = q(2.2, 3.4), a = R() * 6.28;
      can.add(card, mat(p.x + Math.cos(a) * 0.9, q(3, 4.6), p.z + Math.sin(a) * 0.9, a, s, s, 1));
    }
    if (!collide) return;
    trees.push({ x: p.x, z: p.z, r: rb, rtop, h, m: tm, ring: p.ring });
    colliders.push({ x: p.x, z: p.z, r: rb + 0.06 });
  };
  for (const p of pts) addTree(p);
  // 끝없는 길 양옆의 나무: 주기마다 같은 숫자로 만들어서 똑같은 나무가 되풀이돼요
  for (let k = 0; k < 14; k++) {
    const R = mulberry32(4242), q = (a, b) => a + (b - a) * R();
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) addTree({ x: XC + side * q(2.8, 3.4), z: ZP0 - k * PERIOD - (j * 2.67 + q(0.2, 1.2)), ring: true }, R, false);
      for (let j = 0; j < 2; j++) addTree({ x: XC + side * q(4.8, 7), z: ZP0 - k * PERIOD - (j * 4 + q(0.5, 3)), ring: true }, R, false);
    }
  }
  scene.add(trunk.mesh(lam({ map: TEX.bark })));
  const leafMat = (t) => lam({ map: t, alphaTest: 0.5, side: THREE.DoubleSide });
  scene.add(canA.mesh(leafMat(TEX.canopy_a)), canB.mesh(leafMat(TEX.canopy_b)));

  // --- 양치
  const fern = new Batch();
  for (let i = 0; i < 320; i++) {
    const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 35;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pathDist(x, z) < 1.5 || onSpur(x, z, 2.2)) continue;
    const s = rr(0.8, 1.5), ry = rnd() * 3.14;
    fern.add(card, mat(x, s * 0.25, z, ry, s, s, 1));
    fern.add(card, mat(x, s * 0.25, z, ry + 1.57, s, s, 1));
  }
  scene.add(fern.mesh(leafMat(TEX.fern)));

  // --- 길 찾기용 지형지물: 바위, 그루터기, 통나무, 돌탑, 표지판, 밧줄 난간
  const rock = new Batch(), wood = new Batch(), stump = new Batch(), sign = new Batch(), rope = new Batch();
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const free = (x, z, r) => pathDist(x, z) > 1.6 + r && !onSpur(x, z, 2.4 + r) && !colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r + 0.3);
  const spot = (rmax, r) => {
    for (let i = 0; i < 200; i++) {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * rmax;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (free(x, z, r)) return { x, z };
    }
    return null;
  };
  for (let i = 0; i < 18; i++) {
    const sx = rr(0.5, 1.2), sy = rr(0.35, 0.75), sz = rr(0.5, 1.1);
    const p = spot(28, Math.max(sx, sz)); if (!p) continue;
    rock.add(ico, mat(p.x, sy * 0.35, p.z, rnd() * 6.28, sx, sy, sz, rr(-0.3, 0.3)), 2, 2);
    colliders.push({ x: p.x, z: p.z, r: Math.max(sx, sz) * 0.8 });
  }
  for (let i = 0; i < 6; i++) {
    const r = rr(0.35, 0.5), h = rr(0.4, 0.75);
    const p = spot(26, r); if (!p) continue;
    wood.add(new THREE.CylinderGeometry(r, r * 1.15, h, 8, 1, true).translate(0, h / 2, 0), mat(p.x, 0, p.z, rnd() * 6.28), 2, 0.3);
    stump.add(new THREE.PlaneGeometry(r * 2.15, r * 2.15).rotateX(-Math.PI / 2), mat(p.x, h + 0.01, p.z, rnd() * 6.28));
    colliders.push({ x: p.x, z: p.z, r: r + 0.1 });
  }
  for (let i = 0; i < 5; i++) {
    const r = rr(0.22, 0.32), len = rr(3, 5), ry = rnd() * 3.14;
    const p = spot(26, len / 2); if (!p) continue;
    wood.add(new THREE.CylinderGeometry(r, r, len, 6, 1, false).rotateZ(Math.PI / 2), mat(p.x, r * 0.85, p.z, ry), 2, len / 2.6);
    for (let k = -2; k <= 2; k++) colliders.push({ x: p.x + Math.cos(ry) * k * len / 5, z: p.z - Math.sin(ry) * k * len / 5, r: r + 0.12 });
  }
  for (let i = 0; i < 3; i++) { // 돌탑: 길가에
    const a = START_A + 1.2 + i * 2.1, r = pathR(a) + (i % 2 ? 2.4 : -2.4);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    let y = 0;
    for (let k = 0; k < 5; k++) {
      const s = 0.36 - k * 0.055;
      rock.add(ico, mat(x + rr(-0.03, 0.03), y + s * 0.45, z + rr(-0.03, 0.03), rnd() * 6.28, s, s * 0.55, s), 1, 1);
      y += s * 0.8;
    }
    colliders.push({ x, z, r: 0.45 });
  }
  for (let i = 0; i < 2; i++) { // 표지판
    const a = START_A + 0.35 + i * 3.0, r = pathR(a) + 2.2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, ry = -a + Math.PI / 2 + rr(-0.3, 0.3);
    wood.add(new THREE.BoxGeometry(0.09, 1.5, 0.09).translate(0, 0.75, 0), mat(x, 0, z, ry), 0.2, 0.6);
    sign.add(new THREE.PlaneGeometry(1.0, 0.5), mat(x, 1.3, z, ry, 1, 1, 1, 0, rr(-0.08, 0.08)));
    colliders.push({ x, z, r: 0.15 });
  }
  { // 밧줄 난간: 출발 지점부터 길 바깥쪽으로 9칸
    let prev = null;
    for (let i = 2; i < 12; i++) { // 나가는 길을 가로막지 않게 조금 옆에서 시작해요
      const a = START_A - 0.12 + i * 0.13, r = pathR(a) + 2.0;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      wood.add(new THREE.BoxGeometry(0.1, 0.95, 0.1).translate(0, 0.475, 0), mat(x, 0, z, -a), 0.2, 0.4);
      colliders.push({ x, z, r: 0.12 });
      if (prev) {
        const dx = x - prev.x, dz = z - prev.z, len = Math.hypot(dx, dz);
        rope.add(new THREE.BoxGeometry(len, 0.035, 0.035), mat((x + prev.x) / 2, 0.8, (z + prev.z) / 2, -Math.atan2(dz, dx)));
        for (let k = 1; k < 4; k++) colliders.push({ x: prev.x + dx * k / 4, z: prev.z + dz * k / 4, r: 0.1 });
      }
      prev = { x, z };
    }
  }
  { // 구역 경계 밧줄 울타리: 여기서 더 못 간다는 표시예요. 나가는 길 양옆으로도 이어져요.
    const post = (x, z) => wood.add(new THREE.BoxGeometry(0.1, 1.0, 0.1).translate(0, 0.5, 0), mat(x, 0, z, rnd() * 0.4), 0.2, 0.4);
    const seg = (b, a, c) => {
      const dx = c.x - a.x, dz = c.z - a.z, len = Math.hypot(dx, dz);
      for (const y of [0.86, 0.5]) b.add(new THREE.BoxGeometry(len, 0.04, 0.04), mat((a.x + c.x) / 2, y, (a.z + c.z) / 2, -Math.atan2(dz, dx)));
    };
    const RF = 29.5;
    const gl = { x: XC - 2, z: -Math.sqrt(RF * RF - (XC - 2) ** 2) }, gr = { x: XC + 2, z: -Math.sqrt(RF * RF - (XC + 2) ** 2) };
    const aL = Math.atan2(gl.z, gl.x), aR = Math.atan2(gr.z, gr.x), span = Math.PI * 2 - (aR - aL);
    const N = Math.round((span * RF) / 2.3);
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const a = aR + (span * i) / N, p = { x: Math.cos(a) * RF, z: Math.sin(a) * RF };
      post(p.x, p.z); if (prev) seg(rope, prev, p); prev = p;
    }
    for (const g0 of [gl, gr]) {
      let pv = g0;
      for (let z = ZP0; z > ZP0 - 14 * PERIOD; z -= 2) { const p = { x: g0.x, z }; post(p.x, p.z); seg(rope, pv, p); pv = p; }
    }
    const gate = new Batch(); seg(gate, gl, gr); // 나가는 길을 막은 밧줄. 괴물이 나오면 사라져요.
    exitGate.rope = gate.mesh(lam({ color: 0x5c4a2c })); scene.add(exitGate.rope);
  }
  scene.add(rock.mesh(lam({ map: TEX.rock })), wood.mesh(lam({ map: TEX.bark })));
  scene.add(stump.mesh(lam({ map: TEX.stump_top, alphaTest: 0.5 })));
  scene.add(sign.mesh(leafMat(TEX.sign_wood)), rope.mesh(lam({ color: 0x5c4a2c })));

  // --- 먼 숲 띠
  const far = new Batch();
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    if (i === 13 || i === 14) continue; // 나가는 길 앞을 가리는 두 장은 빼요
    far.add(card, mat(Math.cos(a) * 38, 3.4, Math.sin(a) * 38, -a - Math.PI / 2, 14, 7, 1));
  }
  scene.add(far.mesh(bas({ map: TEX.far_trees, alphaTest: 0.5, side: THREE.DoubleSide })));

  // --- 매미 12마리: 서로 멀리 떨어진 나무에. 첫 마리는 출발 지점 가까이.
  const cand = trees.filter((t) => !t.ring && Math.hypot(t.x, t.z) < 25);
  const chosen = [];
  const dStart = (t) => Math.hypot(t.x - START.x, t.z - START.z);
  const first = cand.filter((t) => dStart(t) > 4.5 && dStart(t) < 9).sort((a, b) => dStart(a) - dStart(b))[0] || cand[0];
  chosen.push(first);
  while (chosen.length < CFG.cicada.count) {
    let best = null, bd = -1;
    for (const t of cand) {
      if (chosen.includes(t)) continue;
      const d = Math.min(...chosen.map((c) => Math.hypot(c.x - t.x, c.z - t.z)));
      if (d > bd) { bd = d; best = t; }
    }
    if (!best) break;
    chosen.push(best);
  }
  const cgeo = new THREE.PlaneGeometry(CFG.cicada.size, CFG.cicada.size);
  for (const t of chosen) {
    // 길 쪽을 보게 붙여요.
    const a = Math.atan2(t.z, t.x), pr = pathR(a);
    let dir = Math.atan2(Math.sin(a) * pr - t.z, Math.cos(a) * pr - t.x) + rr(-0.7, 0.7);
    const y = rr(1.35, 1.7);
    const { pos, normal } = trunkFace(t, y, Math.cos(dir), Math.sin(dir));
    const mesh = new THREE.Mesh(cgeo, bas({ map: TEX.cicada_alive, alphaTest: 0.5 }));
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().add(normal));
    mesh.rotateZ(rr(-0.35, 0.35));
    scene.add(mesh);
    cicadas.push({ mesh, pos, normal, state: 'alive', burn: 0, audio: -1, tree: t });
    t.hasCicada = true;
  }
  // --- 빈 허물 장식
  const shell = new Batch(), holder = new THREE.Object3D();
  let n = 0;
  for (const t of trees) {
    if (t.ring || t.hasCicada || rnd() > 0.38 || n > 34) continue;
    n++;
    const dir = rnd() * 6.28, y = rr(0.7, 2.3);
    const f = trunkFace(t, y, Math.cos(dir), Math.sin(dir));
    holder.position.copy(f.pos); holder.lookAt(f.pos.clone().add(f.normal)); holder.rotateZ(rr(-0.4, 0.4)); holder.updateMatrix();
    shell.add(new THREE.PlaneGeometry(0.26, 0.26), holder.matrix);
  }
  scene.add(shell.mesh(bas({ map: TEX.cicada_shell, alphaTest: 0.5, side: THREE.DoubleSide })));
}

// 재 입자
const ashes = [];
function buildAshes() {
  const geo = new THREE.PlaneGeometry(0.03, 0.03);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a120a, side: THREE.DoubleSide }));
    m.visible = false; scene.add(m);
    ashes.push({ m, life: 0, v: new THREE.Vector3() });
  }
}
function emitAsh(pos, hot) {
  const a = ashes.find((x) => x.life <= 0); if (!a) return;
  a.m.visible = true; a.life = rr(0.6, 1.3);
  a.m.position.copy(pos).add(new THREE.Vector3(rr(-0.08, 0.08), rr(-0.08, 0.08), rr(-0.08, 0.08)));
  a.v.set(rr(-0.15, 0.15), rr(0.25, 0.7), rr(-0.15, 0.15));
  a.m.material.color.setHex(hot && rnd() < 0.5 ? 0xff7a1c : 0x1a120a);
}

// ------------------------------------------------------------------ 괴물 (거리에 따라 그림을 바꾸는 평면)
const monster = { mesh: null, active: false, stage: 0, x: 0, z: 0, flick: 0, lurch: 0, moving: false };
function buildMonster() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bas({ map: TEX.monster_stage0, alphaTest: 0.5, side: THREE.DoubleSide }));
  m.visible = false; scene.add(m); monster.mesh = m;
}
function setMonsterStage(s) {
  const key = `monster_stage${s}`, t = TEX[key], b = BBOX[key];
  const fig = b.y1 - b.y0, gap = 1 - b.y1;
  const body = CFG.monster.bodyHeight * (s === 3 ? 1.12 : 1);
  const ph = body / fig, pw = ph * (t.image.width / t.image.height);
  monster.mesh.material.map = t;
  monster.mesh.scale.set(pw, ph, 1);
  monster.baseY = ph / 2 - gap * ph;
}

// ------------------------------------------------------------------ 행인 (매미 태우는 모습을 본 사람)
// assets/witness_stare.png, witness_flee_1.png, witness_flee_2.png 가 있으면 그 그림을 쓰고,
// 없으면 아래 코드가 그린 검은 실루엣을 써요.
const witness = { mesh: null, state: 'none', x: 0, z: 0, t: 0, step: 0, dirX: 0, dirZ: 0, tex: {} };
function drawWitness(kind) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const g = c.getContext('2d');
  const R = (x, y, w, h, col = '#14110b') => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  if (kind === 'stare') {
    R(9, 3, 14, 2); R(12, 1, 8, 3);            // 챙 넓은 모자
    R(12, 5, 8, 8); R(13, 13, 6, 1);           // 머리
    R(15, 14, 2, 5);                           // 긴 목
    R(11, 19, 10, 19);                         // 몸통
    R(8, 20, 3, 25); R(21, 20, 3, 25);         // 무릎까지 내려오는 팔
    R(12, 38, 3, 25); R(17, 38, 3, 25);        // 다리
    R(11, 62, 4, 2); R(17, 62, 4, 2);
    R(13, 8, 2, 2, '#e9e2b8'); R(17, 8, 2, 2, '#e9e2b8'); // 눈
  } else {
    const f = kind === 'flee1' ? 1 : -1;
    R(9, 5, 14, 2); R(12, 3, 8, 3);
    R(12, 7, 8, 8);
    R(15, 15, 2, 4);
    R(11 + f, 19, 10, 17);
    // 위로 꺾인 팔
    R(7, 12 + (f > 0 ? 0 : 6), 3, 12); R(5, 10 + (f > 0 ? 0 : 6), 3, 4);
    R(22, 12 + (f > 0 ? 6 : 0), 3, 12); R(24, 10 + (f > 0 ? 6 : 0), 3, 4);
    // 벌어진 다리
    R(11 + f * 2, 36, 3, 12); R(9 + f * 4, 47, 3, 13);
    R(18 - f * 2, 36, 3, 10); R(20 - f * 3, 45, 3, 9); R(21 - f * 3, 53, 5, 2);
    R(13, 10, 2, 2, '#e9e2b8'); R(17, 10, 2, 2, '#e9e2b8'); // 달아나면서도 이쪽을 보는 눈
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}
async function loadWitness() {
  const loader = new THREE.TextureLoader();
  for (const [key, file] of [['stare', 'witness_stare'], ['flee1', 'witness_flee_1'], ['flee2', 'witness_flee_2']]) {
    let t = null;
    if (await exists(`assets/${file}.png`)) {
      try { t = await loader.loadAsync(`assets/${file}.png`); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; } catch { t = null; }
    }
    witness.tex[key] = t || drawWitness(key);
    witness.tex[key].userData.bbox = alphaBBox(witness.tex[key].image);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bas({ map: witness.tex.stare, alphaTest: 0.5, side: THREE.DoubleSide }));
  m.visible = false; scene.add(m); witness.mesh = m;
}
function setWitnessTex(key) {
  const t = witness.tex[key], b = t.userData.bbox;
  const ph = CFG.witness.height / (b.y1 - b.y0), pw = ph * (t.image.width / t.image.height);
  witness.mesh.material.map = t;
  witness.mesh.scale.set(pw, ph, 1);
  witness.baseY = ph / 2 - (1 - b.y1) * ph;
}
const isFree = (x, z, r) => !colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r);
function spawnWitness() {
  if (S.state !== 'play' || witness.state !== 'none') return;
  // 남자 등 뒤에. 나무와 겹치지 않고 구역 안인 자리를 찾아요.
  let found = null;
  for (const dist of [CFG.witness.spawnDist, CFG.witness.spawnDist - 1.5, CFG.witness.spawnDist + 2]) {
    for (const da of [Math.PI, Math.PI - 0.5, Math.PI + 0.5, Math.PI - 1, Math.PI + 1, 2, -2, 1.5, -1.5]) {
      const a = player.yaw + da;
      const x = player.x - Math.sin(a) * dist, z = player.z - Math.cos(a) * dist;
      if (Math.hypot(x, z) < 27 && isFree(x, z, 0.6)) { found = { x, z }; break; }
    }
    if (found) break;
  }
  if (!found) return;
  witness.x = found.x; witness.z = found.z; witness.state = 'stare'; witness.t = 0;
  setWitnessTex('stare'); witness.mesh.visible = true;
  audio.gasp(found.x, 1.5, found.z);
}
function updateWitness(dt) {
  const w = witness; if (w.state !== 'stare' && w.state !== 'flee') return;
  w.t += dt;
  const dx = player.x - w.x, dz = player.z - w.z, d = Math.hypot(dx, dz);
  const m = w.mesh;
  const t8 = Math.floor(S.clock * 8);
  if (w.state === 'stare') {
    // 꼼짝 않고 서서 쳐다봐요. 가끔 한 장면씩 움찔해요.
    const twitch = hash2(t8, 11) > 0.93 ? 1 : 0;
    m.position.set(w.x, w.baseY, w.z);
    m.rotation.set(0, Math.atan2(dx, dz), twitch * 0.06);
    // 다가가거나, 그 앞에서 다시 불을 켜거나, 시간이 지나면 달아나요
    if (d < CFG.witness.fleeDist || (S.lit && w.t > 1.5) || w.t > CFG.witness.timeout) {
      w.state = 'flee'; w.t = 0; w.step = -1;
      // 남자 반대쪽, 숲 바깥을 향해
      const r = Math.hypot(w.x, w.z) || 1;
      let ax = -dx / d * 0.5 + (w.x / r) * 0.5, az = -dz / d * 0.5 + (w.z / r) * 0.5;
      const al = Math.hypot(ax, az) || 1;
      w.dirX = ax / al; w.dirZ = az / al;
      audio.yelp(w.x, 1.5, w.z);
      S.shake = Math.max(S.shake, 0.5);
    }
  } else {
    // 초당 8번, 뚝뚝 끊기며 지그재그로. 몸은 달아나는데 눈은 계속 이쪽을 봐요.
    if (t8 !== w.step) {
      w.step = t8;
      const stride = CFG.witness.speed / 8;
      const side = (t8 % 2 ? 1 : -1) * 0.45;
      w.x += w.dirX * stride + -w.dirZ * side; w.z += w.dirZ * stride + w.dirX * side;
      setWitnessTex(t8 % 2 ? 'flee1' : 'flee2');
      m.scale.x *= hash2(t8, 12) > 0.5 ? 1 : -1;
      m.position.set(w.x, w.baseY + (t8 % 2) * 0.12, w.z);
      m.rotation.set(0, Math.atan2(dx, dz), (t8 % 2 ? 1 : -1) * 0.28);
    }
    if (Math.hypot(w.x, w.z) > 34 || d > 30 || w.t > 8) { w.state = 'gone'; m.visible = false; }
  }
}

// ------------------------------------------------------------------ 화면 위에 겹치는 것 (손, 불꽃, 전체 화면 그림, 장막)
const hud = new THREE.Scene();
const hudCam = new THREE.OrthographicCamera(0, W, H, 0, -10, 10);
const unit = new THREE.PlaneGeometry(1, 1);
function quad(tex, order, opts = {}) {
  const m = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ map: tex || null, alphaTest: opts.opaque ? 0 : 0.5, depthTest: false, depthWrite: false, fog: false, color: opts.color ?? 0xffffff }));
  m.renderOrder = order; m.visible = false; hud.add(m);
  return m;
}
function rect(m, x, y, w, h) { m.scale.set(w, h, 1); m.position.set(x + w / 2, H - (y + h / 2), 0); }
function halfGeo(left) {
  const g = new THREE.PlaneGeometry(1, 1);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, left ? uv.getX(i) * 0.5 : 0.5 + uv.getX(i) * 0.5);
  return g;
}
const HUD = {};
function buildHud() {
  HUD.black = quad(null, 1, { opaque: true, color: 0x000000 });
  HUD.still = quad(TEX.title_keyart, 2, { opaque: true });
  HUD.still2 = quad(TEX.pocket_contents, 3, { opaque: true });
  HUD.gate = quad(TEX.part_gate_inside, 4, { opaque: true });
  HUD.veils = [1, 2, 3].map((i, k) => {
    const mk = (left) => {
      const m = new THREE.Mesh(halfGeo(left), new THREE.MeshBasicMaterial({ map: TEX[`veil_${i}`], depthTest: false, depthWrite: false, fog: false }));
      m.renderOrder = 9 - k; m.visible = false; hud.add(m); return m; // 앞 장막이 위에
    };
    return { l: mk(true), r: mk(false) };
  });
  HUD.doorL = quad(TEX.part_shell_door, 10); HUD.doorR = quad(TEX.part_shell_door, 10);
  HUD.wingL = quad(TEX.part_wing, 11); HUD.wingR = quad(TEX.part_wing, 11);
  HUD.sqL = quad(null, 12, { opaque: true, color: 0x000000 }); HUD.sqR = quad(null, 12, { opaque: true, color: 0x000000 });
  HUD.hand = quad(TEX.hand_open, 20);
  HUD.flame = quad(TEX.flame_1, 21);
  HUD.sparks = [];
  for (let i = 0; i < 6; i++) HUD.sparks.push({ m: quad(null, 22, { opaque: true, color: 0xffd45a }), life: 0, x: 0, y: 0, vx: 0, vy: 0 });
}
// 전체 화면 그림. zoom배 확대, (ox, oy)만큼 밀기
function showStill(m, tex, zoom = 1, ox = 0, oy = 0) {
  m.material.map = tex; m.visible = true;
  const w = W * zoom, h = H * zoom;
  rect(m, (W - w) / 2 + ox, (H - h) / 2 + oy, w, h);
}

// ------------------------------------------------------------------ 민트초코 장면
// 받은 그림 한 장(mint_start.png)에서 민트색 부분을 찾아, 아래로 녹아 흐르는 줄기와 떨어지는 방울을 코드로 그려요.
const MINT = { W: 416, H: 234, tex: null, frame: -1 };
function buildMintAnim() {
  const c = document.createElement('canvas'); c.width = MINT.W; c.height = MINT.H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false; g.drawImage(TEX.mint_start.image, 0, 0, MINT.W, MINT.H);
  const base = g.getImageData(0, 0, MINT.W, MINT.H), D = base.data;
  const isMint = (x, y) => { const i = (y * MINT.W + x) * 4; return D[i + 1] > D[i] + 18 && D[i + 2] > D[i] + 5 && D[i + 1] > 110; };
  const cols = []; // 민트색이 있는 세로줄마다: 가장 아래 민트색 위치와 그 색
  for (let x = 0; x < MINT.W; x++) {
    let yb = -1;
    for (let y = MINT.H - 1; y > 2; y--) if (isMint(x, y) && isMint(x, y - 1) && isMint(x, y - 2)) { yb = y; break; }
    if (yb < 0) continue;
    const i = (yb * MINT.W + x) * 4;
    const n = vnoise(x / 5.5, 3.3) * 0.75 + vnoise(x / 2.1, 9.1) * 0.25;
    cols.push({ x, yb, r: D[i], g: D[i + 1], b: D[i + 2], grow: Math.max(0, (n - 0.42) / 0.58) });
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  Object.assign(MINT, { c, g, base, cols, tex: t, out: g.createImageData(MINT.W, MINT.H) });
}
function updateMintAnim(time) {
  const f = Math.floor(Math.max(0, time) * 10); // 초당 10장
  if (f === MINT.frame) return;
  MINT.frame = f;
  const t = f / 10, O = MINT.out.data, W_ = MINT.W, H_ = MINT.H;
  O.set(MINT.base.data);
  const put = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W_ || y >= H_) return; const i = (y * W_ + x) * 4; O[i] = r; O[i + 1] = g; O[i + 2] = b; };
  const len = 9 + 34 * Math.pow(clamp(t / CFG.mintSeconds, 0, 1), 0.8);
  let tip = null;
  for (const c of MINT.cols) {
    const L = Math.round(c.grow * len);
    for (let k = 1; k <= L; k++) { const e = k === L ? 0.78 : 1; put(c.x, c.yb + k, c.r * e, c.g * e, c.b * e); }
    if (L > 2 && (!tip || c.yb + L > tip.y)) tip = { x: c.x, y: c.yb + L, c };
  }
  if (tip) { // 가장 길게 늘어진 줄기 끝에서 방울이 떨어져요
    const ph = (t % 1.1) / 1.1, y = Math.round(tip.y + 2 + ph * ph * (H_ - tip.y));
    for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) put(tip.x + j, y + k, tip.c.r, tip.c.g, tip.c.b);
  }
  MINT.g.putImageData(MINT.out, 0, 0);
  MINT.tex.needsUpdate = true;
}

// ------------------------------------------------------------------ 저해상도 화면 필터 (디더링, 노란 화면, 흐림)
const post = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postU = {
  tDiffuse: { value: rt.texture }, uRes: { value: new THREE.Vector2(W, H) }, uTime: { value: 0 },
  uYellow: { value: 0 }, uBlur: { value: 0 }, uFade: { value: 1 }, uWhite: { value: 0 }, uVig: { value: 0.35 }, uPulse: { value: 0 },
};
post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: postU, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes;
    uniform float uTime, uYellow, uBlur, uFade, uWhite, uVig, uPulse;
    varying vec2 vUv;
    float bayer(vec2 p) {
      int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
      mat4 b = mat4(0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
      return b[x][y] / 16.0;
    }
    void main() {
      vec2 uv = vUv;
      uv.x += sin(uv.y * 18.0 + uTime * 2.3) * 0.004 * uBlur;
      uv.y += cos(uv.x * 14.0 + uTime * 1.9) * 0.003 * uBlur;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (uBlur > 0.01) {
        vec2 px = uBlur * 2.2 / uRes;
        c = (c + texture2D(tDiffuse, uv + vec2(px.x, 0.)).rgb + texture2D(tDiffuse, uv - vec2(px.x, 0.)).rgb
               + texture2D(tDiffuse, uv + vec2(0., px.y)).rgb + texture2D(tDiffuse, uv - vec2(0., px.y)).rgb) / 5.0;
      }
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 y = vec3(1.1, 0.9, 0.2) * pow(l, 0.9) * 1.18;
      float wh = smoothstep(0.75, 0.98, min(c.r, min(c.g, c.b))); // 흰 빛은 노랗게 물들이지 않아요
      c = mix(c, y, uYellow * (1.0 - wh));
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - uVig * smoothstep(0.35, 0.85, d);
      c *= 1.0 - uPulse * smoothstep(0.05, 0.7, d);
      c = mix(c, vec3(1.0), uWhite);
      c *= 1.0 - uFade;
      float t = bayer(gl_FragCoord.xy) - 0.5;
      c = floor(c * 31.0 + 0.5 + t) / 31.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
})));

// ------------------------------------------------------------------ 상태
const audio = new GameAudio(CFG);
const S = {
  state: 'loading', clock: 0, stateT: 0, paused: false, cut: false,
  burned: 0, fuel: CFG.cicada.perLighter, lighter: 1, lit: false, strikeT: 0, strikeCool: 0,
  lineUntil: 0, lineToken: 0, heat: 0, swap: null, dip: 0, aim: 0, prompted: false,
  yellow: 0, blur: 0, sway: 0, speedScale: 1, inputLag: 0, pulse: 0, fade: 1, fadeTo: 1, fadeRate: 1.5,
  shake: 0, choiceT: 0, corrT: 0, inCorridor: false, white: 0, ending: null, veilP: 0, veilIntro: 0, timeScale: 1,
};
const player = { x: START.x, z: START.z, yaw: -START_A - Math.PI, pitch: 0, vx: 0, vz: 0, bob: 0, stepPhase: 0, y: CFG.player.eye, roll: 0 };
// 출발할 때 길을 따라 보게
player.yaw = Math.atan2(-(-Math.sin(START_A)), -(Math.cos(START_A))) ;

const keys = new Set();
const mouse = { dx: 0, dy: 0, held: false };
const timers = [];
const after = (sec, fn) => timers.push({ t: S.clock + sec, fn });
function setState(s) { S.state = s; S.stateT = 0; }
function fadeTo(v, sec) { S.fadeTo = v; S.fadeRate = 1 / Math.max(0.01, sec); }

// ------------------------------------------------------------------ 입력
const fireHeld = () => mouse.held || TP.fire || keys.has('KeyE') || keys.has('Space');
const PAUSABLE = new Set(['play', 'mint', 'reveal', 'choice', 'veil']);
let noLock = DEBUG || TOUCH; // 마우스 잠금을 못 쓰는 환경이면 화살표 키로 시점을 돌려요
function lock() {
  if (noLock || document.pointerLockElement === el.canvas) return;
  try { const p = el.canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => { noLock = true; if (S.paused) setPaused(false); }); } catch { noLock = true; }
}
document.addEventListener('pointerlockerror', () => { noLock = true; if (S.paused) setPaused(false); });
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR' && S.state === 'endcard') location.reload();
  if (e.code === 'KeyH' && S.paused) toggleShake();
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.held = false; });
function toggleShake() {
  CFG.reduceShake = !CFG.reduceShake;
  el.pauseShake.textContent = CFG.reduceShake ? (TOUCH ? TEXT.shakeOffTouch : TEXT.shakeOff) : (TOUCH ? TEXT.shakeOnTouch : TEXT.shakeOn);
}
// 시작과 일시정지 해제는 click에서 해요. 소리와 마우스 잠금은 click 안에서만 허용되는 곳이 있어서요.
el.stage.addEventListener('click', (e) => {
  if (S.state === 'title') { start(); return; }
  if (S.paused) {
    if (e.target === el.pauseShake) { toggleShake(); return; }
    lock(); if (noLock) setPaused(false);
  }
});
el.frame.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || S.state === 'title' || S.paused) return;
  if (PAUSABLE.has(S.state)) lock();
  mouse.held = true;
});

// ---------- 스마트폰 조작
// 화면 왼쪽 45%: 손가락을 댄 자리에 이동 스틱이 생겨요. 나머지: 밀면 시점이 돌아가요.
// 불 버튼: 누르고 있는 동안 불이 켜지고, 누른 채로 밀면 시점도 같이 돌아가요(불을 켠 채 매미를 겨눌 수 있게).
const TP = { joyId: null, jx: 0, jy: 0, lookId: null, fireId: null, last: new Map(), move: { x: 0, y: 0, run: false }, fire: false, usedJoy: false };
const JOY_R = 52, JOY_DEAD = 0.12, LOOK_GAIN = 2.3; // 스틱 반지름(px), 가운데 무시 구간, 시점 감도(마우스 대비)
function stagePoint(t) { // 화면을 돌렸을 때도 같은 좌표계로
  return SCREEN.rot ? { x: t.clientY, y: window.innerWidth - t.clientX } : { x: t.clientX, y: t.clientY };
}
function touchMode() {
  if (TOUCH) return;
  TOUCH = true; noLock = true; fitUi(); applyTexts();
}
function releaseTouches() {
  TP.joyId = TP.lookId = TP.fireId = null; TP.fire = false; TP.move.x = TP.move.y = 0; TP.move.run = false; TP.last.clear();
  el.joy.style.display = 'none'; el.fireBtn.classList.remove('on');
}
const touchPlaying = () => PAUSABLE.has(S.state) && !S.paused;
el.stage.addEventListener('touchstart', (e) => {
  touchMode();
  if (!touchPlaying()) return; // 시작 화면, 일시정지, 엔딩 화면은 click으로 처리해요
  e.preventDefault();
  for (const t of e.changedTouches) {
    const p = stagePoint(t);
    if (t.target === el.pauseBtn) { releaseTouches(); setPaused(true); return; }
    if (t.target === el.fireBtn && TP.fireId === null) { TP.fireId = t.identifier; TP.fire = true; TP.last.set(t.identifier, p); el.fireBtn.classList.add('on'); continue; }
    if (p.x < SCREEN.w * 0.45 && TP.joyId === null) {
      TP.joyId = t.identifier; TP.jx = p.x; TP.jy = p.y; TP.usedJoy = true;
      el.joy.style.display = 'block'; el.joy.style.left = p.x + 'px'; el.joy.style.top = p.y + 'px'; el.knob.style.transform = '';
      el.joyGhost.style.display = 'none';
    } else if (TP.lookId === null) { TP.lookId = t.identifier; TP.last.set(t.identifier, p); }
  }
}, { passive: false });
el.stage.addEventListener('touchmove', (e) => {
  if (!touchPlaying()) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    const p = stagePoint(t);
    if (t.identifier === TP.joyId) {
      let dx = p.x - TP.jx, dy = p.y - TP.jy;
      const d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / JOY_R);
      dx /= d; dy /= d;
      el.knob.style.transform = `translate(${dx * m * JOY_R}px, ${dy * m * JOY_R}px)`;
      // 가운데 12%는 무시하고, 살짝 밀 때는 천천히 끝까지 밀면 제 속도가 나게 해요
      const out = m < JOY_DEAD ? 0 : Math.pow((m - JOY_DEAD) / (1 - JOY_DEAD), 1.3);
      TP.move.x = dx * out; TP.move.y = -dy * out; TP.move.run = m > 0.96 && -dy > 0.5;
    } else if (t.identifier === TP.lookId || t.identifier === TP.fireId) {
      const l = TP.last.get(t.identifier);
      if (l) { mouse.dx += (p.x - l.x) * LOOK_GAIN; mouse.dy += (p.y - l.y) * LOOK_GAIN; }
      TP.last.set(t.identifier, p);
    }
  }
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === TP.joyId) { TP.joyId = null; TP.move.x = TP.move.y = 0; TP.move.run = false; el.joy.style.display = 'none'; }
    if (t.identifier === TP.lookId) TP.lookId = null;
    if (t.identifier === TP.fireId) { TP.fireId = null; TP.fire = false; el.fireBtn.classList.remove('on'); }
    TP.last.delete(t.identifier);
  }
}
el.stage.addEventListener('touchend', touchEnd);
el.stage.addEventListener('touchcancel', touchEnd);
document.addEventListener('gesturestart', (e) => e.preventDefault());
el.endRestart.addEventListener('click', () => location.reload());
window.addEventListener('mouseup', () => (mouse.held = false));
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === el.canvas) { mouse.dx += e.movementX; mouse.dy += e.movementY; }
});
document.addEventListener('pointerlockchange', () => {
  if (noLock) return;
  const locked = document.pointerLockElement === el.canvas;
  if (!locked && PAUSABLE.has(S.state)) setPaused(true);
  if (locked && S.paused) setPaused(false);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && PAUSABLE.has(S.state) && !DEBUG) { setPaused(true); document.exitPointerLock?.(); } });
function setPaused(p) {
  S.paused = p;
  el.pause.classList.toggle('on', p);
  mouse.held = false; keys.clear(); releaseTouches();
  if (audio.ready) p ? audio.suspend() : audio.resume();
}

// ------------------------------------------------------------------ 자막: 한 번에 두 줄까지만 보여요
function showLine(k) {
  const text = LINES[k]; if (!text) return;
  const parts = text.split('\n');
  const total = parts.reduce((n, p) => n + p.length, 0);
  const dur = clamp(total / CFG.line.charsPerSecond, CFG.line.minSeconds, CFG.line.maxSeconds);
  const token = ++S.lineToken;
  el.sub.innerHTML = '';
  let t = 0.1;
  const starts = parts.map((p) => { const s = t; t += (p.length / total) * dur; return s; });
  parts.forEach((p, i) => {
    const d = document.createElement('div');
    d.textContent = p; d.style.display = 'none';
    el.sub.appendChild(d);
    after(starts[i], () => { if (S.lineToken !== token) return; d.style.display = ''; requestAnimationFrame(() => d.classList.add('on')); });
    const off = i + 2 < parts.length ? starts[i + 2] : dur;
    after(off, () => { if (S.lineToken !== token) return; d.classList.remove('on'); d.style.display = i + 2 < parts.length ? 'none' : ''; });
  });
  S.lineUntil = S.clock + dur;
  after(dur + 1, () => { if (S.lineToken === token) el.sub.innerHTML = ''; });
}

// ------------------------------------------------------------------ 시작
async function boot() {
  el.titleStart.textContent = TEXT.loading;
  el.titleMain.textContent = CFG.song.title || '';
  await loadTextures();
  await Promise.all([loadVideo('mint', CFG.video.mint), loadVideo('tremble', CFG.video.tremble), loadVideo('membrane', CFG.video.membrane), loadVideo('swallow', CFG.video.swallow)]);
  buildExitLight(); buildWorld(); buildAshes(); buildMonster(); buildHud(); buildMintAnim();
  await loadWitness();
  booted = true; applyTexts();
  S.cut = true; setState('title'); fadeTo(0, 1.2);
  last = performance.now();
  requestAnimationFrame(loop);
}

let starting = false;
let booted = false;
function applyTexts() { // 컴퓨터와 스마트폰은 조작 안내 글이 달라요
  if (!booted) return;
  el.pauseTitle.textContent = TEXT.paused; el.pauseResume.textContent = TOUCH ? TEXT.resumeTouch : TEXT.resume;
  el.pauseShake.textContent = CFG.reduceShake ? (TOUCH ? TEXT.shakeOffTouch : TEXT.shakeOff) : (TOUCH ? TEXT.shakeOnTouch : TEXT.shakeOn);
  el.titleStart.textContent = TOUCH ? TEXT.startTouch : TEXT.start;
  el.titleHelp.innerHTML = `${TOUCH ? TEXT.controlsTouch : TEXT.controls}<br>${TEXT.headphones}`;
  el.fireBtn.textContent = TEXT.fire; el.joyGhost.textContent = '이동';
}
async function start() {
  if (starting) return; starting = true;
  el.titleStart.classList.remove('blink');
  // 아이폰은 화면을 누른 순간에 한 번 틀어 봐야 나중에 영상이 재생돼요.
  for (const k in VIDEO) { const v = VIDEO[k].v; const pr = v.play(); if (pr && pr.then) pr.then(() => { v.pause(); v.currentTime = 0; }).catch(() => {}); }
  await audio.init();
  for (const c of cicadas) c.audio = audio.addCicada(c.pos.x, c.pos.y, c.pos.z);
  lock();
  fadeTo(1, 0.8);
  el.title.classList.add('off');
  after(0.9, () => {
    S.cut = false; HUD.still.visible = false; HUD.black.visible = false;
    setState('play'); fadeTo(0, 2.5);
    audio.lidClick();
  });
}

// ------------------------------------------------------------------ 매미 태우기
const camFwd = new THREE.Vector3();
const tmp = new THREE.Vector3();
function findTarget() {
  let best = null, bd = 1e9;
  for (const c of cicadas) {
    if (c.state !== 'alive' && c.state !== 'burning') continue;
    tmp.copy(c.pos).sub(camera.position);
    const d = tmp.length();
    if (d > CFG.cicada.reach) continue;
    tmp.multiplyScalar(1 / d);
    if (tmp.dot(camFwd) < 0.78) continue;
    if (-tmp.dot(c.normal) < 0.1) continue;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function spark() {
  for (const s of HUD.sparks) { s.life = rr(0.12, 0.3); s.x = 0; s.y = 0; s.vx = rr(-70, 70); s.vy = rr(-110, -20); }
}
function updateLighter(dt, canUse) {
  S.strikeT = Math.max(0, S.strikeT - dt);
  S.strikeCool = Math.max(0, S.strikeCool - dt);
  const held = canUse && fireHeld() && !S.swap;
  if (!held) { S.lit = false; }
  else if (!S.lit && S.strikeCool <= 0) {
    S.strikeT = 0.16; S.strikeCool = 0.55; audio.flint(); spark();
    // 기름만 있으면 언제든 불이 붙어요.
    if (S.fuel > 0) { S.lit = true; audio.flameOn(); }
  }
  const target = canUse ? findTarget() : null;
  S.aim = lerp(S.aim, target ? 1 : 0, 1 - Math.exp(-dt * 8));
  const showPrompt = !!target && !S.lit && S.fuel > 0 && S.burned < 2;
  if (showPrompt) el.prompt.textContent = TOUCH ? TEXT.burnPromptTouch : TEXT.burnPrompt;
  if (S.state === 'play') el.prompt.classList.toggle('on', showPrompt || S.clock < S.hintUntil);
  for (const c of cicadas) {
    if (c.state === 'burning' && !(S.lit && c === target)) { // 불을 떼면 천천히 식어요
      c.burn -= dt * 0.6;
      if (c.burn <= 0) { c.burn = 0; c.state = 'alive'; c.mesh.material.map = TEX.cicada_alive; audio.setCicadaBurning(c.audio, false); }
    }
  }
  if (S.lit && target) {
    if (target.state === 'alive') { cutLine(); target.state = 'burning'; target.mesh.material.map = TEX.cicada_burning; audio.setCicadaBurning(target.audio, true); }
    target.burn += dt;
    if (rnd() < dt * 14) emitAsh(target.pos, true);
    if (target.burn >= CFG.cicada.burnSeconds) finishBurn(target);
  }
  audio.setBurning(cicadas.some((c) => c.state === 'burning' && S.lit && c === target));
}
function finishBurn(c) {
  c.state = 'dead'; c.mesh.material.map = TEX.cicada_dead;
  audio.stopCicada(c.audio);
  for (let i = 0; i < 10; i++) emitAsh(c.pos, false);
  S.burned++; S.fuel--;
  const k = S.burned;
  if (S.fuel <= 0) S.lit = false;
  after(0.9, () => { c.mesh.visible = false; c.state = 'gone'; S.dip = 1; audio.rustle(); }); // 주워서 주머니에
  after(0.6, () => showLine(k - 1));
  if (k === 3) after(1.4, startMint);
  if (k === CFG.witness.afterBurn) after(1.2, spawnWitness);
  if (k % CFG.cicada.perLighter === 0 && k < CFG.cicada.count) after(2.2, startSwap);
  if (k === CFG.cicada.count) after(1.6, startReveal);
}
// 다음 매미에 불을 대면 앞선 자막은 바로 접어요.
function cutLine() {
  if (!el.sub.childElementCount) return;
  const token = ++S.lineToken; S.lineUntil = 0;
  for (const d of el.sub.children) d.classList.remove('on');
  after(0.45, () => { if (S.lineToken === token) el.sub.innerHTML = ''; });
}
function startSwap() { S.swap = { t: 0, clicked: false, rustled: false }; }
function updateSwap(dt) {
  const w = S.swap; if (!w) return;
  w.t += dt * (fireHeld() ? 2.5 : 1); // 누르고 있으면 라이터를 서둘러 바꿔요
  const T = CFG.lighterSwapSeconds;
  if (!w.rustled && w.t > T * 0.35) { w.rustled = true; audio.rustle(); }
  if (!w.clicked && w.t > T * 0.72) { w.clicked = true; audio.lidClick(); }
  if (w.t >= T) {
    S.swap = null; S.fuel = CFG.cicada.perLighter; S.lighter++; S.heat = S.lighter - 1;
    audio.setBreath(S.heat);
  }
}
function startMint() {
  if (S.state !== 'play') return;
  setState('mint'); fadeTo(1, 0.35); S.mintArmed = false;
  after(0.4, () => {
    S.cut = true; HUD.black.visible = true; rect(HUD.black, 0, 0, W, H);
    if (VIDEO.mint) { VIDEO.mint.v.currentTime = 0; VIDEO.mint.v.play().catch(() => {}); }
    fadeTo(0, 0.5);
  });
}

// ------------------------------------------------------------------ 괴물 등장과 선택
function startReveal() {
  setState('reveal');
  if (witness.mesh) { witness.mesh.visible = false; witness.state = 'gone'; }
  S.lit = false;
  audio.setBreath(3);
  audio.fadeWorld(0.25, 3);
}
function spawnMonster() {
  // 보고 있는 방향 20m 앞. 구역 가장자리라 그만큼 떨어질 수 없으면 다른 방향을 찾아요.
  // 나가는 길과 같은 방향에는 세우지 않아요. 괴물과 흰 빛이 서로 다른 쪽에 보여야 하니까요.
  let x = 0, z = 0, found = false;
  const ex = XC - player.x, ez = ZG - player.z, eLen = Math.hypot(ex, ez) || 1;
  for (const strict of [true, false]) {
    for (const da of [0, 0.9, -0.9, 1.8, -1.8, Math.PI, 2.5, -2.5]) {
      const a = player.yaw + da;
      x = player.x - Math.sin(a) * CFG.monster.spawnDist; z = player.z - Math.cos(a) * CFG.monster.spawnDist;
      const r = Math.hypot(x, z);
      if (r > 28) { x *= 28 / r; z *= 28 / r; }
      const d = Math.hypot(x - player.x, z - player.z);
      const toward = ((x - player.x) * ex + (z - player.z) * ez) / (d * eLen);
      if (d >= 17 && (!strict || (toward < 0.35 && Math.hypot(x - XC, z - ZG) > 16))) { found = true; break; }
    }
    if (found) break;
  }
  monster.x = x; monster.z = z; monster.active = true; monster.stage = 0;
  setMonsterStage(0); monster.mesh.visible = true;
  audio.startMonster(x, 1.6, z);
}
function updateMonster(dt) {
  if (!monster.active) return;
  const dx = player.x - monster.x, dz = player.z - monster.z, d = Math.hypot(dx, dz);
  const M = CFG.monster;
  monster.moving = d > M.stopDist && !S.inCorridor; // 나가는 길로는 따라오지 않아요
  if (monster.moving) {
    const sp = CFG.player.walk * M.speedRatio * dt;
    monster.x += (dx / d) * sp; monster.z += (dz / d) * sp;
  }
  if (S.state === 'choice' && d > 27 && !S.inCorridor && player.z > -26) { // 멀리 달아나면 시야 밖에서 다시 나타나요
    const a = player.yaw + Math.PI + rr(-0.7, 0.7);
    monster.x = player.x - Math.sin(a) * 18; monster.z = player.z - Math.cos(a) * 18;
  }
  if (S.state === 'choice' && monster.stage < 3 && d < M.stageDist[monster.stage]) {
    monster.stage++; monster.flick = 0.45; monster.lurch = 1; S.shake = Math.max(S.shake, 1);
    audio.stageHit();
  }
  // 그림을 초당 8번만 갱신해서 끊기는 움직임으로
  const t8 = Math.floor(S.clock * 8) / 8;
  monster.flick = Math.max(0, monster.flick - dt);
  monster.lurch = Math.max(0, monster.lurch - dt * 2.2);
  const showStage = monster.flick > 0 && Math.floor(S.clock * 16) % 2 === 0 ? monster.stage - 1 : monster.stage;
  setMonsterStage(Math.max(0, showStage));
  const m = monster.mesh;
  const bobY = monster.moving ? Math.abs(Math.sin(t8 * 5.2)) * 0.07 : Math.sin(t8 * 1.3) * 0.015;
  m.position.set(monster.x, monster.baseY + bobY, monster.z);
  m.rotation.set(0, Math.atan2(dx, dz), monster.moving ? Math.sin(t8 * 5.2) * 0.035 : Math.sin(t8 * 0.9) * 0.012);
  const k = 1 + monster.lurch * 0.16;
  m.scale.x *= k; m.scale.y *= k;
  // 멀리서는 노란 안개 속 어두운 실루엣, 다가갈수록 제 색이 드러나요
  m.material.color.setScalar(lerp(0.3, 1, smooth((13 - d) / 9)));
  audio.setMonster(monster.x, 1.6, monster.z, monster.stage);
  if (S.state === 'choice' && d < M.enterDist) startVeil();
}

// ------------------------------------------------------------------ 접근 엔딩
function startVeil() {
  setState('veil'); S.ending = 'approach';
  S.veilP = 0; S.veilIntro = 0; S.veilTorn = 0; S.wingSound = false; S.sqSound = false; S.swallowPlaying = false;
  S.cut = true; S.shake = 1.5;
  monster.active = false; monster.mesh.visible = false; exitGate.light.visible = false;
  audio.stageHit(); audio.stopMonster(1.5); audio.setWet(true); audio.setBreath(1);
  HUD.black.visible = true; rect(HUD.black, 0, 0, W, H);
  el.prompt.classList.remove('on');
}
const VEIL_PARTS = ['doorL', 'doorR', 'wingL', 'wingR', 'sqL', 'sqR'];
function endVeil() {
  HUD.veils.forEach((v) => (v.l.visible = v.r.visible = false));
  for (const k of VEIL_PARTS) HUD[k].visible = false;
  HUD.gate.visible = false; HUD.gate.material.color.setScalar(1);
  audio.setWet(false);
  setState('black');
}
// 먹혀 들어가는 순서:
// 문 안쪽이 다가옴 → 껍질 문짝이 양옆에서 닫힘 → 마른 막(1) → 날개가 얼굴을 쓸고 지나감
// → 젖은 막(2)은 늘어나다가 한 번에 찢어짐 → 무거운 막(3)은 맥박처럼 뛰며 느리게 열림 → 붉은 안쪽이 양옆에서 조여 옴 → 암전
function updateVeil(dt) {
  const A = CFG.approachEnding;
  S.veilIntro += dt;
  const intro = clamp(S.veilIntro / 1.6, 0, 1);
  const p0 = S.veilP;
  if (intro >= 1) {
    if (p0 < 3) {
      const fwd = keys.has('KeyW') || keys.has('ArrowUp') || TP.move.y > 0.3;
      const heavy = [1, 0.75, 0.5][Math.min(2, Math.floor(p0))]; // 안쪽 막일수록 무거워서 느려요
      S.veilP = Math.min(3, p0 + dt * heavy * (fwd ? 3 / A.veilSeconds : 0.15)); // 가만히 있어도 천천히 끌려 들어가요
    } else S.veilP = p0 + dt / A.squeezeSeconds; // 마지막에는 저절로 조여 와요
  }
  // 영상이 있으면: 문 안쪽이 다가오고 문짝이 닫혀 첫 막이 화면을 덮는 데까지는 코드로 그리고,
  // 그 화면에서 이어지는 영상을 틀어요. 그래서 플레이어가 어디에 서 있었든 영상 앞뒤가 맞아요.
  if (VIDEO.swallow && intro >= 1) {
    const v = VIDEO.swallow.v;
    if (!S.swallowPlaying) {
      S.swallowPlaying = true; S.swallowT = 0; v.currentTime = 0; v.play().catch(() => {});
      HUD.veils.forEach((x) => (x.l.visible = x.r.visible = false));
      for (const k of VEIL_PARTS) HUD[k].visible = false;
      HUD.gate.visible = false;
    }
    S.swallowT += dt; S.veilP = p0;
    showStill(HUD.still, VIDEO.swallow.t, 1);
    if (v.ended || S.swallowT > (v.duration || 8) + 0.3) { HUD.still.visible = false; endVeil(); }
    return;
  }
  const p = S.veilP;
  const beat = Math.pow(Math.max(0, Math.sin(S.clock * 5.2)), 6); // 맥박

  // 문 안쪽 그림: 처음엔 다가오다가 첫 장막에 가려지고, 마지막 막 뒤에서는 붉게 다시 보여요
  if (p < 2) {
    const gz = lerp(1.0, 3.2, smooth(intro));
    const gh = H * gz, gw = gh * 0.5;
    HUD.gate.visible = intro < 0.6;
    HUD.gate.material.color.setScalar(1 - smooth(intro / 0.6));
    rect(HUD.gate, (W - gw) / 2, (H - gh) / 2, gw, gh);
  } else {
    const gz = 3.4 + (p - 2) * 0.9 + beat * 0.06;
    const gh = H * gz, gw = gh * 0.5, br = 0.55 + 0.25 * beat;
    HUD.gate.visible = true;
    HUD.gate.material.color.setRGB(br, br * 0.16, br * 0.12);
    rect(HUD.gate, (W - gw) / 2, (H - gh) / 2, gw, gh);
  }

  // 껍질 문짝: 양옆에서 닫혀 들어왔다가, 첫 막을 지나는 동안 뒤로 밀려나요
  const close = smooth((intro - 0.3) / 0.6), pass = smooth(p / 1.1);
  const dvis = close > 0 && p < 1.1;
  HUD.doorL.visible = HUD.doorR.visible = dvis;
  if (dvis) {
    const dh = H * 1.25 * (1 + pass * 0.5), dw = dh * 0.5;
    const inner = lerp(-8, W * 0.3, close) - pass * W * 0.45; // 왼쪽 문짝의 안쪽 가장자리
    const db = 0.5 * (1 - pass * 0.7);
    HUD.doorL.material.color.setScalar(db); HUD.doorR.material.color.setScalar(db);
    rect(HUD.doorL, inner - dw, (H - dh) / 2, dw, dh);
    rect(HUD.doorR, W - inner, (H - dh) / 2, dw, dh); HUD.doorR.scale.x *= -1;
  }

  // 장막 세 겹
  HUD.veils.forEach((v, i) => {
    const q = clamp(p - i, 0, 1);
    const vis = intro > 0.6 && p < i + 1 && p > i - 1;
    v.l.visible = v.r.visible = vis;
    if (!vis) return;
    const behind = clamp(i - p, 0, 1); // 아직 뒤에 있는 장막은 어둡고 조금 작게
    const appear = i === 0 ? smooth((intro - 0.6) / 0.4) : 1;
    const b = lerp(1, 0.3, behind) * appear;
    v.l.material.color.setScalar(b); v.r.material.color.setScalar(b);
    let sc = lerp(1.12, 1.0, behind), open = smooth(q), wobAmp = 1.5;
    if (i === 1) { // 젖은 막: 얼굴에 달라붙어 늘어나다가 한 번에 찢어져요
      const stretch = clamp(q / 0.45, 0, 1);
      sc *= 1 + 0.14 * stretch * stretch; wobAmp = 1.5 + 3 * stretch;
      open = q < 0.45 ? 0 : 1 - Math.pow(1 - (q - 0.45) / 0.55, 3);
    } else if (i === 2) { sc *= 1 + 0.03 * beat * (1 - behind); wobAmp = 0.8; } // 무거운 막: 맥박처럼 뛰어요
    const w = (W / 2) * sc, h = H * sc, cx = W / 2, top = (H - h) / 2;
    const off = open * (W / 2 + 8);
    const wob = Math.sin(S.clock * 3 + i) * wobAmp * (1 - behind);
    rect(v.l, cx - w - off, top + wob, w, h);
    rect(v.r, cx + off, top - wob, w, h);
  });

  // 날개: 첫 막과 둘째 막 사이에서 양옆의 날개가 얼굴을 쓸고 지나가요
  const wu = (p - 0.85) / 0.75, wvis = wu > 0 && wu < 1;
  HUD.wingL.visible = HUD.wingR.visible = wvis;
  if (wvis) {
    const wh = H * 1.5, ww = wh * 0.25, e = wu * wu;
    const x = lerp(W * 0.5 - ww * 0.9, -ww * 1.6, e), y = lerp(-H * 0.2, -H * 0.05, wu);
    const wb = 0.42;
    HUD.wingL.material.color.setScalar(wb); HUD.wingR.material.color.setScalar(wb);
    rect(HUD.wingL, x, y, ww, wh); HUD.wingL.rotation.z = lerp(-0.35, 0.5, wu);
    rect(HUD.wingR, W - x - ww, y, ww, wh); HUD.wingR.scale.x *= -1; HUD.wingR.rotation.z = -lerp(-0.35, 0.5, wu);
    if (!S.wingSound) { S.wingSound = true; audio.rustle(); S.shake = Math.max(S.shake, 0.5); }
  }

  // 찢어지는 소리: 막마다 찢어지는 시점이 달라요
  const tearAt = [0.08, 1.45, 2.12];
  if (S.veilTorn < 3 && p > tearAt[S.veilTorn]) { S.veilTorn++; audio.tear(); S.shake = Math.max(S.shake, S.veilTorn === 2 ? 1.4 : 0.8); }

  // 마지막: 붉은 안쪽이 양옆에서 조여 와요
  const sq = clamp(p - 3, 0, 1);
  HUD.sqL.visible = HUD.sqR.visible = sq > 0;
  if (sq > 0) {
    const sw = Math.ceil((W / 2) * (sq < 0.75 ? smooth(sq / 0.75) * 0.82 : lerp(0.82, 1, (sq - 0.75) / 0.25)) + beat * 3);
    rect(HUD.sqL, 0, 0, sw, H); rect(HUD.sqR, W - sw, 0, sw, H);
    S.shake = Math.max(S.shake, 0.6 * sq);
    if (!S.sqSound) { S.sqSound = true; audio.stageHit(); }
  }
  if (p >= 4) endVeil();
}
function updateMembrane() {
  const t = S.stateT;
  if (VIDEO.membrane) { // 영상이 있으면 정지 그림 세 장 대신 영상을 틀어요
    const v = VIDEO.membrane.v;
    showStill(HUD.still, VIDEO.membrane.t, 1);
    if (v.ended || t > (v.duration || 5) + 0.3) landFinal();
    return;
  }
  if (t < 1.9) { // 막이 부풀어 오름
    const j = Math.floor(S.clock * 12);
    showStill(HUD.still, TEX.membrane_start, 1 + t * 0.03, (hash2(j, 1) - 0.5) * 3 * shakeMul(), (hash2(j, 2) - 0.5) * 3 * shakeMul());
    if (!S.tornFinal && t > 1.6) { S.tornFinal = true; audio.tear(); }
  } else if (t < 2.6) showStill(HUD.still, TEX.ending_swallow_mid, 1.02);
  else landFinal();
}
function landFinal() {
  showStill(HUD.still, TEX.ending_swallow, 1);
  audio.thud(); audio.setBreath(0); S.shake = 0;
  setState('hold');
}

// ------------------------------------------------------------------ 도망 엔딩
function startCollapse() {
  setState('collapse'); S.ending = 'run';
  el.prompt.classList.remove('on');
  audio.stopMonster(2); audio.ring(7);
}
// 엔딩 글(나레이션 + 크레딧)을 아래에서 위로 올려요. 곡이 시작되는 순간부터 곡이 끝날 때까지 걸리게 맞춰요.
function startRoll(lines, pocketIndex = -1) {
  el.scrollInner.innerHTML = '';
  const all = [...lines, '', '', '', ...CREDITS];
  all.forEach((t) => { const d = document.createElement('div'); d.textContent = t; el.scrollInner.appendChild(d); });
  el.scroll.classList.add('on');
  const fh = el.frame.clientHeight, ih = el.scrollInner.offsetHeight;
  const line = el.scrollInner.children[pocketIndex];
  const hasSong = audio.playSong();
  S.scroll = {
    fh, ih, t: 0, hasSong,
    dur: hasSong ? Math.max(10, audio.songLength - 0.4) : CFG.rollSeconds,
    pocketAt: line ? (0.45 * fh + line.offsetTop) / (fh + ih) : 2,
  };
}
// 0~1로 진행도를 돌려줘요. 곡이 있으면 곡의 시계를 따라가서 글과 곡이 어긋나지 않아요.
function updateRoll(dt) {
  const sc = S.scroll;
  sc.t += dt;
  const s = clamp((sc.hasSong ? audio.songTime : sc.t) / sc.dur, 0, 1);
  el.scrollInner.style.transform = `translateY(${Math.round(sc.fh - s * (sc.fh + sc.ih))}px)`;
  if (s >= 1 && !S.endQueued) { S.endQueued = true; showEndCard(); }
  return s;
}
function updateRunEnding(dt) {
  const R = CFG.runEnding, t = S.stateT;
  let zoom = R.zoomFrom, ox = 0, oy = 0;
  if (t < R.trembleSeconds) { // 부르르 떨다가 멈춤
    const amp = 2.4 * Math.pow(1 - t / R.trembleSeconds, 0.6) * shakeMul();
    const j = Math.floor(S.clock * 14);
    ox = (hash2(j, 3) - 0.5) * 2 * amp; oy = (hash2(j, 4) - 0.5) * 2 * amp;
  } else zoom = lerp(R.zoomFrom, 1, smooth((t - R.trembleSeconds) / R.zoomSeconds));
  const useVideo = VIDEO.tremble && t < R.trembleSeconds;
  if (useVideo && VIDEO.tremble.v.paused && !VIDEO.tremble.v.ended) VIDEO.tremble.v.play().catch(() => {});
  showStill(HUD.still, useVideo ? VIDEO.tremble.t : TEX.ending_run, zoom, ox, oy);
  if (t >= R.trembleSeconds) { // 떨림이 멎는 순간 곡과 사망 기록이 같이 시작돼요
    if (!S.scroll) startRoll(DEATH_RECORD, POCKET_LINE_INDEX);
    const s = updateRoll(dt), sc = S.scroll;
    const pc = R.pocketCut ? s - sc.pocketAt : -1, pdur = R.pocketSeconds / sc.dur;
    HUD.still2.visible = pc > 0 && pc < pdur;
    if (HUD.still2.visible) showStill(HUD.still2, TEX.pocket_contents, 1.04 - (pc / pdur) * 0.04);
  }
}
// 접촉 엔딩의 마무리: 흰 바닥 화면 위로 나레이션과 크레딧이 올라가요.
function updateHold(dt) {
  const t = S.stateT, A = CFG.approachEnding;
  const z = 1 + Math.min(0.06, t * 0.0015);
  // 영상이 있으면 영상의 마지막 화면을 그대로 두어서, 정지 그림으로 바뀌며 튀는 일이 없게 해요.
  showStill(HUD.still, VIDEO.membrane ? VIDEO.membrane.t : TEX.ending_swallow, z);
  if (t >= A.holdSeconds) {
    if (!S.scroll) startRoll(APPROACH_RECORD);
    updateRoll(dt);
  }
}
function showEndCard() {
  setState('endcard');
  fadeTo(1, 2);
  el.scroll.classList.remove('on');
  el.endTitle.textContent = CFG.song.title; el.endArtist.textContent = CFG.song.artist;
  if (CFG.song.link) { el.endLink.href = CFG.song.link; el.endLink.textContent = CFG.song.linkLabel || CFG.song.link; el.endUrl.textContent = CFG.song.link; }
  else el.endLink.style.display = 'none';
  el.endRestart.textContent = TOUCH ? TEXT.restartTouch : TEXT.restart;
  const img = new Image();
  img.onload = () => { el.endCover.src = img.src; el.endCover.style.display = 'block'; };
  img.src = CFG.albumCover;
  el.end.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => el.end.classList.add('show')));
  document.exitPointerLock?.();
}

// ------------------------------------------------------------------ 걷기
const shakeMul = () => (CFG.reduceShake ? 0.15 : 1);
function updatePlayer(dt, canMove) {
  const sens = 0.0022;
  player.yaw -= mouse.dx * sens; player.pitch = clamp(player.pitch - mouse.dy * sens, -1.2, 1.2);
  if (noLock || document.pointerLockElement !== el.canvas) { // 마우스 잠금이 없을 때는 화살표로 시점
    if (keys.has('ArrowLeft')) player.yaw += dt * 1.8;
    if (keys.has('ArrowRight')) player.yaw -= dt * 1.8;
  }
  mouse.dx = mouse.dy = 0;
  let ix = 0, iz = 0;
  if (canMove) {
    ix = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    iz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    ix += TP.move.x; iz += TP.move.y; // 스마트폰 스틱은 민 만큼만 움직여요
  }
  const len = Math.max(1, Math.hypot(ix, iz));
  const run = (keys.has('ShiftLeft') || TP.move.run) && S.heat < 2 && iz > 0;
  const speed = (run ? CFG.player.run : CFG.player.walk) * S.speedScale;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const tx = ((fx * iz + rx * ix) / len) * speed, tz = ((fz * iz + rz * ix) / len) * speed;
  const k = S.inputLag > 0 ? 1 - Math.exp(-dt / S.inputLag) : 1 - Math.exp(-dt / 0.06);
  player.vx += (tx - player.vx) * k; player.vz += (tz - player.vz) * k;
  player.x += player.vx * dt; player.z += player.vz * dt;
  const pr = CFG.player.radius;
  for (const c of colliders) {
    const dx = player.x - c.x, dz = player.z - c.z, min = c.r + pr;
    if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
    const d = Math.hypot(dx, dz);
    if (d < min && d > 1e-4) { player.x = c.x + (dx / d) * min; player.z = c.z + (dz / d) * min; }
  }
  if (exitGate.open && Math.abs(player.x - XC) < 1.9 && player.z < -28.5) { // 나가는 길 위
    player.x = clamp(player.x, XC - 1.7, XC + 1.7);
    if (player.z < ZP0 - WRAP_S) player.z += PERIOD; // 풍경이 똑같은 한 주기 뒤로 되돌려요
    S.inCorridor = player.z < ZG - 1.5;
  } else {
    S.inCorridor = false;
    const r = Math.hypot(player.x, player.z);
    if (r > CFG.zoneRadius) { player.x *= CFG.zoneRadius / r; player.z *= CFG.zoneRadius / r; }
  }
  const v = Math.hypot(player.vx, player.vz);
  if (v > 0.4) {
    player.bob += dt * v * 2.5;
    const ph = Math.floor(player.bob / Math.PI);
    if (ph !== player.stepPhase) { player.stepPhase = ph; if (audio.ready) audio.step(S.heat >= 2); }
  }
}
function placeCamera() {
  const v = Math.hypot(player.vx, player.vz);
  const bobAmt = Math.min(1, v / CFG.player.walk);
  const sm = shakeMul();
  const sway = S.sway * sm;
  const j = Math.floor(S.clock * 20);
  const sh = S.shake * sm;
  camera.position.set(player.x, player.y + Math.sin(player.bob * 2) * 0.035 * bobAmt, player.z);
  camera.rotation.set(
    player.pitch + (hash2(j, 5) - 0.5) * 0.03 * sh + Math.sin(S.clock * 0.7) * 0.012 * sway,
    player.yaw + (hash2(j, 6) - 0.5) * 0.03 * sh,
    player.roll + Math.sin(S.clock * 0.9) * 0.03 * sway + Math.cos(player.bob) * 0.006 * bobAmt
  );
  camera.fov = 62 + Math.sin(S.clock * 1.7) * 2.6 * sway;
  camera.updateProjectionMatrix();
  camera.getWorldDirection(camFwd);
  if (audio.ready) audio.setListener(player.x, player.y, player.z, -Math.sin(player.yaw), -Math.cos(player.yaw));
}

// 손, 불꽃, 불똥
const HAND = { x: 278, y: 99, size: 159, wickX: 116 / 256, wickY: 66 / 256 };
function updateHand(dt) {
  const show = !S.cut && S.state !== 'collapse';
  HUD.hand.visible = show;
  let down = 0; // 화면 아래로 내려가는 정도
  if (S.swap) { const u = S.swap.t / CFG.lighterSwapSeconds; down = u < 0.16 ? smooth(u / 0.16) : u > 0.84 ? 1 - smooth((u - 0.84) / 0.16) : 1; }
  S.dip = Math.max(0, S.dip - dt * 1.6);
  const dip = Math.sin(clamp(S.dip, 0, 1) * Math.PI) * 0.5;
  const v = Math.hypot(player.vx, player.vz), bobAmt = Math.min(1, v / CFG.player.walk);
  const x = Math.round(HAND.x - S.aim * 34 + Math.cos(player.bob) * 3 * bobAmt);
  const y = Math.round(HAND.y - S.aim * 22 + Math.abs(Math.sin(player.bob)) * 4 * bobAmt + (down + dip) * 150);
  HUD.hand.material.map = S.strikeT > 0 ? TEX.hand_strike : TEX.hand_open;
  rect(HUD.hand, x, y, HAND.size, HAND.size);
  // 불꽃: 심지 위에. 기름이 줄수록 작아져요.
  const used = CFG.cicada.perLighter - S.fuel;
  const fs = [1, 0.84, 0.68, 0.52][clamp(used, 0, 3)];
  const fk = `flame_${1 + (Math.floor(S.clock * 9) % 3)}`;
  const fb = BBOX[fk];
  HUD.flame.visible = show && S.lit;
  if (HUD.flame.visible) {
    const fh = 54 * fs, fw = fh / 2;
    const wx = x + HAND.wickX * HAND.size, wy = y + HAND.wickY * HAND.size;
    HUD.flame.material.map = TEX[fk];
    rect(HUD.flame, Math.round(wx - fw * ((fb.x0 + fb.x1) / 2)), Math.round(wy - fh * fb.y1 + 2), fw, fh);
  }
  const wx = x + HAND.wickX * HAND.size + 6, wy = y + HAND.wickY * HAND.size + 4;
  for (const s of HUD.sparks) {
    s.life -= dt; s.m.visible = show && s.life > 0;
    if (!s.m.visible) continue;
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 260 * dt;
    rect(s.m, Math.round(wx + s.x), Math.round(wy + s.y), 1, 1);
  }
  // 라이터 불빛
  const flick = 0.85 + hash2(Math.floor(S.clock * 10), 9) * 0.3;
  lighterLight.intensity = S.lit && show ? 3.2 * fs * flick : 0;
  lighterLight.position.copy(camera.position).addScaledVector(camFwd, 0.55);
  lighterLight.position.y -= 0.12;
}

// ------------------------------------------------------------------ 매 프레임
let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000) * S.timeScale;
  last = now;
  if (S.paused) dt = 0;
  S.clock += dt; S.stateT += dt;
  for (let i = timers.length - 1; i >= 0; i--) if (S.clock >= timers[i].t) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  update(dt);
  S.fade += clamp(S.fadeTo - S.fade, -S.fadeRate * dt, S.fadeRate * dt);
  S.shake = Math.max(0, S.shake - dt * 2.5);
  postU.uTime.value = S.clock; postU.uFade.value = S.fade;
  el.stage.classList.toggle('playing', touchPlaying()); // 스마트폰 조작 버튼은 플레이 중에만 보여요
  postU.uYellow.value = S.cut ? 0 : S.yellow; postU.uBlur.value = S.cut ? 0 : S.blur * (CFG.reduceShake ? 0.4 : 1); postU.uPulse.value = S.cut ? 0 : S.pulse; postU.uWhite.value = S.cut ? 0 : S.white;
  postU.uVig.value = S.cut ? 0.15 : 0.35 + S.heat * 0.08;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(S.cut ? 0x000000 : scene.fog.color, 1);
  renderer.clear();
  if (!S.cut) renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(hud, hudCam);
  renderer.setRenderTarget(null);
  renderer.render(post, postCam);
}

function update(dt) {
  const st = S.state;
  // 더위 단계에 따른 기본값
  let yellow = [0, 0, 0.2, 0.2][S.heat] ?? 0.2, blur = [0, 0, 0.12, 0.12][S.heat] ?? 0.12, sway = [0, 0.15, 0.4, 0.4][S.heat] ?? 0.4;
  let speedScale = [1, 0.96, 0.9, 0.9][S.heat] ?? 0.9, lag = 0, pulse = 0, white = 0;

  if (st === 'title') {
    showStill(HUD.still, TEX.title_keyart, 1.03 + Math.sin(S.clock * 0.25) * 0.02);
    return;
  }
  if (st === 'play') {
    updatePlayer(dt, true); placeCamera(); updateLighter(dt, true); updateSwap(dt); updateWitness(dt);
  } else if (st === 'mint') {
    placeCamera();
    if (S.cut) {
      const u = clamp((S.stateT - 0.4) / CFG.mintSeconds, 0, 1);
      // 버튼을 뗐다가 다시 누르면 이 장면을 바로 끝내요.
      if (!fireHeld()) S.mintArmed = true;
      else if (S.mintArmed && S.stateT > 0.9) S.stateT = Math.max(S.stateT, CFG.mintSeconds);
      if (VIDEO.mint) showStill(HUD.still, VIDEO.mint.t, 1 + u * 0.1);
      else {
        updateMintAnim(S.stateT - 0.4);
        const j = Math.floor(S.clock * 6);
        showStill(HUD.still, MINT.tex, 1.04 + u * 0.08, Math.round(Math.sin(S.clock * 1.1) * 2), Math.round((hash2(j, 21) - 0.5) * 1.2));
      }
      if (S.stateT > 0.4 + CFG.mintSeconds - 0.4 && S.fadeTo === 0) fadeTo(1, 0.35);
      if (S.stateT > 0.4 + CFG.mintSeconds) { S.cut = false; HUD.still.visible = false; HUD.black.visible = false; setState('play'); fadeTo(0, 0.6); }
    }
  } else if (st === 'reveal') {
    const t = S.stateT, u = smooth((t - 2) / 5);
    yellow = lerp(yellow, 0.82, u); blur = lerp(blur, 0.45, u); sway = lerp(sway, 1, u); speedScale = lerp(speedScale, 0.85, u); lag = 0.25 * u;
    scene.fog.color.lerpColors(FOG_A, FOG_B, u); scene.fog.density = lerp(0.062, 0.05, u);
    if (!monster.active && t > 6) { spawnMonster(); openExit(); }
    updatePlayer(dt, true); placeCamera(); updateLighter(dt, true); updateMonster(dt); updateExit(dt);
    if (S.inCorridor) S.corrT += dt;
    if (t >= CFG.reveal.seconds) { setState('choice'); S.choiceT = 0; }
  } else if (st === 'choice') {
    S.choiceT += dt;
    if (S.inCorridor) S.corrT += dt;
    // 나가는 길을 걸은 시간만큼 몸이 무너져요. 숲 안에 머무는 동안에는 더 나빠지지 않아요.
    const f = clamp(S.corrT / CFG.corridor.seconds, 0, 1);
    white = S.inCorridor ? 0.08 + 0.3 * f * f : 0;
    yellow = 0.82 + 0.14 * f; blur = 0.45 + 0.5 * f; sway = 1 + f * 0.6; speedScale = lerp(0.85, 0.45, f); lag = 0.25;
    pulse = f > 0.6 ? ((f - 0.6) / 0.4) * (0.55 + 0.45 * Math.sin(S.clock * 3.2)) : 0;
    updatePlayer(dt, true); placeCamera(); updateLighter(dt, true); updateMonster(dt); updateExit(dt);
    if (S.state === 'choice' && (f >= 1 || S.choiceT >= CFG.choiceSeconds)) startCollapse();
  } else if (st === 'collapse') {
    const t = S.stateT, u = clamp(t / 0.95, 0, 1), e = u * u;
    yellow = 0.96; blur = 1; pulse = e; white = S.white;
    player.roll = e * 1.35; player.y = lerp(CFG.player.eye, 0.2, e); player.pitch = lerp(player.pitch, -0.25, e);
    player.vx *= 0.9; player.vz *= 0.9;
    placeCamera(); updateMonster(0); updateExit(dt);
    if (!S.fell && t > 0.9) { S.fell = true; audio.thud(); audio.setBreath(0); fadeTo(1, 0.25); }
    if (t > 1.5) {
      S.cut = true; monster.mesh.visible = false; monster.active = false; exitGate.light.visible = false;
      HUD.black.visible = true; rect(HUD.black, 0, 0, W, H);
      setState('runEnd'); fadeTo(0, 0.5);
    }
  } else if (st === 'runEnd') {
    updateRunEnding(dt);
  } else if (st === 'veil') {
    updateVeil(dt);
  } else if (st === 'black') {
    HUD.still.visible = false; HUD.gate.visible = false;
    if (S.stateT >= CFG.approachEnding.blackSeconds) {
      setState('membrane');
      if (VIDEO.membrane) { VIDEO.membrane.v.currentTime = 0; VIDEO.membrane.v.play().catch(() => {}); }
    }
  } else if (st === 'membrane') {
    updateMembrane();
  } else if (st === 'hold') {
    updateHold(dt);
  }
  if (st !== 'play' && st !== 'reveal' && st !== 'choice') S.lit = false;
  const k = 1 - Math.exp(-dt * 2);
  S.yellow = lerp(S.yellow, yellow, k); S.blur = lerp(S.blur, blur, k); S.sway = lerp(S.sway, sway, k);
  S.speedScale = speedScale; S.inputLag = lag; S.pulse = pulse; S.white = lerp(S.white, white, k);
  updateHand(dt);
  for (const a of ashes) {
    if (a.life <= 0) continue;
    a.life -= dt; a.m.position.addScaledVector(a.v, dt); a.m.rotation.y = player.yaw;
    if (a.life <= 0) a.m.visible = false;
  }
}

// ------------------------------------------------------------------ 점검용 (콘솔에서 G.~ 로 호출)
window.G = {
  S, CFG, player, monster, witness, cicadas, audio, VIDEO,
  faceWitness() { player.yaw = Math.atan2(-(witness.x - player.x), -(witness.z - player.z)); player.pitch = 0; },
  // n번째로 남은 매미 앞으로 이동
  goCicada(n = 0) {
    const c = cicadas.filter((x) => x.state === 'alive')[n]; if (!c) return false;
    player.x = c.pos.x + c.normal.x * 1.2; player.z = c.pos.z + c.normal.z * 1.2;
    player.yaw = Math.atan2(c.normal.x, c.normal.z); player.pitch = Math.atan2(c.pos.y - player.y, 1.2) * 0.9;
    return true;
  },
  hold(on) { mouse.held = on; },
  key(code, on) { on ? keys.add(code) : keys.delete(code); },
  skipLine() { S.lineUntil = 0; },
  speed(x) { S.timeScale = x; },
  goExit() { player.x = XC; player.z = ZG + 3; player.yaw = 0; player.pitch = 0; },
  faceExit() { player.yaw = Math.atan2(-(XC - player.x), -(ZG - 30 - player.z)); player.pitch = 0; },
  exitGate,
  faceMonster() { player.yaw = Math.atan2(-(monster.x - player.x), -(monster.z - player.z)); player.pitch = 0.1; },
};

boot().catch((e) => { el.err.style.display = 'block'; el.err.textContent = String(e && e.stack || e); });
