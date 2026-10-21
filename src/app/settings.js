// The saved settings (ui.settings, kept in localStorage) applied to the game
// at start, and the settings menu connected to the parts it controls.

export function connectSettings({ ui, sound, day, player, quality, lighting }) {
  const s = ui.settings;
  Object.assign(sound.engine.volumes, s.volumes);
  sound.engine.muted = s.muted;
  day.cycleSeconds = s.daySpeed;
  player.sensitivity = s.sensitivity;
  ui.on('volume', (k, v) => sound.engine.setVolume(k, v));
  ui.on('mute', (m) => sound.engine.setMuted(m));
  ui.on('time', (h) => { day.setHour(h); lighting.refreshEnv(); });
  ui.on('daySpeed', (v) => { day.cycleSeconds = v; });
  ui.on('sensitivity', (v) => { player.sensitivity = v; });
  ui.on('quality', (q) => quality.setSetting(q));
}
