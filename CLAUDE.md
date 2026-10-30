# CLAUDE.md — قواعد ثابت پروژه

این فایل در شروع هر جلسه خودکار خوانده می‌شود. **اول [STATUS.md](STATUS.md) را بخوان**: کار در جریان، مرحله‌ی بعد و سؤال‌های باز آن‌جاست.

## پروژه
بازی اول‌شخص «جنگل بارانی» با Three.js + Vite (TypeScript/JS).
- مخزن: `mohammadAliMkh/rainy-forest`
- سایت: https://mohammadalimkh.github.io/rainy-forest/
- راهنماها:
  - [ARCHITECTURE.md](ARCHITECTURE.md): لایه‌ها و سیستم‌ها؛
  - [SCENARIO_GUIDE.md](SCENARIO_GUIDE.md): ساخت سناریو، به فارسی؛
  - [README.md](README.md).

## با کاربر
- **همیشه فارسی جواب بده.**
- برای تغییر کد اجازه نگیر؛ فقط برای ساخت‌وساز بزرگ یا انتخاب‌های داستانی بپرس.
- کار سناریو **مرحله‌به‌مرحله** است: یک مرحله بساز، نشان بده (عکس از پنل)، منتظر تأیید یا بازخورد بمان، بعد برو سراغ مرحله‌ی بعد.
- **فقط روی سیستم کاربر تست می‌شود** (`npm run dev` ← http://localhost:5173). کامیت محلی آزاد است. push، PR و دیپلوی فقط وقتی کاربر بگوید.
- روی سیستم کاربر چیزی نصب نکن.

## ممنوع
- عکس‌هایی که کاربر در چت می‌فرستد (رفقا، موتور، عکس الگوی روح یا صلیب) **هیچ‌وقت** کامیت یا push نشوند. شباهت فقط از راه پارامترها (`friendSpecs`).
- اسم یا شناسه‌ی مدل هوش مصنوعی در کامیت، PR یا کد نیاید.
- در پنل مرورگرِ تست هیچ‌وقت صدای بازی پخش نشود (پایین را ببین).

## دستورها
- `npm run dev`
- `npm run typecheck`: شامل tsc، check-layers و check-js-names.
- `npm run build`: typecheck هم در آن هست.
- تست e2e با Edge:
  ```
  PW_CHROMIUM="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" npx playwright test -g "<name>"
  ```
  تست‌های «the shop» و «introductions» روی این لپ‌تاپ کند وقتشان تمام می‌شود، حتی روی کد دست‌نخورده. تنها اجرا کن؛ روی CI سبزند.
- Blender (برای مدل‌ها):
  ```
  BLENDER_USER_RESOURCES=graphVenv/tools/blender_user graphVenv/tools/blender/blender.exe -b --factory-startup -P script -- args
  ```

## معماری (خلاصه)
- **لایه‌ها:** `app > ui|game > engine > config|utils`. ui و game همدیگر را import نمی‌کنند. `check-layers` این را چک می‌کند.
- **صحنه‌ی سینمایی:** شیئی با `{filming, applyCamera(camera, dt), skip?()}` که در `camp.films` گذاشته می‌شود.
  - رویدادها: `EV.INTRO_CINEMATIC`، `EV.INTRO_FADE`، `EV.SCENARIO_CUE`، `EV.BANNER`، `EV.QUEST`.
  - پایان صحنه را با `afterT` بعد از `voice.done` بشمار، **نه** با `voice.elapsed()` (آن در طول فایل سقف می‌خورد).
- **صدای ضبط‌شده:** `voices.play(key, pos, {duck, gain, from, length})`.
  - فایل‌ها `.voice` هستند (mp3ِ تغییرنام‌داده، تا IDM آن‌ها را نگیرد) در `public/audio/` و در `manifest.json` ثبت می‌شوند.
- **سناریوی روح:** `src/game/quest/` (PartyErrand، errandScript، JarScene، KeeperScene، AmirScene، NightWalk).
  - شکل واقعی روح: `src/game/scenario/Wraith.ts` با `appear()` و `vanish()`.
  - `?lab=wraith` روح را تنها نشان می‌دهد.
- GLTFLoader نقطه را از اسم گره‌ها حذف می‌کند (`wrist.R` ← `wristR`).

## تست در پنل مرورگر (بدون صدا)
- قبل از ورود: `f.sound.start = async()=>{}`. صدای ساختگیِ بی‌صدا روی زمان بازی بگذار.
- `f.game.frame` را بپیچ تا فقط با dt جلو برود.
- برای عکس، canvas را render کن و `toDataURL` را در یک `<img>` روی صفحه بگذار. دو بار عکس بگیر؛ اولی معمولاً قدیمی است.
- اگر 5173 دست کاربر باشد، سرور روی 5174 بالا می‌آید.

## انتقال به جلسه‌ی جدید
وقتی کاربر گفت «جمع‌بندی کن» یا جلسه سنگین شد:
1. STATUS.md را به‌روز کن: چه شد، کجای کاریم، قدم بعد، سؤال‌های باز، نکته‌های فنی تازه.
2. اگر قاعده‌ی ثابت تازه‌ای پیدا شد، به همین فایل اضافه کن، کوتاه.
3. کامیت محلی کن (بدون push).
