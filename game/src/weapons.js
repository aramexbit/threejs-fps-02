// weapons.js — data-driven arsenal. One Weapon class, one WEAPONS table;
// the judge (and the buy menu) read the same numbers the sim uses.
// Damage falls off with range; headshots multiply; spread grows with speed
// and fire, shrinks when still, crouched, or aiming down sights.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9', kind: 'pistol', price: 0,
    damage: 34, headMult: 4, rpm: 320, auto: false,
    mag: 12, reserve: 48, reloadTime: 1.6,
    spread: 0.011, moveSpread: 0.030, airSpread: 0.05,
    recoil: 0.011, range: 42, tracer: 0xffd27a,
  },
  vex9: {
    id: 'vex9', name: 'Vex-9', kind: 'smg', price: 1500,
    damage: 26, headMult: 4, rpm: 750, auto: true,
    mag: 25, reserve: 100, reloadTime: 2.1,
    spread: 0.020, moveSpread: 0.038, airSpread: 0.06,
    recoil: 0.009, range: 34, tracer: 0xffe1a1,
  },
  ar77: {
    id: 'ar77', name: 'AR-77', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, rpm: 600, auto: true,
    mag: 30, reserve: 90, reloadTime: 2.5,
    spread: 0.014, moveSpread: 0.034, airSpread: 0.055,
    recoil: 0.014, range: 55, tracer: 0xffc46b,
  },
  longbow: {
    id: 'longbow', name: 'Longbow-7', kind: 'sniper', price: 4750,
    damage: 88, headMult: 4, rpm: 50, auto: false,
    mag: 5, reserve: 15, reloadTime: 3.2,
    spread: 0.004, moveSpread: 0.05, airSpread: 0.09,
    recoil: 0.05, range: 90, tracer: 0xfff2c8, scoped: true,
  },
};

export const GRENADE = {
  he: { id: 'he', name: 'HE Grenade', price: 300, radius: 6.5, maxDamage: 95, fuse: 1.15 },
  flash: { id: 'flash', name: 'Flashbang', price: 200, radius: 15, blindTime: 2.2 },
};
export const ARMOR_PRICE = 650;
export const ARMOR_POINTS = 100;

export class Weapon {
  constructor(id) {
    this.def = WEAPONS[id];
    this.id = id;
    this.ammo = this.def.mag;
    this.reserve = this.def.reserve;
    this.cooldown = 0; // seconds until next shot allowed
    this.reloadLeft = 0;
    this.recoilPitch = 0; // accumulated visual + aim kick, decays
    this.bloom = 0; // spread growth from sustained fire
  }

  get reloading() { return this.reloadLeft > 0; }

  // Current angular spread (radians) for one shot.
  spreadFor(speed2d, airborne, crouch, aiming) {
    let s = this.def.spread + this.bloom;
    s += (speed2d / 6.9) * this.def.moveSpread;
    if (airborne) s += this.def.airSpread;
    if (crouch) s *= 0.8;
    if (aiming) s *= 0.6;
    return s;
  }

  canFire() { return this.cooldown <= 0 && this.reloadLeft <= 0 && this.ammo > 0; }

  // Fire one shot. Returns 'shot' | 'empty' | 'busy'. Caller applies the raycast.
  fire() {
    if (this.reloadLeft > 0 || this.cooldown > 0) return 'busy';
    if (this.ammo <= 0) return 'empty';
    this.ammo--;
    this.cooldown = 60 / this.def.rpm;
    this.bloom = Math.min(0.05, this.bloom + this.def.recoil * 0.55);
    this.recoilPitch += this.def.recoil;
    return 'shot';
  }

  startReload() {
    if (this.reloadLeft > 0 || this.ammo >= this.def.mag || this.reserve <= 0) return false;
    this.reloadLeft = this.def.reloadTime;
    return true;
  }

  step(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.bloom > 0) this.bloom = Math.max(0, this.bloom - dt * 0.09);
    if (this.recoilPitch > 0) this.recoilPitch = Math.max(0, this.recoilPitch - dt * 0.06);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        const need = this.def.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloadLeft = 0;
      }
    }
  }
}

// Damage at distance: full inside half range, linear falloff to 55% at max range.
export function damageAt(def, dist, head) {
  const half = def.range * 0.5;
  let d = def.damage;
  if (dist > half) {
    const t = Math.min(1, (dist - half) / half);
    d = def.damage * (1 - 0.45 * t);
  }
  if (head) d *= def.headMult;
  return d;
}
