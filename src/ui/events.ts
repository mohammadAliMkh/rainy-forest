// What the screens announce (the buttons and controls the player uses).
// app/ listens with ui.on(name, fn); see UI.js for where each is sent.

export interface UiEvents {
  /** "enter the forest" */
  enter: undefined;
  /** close the settings menu (Continue, ×, a tap on the background) */
  resume: undefined;
  /** play the introductions again */
  replayIntro: undefined;
  /** skip the introductions */
  skip: undefined;
  mute: boolean;
  volume: { key: string; value: number };
  /** hour of the day, 0..24 */
  time: number;
  /** seconds per full day (0 = time stopped) */
  daySpeed: number;
  sensitivity: number;
  /** 'auto' or a quality level name */
  quality: string;
  minimap: boolean;
}
