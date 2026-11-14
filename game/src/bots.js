// bots.js — one Bot class drives all nine AI fighters.
// States: hold (defenders on site) -> push (walk the waypoint graph) ->
// engage (a visible enemy, stop and shoot) -> plant / defuse (objective) ->
// retreat (after the plant). Bots hear gunfire within 25 m and turn toward it.
// A bot sees through a segment-vs-AABB line-of-sight test against the map,
// waits a human reaction delay (250-600 ms), then fires aimed bursts with
// distance-based error. All randomness comes from the sim's seeded RNG.
import { WAYPOINTS, WAY_LINKS, SITES, segmentBlocked } from './map.js';
import { WEAPONS, damageAt } from './weapons.js';

export const BOT_EYE = 1.5;
export const BOT_SPEED = 4.2;

function bfsPath(from, to) {
  if (from === to) return [to];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const q = [from];
  prev[from] = from;
  while (q.length) {
    const n = q.shift();
    if (n === to) break;
    for (const [a, b] of WAY_LINKS) {
      const m = a === n ? b : b === n ? a : -1;
      if (m >= 0 && prev[m] === -1) { prev[m] = n; q.push(m); }
    }
  }
  if (prev[to] === -1) return [to];
  const path = [];
  let n = to;
  while (n !== from) { path.push(n); n = prev[n]; }
  path.reverse();
  return path;
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const d = (WAYPOINTS[i].x - x) ** 2 + (WAYPOINTS[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Line of sight between two eye positions, blocked by map colliders only.
export function hasLOS(ax, ay, az, bx, by, bz, colliders) {
  return !segmentBlocked({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }, colliders);
}

export class Bot {
  constructor(id, team, spawn, role, rng) {
    this.id = id;
    this.team = team; // 'solara' | 'bastion'
    this.role = role; // 'attack' | 'defend' | 'roam'
    this.x = spawn.x; this.y = 0; this.z = spawn.z;
    this.yaw = spawn.yaw;
    this.health = 100;
    this.alive = true;
    this.weapon = WEAPONS.ar77;
    this.ammo = 30;
    this.reloadLeft = 0;
    this.cooldown = 0;
    this.state = role === 'defend' ? 'hold' : 'push';
    this.path = [];
    this.pathIdx = 0;
    this.holdNode = -1;
    this.target = null; // {x, y, z, ref} enemy currently engaged
    this.reaction = 0; // seconds until allowed to fire at a seen enemy
    this.seenAt = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.aimError = 0.02;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.blindUntil = 0;
    this.hearX = 0; this.hearZ = 0; this.hearAt = -99;
    this.carriesBomb = false;
    this.kills = 0;
    this.rng = rng;
    this.strafeDir = 1;
    this.strafeTimer = 0;
    this.stuckTimer = 0;
    this.lastX = spawn.x; this.lastZ = spawn.z;
  }

  get eyeY() { return this.y + BOT_EYE; }

  damage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  reset(spawn) {
    this.x = spawn.x; this.y = 0; this.z = spawn.z;
    this.yaw = spawn.yaw;
    this.health = 100; this.alive = true;
    this.ammo = 30; this.reloadLeft = 0; this.cooldown = 0;
    this.state = this.role === 'defend' ? 'hold' : 'push';
    this.path = []; this.pathIdx = 0; this.holdNode = -1;
    this.target = null; this.reaction = 0;
    this.burstLeft = 0; this.burstPause = 0;
    this.plantProgress = 0; this.defuseProgress = 0;
    this.blindUntil = 0; this.hearAt = -99;
    this.carriesBomb = false; this.kills = 0;
  }

  // Pick a destination waypoint index for this bot's current job.
  chooseDestination(state) {
    if (this.team === 'bastion') {
      if (state.bomb.planted) return this.role === 'roam' ? nearestWaypoint(state.bomb.x, state.bomb.z)
        : nearestWaypoint(SITES[state.bomb.site].x, SITES[state.bomb.site].z);
      // Defenders: two hold A, two hold B, one roams mid.
      if (this.role === 'roam') return 11; // mid east
      return this.holdNode >= 0 ? this.holdNode
        : (this.id % 2 === 0 ? 13 : 14); // split across the sites
    }
    // Solara attackers: push the assigned site (A 40% / mid 25% / B 35%).
    if (state.bomb.planted) return nearestWaypoint(state.bomb.x, state.bomb.z);
    const r = this.rng();
    if (this.carriesBomb) return r < 0.5 ? 13 : 14;
    return r < 0.4 ? 13 : r < 0.65 ? 11 : 14;
  }

  // Move toward (tx, tz) with map collision; returns true when arrived.
  moveToward(tx, tz, dt, colliders, speed) {
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) return true;
    const vx = (dx / d) * speed, vz = (dz / d) * speed;
    this.yaw = Math.atan2(-dx, -dz); // face movement (yaw 0 faces -Z)
    this.x += vx * dt;
    this.z += vz * dt;
    // Cheap AABB push-out (bots walk the open lanes; walls stop them).
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (this.x + 0.35 > c.minX && this.x - 0.35 < c.maxX &&
          this.y + 1.7 > c.minY && this.y < c.maxY &&
          this.z + 0.35 > c.minZ && this.z - 0.35 < c.maxZ) {
        // Step back along the axis of least penetration.
        const px = Math.min(this.x + 0.35 - c.minX, c.maxX - (this.x - 0.35));
        const pz = Math.min(this.z + 0.35 - c.minZ, c.maxZ - (this.z - 0.35));
        if (px < pz) this.x += (this.x < (c.minX + c.maxX) / 2) ? -px : px;
        else this.z += (this.z < (c.minZ + c.maxZ) / 2) ? -pz : pz;
      }
    }
    if (this.x < -21.4) this.x = -21.4;
    if (this.x > 21.4) this.x = 21.4;
    if (this.z < -17.4) this.z = -17.4;
    if (this.z > 17.4) this.z = 17.4;
    return false;
  }

  // Can this bot see the target point right now?
  sees(tx, ty, tz, colliders) {
    return hasLOS(this.x, this.eyeY, this.z, tx, ty, tz, colliders);
  }

  // One fixed step. `foes` are {x, y(eye), z, alive, isPlayer, ref} of the enemy
  // team; `events` collects tracer / sound / killfeed entries for the renderer.
  update(dt, state, foes, events) {
    if (!this.alive) return;
    const now = state.time;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) { this.ammo = 30; this.reloadLeft = 0; }
    }
    const blinded = now < this.blindUntil;

    // --- Perception: nearest visible foe within 55 m.
    let foe = null, foeDist = Infinity;
    if (!blinded) {
      for (const f of foes) {
        if (!f.alive) continue;
        const d = Math.hypot(f.x - this.x, f.z - this.z);
        if (d > 55 || d >= foeDist) continue;
        if (this.sees(f.x, f.y, f.z, state.colliders)) { foe = f; foeDist = d; }
      }
    }
    if (foe) {
      if (this.target !== foe.ref) {
        this.target = foe.ref;
        this.reaction = 0.25 + this.rng() * 0.35; // 250-600 ms reaction
        this.seenAt = now;
      }
    } else {
      this.target = null;
    }

    // --- Objective states override movement.
    if (this.carriesBomb && state.phase === 'round' && !state.bomb.planted) {
      const site = state.bomb.targetSite;
      const s = SITES[site];
      const inSite = Math.hypot(this.x - s.x, this.z - s.z) < s.r;
      const siteClear = !foes.some((f) => f.alive && Math.hypot(f.x - s.x, f.z - s.z) < s.r + 6);
      if (inSite && siteClear && !foe) {
        this.state = 'plant';
        this.plantProgress += dt;
        if (this.plantProgress >= 3) {
          state.bomb.planted = true; state.bomb.site = site;
          state.bomb.x = this.x; state.bomb.z = this.z;
          state.bomb.fuse = 40; state.phase = 'planted';
          state.bomb.planter = this;
          this.plantProgress = 0; this.state = 'retreat';
          events.push({ type: 'planted', site, by: this.id });
          state.carrier = null;
        }
        return; // planting: stand still
      }
      if (inSite && !siteClear) this.state = 'engage';
    }
    if (this.team === 'bastion' && state.bomb.planted) {
      const dSite = Math.hypot(this.x - state.bomb.x, this.z - state.bomb.z);
      if (dSite < 1.6 && !foe) {
        this.state = 'defuse';
        this.defuseProgress += dt;
        if (this.defuseProgress >= 5) {
          state.bomb.defused = true;
          events.push({ type: 'defused', by: this.id });
          this.defuseProgress = 0;
        }
        return;
      }
      if (dSite < 8) this.state = 'push';
    }

    // --- Combat: face the foe, strafe, fire aimed bursts.
    if (foe && this.reaction <= 0) {
      this.state = 'engage';
      const dx = foe.x - this.x, dz = foe.z - this.z;
      this.yaw = Math.atan2(-dx, -dz);
      // Strafe sideways while fighting, changing direction every ~0.9 s.
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 0.7 + this.rng() * 0.5; }
      const sx = Math.cos(this.yaw) * this.strafeDir, sz = -Math.sin(this.yaw) * this.strafeDir;
      this.moveToward(this.x + sx * 2, this.z + sz * 2, dt, state.colliders, BOT_SPEED * 0.45);
      // Fire in bursts of 3-5 with a pause; accuracy falls off with distance.
      if (this.burstPause > 0) this.burstPause -= dt;
      else if (this.burstLeft > 0) {
        if (this.cooldown <= 0 && this.ammo > 0) this.fireAt(foe, foeDist, state, events);
        else if (this.ammo <= 0 && this.reloadLeft <= 0) this.reloadLeft = 2.5;
      } else {
        this.burstLeft = 3 + Math.floor(this.rng() * 3);
        this.burstPause = 0.55 + this.rng() * 0.5;
      }
      return;
    }
    if (foe) { this.reaction -= dt; this.state = 'engage'; return; }

    // --- Navigation: follow the waypoint path to the job destination.
    if (this.state === 'hold') {
      if (this.holdNode < 0) {
        if (this.role === 'roam') this.holdNode = 11; // mid east
        else this.holdNode = this.team === 'bastion'
          ? (this.id % 2 === 0 ? 16 : 17)
          : nearestWaypoint(this.x, this.z);
      }
      const n = WAYPOINTS[this.holdNode];
      if (Math.hypot(n.x - this.x, n.z - this.z) > 0.6) {
        this.moveToward(n.x, n.z, dt, state.colliders, BOT_SPEED);
      } else {
        // Idle scan: slow yaw sweep across the lane.
        this.yaw += Math.sin(now * 0.5 + this.id) * dt * 0.35;
      }
      // Hearing: a recent shot within 25 m pulls a holder toward the sound.
      if (now - this.hearAt < 1.5) {
        const hd = Math.hypot(this.hearX - this.x, this.hearZ - this.z);
        if (hd < 25 && hd > 3) {
          this.state = 'push';
          this.path = [nearestWaypoint(this.hearX, this.hearZ)];
          this.pathIdx = 0;
        }
      }
      return;
    }

    // push / retreat: (re)path when needed, then walk node by node.
    if (this.pathIdx >= this.path.length) {
      const dest = this.chooseDestination(state);
      const from = nearestWaypoint(this.x, this.z);
      this.path = bfsPath(from, dest);
      this.pathIdx = 0;
      if (this.state === 'retreat' && this.path.length === 0) this.state = 'hold';
    }
    if (this.pathIdx < this.path.length) {
      const n = WAYPOINTS[this.path[this.pathIdx]];
      if (this.moveToward(n.x, n.z, dt, state.colliders, BOT_SPEED)) this.pathIdx++;
      // Stuck detection: no progress for 1.5 s -> skip to the next node.
      const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
      if (moved < 0.02) { this.stuckTimer += dt; if (this.stuckTimer > 1.5) { this.pathIdx++; this.stuckTimer = 0; } }
      else this.stuckTimer = 0;
      this.lastX = this.x; this.lastZ = this.z;
    } else if (this.state === 'push') {
      // Arrived at a site: attackers hold the site, defenders hold their node.
      this.state = this.team === 'bastion' ? 'hold' : 'hold';
      this.holdNode = nearestWaypoint(this.x, this.z);
    }
  }

  fireAt(foe, dist, state, events) {
    this.cooldown = 60 / this.weapon.rpm;
    this.ammo--;
    this.burstLeft--;
    // Hit chance: base 0.55, -0.008/m, -0.12 if foe is sprinting/moving fast.
    // A defender holding its site aims steadier (+0.10).
    let p = 0.55 - dist * 0.008;
    if (this.state === 'hold' && this.team === 'bastion') p += 0.10;
    if (foe.moving) p -= 0.12;
    if (foe.crouch) p -= 0.06;
    p = Math.max(0.08, Math.min(0.85, p));
    const head = this.rng() < 0.12;
    const hit = this.rng() < p;
    const from = { x: this.x, y: this.eyeY, z: this.z };
    const to = { x: foe.x, y: foe.y, z: foe.z };
    events.push({ type: 'shot', from, to, hit, shooter: this.id, kind: 'rifle' });
    if (hit) {
      const dmg = damageAt(this.weapon, dist, head);
      events.push({ type: 'damage', target: foe.ref, amount: dmg, head, by: this.id });
    }
    if (this.ammo <= 0) this.reloadLeft = 2.5;
  }
}
