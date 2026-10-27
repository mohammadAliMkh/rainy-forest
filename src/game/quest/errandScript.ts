// The first errand, "the party tonight": what people say, what the goal
// line reads at each step, and what goes in the basket. `voice` = an
// optional recording in public/audio/manifest.json (when there is one it
// plays and the caption stays as long as it lasts).

export const TITLE = 'مأموریت: مهمونی امشب';

export const LINES = {
  amir: {
    speaker: 'امیر اسماعیل',
    voice: 'amir_party',
    text: 'داداش، شب تو کلبه مهمونی گرفتم. بی‌زحمت برو از فرج‌پور (سوپرمارکتی) چند تا چیپس و پفک و ماست و نوشیدنی بخر بیار.',
  },
  thanks: { speaker: 'فرج‌پور', voice: 'farajpour_thanks', text: 'قربون دستت، نوش جون!' },
  pickles: { speaker: 'فرج‌پور', voice: 'farajpour_pickles', text: 'خیارشور اگه می‌خوای، از دبه‌ی بیرون مغازه برو خودت بردار.' },
};

export const GOALS = {
  toAmir: 'برو پیش امیر اسماعیل',
  toStore: 'برو سوپرمارکت فرج‌پور',
  shop: 'چیپس، پفک، ماست و نوشیدنی را بردار',
  pay: 'پول خریدها را به فرج‌پور بده',
  leave: 'از مغازه بیرون برو',
  pickles: 'از دبه‌ی کنار در خیارشور بردار',
  deliver: 'خریدها را برای امیر اسماعیل ببر',
  done: 'مأموریت انجام شد!',
};

/** a hint under the goal, for the steps where something has to be clicked / tapped */
export const HINTS = {
  click: 'روی چیزهایی که چشمک می‌زنند کلیک کن',
  tap: 'روی چیزهایی که چشمک می‌زنند بزن',
};

export const BASKET = [
  { key: 'chips', label: 'چیپس' },
  { key: 'puffs', label: 'پفک' },
  { key: 'yogurt', label: 'ماست' },
  { key: 'drink', label: 'نوشیدنی' },
] as const;
export const PICKLES_LABEL = 'خیارشور';

/** how close counts as "at" someone (metres) */
export const NEAR_AMIR = 2.8;
/** bringing the shopping back: the ghost scene starts this close to Amir */
export const DELIVER_AT = 4.2;
