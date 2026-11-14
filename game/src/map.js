// map.js — "Helio Flats": a desert solar farm at dawn, 44 x 36 m.
// Three east-west lanes (A ridge, mid service road, B pump lane) join two
// bombsites: A "Array" in the north-east panel field, B "Pump House" in the
// south-east. Everything is procedural boxes / cylinders; no downloaded art.
// The map is data first: OBSTACLES are AABBs the simulation collides with,
// and buildMap() turns the same data into three.js meshes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = { w: 44, h: 36, halfW: 22, halfH: 18 };

// AABB obstacles: {x, z, w, d, h, y?} — y defaults to ground (0), h is height.
export const OBSTACLES = [
  // Perimeter walls (h 3.2).
  { x: 0, z: -18.3, w: 45.2, d: 0.6, h: 3.2 },
  { x: 0, z: 18.3, w: 45.2, d: 0.6, h: 3.2 },
  { x: -22.3, z: 0, w: 0.6, d: 37.2, h: 3.2 },
  { x: 22.3, z: 0, w: 0.6, d: 37.2, h: 3.2 },
  // Pump house at B site (16, 12): three walls + roof lintel, open doorway west.
  { x: 19.2, z: 12, w: 0.6, d: 7, h: 3.4 },
  { x: 16, z: 15.2, w: 7, d: 0.6, h: 3.4 },
  { x: 16, z: 8.8, w: 7, d: 0.6, h: 3.4 },
  { x: 13.2, z: 10.2, w: 0.6, d: 3.6, h: 3.4 },
  { x: 13.2, z: 14.6, w: 0.6, d: 1.2, h: 3.4 },
  // Water tank at B (cylinder approximated as an AABB for collision).
  { x: 18.6, z: 6.4, w: 3.6, d: 3.6, h: 4.2 },
  // Solar panel rows: tilted panels stand on posts; the collision box is the
  // low slab under each row so players can use them as cover, not walk through.
  { x: 7, z: -12, w: 22, d: 1.2, h: 1.1 },
  { x: 7, z: -8.6, w: 22, d: 1.2, h: 1.1 },
  { x: -11, z: 10, w: 14, d: 1.2, h: 1.1 },
  { x: -11, z: 13.4, w: 14, d: 1.2, h: 1.1 },
  // Crates and barriers at lane corners (close-quarter cover).
  { x: -10, z: -6, w: 2, d: 2, h: 1.2 },
  { x: -2, z: -8, w: 2, d: 1, h: 1.0 },
  { x: 4, z: 4, w: 2, d: 2, h: 1.2 },
  { x: 10, z: -4, w: 1, d: 2, h: 1.0 },
  { x: -8, z: 8, w: 2, d: 1, h: 1.0 },
  { x: 12, z: 2, w: 2, d: 2, h: 1.2 },
  { x: 0, z: -14, w: 3, d: 1, h: 1.1 },
  { x: -16, z: 0, w: 1, d: 3, h: 1.4 },
  { x: 8, z: 14, w: 2, d: 1, h: 1.0 },
  // Barrels (AABB approx).
  { x: -6, z: 12, w: 1, d: 1, h: 1.1 },
  { x: 2, z: -12, w: 1, d: 1, h: 1.1 },
  { x: 14, z: -8, w: 1, d: 1, h: 1.1 },
];

// Bombsites: plant anywhere inside the radius.
export const SITES = {
  A: { name: 'Array', x: 16, z: -12, r: 4.2 },
  B: { name: 'Pump House', x: 16, z: 12, r: 4.2 },
};

export const SPAWNS = {
  solara: [
    { x: -19.5, z: -6, yaw: -Math.PI / 2 },
    { x: -19.5, z: -2, yaw: -Math.PI / 2 },
    { x: -19.5, z: 2, yaw: -Math.PI / 2 },
    { x: -19.5, z: 6, yaw: -Math.PI / 2 },
    { x: -19.5, z: 10, yaw: -Math.PI / 2 },
  ],
  bastion: [
    { x: 19.5, z: -6, yaw: Math.PI / 2 },
    { x: 19.5, z: -2, yaw: Math.PI / 2 },
    { x: 19.5, z: 2, yaw: Math.PI / 2 },
    { x: 19.5, z: 6, yaw: Math.PI / 2 },
    { x: 19.5, z: -14, yaw: Math.PI / 2 },
  ],
};

// Waypoint graph: nodes on the three lanes plus site approaches.
// Bots walk it with BFS; defenders hold the site nodes.
export const WAYPOINTS = [
  { x: -19, z: 0 },   // 0 solara spawn
  { x: -14, z: -12 }, // 1 A ridge west
  { x: -14, z: 0 },   // 2 mid west
  { x: -14, z: 12 },  // 3 B lane west
  { x: -6, z: -12 },  // 4 A ridge
  { x: -6, z: 0 },    // 5 mid
  { x: -6, z: 12 },   // 6 B lane
  { x: 2, z: -12 },   // 7 A ridge east
  { x: 2, z: 0 },     // 8 mid connector
  { x: 2, z: 12 },    // 9 B lane east
  { x: 10, z: -12 },  // 10 A approach
  { x: 10, z: 0 },    // 11 mid east
  { x: 10, z: 12 },   // 12 B approach
  { x: 16, z: -12 },  // 13 SITE A
  { x: 16, z: 12 },   // 14 SITE B
  { x: 19, z: 0 },    // 15 bastion spawn
  { x: 19, z: -12 },  // 16 A defender
  { x: 19, z: 12 },   // 17 B defender
  { x: -6, z: -4 },   // 18 cross cut A-mid
  { x: -6, z: 6 },    // 19 cross cut mid-B
  { x: 10, z: -5 },   // 20 cross cut A-mid east
  { x: 10, z: 6 },    // 21 cross cut mid-B east
];

export const WAY_LINKS = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 6],
  [4, 7], [5, 8], [6, 9], [7, 10], [8, 11], [9, 12],
  [10, 13], [12, 14], [11, 15], [13, 16], [14, 17],
  [15, 16], [15, 17], [10, 16], [12, 17],
  [4, 18], [18, 5], [5, 19], [19, 6],
  [10, 20], [20, 11], [11, 21], [21, 12],
  [1, 18], [3, 19], [7, 20], [9, 21],
];

// Colliders in simulation form: {minX, minY, minZ, maxX, maxY, maxZ}.
export function buildColliders() {
  return OBSTACLES.map((o) => {
    const y0 = o.y || 0;
    return {
      minX: o.x - o.w / 2, maxX: o.x + o.w / 2,
      minY: y0, maxY: y0 + o.h,
      minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2,
    };
  });
}

function box(w, h, d, color, x, y, z, opts) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.05, ...(opts || {}) }),
  );
  m.position.set(x, y, z);
  return m;
}

// Build the visible map into `scene`. Returns { siteMarkers } for the renderer.
export function buildMap(scene) {
  const g = new THREE.Group();
  g.name = 'helio-flats';

  // Ground: dark desert sand with a slightly lighter service road down the middle.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.w + 2, MAP.h + 2),
    new THREE.MeshStandardMaterial({ color: PALETTE.surface, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  g.add(ground);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.w, 3.4),
    new THREE.MeshStandardMaterial({ color: PALETTE.surfaceLight, roughness: 1 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  g.add(road);
  // Faded yellow centre line on the service road.
  for (let x = -20; x <= 20; x += 4) {
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x8a6f2f, roughness: 1 }),
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.02, 0);
    g.add(dash);
  }

  // Perimeter walls.
  g.add(box(45.2, 3.2, 0.6, PALETTE.wall, 0, 1.6, -18.3));
  g.add(box(45.2, 3.2, 0.6, PALETTE.wall, 0, 1.6, 18.3));
  g.add(box(0.6, 3.2, 37.2, PALETTE.wall, -22.3, 1.6, 0));
  g.add(box(0.6, 3.2, 37.2, PALETTE.wall, 22.3, 1.6, 0));

  // Solar panel rows: tilted dark-teal faces on posts, hairline frames.
  const panelMat = new THREE.MeshStandardMaterial({
    color: PALETTE.panelFace, roughness: 0.35, metalness: 0.55,
    emissive: 0x0a2e33, emissiveIntensity: 0.5,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: PALETTE.hairline, roughness: 0.6, metalness: 0.4 });
  function panelRow(cx, cz, count, gap) {
    for (let i = 0; i < count; i++) {
      const x = cx - ((count - 1) * gap) / 2 + i * gap;
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.7), panelMat);
      p.position.set(x, 1.35, cz);
      p.rotation.x = -0.5;
      g.add(p);
      const f = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 1.8), frameMat);
      f.position.set(x, 1.28, cz);
      f.rotation.x = -0.5;
      g.add(f);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), frameMat);
      post.position.set(x, 0.55, cz + 0.3);
      g.add(post);
    }
  }
  panelRow(7, -12, 8, 3);
  panelRow(7, -8.6, 8, 3);
  panelRow(-11, 10, 5, 3);
  panelRow(-11, 13.4, 5, 3);

  // Pump house at B: walls + flat roof + a door gap facing west.
  g.add(box(0.6, 3.4, 7, PALETTE.wall, 19.2, 1.7, 12));
  g.add(box(7, 3.4, 0.6, PALETTE.wall, 16, 1.7, 15.2));
  g.add(box(7, 3.4, 0.6, PALETTE.wall, 16, 1.7, 8.8));
  g.add(box(0.6, 3.4, 3.6, PALETTE.wall, 13.2, 1.7, 10.2));
  g.add(box(0.6, 3.4, 1.2, PALETTE.wall, 13.2, 1.7, 14.6));
  g.add(box(7, 0.3, 7, 0x3a2d1b, 16, 3.55, 12)); // roof
  // Water tank: rusted cylinder with a teal band.
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 1.8, 4.2, 18),
    new THREE.MeshStandardMaterial({ color: PALETTE.accentDeep, roughness: 0.7, metalness: 0.35 }),
  );
  tank.position.set(18.6, 2.1, 6.4);
  g.add(tank);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.84, 1.84, 0.35, 18),
    new THREE.MeshStandardMaterial({ color: PALETTE.teal, roughness: 0.4, metalness: 0.3 }),
  );
  band.position.set(18.6, 3.4, 6.4);
  g.add(band);

  // Crates / barriers / barrels from the obstacle data (visual only here;
  // collision uses the same OBSTACLES list, so visuals and sim agree).
  const crateMat = new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.85, metalness: 0.15 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: PALETTE.accentDeep, roughness: 0.7, metalness: 0.3 });
  for (const o of OBSTACLES) {
    if (o.h > 3) continue; // walls / house / tank handled above
    if (o.w === 1 && o.d === 1 && o.h === 1.1) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12), barrelMat);
      b.position.set(o.x, 0.55, o.z);
      g.add(b);
    } else {
      const c = box(o.w, o.h, o.d, o.h >= 1.4 ? 0x5a4630 : 0x6b5a41, o.x, o.h / 2, o.z);
      c.material = crateMat;
      g.add(c);
      // Hairline top edge so crates read at a glance.
      g.add(box(o.w + 0.06, 0.06, o.d + 0.06, PALETTE.hairline, o.x, o.h + 0.02, o.z));
    }
  }

  // Bombsite markers: translucent floor tint + corner posts, A amber / B teal.
  const siteMarkers = {};
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    const col = key === 'A' ? PALETTE.accent : PALETTE.teal;
    const tint = new THREE.Mesh(
      new THREE.CircleGeometry(s.r, 28),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.10, depthWrite: false }),
    );
    tint.rotation.x = -Math.PI / 2;
    tint.position.set(s.x, 0.03, s.z);
    g.add(tint);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.12, s.r, 40),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.04, s.z);
    g.add(ring);
    // A tall thin beacon post so the site reads from across the map.
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 4.5, 8),
      new THREE.MeshBasicMaterial({ color: col }),
    );
    beacon.position.set(s.x, 2.25, s.z);
    g.add(beacon);
    siteMarkers[key] = { tint, ring, beacon };
  }

  scene.add(g);
  return { siteMarkers };
}

// Segment (p0 -> p1) vs AABB test, for line-of-sight. Returns true when blocked.
export function segmentBlocked(p0, p1, colliders) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let t0 = 0, t1 = 1;
    let ok = true;
    // Slab test per axis.
    const axes = [
      [p0.x, dx, c.minX, c.maxX],
      [p0.y, dy, c.minY, c.maxY],
      [p0.z, dz, c.minZ, c.maxZ],
    ];
    for (let a = 0; a < 3; a++) {
      const o = axes[a][0], d = axes[a][1], mn = axes[a][2], mx = axes[a][3];
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) { ok = false; break; }
      } else {
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 <= 1 && t1 >= 0) return true;
  }
  return false;
}

// Nearest hit of a ray (origin + dir, maxDist) against colliders. Returns dist or Infinity.
export function rayWalls(origin, dir, maxDist, colliders) {
  let best = Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let t0 = 0, t1 = maxDist;
    let ok = true;
    const axes = [
      [origin.x, dir.x, c.minX, c.maxX],
      [origin.y, dir.y, c.minY, c.maxY],
      [origin.z, dir.z, c.minZ, c.maxZ],
    ];
    for (let a = 0; a < 3; a++) {
      const o = axes[a][0], d = axes[a][1], mn = axes[a][2], mx = axes[a][3];
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) { ok = false; break; }
      } else {
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 >= 0 && t0 < best) best = t0;
  }
  return best;
}
