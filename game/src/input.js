// input.js — keyboard + mouse + pointer lock, and the per-step control state
// the simulation consumes. Edge-triggered actions (reload, buy, grenade,
// weapon switch) are latched as one-step flags the sim clears.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.fire = false; // mouse held
    this.ads = false; // right mouse held
    this.onLockChange = null;
    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.ads = false;
    };
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.fire = false; this.ads = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._onCtx = (e) => e.preventDefault();
    // One-step latched flags, set on keydown, cleared by the sim.
    this.reloadPressed = false;
    this.buyPressed = false;
    this.grenadePressed = false;
    this.flashPressed = false;
    this.switchPressed = false;
    this.slot = 0;
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLock);
    this.canvas.addEventListener('contextmenu', this._onCtx);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onLock);
    this.canvas.removeEventListener('contextmenu', this._onCtx);
  }

  requestLock() {
    try { this.canvas.requestPointerLock(); } catch (e) { /* headless */ }
  }

  _key(e, down) {
    const k = e.code;
    if (['Space', 'Tab', 'KeyQ', 'KeyE', 'KeyB', 'KeyR', 'KeyG'].includes(k)) e.preventDefault();
    if (down && !e.repeat) {
      if (k === 'KeyR') this.reloadPressed = true;
      if (k === 'KeyB') this.buyPressed = true;
      if (k === 'KeyG') this.grenadePressed = true;
      if (k === 'KeyF') this.flashPressed = true;
      if (k === 'KeyQ') this.switchPressed = true;
      if (k === 'Digit1') this.slot = 1;
      if (k === 'Digit2') this.slot = 2;
      if (k === 'Digit3') this.slot = 3;
      if (k === 'Digit4') this.slot = 4;
    }
    this.keys[k] = down;
  }

  // The control state one fixed step consumes.
  frame() {
    const k = this.keys;
    return {
      forward: !!(k.KeyW || k.ArrowUp),
      back: !!(k.KeyS || k.ArrowDown),
      left: !!(k.KeyA || k.ArrowLeft),
      right: !!(k.KeyD || k.ArrowRight),
      jump: !!k.Space,
      crouch: !!(k.KeyC || k.ControlLeft),
      sprint: !!k.ShiftLeft,
      fire: this.fire,
      ads: this.ads,
      plant: !!k.KeyE,
      reloadPressed: this.reloadPressed,
      buyPressed: this.buyPressed,
      grenadePressed: this.grenadePressed,
      flashPressed: this.flashPressed,
      switchPressed: this.switchPressed,
      slot: this.slot,
      mouseDX: this.mouseDX,
      mouseDY: this.mouseDY,
    };
  }

  // Called after the sim consumed the frame: clear latched flags + mouse deltas.
  consume(frame) {
    this.reloadPressed = false;
    this.buyPressed = false;
    this.grenadePressed = false;
    this.flashPressed = false;
    this.switchPressed = false;
    this.slot = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    frame.reloadPressed = false;
    frame.buyPressed = false;
    frame.grenadePressed = false;
    frame.flashPressed = false;
    frame.switchPressed = false;
    frame.slot = 0;
    frame.mouseDX = 0;
    frame.mouseDY = 0;
  }
}
