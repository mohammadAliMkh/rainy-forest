"""Slim the cached Poly Haven models down for the web:
Blender (decimate, clean pivots) -> glTF-Transform (meshopt + WebP).

Usage: graphVenv\\Scripts\\python.exe pipeline\\process_models.py [name ...]
Output: public/assets/models/<name>.glb + manifest.json
"""
from __future__ import annotations

import json
import subprocess
import sys

from common import BLENDER, CACHE, GLTF_TRANSFORM, PUBLIC_ASSETS, write_json

# output name -> source asset, objects to keep with their triangle budgets
JOBS = {
    "ferns": {"src": "fern_02", "tex": 1024, "objects": {
        "fern_02_a": {"tris": 500, "as": "fern_a"},
        "fern_02_b": {"tris": 900, "as": "fern_b"},
        "fern_02_c": {"tris": 900, "as": "fern_c"},
        "fern_02_d": {"tris": 500, "as": "fern_d"},
    }},
    "rocks_big": {"src": "rock_moss_set_01", "tex": 1024, "objects": {
        f"rock_moss_set_01_rock0{i}": {"tris": 1400, "as": f"rock_big_{i}"} for i in range(1, 7)
    }},
    "rocks_small": {"src": "rock_moss_set_02", "tex": 1024, "objects": {
        f"rock_moss_set_02_rock{i:02d}": {"tris": 900, "as": f"rock_small_{i}"} for i in range(7, 14)
    }},
    "boulder": {"src": "boulder_01", "tex": 1024, "objects": {"boulder_01": {"tris": 1800, "as": "boulder"}}},
    "stump_a": {"src": "tree_stump_01", "tex": 1024, "objects": {"tree_stump_01": {"tris": 2200, "as": "stump_a"}}},
    "stump_b": {"src": "tree_stump_02", "tex": 1024, "objects": {"tree_stump_02": {"tris": 2200, "as": "stump_b"}}},
    "dead_trunk": {"src": "dead_tree_trunk", "tex": 1024, "objects": {"dead_tree_trunk": {"tris": 2600, "as": "dead_trunk"}}},
    "branches": {"src": "dry_branches_medium_01", "tex": 512, "objects": {
        "dry_branches_medium_01_a": {"tris": 900, "as": "branch_a"},
        "dry_branches_medium_01_b": {"tris": 700, "as": "branch_b"},
        "dry_branches_medium_01_c": {"tris": 700, "as": "branch_c"},
    }},
    "shrubs": {"src": "shrub_02", "tex": 1024, "objects": {
        "shrub_02_a": {"tris": 3200, "as": "shrub_a"},
        "shrub_02_b": {"tris": 2600, "as": "shrub_b"},
        "shrub_02_d": {"tris": 2600, "as": "shrub_d"},
    }},
    # light versions for distance (level of detail)
    "ferns_lo": {"src": "fern_02", "tex": 512, "objects": {
        "fern_02_a": {"tris": 160, "as": "fern_a_lo"},
        "fern_02_b": {"tris": 260, "as": "fern_b_lo"},
        "fern_02_c": {"tris": 260, "as": "fern_c_lo"},
        "fern_02_d": {"tris": 160, "as": "fern_d_lo"},
    }},
    "grass_lo": {"src": "grass_medium_02", "tex": 256, "objects": {
        "grass_medium_02_c": {"tris": 90, "as": "grass_c_lo"},
        "grass_medium_02_d": {"tris": 110, "as": "grass_d_lo"},
        "grass_medium_02_e": {"tris": 110, "as": "grass_e_lo"},
    }},
    "shrubs_lo": {"src": "shrub_02", "tex": 512, "objects": {
        "shrub_02_a": {"tris": 700, "as": "shrub_a_lo"},
        "shrub_02_b": {"tris": 600, "as": "shrub_b_lo"},
        "shrub_02_d": {"tris": 600, "as": "shrub_d_lo"},
    }},
    "grass": {"src": "grass_medium_02", "tex": 512, "objects": {
        "grass_medium_02_c": {"tris": 260, "as": "grass_c"},
        "grass_medium_02_d": {"tris": 320, "as": "grass_d"},
        "grass_medium_02_e": {"tris": 320, "as": "grass_e"},
    }},
}

OUT = PUBLIC_ASSETS / "models"
WORK = CACHE / "work"


def run(cmd: list[str]) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        print(p.stdout[-3000:], p.stderr[-3000:])
        raise SystemExit(f"failed: {cmd[0]}")
    return p.stdout


def process(name: str, cfg: dict) -> dict:
    src = next((CACHE / "models" / cfg["src"]).glob("*.gltf"))
    WORK.mkdir(parents=True, exist_ok=True)
    raw = WORK / f"{name}_raw.glb"
    job = WORK / f"{name}.json"
    job.write_text(json.dumps({"mode": "process", "input": str(src), "output": str(raw), "objects": cfg["objects"]}), encoding="utf-8")
    log = run([str(BLENDER), "-b", "--factory-startup", "-P", "pipeline/blender_process.py", "--", str(job)])
    for line in log.splitlines():
        if line.startswith("DONE"):
            print("   ", line[5:])
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{name}.glb"
    run([str(GLTF_TRANSFORM), "optimize", str(raw), str(out),
         "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", str(cfg["tex"]),
         "--simplify", "false", "--join", "false", "--instance", "false", "--flatten", "false"])
    kb = out.stat().st_size // 1024
    print(f"  {name}: {kb} KB")
    return {"file": f"assets/models/{out.name}", "source": cfg["src"], "parts": [o["as"] for o in cfg["objects"].values()], "kb": kb}


def optimize_scene(name: str, raw: str, tex: int = 1024) -> None:
    """A whole model built by a Blender script (cabin, shop, vehicles): just
    compress it and register it as a scene (placed as one piece by the game)."""
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{name}.glb"
    run([str(GLTF_TRANSFORM), "optimize", raw, str(out),
         "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", str(tex),
         "--simplify", "false", "--join", "false", "--instance", "false", "--flatten", "false", "--palette", "false"])
    kb = out.stat().st_size // 1024
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["models"][name] = {"file": f"assets/models/{out.name}", "source": "Blender build script", "scene": True, "parts": [], "kb": kb}
    write_json(manifest_path, manifest)
    print(f"  {name}: {kb} KB (scene)")


def main() -> None:
    if len(sys.argv) >= 4 and sys.argv[1] == "--scene":
        optimize_scene(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 1024)
        return
    names = sys.argv[1:] or list(JOBS)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {
        "_credits": "Models: Poly Haven (polyhaven.com), CC0 public domain", "models": {}}
    for n in names:
        print(f"* {n}")
        manifest["models"][n] = process(n, JOBS[n])
    write_json(manifest_path, manifest)
    total = sum(m["kb"] for m in manifest["models"].values())
    print(f"total {total / 1024:.1f} MB")


if __name__ == "__main__":
    main()
