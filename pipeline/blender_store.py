"""Runs INSIDE Blender: models the forest shop's building shell with the
measurements of src/game/store/storeLayout.ts, and exports one .glb.

    blender -b --factory-startup -P pipeline/blender_store.py -- <out.glb>

Real geometry: a stone base ringed with irregular stones, overlapping lap
siding boards (split around the door and windows) with corner boards,
panelled inner walls, plank floors with gaps on the porch, a corrugated
metal roof with real waves, white fascia / rake boards / ridge cap, ridge,
tie and porch beams, window frames with mullions and sills, the door frame,
porch posts with railings and balusters, three steps with handrails and the
board behind the shop sign. The door leaf, window glass, sign, lamps and
the things lying around stay in the game code.
"""
import math
import os
import random
import sys

import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit as K  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
K.reset()
random.seed(23)

# ---- storeLayout.ts ----
W, D, T, F, H, RIDGE = 6.2, 5.2, 0.14, 0.45, 2.7, 1.35
X0, X1, Z0, Z1 = -W / 2, W / 2, -D / 2, D / 2
IX0, IX1, IZ0, IZ1 = X0 + T, X1 - T, Z0 + T, Z1 - T
PORCH = 1.95
PZ1 = Z1 + PORCH
STEP_N, STEP_D = 3, 0.32
ROOF_OVER = 0.38
ROOF_FRONT = PZ1 + 0.3
DOOR = dict(x0=0.55, x1=1.55, h=2.05)
WIN_L = dict(x0=-2.6, x1=-0.25, y0=0.85, y1=2.15)
WIN_R = dict(x0=1.95, x1=2.75, y0=1.0, y1=2.05)
STEPS = dict(x0=DOOR["x0"] - 0.2, x1=DOOR["x1"] + 0.2)
TIE_BEAMS = [-1.7, 0.15, 1.75]
SLOPE = RIDGE / (W / 2)

M_STONE = K.pbr("stone", "rustic_stone_wall", tint=(0.6, 0.62, 0.56))
M_SIDING = K.pbr("siding", "weathered_plank_siding", tint=(1.4, 1.3, 1.18))
M_INNER = K.pbr("inner", "wood_floor_worn", tint=(1.0, 0.92, 0.8))
M_FLOOR = K.pbr("floor", "old_planks_02")
M_ROOF = K.pbr("roof", "worn_corrugated_iron")
M_DARK = K.pbr("dark_wood", "dark_planks", tint=(0.75, 0.62, 0.5))
M_TRIM = K.flat("trim", (0.78, 0.75, 0.68), roughness=0.75)

objects = []


def finish(name, bm, mat, tile):
    ob = K.new_obj(name, bm, mat)
    K.world_uv(ob, tile)
    objects.append(ob)
    return ob


# ======================= stone base =========================================
bm = bmesh.new()
K.bm_box(bm, (X0 + 0.06, -0.4, Z0 + 0.06), (X1 - 0.06, F - 0.02, PZ1 - 0.06))


def stone_ring(x0, z0, x1, z1):
    length = math.hypot(x1 - x0, z1 - z0)
    n = math.ceil(length / 0.42)
    for k in range(n + 1):
        for yy in (0.1, 0.32):
            t = (k + random.random() * 0.4) / n
            s = 0.2 + random.random() * 0.1
            res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
            vs = res["verts"]
            for v in vs:
                v.co.x *= s * (1 + random.random() * 0.5) * (1 + 0.15 * random.uniform(-1, 1))
                v.co.y *= s * 0.7 * (1 + 0.15 * random.uniform(-1, 1))
                v.co.z *= s * 0.62 * (1 + 0.15 * random.uniform(-1, 1))
            bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=K.Matrix.Rotation(random.random() * 6, 3, "Z"))
            bmesh.ops.translate(bm, verts=vs, vec=K.B(x0 + (x1 - x0) * t, yy + random.random() * 0.04, z0 + (z1 - z0) * t))


stone_ring(X0, Z0, X1, Z0)
stone_ring(X0, Z0, X0, PZ1)
stone_ring(X1, Z0, X1, PZ1)
stone_ring(X0, PZ1, STEPS["x0"], PZ1)
stone_ring(STEPS["x1"], PZ1, X1, PZ1)
stone = finish("stone", bm, M_STONE, K.tile_size("rustic_stone_wall", 1.5))

# ======================= floors =============================================
bm = bmesh.new()
K.bm_box(bm, (IX0 - 0.02, F - 0.06, IZ0 - 0.02), (IX1 + 0.02, F, IZ1 + 0.02))
# porch deck: individual planks running across, with small gaps
z = Z1
while z < PZ1 - 0.01:
    w = 0.14
    K.bm_box(bm, (X0, F - 0.06, z + 0.006), (X1, F - random.uniform(0, 0.006), min(z + w, PZ1)))
    z += w
# steps: treads (the risers below are stone-ish planks too)
for k in range(STEP_N):
    top = F * (STEP_N - k) / (STEP_N + 1)
    K.bm_box(bm, (STEPS["x0"], -0.2, PZ1 + k * STEP_D), (STEPS["x1"], top, PZ1 + (k + 1) * STEP_D))
floor = finish("floor", bm, M_FLOOR, K.tile_size("old_planks_02", 2.0))
K.bevel(floor, 0.004, 1)

# ======================= walls ==============================================
OUT_T = 0.07
openings_front = [(WIN_L["x0"], WIN_L["x1"], WIN_L["y0"], WIN_L["y1"]),
                  (DOOR["x0"], DOOR["x1"], 0.0, DOOR["h"]),
                  (WIN_R["x0"], WIN_R["x1"], WIN_R["y0"], WIN_R["y1"])]


def split(a0, a1, y0, y1, holes):
    segs = [(a0, a1)]
    for h0, h1, hy0, hy1 in holes:
        if y1 <= hy0 or y0 >= hy1:
            continue
        nxt = []
        for s0, s1 in segs:
            if h1 <= s0 or h0 >= s1:
                nxt.append((s0, s1))
                continue
            if h0 > s0:
                nxt.append((s0, h0))
            if h1 < s1:
                nxt.append((h1, s1))
        segs = nxt
    return segs


bm_s = bmesh.new()
BOARD = 0.17


def lap_wall(axis, a0, a1, c, outward, holes=(), y_top=None, gable=False):
    """horizontal lap siding: each board tilts out at its lower edge"""
    y = 0.0
    top = H if y_top is None else y_top
    while y < top - 0.01:
        y1 = min(y + BOARD + 0.02, top)
        ga0, ga1 = a0, a1
        for s0, s1 in split(ga0, ga1, y, y1, holes):
            if s1 - s0 < 0.04:
                continue
            mid = (s0 + s1) / 2
            tilt = 0.06 * outward
            if axis == "x":
                K.bm_obox(bm_s, (mid, F + (y + y1) / 2, c + outward * 0.02), (s1 - s0, y1 - y, 0.022), (tilt, 0, 0))
            else:
                K.bm_obox(bm_s, (c + outward * 0.02, F + (y + y1) / 2, mid), (0.022, y1 - y, s1 - s0), (0, 0, -tilt))
        y += BOARD


lap_wall("x", X0, X1, Z1 - 0.035, 1, openings_front)
lap_wall("x", X0, X1, Z0 + 0.035, -1)
lap_wall("z", Z0, Z1, X0 + 0.035, -1)
lap_wall("z", Z0, Z1, X1 - 0.035, 1)
# gables (front wall, back wall, the thin one closing the porch roof): boards shortening upward
for z, out_dir in ((Z1 - 0.035, 1), (Z0 + 0.035, -1), (PZ1 - 0.1, 1)):
    y = H
    while y < H + RIDGE - 0.05:
        half = (W / 2) * (1 - (y + BOARD / 2 - H) / RIDGE)
        if half > 0.05:
            K.bm_obox(bm_s, (0, F + y + BOARD / 2, z + out_dir * 0.02), (2 * half, BOARD + 0.02, 0.022), (0.06 * out_dir, 0, 0))
        y += BOARD
siding = finish("siding", bm_s, M_SIDING, K.tile_size("weathered_plank_siding", 1.57))

# inner walls (honey boards) + lining under the roof
bm = bmesh.new()
for x0, x1 in split(X0, X1, 0, H, []):
    pass
for s0, s1 in split(IX0, IX1, 0, H, [(h0, h1, hy0, hy1) for h0, h1, hy0, hy1 in openings_front]):
    pass
# front inner wall pieces (around openings)
for (a0, a1, y0, y1) in (
    (X0, WIN_L["x0"], 0, H), (WIN_L["x0"], WIN_L["x1"], 0, WIN_L["y0"]), (WIN_L["x0"], WIN_L["x1"], WIN_L["y1"], H),
    (WIN_L["x1"], DOOR["x0"], 0, H), (DOOR["x0"], DOOR["x1"], DOOR["h"], H), (DOOR["x1"], WIN_R["x0"], 0, H),
    (WIN_R["x0"], WIN_R["x1"], 0, WIN_R["y0"]), (WIN_R["x0"], WIN_R["x1"], WIN_R["y1"], H), (WIN_R["x1"], X1, 0, H),
):
    K.bm_box(bm, (a0, F + y0, Z1 - T), (a1, F + y1, Z1 - OUT_T))
K.bm_box(bm, (IX0, F, Z0 + OUT_T), (IX1, F + H, IZ0))
K.bm_box(bm, (X0 + OUT_T, F, IZ0), (IX0, F + H, IZ1))
K.bm_box(bm, (IX1, F, IZ0), (X1 - OUT_T, F + H, IZ1))
ang = math.atan(SLOPE)
for sgn in (-1, 1):
    K.bm_obox(bm, (sgn * W / 4, F + H + RIDGE / 2 - 0.05, 0), (W / 2 / math.cos(ang), 0.03, D - 2 * T), (0, 0, -sgn * ang))
inner = finish("inner", bm, M_INNER, 1.4)

# ======================= roof (real corrugations) ===========================
zA, zB = Z0 - ROOF_OVER, ROOF_FRONT
half_span = W / 2 + ROOF_OVER
L = math.hypot(half_span, half_span * SLOPE)
bm = bmesh.new()
uvl = bm.loops.layers.uv.verify()
PERIOD, AMP = 0.076, 0.016
for sgn in (-1, 1):
    n = int((zB - zA) / PERIOD * 4)
    top, bot = [], []
    for i in range(n + 1):
        z = zA + (zB - zA) * i / n
        wave = AMP * math.sin(2 * math.pi * (z - zA) / PERIOD)
        for s, row in ((0.0, top), (L, bot)):
            x = sgn * s * math.cos(ang)
            y = F + H + RIDGE + 0.07 - s * math.sin(ang) + wave
            row.append(bm.verts.new(K.B(x, y, z)))
    for i in range(n):
        quad = (top[i], top[i + 1], bot[i + 1], bot[i]) if sgn > 0 else (top[i + 1], top[i], bot[i], bot[i + 1])
        f = bm.faces.new(quad)
        f.smooth = True
        for loop in f.loops:
            co = loop.vert.co
            # corrugations run down the slope: u across the waves, v down the roof
            u = -co.y / 1.8  # Blender -y = game z
            v = (F + H + RIDGE - co.z) / math.sin(ang) / 1.8
            loop[uvl].uv = (u, v)
roof = K.new_obj("roof", bm, M_ROOF)
sol = roof.modifiers.new("solid", "SOLIDIFY")
sol.thickness = 0.012
K.apply_mods(roof)
objects.append(roof)

# ======================= trim (white) =======================================
bm = bmesh.new()
for sgn in (-1, 1):
    K.bm_box(bm, (sgn * half_span - 0.03, F + H + RIDGE - half_span * SLOPE + 0.04 - 0.09, zA), (sgn * half_span + 0.03, F + H + RIDGE - half_span * SLOPE + 0.04 + 0.09, zB))
    for z in (zA, zB):
        K.bm_obox(bm, (sgn * half_span / 2, F + H + RIDGE - (half_span / 2) * SLOPE + 0.03, z), (L, 0.16, 0.05), (0, 0, -sgn * ang))
K.bm_box(bm, (-0.09, F + H + RIDGE + 0.06, zA), (0.09, F + H + RIDGE + 0.14, zB))
trim = finish("trim", bm, M_TRIM, 1.0)
K.bevel(trim, 0.006, 1)

# ======================= dark wood: beams, frames, porch, sign board ========
bm = bmesh.new()
K.bm_box(bm, (-0.08, F + H + RIDGE - 0.22, Z0), (0.08, F + H + RIDGE - 0.02, PZ1))  # ridge beam
for z in TIE_BEAMS:
    K.bm_box(bm, (IX0, F + H - 0.16, z - 0.07), (IX1, F + H, z + 0.07))
K.bm_box(bm, (X0, F + H - 0.18, PZ1 - 0.16), (X1, F + H, PZ1))  # porch header
for x, z in ((X0, Z0), (X1, Z0), (X0, Z1), (X1, Z1)):  # corner boards
    K.bm_box(bm, (x - 0.06, F, z - 0.06), (x + 0.06, F + H, z + 0.06))
K.bm_box(bm, (DOOR["x0"], F, Z1 - T), (DOOR["x1"], F + 0.025, Z1 + 0.02))  # threshold


def window(w, panes):
    f, zf = 0.06, Z1 + 0.012
    K.bm_box(bm, (w["x0"] - f - 0.03, F + w["y0"] - f, Z1 - T - 0.01), (w["x1"] + f + 0.03, F + w["y0"], zf + 0.05))
    K.bm_box(bm, (w["x0"] - f, F + w["y1"], Z1 - T - 0.01), (w["x1"] + f, F + w["y1"] + f, zf))
    K.bm_box(bm, (w["x0"] - f, F + w["y0"], Z1 - T - 0.01), (w["x0"], F + w["y1"], zf))
    K.bm_box(bm, (w["x1"], F + w["y0"], Z1 - T - 0.01), (w["x1"] + f, F + w["y1"], zf))
    for k in range(1, panes):
        x = w["x0"] + (w["x1"] - w["x0"]) * k / panes
        K.bm_box(bm, (x - 0.022, F + w["y0"], Z1 - 0.07), (x + 0.022, F + w["y1"], Z1 - 0.03))
    ym = (w["y0"] + w["y1"]) / 2
    K.bm_box(bm, (w["x0"], F + ym - 0.02, Z1 - 0.07), (w["x1"], F + ym + 0.02, Z1 - 0.03))


window(WIN_L, 3)
window(WIN_R, 1)
# door frame
K.bm_box(bm, (DOOR["x0"] - 0.08, F, Z1 - T - 0.01), (DOOR["x0"], F + DOOR["h"] + 0.08, Z1 + 0.02))
K.bm_box(bm, (DOOR["x1"], F, Z1 - T - 0.01), (DOOR["x1"] + 0.08, F + DOOR["h"] + 0.08, Z1 + 0.02))
K.bm_box(bm, (DOOR["x0"] - 0.08, F + DOOR["h"], Z1 - T - 0.01), (DOOR["x1"] + 0.08, F + DOOR["h"] + 0.08, Z1 + 0.02))
# porch posts, railings with balusters
zp = PZ1 - 0.09
for x in (X0 + 0.09, STEPS["x0"] - 0.07, STEPS["x1"] + 0.07, X1 - 0.09):
    K.bm_box(bm, (x - 0.07, F, zp - 0.07), (x + 0.07, F + H - 0.1, zp + 0.07))
for x in (X0 + 0.09, X1 - 0.09):
    K.bm_box(bm, (x - 0.07, F, Z1 + 0.02), (x + 0.07, F + H - 0.1, Z1 + 0.16))


def rail(x0, z0, x1, z1):
    length = math.hypot(x1 - x0, z1 - z0)
    yaw = -math.atan2(z1 - z0, x1 - x0)
    for y in (0.12, 0.88):
        K.bm_obox(bm, ((x0 + x1) / 2, F + y, (z0 + z1) / 2), (length, 0.07, 0.06), (0, yaw, 0))
    n = int(length / 0.13)
    for k in range(1, n):
        t = k / n
        x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
        K.bm_box(bm, (x - 0.018, F + 0.12, z - 0.018), (x + 0.018, F + 0.88, z + 0.018))


rail(X0 + 0.09, zp, STEPS["x0"] - 0.07, zp)
rail(STEPS["x1"] + 0.07, zp, X1 - 0.09, zp)
rail(X0 + 0.09, Z1 + 0.09, X0 + 0.09, zp)
rail(X1 - 0.09, Z1 + 0.09, X1 - 0.09, zp)
for x in (STEPS["x0"] - 0.07, STEPS["x1"] + 0.07):  # handrails down the steps
    z0, z1 = zp, PZ1 + STEP_N * STEP_D - 0.05
    K.bm_box(bm, (x - 0.05, -0.1, z1 - 0.05), (x + 0.05, 0.95, z1 + 0.05))
    ln = math.hypot(z1 - z0, F)
    K.bm_obox(bm, (x, F * 0.5 + 0.88, (z0 + z1) / 2), (0.06, 0.07, ln), (math.atan2(F, z1 - z0), 0, 0))
# sign board (the painted sign itself stays in the game) and its lamp bracket
zs = PZ1 - 0.07
K.bm_box(bm, (-1.06, F + H + 0.15, zs), (1.06, F + H + 0.71, zs + 0.03))
dark = finish("dark_wood", bm, M_DARK, K.tile_size("dark_planks", 2.0))
K.bevel(dark, 0.005, 1)

# ======================= bake & export =====================================
bake = [stone, floor, siding, inner, roof, trim, dark]
for ob in bake:
    print("tris", ob.name, K.tris(ob))
K.bake_ao(bake, distance=1.0, samples=32, strength=0.8)
K.export_glb(OUT)
