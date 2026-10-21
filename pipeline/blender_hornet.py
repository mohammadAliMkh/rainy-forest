"""Runs INSIDE Blender: Honda Hornet 2.0 street bike in matte blue (same
geometry frame as src/game/vehicles/Hornet.js), exported as .glb.

    blender -b --factory-startup -P pipeline/blender_hornet.py -- <out.glb>

Smooth sculpted tank shrouds (subdivision), gold upside-down fork with
triple clamps, black alloy wheels with Y-spokes and blue rim tape, petal
discs and calipers, single-cylinder engine with fins and side covers,
header pipe and silencer, swingarm with chain and monoshock, stepped seat,
grey tail panels with LED light and rear rack, LED headlight under a short
flyscreen, handlebar with grips, levers and mirrors. The front end is turned
on the steering axis and the bike leans onto its side stand.
Named objects the game uses: decal_L, decal_R (the HORNET graphic).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bkit as K  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
K.reset()

R = 0.3
FA, RA = (0, R, 0.68), (0, R, -0.68)
HEAD = (0, 0.96, 0.46)
PIVOT = (0, 0.42, -0.2)

blue = K.flat("blue", (0.03, 0.09, 0.33), roughness=0.55, metallic=0.3)
gold = K.flat("gold", (0.85, 0.58, 0.18), roughness=0.3, metallic=1.0)
black = K.flat("black", (0.015, 0.015, 0.017), roughness=0.4, metallic=0.3)
matte = K.flat("matte_black", (0.02, 0.02, 0.02), roughness=0.75)
grey = K.flat("grey", (0.28, 0.29, 0.3), roughness=0.5, metallic=0.2)
steel = K.flat("steel", (0.7, 0.71, 0.72), roughness=0.25, metallic=1.0)
rubber = K.flat("rubber", (0.03, 0.03, 0.03), roughness=0.9)
tape = K.flat("rim_tape", (0.05, 0.2, 0.75), roughness=0.4)
redl = K.flat("taillight", (0.4, 0.02, 0.02), roughness=0.2)
lens = K.flat("lens", (0.8, 0.82, 0.86), roughness=0.05, metallic=0.4)
seat_m = K.flat("seat", (0.02, 0.02, 0.022), roughness=0.85)
decal_m = K.flat("decal", (1, 1, 1), roughness=0.5)

body, front = [], []


def smooth_blob(name, center, dims, mat, levels=2, bevel=0.0):
    ob = K.box_obj(name, center, dims, mat)
    if bevel:
        K.bevel_mod(ob, bevel, 2)
    m = ob.modifiers.new("subd", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    K.apply_mods(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def wheel(center, width, front_wheel, out):
    parts = []
    hw = width / 2
    tyre = [(0.2, -hw * 0.9), (0.245, -hw), (0.28, -hw * 0.85), (0.297, -hw * 0.45), (0.3, 0.0), (0.297, hw * 0.45),
            (0.28, hw * 0.85), (0.245, hw), (0.2, hw * 0.9)]
    parts.append(K.lathe("tyre", tyre, rubber, segments=40, axis="x"))
    parts.append(K.lathe("rim", [(0.205, -hw * 0.75), (0.21, 0.0), (0.205, hw * 0.75)], black, segments=40, axis="x"))
    parts.append(K.lathe("tape", [(0.212, -hw * 0.5), (0.214, hw * 0.5)], tape, segments=40, axis="x"))
    parts.append(K.lathe("hub", [(0.0, 0.06), (0.04, 0.06), (0.045, 0.0), (0.04, -0.06), (0.0, -0.06)], black, segments=16, axis="x"))
    # Y spokes
    bm = bmesh.new()
    for k in range(5):
        a = 2 * math.pi * k / 5
        for da, l0, l1 in ((0.0, 0.04, 0.13), (0.22, 0.12, 0.205), (-0.22, 0.12, 0.205)):
            aa = a + (da if l0 > 0.1 else 0)
            mid = (l0 + l1) / 2
            K.bm_obox(bm, (0, mid * math.sin(aa), mid * math.cos(aa)), (0.02, l1 - l0, 0.022), (-aa, 0, 0))
    parts.append(K.new_obj("spokes", bm, black))
    # petal disc (+ caliper) on the outer side
    disc_profile = [(0.07, 0.003), (0.145 if front_wheel else 0.11, 0.003)]
    d = K.lathe("disc", [(r, out * 0.055 + o) for r, o in disc_profile], steel, segments=24, axis="x")
    parts.append(d)
    rad = 0.135 if front_wheel else 0.1
    parts.append(K.box_obj("caliper", (out * 0.07, rad * 0.7, -rad * 0.7 if front_wheel else rad * 0.7), (0.04, 0.08, 0.06), gold if front_wheel else black, bevel=0.01))
    for p in parts:
        bpy.ops.object.select_all(action="DESELECT")
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    w = K.join(parts, "wheel")
    w.location = K.B(*center)
    return w


# ======================= rear half / main body ==============================
body.append(wheel(RA, 0.15, False, -1))
# frame: twin spars from the head to the pivot, subframe to the tail
for s in (-1, 1):
    body.append(K.curve_tube("frame", [(s * 0.06, 0.92, 0.42), (s * 0.13, 0.78, 0.15), (s * 0.12, 0.55, -0.12), (s * 0.08, 0.42, -0.2)], 0.024, black))
    body.append(K.curve_tube("subframe", [(s * 0.1, 0.62, -0.18), (s * 0.1, 0.8, -0.55), (s * 0.08, 0.88, -0.8)], 0.014, black))
    # swingarm to the rear axle
    body.append(K.box_obj("swingarm", (s * 0.1, (PIVOT[1] + R) / 2, (PIVOT[2] + RA[2]) / 2), (0.035, 0.05, abs(RA[2] - PIVOT[2]) + 0.05),
                          black, rot=(math.atan2(PIVOT[1] - R, PIVOT[2] - RA[2]) * -1, 0, 0), bevel=0.01))
# chain (as a flat loop) on the left side, sprocket
body.append(K.box_obj("chain", (0.12, (PIVOT[1] + R) / 2 + 0.01, (PIVOT[2] + RA[2]) / 2 + 0.05), (0.012, 0.09, 0.55), matte, rot=(-0.17, 0, 0), bevel=0.03))
# monoshock with spring
body.append(K.cyl_obj("shock", (0, 0.45, -0.22), (0, 0.8, -0.38), 0.025, steel))
body.append(K.curve_tube("spring", [(0.032 * math.cos(t), 0.5 + t * 0.012, -0.24 - t * 0.0055 + 0.032 * math.sin(t)) for t in [i * 0.6 for i in range(40)]], 0.006, redl, resolution=2, bevel_res=1))

# engine: crankcase, finned cylinder leaning forward, side covers
body.append(smooth_blob("crankcase", (0, 0.36, 0.0), (0.24, 0.24, 0.36), matte, levels=1, bevel=0.03))
cyl_c = Vector((0, 0.58, 0.14))
for k in range(9):
    y = 0.47 + k * 0.026
    body.append(K.box_obj("fin", (0, y, 0.1 + (y - 0.47) * 0.35), (0.22 - k * 0.004, 0.012, 0.2 - k * 0.003), black, rot=(-0.35, 0, 0)))
body.append(K.box_obj("head", (0, 0.72, 0.17), (0.19, 0.08, 0.18), black, rot=(-0.35, 0, 0), bevel=0.02))
for s in (-1, 1):
    body.append(K.cyl_obj("side_cover", (s * 0.12, 0.36, 0.0), (s * 0.15, 0.36, 0.0), 0.12, black, seg=28))
    body.append(K.cyl_obj("cover_bolt", (s * 0.15, 0.36, 0.0), (s * 0.158, 0.36, 0.0), 0.035, steel, seg=12))
# exhaust: header down & under, silencer on the right (-X)
body.append(K.curve_tube("header", [(0, 0.55, 0.26), (-0.02, 0.38, 0.3), (-0.06, 0.18, 0.12), (-0.1, 0.2, -0.2), (-0.15, 0.32, -0.38)], 0.022, black))
body.append(K.lathe("silencer", [(0.0, 0.17), (0.05, 0.16), (0.065, 0.1), (0.068, -0.12), (0.05, -0.17), (0.0, -0.17)], black, segments=20, center=(-0.16, 0.38, -0.5), axis="z"))
body[-1].rotation_euler.rotate_axis("X", -0.3)

# tank & shrouds (sculpted), knee recesses implied by the shape
tank = smooth_blob("tank", (0, 0.9, 0.15), (0.3, 0.2, 0.52), blue, levels=2, bevel=0.04)
body.append(tank)
for s in (-1, 1):
    sh = smooth_blob("shroud", (s * 0.155, 0.79, 0.29), (0.05, 0.21, 0.38), blue, levels=2, bevel=0.015)
    sh.rotation_euler = (0.35, 0, -s * 0.12)
    body.append(sh)
    # decal planes (the game paints HORNET on them)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    x = s * 0.188
    pts = [(x, 0.76, 0.48), (x, 0.76, 0.02), (x, 0.905, 0.02), (x, 0.905, 0.48)] if s > 0 else [(x, 0.76, 0.02), (x, 0.76, 0.48), (x, 0.905, 0.48), (x, 0.905, 0.02)]
    vs = [bm.verts.new(K.B(*p)) for p in pts]
    f = bm.faces.new(vs)
    uvs = ((0, 0), (1, 0), (1, 1), (0, 1))
    for loop, uv in zip(f.loops, uvs):
        loop[uvl].uv = uv
    ob = K.new_obj("decal_L" if s > 0 else "decal_R", bm, decal_m)
    ob.rotation_euler = (0.25, 0, -s * 0.12)
# stepped seat, tail panels, tail light, rack, hugger
body.append(smooth_blob("seat_rider", (0, 0.865, -0.24), (0.26, 0.08, 0.42), seat_m, levels=2, bevel=0.02))
body.append(smooth_blob("seat_pillion", (0, 0.93, -0.58), (0.22, 0.07, 0.3), seat_m, levels=2, bevel=0.02))
for s in (-1, 1):
    tp = smooth_blob("tail_panel", (s * 0.085, 0.84, -0.62), (0.03, 0.14, 0.5), grey, levels=1, bevel=0.01)
    tp.rotation_euler = (0.18, 0, s * 0.08)
    body.append(tp)
body.append(K.box_obj("taillight", (0, 0.86, -0.88), (0.13, 0.05, 0.03), redl, rot=(0.4, 0, 0), bevel=0.01))
for s in (-1, 1):
    body.append(K.curve_tube("rack", [(s * 0.13, 0.86, -0.35), (s * 0.14, 0.93, -0.58), (s * 0.12, 0.95, -0.86)], 0.012, black))
z = -0.62
while z > -0.86:
    body.append(K.box_obj("rack_bar", (0, 0.955, z), (0.25, 0.012, 0.03), black))
    z -= 0.05
body.append(K.box_obj("plate_holder", (0, 0.66, -0.86), (0.15, 0.11, 0.01), black, rot=(0.4, 0, 0)))
body.append(smooth_blob("hugger", (0, 0.58, -0.62), (0.16, 0.03, 0.3), matte, levels=1))
for s in (-1, 1):
    body.append(K.cyl_obj("footpeg", (s * 0.12, 0.34, -0.14), (s * 0.22, 0.34, -0.14), 0.012, steel))
# side stand (left, +X), resting on the ground
body.append(K.curve_tube("stand", [(0.12, 0.33, -0.04), (0.2, 0.19, 0.02), (0.25, 0.045, 0.08)], 0.012, black))

# ======================= front end (turned on the steering axis) ============
front.append(wheel(FA, 0.11, True, 1))
for s in (-1, 1):
    front.append(K.cyl_obj("fork_upper", (s * 0.09, HEAD[1] - 0.02, HEAD[2] + 0.005), (s * 0.09, 0.56, 0.6), 0.03, gold, seg=18))
    front.append(K.cyl_obj("fork_lower", (s * 0.09, 0.58, 0.6), (s * 0.09, R + 0.02, FA[2] - 0.005), 0.022, steel, seg=14))
    front.append(K.box_obj("axle_lug", (s * 0.09, R, FA[2]), (0.05, 0.08, 0.06), black, bevel=0.01))
front.append(K.box_obj("clamp_top", (0, HEAD[1] + 0.01, HEAD[2] + 0.0), (0.26, 0.03, 0.08), black, rot=(-0.32, 0, 0), bevel=0.01))
front.append(K.box_obj("clamp_bottom", (0, HEAD[1] - 0.12, HEAD[2] + 0.04), (0.26, 0.04, 0.08), black, rot=(-0.32, 0, 0), bevel=0.01))
front.append(smooth_blob("fender", (0, R + 0.06, FA[2] + 0.02), (0.13, 0.05, 0.42), matte, levels=1))
# LED headlight, flyscreen, dash
front.append(smooth_blob("headlight_body", (0, 0.88, HEAD[2] + 0.15), (0.17, 0.14, 0.09), black, levels=2, bevel=0.02))
front.append(smooth_blob("headlight_lens", (0, 0.88, HEAD[2] + 0.19), (0.13, 0.08, 0.025), lens, levels=2))
fs = smooth_blob("flyscreen", (0, 1.0, HEAD[2] + 0.14), (0.18, 0.14, 0.015), black, levels=1)
fs.rotation_euler = (-0.5, 0, 0)
front.append(fs)
front.append(K.box_obj("dash", (0, 1.04, HEAD[2] + 0.04), (0.13, 0.07, 0.03), black, rot=(-0.6, 0, 0), bevel=0.01))
# handlebar, grips, levers, mirrors
front.append(K.curve_tube("bar", [(-0.34, 1.06, HEAD[2] - 0.08), (-0.1, 1.04, HEAD[2] - 0.02), (0.1, 1.04, HEAD[2] - 0.02), (0.34, 1.06, HEAD[2] - 0.08)], 0.011, black))
for s in (-1, 1):
    front.append(K.cyl_obj("grip", (s * 0.27, 1.055, HEAD[2] - 0.065), (s * 0.37, 1.062, HEAD[2] - 0.09), 0.017, rubber))
    front.append(K.curve_tube("lever", [(s * 0.22, 1.06, HEAD[2] - 0.03), (s * 0.33, 1.05, HEAD[2] + 0.02)], 0.006, steel))
    front.append(K.curve_tube("mirror_stalk", [(s * 0.2, 1.07, HEAD[2] - 0.05), (s * 0.25, 1.18, HEAD[2] - 0.08)], 0.007, black))
    front.append(smooth_blob("mirror", (s * 0.27, 1.21, HEAD[2] - 0.085), (0.1, 0.05, 0.016), black, levels=1, bevel=0.004))

# ======================= assemble ===========================================


def apply_all(objs):
    for o in objs:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


apply_all(front)
# turn the front end 0.45 rad about the (raked) steering axis
axis = (Vector(K.B(*FA)) - Vector(K.B(*HEAD))).normalized()
pivot = Vector(K.B(*HEAD))
turn = Matrix.Translation(pivot) @ Matrix.Rotation(-0.45, 4, axis) @ Matrix.Translation(-pivot)
for o in front:
    o.data.transform(turn)
everything = body + front + [o for o in bpy.context.scene.objects if o.name.startswith("decal_")]
apply_all(everything)
# lean onto the side stand: rotate about the ground contact line (game z axis)
lean = K.to_blender(Matrix.Rotation(-0.16, 4, "Z"))
for o in everything:
    o.data.transform(lean)

by_mat = {}
for o in body + front:
    by_mat.setdefault(o.data.materials[0].name, []).append(o)
final = [K.join(g, k) for k, g in by_mat.items()]
for o in final:
    print("tris", o.name, K.tris(o))
K.bake_ao(final, distance=0.25, samples=24, strength=0.7)
K.export_glb(OUT)
