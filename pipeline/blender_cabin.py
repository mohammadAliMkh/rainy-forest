"""Runs INSIDE Blender: models the log cabin (same measurements as
src/game/world/Cabin.js) and exports it as one .glb.

    blender -b --factory-startup -P pipeline/blender_cabin.py -- <out.glb>

Real geometry for every part: tapered, slightly irregular round logs with
cut end grain that cross at the corners, shortening logs in the gables,
roof boards with ~1400 individual slate shingles, rafter tails, fascia,
barge boards and a ridge cap, a stone foundation and a stepped stone
chimney, framed windows with mullions and sills, a braced plank door (its
own object, hinged), a stone threshold, and a simple interior (floorboards,
stone fireplace, table and bench). Ambient occlusion is baked into vertex
colors. Object names the game looks for: door, glass_front, glass_side.
"""
import math
import os
import random
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit as K  # noqa: E402
from bkit import B  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
K.reset()
random.seed(11)

# ---- measurements (keep in sync with Cabin.js) ----
W, D, H = 6.2, 5.0, 2.55
r = 0.15
course = r * 1.9
plinth = 0.28
rise = 2.2
over = 0.32
door = dict(wall="front", c=-1.0, w=1.05, y0=plinth, y1=plinth + 1.95)
win_front = dict(wall="front", c=1.55, w=1.0, y0=1.05, y1=1.95)
win_side = dict(wall="left", c=-0.3, w=1.0, y0=1.05, y1=1.9)
openings = [door, win_front, win_side]

# ---- materials ----
M_LOG = K.pbr("logs", "rough_wood", tint=(1.12, 0.86, 0.64))
M_END = K.flat("log_end", (1, 1, 1), roughness=0.85)
M_END.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (1, 1, 1, 1)
nt = M_END.node_tree
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(os.path.join(K.KIT, "log_end_diff.jpg"))
nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
M_SHINGLE = K.pbr("shingles", "roof_slates_02", tint=(0.78, 0.78, 0.8))
M_BOARD = K.pbr("boards", "weathered_brown_planks")
M_STONE = K.pbr("stone", "mossy_stone_wall")
M_DOOR = K.pbr("door_wood", "rough_pine_door", tint=(0.85, 0.8, 0.75))
M_FLOOR = K.pbr("floor", "wood_floor_worn", tint=(0.8, 0.75, 0.7))
M_GLASS = K.flat("window_glass", (0.1, 0.08, 0.06), roughness=0.1)
M_METAL = K.flat("iron", (0.08, 0.08, 0.085), roughness=0.5, metallic=0.8)
M_DARK = K.flat("soot", (0.02, 0.018, 0.016), roughness=1.0)

objects = []


def finish(name, bm, mats, uv_tile=None):
    ob = K.new_obj(name, bm, mats)
    if uv_tile:
        K.world_uv(ob, uv_tile)
    objects.append(ob)
    return ob


# ======================= logs ===============================================
def segments_for(wall, a0, a1, y):
    segs = [(a0, a1)]
    for o in openings:
        if o["wall"] != wall or y + r * 0.6 < o["y0"] or y - r * 0.6 > o["y1"]:
            continue
        c0, c1 = o["c"] - o["w"] / 2, o["c"] + o["w"] / 2
        nxt = []
        for s0, s1 in segs:
            if c1 <= s0 or c0 >= s1:
                nxt.append((s0, s1))
                continue
            if c0 > s0:
                nxt.append((s0, c0))
            if c1 < s1:
                nxt.append((c1, s1))
        segs = nxt
    return segs


bm_logs = bmesh.new()
log_tile = (K.tile_size("rough_wood", 0.5) * 2, K.tile_size("rough_wood", 0.5) * 3)


def log(axis, a0, a1, y, c):
    if a1 - a0 < 0.15:
        return
    rr = r * random.uniform(0.92, 1.06)
    taper = random.uniform(0.93, 1.0)
    rings = max(2, round((a1 - a0) / 0.55))
    sag = random.uniform(-0.012, 0.012)
    if axis == "x":
        a, b = (a0, y, c), (a1, y + sag, c)
    else:
        a, b = (c, y, a0), (c, y + sag, a1)
    if random.random() < 0.5:
        a, b = b, a
    K.bm_tube(bm_logs, a, b, rr, rr * taper, seg=14, rings=rings, wobble=0.04, tile=log_tile, seed=random.random() * 9)


courses = math.ceil((H - plinth) / course)
for i in range(courses):
    y_fb = plinth + r + i * course
    y_side = y_fb + course / 2
    for s0, s1 in segments_for("front", -W / 2 - over, W / 2 + over, y_fb):
        log("x", s0, s1, y_fb, D / 2)
    for s0, s1 in segments_for("back", -W / 2 - over, W / 2 + over, y_fb):
        log("x", s0, s1, y_fb, -D / 2)
    if y_side < H + 0.1:
        for s0, s1 in segments_for("left", -D / 2 - over, D / 2 + over, y_side):
            log("z", s0, s1, y_side, -W / 2)
        for s0, s1 in segments_for("right", -D / 2 - over, D / 2 + over, y_side):
            log("z", s0, s1, y_side, W / 2)
wall_top = plinth + r + (courses - 1) * course + r
# gables: shortening logs under the roof (ridge along z)
g_courses = math.ceil(rise / course)
for i in range(g_courses):
    y = wall_top + r + i * course
    half = (W / 2 + 0.05) * (1 - (y - wall_top + r) / (rise + 0.05))
    if half < 0.18:
        break
    log("x", -half, half, y, D / 2)
    log("x", -half, half, y, -D / 2)
logs = finish("logs", bm_logs, [M_LOG, M_END])

# ======================= foundation, step, chimney ==========================
bm = bmesh.new()
K.bm_box(bm, (-W / 2 - 0.12, -0.5, -D / 2 - 0.12), (W / 2 + 0.12, plinth, D / 2 + 0.12))
K.bm_obox(bm, (door["c"], 0.07, D / 2 + 0.4), (1.45, 0.2, 0.58), (0, 0.04, 0))
ch_x, ch_z = W / 2 + 0.55, -0.6
ridge_y = wall_top + rise + 0.18
ch_h = ridge_y + 1.0
K.bm_box(bm, (ch_x - 0.5, -0.4, ch_z - 0.52), (ch_x + 0.5, wall_top - 0.3, ch_z + 0.52))  # firebox body
# sloped shoulder (a squashed box) and the narrower stack
K.bm_obox(bm, (ch_x, wall_top - 0.1, ch_z), (0.86, 0.42, 0.88))
K.bm_box(bm, (ch_x - 0.36, wall_top + 0.05, ch_z - 0.38), (ch_x + 0.36, ch_h, ch_z + 0.38))
K.bm_box(bm, (ch_x - 0.45, ch_h, ch_z - 0.47), (ch_x + 0.45, ch_h + 0.1, ch_z + 0.47))  # cap slab
# interior hearth against the right wall
K.bm_box(bm, (W / 2 - 0.75, plinth, -1.35), (W / 2 - 0.15, plinth + 1.4, 0.15))
stone = finish("stone", bm, M_STONE, uv_tile=K.tile_size("mossy_stone_wall", 2.0))
K.bevel(stone, 0.02, 2)

bm = bmesh.new()
K.bm_box(bm, (ch_x - 0.2, ch_h + 0.1, ch_z - 0.2), (ch_x + 0.2, ch_h + 0.102, ch_z + 0.2))  # flue
K.bm_box(bm, (W / 2 - 0.77, plinth + 0.05, -0.95), (W / 2 - 0.74, plinth + 0.65, -0.25))  # firebox opening
finish("soot", bm, M_DARK)

# ======================= roof ==============================================
eave, front_o, back_o = 0.55, 0.85, 0.45
run = W / 2 + eave
ang = math.atan2(rise, W / 2)
slope_len = run / math.cos(ang) + 0.1
z_a, z_b = -D / 2 - back_o, D / 2 + front_o
roof_depth = z_b - z_a
zc = (z_a + z_b) / 2

bm_board = bmesh.new()
for sgn in (-1, 1):
    # deck boards (slab) under the shingles
    cx = sgn * (slope_len / 2) * math.cos(ang)
    cy = ridge_y - (slope_len / 2) * math.sin(ang) - 0.04
    K.bm_obox(bm_board, (cx, cy, zc), (slope_len, 0.05, roof_depth), (0, 0, -sgn * ang))
    # fascia along the eave
    ex = sgn * (slope_len * math.cos(ang) - 0.02)
    ey = ridge_y - slope_len * math.sin(ang) - 0.07
    K.bm_obox(bm_board, (ex, ey, zc), (0.05, 0.2, roof_depth + 0.05), (0, 0, -sgn * ang))
    # barge boards on both gable ends
    for zz in (z_a - 0.02, z_b + 0.02):
        # stop short of the ridge so the two boards don't cross above it
        bl = slope_len - 0.12
        bx = sgn * (slope_len - bl / 2) * math.cos(ang)
        by = ridge_y - (slope_len - bl / 2) * math.sin(ang) - 0.06
        K.bm_obox(bm_board, (bx, by, zz), (bl, 0.24, 0.05), (0, 0, -sgn * ang))
    # rafter tails under the eave
    z = z_a + 0.15
    while z < z_b - 0.1:
        s_wall = (W / 2) / math.cos(ang)
        s_mid = (s_wall + slope_len) / 2
        tx = sgn * s_mid * math.cos(ang)
        ty = ridge_y - s_mid * math.sin(ang) - 0.13
        K.bm_obox(bm_board, (tx, ty, z), (slope_len - s_wall + 0.1, 0.13, 0.08), (0, 0, -sgn * ang))
        z += 0.62
# ridge cap: two boards in a shallow V
for sgn in (-1, 1):
    K.bm_obox(bm_board, (sgn * 0.09 * math.cos(ang), ridge_y + 0.06, zc), (0.22, 0.03, roof_depth + 0.06), (0, 0, -sgn * ang))
# door & window frames (the wall is a log thick: 0.34 deep)
def frame(o, depth=0.36, t=0.09):
    w, h = o["w"], o["y1"] - o["y0"]
    if o["wall"] == "front":
        cx, cz = o["c"], D / 2
        parts = [((cx, o["y1"] + t / 2, cz), (w + 2 * t, t, depth)),
                 ((cx - w / 2 - t / 2, (o["y0"] + o["y1"]) / 2, cz), (t, h, depth)),
                 ((cx + w / 2 + t / 2, (o["y0"] + o["y1"]) / 2, cz), (t, h, depth))]
        if o is not door:
            parts.append(((cx, o["y0"] - t / 2, cz + 0.04), (w + 2 * t + 0.08, t, depth + 0.1)))  # sill
            parts.append(((cx, (o["y0"] + o["y1"]) / 2, cz - 0.02), (0.045, h, 0.05)))  # mullions
            parts.append(((cx, (o["y0"] + o["y1"]) / 2, cz - 0.02), (w, 0.045, 0.05)))
    else:
        cx, cz = -W / 2, o["c"]
        parts = [((cx, o["y1"] + t / 2, cz), (depth, t, w + 2 * t)),
                 ((cx, (o["y0"] + o["y1"]) / 2, cz - w / 2 - t / 2), (depth, h, t)),
                 ((cx, (o["y0"] + o["y1"]) / 2, cz + w / 2 + t / 2), (depth, h, t)),
                 ((cx - 0.04, o["y0"] - t / 2, cz), (depth + 0.1, t, w + 2 * t + 0.08)),
                 ((cx + 0.02, (o["y0"] + o["y1"]) / 2, cz), (0.05, h, 0.045)),
                 ((cx + 0.02, (o["y0"] + o["y1"]) / 2, cz), (0.05, 0.045, w))]
    for c, d in parts:
        K.bm_obox(bm_board, c, d)


for o in openings:
    frame(o)
# interior: table & bench (boards), floor below
for (x, z) in ((-1.7, -1.5), (-0.7, -1.5), (-1.7, -0.9), (-0.7, -0.9)):
    K.bm_box(bm_board, (x - 0.035, plinth, z - 0.035), (x + 0.035, plinth + 0.74, z + 0.035))
K.bm_box(bm_board, (-1.8, plinth + 0.74, -1.6), (-0.6, plinth + 0.79, -0.8))
K.bm_box(bm_board, (-1.75, plinth + 0.42, -0.55), (-0.65, plinth + 0.46, -0.32))
for x in (-1.65, -0.75):
    K.bm_box(bm_board, (x - 0.03, plinth, -0.5), (x + 0.03, plinth + 0.42, -0.37))
boards = finish("boards", bm_board, M_BOARD, uv_tile=K.tile_size("weathered_brown_planks", 1.8))
K.bevel(boards, 0.006, 1)

bm = bmesh.new()
K.bm_box(bm, (-W / 2 + 0.12, plinth, -D / 2 + 0.12), (W / 2 - 0.12, plinth + 0.03, D / 2 - 0.12))
finish("floor", bm, M_FLOOR, uv_tile=K.tile_size("wood_floor_worn", 2.0))

# shingles: rows parallel to the ridge, each slightly lifted at its butt end
bm_sh = bmesh.new()
row_step, sh_len, sh_t = 0.19, 0.44, 0.03
for sgn in (-1, 1):
    s = slope_len - 0.02
    row = 0
    while s > 0.12:
        z = z_a - 0.03 + (0.13 if row % 2 else 0.0)
        while z < z_b + 0.03:
            w = random.uniform(0.2, 0.32)
            zz = min(z + w / 2, z_b + 0.03 - 0.001)
            wc = (min(z + w, z_b + 0.04) - max(z, z_a - 0.04))
            if wc > 0.05:
                sc = s - sh_len / 2
                x = sgn * sc * math.cos(ang)
                y = ridge_y - sc * math.sin(ang) + 0.012 + sh_t / 2
                tilt = -sgn * (ang + 0.035 + random.uniform(-0.01, 0.015))
                K.bm_obox(bm_sh, (x, y, max(z, z_a - 0.04) + wc / 2), (sh_len, sh_t, wc - 0.012),
                          (random.uniform(-0.01, 0.01), random.uniform(-0.015, 0.015), tilt))
            z += w
        s -= row_step
        row += 1
shingles = finish("shingles", bm_sh, M_SHINGLE, uv_tile=1.4)

# ======================= door (own object, pivot at the hinge) ==============
dw, dh = door["w"] - 0.04, door["y1"] - door["y0"] - 0.04
bm = bmesh.new()
for k in range(4):  # four vertical planks
    x0 = k * dw / 4 + 0.004
    K.bm_box(bm, (x0, 0, -0.03), (x0 + dw / 4 - 0.008, dh, 0.03))
for yy in (0.25, dh - 0.3):  # ledges on the inside
    K.bm_box(bm, (0.04, yy - 0.06, -0.06), (dw - 0.04, yy + 0.06, -0.03))
K.bm_obox(bm, (dw / 2, dh / 2 - 0.02, -0.045), (math.hypot(dw - 0.1, dh - 0.67), 0.1, 0.03), (0, 0, math.atan2(dh - 0.67, dw - 0.1)))
door_ob = K.new_obj("door", bm, M_DOOR)
K.world_uv(door_ob, 2.0)
bm = bmesh.new()
for yy in (0.25, dh - 0.3):  # strap hinges and a ring handle
    K.bm_box(bm, (0.0, yy - 0.025, 0.03), (0.42, yy + 0.025, 0.04))
K.bm_box(bm, (dw - 0.14, 0.95, 0.03), (dw - 0.1, 1.08, 0.08))
hw = K.new_obj("door_iron", bm, M_METAL)
door_ob.location = B(door["c"] - door["w"] / 2, door["y0"], D / 2 - 0.05)
hw.parent = door_ob
objects += [door_ob, hw]

# ======================= window glass (the game makes it glow) =============
bm = bmesh.new()
K.bm_box(bm, (win_front["c"] - 0.5, win_front["y0"], D / 2 - 0.03), (win_front["c"] + 0.5, win_front["y1"], D / 2 - 0.02))
gf = K.new_obj("glass_front", bm, M_GLASS)
bm = bmesh.new()
K.bm_box(bm, (-W / 2 + 0.02, win_side["y0"], win_side["c"] - 0.5), (-W / 2 + 0.03, win_side["y1"], win_side["c"] + 0.5))
gs = K.new_obj("glass_side", bm, M_GLASS)

# ======================= bake & export =====================================
bake_set = [logs, stone, boards, shingles, door_ob]
for ob in bake_set:
    print("tris", ob.name, K.tris(ob))
K.bake_ao(bake_set, distance=1.0, samples=32, strength=0.8)
K.export_glb(OUT)
