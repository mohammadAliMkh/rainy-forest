"""Download source models (glTF + textures) from Poly Haven (CC0) into the
local cache. They are far too heavy for the web as-is; process_models.py
slims them down in Blender afterwards.

Usage: graphVenv\\Scripts\\python.exe pipeline\\fetch_models.py [asset ...]
"""
from __future__ import annotations

import sys

from common import API, CACHE, download, get_json

MODELS = [
    "fern_02",
    "rock_moss_set_01",
    "rock_moss_set_02",
    "boulder_01",
    "tree_stump_01",
    "tree_stump_02",
    "dead_tree_trunk",
    "dry_branches_medium_01",
    "moss_01",
    "shrub_02",
    "grass_medium_02",
    "fir_sapling",
]


def fetch(asset: str, res: str = "1k") -> None:
    files = get_json(f"{API}/files/{asset}")
    node = files["gltf"][res]["gltf"]
    folder = CACHE / "models" / asset
    download(node["url"], folder / node["url"].split("/")[-1])
    for rel, f in node.get("include", {}).items():
        download(f["url"], folder / rel)
    print(f"  {asset}: ok")


def main() -> None:
    for a in sys.argv[1:] or MODELS:
        fetch(a)


if __name__ == "__main__":
    main()
