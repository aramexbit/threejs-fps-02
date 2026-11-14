// player.js — first-person movement: acceleration, friction, gravity, jump,
// crouch, sprint, ADS slowdown, per-axis AABB collision against the map.
// The player is a capsule approximated by an AABB; eye height drives the camera.
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.08;
export const RADIUS = 0.35;

export class Player {
  constructor(spawn) {
    this.x = spawn.x; this.y = 0; this.z = spawn.z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = spawn.yaw; this.pitch = 0;
    this.onGround = true;
    this.crouch = false;
    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.money = 800;
    this.weapons = ['p9']; // owned weapon ids
    this.grenades = 0;
    this.flashes = 0;
    this.current = 'p9';
    this.aiming = false; // ADS
    this.sprinting = false;
    this.speed2d = 0; // horizontal speed, for spread + HUD
    this.stepPhase = 0; // footstep timing
    this.lastStepAt = 0;
  }

  get eyeY() { return this.y + (this.crouch ? EYE_CROUCH : EYE_STAND); }
  get height() { return this.crouch ? 1.16 : 1.8; }

  // Damage: armor absorbs half while it lasts (classic 50/50 split).
  damage(amount) {
    if (!this.alive) return;
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.5);
      this.armor -= absorbed;
      rest = amount - absorbed;
    }
    this.health -= rest;
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  healFull() { this.health = 100; this.alive = true; }

  reset(spawn) {
    this.x = spawn.x; this.y = 0; this.z = spawn.z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = spawn.yaw; this.pitch = 0;
    this.onGround = true; this.crouch = false;
    this.aiming = false; this.sprinting = false;
    this.healFull();
  }

  // Move one fixed step. `input` is the frame's control state.
  // Returns true when a footstep sound should play.
  step(dt, input, colliders) {
    if (!this.alive) return false;
    const accel = 42;
    const maxWalk = this.crouch ? 2.6 : 5.2;
    const maxRun = this.sprinting && !this.crouch && !this.aiming ? 6.9 : maxWalk;
    const maxSpeed = this.aiming ? maxWalk * 0.65 : maxRun;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward is -Z rotated by yaw; right is +X rotated by yaw.
    let fx = -sin, fz = -cos;
    let rx = cos, rz = -sin;
    let mx = 0, mz = 0;
    if (input.forward) { mx += fx; mz += fz; }
    if (input.back) { mx -= fx; mz -= fz; }
    if (input.left) { mx -= rx; mz -= rz; }
    if (input.right) { mx += rx; mz += rz; }
    const mlen = Math.hypot(mx, mz);
    if (mlen > 0) { mx /= mlen; mz /= mlen; }
    this.vx += mx * accel * dt;
    this.vz += mz * accel * dt;
    // Friction when no input (stronger on ground).
    const fr = this.onGround ? Math.exp(-9.5 * dt) : Math.exp(-0.6 * dt);
    if (mlen === 0) { this.vx *= fr; this.vz *= fr; }
    // Clamp horizontal speed.
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > maxSpeed) { this.vx *= maxSpeed / sp; this.vz *= maxSpeed / sp; }
    this.speed2d = Math.hypot(this.vx, this.vz);
    // Gravity + jump.
    this.vy -= 22 * dt;
    if (input.jump && this.onGround) { this.vy = 7.6; this.onGround = false; }
    if (this.vy < -24) this.vy = -24;
    this.crouch = !!input.crouch;

    // Integrate per axis, resolving against AABBs.
    this.moveAxis(dt, 'x', colliders);
    this.moveAxis(dt, 'z', colliders);
    this.moveAxis(dt, 'y', colliders);
    // Footsteps: one per stride while moving on the ground.
    let stepped = false;
    if (this.onGround && this.speed2d > 1.2) {
      this.stepPhase += this.speed2d * dt;
      if (this.stepPhase > 2.4) { this.stepPhase = 0; stepped = true; }
    }
    return stepped;
  }

  moveAxis(dt, axis, colliders) {
    const r = RADIUS;
    const halfH = this.height / 2;
    if (axis === 'x') this.x += this.vx * dt;
    if (axis === 'z') this.z += this.vz * dt;
    if (axis === 'y') this.y += this.vy * dt;
    const minX = this.x - r, maxX = this.x + r;
    const minY = this.y, maxY = this.y + this.height;
    const minZ = this.z - r, maxZ = this.z + r;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (maxX <= c.minX || minX >= c.maxX || maxY <= c.minY || minY >= c.maxY ||
          maxZ <= c.minZ || minZ >= c.maxZ) continue;
      if (axis === 'x') {
        if (this.vx > 0) this.x = c.minX - r - 0.001; else if (this.vx < 0) this.x = c.maxX + r + 0.001;
        this.vx = 0;
      } else if (axis === 'z') {
        if (this.vz > 0) this.z = c.minZ - r - 0.001; else if (this.vz < 0) this.z = c.maxZ + r + 0.001;
        this.vz = 0;
      } else {
        if (this.vy > 0) { this.y = c.minY - this.height - 0.001; }
        else if (this.vy <= 0) { this.y = c.maxY; this.onGround = true; }
        this.vy = 0;
      }
    }
    // Map bounds clamp (the walls already collide, this is a backstop).
    if (this.x < -21.4) { this.x = -21.4; this.vx = 0; }
    if (this.x > 21.4) { this.x = 21.4; this.vx = 0; }
    if (this.z < -17.4) { this.z = -17.4; this.vz = 0; }
    if (this.z > 17.4) { this.z = 17.4; this.vz = 0; }
    if (this.y < 0) { this.y = 0; this.vy = 0; this.onGround = true; }
  }
}
