"""Paint a log end-grain texture (growth rings, radial cracks, bark rim)
into the kit folder for the cabin and woodpile logs."""
import numpy as np
from PIL import Image

from common import CACHE

S = 512
rng = np.random.default_rng(3)
y, x = np.mgrid[0:S, 0:S] / S - 0.5
cx, cy = rng.normal(0, 0.03, 2)
r = np.hypot(x - cx, y - cy)
ang = np.arctan2(y - cy, x - cx)
wob = 1 + 0.025 * np.sin(ang * 5 + 1.3) + 0.015 * np.sin(ang * 11)
rings = 0.5 + 0.5 * np.sin(r * wob * 2 * np.pi * 34 + np.sin(ang * 3) * 0.6)
base = np.stack([0.72, 0.55, 0.38])[:, None, None] * (0.82 + 0.18 * rings)
grey = np.clip((r - 0.2) / 0.25, 0, 1) * 0.35  # weathered, greyer toward the rim
base = base * (1 - grey) + np.array([0.48, 0.44, 0.40])[:, None, None] * grey
for _ in range(6):  # radial cracks
    a0 = rng.uniform(-np.pi, np.pi)
    d = np.abs(np.angle(np.exp(1j * (ang - a0))))
    crack = (d < 0.012 * (1 + r * 4)) & (r > rng.uniform(0.08, 0.3)) & (r < 0.46)
    base[:, crack] *= 0.45
bark = r > 0.455
base[:, bark] = np.array([0.22, 0.17, 0.13])[:, None] * (0.8 + 0.4 * rng.random(bark.sum()))
img = (np.clip(base.transpose(1, 2, 0), 0, 1) * 255).astype(np.uint8)
Image.fromarray(img).save(CACHE / "kit" / "log_end_diff.jpg", quality=90)
print("log_end_diff.jpg")
