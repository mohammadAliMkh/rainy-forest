import type { UI } from '../ui/UI.js';
import type { Soundscape } from '../game/sound/Soundscape.ts';
import type { DayCycle } from '../game/weather/DayCycle.js';
import type { PlayerController } from '../game/player/PlayerController.ts';
import type { QualityManager } from '../engine/quality/QualityManager.ts';
import type { Lighting } from '../game/lighting/Lighting.ts';
import type { Weather, WeatherMode } from '../game/weather/Weather.ts';

// The saved settings (ui.settings, kept in localStorage) applied to the game
// at start, and the settings menu connected to the parts it controls.

export function connectSettings({ ui, sound, day, player, quality, lighting, weather }: {
  ui: UI; sound: Soundscape; day: DayCycle; player: PlayerController; quality: QualityManager; lighting: Lighting; weather: Weather;
}): void {
  const s = ui.settings;
  Object.assign(sound.engine.volumes, s.volumes);
  sound.engine.muted = s.muted;
  day.cycleSeconds = s.daySpeed;
  player.sensitivity = s.sensitivity;
  ui.on('volume', ({ key, value }) => sound.engine.setVolume(key, value));
  ui.on('mute', (m) => sound.engine.setMuted(m));
  ui.on('time', (h) => { day.setHour(h); lighting.refreshEnv(); });
  ui.on('daySpeed', (v) => { day.cycleSeconds = v; });
  ui.on('sensitivity', (v) => { player.sensitivity = v; });
  ui.on('quality', (q) => quality.setSetting(q));
  ui.on('weather', (mode) => weather.setMode(mode as WeatherMode));
}
