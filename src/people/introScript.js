// What the owner says when the player walks up to the fire, in his own
// recorded voice: a welcome, then he introduces everyone one by one.
// `key` = entry in public/audio/manifest.json (steps without a recording are
// skipped), `focus` = who is being introduced (they turn to the player and
// react, and their name appears above them).

export const INTRO = [
  { key: 'welcome', focus: null },
  { key: 'intro_owner', focus: 'owner' },
  { key: 'intro_amir', focus: 'amir' },
  { key: 'intro_alireza', focus: 'alireza' },
  { key: 'intro_amin', focus: 'amin' },
  { key: 'intro_luna', focus: 'luna' },
];
