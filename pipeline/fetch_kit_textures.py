"""Download the scanned textures used *inside Blender* to build the cabin,
the shop and the vehicles (Poly Haven, CC0). They stay in the local cache;
the website only gets them embedded (and compressed) inside the .glb files.

Usage: graphVenv\\Scripts\\python.exe pipeline\\fetch_kit_textures.py
"""
from __future__ import annotations

from common import API, CACHE, download, get_json

KIT = [
    # cabin
    "rough_wood", "roof_slates_02", "mossy_stone_wall", "rough_pine_door", "wood_floor_worn", "weathered_brown_planks",
    # shop
    "weathered_plank_siding", "worn_corrugated_iron", "old_planks_02", "rustic_stone_wall", "dark_planks",
]
MAPS = {"diff": "Diffuse", "nor": "nor_gl", "arm": "arm"}


def main() -> None:
    for asset in KIT:
        files = get_json(f"{API}/files/{asset}")
        for short, key in MAPS.items():
            node = files.get(key, {}).get("1k", {})
            src = node.get("jpg") or node.get("png")
            if not src:
                continue
            ext = src["url"].rsplit(".", 1)[-1]
            download(src["url"], CACHE / "kit" / f"{asset}_{short}.{ext}")
        info = get_json(f"{API}/info/{asset}")
        dims = info.get("dimensions") or [2000, 2000]
        (CACHE / "kit" / f"{asset}.size").write_text(f"{dims[0] / 1000:.3f}", encoding="utf-8")
        print(f"  {asset}: ok ({dims[0] / 1000:.2f} m)")


if __name__ == "__main__":
    main()
