// Minimal UI: loading bar, start screen, Esc settings menu (volumes, mute,
// time of day, day speed, mouse sensitivity, graphics quality), toast hints.
// Settings are remembered in localStorage when available.

import { EventBus } from '../engine/events.ts';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'rainy-forest-settings-v2';

export class UI {
  constructor() {
    this.settings = {
      volumes: { master: 0.85, rain: 0.8, wind: 0.75, fire: 0.9, wildlife: 0.85, steps: 0.7, voices: 1, music: 0.5 },
      muted: false,
      daySpeed: 3600,
      sensitivity: 1,
      quality: 'auto',
      qualityV: 2,
      showFps: false,
      subtitles: false, // subtitles for the introductions (off unless the visitor wants them)
      minimap: true,
      weather: 'auto', // the rain comes and goes by itself
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved) this.settings = { ...this.settings, ...saved, volumes: { ...this.settings.volumes, ...(saved.volumes || {}) } };
      // older saves stored the then-default "medium": switch them to automatic
      if (saved && saved.qualityV !== 2) { this.settings.quality = 'auto'; this.settings.qualityV = 2; }
    } catch { /* storage unavailable */ }
    /** what the screens announce (list: ./events.ts) @type {EventBus<import('./events.ts').UiEvents>} */
    this.events = new EventBus();
  }

  /**
   * listen to a screen event; returns a function that stops listening
   * @template {keyof import('./events.ts').UiEvents} K
   * @param {K} name
   * @param {(payload: import('./events.ts').UiEvents[K]) => void} fn
   */
  on(name, fn) { return this.events.on(name, fn); }

  /**
   * @template {keyof import('./events.ts').UiEvents} K
   * @param {K} name
   * @param {import('./events.ts').UiEvents[K]} [payload]
   */
  emit(name, payload) { this.events.emit(name, /** @type {import('./events.ts').UiEvents[K]} */ (payload)); }

  /** the settings menu is showing */
  isMenuOpen() { return !$('pause').classList.contains('hidden'); }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  // only the progress bar while loading (the build steps stay off screen)
  setLoading(p) {
    $('loading-bar').style.width = `${Math.round(p * 100)}%`;
  }

  showLoadingError(text) { $('loading-step').textContent = text; }

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

  setCinema(on) {
    $('cinema').classList.toggle('hidden', !on);
    if (!on) { this.setCaption(null); this.setSubtitle(null); }
  }

  setFade(a) {
    if (a === this._fade) return;
    this._fade = a;
    $('fade').style.opacity = a;
  }

  // subtitle of the line being spoken; only shown when turned on in the menu
  setSubtitle(text) {
    this._subText = text || null;
    const el = $('intro-sub');
    const show = !!this._subText && this.settings.subtitles;
    if (show) el.textContent = this._subText;
    el.classList.toggle('show', show);
  }

  setCaption(name) {
    const el = $('caption');
    if (name) el.textContent = name;
    el.classList.toggle('show', !!name);
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

  // label of the "automatic" option shows the level it picked right now
  setAutoQualityLabel(levelName) {
    const names = { low: 'پایین', medium: 'متوسط', high: 'بالا', ultra: 'خیلی بالا' };
    const opt = document.querySelector('#quality option[value="auto"]');
    if (opt) opt.textContent = `خودکار (الان: ${names[levelName] || levelName})`;
  }

  bind() {
    const s = this.settings;
    $('enter-btn').addEventListener('click', () => this.emit('enter'));
    $('resume-btn').addEventListener('click', () => this.emit('resume'));
    $('close-btn').addEventListener('click', () => this.emit('resume'));
    $('replay-btn').addEventListener('click', () => this.emit('replayIntro'));
    // a click / tap on the dimmed background closes the menu too
    $('pause').addEventListener('click', (e) => { if (e.target === $('pause')) this.emit('resume'); });
    $('skip-btn').addEventListener('click', (e) => { e.stopPropagation(); this.emit('skip'); });

    for (const k of Object.keys(s.volumes)) {
      const el = $(`vol-${k}`);
      el.value = s.volumes[k];
      el.addEventListener('input', () => {
        s.volumes[k] = parseFloat(el.value);
        this.emit('volume', { key: k, value: s.volumes[k] });
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
    $('weather').value = s.weather;
    $('weather').addEventListener('change', () => { s.weather = $('weather').value; this.emit('weather', s.weather); this.save(); });

    $('day-speed').value = String(s.daySpeed);
    $('day-speed').addEventListener('change', () => { s.daySpeed = parseInt($('day-speed').value, 10); this.emit('daySpeed', s.daySpeed); this.save(); });

    $('sensitivity').value = s.sensitivity;
    $('sensitivity').addEventListener('input', () => { s.sensitivity = parseFloat($('sensitivity').value); this.emit('sensitivity', s.sensitivity); this.save(); });

    $('quality').value = s.quality;
    $('quality').addEventListener('change', () => { s.quality = $('quality').value; this.emit('quality', s.quality); this.save(); });

    $('minimap').checked = s.minimap;
    const setMap = (on) => { s.minimap = on; $('minimap').checked = on; this.save(); this.emit('minimap', on); };
    $('minimap').addEventListener('change', () => setMap($('minimap').checked));

    $('subtitles').checked = s.subtitles;
    $('subtitles').addEventListener('change', () => {
      s.subtitles = $('subtitles').checked;
      this.save();
      this.setSubtitle(this._subText);
    });

    $('show-fps').checked = s.showFps;
    $('fps').classList.toggle('hidden', !s.showFps);
    $('show-fps').addEventListener('change', () => {
      s.showFps = $('show-fps').checked;
      $('fps').classList.toggle('hidden', !s.showFps);
      this.save();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.setMuted(!s.muted);
      if (e.code === 'KeyN' && !e.repeat) setMap(!s.minimap);
    });
  }
}
