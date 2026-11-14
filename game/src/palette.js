// palette.js — DUSTLINE colour identity: a desert solar farm at dawn.
// Warm low sun against cool blue shadow; solar panels flash teal.
export const PALETTE = {
  canvas: 0x171009, // page / sky backdrop — dark desert dawn
  surface: 0x2a2013, // ground sand, dark
  surfaceLight: 0x3a2d1b, // dry raised sand
  hairline: 0x55462f, // faded markings, panel frames
  ink: 0xf5ead2, // HUD text, warm off-white
  muted: 0xb09a78, // secondary text, dry grass
  accent: 0xffb347, // dawn sun — Solara team, muzzle, highlights
  accentDeep: 0xd97b1e, // burnt orange, rusted metal
  teal: 0x57c8c0, // solar panel glint — Bastion team, UI secondary
  tealDark: 0x1d4a48, // panel glass in shadow
  danger: 0xff5a3c, // damage, bomb, low health
  panelFace: 0x14333a, // solar cell face
  metal: 0x6b5a41, // crates, posts
  wall: 0x4a3a26, // perimeter walls
};

export const CSS = {
  canvas: '#171009',
  surface: '#2a2013',
  hairline: '#55462f',
  ink: '#f5ead2',
  muted: '#b09a78',
  accent: '#ffb347',
  teal: '#57c8c0',
  danger: '#ff5a3c',
};

// Team colours, shared by bots, tracers and HUD chips.
export const TEAM = {
  solara: { main: 0xffb347, dark: 0x8a5a16, css: '#ffb347', name: 'SOLARA' },
  bastion: { main: 0x57c8c0, dark: 0x1d4a48, css: '#57c8c0', name: 'BASTION' },
};
