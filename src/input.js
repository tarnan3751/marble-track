// Keyboard / gamepad / touch -> a smoothed 2D tilt vector in [-1, 1].

export class Input {
  constructor(el) {
    this.keys = new Set();
    this.x = 0; this.y = 0;
    this.tx = 0; this.ty = 0;
    this.startRequested = false;
    this.pauseRequested = false;
    this.muteRequested = false;
    this.touch = null;
    this.gamepadActive = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'Enter') { this.startRequested = true; e.preventDefault(); }
      if (e.code === 'KeyP' || e.code === 'Escape') this.pauseRequested = true;
      if (e.code === 'KeyM') this.muteRequested = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    const target = el;
    target.addEventListener('pointerdown', (e) => {
      this.startRequested = true;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      target.setPointerCapture?.(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (this.touch && e.pointerId === this.touch.id) { this.touch.x = e.clientX; this.touch.y = e.clientY; }
    });
    const end = (e) => { if (this.touch && e.pointerId === this.touch.id) this.touch = null; };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  consumeStart() { const r = this.startRequested; this.startRequested = false; return r; }
  consumePause() { const r = this.pauseRequested; this.pauseRequested = false; return r; }
  consumeMute() { const r = this.muteRequested; this.muteRequested = false; return r; }

  _readGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      let ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const dz = 0.15;
      const m = Math.hypot(ax, ay);
      if (gp.buttons[0]?.pressed || gp.buttons[9]?.pressed) this.startRequested = true;
      if (m < dz) continue;
      const scaled = (m - dz) / (1 - dz);
      ax = (ax / m) * scaled; ay = (ay / m) * scaled;
      this.gamepadActive = true;
      return { x: ax, y: -ay };
    }
    return null;
  }

  update(dt) {
    let tx = 0, ty = 0;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) tx -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) tx += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) ty += 1;
    if (k.has('ArrowDown') || k.has('KeyS')) ty -= 1;
    const gp = this._readGamepad();
    if (gp) { tx = gp.x; ty = gp.y; }
    if (this.touch) {
      const r = 70;
      tx = (this.touch.x - this.touch.ox) / r;
      ty = -(this.touch.y - this.touch.oy) / r;
    }
    this.tx = tx; this.ty = ty;
    if (gp || this.touch) {
      // analogue sources are already smooth: use them directly
      const m = Math.hypot(tx, ty);
      if (m > 1) { tx /= m; ty /= m; }
      this.x = tx; this.y = ty;
      return;
    }
    // keyboard: ramp like a thumb on a stick, ~0.2 s to full, a bit quicker back
    const rateUp = 5, rateDown = 8;
    const move = (cur, tgt) => {
      const rate = Math.abs(tgt) > Math.abs(cur) ? rateUp : rateDown;
      const d = tgt - cur;
      const step = rate * dt;
      return Math.abs(d) <= step ? tgt : cur + Math.sign(d) * step;
    };
    this.x = move(this.x, tx);
    this.y = move(this.y, ty);
  }
}
