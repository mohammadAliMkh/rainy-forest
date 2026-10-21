import type { UI } from '../ui/UI.js';
import type { Soundscape } from '../game/sound/Soundscape.js';
import type { DayCycle } from '../game/weather/DayCycle.js';
import type { PlayerController } from '../game/player/PlayerController.js';
import type { QualityManager } from '../engine/quality/QualityManager.ts';
import type { Lighting } from '../game/lighting/Lighting.ts';

// The saved settings (ui.settings, kept in localStorage) applied to the game
// at start, and the settings menu connected to the parts it controls.

export function connectSettings({ ui, sound, day, player, quality, lighting }: {
  ui: UI; sound: Soundscape; day: DayCycle; player: PlayerController; quality: QualityManager; lighting: Lighting;
}): void {
  const s = ui.settings;
  Object.assign(sound.engine.volumes, s.volumes);
  sound.engine.muted = s.muted;
  day.cycleSeconds = s.daySpeed;
  player.sensitivity = s.sensitivity;
  ui.on('volume', (k: string, v: number) => sound.engine.setVolume(k, v));
  ui.on('mute', (m: boolean) => sound.engine.setMuted(m));
  ui.on('time', (h: number) => { day.setHour(h); lighting.refreshEnv(); });
  ui.on('daySpeed', (v: number) => { day.cycleSeconds = v; });
  ui.on('sensitivity', (v: number) => { player.sensitivity = v; });
  ui.on('quality', (q: string) => quality.setSetting(q));
}
