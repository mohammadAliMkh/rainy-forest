// Minimal UI: loading bar, start screen, Esc settings menu (volumes, mute,
// time of day, day speed, mouse sensitivity, graphics quality), toast hints.
// Settings are remembered in localStorage when available.

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'rainy-forest-settings-v2';

export class UI {
  constructor() {
    this.settings = {
      volumes: { master: 0.85, rain: 0.8, wind: 0.75, fire: 0.9, wildlife: 0.85, steps: 0.7 },
      muted: false,
      daySpeed: 3600,
      sensitivity: 1,
      quality: 'medium',
      showFps: false,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved) this.settings = { ...this.settings, ...saved, volumes: { ...this.settings.volumes, ...(saved.volumes || {}) } };
    } catch { /* storage unavailable */ }
    this.handlers = {};
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name, ...a) { this.handlers[name]?.(...a); }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  setLoading(p, text) {
    $('loading-bar').style.width = `${Math.round(p * 100)}%`;
    if (text) $('loading-step').textContent = text;
  }

  hideLoading() { $('loading').classList.add('hidden'); }
  showStart() { $('start').classList.remove('hidden'); }
  hideStart() { $('start').classList.add('hidden'); }
  showPause(msg = '') { $('pause').classList.remove('hidden'); $('lock-msg').textContent = msg; }
  hidePause() { $('pause').classList.add('hidden'); }

  toast(text, ms = 4000) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  setClock(str, hour) {
    $('clock').textContent = str;
    if (document.activeElement !== $('time-of-day')) $('time-of-day').value = hour;
  }

  setMuted(m) {
    const s = this.settings;
    s.muted = m;
    $('mute').checked = m;
    $('mute-btn').classList.toggle('muted', m);
    this.emit('mute', m);
    this.save();
    this.toast(m ? 'صدا قطع شد' : 'صدا وصل شد', 1500);
  }

  setFps(text) { $('fps').textContent = text; }

  bind() {
    const s = this.settings;
    $('enter-btn').addEventListener('click', () => this.emit('enter'));
    $('resume-btn').addEventListener('click', () => this.emit('resume'));

    for (const k of Object.keys(s.volumes)) {
      const el = $(`vol-${k}`);
      el.value = s.volumes[k];
      el.addEventListener('input', () => {
        s.volumes[k] = parseFloat(el.value);
        this.emit('volume', k, s.volumes[k]);
        this.save();
      });
    }
    $('mute').checked = s.muted;
    $('mute').addEventListener('change', () => this.setMuted($('mute').checked));
    $('mute-btn').classList.toggle('muted', s.muted);
    $('mute-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMuted(!s.muted);
      $('mute-btn').blur();
    });

    $('time-of-day').addEventListener('input', () => this.emit('time', parseFloat($('time-of-day').value)));
    $('day-speed').value = String(s.daySpeed);
    $('day-speed').addEventListener('change', () => { s.daySpeed = parseInt($('day-speed').value, 10); this.emit('daySpeed', s.daySpeed); this.save(); });

    $('sensitivity').value = s.sensitivity;
    $('sensitivity').addEventListener('input', () => { s.sensitivity = parseFloat($('sensitivity').value); this.emit('sensitivity', s.sensitivity); this.save(); });

    $('quality').value = s.quality;
    $('quality').addEventListener('change', () => { s.quality = $('quality').value; this.emit('quality', s.quality); this.save(); });

    $('show-fps').checked = s.showFps;
    $('fps').classList.toggle('hidden', !s.showFps);
    $('show-fps').addEventListener('change', () => {
      s.showFps = $('show-fps').checked;
      $('fps').classList.toggle('hidden', !s.showFps);
      this.save();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.setMuted(!s.muted);
    });
  }
}
