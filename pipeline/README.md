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

## در بازی

- `src/game/world/scannedTextures.ts` بافت‌ها را قبل از ساختن دنیا جایگزین بافت‌های نقاشی‌شده می‌کند و به هر متریال نقشه‌ی زبری و سایه هم می‌دهد.
- `src/game/world/envModels.ts` مدل‌ها را بارگذاری می‌کند و `Vegetation.js` آن‌ها را به‌جای شکل‌های ساختگی می‌کارد.
- اگر هر کدام بارگذاری نشود، نسخه‌ی نقاشی‌شده‌ی قبلی خودکار استفاده می‌شود.
