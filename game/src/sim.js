// sim.js — the whole game state lives in one object, advanced by a fixed
// 60 Hz step that never touches the renderer. Rendering (main.js) only reads
// this state and the event queue the step appends to.
// Rounds: freeze 15 s (buy) -> round 100 s -> planted 40 s fuse -> end 5 s.
// Match: first to 5, at most 9 rounds. Economy mirrors the classic formula:
// kill +$300, round win +$3,250, loss +$1,900 (+$500 per loss in a row, cap
// +$2,900), plant +$300.
import { Player, EYE_STAND } from './player.js';
import { Weapon, WEAPONS, GRENADE, ARMOR_PRICE, ARMOR_POINTS, damageAt } from './weapons.js';
import { Bot, BOT_EYE, nearestWaypoint } from './bots.js';
import { buildColliders, SPAWNS, SITES, rayWalls } from './map.js';

export const STEP = 1 / 60;
export const FREEZE_TIME = 15;
export const ROUND_TIME = 100;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const FUSE_TIME = 40;
export const END_TIME = 5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createState(seed) {
  const rng = mulberry32(seed);
  const state = {
    seed,
    rng,
    time: 0,
    phase: 'freeze',
    phaseTime: FREEZE_TIME,
    round: 1,
    score: { solara: 0, bastion: 0 },
    lossStreak: { solara: 0, bastion: 0 },
    colliders: buildColliders(),
    player: new Player(SPAWNS.solara[0]),
    weapons: { p9: new Weapon('p9') },
    bots: [],
    bomb: { carrier: 'player', planted: false, site: null, targetSite: 'A', x: 0, z: 0, fuse: 0, defused: false, planter: null },
    grenades: [],
    events: [], // consumed by main.js / hud.js each frame, then cleared
    killfeed: [], // {text, t}
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    stats: { shots: 0, hits: 0, kills: 0, deaths: 0, plants: 0, damage: 0 },
    plantProgress: 0, // player planting 0..1
    defuseProgress: 0,
    buyOpen: false,
    shotMode: null,
  };
  setupRound(state);
  return state;
}

function setupRound(state) {
  const rng = state.rng;
  state.phase = 'freeze';
  state.phaseTime = FREEZE_TIME;
  state.roundWinner = null;
  state.roundReason = '';
  state.bomb = { carrier: 'player', planted: false, site: null, targetSite: rng() < 0.5 ? 'A' : 'B', x: 0, z: 0, fuse: 0, defused: false, planter: null };
  state.grenades = [];
  state.events = [];
  state.plantProgress = 0;
  state.defuseProgress = 0;
  state.buyOpen = false;
  // Player: fresh spawn, full health, ammo refilled, keep money + weapons.
  state.player.reset(SPAWNS.solara[0]);
  for (const w of Object.values(state.weapons)) {
    w.ammo = w.def.mag; w.reserve = w.def.reserve; w.reloadLeft = 0; w.cooldown = 0;
  }
  // Bots: 4 Solara teammates + 5 Bastion defenders (2 A, 2 B, 1 mid roam).
  state.bots = [];
  const solaraRoles = ['attack', 'attack', 'attack', 'attack'];
  for (let i = 0; i < 4; i++) {
    state.bots.push(new Bot(i, 'solara', SPAWNS.solara[i + 1], solaraRoles[i], state.rng));
  }
  const bastionRoles = ['defend', 'defend', 'defend', 'defend', 'roam'];
  for (let i = 0; i < 5; i++) {
    state.bots.push(new Bot(10 + i, 'bastion', SPAWNS.bastion[i], bastionRoles[i], state.rng));
  }
  // The bomb carrier bot (if the player dies) is the first Solara bot.
  state.events.push({ type: 'round', n: state.round });
}

export function aliveBots(state, team) {
  return state.bots.filter((b) => b.team === team && b.alive);
}

function endRound(state, winner, reason) {
  if (state.phase === 'end' || state.phase === 'match') return;
  state.phase = 'end';
  state.phaseTime = END_TIME;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner]++;
  // Economy.
  const loser = winner === 'solara' ? 'bastion' : 'solara';
  state.lossStreak[winner] = 0;
  state.lossStreak[loser]++;
  const lossBonus = Math.min(2900, 1900 + 500 * (state.lossStreak[loser] - 1));
  if (winner === 'solara') {
    state.player.money += 3250;
    state.events.push({ type: 'money', amount: 3250, why: 'round win' });
  } else {
    state.player.money += lossBonus;
    state.events.push({ type: 'money', amount: lossBonus, why: 'round loss' });
  }
  state.events.push({ type: 'roundEnd', winner, reason });
  state.killfeed.push({ text: `${winner === 'solara' ? 'SOLARA' : 'BASTION'} wins the round — ${reason}`, t: state.time });
  // Match decided?
  if (state.score[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
    state.phase = 'match';
    state.matchWinner = state.score.solara > state.score.bastion ? 'solara'
      : state.score.bastion > state.score.solara ? 'bastion' : 'draw';
    state.phaseTime = 30;
    state.events.push({ type: 'matchEnd', winner: state.matchWinner });
  }
}

function nextRound(state) {
  state.round++;
  setupRound(state);
  state.events.push({ type: 'roundStart' });
}

// --- Player shooting -------------------------------------------------------
// Ray vs a bot: head sphere (r 0.24 at eye) then body AABB. Returns {bot, head, dist}.
function rayBot(origin, dir, maxDist, bot) {
  // Head sphere.
  const hx = bot.x, hy = bot.y + 1.55, hz = bot.z;
  const ox = origin.x - hx, oy = origin.y - hy, oz = origin.z - hz;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - 0.24 * 0.24;
  const disc = b * b - c;
  let best = Infinity, head = false;
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t < maxDist) { best = t; head = true; }
  }
  // Body AABB.
  const mn = { x: bot.x - 0.35, y: bot.y, z: bot.z - 0.35 };
  const mx = { x: bot.x + 0.35, y: bot.y + 1.7, z: bot.z + 0.35 };
  let t0 = 0, t1 = maxDist, ok = true;
  const axes = [
    [origin.x, dir.x, mn.x, mx.x],
    [origin.y, dir.y, mn.y, mx.y],
    [origin.z, dir.z, mn.z, mx.z],
  ];
  for (let a = 0; a < 3; a++) {
    const o = axes[a][0], d = axes[a][1], lo = axes[a][2], hi = axes[a][3];
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } }
    else {
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
  }
  if (ok && t0 >= 0 && t0 < best) { best = t0; head = false; }
  return best === Infinity ? null : { bot, head, dist: best };
}

function playerShoot(state, input) {
  const p = state.player;
  const w = state.weapons[p.current];
  if (!w) return;
  const res = w.fire();
  if (res === 'empty') { state.events.push({ type: 'dryfire' }); return; }
  if (res !== 'shot') return;
  state.stats.shots++;
  // Recoil kicks the aim up a touch; spread punishes moving fire.
  p.pitch += w.def.recoil * 0.5;
  if (p.pitch > 1.55) p.pitch = 1.55;
  const spread = w.spreadFor(p.speed2d, !p.onGround, p.crouch, p.aiming);
  const rx = (state.rng() * 2 - 1) * spread;
  const ry = (state.rng() * 2 - 1) * spread;
  const cp = Math.cos(p.pitch + ry), sp = Math.sin(p.pitch + ry);
  const cy = Math.cos(p.yaw + rx), sy = Math.sin(p.yaw + rx);
  const dir = { x: -sy * cp, y: sp, z: -cy * cp };
  const origin = { x: p.x, y: p.eyeY, z: p.z };
  const maxDist = w.def.range + 20;
  // Nearest bot hit vs nearest wall.
  let bestBot = null;
  for (const b of state.bots) {
    if (!b.alive || b.team === 'solara') continue;
    const hit = rayBot(origin, dir, maxDist, b);
    if (hit && (!bestBot || hit.dist < bestBot.dist)) bestBot = hit;
  }
  const wallDist = rayWalls(origin, dir, maxDist, state.colliders);
  const end = { x: origin.x + dir.x * maxDist, y: origin.y + dir.y * maxDist, z: origin.z + dir.z * maxDist };
  if (bestBot && bestBot.dist < wallDist) {
    const dmg = damageAt(w.def, bestBot.dist, bestBot.head);
    bestBot.bot.damage(dmg);
    state.stats.hits++;
    state.stats.damage += dmg;
    state.events.push({ type: 'hit', head: bestBot.head });
    const tip = { x: origin.x + dir.x * bestBot.dist, y: origin.y + dir.y * bestBot.dist, z: origin.z + dir.z * bestBot.dist };
    // Tracer starts at the muzzle (offset from the eye) so it reads on screen.
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const muz = { x: origin.x + dir.x * 0.6 + rx * 0.22, y: origin.y + dir.y * 0.6 - 0.18, z: origin.z + dir.z * 0.6 + rz * 0.22 };
    state.events.push({ type: 'tracer', from: muz, to: tip, color: w.def.tracer });
    if (!bestBot.bot.alive) {
      state.stats.kills++;
      p.money += 300;
      state.events.push({ type: 'kill', by: 'you', victim: `Bastion #${bestBot.bot.id}`, head: bestBot.head });
      state.killfeed.push({ text: `You eliminated Bastion #${bestBot.bot.id}${bestBot.head ? ' (headshot)' : ''}  +$300`, t: state.time });
    }
  } else {
    const hitD = Math.min(wallDist, maxDist);
    const tip = { x: origin.x + dir.x * hitD, y: origin.y + dir.y * hitD, z: origin.z + dir.z * hitD };
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const muz = { x: origin.x + dir.x * 0.6 + rx * 0.22, y: origin.y + dir.y * 0.6 - 0.18, z: origin.z + dir.z * 0.6 + rz * 0.22 };
    state.events.push({ type: 'tracer', from: muz, to: tip, color: w.def.tracer });
    if (wallDist < maxDist) state.events.push({ type: 'impact', at: tip });
  }
  state.events.push({ type: 'shot', kind: w.def.kind, from: { ...origin } });
  // Nearby bots hear the shot.
  for (const b of state.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    if (d < 25) { b.hearX = p.x; b.hearZ = p.z; b.hearAt = state.time; }
  }
}

// --- Grenades ---------------------------------------------------------------
function throwGrenade(state, kind) {
  const p = state.player;
  if (kind === 'he' && p.grenades <= 0) return false;
  if (kind === 'flash' && p.flashes <= 0) return false;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const dir = { x: -sy * cp, y: sp, z: -cy * cp };
  state.grenades.push({
    kind,
    x: p.x + dir.x * 0.5, y: p.eyeY - 0.1 + dir.y * 0.5, z: p.z + dir.z * 0.5,
    vx: dir.x * 15, vy: dir.y * 15 + 3.2, vz: dir.z * 15,
    fuse: kind === 'he' ? GRENADE.he.fuse : 1.0,
    from: 'player',
  });
  if (kind === 'he') p.grenades--; else p.flashes--;
  state.events.push({ type: 'throw', kind });
  return true;
}

function explodeGrenade(state, g) {
  if (g.kind === 'he') {
    state.events.push({ type: 'explosion', at: { x: g.x, y: g.y, z: g.z } });
    const hurt = (x, y, z, apply) => {
      const d = Math.hypot(x - g.x, (y + 0.9) - g.y, z - g.z);
      if (d > GRENADE.he.radius) return;
      const dmg = GRENADE.he.maxDamage * (1 - (d / GRENADE.he.radius) * 0.75);
      apply(dmg);
    };
    for (const b of state.bots) {
      if (!b.alive || b.team === 'solara') continue;
      hurt(b.x, b.y, b.z, (dmg) => {
        b.damage(dmg);
        if (!b.alive) {
          state.stats.kills++;
          state.player.money += 300;
          state.killfeed.push({ text: `Your HE grenade eliminated Bastion #${b.id}  +$300`, t: state.time });
        }
      });
    }
    hurt(state.player.x, state.player.y, state.player.z, (dmg) => {
      state.player.damage(dmg * 0.4); // self-damage is softened
      state.events.push({ type: 'hurt' });
    });
  } else {
    state.events.push({ type: 'flash', at: { x: g.x, y: g.y, z: g.z } });
    for (const b of state.bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - g.x, b.z - g.z);
      if (d < GRENADE.flash.radius) {
        b.blindUntil = state.time + GRENADE.flash.blindTime;
      }
    }
    // Flash the player too if they stare at it up close.
    const pd = Math.hypot(state.player.x - g.x, state.player.z - g.z);
    if (pd < GRENADE.flash.radius) state.events.push({ type: 'flashPlayer' });
  }
}

// --- Buying -----------------------------------------------------------------
export function buyItem(state, id) {
  if (state.phase !== 'freeze') return { ok: false, why: 'Buy menu is only open during the freeze.' };
  const p = state.player;
  if (WEAPONS[id]) {
    const def = WEAPONS[id];
    if (p.weapons.includes(id)) return { ok: false, why: `You already own the ${def.name}.` };
    if (p.money < def.price) return { ok: false, why: `Need $${def.price} for the ${def.name}.` };
    p.money -= def.price;
    p.weapons.push(id);
    state.weapons[id] = new Weapon(id);
    p.current = id;
    state.events.push({ type: 'buy', what: def.name });
    return { ok: true };
  }
  if (id === 'he') {
    if (p.money < GRENADE.he.price) return { ok: false, why: 'Need $300 for an HE grenade.' };
    p.money -= GRENADE.he.price; p.grenades++;
    state.events.push({ type: 'buy', what: 'HE Grenade' });
    return { ok: true };
  }
  if (id === 'flash') {
    if (p.money < GRENADE.flash.price) return { ok: false, why: 'Need $200 for a flashbang.' };
    p.money -= GRENADE.flash.price; p.flashes++;
    state.events.push({ type: 'buy', what: 'Flashbang' });
    return { ok: true };
  }
  if (id === 'armor') {
    if (p.armor >= ARMOR_POINTS) return { ok: false, why: 'Armor is already full.' };
    if (p.money < ARMOR_PRICE) return { ok: false, why: 'Need $650 for armor.' };
    p.money -= ARMOR_PRICE; p.armor = ARMOR_POINTS;
    state.events.push({ type: 'buy', what: 'Kevlar armor' });
    return { ok: true };
  }
  return { ok: false, why: 'Unknown item.' };
}

// --- Main step ---------------------------------------------------------------
export function step(state, input) {
  const dt = STEP;
  state.time += dt;
  const p = state.player;

  // Mouse look.
  if (input.mouseDX || input.mouseDY) {
    p.yaw -= input.mouseDX * 0.0022;
    p.pitch -= input.mouseDY * 0.0022;
    if (p.pitch > 1.55) p.pitch = 1.55;
    if (p.pitch < -1.55) p.pitch = -1.55;
    input.mouseDX = 0; input.mouseDY = 0;
  }

  // Phase timer.
  if (state.phase !== 'match') {
    state.phaseTime -= dt;
  }

  const frozen = state.phase === 'freeze';
  const playing = state.phase === 'round' || state.phase === 'planted';

  // Buy menu toggle (freeze only).
  if (input.buyPressed && frozen) {
    state.buyOpen = !state.buyOpen;
    input.buyPressed = false;
  }
  if (!frozen && state.buyOpen) state.buyOpen = false;

  // Weapon switching (Q cycles, 1-4 direct).
  if (input.switchPressed && p.alive) {
    const idx = p.weapons.indexOf(p.current);
    p.current = p.weapons[(idx + 1) % p.weapons.length];
    input.switchPressed = false;
  }
  if (input.slot && p.weapons[input.slot - 1]) {
    p.current = p.weapons[input.slot - 1];
    input.slot = 0;
  }

  // Player movement + footsteps.
  if (playing || frozen) {
    p.sprinting = !!input.sprint;
    const stepped = p.step(dt, input, state.colliders);
    if (stepped) state.events.push({ type: 'step' });
  }
  p.aiming = !!input.ads && p.alive;

  // Weapons.
  const w = state.weapons[p.current];
  if (w) w.step(dt);
  if (playing && p.alive) {
    if (input.fire) playerShoot(state, input);
    if (input.reloadPressed) {
      if (w && w.startReload()) state.events.push({ type: 'reload' });
      input.reloadPressed = false;
    }
    if (input.grenadePressed) {
      if (!throwGrenade(state, 'he')) state.events.push({ type: 'denied', why: 'No HE grenade — buy one with B.' });
      input.grenadePressed = false;
    }
    if (input.flashPressed) {
      if (!throwGrenade(state, 'flash')) state.events.push({ type: 'denied', why: 'No flashbang — buy one with B.' });
      input.flashPressed = false;
    }
  }

  // Bomb plant / defuse by the player (hold E).
  if (playing && p.alive && input.plant) {
    if (state.bomb.carrier === 'player' && !state.bomb.planted && state.phase === 'round') {
      const s = SITES[state.bomb.targetSite];
      if (Math.hypot(p.x - s.x, p.z - s.z) < s.r) {
        state.plantProgress += dt / PLANT_TIME;
        if (Math.floor(state.plantProgress * 10) !== Math.floor((state.plantProgress - dt / PLANT_TIME) * 10)) {
          state.events.push({ type: 'plantBeep' });
        }
        if (state.plantProgress >= 1) {
          state.bomb.planted = true;
          state.bomb.site = state.bomb.targetSite;
          state.bomb.x = p.x; state.bomb.z = p.z;
          state.bomb.fuse = FUSE_TIME;
          state.phase = 'planted';
          state.phaseTime = FUSE_TIME;
          state.bomb.planter = 'player';
          state.bomb.carrier = null;
          state.stats.plants++;
          p.money += 300;
          state.plantProgress = 0;
          state.events.push({ type: 'planted', site: state.bomb.site, by: 'you' });
          state.killfeed.push({ text: `You planted the bomb at site ${state.bomb.site}  +$300`, t: state.time });
        }
      } else state.plantProgress = 0;
    }
  } else state.plantProgress = 0;

  // Grenade physics (gravity + ground bounce, fuse countdown).
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.vy -= 16 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.15) { g.y = 0.15; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.7; g.vz *= 0.7; }
    g.fuse -= dt;
    if (g.fuse <= 0) { explodeGrenade(state, g); state.grenades.splice(i, 1); }
  }

  // Bots.
  const foesFor = (bot) => {
    const list = [];
    if (bot.team === 'bastion') {
      if (p.alive) list.push({ x: p.x, y: p.eyeY, z: p.z, alive: true, ref: 'player', moving: p.speed2d > 2, crouch: p.crouch });
      for (const b of state.bots) if (b.team === 'solara' && b.alive) list.push({ x: b.x, y: b.y + BOT_EYE, z: b.z, alive: true, ref: b, moving: true, crouch: false });
    } else {
      for (const b of state.bots) if (b.team === 'bastion' && b.alive) list.push({ x: b.x, y: b.y + BOT_EYE, z: b.z, alive: true, ref: b, moving: true, crouch: false });
    }
    return list;
  };
  if (playing || frozen) {
    for (const b of state.bots) {
      if (!b.alive) continue;
      // Frozen: bots hold still at spawn.
      if (frozen) continue;
      b.update(dt, state, foesFor(b), state.events);
    }
  }
  // Apply bot damage events (fired this step).
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.type !== 'damage') continue;
    if (e.target === 'player') {
      const wasAlive = p.alive;
      const before = p.health;
      p.damage(e.amount);
      if (p.health < before) state.events.push({ type: 'hurt' });
      if (wasAlive && !p.alive) {
        state.stats.deaths++;
        state.killfeed.push({ text: `Bastion #${e.by} eliminated you`, t: state.time });
        state.events.push({ type: 'died', by: e.by });
        // Hand the bomb to a living Solara bot.
        if (state.bomb.carrier === 'player') {
          const mate = state.bots.find((b) => b.team === 'solara' && b.alive);
          if (mate) { mate.carriesBomb = true; state.bomb.carrier = mate; }
          else state.bomb.carrier = null;
        }
      }
    } else if (e.target && e.target.alive !== undefined) {
      const bot = e.target;
      const wasAlive = bot.alive;
      bot.damage(e.amount);
      if (wasAlive && !bot.alive) {
        // A bot killed a bot: credit the killer's team via killfeed only.
        state.killfeed.push({ text: `${bot.team === 'bastion' ? 'Bastion' : 'Solara'} #${bot.id} was eliminated`, t: state.time });
        if (bot.carriesBomb) {
          bot.carriesBomb = false;
          const mate = state.bots.find((b) => b.team === 'solara' && b.alive);
          if (mate) { mate.carriesBomb = true; state.bomb.carrier = mate; }
          else state.bomb.carrier = null;
        }
      }
    }
  }

  // Bomb fuse / defuse resolution.
  if (state.phase === 'planted') {
    state.bomb.fuse -= dt;
    if (state.bomb.defused) { endRound(state, 'bastion', 'bomb defused'); }
    else if (state.bomb.fuse <= 0) {
      state.events.push({ type: 'explosion', at: { x: state.bomb.x, y: 1, z: state.bomb.z } });
      endRound(state, 'solara', 'bomb detonated');
    }
  }

  // Elimination / timer checks.
  if (state.phase === 'round') {
    if (aliveBots(state, 'bastion').length === 0) endRound(state, 'solara', 'enemy team eliminated');
    else if (!p.alive && aliveBots(state, 'solara').length === 0) endRound(state, 'bastion', 'enemy team eliminated');
    else if (state.phaseTime <= 0) endRound(state, 'bastion', 'time expired — bomb not planted');
  }
  if (state.phase === 'planted') {
    if (!p.alive && aliveBots(state, 'solara').length === 0 && !state.bomb.defused) {
      // Attackers all dead: defenders still must defuse before the fuse ends;
      // if nobody is defusing, the fuse decides it.
      const defusing = state.bots.some((b) => b.team === 'bastion' && b.alive && b.state === 'defuse');
      if (!defusing && state.bomb.fuse > 12) state.bomb.fuse = 12; // hurry the ending
    }
  }
  if (state.phase === 'freeze' && state.phaseTime <= 0) {
    state.phase = 'round';
    state.phaseTime = ROUND_TIME;
    state.buyOpen = false;
    state.events.push({ type: 'roundStart' });
  }
  if (state.phase === 'end' && state.phaseTime <= 0) {
    if (state.score.solara >= WIN_ROUNDS || state.score.bastion >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'match';
      state.phaseTime = 30;
    } else nextRound(state);
  }

  // Clear one-frame render events older than this step (tracers live one frame
  // in the renderer; the queue is drained by main.js each rendered frame).
}
