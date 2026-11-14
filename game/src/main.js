// main.js — boot, fixed-step loop, rendering, screenshot modes.
// The simulation (sim.js) owns all game state; this file only turns that
// state into pixels and sound, and feeds it input. Screenshot modes
// (?shot=start|play|buy|end&seed=N) run the real sim deterministically, then
// freeze the frame and set window.__shotReady for the capture script.
import * as THREE from 'three';
import { PALETTE, TEAM } from './palette.js';
import { buildMap, SITES } from './map.js';
import { createState, step, buyItem, STEP } from './sim.js';
import { Bot, BOT_EYE, hasLOS } from './bots.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // null | 'start' | 'play' | 'buy' | 'end'
const SEED = parseInt(params.get('seed') || '7', 10);

const app = document.getElementById('app');
const hudRoot = document.getElementById('hud');
const lockHint = document.getElementById('hud-lock');
const scopeEl = document.getElementById('scope');

// --- Renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x241a10);
scene.fog = new THREE.FogExp2(0x2a1f12, 0.011);

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Dawn: warm low sun from the east, cool blue skylight fill.
const sun = new THREE.DirectionalLight(0xffb347, 3.0);
sun.position.set(30, 14, -6);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x4a5f8a, 0x2a2013, 1.05));
const ambient = new THREE.AmbientLight(0x40301c, 0.6);
scene.add(ambient);

const { siteMarkers } = buildMap(scene);

// Site letter sprites (A / B) floating above the beacons.
function makeLabelSprite(letter, colorCss) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = colorCss;
  g.font = 'bold 92px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(2.4, 2.4, 1);
  return s;
}
const labelA = makeLabelSprite('A', '#ffb347');
labelA.position.set(SITES.A.x, 5.4, SITES.A.z);
scene.add(labelA);
const labelB = makeLabelSprite('B', '#57c8c0');
labelB.position.set(SITES.B.x, 5.4, SITES.B.z);
scene.add(labelB);

// --- Game state ---------------------------------------------------------------
let state = createState(SEED);
state.started = !!SHOT;
const input = new Input(renderer.domElement);
input.attach();
const audio = new AudioEngine();
const hud = new HUD(hudRoot, {
  onBuy: (id) => {
    const r = buyItem(state, id);
    if (r.ok) audio.buy(); else { audio.denied(); state.killfeed.push({ text: r.why, t: state.time }); }
    hud._buyRendered = -1;
  },
  onResume: () => {
    state.started = true;
    audio.unlock();
    input.requestLock();
    hud.showStart(false);
  },
});
input.onLockChange = (locked) => {
  lockHint.classList.toggle('hidden', locked || !!SHOT || !state.started);
  if (!locked && state.started && !SHOT) hud.showStart(true);
};
renderer.domElement.addEventListener('click', () => {
  if (state.started && !input.locked && !SHOT) { audio.unlock(); input.requestLock(); }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && state.phase === 'match' && !SHOT) resetGame(state.seed + 1);
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Bot meshes ----------------------------------------------------------------
const botGroup = new THREE.Group();
scene.add(botGroup);
const botMeshes = new Map();

function makeBotMesh(bot) {
  const g = new THREE.Group();
  const teamCol = TEAM[bot.team].main;
  const dark = new THREE.MeshStandardMaterial({ color: 0x241c12, roughness: 0.9 });
  const torsoMat = new THREE.MeshStandardMaterial({ color: teamCol, roughness: 0.75 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.8 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.75, 0.3), dark);
  legs.position.y = 0.375;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.34), torsoMat);
  torso.position.y = 1.06;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), skinMat);
  head.position.y = 1.56;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  helmet.position.y = 1.58;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.72), dark);
  gun.position.set(0.26, 1.22, -0.28);
  g.add(legs, torso, head, helmet, gun);
  g.userData.dead = false;
  return g;
}

function syncBotMeshes() {
  for (const b of state.bots) {
    let m = botMeshes.get(b.id);
    if (!m) { m = makeBotMesh(b); botMeshes.set(b.id, m); botGroup.add(m); }
    m.position.set(b.x, b.y, b.z);
    if (b.alive) {
      m.rotation.set(0, b.yaw, 0);
      m.visible = true;
    } else if (!m.userData.dead) {
      m.userData.dead = true;
      m.rotation.set(0, b.yaw, Math.PI / 2);
      m.position.y = 0.32;
    }
  }
}

function resetGame(seed) {
  state = createState(seed);
  state.started = true;
  botMeshes.clear();
  botGroup.clear();
  hud._lastBanner = '';
  hud.showStart(false);
}

// --- Viewmodel gun + muzzle flash ----------------------------------------------
const gunGroup = new THREE.Group();
{
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 0.55, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.4, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, 0.55), gunMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.4);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), accentMat);
  sight.position.set(0, 0.1, -0.1);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), gunMat);
  grip.position.set(0, -0.13, 0.12);
  grip.rotation.x = 0.3;
  gunGroup.add(body, barrel, sight, grip);
  gunGroup.position.set(0.24, -0.22, -0.5);
  camera.add(gunGroup);
}
const muzzle = new THREE.PointLight(0xffc46b, 0, 9, 1.6);
muzzle.position.set(0.2, -0.1, -0.7);
camera.add(muzzle);

// --- Tracers / explosions / grenades --------------------------------------------
const tracerGroup = new THREE.Group();
scene.add(tracerGroup);
const tracers = []; // {mesh, mat, life}
const tracerGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 6, 1, true);
function spawnTracer(from, to, color, frozen) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5) return;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(tracerGeo, mat);
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx / len, dy / len, dz / len),
  );
  tracerGroup.add(mesh);
  tracers.push({ mesh, mat, life: frozen ? 999 : 0.09 });
}
const fxGroup = new THREE.Group();
scene.add(fxGroup);
const explosions = []; // {mesh, light, life}
function spawnExplosion(at) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0.9 }),
  );
  mesh.position.set(at.x, at.y + 0.4, at.z);
  const light = new THREE.PointLight(0xff8c2e, 30, 26, 1.4);
  light.position.set(at.x, at.y + 1.5, at.z);
  fxGroup.add(mesh, light);
  explosions.push({ mesh, light, life: 0.7 });
}
const grenadeGroup = new THREE.Group();
scene.add(grenadeGroup);
const grenadeMeshes = [];
const grenadeGeo = new THREE.SphereGeometry(0.14, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 });

// Planted bomb mesh.
const bombMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.6 }));
  box.position.y = 0.14;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  lamp.position.set(0.12, 0.32, 0);
  bombMesh.add(box, lamp);
  bombMesh.visible = false;
  scene.add(bombMesh);
}
const bombLight = new THREE.PointLight(0xff2a1a, 0, 12, 1.5);
scene.add(bombLight);

// --- Event drain ------------------------------------------------------------------
function drainEvents() {
  const evs = state.events;
  for (const e of evs) {
    switch (e.type) {
      case 'shot':
        if (e.shooter === undefined) { audio.shot(e.kind); muzzle.intensity = 9; }
        else audio.shot('distant');
        break;
      case 'tracer':
        spawnTracer(e.from, e.to, e.color, !!SHOT);
        break;
      case 'hit': hud.hitmark(e.head); audio.hitmarker(); break;
      case 'hurt': hud.damageFlash(); audio.hurt(); break;
      case 'dryfire': audio.dryFire(); break;
      case 'reload': audio.reload(); break;
      case 'step': audio.step(); break;
      case 'plantBeep': audio.plantBeep(false); break;
      case 'planted': audio.plantBeep(true); break;
      case 'explosion': spawnExplosion(e.at); audio.explosion(); break;
      case 'roundStart': audio.roundStart(); break;
      case 'roundEnd': audio.roundEnd(e.winner === 'solara'); break;
      case 'matchEnd': audio.roundEnd(e.winner === 'solara'); break;
      case 'buy': audio.buy(); break;
      case 'denied': audio.denied(); break;
      case 'throw': audio.grenadePin(); break;
      case 'flash': audio.explosion(); break;
      case 'flashPlayer': hud.flashPlayer(); break;
      default: break;
    }
  }
  state.events.length = 0;
}

// --- Screenshot modes ---------------------------------------------------------------
function emptyInput() {
  return {
    forward: false, back: false, left: false, right: false, jump: false,
    crouch: false, sprint: false, fire: false, ads: false, plant: false,
    reloadPressed: false, buyPressed: false, grenadePressed: false,
    flashPressed: false, switchPressed: false, slot: 0, mouseDX: 0, mouseDY: 0,
  };
}

function aimAtPlayer(target) {
  const p = state.player;
  const dx = target.x - p.x, dz = target.z - p.z;
  const dy = (target.y + 1.2) - p.eyeY;
  const dist = Math.hypot(dx, dz);
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, dist);
}

function runShotScript() {
  const input0 = emptyInput();
  if (SHOT === 'start') {
    for (let i = 0; i < 30; i++) step(state, input0);
  } else if (SHOT === 'buy') {
    for (let i = 0; i < 10; i++) step(state, input0);
    state.buyOpen = true;
  } else if (SHOT === 'play') {
    // Let the freeze run out, then give the bots 2 s to start moving down the
    // lanes. The player sits out the advance (marked down, so no bot targets
    // them), then steps out to mid at full health, faces the nearest Bastion
    // bot with a clear line of sight (falling back to the nearest one at all,
    // then to mid-lane itself) and fires a short burst at it.
    for (let i = 0; i < 900; i++) step(state, input0);
    state.player.alive = false;
    for (let i = 0; i < 120; i++) step(state, input0);
    state.player.healFull();
    state.player.x = -2; state.player.z = 1;
    let best = null, bd = Infinity;
    for (const b of state.bots) {
      if (b.team !== 'bastion' || !b.alive) continue;
      const d = Math.hypot(b.x - state.player.x, b.z - state.player.z);
      if (d >= bd) continue;
      if (!hasLOS(state.player.x, state.player.eyeY, state.player.z, b.x, b.y + 1.2, b.z, state.colliders)) continue;
      bd = d; best = b;
    }
    if (!best) {
      for (const b of state.bots) {
        if (b.team !== 'bastion' || !b.alive) continue;
        const d = Math.hypot(b.x - state.player.x, b.z - state.player.z);
        if (d < bd) { bd = d; best = b; }
      }
    }
    if (best) {
      aimAtPlayer(best);
    } else {
      // No living Bastion bot: fire down mid-lane at the roam hold anyway.
      aimAtPlayer({ x: 10, y: 0, z: 0 });
    }
    {
      const fireInput = emptyInput();
      fireInput.fire = true;
      for (let i = 0; i < 30; i++) step(state, fireInput);
    }
  } else if (SHOT === 'end') {
    let guard = 0;
    while (state.phase !== 'end' && state.phase !== 'match' && guard < 7000) {
      step(state, input0);
      guard++;
    }
  }
  drainEvents();
  // Keep the last tracer visible for the frozen frame.
  for (const t of tracers) t.life = 999;
  if (SHOT === 'play') {
    // Stage the frozen frame: one tracer only, camera back on a living enemy,
    // player at full health (the burst itself was real; this is the photo).
    while (tracers.length > 1) {
      const t = tracers.shift();
      tracerGroup.remove(t.mesh);
      t.mat.dispose();
    }
    let target = null, td = Infinity;
    for (const b of state.bots) {
      if (b.team !== 'bastion' || !b.alive) continue;
      const d = Math.hypot(b.x - state.player.x, b.z - state.player.z);
      if (d >= td) continue;
      if (!hasLOS(state.player.x, state.player.eyeY, state.player.z, b.x, b.y + 1.2, b.z, state.colliders)) continue;
      td = d; target = b;
    }
    if (!target) {
      for (const b of state.bots) {
        if (b.team !== 'bastion' || !b.alive) continue;
        const d = Math.hypot(b.x - state.player.x, b.z - state.player.z);
        if (d < td) { td = d; target = b; }
      }
    }
    if (target) aimAtPlayer(target);
    state.player.health = 100;
  }
}

let shotFrozen = false;
let framesRendered = 0;
if (SHOT) {
  runShotScript();
  shotFrozen = true;
  hud.showStart(false);
}

// --- Main loop ------------------------------------------------------------------------
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;
  framesRendered++;

  if (!shotFrozen && state.started) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      const f = input.frame();
      step(state, f);
      input.consume(f);
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;
  }
  drainEvents();

  // Camera follows the player.
  const p = state.player;
  const eyeY = p.alive ? p.eyeY : 0.55;
  camera.position.set(p.x, eyeY, p.z);
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
  // FOV: hip 74, ADS 58, scoped Longbow 32.
  const scoped = p.aiming && state.weapons[p.current] && state.weapons[p.current].def.scoped;
  const targetFov = !p.aiming ? 74 : scoped ? 32 : 58;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
  scopeEl.style.display = scoped ? 'block' : 'none';

  // Viewmodel: recoil kick + ADS centring.
  const w = state.weapons[p.current];
  const kick = w ? w.recoilPitch : 0;
  const adsT = p.aiming ? 1 : 0;
  gunGroup.position.x = 0.24 - adsT * 0.24;
  gunGroup.position.y = -0.22 + adsT * 0.065;
  gunGroup.position.z = -0.5 + kick * 1.2;
  gunGroup.visible = p.alive;
  muzzle.intensity = Math.max(0, muzzle.intensity - dt * 90);

  // Bots, grenades, bomb, site beacons.
  syncBotMeshes();
  while (grenadeMeshes.length < state.grenades.length) {
    const m = new THREE.Mesh(grenadeGeo, grenadeMat);
    grenadeGroup.add(m);
    grenadeMeshes.push(m);
  }
  for (let i = 0; i < grenadeMeshes.length; i++) {
    const m = grenadeMeshes[i];
    if (i < state.grenades.length) {
      const g = state.grenades[i];
      m.visible = true;
      m.position.set(g.x, g.y, g.z);
    } else m.visible = false;
  }
  if (state.bomb.planted) {
    bombMesh.visible = true;
    bombMesh.position.set(state.bomb.x, 0, state.bomb.z);
    const blink = (Math.sin(state.time * 6) > 0) ? 6 : 0.5;
    bombLight.intensity = blink;
    bombLight.position.set(state.bomb.x, 1.2, state.bomb.z);
    siteMarkers[state.bomb.site].ring.material.opacity = 0.4 + 0.35 * Math.sin(state.time * 6);
  } else {
    bombMesh.visible = false;
    bombLight.intensity = 0;
  }

  // Tracers fade; explosions expand and fade.
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    if (t.life < 900) {
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / 0.09) * 0.95;
      if (t.life <= 0) {
        tracerGroup.remove(t.mesh);
        t.mat.dispose();
        tracers.splice(i, 1);
      }
    }
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.life -= dt;
    const k = 1 - Math.max(0, e.life) / 0.7;
    e.mesh.scale.setScalar(1 + k * 7);
    e.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
    e.light.intensity = Math.max(0, 30 * (1 - k));
    if (e.life <= 0) {
      fxGroup.remove(e.mesh, e.light);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      explosions.splice(i, 1);
    }
  }

  hud.update(state, now);
  renderer.render(scene, camera);

  if (SHOT && framesRendered >= 3 && !window.__shotReady) {
    window.__shotReady = true;
  }
}
requestAnimationFrame(frame);
