// On-screen controls for phones / tablets: a virtual joystick (bottom-left)
// to walk, dragging anywhere else on the view to look around, a run toggle
// and a settings button (there is no Esc key on a phone). Turned on
// automatically on touch-first devices, or as soon as the screen is touched.

const $ = (id) => document.getElementById(id);
const RADIUS = 56; // px the knob can travel

export function isTouchFirst() {
  const ua = navigator.userAgent || '';
  return window.matchMedia?.('(pointer: coarse)').matches
    || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS
}

export class TouchControls {
  constructor(player, dom, { onMenu } = {}) {
    this.player = player;
    this.dom = dom;
    this.enabled = false;
    this.visible = false;
    this.joyId = null;
    this.lookId = null;
    this.onMenu = onMenu;
    this.onEnable = null;

    const joy = $('joy'), knob = $('joy-knob');
    this.joy = joy; this.knob = knob;
    this.home = null;

    const inJoyZone = (x, y) => x < window.innerWidth * 0.45 && y > window.innerHeight * 0.4;

    dom.addEventListener('touchstart', (e) => {
      if (!this.enabled) this.enable();
      if (!this.visible) return;
      for (const t of e.changedTouches) {
        if (this.joyId === null && inJoyZone(t.clientX, t.clientY)) {
          this.joyId = t.identifier;
          this.cx = t.clientX; this.cy = t.clientY;
          joy.style.left = `${t.clientX}px`;
          joy.style.top = `${t.clientY}px`;
          joy.classList.add('active');
          this._knob(0, 0);
        } else if (this.lookId === null) {
          this.lookId = t.identifier;
          this.lx = t.clientX; this.ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    dom.addEventListener('touchmove', (e) => {
      if (!this.visible) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) {
          this._knob(t.clientX - this.cx, t.clientY - this.cy);
        } else if (t.identifier === this.lookId) {
          this.player.look(t.clientX - this.lx, t.clientY - this.ly, 0.0055);
          this.lx = t.clientX; this.ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) {
          this.joyId = null;
          this._knob(0, 0);
          joy.classList.remove('active');
          joy.style.left = ''; joy.style.top = '';
        } else if (t.identifier === this.lookId) this.lookId = null;
      }
    };
    dom.addEventListener('touchend', end);
    dom.addEventListener('touchcancel', end);

    // buttons react on touch immediately (no 300 ms click delay)
    const tap = (el, fn) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
      el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    };
    tap($('run-btn'), () => {
      this.player.touchRun = !this.player.touchRun;
      $('run-btn').classList.toggle('on', this.player.touchRun);
    });
    tap($('menu-btn'), () => this.onMenu?.());
  }

  _knob(dx, dy) {
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) { dx *= RADIUS / d; dy *= RADIUS / d; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // gentle dead zone, then linear
    const m = Math.hypot(dx, dy) / RADIUS;
    const k = m < 0.12 ? 0 : (m - 0.12) / 0.88 / (m || 1);
    this.player.touchMove.x = (dx / RADIUS) * k;
    this.player.touchMove.z = (-dy / RADIUS) * k;
  }

  // switch the whole UI into touch mode (the view, help texts, buttons)
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.player.touchMode = true;
    document.body.classList.add('touch');
    this.onEnable?.();
  }

  // show / hide the on-screen controls (hidden while a menu is open)
  show(v) {
    this.visible = v && this.enabled;
    $('touch-ui').classList.toggle('hidden', !this.visible);
    if (!this.visible) {
      this.joyId = null; this.lookId = null;
      this._knob(0, 0);
      this.joy.classList.remove('active');
    }
  }
}
