import { WORLD, CABIN, FIRE, CAMP, PUDDLES } from '../core/config.js';

// Small round map in the corner (bottom right on desktop, top left on
// phones). It turns with the player, who is the arrow in the middle: the
// trail, the trees, the cabin, the fire with the friends around it, Luna,
// the carport with the Patrol and the Hornet, puddles and the deer.
// A click / tap switches between a close and a wide view. When the camp is
// off the map, a small marker on the rim points the way back.

const K = 2; // static layer: pixels per metre
const HALF = WORLD.playableRadius + 12; // static layer covers [-HALF, HALF] metres
const ZOOMS = [28, 75]; // map radius in metres (close / wide)

export class Minimap {
  constructor({ container, trees, pathLine, camp, deer }) {
    this.camp = camp;
    this.deer = deer;
    this.zoom = 0;
    this.time = 0;
    this.visible = true;

    this.el = document.createElement('div');
    this.el.className = 'minimap hidden';
    this.el.title = 'نقشه (کلیک: نزدیک / دور)';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'نقشه‌ی اطراف');
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.zoomLabel = document.createElement('span');
    this.zoomLabel.className = 'minimap-zoom';
    this.el.appendChild(this.zoomLabel);
    container.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.el.addEventListener('click', (e) => { e.stopPropagation(); this.toggleZoom(); });
    this._size = 0;
    const measure = () => { this._size = this.el.clientWidth; };
    window.addEventListener('resize', measure);
    this._measure = measure;
    this._acc = 1;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this._updateZoomLabel();

    this.layer = this._buildLayer(trees, pathLine);
  }

  // ---- the static part, drawn once in world space (x right, z down = north up)
  _buildLayer(trees, pathLine) {
    const S = Math.ceil(HALF * 2 * K);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const X = (x) => (x + HALF) * K;
    const Z = (z) => (z + HALF) * K;
    g.fillStyle = '#26352a';
    g.fillRect(0, 0, S, S);
    // forest floor variation + trees (darker crowns)
    for (const t of trees) {
      const r = (t.kind === 'snag' ? 0.5 : t.kind === 'broadleaf' ? 2.2 : 1.6) * Math.min(1.6, Math.max(0.6, t.height / 12));
      g.fillStyle = t.kind === 'snag' ? 'rgba(70, 58, 44, 0.8)' : t.kind === 'broadleaf' ? 'rgba(30, 52, 30, 0.85)' : 'rgba(16, 34, 24, 0.85)';
      g.beginPath();
      g.arc(X(t.x), Z(t.z), r * K, 0, Math.PI * 2);
      g.fill();
    }
    // the trail
    const trail = (w, color) => {
      g.strokeStyle = color;
      g.lineWidth = w * K;
      g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      pathLine.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
      g.stroke();
    };
    trail(2.6, '#5d4a35');
    trail(1.5, '#8a6f4e');
    // clearing around the camp and the cabin
    g.fillStyle = 'rgba(110, 90, 64, 0.55)';
    g.beginPath();
    g.ellipse(X(FIRE.x + 1), Z(FIRE.z - 2), 9 * K, 8 * K, 0, 0, Math.PI * 2);
    g.fill();
    // puddles
    g.fillStyle = 'rgba(150, 180, 205, 0.75)';
    for (const [x, z, rx, rz, rot] of PUDDLES) {
      g.beginPath();
      g.ellipse(X(x), Z(z), rx * K, rz * K, rot, 0, Math.PI * 2);
      g.fill();
    }
    const rect = (cx, cz, w, d, rot, fill, stroke) => {
      g.save();
      g.translate(X(cx), Z(cz));
      g.rotate(-rot);
      g.fillStyle = fill;
      g.fillRect((-w / 2) * K, (-d / 2) * K, w * K, d * K);
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.strokeRect((-w / 2) * K, (-d / 2) * K, w * K, d * K); }
      g.restore();
    };
    // canopy over the seats
    rect(FIRE.x, FIRE.z, CAMP.canopy.halfX * 2, CAMP.canopy.halfZ * 2, 0, 'rgba(96, 112, 70, 0.45)', 'rgba(150, 165, 110, 0.6)');
    // cabin with its roof ridge
    rect(CABIN.x, CABIN.z, CABIN.width, CABIN.depth, CABIN.rotation, '#7b5435', '#b98a5c');
    g.strokeStyle = 'rgba(40, 24, 14, 0.8)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(CABIN.x - CABIN.width / 2), Z(CABIN.z));
    g.lineTo(X(CABIN.x + CABIN.width / 2), Z(CABIN.z));
    g.stroke();
    // carport, the Patrol and the Hornet
    const cp = CAMP.carport;
    rect(cp.cx, cp.cz, cp.halfX * 2, cp.halfZ * 2, 0, 'rgba(120, 124, 128, 0.45)', 'rgba(170, 174, 178, 0.7)');
    rect(CAMP.car.x, CAMP.car.z, 1.9, 4.7, CAMP.car.yaw, '#1c1d1f', '#9aa0a6');
    rect(CAMP.bike.x, CAMP.bike.z, 0.75, 2.05, CAMP.bike.yaw, '#2f6fd6', '#bcd3ff');
    return c;
  }

  toggleZoom() {
    this.zoom = (this.zoom + 1) % ZOOMS.length;
    this._updateZoomLabel();
  }

  // "close" / "wide" appears for a moment after switching (or showing the
  // map), then fades so it never covers anything
  _updateZoomLabel() {
    this.zoomLabel.textContent = this.zoom ? 'دور' : 'نزدیک';
    this.zoomLabel.classList.add('show');
    clearTimeout(this._zoomT);
    this._zoomT = setTimeout(() => this.zoomLabel.classList.remove('show'), 2200);
  }

  setVisible(on) {
    const was = this.visible && !this.el.classList.contains('hidden');
    this.visible = on;
    this.el.classList.toggle('hidden', !on);
    if (on) { this._measure(); if (!was) this._updateZoomLabel(); }
  }

  // x / z / yaw of the player (yaw 0 = looking toward -Z)
  update(dt, x, z, yaw) {
    this.time += dt;
    if (!this.visible) return;
    // redraw at ~30 Hz: plenty for a map, half the cost at 60 FPS
    this._acc += dt;
    if (this._acc < 1 / 30) return;
    this._acc = 0;
    if (!this._size) this._measure();
    const css = this._size;
    if (!css) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(css * dpr);
    if (this.canvas.width !== size) { this.canvas.width = this.canvas.height = size; }
    const g = this.ctx;
    const R = size / 2;
    const radius = ZOOMS[this.zoom];
    const s = R / radius; // screen pixels per metre
    // world -> screen (heading up): rotate by yaw around the player
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const toScreen = (wx, wz) => {
      const dx = wx - x, dz = wz - z;
      return [R + (dx * cos - dz * sin) * s, R + (dx * sin + dz * cos) * s];
    };

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#1d2a21';
    g.fillRect(0, 0, size, size);
    // static layer
    g.save();
    g.translate(R, R);
    g.rotate(yaw);
    g.scale(s / K, s / K);
    g.drawImage(this.layer, -(x + HALF) * K, -(z + HALF) * K);
    g.restore();

    const dot = (wx, wz, r, fill, stroke) => {
      const [sx, sy] = toScreen(wx, wz);
      g.beginPath();
      g.arc(sx, sy, r * dpr, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      if (stroke) { g.lineWidth = 1.2 * dpr; g.strokeStyle = stroke; g.stroke(); }
      return [sx, sy];
    };
    // deer
    // deer: only the ones fairly close, in a neutral colour (orange means the camp)
    for (const a of this.deer?.agents ?? []) {
      if (Math.hypot(a.x - x, a.z - z) < 40) dot(a.x, a.z, 2, '#cfc6b4', 'rgba(0,0,0,0.5)');
    }
    // fire (flickering glow) and the friends around it
    const fl = 0.8 + Math.sin(this.time * 9) * 0.1 + Math.sin(this.time * 23) * 0.08;
    const [fx, fy] = toScreen(FIRE.x, FIRE.z);
    if (this._glowDpr !== dpr) {
      this._glow = g.createRadialGradient(0, 0, 0, 0, 0, 9 * dpr);
      this._glow.addColorStop(0, 'rgba(255, 190, 90, 0.9)');
      this._glow.addColorStop(1, 'rgba(255, 120, 30, 0)');
      this._glowDpr = dpr;
    }
    g.save();
    g.globalAlpha = fl;
    g.translate(fx, fy);
    g.fillStyle = this._glow;
    g.fillRect(-10 * dpr, -10 * dpr, 20 * dpr, 20 * dpr);
    g.restore();
    dot(FIRE.x, FIRE.z, 2.6, '#ffb347');
    for (const p of this.camp.gathering.people) dot(p.seat.x, p.seat.z, 2.4, '#efe2c4', 'rgba(0,0,0,0.55)');
    // Luna
    const d = this.camp.dog?.root.position;
    if (d) dot(d.x, d.z, 2.3, '#111', '#e9e3d6');

    // labels: upright, skipped when they would overlap
    // in order of importance (the fire is where everyone goes first)
    const small = css < 140;
    const labels = [
      ['آتش', FIRE.x, FIRE.z],
      ['کلبه', CABIN.x, CABIN.z],
      ...(small ? [] : [['ماشین', CAMP.car.x, CAMP.car.z], ['موتور', CAMP.bike.x, CAMP.bike.z], ['لونا', d?.x, d?.z]]),
    ];
    const northA = Math.atan2(-cos, sin); // direction of world -Z on screen
    const northX = R + Math.cos(northA) * (R - 9 * dpr), northY = R + Math.sin(northA) * (R - 9 * dpr);
    if (this.zoom === 0) {
      g.font = `600 ${10 * dpr}px Vazirmatn, Tahoma, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const boxes = [[northX - 8 * dpr, northY - 8 * dpr, 16 * dpr, 16 * dpr]]; // the north letter
      for (const [text, wx, wz] of labels) {
        if (wx === undefined) continue;
        const [px, py] = toScreen(wx, wz);
        const w = g.measureText(text).width + 6 * dpr, h = 13 * dpr;
        // above the place, else below, right or left of it; skipped if all are taken
        for (const [ox, oy] of [[0, -9], [0, 10], [w / dpr / 2 + 6, 0], [-w / dpr / 2 - 6, 0]]) {
          const sx = px + ox * dpr, sy = py + oy * dpr;
          if (Math.hypot(sx - R, sy - R) > R - 10 * dpr) continue;
          const box = [sx - w / 2, sy - h / 2, w, h];
          if (boxes.some((b) => box[0] < b[0] + b[2] && b[0] < box[0] + box[2] && box[1] < b[1] + b[3] && b[1] < box[1] + box[3])) continue;
          boxes.push(box);
          g.lineWidth = 3 * dpr;
          g.strokeStyle = 'rgba(10, 14, 12, 0.85)';
          g.strokeText(text, sx, sy);
          g.fillStyle = '#f2e9d8';
          g.fillText(text, sx, sy);
          break;
        }
      }
    }
    g.restore();

    // the camp off the map: a marker on the rim pointing the way back
    {
      const [cx, cy] = toScreen(FIRE.x, FIRE.z);
      const dist = Math.hypot(cx - R, cy - R);
      if (dist > R - 8 * dpr) {
        const a = Math.atan2(cy - R, cx - R);
        // move inward when it would sit on the north letter
        let da = Math.abs(a - Math.atan2(-cos, sin));
        if (da > Math.PI) da = Math.PI * 2 - da;
        const rr = R - (da < 0.35 ? 23 : 9) * dpr;
        g.save();
        g.translate(R + Math.cos(a) * rr, R + Math.sin(a) * rr);
        g.rotate(a);
        g.beginPath();
        g.moveTo(6 * dpr, 0);
        g.lineTo(-4 * dpr, -5 * dpr);
        g.lineTo(-4 * dpr, 5 * dpr);
        g.closePath();
        g.fillStyle = '#ffb347';
        g.fill();
        g.restore();
      }
    }
    // north marker on the rim (ش = شمال)
    {
      const nx = northX, ny = northY;
      g.font = `700 ${10 * dpr}px Vazirmatn, Tahoma, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3 * dpr;
      g.strokeStyle = 'rgba(10, 14, 12, 0.9)';
      g.strokeText('ش', nx, ny);
      g.fillStyle = '#e9a25a';
      g.fillText('ش', nx, ny);
    }
    // the player: an arrow in the middle, pointing where they look
    g.save();
    g.translate(R, R);
    g.beginPath();
    g.moveTo(0, -8 * dpr);
    g.lineTo(5.5 * dpr, 6 * dpr);
    g.lineTo(0, 3 * dpr);
    g.lineTo(-5.5 * dpr, 6 * dpr);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 1.5 * dpr;
    g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    g.stroke();
    g.restore();
  }
}
