// What the owner says when the player walks up to the fire, in his own
// recorded voice: a welcome, then he introduces everyone one by one.
// `key` = entry in public/audio/manifest.json (steps without a recording are
// skipped), `focus` = who is being introduced (they turn to the player and
// react, and their name appears above them), `text` = optional subtitle
// (shown only when the visitor turns subtitles on in the settings).

export const INTRO = [
  {
    key: 'welcome',
    focus: null,
    text: 'دوست عزیز من سلام، به دنیای ما چهار رفیق خوش اومدی. بیا بشین کنار ما یه چایی بزن، زیر این آب و هوا می‌چسبه، تا یکی‌یکی دوستانم رو بهت معرفی کنم. بیا عزیزم، غریبگی نکن.',
  },
  { key: 'intro_owner', focus: 'owner', text: '' },
  { key: 'intro_amir', focus: 'amir', text: '' },
  { key: 'intro_amin', focus: 'amin', text: '' },
  { key: 'intro_alireza', focus: 'alireza', text: '' },
  { key: 'intro_luna', focus: 'luna', text: '' },
];
