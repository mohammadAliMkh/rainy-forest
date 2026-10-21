"""Shared paths and helpers for the asset pipeline.

Everything runs inside the project's own `graphVenv` (Python venv, portable
Blender, glTF-Transform). Nothing is installed system-wide.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / "graphVenv"
CACHE = VENV / "cache"                      # raw downloads (not in git)
BLENDER = VENV / "tools" / "blender" / "blender.exe"
GLTF_TRANSFORM = VENV / "node" / "node_modules" / ".bin" / "gltf-transform.cmd"
PUBLIC_ASSETS = ROOT / "public" / "assets"  # optimized output (in git, shipped with the site)

API = "https://api.polyhaven.com"
HEADERS = {"User-Agent": "rainy-forest-asset-pipeline/1.0 (github.com/mohammadAliMkh/rainy-forest)"}


def get_json(url: str):
    for attempt in range(4):
        try:
            r = requests.get(url, headers=HEADERS, timeout=60)
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 + attempt * 3)


def download(url: str, dest: Path) -> Path:
    """Download once into the cache (skips files that already exist)."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(4):
        try:
            with requests.get(url, headers=HEADERS, timeout=120, stream=True) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 16):
                        f.write(chunk)
            tmp.replace(dest)
            return dest
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 + attempt * 3)
    return dest


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
