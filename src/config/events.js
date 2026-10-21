// Every event that travels between parts of the game, in one list.
// Parts announce what happened with events.emit(NAME, payload) and whoever
// cares listens with events.on(NAME, fn) - neither side knows the other.
// (Requests that need an answer stay plain calls on a service object.)

export const EV = {
  // the film-style introductions (src/game/intro)
  INTRO_CINEMATIC: 'intro:cinematic', // boolean: the film camera takes / gives back the view
  INTRO_CAPTION: 'intro:caption', // string | null: the name shown for the current line
  INTRO_SUBTITLE: 'intro:subtitle', // string | null: the optional subtitle
  INTRO_FADE: 'intro:fade', // number 0..1: black dip between shots
  INTRO_DUCK: 'intro:duck', // boolean: lower the ambience while he speaks

  // things that make a sound
  GUITAR_STRUM: 'guitar:strum', // { position, chord, down, velocity }
  PLAYER_STEP: 'player:step', // { running, surface, side, speed }
  CREATURE_SOUND: 'creature:sound', // { type: 'deerStep' | 'deerSnort' | 'birdFlap' | 'birdSong', source }

  // graphics quality (src/engine/quality)
  QUALITY_CHANGED: 'quality:changed', // { name, preset, auto }
  PIXEL_RATIO: 'quality:pixelRatio', // number: the render resolution changed
};
