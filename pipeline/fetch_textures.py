"""Download scanned PBR textures from Poly Haven (CC0) and convert them to
compact WebP files for the website.

Usage (from the project root):
    graphVenv\\Scripts\\python.exe pipeline\\fetch_textures.py

Output: public/assets/tex/<role>_{diff,nor,arm}.webp + manifest.json
  diff = color (sRGB), nor = OpenGL normal map, arm = AO / roughness / metal
"""
from __future__ import annotations

from PIL import Image

from common import API, CACHE, PUBLIC_ASSETS, download, get_json, write_json

# role in the game -> Poly Haven asset id, resolution to download, output size
TEXTURES = {
    "ground":   {"id": "forest_leaves_02", "res": "2k", "out": 1024},
    "ground2":  {"id": "forest_leaves_04", "res": "2k", "out": 1024},
    "mud":      {"id": "mud_forest",       "res": "2k", "out": 1024},
    "bark":     {"id": "pine_bark",        "res": "1k", "out": 1024},
    "bark2":    {"id": "bark_brown_02",    "res": "1k", "out": 1024},
    "stone":    {"id": "mossy_rock",       "res": "1k", "out": 1024},
    "wood":     {"id": "rough_wood",       "res": "1k", "out": 1024},
    "planks":   {"id": "weathered_brown_planks", "res": "1k", "out": 1024},
    "shingles": {"id": "roof_slates_02",   "res": "1k", "out": 1024},
}
MAPS = {"diff": ("Diffuse", 80), "nor": ("nor_gl", 90), "arm": ("arm", 85)}

OUT = PUBLIC_ASSETS / "tex"


def main() -> None:
    manifest = {"_credits": "Textures: Poly Haven (polyhaven.com), CC0 public domain", "textures": {}}
    for role, cfg in TEXTURES.items():
        asset = cfg["id"]
        info = get_json(f"{API}/info/{asset}")
        files = get_json(f"{API}/files/{asset}")
        dims = info.get("dimensions") or [2000, 2000]
        entry = {"asset": asset, "size": [round(dims[0] / 1000, 2), round(dims[1] / 1000, 2)], "maps": {}}
        for short, (key, quality) in MAPS.items():
            node = files.get(key, {}).get(cfg["res"], {})
            src = node.get("jpg") or node.get("png")
            if not src:
                print(f"  ! {asset}: no {key} map")
                continue
            raw = download(src["url"], CACHE / "textures" / asset / src["url"].split("/")[-1])
            img = Image.open(raw).convert("RGB")
            if img.width != cfg["out"]:
                img = img.resize((cfg["out"], cfg["out"]), Image.LANCZOS)
            out = OUT / f"{role}_{short}.webp"
            out.parent.mkdir(parents=True, exist_ok=True)
            img.save(out, "WEBP", quality=quality, method=6)
            entry["maps"][short] = f"assets/tex/{out.name}"
            print(f"  {role:9s} {short:4s} <- {asset} ({out.stat().st_size // 1024} KB)")
        manifest["textures"][role] = entry
    write_json(OUT / "manifest.json", manifest)
    total = sum(p.stat().st_size for p in OUT.glob("*.webp"))
    print(f"done: {len(manifest['textures'])} materials, {total / 1e6:.1f} MB total")


if __name__ == "__main__":
    main()
