"""Pack the rendered fire frames (pipeline/blender_fire.py) into one 8 x 8
flipbook texture for the campfire and register it in the texture manifest.

Usage: graphVenv\\Scripts\\python.exe pipeline\\fire_atlas.py <frames_dir>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

from common import PUBLIC_ASSETS, write_json

GRID = 8


def main(frames_dir: str) -> None:
    frames = sorted(Path(frames_dir).glob("f*.png"))[: GRID * GRID]
    w, h = Image.open(frames[0]).size
    atlas = Image.new("RGB", (w * GRID, h * GRID))
    for i, f in enumerate(frames):
        atlas.paste(Image.open(f).convert("RGB"), ((i % GRID) * w, (i // GRID) * h))
    dest = PUBLIC_ASSETS / "tex" / "fire_flipbook.webp"
    atlas.save(dest, "WEBP", quality=86, method=6)
    print(f"{dest.name}: {len(frames)} frames, {atlas.size}, {dest.stat().st_size // 1024} KB")
    manifest_path = PUBLIC_ASSETS / "tex" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["textures"]["fire"] = {
        "asset": "campfire (Blender Mantaflow simulation)", "size": [0.95, 1.9], "card": True,
        "frames": len(frames), "grid": GRID, "maps": {"diff": f"assets/tex/{dest.name}"},
    }
    write_json(manifest_path, manifest)


if __name__ == "__main__":
    main(sys.argv[1])
