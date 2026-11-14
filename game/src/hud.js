// hud.js — DOM overlay: health/armor, ammo, money, timer, round score,
// bomb status, killfeed, crosshair, hitmarker, round banner, buy menu.
// The HUD is rebuilt from state every frame; it never owns game state.
import { WEAPONS, GRENADE, ARMOR_PRICE } from './weapons.js';
import { CSS } from './palette.js';

const BUY_LIST = [
  { id: 'p9', name: 'P9 Pistol', desc: 'Reliable sidearm. 12 rounds.', price: 0 },
  { id: 'vex9', name: 'Vex-9 SMG', desc: 'Fast close-quarters spray. 25 rounds.', price: 1500 },
  { id: 'ar77', name: 'AR-77 Rifle', desc: 'The all-rounder. 30 rounds.', price: 2700 },
  { id: 'longbow', name: 'Longbow-7 Sniper', desc: 'One shot, long lane. 5 rounds, scoped.', price: 4750 },
  { id: 'he', name: 'HE Grenade', desc: 'Explodes after a short fuse. Radius 6.5 m.', price: 300 },
  { id: 'flash', name: 'Flashbang', desc: 'Blinds bots that see it burst.', price: 200 },
  { id: 'armor', name: 'Kevlar Armor', desc: 'Absorbs half of incoming damage.', price: 650 },
];

export class HUD {
  constructor(root, hooks) {
    this.hooks = hooks; // {onBuy(id), onResume()}
    this.root = root;
    root.innerHTML = `
      <div id="hud-top">
        <div id="hud-timer">15</div>
        <div id="hud-score"><span class="sol">SOLARA 0</span><span class="mid">ROUND 1</span><span class="bas">0 BASTION</span></div>
        <div id="hud-bomb"></div>
      </div>
      <div id="hud-killfeed"></div>
      <div id="hud-crosshair"><div class="ch-dot"></div><div class="ch l"></div><div class="ch r"></div><div class="ch t"></div><div class="ch b"></div></div>
      <div id="hud-hitmarker"></div>
      <div id="hud-bottom">
        <div id="hud-health"><div id="hud-hpbar"><div id="hud-hpfill"></div></div><div id="hud-hptext">100</div><div id="hud-armor"></div></div>
        <div id="hud-right"><div id="hud-ammo">12 / 48</div><div id="hud-weapon">P9</div><div id="hud-money">$800</div></div>
      </div>
      <div id="hud-hint"></div>
      <div id="hud-banner"></div>
      <div id="hud-buy" class="hidden"><div class="buy-title">BUY MENU — freeze time <span id="buy-money"></span></div><div id="buy-items"></div><div class="buy-foot">Click an item to buy · B to close · weapons: Q to switch</div></div>
      <div id="hud-start">
        <div class="start-title">DUSTLINE</div>
        <div class="start-sub">A tactical FPS on the Helio Flats solar farm — Solara vs Bastion</div>
        <div class="start-body">Plant the bomb at site A (Array) or B (Pump House), or eliminate Bastion.<br>
        WASD move · mouse aim · click fire · R reload · Shift sprint · C crouch · RMB aim · B buy · E plant/defuse · G grenade · F flash · Q switch weapon</div>
        <button id="start-btn">CLICK TO DEPLOY</button>
        <div class="start-note">First to 5 rounds wins the match. Freeze 15 s, rounds 100 s, fuse 40 s.</div>
      </div>
      <div id="hud-damage"></div>
      <div id="hud-flash"></div>`;
    this.el = {};
    for (const id of ['hud-timer', 'hud-score', 'hud-bomb', 'hud-killfeed', 'hud-crosshair',
      'hud-hitmarker', 'hud-hpbar', 'hud-hpfill', 'hud-hptext', 'hud-armor', 'hud-ammo',
      'hud-weapon', 'hud-money', 'hud-hint', 'hud-banner', 'hud-buy', 'buy-items',
      'buy-money', 'hud-start', 'start-btn', 'hud-damage', 'hud-flash']) {
      this.el[id] = root.querySelector('#' + id);
    }
    this.el['start-btn'].addEventListener('click', () => hooks.onResume());
    this._feed = [];
    this._lastBanner = '';
    this._hitAt = 0;
    this._buyRendered = -1;
  }

  showStart(show) { this.el['hud-start'].classList.toggle('hidden', !show); }
  hitmark(head) {
    this.el['hud-hitmarker'].textContent = head ? '✕ HEADSHOT' : '✕';
    this.el['hud-hitmarker'].classList.add('show');
    this._hitAt = performance.now();
  }
  damageFlash() {
    this.el['hud-damage'].classList.remove('show');
    void this.el['hud-damage'].offsetWidth;
    this.el['hud-damage'].classList.add('show');
  }
  flashPlayer() {
    this.el['hud-flash'].classList.remove('show');
    void this.el['hud-flash'].offsetWidth;
    this.el['hud-flash'].classList.add('show');
  }
  banner(text, sub, cls) {
    if (text === this._lastBanner) return;
    this._lastBanner = text;
    const b = this.el['hud-banner'];
    b.innerHTML = text ? `<div class="b-main ${cls || ''}">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}` : '';
  }

  renderBuy(state) {
    const p = state.player;
    if (this._buyRendered === p.money && this.el['hud-buy'].dataset.open === '1') return;
    this._buyRendered = p.money;
    this.el['buy-money'].textContent = `$${p.money}`;
    const items = this.el['buy-items'];
    items.innerHTML = '';
    for (const item of BUY_LIST) {
      const owned = item.id === 'armor' ? p.armor >= 100 : p.weapons.includes(item.id);
      const afford = p.money >= item.price;
      const div = document.createElement('div');
      div.className = 'buy-item' + (owned ? ' owned' : '') + (!afford && !owned ? ' poor' : '');
      div.innerHTML = `<span class="bi-name">${item.name}${owned ? ' ✓' : ''}</span><span class="bi-desc">${item.desc}</span><span class="bi-price">${item.price === 0 ? 'FREE' : '$' + item.price}</span>`;
      div.addEventListener('click', () => { this.hooks.onBuy(item.id); this._buyRendered = -1; });
      items.appendChild(div);
    }
  }

  update(state, nowMs) {
    const p = state.player;
    const w = state.weapons[p.current];
    // Timer + score.
    const t = Math.max(0, Math.ceil(state.phaseTime));
    const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    this.el['hud-timer'].textContent = state.phase === 'match' ? '—' : `${mm}:${ss}`;
    this.el['hud-timer'].classList.toggle('urgent', t <= 10 && (state.phase === 'round' || state.phase === 'planted'));
    this.el['hud-score'].innerHTML =
      `<span class="sol">SOLARA ${state.score.solara}</span><span class="mid">ROUND ${state.round} · ${state.phase.toUpperCase()}</span><span class="bas">${state.score.bastion} BASTION</span>`;
    // Bomb line.
    let bombHtml = '';
    if (state.bomb.planted) bombHtml = `<span class="bomb-live">● BOMB PLANTED — site ${state.bomb.site} · ${Math.ceil(state.bomb.fuse)}s</span>`;
    else if (state.bomb.carrier === 'player') bombHtml = `<span class="bomb-carry">YOU CARRY THE BOMB — plant at site ${state.bomb.targetSite} (${state.bomb.targetSite === 'A' ? 'Array' : 'Pump House'})</span>`;
    else if (state.bomb.carrier) bombHtml = `<span class="bomb-carry">Teammate carries the bomb</span>`;
    this.el['hud-bomb'].innerHTML = bombHtml;
    // Health / armor / ammo / money.
    this.el['hud-hpfill'].style.width = `${p.health}%`;
    this.el['hud-hpfill'].style.background = p.health > 50 ? CSS.accent : p.health > 25 ? '#ff8c42' : CSS.danger;
    this.el['hud-hptext'].textContent = `${Math.ceil(p.health)} HP`;
    this.el['hud-armor'].textContent = p.armor > 0 ? `ARMOR ${Math.ceil(p.armor)}` : '';
    if (w) {
      this.el['hud-ammo'].textContent = w.reloading ? 'RELOADING…' : `${w.ammo} / ${w.reserve}`;
      this.el['hud-weapon'].textContent = w.def.name + (p.grenades ? ` · HE ×${p.grenades}` : '') + (p.flashes ? ` · FLASH ×${p.flashes}` : '');
    }
    this.el['hud-money'].textContent = `$${p.money}`;
    // Hint line: contextual.
    let hint = '';
    if (!p.alive) hint = 'You are down — spectating your team. Next round starts soon.';
    else if (state.phase === 'freeze') hint = 'FREEZE — press B to open the buy menu';
    else if (state.bomb.carrier === 'player' && !state.bomb.planted) {
      const s = state.bomb.targetSite === 'A' ? 'Array' : 'Pump House';
      hint = `Carry the bomb to site ${state.bomb.targetSite} (${s}) and hold E to plant`;
    } else if (state.bomb.planted && state.bomb.site) hint = `Bomb ticking at site ${state.bomb.site} — defend it`;
    else if (state.plantProgress > 0) hint = `Planting… ${Math.round(state.plantProgress * 100)}%`;
    this.el['hud-hint'].textContent = hint;
    // Killfeed (last 5, 6 s).
    this._feed = state.killfeed.filter((k) => state.time - k.t < 6).slice(-5);
    this.el['hud-killfeed'].innerHTML = this._feed.map((k) => `<div>${k.text}</div>`).join('');
    // Crosshair gap scales with current spread.
    const spreadPx = w ? 6 + w.spreadFor(p.speed2d, !p.onGround, p.crouch, p.aiming) * 900 : 10;
    const ch = this.el['hud-crosshair'];
    ch.style.setProperty('--gap', `${spreadPx.toFixed(1)}px`);
    ch.classList.toggle('ads', !!p.aiming);
    ch.style.display = p.alive && !state.buyOpen ? 'block' : 'none';
    // Hitmarker fade.
    if (nowMs - this._hitAt > 220) this.el['hud-hitmarker'].classList.remove('show');
    // Banner.
    if (state.phase === 'match') {
      this.banner(state.matchWinner === 'solara' ? 'SOLARA WINS THE MATCH'
        : state.matchWinner === 'bastion' ? 'BASTION WINS THE MATCH' : 'MATCH DRAWN',
        `Final score ${state.score.solara} — ${state.score.bastion} · press R to play again`,
        state.matchWinner === 'solara' ? 'win' : 'lose');
    } else if (state.phase === 'end') {
      this.banner(state.roundWinner === 'solara' ? 'SOLARA WINS THE ROUND' : 'BASTION WINS THE ROUND',
        state.roundReason || '', state.roundWinner === 'solara' ? 'win' : 'lose');
    } else if (state.phase === 'freeze') {
      this.banner(`ROUND ${state.round}`, 'Buy up — the round starts soon', '');
    } else if (state.phase === 'planted') {
      this.banner('', '', '');
      this._lastBanner = '';
    } else {
      this.banner('', '', '');
      this._lastBanner = '';
    }
    // Buy menu.
    const buy = this.el['hud-buy'];
    buy.classList.toggle('hidden', !state.buyOpen);
    if (state.buyOpen) { buy.dataset.open = '1'; this.renderBuy(state); }
    else buy.dataset.open = '0';
    // Hide the start overlay once deployed.
    if (state.started) this.el['hud-start'].classList.add('hidden');
  }
}
