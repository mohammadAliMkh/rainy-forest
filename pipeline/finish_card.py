"""Finish a baked foliage card for the web:
- soften the frame edges (no straight cut lines on the card),
- bleed colors into transparent pixels (no dark halos in mipmaps),
- save as WebP with alpha and register it in the texture manifest.

Usage: graphVenv\\Scripts\\python.exe pipeline\\finish_card.py <in.png> <role>
"""
from __future__ import annotations

import json
import sys

import numpy as np
from PIL import Image

from common import PUBLIC_ASSETS, write_json


def main(src: str, role: str) -> None:
    im = np.asarray(Image.open(src).convert("RGBA")).astype(np.float32) / 255
    h, w = im.shape[:2]
    # fade alpha toward the top / bottom / right borders (left = branch base)
    y = np.abs(np.linspace(-1, 1, h))[:, None]
    x = np.linspace(0, 1, w)[None, :]
    fade = np.clip((1 - y) / 0.22, 0, 1) * np.clip((1 - x) / 0.08, 0, 1)
    rgb, a = im[..., :3], im[..., 3] * fade
    # color bleeding: repeatedly spread opaque colors into transparent areas
    filled = rgb * (a[..., None] > 0.05)
    weight = (a > 0.05).astype(np.float32)
    for _ in range(24):
        if weight.min() > 0:
            break
        acc = np.zeros_like(filled)
        cnt = np.zeros_like(weight)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc += np.roll(filled * weight[..., None], (dy, dx), axis=(0, 1))
            cnt += np.roll(weight, (dy, dx), axis=(0, 1))
        grow = (weight == 0) & (cnt > 0)
        filled[grow] = acc[grow] / cnt[grow][:, None]
        weight[grow] = 1
    out = np.dstack([filled, a])
    img = Image.fromarray((out * 255).clip(0, 255).astype(np.uint8), "RGBA")
    dest = PUBLIC_ASSETS / "tex" / f"{role}_diff.webp"
    img.save(dest, "WEBP", quality=88, alpha_quality=90, method=6)
    print(f"{dest.name}: {dest.stat().st_size // 1024} KB")

    manifest_path = PUBLIC_ASSETS / "tex" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["textures"][role] = {"asset": "fir_sapling (Blender card bake)", "size": [1, 1],
                                  "card": True, "maps": {"diff": f"assets/tex/{dest.name}"}}
    write_json(manifest_path, manifest)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
