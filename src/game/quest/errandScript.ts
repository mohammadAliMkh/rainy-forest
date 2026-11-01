// The first errand, "the party tonight": what people say, what the goal
// line reads at each step, and what goes in the basket. `voice` = an
// optional recording in public/audio/manifest.json (when there is one it
// plays and the caption stays as long as it lasts).

export const TITLE = 'سناریوی روح سرگردان';

/** across the middle of the view: when it begins, when the shopping is paid for, at the end */
export const BANNERS = {
  start: TITLE,
  bought: '✓ خرید انجام شد',
  rescue: 'رفقایت را نجات بده',
  end: 'پایان سناریوی روح سرگردان',
};

export const LINES = {
  amir: {
    speaker: 'امیر اسماعیل',
    voice: 'amir_party',
    text: 'داداش، برای امشب قراره یه مهمونی خودمونی بگیریم تو کلبه. بی‌زحمت برو از سوپرمارکت یه خورده خیارشور، پفک، چیپس، ماست و نوشیدنی بخر بیار برامون.',
  },
  last: { speaker: 'امیر اسماعیل', voice: 'amir_last', text: 'دستت درد نکنه داداش! خریدها رو یکی‌یکی از کوله بده به من.' },
  thanks: { speaker: 'فرج‌پور', voice: 'farajpour_thanks', text: 'قربون دستت، نوش جون! فقط... شب نری سمت دبه‌ی خیارشور، باشه؟ اینم بگیر پیشت باشه؛ اگه روح دیدی نشونش بده.' },
  pickles: { speaker: 'فرج‌پور', voice: 'farajpour_pickles', text: 'خیارشور اگه می‌خوای، از دبه‌ی بیرون مغازه برو خودت بردار... ولی من بودم نمی‌رفتم.' },
};

export const GOALS = {
  toAmir: 'برو پیش امیر اسماعیل',
  toStore: 'برو سوپرمارکت فرج‌پور',
  shop: 'چیپس، پفک، ماست و نوشیدنی را بردار',
  pay: 'پول خریدها را به فرج‌پور بده',
  leave: 'از مغازه بیرون برو',
  pickles: 'از دبه‌ی کنار در خیارشور بردار',
  rescue: 'چهار رفیقت را در جنگل نجات بده',
  deliver: 'خوراکی‌ها را از کوله به امیر اسماعیل بده',
};

/** the goal line while saving them, with how many are saved so far */
export const rescueGoal = (saved: number): string => `${GOALS.rescue} (${'۰۱۲۳۴'[saved]} از ۴)`;

/** a hint under the goal, for the steps where something has to be clicked / tapped */
export const HINTS = {
  click: 'روی چیزهایی که چشمک می‌زنند کلیک کن',
  tap: 'روی چیزهایی که چشمک می‌زنند بزن',
  deliver: 'کوله را باز کن (B) و خوراکی‌ها را یکی‌یکی انتخاب کن',
  deliverTouch: 'روی کوله بزن و خوراکی‌ها را یکی‌یکی انتخاب کن',
  rescue: 'جایشان روی نقشه چشمک می‌زند؛ صلیب سنگی را در دست بگیر و فاصله‌ات را از روح نگه دار',
};

export const BASKET = [
  { key: 'chips', label: 'چیپس' },
  { key: 'puffs', label: 'پفک' },
  { key: 'yogurt', label: 'ماست' },
  { key: 'drink', label: 'نوشیدنی' },
] as const;

/** what goes from the bag to Amir at the end (the flashlight and the cross stay in it) */
export const DELIVERY = [...BASKET, { key: 'pickles', label: 'خیارشور' }] as const;
/** what stays in the bag, not to be chosen, while the rest goes to Amir */
export const KEPT = ['flashlight', 'amulet'] as const;

/** a friend is saved */
export const savedNote = (name: string): string => `✓ ${name} نجات پیدا کرد`;

/** the fight with a ghost: what to do, under the round bar; the words when it has killed you */
export const FIGHT_TEXT = {
  take: 'صلیب سنگی را از کوله بردار (B)',
  takeTouch: 'صلیب سنگی را از کوله بردار',
  click: 'پشت سر هم کلیک کن!',
  tap: 'پشت سر هم روی صفحه بزن!',
  back: 'خیلی نزدیکی! عقب برو',
  late: 'وقتت تمام شد',
  over: 'بازی تمام شد',
  again: 'از لحظه‌ی حمله‌ی روح‌ها دوباره شروع می‌شود',
};

/** the four out in the woods, as the goal box lists them */
export const RESCUE = [
  { key: 'amin', label: 'امین' },
  { key: 'alireza', label: 'علیرضا' },
  { key: 'amir', label: 'امیر اسماعیل' },
  { key: 'owner', label: 'صاحب کلبه' },
] as const;

/** paying: when (seconds into his recording `farajpour_thanks`) Farajpour brings out the amulet and holds it out to you */
export const KEEPER_GIVES_AT = 31.2;

/** how close to Amir he gets up to talk to you (metres) */
export const NEAR_AMIR = 3.4;
/** handing over the shopping: what you have in your hand goes to him this close to him (metres) */
export const DELIVER_AT = 4.2;
