# خط تولید دارایی‌ها (بافت‌ها و مدل‌های واقعی)

این پوشه بافت‌های اسکن‌شده و مدل‌های سه‌بعدی واقعی را از Poly Haven (مجوز CC0، رایگان برای هر استفاده‌ای) می‌گیرد، با بلندر برای وب سبک می‌کند و نتیجه‌ی فشرده را در `public/assets/` می‌گذارد. سایت فقط همان خروجی فشرده را بارگذاری می‌کند.

همه‌ی ابزارها داخل پوشه‌ی `graphVenv` در خود پروژه نصب شده‌اند و چیزی روی کل سیستم نصب نشده است:

| ابزار | جا |
|---|---|
| پایتون (venv) با requests، Pillow و numpy | `graphVenv/Scripts/python.exe` |
| بلندر 5.2.2 قابل‌حمل | `graphVenv/tools/blender/` |
| glTF-Transform (فشرده‌سازی مدل‌ها) | `graphVenv/node/` |
| فایل‌های خام دانلودشده | `graphVenv/cache/` (در گیت نیست) |

## ساختن دوباره‌ی `graphVenv` روی یک کامپیوتر دیگر

```bash
python -m venv graphVenv
graphVenv/Scripts/python.exe -m pip install requests pillow numpy
npm install --prefix graphVenv/node @gltf-transform/cli
```

بلندر قابل‌حمل (zip) را از blender.org بگیرید و در `graphVenv/tools/blender/` باز کنید.

## اجرای مراحل

```bash
graphVenv/Scripts/python.exe pipeline/fetch_textures.py     # بافت‌های اسکن‌شده → public/assets/tex
graphVenv/Scripts/python.exe pipeline/fetch_models.py       # مدل‌های خام → graphVenv/cache
graphVenv/Scripts/python.exe pipeline/process_models.py     # بلندر + فشرده‌سازی → public/assets/models
```

کارت سوزن‌های کاج (پخت در بلندر از روی مدل واقعی نهال صنوبر):

```bash
graphVenv/tools/blender/blender.exe -b --factory-startup -P pipeline/blender_bake_card.py -- <job.json>
graphVenv/Scripts/python.exe pipeline/finish_card.py graphVenv/cache/bake/needles_a.png needles
```

## فایل‌ها

| فایل | کار |
|---|---|
| `common.py` | مسیرها و دانلود |
| `fetch_textures.py` | بافت‌های زمین، گل، پوست درخت، سنگ، چوب کلبه، سقف (رنگ، نرمال، زبری/سایه) |
| `fetch_models.py` | سرخس، سنگ‌های خزه‌دار، تخته‌سنگ، کُنده، تنه‌ی افتاده، شاخه، بوته، علف، نهال صنوبر |
| `blender_process.py` | داخل بلندر: نگه داشتن قطعه‌ها، کم کردن مثلث‌ها، تنظیم مبدأ، خروجی glb |
| `process_models.py` | هر مدل را به بلندر و بعد glTF-Transform می‌دهد؛ برای هر گیاه یک نسخه‌ی سبک برای فاصله‌ی دور هم می‌سازد |
| `blender_bake_card.py` | داخل بلندر: رندر رنگ خالص یک شاخه‌ی واقعی به یک کارت شفاف |
| `finish_card.py` | نرم کردن لبه‌های کارت، پر کردن رنگ زیر پیکسل‌های شفاف، WebP |

## مدل‌های ساخته‌شده در بلندر (با اسکریپت)

این‌ها از صفر با اسکریپت پایتون داخل بلندر ساخته می‌شوند، با همان اندازه‌هایی که کد بازی استفاده می‌کند. بعد سایه‌ی محیطی در رنگ رأس‌ها پخت می‌شود و خروجی با `process_models.py --scene` فشرده می‌شود.

| اسکریپت | چه می‌سازد |
|---|---|
| `bkit.py` | جعبه‌ابزار مشترک: متریال‌های اسکن‌شده، نگاشت بافت به اندازه‌ی واقعی، لوله و چرخش و برش، پخت سایه، خروجی glb |
| `blender_cabin.py` | کلبه‌ی چوبی: کنده‌ها، سقف با حدود ۱۴۰۰ زونا، دودکش سنگی، در لولا‌دار، پنجره‌ها، داخل |
| `blender_store.py` | پوسته‌ی سوپرمارکت: پایه‌ی سنگی، دیوار تخته‌ای، سقف شیروانی موج‌دار، ایوان، نرده، پله |
| `blender_patrol.py` | پاترول Y60 آفرود: بدنه، چرخ با آج واقعی، اسنورکل، باربند، سپر، داخل |
| `blender_hornet.py` | هورنت ۲.۰: باک، دوشاخ طلایی، رینگ، موتور، اگزوز، تکیه روی جک |
| `blender_trees.py` | چهار نوع سوزنی‌برگ با ساختار واقعی صنوبر و نسخه‌ی سبک برای دور |
| `blender_animals.py` + `bcreature.py` | گوزن ماده و نر (با شاخ)، خرگوش و لونا: بدن پیوسته‌ی نرم با متابال، اسکلت هم‌جای مفصل‌های کد بازی، وزن‌دهی خودکار، گوش و چشم و بینی و شاخ و قلاده‌ی ثابت روی استخوان خودشان. در بازی `skinBinding.ts` حرکت مفصل‌های قبلی را هر فریم روی استخوان‌ها می‌گذارد، پس همه‌ی رفتارها همان قبلی است |
| `blender_fire.py` + `fire_atlas.py` | شبیه‌سازی آتش (Mantaflow) و فیلم‌برگه‌ی ۶۴ فریمی شعله |
| `blender_preview.py` | رندر پیش‌نمایش هر مدل برای بررسی قبل از ورود به بازی |
| `make_log_end.py` | بافت مقطع کنده (حلقه‌های سالانه) |
| `fetch_kit_textures.py` | بافت‌های اسکن‌شده‌ای که فقط داخل بلندر برای ساختمان‌ها لازم‌اند |

نمونه:

```bash
set KIT_DIR=graphVenv/cache/kit
graphVenv/tools/blender/blender.exe -b --factory-startup -P pipeline/blender_cabin.py -- graphVenv/cache/work/cabin_raw.glb
graphVenv/Scripts/python.exe pipeline/process_models.py --scene cabin graphVenv/cache/work/cabin_raw.glb 1024
```

درخت‌ها بدون حذف ویژگی‌ها فشرده می‌شوند (رنگ رأس و مختصات بافتشان لازم است):

```bash
graphVenv/node/node_modules/.bin/gltf-transform meshopt graphVenv/cache/work/trees_raw.glb public/assets/models/trees.glb
```

## در بازی

- `src/game/world/scannedTextures.ts` بافت‌ها را قبل از ساختن دنیا جایگزین بافت‌های نقاشی‌شده می‌کند و به هر متریال نقشه‌ی زبری و سایه هم می‌دهد.
- `src/game/world/envModels.ts` مدل‌ها را بارگذاری می‌کند و `Vegetation.js` آن‌ها را به‌جای شکل‌های ساختگی می‌کارد.
- اگر هر کدام بارگذاری نشود، نسخه‌ی نقاشی‌شده‌ی قبلی خودکار استفاده می‌شود.
