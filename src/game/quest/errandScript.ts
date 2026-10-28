// The first errand, "the party tonight": what people say, what the goal
// line reads at each step, and what goes in the basket. `voice` = an
// optional recording in public/audio/manifest.json (when there is one it
// plays and the caption stays as long as it lasts).

export const TITLE = 'سناریوی روح سرگردان';

/** across the middle of the view: when it begins, when the shopping is paid for, at the end */
export const BANNERS = {
  start: TITLE,
  bought: '✓ خرید انجام شد',
  end: 'پایان سناریوی روح سرگردان',
};

export const LINES = {
  amir: {
    speaker: 'امیر اسماعیل',
    voice: 'amir_party',
    text: 'داداش، برای امشب قراره یه مهمونی خودمونی بگیریم تو کلبه. بی‌زحمت برو از سوپرمارکت یه خورده خیارشور، پفک، چیپس، ماست و نوشیدنی بخر بیار برامون.',
  },
  thanks: { speaker: 'فرج‌پور', voice: 'farajpour_thanks', text: 'قربون دستت، نوش جون! فقط... شب نری سمت دبه‌ی خیارشور، باشه؟' },
  pickles: { speaker: 'فرج‌پور', voice: 'farajpour_pickles', text: 'خیارشور اگه می‌خوای، از دبه‌ی بیرون مغازه برو خودت بردار... ولی من بودم نمی‌رفتم.' },
};

export const GOALS = {
  toAmir: 'برو پیش امیر اسماعیل',
  toStore: 'برو سوپرمارکت فرج‌پور',
  shop: 'چیپس، پفک، ماست و نوشیدنی را بردار',
  pay: 'پول خریدها را به فرج‌پور بده',
  leave: 'از مغازه بیرون برو',
  pickles: 'از دبه‌ی کنار در خیارشور بردار',
  deliver: 'خریدها را برای امیر اسماعیل ببر',
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

/** how close to Amir he gets up to talk to you (metres) */
export const NEAR_AMIR = 3.4;
/** bringing the shopping back: the ghost scene starts this close to Amir */
export const DELIVER_AT = 4.2;
