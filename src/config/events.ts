import type { Vector3 } from 'three';
import type { QualityName, QualityPreset } from './config.js';

// Every event that travels between parts of the game, in one list.
// Parts announce what happened with events.emit(NAME, payload) and whoever
// cares listens with events.on(NAME, fn) - neither side knows the other.
// (Requests that need an answer stay plain calls on a service object.)

export const EV = {
  // the film-style introductions (src/game/intro)
  INTRO_CINEMATIC: 'intro:cinematic',
  INTRO_CAPTION: 'intro:caption',
  INTRO_SUBTITLE: 'intro:subtitle',
  INTRO_FADE: 'intro:fade',
  INTRO_DUCK: 'intro:duck',

  // things that make a sound
  GUITAR_STRUM: 'guitar:strum',
  PLAYER_STEP: 'player:step',
  CREATURE_SOUND: 'creature:sound',
  STORE_DOOR: 'store:door',
  SCENARIO_CUE: 'scenario:cue',

  // the errand (src/game/quest): what to do now, and people talking to the player
  QUEST: 'quest:update',
  DIALOG: 'quest:dialog',
  BANNER: 'quest:banner',

  // the weather (src/game/weather/Weather.ts)
  LIGHTNING: 'weather:lightning',

  // graphics quality (src/engine/quality)
  QUALITY_CHANGED: 'quality:changed',
  PIXEL_RATIO: 'quality:pixelRatio',
} as const;

// what each event carries
export interface GameEvents {
  /** the film camera takes (true) / gives back (false) the view */
  [EV.INTRO_CINEMATIC]: boolean;
  /** the name shown for the current line, or null */
  [EV.INTRO_CAPTION]: string | null;
  /** the optional subtitle of the current line, or null */
  [EV.INTRO_SUBTITLE]: string | null;
  /** black dip between shots, 0..1 */
  [EV.INTRO_FADE]: number;
  /** lower the ambience while he speaks */
  [EV.INTRO_DUCK]: boolean;
  [EV.GUITAR_STRUM]: { position: Vector3; chord: number; down: boolean; velocity: number };
  [EV.PLAYER_STEP]: { running: boolean; surface: 'water' | 'mud' | 'leaves' | 'wood'; side: number; speed: number };
  [EV.CREATURE_SOUND]:
    | { type: 'birdSong' | 'birdFlap'; source: { species: string; pos: Vector3 } }
    | { type: 'deerStep' | 'deerSnort'; source: { x: number; z: number } };
  /** the shop's door swings open (its bell rings) */
  [EV.STORE_DOOR]: { position: Vector3; open: boolean };
  /** a moment in a scenario that makes a sound (the ghost's tiptoe tune, its BOO, a scream...) */
  [EV.SCENARIO_CUE]:
    | { cue: 'sneak' | 'sneakStop' | 'boo' | 'giggle' | 'eek' | 'vanish' | 'pickup' | 'pay' | 'lid'; position: Vector3 }
    | { cue: 'scream'; position: Vector3; who: string };
  /** the errand's current goal and the basket (null: no errand on screen) */
  [EV.QUEST]: { title: string; objective: string; hint: string | null; basket: { label: string; got: boolean }[] | null } | null;
  /** someone says a line to the player (shown as a caption box), or null to clear it */
  [EV.DIALOG]: { speaker: string; text: string; seconds: number } | null;
  /** a message across the middle of the view that fades away after `seconds`: a big
   * title (the errand's name at its start and end) or a short note ("shopping done") */
  [EV.BANNER]: { text: string; kind: 'title' | 'note'; seconds: number };
  /** a soft, distant flash; the rumble arrives `delay` seconds later */
  [EV.LIGHTNING]: { direction: Vector3; strength: number; delay: number };
  [EV.QUALITY_CHANGED]: { name: QualityName; preset: QualityPreset; auto: boolean };
  /** the render resolution (pixel ratio) changed */
  [EV.PIXEL_RATIO]: number;
}
